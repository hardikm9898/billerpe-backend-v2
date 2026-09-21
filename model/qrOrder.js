const { DataTypes } = require("sequelize")
const sequelize = require("../connection/connect")

// QR table ordering - the handoff/inbox record between a customer's phone
// (src/routes/qr-menu.tsx, billerpe-pos-pro-v2) and the exe. This row is
// NEVER itself a billable order - the exe (controller/qrOrder.js,
// billerpe-local-exe) is what creates the real OrderDetails once staff
// accepts, via the same buildKotRows/createNewKotOrder path a
// staff-entered KOT already uses. See migrations/20260908130100-create-qr-order-msts.js.
const QrOrder = sequelize.define("hms_qr_order_msts", {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    hotel_id: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    table_id: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    // The qr_version the customer's QR actually encoded at scan time - see
    // model/table.js's own qr_version column. Kept here (not just checked
    // at submit) so staff/investigation can see whether a pending order
    // came from a link that's since been invalidated.
    qr_version: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    customer_name: {
        type: DataTypes.STRING
    },
    customer_mobile: {
        type: DataTypes.STRING,
        allowNull: false
    },
    // Same shape as kotOrder's cart.items[].menuItems[] (billerpe-pos-pro-v2's
    // KotCartItem) - deliberately, so the exe's accept handler feeds this
    // straight into the existing KOT-building code with no reshaping.
    items: {
        type: DataTypes.JSON,
        allowNull: false
    },
    status: {
        type: DataTypes.ENUM,
        values: ["pending", "accepted", "rejected", "expired"],
        defaultValue: "pending"
    },
    // The customer's visit this round belongs to (model/qrSession.js).
    session_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
    },
    // One-time key the customer's page sends with a submission, so a double
    // tap or a network retry is saved once instead of becoming a duplicate
    // order. Unique per session (migration 20260920100000).
    client_key: {
        type: DataTypes.STRING(64),
        allowNull: true,
    }
})

module.exports = QrOrder
