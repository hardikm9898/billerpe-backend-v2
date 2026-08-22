
const { Sequelize, DataTypes, STRING } = require('sequelize');
const sequelize = require("../connection/connect")
const Order = require("./order")
const Menu = require("./menu");
const User = require("./user")
const Table = require("./table");
const Hotel = require('./hotel');
const { ORDER_DETAILS_TYPE } = require('../constant/const');
const { version } = require('joi');
const AppUpdate = sequelize.define("AppUpdate", {
    id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
    },
    version: {
        type: DataTypes.STRING,
        allowNull: false
    },
    update_type: {
        type: DataTypes.STRING
    },
    update_message: {
        type: DataTypes.STRING
    },
    update_title: {
        type: DataTypes.STRING
    }

})
module.exports = AppUpdate