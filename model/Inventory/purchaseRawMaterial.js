const { Sequelize, DataTypes, INTEGER } = require('sequelize');
const sequelize = require("../../connection/connect")
const Hotel = require("../hotel");
const PrinterSetting = require('../printer_setting');
const RawMaterial = require('../rawItem');

const Unit = require('../unit');
const moment = require("moment")
const PurchaseRawMaterial = sequelize.define("hms_purchase_rawMaterial", {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    business_date: {
        type: DataTypes.DATEONLY,
        defaultValue: () => require('moment')().format("YYYY-MM-DD")
    },
    qty: { type: DataTypes.INTEGER, defaultValue: 0 },

    price: { type: DataTypes.DOUBLE, defaultValue: 0 },
    amount: { type: DataTypes.BIGINT, defaultValue: 0 },
    cgst: { type: DataTypes.DOUBLE, defaultValue: 0 },
    sgst: { type: DataTypes.DOUBLE, defaultValue: 0 },
    igst: { type: DataTypes.DOUBLE, defaultValue: 0 },
    deleted_status: { type: DataTypes.BOOLEAN, defaultValue: false }

})


// RawMaterial.hasMany(PurchaseRawMaterial, {
//     foreignKey: "raw_material_id",
//     as: "purchases", // Alias for relation
//     onDelete: "SET NULL",
//     onUpdate: "CASCADE"
// });

// // Each PurchaseRawMaterial belongs to one RawMaterial
// PurchaseRawMaterial.belongsTo(RawMaterial, {
//     foreignKey: "raw_material_id",
//     as: "rawMaterial",
// });

// PurchaseRawMaterial.belongsTo(Unit, {
//     foreignKey: "unit_id",
//     onDelete: "SET NULL",
//     onUpdate: "CASCADE"
// });

// Unit.hasMany(PurchaseRawMaterial, {
//     foreignKey: "unit_id",
//     onDelete: "SET NULL",
//     onUpdate: "CASCADE"
// });


module.exports = PurchaseRawMaterial