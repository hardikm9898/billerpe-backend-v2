const { DataTypes } = require("sequelize");
const sequelize = require("../connection/connect");

// Default payment mode to pre-select at billing, scoped by order type and
// (dine-in only) table category. table_categ_id null is the order type's
// own base default; a non-null row is a per-category override that takes
// priority over the base default for that same order_type - see
// controller/paymentModeDefault.js's savePaymentModeDefault for how that
// pair is kept unique at the application layer instead of a DB constraint.
// Purely a UI convenience for payment-split-editor.tsx's "Add payment mode"
// button - never enforced server-side, same as PaymentMode itself never
// gates what's actually collectible (see PaymentMode's own comment).
const PaymentModeDefault = sequelize.define("hms_payment_mode_default_mst", {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
    },
    order_type: {
        type: DataTypes.STRING,
        allowNull: false,
    },
    table_categ_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
    },
    payment_mode_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
    },
});

module.exports = PaymentModeDefault;
