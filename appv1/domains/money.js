const M = require("../../model");
const { fail, need, r2, audit } = require("../core");
const { callController } = require("../legacy");
const cashCtl = require("../exe/controller/cashSession");
const expenseCtl = require("../exe/controller/expense");
const { modeName } = require("../modes");

// Cash drawer and expenses for POS App outlets, through the exe's own
// controllers (appv1/exe) so both plans keep the same money rules: signed
// drawer movements, a cash expense needs an open session with enough cash,
// a closed session's cash is final, supplier-payment expenses are changed
// from the purchase.

/* ------------------------------ cash session ------------------------------ */

async function openCash(c, openingFloat) {
    need(c, "cash-session", "create");
    if (!(Number(openingFloat) >= 0)) fail("Enter the opening float");
    await callController(cashCtl.openCashSession, c, { body: { opening_float: Number(openingFloat) } });
    await audit(c, "Cash session", `Opened with ₹${openingFloat}`);
}

async function cashMovement(c, kind, amount, reason) {
    need(c, "cash-session", "edit");
    if (!String(reason || "").trim()) fail("Add a reason");
    await callController(cashCtl.addCashMovement, c, { body: { type: kind === "out" ? "Withdraw" : "Add", amount: Number(amount), reason: String(reason).trim() } });
    await audit(c, "Cash session", `Cash ${kind} ₹${amount} — ${String(reason).trim()}`);
}

/** Close with the counted notes; a difference needs a reason (app rule). */
async function closeCash(c, denominations, varianceReason) {
    need(c, "cash-session", "edit");
    const open = await M.CashSession.findOne({ where: { hotel_id: c.hotelId, status: "Open", deleted: false }, order: [["opened_at", "DESC"], ["id", "DESC"]] });
    if (!open) fail("No cash session is open");
    const counted = r2(Object.entries(denominations || {}).reduce((s, [d, n]) => s + Number(d) * (Number(n) || 0), 0));
    const expected = r2((await M.CashMovement.sum("amount", { where: { cashSessionId: open.id } })) || 0);
    if (Math.abs(counted - expected) > 0.009 && !String(varianceReason || "").trim()) fail("The count does not match. Add a reason for the difference.");
    await callController(cashCtl.closeCashSession, c, { body: { counted_cash: counted, variance_reason: String(varianceReason || "").trim() || null } });
    await audit(c, "Cash session", `Closed · counted ₹${counted} · expected ₹${expected}`);
    const { cashView } = require("../load");
    const staff = await M.HotelUser.findAll({ where: { hotel_id: c.hotelId }, attributes: ["id", "name"], raw: true });
    const { cashHistory } = await cashView(c.hotelId, new Map(staff.map((x) => [x.id, x.name])));
    return { session: cashHistory.find((x) => x.id === String(open.id)) };
}

/* ------------------------------ expenses ------------------------------ */

async function saveExpenseHead(c, h) {
    need(c, "expense", h.id ? "edit" : "create");
    const name = String(h.name || "").trim();
    if (!name) fail("Name is required");
    if (h.id) {
        const row = await M.ExpenseHead.findOne({ where: { id: Number(h.id) || 0, hotel_id: c.hotelId } });
        if (!row) fail("Expense head not found");
        if (row.expense_head_name === "Supplier payment") fail("This head is used for supplier payments and cannot be changed");
        await callController(expenseCtl.editExpenseHead, c, { body: { id: row.id, expense_head_name: name } });
        if (h.active === false) await callController(expenseCtl.deleteExpenseHead, c, { body: { id: row.id } });
    } else {
        await callController(expenseCtl.addExpenseHead, c, { body: { expense_head_name: name } });
    }
}

async function expenseBody(c, e) {
    if (!(Number(e.amount) > 0)) fail("Enter an amount");
    const head = await M.ExpenseHead.findOne({ where: { id: Number(e.headId) || 0, hotel_id: c.hotelId } });
    if (!head) fail("Pick an expense head");
    if (head.expense_head_name === "Supplier payment") fail("Supplier payments are recorded from the purchase, not here");
    const paymentMode = await modeName(c, e.modeId);
    // "Take from the cash drawer" = the exe's addExpense flag (cash only).
    return { expense_head_id: head.id, amount: Number(e.amount), paymentMode, reason: String(e.note || "").trim() || head.expense_head_name, addExpense: paymentMode === "Cash" ? e.fromDrawer !== false : false };
}

async function saveExpense(c, e) {
    need(c, "expense", e.id ? "edit" : "create");
    const body = await expenseBody(c, e);
    if (e.id) {
        const row = await M.ExpenseEntry.findOne({ where: { id: Number(e.id) || 0, hotel_id: c.hotelId } });
        if (!row) fail("Expense not found");
        if (row.purchase_payment_id) fail("This was recorded from a supplier payment — change it there");
        await callController(expenseCtl.editExpense, c, { body: { ...body, id: row.id, date: row.createdAt } });
    } else {
        await callController(expenseCtl.addExpense, c, { body });
    }
    await audit(c, "Expenses", `${e.id ? "Edited" : "Added"} ₹${e.amount}`);
}

async function deleteExpense(c, id) {
    need(c, "expense", "delete");
    await callController(expenseCtl.deleteExpense, c, { body: { id: Number(id) || 0 } });
    await audit(c, "Expenses", "Deleted an expense");
}

// The exe controllers run their own transactions (as on the exe).
module.exports = {
    openCash: { fn: openCash },
    cashMovement: { fn: cashMovement },
    closeCash: { fn: closeCash },
    saveExpenseHead: { fn: saveExpenseHead },
    saveExpense: { fn: saveExpense },
    deleteExpense: { fn: deleteExpense },
};
