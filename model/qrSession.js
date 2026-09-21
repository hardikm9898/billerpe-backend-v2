const { DataTypes } = require("sequelize")
const sequelize = require("../connection/connect")

// One customer's QR ordering visit at one table: identified by the table and
// the customer's mobile number, open until that table's order is settled or
// cancelled on the restaurant's exe (it tells us - see qrSessionTableState).
// Every round the customer submits hangs off it (QrOrder.session_id), so the
// customer's history survives a refresh, a wiped browser or a new phone:
// scanning again and entering the same mobile restores it. Before this the
// history lived only in the phone's localStorage, and QR scanner in-app
// browsers routinely wipe that - the customer resubmitted and staff got a
// duplicate order.
const QrSession = sequelize.define("hms_qr_session_msts", {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
    },
    hotel_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
    },
    table_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
    },
    customer_mobile: {
        type: DataTypes.STRING,
        allowNull: false,
    },
    customer_name: {
        type: DataTypes.STRING,
    },
    // Random, unguessable handle the customer's page keeps; getting it needs
    // the table's QR plus the mobile number.
    session_key: {
        type: DataTypes.STRING(64),
        allowNull: false,
        unique: true,
    },
    status: {
        type: DataTypes.ENUM,
        values: ["open", "closed"],
        defaultValue: "open",
    },
    // The table's bill has been printed - no more rounds from the phone.
    bill_ready: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
    },
    closed_reason: {
        type: DataTypes.STRING,
    },
    closed_at: {
        type: DataTypes.DATE,
    },
})

module.exports = QrSession
