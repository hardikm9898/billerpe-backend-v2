const { Sequelize, DataTypes } = require('sequelize');
const sequelize = require("../../connection/connect");
const RawMaterial = require('../rawItem');
const Unit = require('../unit');
const User = require('../user');
const HotelUser = require('../hotelUser');
const Order = require('../order');

/**
 * RawMaterialConsumption model to track consumption of raw materials
 * This is used for recipe costing, inventory forecasting, and waste tracking
 */


const RawMaterialConsumption = sequelize.define("hms_raw_material_consumption", {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },

    hotel_id: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    business_date: {
        type: DataTypes.DATEONLY,
        defaultValue: () => require('moment')().format("YYYY-MM-DD")
    },

    // Nullable to match the RawMaterial -> RawMaterialConsumption
    // association's onDelete: "SET NULL" (model/index.js) - NOT NULL here
    // conflicted with that FK action and made MySQL refuse to create this
    // table at all (errno 150), so consumption history survives a raw
    // material being deleted rather than blocking or cascading it away.
    raw_material_id: {
        type: DataTypes.INTEGER,
        allowNull: true
    },

    // 🔥 ORDER CONTEXT
    order_id: {
        type: DataTypes.INTEGER,
        allowNull: true
    },

    order_item_id: {
        type: DataTypes.INTEGER,
        allowNull: true
    },

    menu_id: {
        type: DataTypes.INTEGER,
        allowNull: true
    },

    variant_id: {
        type: DataTypes.INTEGER,
        allowNull: true
    },

    addon_id: {
        type: DataTypes.INTEGER,
        allowNull: true
    },

    // 🔥 REQUIRED vs ACTUAL
    required_qty: {
        type: DataTypes.DECIMAL(10, 4),
        allowNull: false
    },

    consumed_qty: {
        type: DataTypes.DECIMAL(10, 4),
        allowNull: false
    },

    // 🔥 PURPOSE
    purpose: {
        type: DataTypes.ENUM("RECIPE", "WASTE", "SPOILAGE", "ADJUSTMENT"),
        allowNull: false
    },

    // 🔥 STATE MACHINE
    status: {
        type: DataTypes.ENUM("RESERVED", "CONSUMED", "REVERSED"),
        defaultValue: "CONSUMED"
    },

    cost: {
        type: DataTypes.DECIMAL(10, 2),
        defaultValue: 0
    },

    notes: {
        type: DataTypes.TEXT,
        allowNull: true
    },

    deleted_status: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    }
}, {
    indexes: [
        { fields: ["hotel_id", "raw_material_id"] },
        { fields: ["order_id"] },
        { fields: ["menu_id"] }
    ]
});



module.exports = RawMaterialConsumption;