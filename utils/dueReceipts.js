const sequelize = require("sequelize");
const DuePaymentReceive = require("../model/duePayment");
const Order = require("../model/order");

// Due money counts on the day it was COLLECTED (owner decision 2026-10-03).
//
// Collecting a due adds the money to the old bill's own cash / upi / card and
// lowers its due (controller/order.js#settleDue - the exe does the same and
// pushes the bill), and records a DuePaymentReceive row on the collection
// day. Read straight off the bills, a day's cash and due therefore changed
// whenever one of its dues was paid later, so its dashboard no longer matched
// the WhatsApp summary sent at closing. These helpers take the receipts back
// out of the bills' day, and give the collection day its "Due received".

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// What later due payments added to the bills matched by `orderWhere` (an
// Order where clause - the same one the day's figures use):
//   { cash, upi, card, other, due }
// cash/upi/card/other: positive receipts in that mode, to subtract from the
// bills' own columns. due: every receipt, to add back to the bills' due. A
// negative receipt is a refund-due paid out (editSettledOrder.js#
// settleRefundDue): it only cleared a negative due, the cash was untouched.
async function laterDuePaymentsOnBills(hotelId, orderWhere) {
    // Qualified: the join brings in the bill's columns too.
    const amount = `\`${DuePaymentReceive.name}\`.\`amount\``;
    const rows = await DuePaymentReceive.findAll({
        where: { hotel_id: hotelId, deleted: false },
        include: [{ model: Order, attributes: [], required: true, where: orderWhere }],
        attributes: [
            "payment_mode",
            [sequelize.literal(`${amount} > 0`), "positive"],
            [sequelize.fn("sum", sequelize.literal(amount)), "total"],
        ],
        group: ["payment_mode", sequelize.literal(`${amount} > 0`)],
        raw: true,
    });
    const out = { cash: 0, upi: 0, card: 0, other: 0, due: 0 };
    for (const row of rows) {
        const total = Number(row.total) || 0;
        out.due += total;
        if (!Number(row.positive)) continue;
        const mode = String(row.payment_mode || "").toLowerCase();
        if (mode === "cash" || mode === "upi" || mode === "card") out[mode] += total;
        else out.other += total;
    }
    for (const k of Object.keys(out)) out[k] = r2(out[k]);
    return out;
}

// Due money collected on these business dates (any bill's), the "Due
// received" figure.
async function dueReceivedOn(hotelId, businessDates) {
    return r2(await DuePaymentReceive.sum("amount", {
        where: { hotel_id: hotelId, deleted: false, business_date: businessDates },
    }));
}

// The bills' own payment figures as they stood when each bill was settled.
function asBilled(figures, later) {
    return {
        cash: r2((Number(figures.cash) || 0) - later.cash),
        upi: r2((Number(figures.upi) || 0) - later.upi),
        card: r2((Number(figures.card) || 0) - later.card),
        due: r2((Number(figures.due) || 0) + later.due),
    };
}

module.exports = { laterDuePaymentsOnBills, dueReceivedOn, asBilled };
