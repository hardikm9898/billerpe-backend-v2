// Dues collected on an outlet's server, and which day they count on (owner
// report 2026-10-03: dashboard and closing WhatsApp disagreed for hotels 2,
// 3 and 6; owner decision: a due counts on the day it was COLLECTED).
//
//   1. a due receipt pushed as entity "dueReceipts" lands in
//      hms_due_payment_receives, customer taken from its bill, an unknown
//      staff id dropped; a repeat push does not duplicate it
//   2. a receipt for a bill the cloud does not have yet is retryable
//   3. the bill's own day keeps the cash / due it was settled with, although
//      the collection added the money to the bill (as settleDue does)
//   4. the collection day shows it as "Due received"
//   5. the closing summary gives the same figures as the dashboard
//   6. a refund-due paid out (negative receipt) only restores the due
//
// Works on throwaway rows on an existing hotel, on two business dates far in
// the past that hold no other bills of that hotel; removed before exit.
// Applies migration 20261003100000 to this database first (idempotent):
//   node tests/sync/verify-due-receipts.js
require("dotenv").config();
const assert = require("assert");
const express = require("express");
const jwt = require("jsonwebtoken");
const { Sequelize } = require("sequelize");

const sequelize = require("../../connection/connect");
const { LocalServerRegistration, DuePaymentReceive, Order, User } = require("../../model");
const syncRoutes = require("../../routes/sync");
const { salesDashBoardData } = require("../../controller/dashBoard");
const { getSalesSummaryMetrics } = require("../../controller/smsService");
const migration = require("../../migrations/20261003100000-due-receipt-local-id");

const PORT = Number(process.env.SYNC_TEST_PORT) || 4899;
const BASE = `http://127.0.0.1:${PORT}`;
const BILL_DAY = "2001-01-10";
const PAID_DAY = "2001-01-12";
const ok = (label, extra = "") => console.log(`  ok  ${label}${extra ? " - " + extra : ""}`);
const created = { orders: [], receipts: [], userId: null };

function call(controller, user, body) {
    return new Promise((resolve, reject) => {
        const res = {
            status() { return res; },
            json(payload) { resolve(payload); return res; },
        };
        Promise.resolve(controller({ user, body }, res)).catch(reject);
    });
}

async function cleanup() {
    try {
        if (created.receipts.length) await DuePaymentReceive.destroy({ where: { id: created.receipts } });
        if (created.orders.length) await Order.destroy({ where: { id: created.orders } });
        if (created.userId) await User.destroy({ where: { id: created.userId } });
    } catch (err) {
        console.error("cleanup failed:", err.message);
    }
}

