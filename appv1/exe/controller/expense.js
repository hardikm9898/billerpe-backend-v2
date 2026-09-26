// COPY of billerpe-local-exe/controller/expense.js for the POS App (Plan 2) -
// written by scripts/vendor-exe-for-appv1.py. Do not edit here: change the
// exe's file and re-run the script, so both plans keep the same rules.

const { Op } = require("sequelize");
const { sequelize, Hotel, ExpenseHead, ExpenseEntry, RestaurantSetting, Order, HotelUser, CashSession, CashMovement } = require("../model");
const { MESSAGE, STATUSCODE } = require("../../../constant/const");
const { success, error } = require("../../../responce/res");
const { getBusinessDate, getShiftedDateRange } = require("../utils/dateUtils");

// A minute of slack for ordinary clock skew between the browser and this
// machine - without it, an expense entered at exactly "now" could bounce
// as "future" purely from a few seconds of drift.
const FUTURE_DATE_SLACK_MS = 60 * 1000;
function isFutureDate(dateObj) {
    return dateObj.getTime() > Date.now() + FUTURE_DATE_SLACK_MS;
}

// Ported from uat-backend-v2/controller/expence/expence.js - web routes only
// (mobile variants excluded, matching what billerpe-pos-pro-v2 actually
// calls). Two fixes applied vs. the source, per explicit sign-off:
//   1. editExpense/deleteExpense now scope their findByPk lookups to
//      hotel_id - the source looks these up by bare id, so any hotel's
//      admin token could edit/delete another hotel's expense entry.
//   2. editExpense now recomputes business_date when `date` changes,
//      instead of leaving the entry's business_date pointing at its
//      original day while createdAt moves - a real reporting-correctness
//      gap (allEntry filters by business_date, so a moved entry would
//      silently vanish from the day range it now visually belongs to).
const NAME_PATTERN = /^[A-Za-z0-9\s&.,'()\-[\]]+$/;

const addExpenseHead = async (req, res) => {
    try {
        const hotel_id = req.user;
        const { expense_head_name } = req.body;
        const hotel = await Hotel.findByPk(hotel_id);
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST));
        if (!expense_head_name || !NAME_PATTERN.test(expense_head_name)) {
            return res.json(error("Invalid expense head name", STATUSCODE.BAD_REQUEST));
        }
        const dup = await ExpenseHead.findOne({ where: { hotel_id, expense_head_name, deleted: false } });
        if (dup) return res.json(error("ExpenseHead Name Has Already Taken", STATUSCODE.BAD_REQUEST));

        await ExpenseHead.create({ expense_head_name, hotel_id });
        const expenseHeads = await ExpenseHead.findAll({ where: { hotel_id, deleted: false } });
        return res.status(STATUSCODE.CREATED).json(success(MESSAGE.SUCCESS, { expenseHeads }, STATUSCODE.CREATED));
    } catch (err) {
        console.error("[expense] addExpenseHead error:", err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

// Deliberately NOT filtered on `deleted` - see uat-backend-v2's own
// getAllExpenseHead comment: billerpe-pos-pro-v2 needs every head (deleted
// included) to resolve past expense entries' head name by id, and filters
// deleted ones out itself anywhere the user actually picks/manages a head.
const getAllExpenseHead = async (req, res) => {
    try {
        const expenseHeads = await ExpenseHead.findAll({ where: { hotel_id: req.user } });
        return res.json(success(MESSAGE.SUCCESS, { expenseHeads }, STATUSCODE.SUCCESS));
    } catch (err) {
        console.error("[expense] getAllExpenseHead error:", err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

const editExpenseHead = async (req, res) => {
    try {
        const hotel_id = req.user;
        const { id, expense_head_name } = req.body;
        if (!expense_head_name || !NAME_PATTERN.test(expense_head_name)) {
            return res.json(error("Invalid expense head name", STATUSCODE.BAD_REQUEST));
        }
        const head = await ExpenseHead.findOne({ where: { id, hotel_id, deleted: false } });
        if (!head) return res.json(error("Expense head not found", STATUSCODE.BAD_REQUEST));
        const dup = await ExpenseHead.findOne({ where: { hotel_id, expense_head_name, deleted: false, id: { [Op.ne]: id } } });
        if (dup) return res.json(error("ExpenseHead Name Has Already Taken", STATUSCODE.BAD_REQUEST));

        await head.update({ expense_head_name });
        const expenseHeads = await ExpenseHead.findAll({ where: { hotel_id, deleted: false } });
        return res.json(success(MESSAGE.SUCCESS, { expenseHeads }, STATUSCODE.SUCCESS));
    } catch (err) {
        console.error("[expense] editExpenseHead error:", err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

// New: `deleted` used to be a dead column here (see model/expenseHead.js's
// old comment) - no route ever set it, nothing filtered on it. Soft-delete
// only, same as deleteExpense below and uat-backend-v2's own new
// deleteExpenseHead: existing ExpenseEntry rows keep their expense_head_id
// pointing at a real (if hidden) row instead of a hard delete breaking
// their FK/history. `updatedAt` bumps from `.update()` as normal, so the
// next push cycle (cloudPushOperations.js's expenseHeads entity) carries
// `deleted: true` up to the cloud copy too - `deleted` is a real column on
// both sides' models, so offlineEntityPush.js's field allowlist lets it
// through same as any other field.
const deleteExpenseHead = async (req, res) => {
    try {
        const hotel_id = req.user;
        const { allId, id } = req.body;
        const ids = Array.isArray(allId) ? allId : (id != null ? [id] : []);
        if (!ids.length) return res.json(error("id is required", STATUSCODE.BAD_REQUEST));
        const found = await ExpenseHead.findAll({ where: { id: ids, hotel_id, deleted: false } });
        if (!found.length) return res.json(error("Expense head not found", STATUSCODE.BAD_REQUEST));
        await ExpenseHead.update({ deleted: true }, { where: { id: ids, hotel_id } });
        // Unfiltered on purpose - see getAllExpenseHead's own comment above.
        const expenseHeads = await ExpenseHead.findAll({ where: { hotel_id } });
        return res.json(success(MESSAGE.SUCCESS, { expenseHeads }, STATUSCODE.SUCCESS));
    } catch (err) {
        console.error("[expense] deleteExpenseHead error:", err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

const isCashOut = (isExpense, paymentMode) => !!isExpense && String(paymentMode ?? "").trim().toLowerCase() === "cash";

async function openCashSession(hotel_id, transaction) {
    return CashSession.findOne({
        where: { hotel_id, status: "Open", deleted: false },
        order: [["opened_at", "DESC"], ["id", "DESC"]],
        transaction,
    });
}

async function drawerBalance(cashSessionId, transaction) {
    return (await CashMovement.sum("amount", { where: { cashSessionId }, transaction })) || 0;
}

// Owner rule for Cash expenses (2026-09-22, option A): while the cash session
// that paid an expense is still OPEN, editing or deleting the expense
// corrects that session's drawer; once the session is CLOSED its cash count
// is final - the amount and payment mode can no longer change (the note,
// head and date still can). A Cash expense with no linked drawer movement
// (recorded before the link existed) is treated as closed.
const SUPPLIER_PAYMENT_MESSAGE =
    "This expense was recorded from a supplier payment on a purchase order. Change or delete that payment in Stock › Purchases.";

const CLOSED_SESSION_MESSAGE =
    "This cash expense belongs to a cash session that is already closed, so its amount and payment mode can't be changed and it can't be deleted. You can still edit the note, expense head or date.";

// The linked drawer movement, and whether its session is still open.
async function linkedMovement(entryId, hotel_id, transaction) {
    const movement = await CashMovement.findOne({ where: { expense_entry_id: entryId }, transaction });
    if (!movement) return { movement: null, open: false };
    const session = await CashSession.findOne({ where: { id: movement.cashSessionId, hotel_id }, transaction });
    return { movement, session, open: !!session && session.status === "Open" && !session.deleted };
}

const addExpense = async (req, res) => {
    try {
        const hotel_id = req.user;
        const { expense_head_id, amount, paymentMode, reason, addExpense: isExpense, date } = req.body;
        if (!(Number(expense_head_id) > 0) || !(Number(amount) > 0) || !paymentMode || !reason || typeof isExpense !== "boolean") {
            return res.json(error("expense_head_id, amount, paymentMode, reason and addExpense are required", STATUSCODE.BAD_REQUEST));
        }
        const hotel = await Hotel.findByPk(hotel_id);
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST));

        const setting = await RestaurantSetting.findOne({ where: { hotel_id } });
        const timeZone = setting?.timeZone || "Asia/Kolkata";
        const businessStartTime = setting?.business_day_start_time || "00:01:00";
        const dateObj = date ? new Date(date) : new Date();
        if (Number.isNaN(dateObj.getTime())) {
            return res.json(error("Invalid date", STATUSCODE.BAD_REQUEST));
        }
        // Staff can backdate a forgotten entry, but never postdate one -
        // enforced here too, not just as a client-side date-picker max,
        // since the client can't be trusted to actually apply it.
        if (isFutureDate(dateObj)) {
            return res.json(error("Expense date can't be in the future", STATUSCODE.BAD_REQUEST));
        }
        const business_date = getBusinessDate(timeZone, businessStartTime, dateObj);

        const head = await ExpenseHead.findOne({ where: { id: expense_head_id, hotel_id } });
        if (!head) return res.json(error("Expense head not found", STATUSCODE.BAD_REQUEST));

        // A CASH expense is money taken out of the drawer, so it has to go
        // through the open cash session - and the entry and the drawer
        // movement are saved together or not at all. The Web POS used to
        // save the entry first and add the drawer movement in a second call;
        // with no session open (or too little cash in the drawer) that
        // second call failed with "No cash session is open" AFTER the
        // expense had already been saved (owner report, 2026-09-22).
        const cashOut = isCashOut(isExpense, paymentMode);
        const amt = Number(amount);
        const failure = await sequelize.transaction(async (transaction) => {
            let session = null;
            if (cashOut) {
                session = await openCashSession(hotel_id, transaction);
                if (!session) return "No cash session is open. Open the cash session first to pay an expense in cash.";
                const balance = await drawerBalance(session.id, transaction);
                if (amt > balance) return `Not enough cash in the drawer: ₹${balance} available.`;
            }
            const entry = await ExpenseEntry.create({
                business_date, addExpense: isExpense, amount, paymentMode, reason,
                user_id: req.userId, hotel_id, expense_head_id, createdAt: dateObj,
            }, { transaction });
            if (session) {
                await CashMovement.create({
                    cashSessionId: session.id, hotelUserId: req.userId, type: "Expense", amount: -amt,
                    reason: `${head.expense_head_name} — ${reason}`, at: new Date(), expense_entry_id: entry.id,
                }, { transaction });
            }
            return null;
        });
        if (failure) return res.json(error(failure, STATUSCODE.BAD_REQUEST));
        return res.status(STATUSCODE.CREATED).json(success(MESSAGE.SUCCESS, { message: "Expense Entry Added", cashRecorded: cashOut }, STATUSCODE.CREATED));
    } catch (err) {
        console.error("[expense] addExpense error:", err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

// GET /expense/allEntry - real server-side pagination + filtering, not the
// old "return every row in the date range, every time" version. `page`/
// `limit` gate the ROWS returned; the four total* figures are always
// computed over the FULL filtered set (same where clause, no limit/
// offset) regardless of which page is being viewed, so they read
// correctly on page 1 same as page 5.
//
// `all=true` bypasses limit/offset entirely - returns every matching row
// in one call. This is for CSV export ONLY (billerpe-pos-pro-v2's own
// export button), not something the paginated list view ever sends -
// deliberately the SAME where clause as the normal paginated path (built
// once, reused for both the count/page query and the totals query) so an
// export can never drift from whatever filters are actually on screen.
const allEntry = async (req, res) => {
    try {
        const hotel_id = req.user;
        const { startDate, endDate, expense_head_id, paymentMode, user_id, all } = req.query;
        if (!startDate || !endDate) {
            return res.json(error("startDate and endDate are required", STATUSCODE.BAD_REQUEST));
        }
        const { businessStartDate, businessEndDate } = await getShiftedDateRange(startDate, endDate, hotel_id);
        const range = { [Op.between]: [businessStartDate, businessEndDate] };

        const where = { hotel_id, deleted: false, business_date: range };
        if (expense_head_id) where.expense_head_id = expense_head_id;
        if (paymentMode) where.paymentMode = paymentMode;
        if (user_id) where.user_id = user_id;

        const page = Math.max(1, Number(req.query.page) || 1);
        const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 20));
        const exportAll = all === "true" || all === "1";

        const { rows: entry, count: total } = await ExpenseEntry.findAndCountAll({
            where,
            include: [
                { model: ExpenseHead },
                { model: HotelUser, attributes: ["id", "name"] },
            ],
            order: [["createdAt", "DESC"]],
            ...(exportAll ? {} : { limit, offset: (page - 1) * limit }),
        });

        const totalExpense = (await ExpenseEntry.sum("amount", { where: { ...where, addExpense: true } })) || 0;
        const totalMoneyIn = (await ExpenseEntry.sum("amount", { where: { ...where, addExpense: false } })) || 0;
        const totalSale = (await Order.sum("grandAmount", { where: { hotel_id, payment: "success", deleted: false, business_date: range } })) || 0;
        const remainingAmount = (totalSale - totalExpense) + totalMoneyIn;

        return res.json(success(MESSAGE.SUCCESS, {
            entry,
            page,
            limit,
            total,
            totalPages: exportAll ? 1 : Math.max(1, Math.ceil(total / limit)),
            totalMoneyIn, totalExpense, totalSale, remainingAmount,
        }, STATUSCODE.SUCCESS));
    } catch (err) {
        console.error("[expense] allEntry error:", err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

const editExpense = async (req, res) => {
    try {
        const hotel_id = req.user;
        const { id, expense_head_id, amount, paymentMode, reason, addExpense: isExpense, date } = req.body;
        // Fixed: scoped to hotel_id (source used a bare findByPk here).
        const entry = await ExpenseEntry.findOne({ where: { id, hotel_id } });
        if (!entry) return res.json(error("Expense entry not found", STATUSCODE.BAD_REQUEST));
        if (entry.purchase_payment_id) return res.json(error(SUPPLIER_PAYMENT_MESSAGE, STATUSCODE.BAD_REQUEST));
        const head = await ExpenseHead.findOne({ where: { id: expense_head_id, hotel_id } });
        if (!head) return res.json(error("Expense head not found", STATUSCODE.BAD_REQUEST));

        const dateObj = date ? new Date(date) : new Date();
        if (Number.isNaN(dateObj.getTime())) {
            return res.json(error("Invalid date", STATUSCODE.BAD_REQUEST));
        }
        if (isFutureDate(dateObj)) {
            return res.json(error("Expense date can't be in the future", STATUSCODE.BAD_REQUEST));
        }
        // Fixed: recompute business_date to match the (possibly moved)
        // date, so this entry doesn't silently fall outside the date range
        // it now visually belongs to on the next allEntry report.
        const setting = await RestaurantSetting.findOne({ where: { hotel_id } });
        const timeZone = setting?.timeZone || "Asia/Kolkata";
        const businessStartTime = setting?.business_day_start_time || "00:01:00";
        const business_date = getBusinessDate(timeZone, businessStartTime, dateObj);

        const failure = await sequelize.transaction(async (transaction) => {
            const wasCash = isCashOut(entry.addExpense, entry.paymentMode);
            const nowCash = isCashOut(isExpense, paymentMode);
            const oldAmt = Number(entry.amount);
            const newAmt = Number(amount);
            const moneyChanged = wasCash !== nowCash || (wasCash && oldAmt !== newAmt);
            const label = `${head.expense_head_name} — ${reason}`;

            if (moneyChanged && wasCash) {
                const { movement, session, open } = await linkedMovement(entry.id, hotel_id, transaction);
                if (!open) return CLOSED_SESSION_MESSAGE;
                if (nowCash) {
                    // More cash out needs it to be in the drawer; this
                    // movement's own old amount counts as back in first.
                    const available = (await drawerBalance(session.id, transaction)) + oldAmt;
                    if (newAmt > available) return `Not enough cash in the drawer: ₹${available} available.`;
                    await movement.update({ amount: -newAmt, reason: label }, { transaction });
                } else {
                    // No longer paid in cash: the money goes back into the
                    // drawer. Set to 0, not deleted - a deleted row never
                    // reaches the cloud's copy of the session.
                    await movement.update({ amount: 0, reason: `${label} (changed to ${paymentMode})` }, { transaction });
                }
            } else if (moneyChanged && nowCash) {
                // Switched TO cash: taken out of the open session now.
                const session = await openCashSession(hotel_id, transaction);
                if (!session) return "No cash session is open. Open the cash session first to pay an expense in cash.";
                const balance = await drawerBalance(session.id, transaction);
                if (newAmt > balance) return `Not enough cash in the drawer: ₹${balance} available.`;
                const existing = await CashMovement.findOne({ where: { expense_entry_id: entry.id, cashSessionId: session.id }, transaction });
                if (existing) await existing.update({ amount: -newAmt, reason: label }, { transaction });
                else {
                    await CashMovement.create({
                        cashSessionId: session.id, hotelUserId: req.userId, type: "Expense", amount: -newAmt,
                        reason: label, at: new Date(), expense_entry_id: entry.id,
                    }, { transaction });
                }
            } else if (wasCash) {
                // Same cash amount: keep the drawer line's description in step.
                const { movement, open } = await linkedMovement(entry.id, hotel_id, transaction);
                if (movement && open) await movement.update({ reason: label }, { transaction });
            }

            await entry.update({ addExpense: isExpense, amount, paymentMode, reason, expense_head_id, createdAt: dateObj, business_date }, { transaction });
            return null;
        });
        if (failure) return res.json(error(failure, STATUSCODE.BAD_REQUEST));
        return res.json(success(MESSAGE.SUCCESS, { message: "Expense Entry Updated" }, STATUSCODE.SUCCESS));
    } catch (err) {
        console.error("[expense] editExpense error:", err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

const deleteExpense = async (req, res) => {
    try {
        const hotel_id = req.user;
        const { id } = req.body;
        // Fixed: scoped to hotel_id (source used a bare findByPk here).
        const entry = await ExpenseEntry.findOne({ where: { id, hotel_id } });
        if (!entry) return res.json(error("Expense entry not found", STATUSCODE.BAD_REQUEST));
        if (entry.purchase_payment_id && !entry.deleted) return res.json(error(SUPPLIER_PAYMENT_MESSAGE, STATUSCODE.BAD_REQUEST));
        const failure = await sequelize.transaction(async (transaction) => {
            if (isCashOut(entry.addExpense, entry.paymentMode) && !entry.deleted) {
                const { movement, open } = await linkedMovement(entry.id, hotel_id, transaction);
                if (!open) return CLOSED_SESSION_MESSAGE;
                // The cash goes back into the still-open drawer.
                await movement.update({ amount: 0, reason: `${movement.reason} (expense deleted)` }, { transaction });
            }
            await entry.update({ deleted: true }, { transaction });
            return null;
        });
        if (failure) return res.json(error(failure, STATUSCODE.BAD_REQUEST));
        return res.json(success(MESSAGE.SUCCESS, { message: "Expense Entry Deleted" }, STATUSCODE.SUCCESS));
    } catch (err) {
        console.error("[expense] deleteExpense error:", err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

module.exports = { addExpenseHead, getAllExpenseHead, editExpenseHead, deleteExpenseHead, addExpense, allEntry, editExpense, deleteExpense };
