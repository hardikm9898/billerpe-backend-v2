const { Sequelize, DataTypes } = require('sequelize');
const sequelize = require("../connection/connect");
const Order = require("./order");
const Menu = require("./menu");
const User = require("./user");
const Table = require("./table");
const Hotel = require('./hotel');
const { ORDER_DETAILS_TYPE } = require('../constant/const');
const Variants = require('./variants');

const OrderDetails = sequelize.define("hms_orderDetails", {
    id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
    },
    qty: {
        type: DataTypes.FLOAT,
        defaultValue: 1
    },
    order_type: {
        type: DataTypes.STRING
    },
    comment: {
        type: DataTypes.STRING,
        defaultValue: ""
    },
    price: {
        type: DataTypes.DOUBLE,
        allowNull: false
    },
    kotNumber: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    },
    totalDiscount: {
        type: DataTypes.DOUBLE,
        defaultValue: 0
    },
    status: {
        type: DataTypes.STRING,
        defaultValue: ORDER_DETAILS_TYPE.IN_PROGRESS
    },
    payment_status: {
        type: DataTypes.STRING,
        defaultValue: "pending"
    },
    addons: {
        type: DataTypes.JSON,
        defaultValue: []
    },
    variant_name: {
        type: DataTypes.STRING,
        defaultValue: ""
    },
    ready: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    // Plan 2 (/app/v1), same meaning as billerpe-local-exe's columns:
    // firedBy = HotelUser who sent the line (only they or a Manager/Owner
    // may remove it); kds_hidden = printed with the bill, never on a KDS;
    // route_* = a custom item's chosen kitchen / device printer; kds_state =
    // KDS progress (sent | preparing | ready; served = status "delivered").
    firedBy: { type: DataTypes.INTEGER, allowNull: true },
    kds_hidden: { type: DataTypes.BOOLEAN, defaultValue: false },
    route_kitchen_id: { type: DataTypes.INTEGER, allowNull: true },
    route_printer_ref: { type: DataTypes.STRING(64), allowNull: true },
    kds_state: { type: DataTypes.STRING(16), allowNull: true }
}, {
    indexes: [
        { fields: ["orderId"] },                    // all order-detail fetches by order
        { fields: ["hotel_id", "MenuId"] },          // item-wise reports
        { fields: ["hotel_id", "status", "payment_status"] }  // KOT/delivery status queries
    ]
});




module.exports = OrderDetails;
