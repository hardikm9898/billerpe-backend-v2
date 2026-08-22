
const { Sequelize, DataTypes } = require('sequelize');
const sequelize = require("../connection/connect")
const Order = require("./order")
const Menu = require("./menu");
const User = require("./user")
const Table = require("./table");
const Hotel = require('./hotel');
const { ORDER_DETAILS_TYPE } = require('../constant/const');
const AdminCart = sequelize.define("AdminCart", {
    id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
    },
    MenuId: {
        type: DataTypes.INTEGER,
        references: {
            model: Menu,
            key: 'id'
        }
    },
    kotNumber: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    },
    qty: {
        type: DataTypes.STRING,
        defaultValue: 1
    },
    Order_type: {
        type: DataTypes.INTEGER,
    },
    totalAmount: {
        type: DataTypes.DOUBLE,
        defaultValue: 0
    },
    status: { type: DataTypes.STRING, defaultValue: ORDER_DETAILS_TYPE.IN_PROGRESS },
    // hotel_id: {
    //     type: DataTypes.INTEGER,
    //     references: {
    //         model: Hotel,
    //         key: "id"
    //     }
    // },
    comment: {
        type: DataTypes.STRING,
        defaultValue: null
    },
    discount: {
        type: DataTypes.DOUBLE,
        defaultValue: 0
    }
})
module.exports = AdminCart