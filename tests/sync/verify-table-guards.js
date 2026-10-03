// Tables vs running orders and sync, against the REAL controllers and schema
// (hotel 6 incident, 2026-10-01: deleted tables reappearing, running orders
// on switched-off tables).
//
//   1. a table status written by an order push does NOT move the table's
//      updatedAt - it made every exe table edit lose as "cloud newer"
//   2. deleting a table with a running order is refused even when its
//      cached table_status says "F"
//   3. the same for deleting its section
//   4. one hotel cannot delete another hotel's section by id
//
// Works on throwaway rows (one section, one table, one order) created on an
// existing hotel and removed again before exit. Only refusal paths of the
// delete controllers are exercised, so no Redis write ever happens; run with
// REDIS_HOST pointed somewhere harmless anyway:
//   REDIS_HOST=127.0.0.1 node tests/sync/verify-table-guards.js
require("dotenv").config();
const assert = require("assert");
const express = require("express");
const jwt = require("jsonwebtoken");

const sequelize = require("../../connection/connect");
const { Hotel, LocalServerRegistration } = require("../../model");
const Table = require("../../model/table");
const TableCatagories = require("../../model/table_catg");
const Order = require("../../model/order");
const syncRoutes = require("../../routes/sync");
const { removeTable, removeTableCatagories } = require("../../controller/hotel");

const PORT = Number(process.env.SYNC_TEST_PORT) || 4898;
const BASE = `http://127.0.0.1:${PORT}`;
const ok = (label, extra = "") => console.log(`  ok  ${label}${extra ? " - " + extra : ""}`);
const created = { orderId: null, tableId: null, sectionId: null };

// Runs an express-style controller and resolves with the JSON it sent.
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
        if (created.orderId) await Order.destroy({ where: { id: created.orderId } });
        if (created.tableId) await Table.destroy({ where: { id: created.tableId } });
        if (created.sectionId) await TableCatagories.destroy({ where: { id: created.sectionId } });
    } catch (err) {
        console.error("cleanup failed:", err.message);
    }
}

async function main() {
    await sequelize.authenticate();
    const registration = await LocalServerRegistration.findOne({ where: { status: "active" }, order: [["id", "ASC"]] });
    assert(registration, "no active local-server registration to borrow - register a device first");
    const hotelId = registration.hotel_id;
    const otherHotel = await Hotel.findOne({ where: { id: { [require("sequelize").Op.ne]: hotelId } }, attributes: ["id"] });
    assert(otherHotel, "need a second hotel row for the cross-tenant check");
    console.log(`using hotel ${hotelId}, other hotel ${otherHotel.id}`);

    const deviceToken = jwt.sign(
        { typ: "local-server", hotel_id: hotelId, device_id: registration.device_id, installation_id: registration.installation_id },
        process.env.JWT_SECRET_KEY_ADMIN,
    );
    const app = express();
    app.use(express.json({ limit: "10mb" }));
    app.use("/sync", syncRoutes);
    const server = await new Promise((resolve) => { const s = app.listen(PORT, () => resolve(s)); });

    const localId = 900000000 + Math.floor(Math.random() * 1000000);
    const section = await TableCatagories.create({ table_catag_nm: `zz-test-${localId}`, hotel_id: hotelId, type: "T", active: true });
    created.sectionId = section.id;
    const table = await Table.create({
        table_name: "ZZ1", hotel_id: hotelId, table_catag_id: section.id, type: "T", active: true,
        table_status: "F", local_id: localId,
    });
    created.tableId = table.id;

    // ---- 1. status from an order push keeps updatedAt -------------------
    const before = (await Table.findByPk(table.id, { raw: true })).updatedAt;
    await new Promise((r) => setTimeout(r, 1100));
    const pushRes = await fetch(`${BASE}/sync/push/orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${deviceToken}` },
        body: JSON.stringify({ orders: [], tableStatuses: [{ id: localId, table_status: "R" }] }),
    }).then((r) => r.json());
    assert(!pushRes.error, `push/orders failed: ${JSON.stringify(pushRes)}`);
    const after = await Table.findByPk(table.id, { raw: true });
    assert.strictEqual(after.table_status, "R", "the status was written");
    assert.strictEqual(new Date(after.updatedAt).getTime(), new Date(before).getTime(), "updatedAt must not move for a status mirror write");
    ok("an order push writes table_status without touching updatedAt");

    // ---- 2. a running order blocks the table delete ----------------------
    await Table.update({ table_status: "F" }, { where: { id: table.id }, silent: true });
    const order = await Order.create({
        hotel_id: hotelId, TableId: table.id, order_type: "dinin", bill_no: "ZZTEST",
        status: "in-progress", payment: "pending", deleted: false, business_date: "2026-10-02",
    });
    created.orderId = order.id;
    const delTable = await call(removeTable, hotelId, { id: table.id });
    assert(delTable.error, `deleting a table with a running order must be refused: ${JSON.stringify(delTable)}`);
    assert((await Table.findByPk(table.id, { raw: true })).active, "the table is still on");
    const delTableBulk = await call(removeTable, hotelId, { allId: [table.id] });
    assert(delTableBulk.error, "the bulk path refuses it too");
    ok("deleting a table with a running order is refused", delTable.results?.message || delTable.message || "");

    // ---- 3. ...and its section -------------------------------------------
    const delSection = await call(removeTableCatagories, hotelId, { id: section.id });
    assert(delSection.error, "deleting a section with a running order must be refused");
    assert((await TableCatagories.findByPk(section.id, { raw: true })).active, "the section is still on");
    ok("deleting a section with a running order is refused");

    // ---- 4. no cross-hotel section delete ---------------------------------
    await Order.update({ payment: "success" }, { where: { id: order.id } });
    const crossTenant = await call(removeTableCatagories, otherHotel.id, { id: section.id });
    assert(crossTenant.error, "another hotel must not be able to delete this section");
    assert((await TableCatagories.findByPk(section.id, { raw: true })).active, "section still on after a cross-hotel attempt");
    assert((await Table.findByPk(table.id, { raw: true })).active, "its table still on after a cross-hotel attempt");
    ok("one hotel cannot delete another hotel's section");

    server.close();
    await cleanup();
    console.log("\nALL TABLE GUARD CHECKS PASSED");
    process.exit(0);
}

main().catch(async (err) => {
    console.error("\nFAILED:", err);
    await cleanup();
    process.exit(1);
});
