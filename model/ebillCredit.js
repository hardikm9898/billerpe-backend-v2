
const { Sequelize, DataTypes } = require('sequelize');
const sequelize = require("../connection/connect")
const Order = require("./order")
const Menu = require("./menu");
const User = require("./user")
const Table = require("./table");
const Hotel = require('./hotel');

const EBillCredit = sequelize.define("hms_ebillCredit_mst", {
    id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
    },

    credit: {
        type: DataTypes.DOUBLE,
        defaultValue: false
    },


})



module.exports = EBillCredit