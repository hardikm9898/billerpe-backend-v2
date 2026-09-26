// COPY of billerpe-local-exe/services/supplierPayments.js for the POS App (Plan 2) -
// written by scripts/vendor-exe-for-appv1.py. Do not edit here: change the
// exe's file and re-run the script, so both plans keep the same rules.

const {
    PurchaseOrder, PurchaseOrderPayment, Supplier, ExpenseHead, ExpenseEntry,
    CashSession, CashMovement, RestaurantSetting,
} = require("../model");
const { getBusinessDate } = require("../utils/dateUtils");

// Supplier payments on a purchase order (owner decisions, 2026-09-25):
//  - each payment has a mode (the outlet's own modes + Cheque / Bank
//    transfer), a date and an optional reference no.;
//  - with the setting "Record supplier payments as expenses" (default ON)
//    each payment is also an expense under an auto-created "Supplier
//    payment" head, and deleting the payment deletes that expense;
//  - a Cash payment made while a cash session is open takes the cash out
//    of the drawer (unless the payer says it wasn't paid from the drawer).
// A cash payment whose drawer session is already closed can't be deleted -
// the same rule as a cash expense (controller/expense.js).

const HEAD_NAME = "Supplier payment";
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const fail = (message) => Object.assign(new Error(message), { status: 400 });
const inr = (n) => `₹${r2(n).toLocaleString("en-IN")}`;
const isCash = (mode) => String(mode ?? "").trim().toLowerCase() === "cash";

// Old rows hold the enum values the column used to allow.
const LEGACY_MODE = { cash: "Cash", card: "Card", cheque: "Cheque", online: "Online", other: "Other" };
const modeLabel = (mode) => LEGACY_MODE[mode] ?? mode;

async function paidSoFar(purchaseOrderId, t) {
    return r2(await PurchaseOrderPayment.sum("amount", { where: { purchaseOrderId, deleted_status: false }, transaction: t }));
}

// paid / partial / unpaid, kept in step with the payments.
async function refreshPaymentType(po, t) {
    const paid = await paidSoFar(po.id, t);
    const grand = r2(po.grandAmount);
    const payment_type = paid <= 0 ? "unpaid" : paid + 0.005 >= grand ? "paid" : "partial";
    if (po.payment_type !== payment_type) await po.update({ payment_type }, { transaction: t });
    return paid;
}

async function supplierExpenseHead(hotel_id, t) {
    const heads = await ExpenseHead.findAll({ where: { hotel_id, deleted: false }, transaction: t });
    const found = heads.find((h) => String(h.expense_head_name).trim().toLowerCase() === HEAD_NAME.toLowerCase());
    return found || ExpenseHead.create({ hotel_id, expense_head_name: HEAD_NAME }, { transaction: t });
}

async function openCashSession(hotel_id, t) {
    return CashSession.findOne({
        where: { hotel_id, status: "Open", deleted: false },
        order: [["opened_at", "DESC"], ["id", "DESC"]],
        transaction: t,
    });
}

// "2026-09-25" -> a Date on that day (now, when it is today). Not in the future.
function paymentDateObj(date) {
    if (!date) return new Date();
    const s = String(date);
    let d;
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
        const now = new Date();
        const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
        d = s === today ? now : new Date(`${s}T12:00:00`);
    } else d = new Date(s);
    if (Number.isNaN(d.getTime())) throw fail("Invalid payment date");
    if (d.getTime() > Date.now() + 60 * 1000) throw fail("Payment date can't be in the future");
    return d;
}

