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

    amount: { type: DataTypes.BIGINT, defaultValue: 0 },
    payment_mode: { type: DataTypes.ENUM, values: ["card", "cheque", "online", "other", "cash"] },
    payment_ref_no: { type: DataTypes.STRING, defaultValue: "" },
    paymentDate: { type: DataTypes.DATE, defaultValue: new Date() },
    deleted_status: { type: DataTypes.BOOLEAN, defaultValue: false }

})

// PurchaseOrder.hasMany(PurchaseOrderPayment, { foreignKey: "purchaseOrderId", onDelete: "SET NULL", onUpdate: 'CASCADE' })
// PurchaseOrderPayment.belongsTo(PurchaseOrder, { foreignKey: "purchaseOrderId" })

// HotelUser.hasMany(PurchaseOrderPayment, { foreignKey: 'userId', onDelete: "SET NULL", onUpdate: 'CASCADE' })
// PurchaseOrderPayment.belongsTo(HotelUser, { foreignKey: 'userId', onDelete: "SET NULL", onUpdate: 'CASCADE' })

module.exports = PurchaseOrderPayment