const { Op } = require("sequelize");
const { sequelize, Hotel, CsOutletSetup, BilInvoice, BilPayment, CsAccountOutlet } = require("../../model");
const { RuleError } = require("../../appv1/core");
const { need } = require("../auth");
const audit = require("../audit");
const { notify } = require("../crm/notify");
const { addActivity, txt, moment, TZ } = require("./common");

// The unpaid freeze (owner 2026-10-09, new outlets only): an outlet set up
// with a token must be paid in full within 15 days of creation, else it is
// frozen - every app and the outlet PC lock with "your payment is pending,
// pay to start your outlet". A rejected token freezes it at once. Paying the
// first invoice in full lifts it; an approver can lift it for a few days.
// The lock travels through the plan state (renewals.planState), so even an
// outlet PC on exe 1.1.7 locks (it locks at the date it is given).

const money = (n) => `Rs ${Math.round(Number(n) || 0).toLocaleString("en-IN")}`;

/** The freeze of one outlet right now (null = not an outlet set up with the 15-day rule). */
async function state(hotelId, t) {
    const r = await CsOutletSetup.findOne({ where: { hotel_id: Number(hotelId) || 0, status: "done" }, attributes: ["id", "invoice_id", "pay_by", "frozen_at"], raw: true, transaction: t });
    if (!r || !r.invoice_id) return null;
    const inv = await BilInvoice.findOne({ where: { id: r.invoice_id }, attributes: ["id", "number", "total", "paid", "status"], raw: true, transaction: t });
    if (!inv) return null;
    const due = Math.max(0, Math.round((Number(inv.total) - Number(inv.paid)) * 100) / 100);
    return { setupId: r.id, frozen: !!r.frozen_at && inv.status !== "paid", since: r.frozen_at, payBy: r.pay_by, invoiceId: inv.id, invoice: inv.number, total: Number(inv.total), paid: Number(inv.paid), due };
}

/** Cheap check for the request guards (POS App, Owner App). */
async function isFrozen(hotelId) {
    return !!(await CsOutletSetup.findOne({ where: { hotel_id: Number(hotelId) || 0, status: "done", frozen_at: { [Op.ne]: null } }, attributes: ["id"], raw: true }));
}

async function freezeIn(row, why, t, actorId = null) {
    await row.update({ frozen_at: new Date() }, { transaction: t });
    const link = await CsAccountOutlet.findOne({ where: { hotel_id: row.hotel_id }, attributes: ["account_id"], raw: true, transaction: t });
    const hotel = await Hotel.findOne({ where: { id: row.hotel_id }, attributes: ["hotel_name"], raw: true, transaction: t });
    if (link) await addActivity(link.account_id, row.hotel_id, "invoice", actorId, `Outlet frozen: ${why}. It opens again when the invoice is paid in full.`, { setupId: row.id }, t);
    const tell = [...new Set([row.created_by].filter(Boolean))];
    const acc = link ? await require("../../model").CsAccount.findOne({ where: { id: link.account_id }, attributes: ["success_owner_id"], raw: true, transaction: t }) : null;
    if (acc && acc.success_owner_id) tell.push(acc.success_owner_id);
    for (const id of [...new Set(tell)]) {
        await notify(id, { type: "setup.frozen", title: `Frozen: ${hotel ? hotel.hotel_name : `outlet #${row.hotel_id}`}`, body: why, link: `/outlets?sel=${row.hotel_id}`, ref: `frozen:${row.id}:${Date.now()}` }, { transaction: t });
    }
}

/** The job: outlets past their 15 days with the first invoice not paid in full. */
async function run(now = new Date()) {
    const due = await CsOutletSetup.findAll({ where: { status: "done", frozen_at: null, pay_by: { [Op.lt]: now }, invoice_id: { [Op.ne]: null } }, limit: 200 });
    let frozen = 0;
    for (const row0 of due) {
        await sequelize.transaction(async (t) => {
            const row = await CsOutletSetup.findOne({ where: { id: row0.id, frozen_at: null }, transaction: t, lock: t.LOCK.UPDATE });
            if (!row) return;
            const inv = await BilInvoice.findOne({ where: { id: row.invoice_id }, attributes: ["number", "total", "paid", "status"], raw: true, transaction: t });
            if (!inv || inv.status === "paid" || inv.status === "cancelled") return;
            await freezeIn(row, `${money(Number(inv.total) - Number(inv.paid))} of invoice ${inv.number} not paid within 15 days`, t);
            frozen += 1;
        });
    }
    return frozen;
}

/** A rejected token (outlet setup) freezes the outlet at once. */
async function onTokenRejected(paymentId, t) {
    const row = await CsOutletSetup.findOne({ where: { token_payment_id: Number(paymentId) || 0, status: "done", frozen_at: null }, transaction: t, lock: t.LOCK.UPDATE });
    if (!row) return false;
    const inv = await BilInvoice.findOne({ where: { id: row.invoice_id }, attributes: ["status"], raw: true, transaction: t });
    if (inv && inv.status === "paid") return false;
    await freezeIn(row, "the token payment was rejected", t);
    return true;
}

/** The first invoice paid in full: the freeze (if any) is lifted. */
async function onPaid(invoiceId, t) {
    const row = await CsOutletSetup.findOne({ where: { invoice_id: Number(invoiceId) || 0 }, transaction: t, lock: t.LOCK.UPDATE });
    if (!row) return false;
    const was = !!row.frozen_at;
    await row.update({ frozen_at: null }, { transaction: t });
    if (was) {
        const link = await CsAccountOutlet.findOne({ where: { hotel_id: row.hotel_id }, attributes: ["account_id"], raw: true, transaction: t });
        if (link) await addActivity(link.account_id, row.hotel_id, "invoice", null, "Freeze lifted: the invoice is paid in full", { setupId: row.id }, t);
    }
    return was;
}

/** An approver gives a frozen (or soon due) outlet a few more days, with a reason. */
async function lift(s, hotelId, days, reason) {
    need(s, "billing.approve");
    const n = Number(days);
    if (!Number.isInteger(n) || n < 1 || n > 30) throw new RuleError("Give 1 to 30 more days.");
    const why = txt(reason, 200);
    if (why.length < 5) throw new RuleError("Write why the outlet gets more time.");
    return sequelize.transaction(async (t) => {
        const row = await CsOutletSetup.findOne({ where: { hotel_id: Number(hotelId) || 0, status: "done" }, transaction: t, lock: t.LOCK.UPDATE });
        if (!row || !row.invoice_id) throw new RuleError("This outlet has no 15-day payment rule.");
        const payBy = moment().tz(TZ).add(n, "days").endOf("day").toDate();
        await row.update({ frozen_at: null, pay_by: payBy }, { transaction: t });
        const link = await CsAccountOutlet.findOne({ where: { hotel_id: row.hotel_id }, attributes: ["account_id"], raw: true, transaction: t });
        if (link) await addActivity(link.account_id, row.hotel_id, "invoice", s.user.id, `${s.user.name} gave ${n} more day${n === 1 ? "" : "s"} to pay (${why})`, { setupId: row.id }, t);
        await audit.write(s, { action: "setup.more_time", entity: "cs_outlet_setup", entityId: row.id, summary: `${n} more days to pay for outlet #${row.hotel_id}`, after: { payBy }, reason: why }, { transaction: t });
        return { payBy };
    });
}

const worker = require("../../services/admin/worker");
worker.registerJob("cs.unpaid", () => run());
worker.registerSchedule("cs.unpaid", 300);

module.exports = { state, isFrozen, run, onTokenRejected, onPaid, lift };