async function recordSupplierPayment({ hotel_id, userId, po, amount, mode, date, ref, fromDrawer }, t) {
    const amt = r2(amount);
    const payment_mode = String(mode ?? "").trim();
    if (!(amt > 0)) throw fail("Enter a payment amount more than ₹0");
    if (!payment_mode) throw fail("Choose how the supplier was paid");
    const due = r2(r2(po.grandAmount) - (await paidSoFar(po.id, t)));
    if (amt > due + 0.005) throw fail(due > 0 ? `Only ${inr(due)} is due on PO #${po.Po_no}` : `PO #${po.Po_no} is already fully paid`);
    const when = paymentDateObj(date);
    const payment_ref_no = String(ref ?? "").trim().slice(0, 100);

    // Cash out of the drawer, checked before anything is written.
    let session = null;
    if (isCash(payment_mode) && fromDrawer !== false) {
        session = await openCashSession(hotel_id, t);
        if (session) {
            const balance = r2(await CashMovement.sum("amount", { where: { cashSessionId: session.id }, transaction: t }));
            if (amt > balance) {
                throw fail(`Not enough cash in the drawer: ${inr(balance)} available. If you paid from somewhere else, untick "Take from cash drawer".`);
            }
        }
    }

    const payment = await PurchaseOrderPayment.create({
        purchaseOrderId: po.id, hotel_id, userId, amount: amt, payment_mode, payment_ref_no,
        date: when, paymentDate: when,
    }, { transaction: t });

    const setting = await RestaurantSetting.findOne({ where: { hotel_id }, transaction: t });
    const supplier = po.supplier_id ? await Supplier.findOne({ where: { id: po.supplier_id }, transaction: t }) : null;
    const what = `PO #${po.Po_no}${supplier ? ` · ${supplier.name}` : ""}`;
    let entry = null;
    if (setting?.supplier_payment_expense !== false) {
        const head = await supplierExpenseHead(hotel_id, t);
        entry = await ExpenseEntry.create({
            hotel_id, expense_head_id: head.id, user_id: userId, amount: String(amt),
            reason: `${what}${payment_ref_no ? ` · Ref ${payment_ref_no}` : ""}`,
            paymentMode: payment_mode, addExpense: true,
            business_date: getBusinessDate(setting?.timeZone || "Asia/Kolkata", setting?.business_day_start_time || "00:01:00", when),
            createdAt: when, purchase_payment_id: payment.id,
        }, { transaction: t });
        await payment.update({ expense_entry_id: entry.id }, { transaction: t });
    }
    if (session) {
        await CashMovement.create({
            cashSessionId: session.id, hotelUserId: userId, type: "Expense", amount: -amt,
            reason: `${HEAD_NAME} — ${what}`, at: new Date(),
            expense_entry_id: entry?.id ?? null, purchase_payment_id: payment.id,
        }, { transaction: t });
    }
    await refreshPaymentType(po, t);
    return { payment, expense: entry, fromDrawer: !!session };
}

const CLOSED_SESSION = "This payment was paid in cash from a cash session that is already closed, so it can't be deleted.";

// Undoes one payment: its expense and (while that session is open) its
// drawer cash.
async function removeSupplierPayment(payment, hotel_id, t, closedMessage = CLOSED_SESSION) {
    if (payment.deleted_status) return;
    const movement = await CashMovement.findOne({ where: { purchase_payment_id: payment.id }, transaction: t });
    if (movement && Number(movement.amount) !== 0) {
        const session = await CashSession.findOne({ where: { id: movement.cashSessionId, hotel_id }, transaction: t });
        if (!session || session.status !== "Open" || session.deleted) throw fail(closedMessage);
        await movement.update({ amount: 0, reason: `${movement.reason} (payment deleted)` }, { transaction: t });
    }
    const entries = await ExpenseEntry.findAll({
        where: { hotel_id, deleted: false, purchase_payment_id: payment.id }, transaction: t,
    });
    for (const e of entries) await e.update({ deleted: true }, { transaction: t });
    await payment.update({ deleted_status: true }, { transaction: t });
}

async function deleteSupplierPayment({ hotel_id, paymentId }, t) {
    const payment = await PurchaseOrderPayment.findOne({ where: { id: paymentId, hotel_id, deleted_status: false }, transaction: t });
    if (!payment) throw fail("Payment not found");
    const po = await PurchaseOrder.findOne({ where: { id: payment.purchaseOrderId, hotel_id }, transaction: t });
    await removeSupplierPayment(payment, hotel_id, t);
    if (po) await refreshPaymentType(po, t);
}

// Every payment of a PO that is being deleted.
async function removeAllPayments(po, hotel_id, t) {
    const payments = await PurchaseOrderPayment.findAll({ where: { purchaseOrderId: po.id, hotel_id, deleted_status: false }, transaction: t });
    for (const p of payments) {
        await removeSupplierPayment(p, hotel_id, t, `PO #${po.Po_no} can't be deleted: its ${inr(p.amount)} cash payment came from a cash session that is already closed. Edit the PO instead.`);
    }
}

module.exports = {
    HEAD_NAME, recordSupplierPayment, deleteSupplierPayment, removeAllPayments,
    refreshPaymentType, paidSoFar, modeLabel, isCash,
};
