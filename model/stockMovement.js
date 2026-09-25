const { DataTypes } = require("sequelize");
const sequelize = require("../connection/connect");

// The stock journal (2026-09-25 stock overhaul): one row for EVERY change
// to stock in hand - purchase, sale consumption, wastage, manual stock
// in/out/adjust, purchase order edits, requisitions, semi-finished
// production, and each one's reversal. Written only by
// services/stockLedger.js#applyStockMovement, which also updates
// StockInHand in the same step, so the journal and the stock can never
// disagree. The Stock Ledger report (opening / in / out / closing for any
// period) is computed from these rows.
//
// qty is signed and in the material's PURCHASE unit (the unit StockInHand.qty
// uses); for a semi-finished item it is in that item's own unit. value is
// qty x the unit cost the movement was booked at (weighted average for
// anything leaving stock), so summing value over any period gives the
// stock value change. On the cloud it is written only for POS App (Plan 2) outlets, by
// appv1/engine/stockLedger.js - a copy of the exe's services/stockLedger.js.
const StockMovement = sequelize.define("hms_stock_movement", {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    hotel_id: { type: DataTypes.INTEGER, allowNull: false },
    raw_material_id: { type: DataTypes.INTEGER, allowNull: true },
    semi_finished_item_id: { type: DataTypes.INTEGER, allowNull: true },
    business_date: { type: DataTypes.DATEONLY, allowNull: false },
    // opening | purchase | purchase_edit | purchase_delete | consumption |
    // consumption_reversal | wastage | wastage_reversal | stock_in |
    // stock_out | adjustment | requisition | production_use | production
    type: { type: DataTypes.STRING, allowNull: false },
    qty: { type: DataTypes.DOUBLE, allowNull: false },
    unit_cost: { type: DataTypes.DOUBLE, defaultValue: 0 },
    value: { type: DataTypes.DOUBLE, defaultValue: 0 },
    balance_qty: { type: DataTypes.DOUBLE, defaultValue: 0 },
    // What caused it: "order" + order id, "purchase_order" + PO id, ...
    ref_type: { type: DataTypes.STRING, allowNull: true },
    ref_id: { type: DataTypes.INTEGER, allowNull: true },
    note: { type: DataTypes.STRING, defaultValue: "" },
    user_id: { type: DataTypes.INTEGER, allowNull: true },
}, {
    indexes: [
        { fields: ["hotel_id", "raw_material_id", "business_date"] },
        { fields: ["hotel_id", "business_date"] },
        { fields: ["ref_type", "ref_id"] },
    ],
});

module.exports = StockMovement;
