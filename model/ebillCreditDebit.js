
const { Sequelize, DataTypes } = require('sequelize');
const sequelize = require("../connection/connect")
const Order = require("./order")
const Menu = require("./menu");
const User = require("./user")
const Table = require("./table");
const Hotel = require('./hotel');
const moment = require('moment')
const EBillCreditDebit = sequelize.define("hms_ebillCreditDebit_mst", {
    id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
    },

    // orderId: {
    //     type: DataTypes.INTEGER,
    //     references: {
    //         model: Order,
    //         key: 'id'
    //     }
    // },
    mobile: {
        type: DataTypes.DOUBLE,
        defaultValue: 0
    },
    credit: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    debit: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    amount: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    },
    business_date: {
        type: DataTypes.DATEONLY,
        defaultValue: () => moment().format("YYYY-MM-DD"),
        index: true
    },
    credit_type: {
        type: DataTypes.ENUM("paid", "free"),
        defaultValue: "free",
    },
    ebill_count: {
        type: DataTypes.INTEGER,
        defaultValue: null,
        allowNull: true
    },
    discount: {
        type: DataTypes.DOUBLE,
        defaultValue: 0
    },
    payment_screenshot: {
        type: DataTypes.STRING,
        defaultValue: null,
        allowNull: true
    },
    added_by: {
        type: DataTypes.INTEGER,
        defaultValue: null,
        allowNull: true
    }
})



module.exports = EBillCreditDebit