async function main() {
    await sequelize.authenticate();
    await migration.up(sequelize.getQueryInterface(), Sequelize);
    const registration = await LocalServerRegistration.findOne({ where: { status: "active" }, order: [["id", "ASC"]] });
    assert(registration, "no active local-server registration to borrow - register a device first");
    const hotelId = registration.hotel_id;
    const busy = await Order.count({ where: { hotel_id: hotelId, business_date: [BILL_DAY, PAID_DAY] } });
    assert.strictEqual(busy, 0, `hotel ${hotelId} already has bills on ${BILL_DAY}/${PAID_DAY}`);
    console.log(`using hotel ${hotelId}`);

    const deviceToken = jwt.sign(
        { typ: "local-server", hotel_id: hotelId, device_id: registration.device_id, installation_id: registration.installation_id },
        process.env.JWT_SECRET_KEY_ADMIN,
    );
    const app = express();
    app.use(express.json({ limit: "10mb" }));
    app.use("/sync", syncRoutes);
    const server = await new Promise((resolve) => { const s = app.listen(PORT, () => resolve(s)); });
    const pushReceipts = (rows) => fetch(`${BASE}/sync/push`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${deviceToken}` },
        body: JSON.stringify({ entity: "dueReceipts", fkIds: "cloud", rows }),
    }).then((r) => r.json());

    const customer = await User.create({ hotel_id: hotelId, name: "ZZ due test", number: "" });
    created.userId = customer.id;
    // A Rs 1000 bill settled 600 cash + 400 due on BILL_DAY, and a cash
    // bill of Rs 200 the same day.
    const bill = await Order.create({
        hotel_id: hotelId, order_type: "pickup", bill_no: "ZZDUE1", status: "success", payment: "success",
        deleted: false, business_date: BILL_DAY, grandAmount: 1000, cash: 600, upi: 0, card: 0, due: 400, UserId: customer.id,
    });
    const other = await Order.create({
        hotel_id: hotelId, order_type: "pickup", bill_no: "ZZDUE2", status: "success", payment: "success",
        deleted: false, business_date: BILL_DAY, grandAmount: 200, cash: 0, upi: 200, card: 0, due: 0,
    });
    created.orders.push(bill.id, other.id);

    const dayFigures = async (day) => (await call(salesDashBoardData, hotelId, { start: day, end: day })).results.reportTotalAmounts;
    const atClose = await dayFigures(BILL_DAY);
    assert.deepStrictEqual(
        [atClose.totalCashPayment, atClose.totalUpiPayment, atClose.totalDuePayment, atClose.totalSale],
        [600, 200, 400, 1200], `figures at close: ${JSON.stringify(atClose)}`,
    );

    // ---- 1. the outlet collects the due on PAID_DAY ------------------------
    // What the exe's settleDue does to the bill, pushed with the order:
    await bill.update({ cash: 1000, due: 0 });
    const localId = 900000000 + Math.floor(Math.random() * 1000000);
    const receipt = { local_id: localId, order_id: bill.id, amount: 400, payment_mode: "cash", business_date: PAID_DAY, bill_no: "ZZDUE1", settle_by: 987654321, deleted: false };
    const first = await pushReceipts([receipt]);
    assert(first.results?.accepted === 1, `push refused: ${JSON.stringify(first)}`);
    const again = await pushReceipts([receipt]);
    assert(again.results?.accepted === 1, `repeat push refused: ${JSON.stringify(again)}`);
    const rows = await DuePaymentReceive.findAll({ where: { hotel_id: hotelId, local_id: localId }, raw: true });
    created.receipts.push(...rows.map((r) => r.id));
    assert.strictEqual(rows.length, 1, "one row however often it is pushed");
    assert.strictEqual(rows[0].user_id, customer.id, "customer taken from the bill");
    assert.strictEqual(rows[0].settle_by, null, "an unknown staff id is dropped, not refused");
    assert.strictEqual(rows[0].business_date, PAID_DAY);
    ok("a pushed due receipt lands once, with the bill's customer");

    // ---- 2. bill not here yet ----------------------------------------------
    const early = await pushReceipts([{ ...receipt, local_id: localId + 1, order_id: 2147483000 }]);
    const r = early.results?.results?.[0];
    assert(r && !r.ok && r.retryable, `a receipt before its bill must wait: ${JSON.stringify(early)}`);
    ok("a receipt for a bill not synced yet waits (retryable)", r.message);

    // ---- 3. the bill's day is unchanged -------------------------------------
    const billDay = await dayFigures(BILL_DAY);
    assert.deepStrictEqual(
        [billDay.totalCashPayment, billDay.totalUpiPayment, billDay.totalDuePayment, billDay.totalSale, billDay.totalDueReceived],
        [600, 200, 400, 1200, 0], `bill's day after the collection: ${JSON.stringify(billDay)}`,
    );
    ok("the bill's own day still shows 600 cash / 400 due after the due is paid");

    // ---- 4. the collection day ----------------------------------------------
    const paidDay = await dayFigures(PAID_DAY);
    assert.strictEqual(paidDay.totalDueReceived, 400, `collection day: ${JSON.stringify(paidDay)}`);
    assert.strictEqual(paidDay.totalSale || 0, 0, "no sale on the collection day");
    ok("the collection day shows Rs 400 due received");

    // ---- 5. closing summary = dashboard -------------------------------------
    const summary = await getSalesSummaryMetrics(hotelId, BILL_DAY);
    assert.deepStrictEqual(
        [summary.totalCashPayment, summary.totalUpiPayment, summary.totalDuePayment, summary.totalSale, summary.totalInvoice],
        [600, 200, 400, 1200, 2], `summary: ${JSON.stringify(summary)}`,
    );
    const paidSummary = await getSalesSummaryMetrics(hotelId, PAID_DAY);
    assert.strictEqual(paidSummary.totalSettleDuePayment, 400, "summary's due received");
    ok("the closing summary matches the dashboard on both days");

    // ---- 6. refund-due paid out ---------------------------------------------
    // An edited bill left Rs 50 to give back (due -50); paying it out sets
    // the due to 0 and records -50 without touching the cash.
    await other.update({ due: 0 });
    const refund = await DuePaymentReceive.create({
        hotel_id: hotelId, order_id: other.id, amount: -50, payment_mode: "cash", business_date: PAID_DAY, bill_no: "ZZDUE2",
    });
    created.receipts.push(refund.id);
    const afterRefund = await dayFigures(BILL_DAY);
    assert.deepStrictEqual(
        [afterRefund.totalCashPayment, afterRefund.totalUpiPayment, afterRefund.totalDuePayment],
        [600, 200, 350], `after a refund-due: ${JSON.stringify(afterRefund)}`,
    );
    ok("a refund-due paid out restores only the due (400 - 50), cash untouched");

    server.close();
    await cleanup();
    console.log("\nALL DUE RECEIPT CHECKS PASSED");
    process.exit(0);
}

main().catch(async (err) => {
    console.error("\nFAILED:", err);
    await cleanup();
    process.exit(1);
});
