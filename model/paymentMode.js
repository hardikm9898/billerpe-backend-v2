const { DataTypes } = require("sequelize");
const sequelize = require("../connection/connect");

// A hotel-configurable payment mode label (e.g. "Cash", "Paytm Wallet").
// Purely a management list, not a settlement engine change: real settlement
// (settleBills/AdminOrder) still only ever writes the 4 fixed cash/upi/
// card/due columns on hms_order_msts - billerpe-pos-pro-v2's own
// settleOrder already blocks any mode outside that fixed set with a clear
// error (see its own comment), so this table never needs to reconcile with
// real money movement, only with what a captain/cashier is allowed to pick
// from at billing time.
const PaymentMode = sequelize.define("hms_payment_mode_mst", {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
    },
    name: {
        type: DataTypes.STRING,
    },
    active: {
        type: DataTypes.BOOLEAN,
        defaultValue: true,
    },
    // Cash and Due are the two protected defaults (matches
    // billerpe-pos-pro-v2's PaymentModeConfig.deletable) - can't be
    // renamed away or removed, since the backend's settlement columns
    // hard-depend on those two concepts existing.
    deletable: {
        type: DataTypes.BOOLEAN,
        defaultValue: true,
    },
    enter_by: {
        type: DataTypes.STRING,
    },
    // Sync engine v2 (controller/sync/*) - the exe's own row id, the
    // idempotency key for a repeat push. See migration 20260916100000.
    local_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
    },
});

module.exports = PaymentMode;
