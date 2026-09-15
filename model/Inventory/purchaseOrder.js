const { Sequelize, DataTypes, INTEGER } = require('sequelize');
const sequelize = require("../../connection/connect")
const Hotel = require("../hotel");
const PrinterSetting = require('../printer_setting');
const PurchaseRawMaterial = require('./purchaseRawMaterial');
const User = require('../user');
const HotelUser = require('../hotelUser');
const Supplier = require('./supplyer');
const moment = require("moment")
const PurchaseOrder = sequelize.define("hms_purchase_order", {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    // Task 2 push half - see model/Inventory/supplyer.js's local_id comment.
    local_id: { type: DataTypes.INTEGER, allowNull: true },
    business_date: {
        type: DataTypes.DATEONLY,
        defaultValue: () => require('moment')().format("YYYY-MM-DD")
    },
    Po_no: { type: DataTypes.INTEGER, defaultValue: 0 },
    sub_total: { type: DataTypes.INTEGER, defaultValue: 0 },
    discount_value: { type: DataTypes.INTEGER, defaultValue: 0 },
    invoice_date: { type: DataTypes.DATE, defaultValue: new Date() },
    invoice_number: { type: DataTypes.STRING, defaultValue: "" },
    payment_type: { type: DataTypes.ENUM, values: ["paid", "partial", "unpaid"] },
    discount_type: { type: DataTypes.ENUM, values: ["fix", "pr"] },
    GSTNo: { type: DataTypes.STRING, defaultValue: "" },
    update_inventory: { type: DataTypes.BOOLEAN, defaultValue: true },
    grandAmount: { type: DataTypes.BIGINT, defaultValue: 0 },

    discount: { type: DataTypes.INTEGER, defaultValue: 0 },
    delivery_charge: { type: DataTypes.INTEGER, defaultValue: 0 },
    deleted_status: { type: DataTypes.BOOLEAN, defaultValue: false }
})

// PurchaseOrder.hasMany(PurchaseRawMaterial, { foreignKey: 'purchaseOrderId', onDelete: "SET NULL", onUpdate: 'CASCADE' });
// PurchaseRawMaterial.belongsTo(PurchaseOrder, {
//     foreignKey: "purchaseOrderId",
//     as: "purchaseOrder", onDelete: "SET NULL", onUpdate: 'CASCADE'
// });

// HotelUser.hasMany(PurchaseOrder, { foreignKey: 'userId', onDelete: "SET NULL", onUpdate: 'CASCADE' })
// PurchaseOrder.belongsTo(HotelUser, { foreignKey: 'userId', onDelete: "SET NULL", onUpdate: 'CASCADE' })

// Supplier.hasMany(PurchaseOrder, { foreignKey: 'supplier_id' })
// PurchaseOrder.belongsTo(Supplier, { foreignKey: 'supplier_id' })

module.exports = PurchaseOrder