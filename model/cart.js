
const { Sequelize, DataTypes } = require('sequelize');
const sequelize = require("../connection/connect")
const Order = require("./order")
const Menu = require("./menu");
const User = require("./user")
const Table = require("./table");
const Hotel = require('./hotel');
const Cart = sequelize.define("hms_cart", {
    id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
    },
    UserId: {
        type: DataTypes.INTEGER,
        references: {
            model: User, // 'Movies' would also work
            key: 'id'
        }
    },
    MenuId: {
        type: DataTypes.INTEGER,
        references: {
            model: Menu, // 'Actors' would also work
            key: 'id'
        }
    },
    TableId: {
        type: DataTypes.INTEGER,
        references: {
            model: Table,
            key: "id"
        }
    },

    qty: {
        type: DataTypes.INTEGER,
        defaultValue: 1
    }
    ,
    status: {
        type: DataTypes.STRING,
        defaultValue: "InCart"
    },
    totalAmount: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    },
    hotel_id: {
        type: DataTypes.INTEGER,
        references: {
            model: Hotel,
            key: "id"
        }
    }
})



module.exports = Cart