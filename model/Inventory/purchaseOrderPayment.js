const { Sequelize, DataTypes, INTEGER } = require('sequelize');
const sequelize = require("../../connection/connect")
const Hotel = require("../hotel");
const PrinterSetting = require('../printer_setting');
const RawMaterial = require('../rawItem');

const Unit = require('../unit');
const PurchaseOrder = require('./purchaseOrder');
const User = require('../user');
const HotelUser = require('../hotelUser');

const PurchaseOrderPayment = sequelize.define("hms_purchase_payment", {
    id: {
        type: DataTypes.DOUBLE,
        primaryKey: true,
        autoIncrement: true
    },
    // Task 2 push half - see model/Inventory/supplyer.js's local_id comment.
    local_id: { type: DataTypes.INTEGER, allowNull: true },
    date: { type: DataTypes.DATE, defaultValue: new Date() },

    amount: { type: DataTypes.DOUBLE, defaultValue: 0 },
    // The outlet's own mode name (Cash, UPI, Card, custom) or Cheque / Bank
    // transfer - was an enum with no UPI. Migration 20260925120000.
    payment_mode: { type: DataTypes.STRING(60) },
    payment_ref_no: { type: DataTypes.STRING, defaultValue: "" },
    paymentDate: { type: DataTypes.DATE, defaultValue: new Date() },
    // POS App (Plan 2): supplier payment <-> its auto expense (exe column).
    expense_entry_id: { type: DataTypes.INTEGER, allowNull: true },
    deleted_status: { type: DataTypes.BOOLEAN, defaultValue: false }

})

// PurchaseOrder.hasMany(PurchaseOrderPayment, { foreignKey: "purchaseOrderId", onDelete: "SET NULL", onUpdate: 'CASCADE' })
// PurchaseOrderPayment.belongsTo(PurchaseOrder, { foreignKey: "purchaseOrderId" })

// HotelUser.hasMany(PurchaseOrderPayment, { foreignKey: 'userId', onDelete: "SET NULL", onUpdate: 'CASCADE' })
// PurchaseOrderPayment.belongsTo(HotelUser, { foreignKey: 'userId', onDelete: "SET NULL", onUpdate: 'CASCADE' })

module.exports = PurchaseOrderPayment