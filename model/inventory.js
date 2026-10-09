const { DataTypes } = require("sequelize");
const sequelize = require("../connection/connect");

// BillerPe's own stock (owner 2026-10-09): printers, paper rolls and any
// other item BillerPe gives outlets (mobile POS later), kept in ONE office
// stock. Schema owned by migration 20261015100000-create-inventory; listed in
// server.js TABLES_TO_SKIP_ALTER.

const T = DataTypes;
const MONEY = () => ({ type: T.DECIMAL(12, 2), allowNull: false, defaultValue: 0 });

// category: printer | roll | device | other. stock_office = good stock in the
// office, stock_damaged = returned broken (kept apart until written off).
// Both are kept equal to the sum of the done moves (inv_moves), changed only
// inside the move's transaction with the item row locked.
const InvItem = sequelize.define("inv_item", {
    id: { type: T.INTEGER, primaryKey: true, autoIncrement: true },
    code: { type: T.STRING(30), allowNull: false, unique: "inv_items_code" },
    name: { type: T.STRING(80), allowNull: false },
    category: { type: T.STRING(12), allowNull: false, defaultValue: "other" },
    unit: { type: T.STRING(12), allowNull: false, defaultValue: "pcs" },
    price: MONEY(),
    gst_rate: { type: T.DECIMAL(5, 2), allowNull: false, defaultValue: 18 },
    hsn: { type: T.STRING(8), allowNull: false, defaultValue: "" },
    stock_office: { type: T.INTEGER, allowNull: false, defaultValue: 0 },
    stock_damaged: { type: T.INTEGER, allowNull: false, defaultValue: 0 },
    low_at: { type: T.INTEGER, allowNull: false, defaultValue: 0 },
    sort: { type: T.INTEGER, allowNull: false, defaultValue: 0 },
    active: { type: T.BOOLEAN, allowNull: false, defaultValue: true },
}, { tableName: "inv_items" });

// One stock movement. kind:
//   purchase  +qty into the office (ref = supplier bill)
//   dispatch  qty from the office to an outlet (hotel_id; ref = consignment no.)
//   return    qty back from an outlet into the office (condition good) or damaged
//   adjust    signed qty on office or damaged (count correction, write-off)
// basis (dispatch): plan (the outlet's setup allowance) | invoice (sold on
// invoice_id) | free (needs approval). status: done | pending | rejected -
// only done moves count; a pending dispatch waits for an approver.
const InvMove = sequelize.define("inv_move", {
    id: { type: T.INTEGER, primaryKey: true, autoIncrement: true },
    item_id: { type: T.INTEGER, allowNull: false },
    kind: { type: T.STRING(10), allowNull: false },
    qty: { type: T.INTEGER, allowNull: false },
    bucket: { type: T.STRING(8), allowNull: false, defaultValue: "office" },
    hotel_id: { type: T.INTEGER, allowNull: true },
    invoice_id: { type: T.INTEGER, allowNull: true },
    setup_id: { type: T.INTEGER, allowNull: true },
    basis: { type: T.STRING(8), allowNull: false, defaultValue: "" },
    carrier: { type: T.STRING(10), allowNull: false, defaultValue: "" },
    ref: { type: T.STRING(80), allowNull: false, defaultValue: "" },
    serials: { type: T.STRING(400), allowNull: false, defaultValue: "" },
    unit_cost: { type: T.DECIMAL(12, 2), allowNull: true },
    proof: { type: T.STRING(500), allowNull: true },
    note: { type: T.STRING(300), allowNull: false, defaultValue: "" },
    status: { type: T.STRING(10), allowNull: false, defaultValue: "done" },
    created_by: { type: T.INTEGER, allowNull: true },
    decided_by: { type: T.INTEGER, allowNull: true },
    decided_at: { type: T.DATE, allowNull: true },
    reject_reason: { type: T.STRING(200), allowNull: false, defaultValue: "" },
}, { tableName: "inv_moves" });

module.exports = { InvItem, InvMove };
