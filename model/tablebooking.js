
const { Sequelize, DataTypes } = require('sequelize');
const sequelize = require("../connection/connect")
const User = require("./user");
const Table = require('./table');
const { MESSAGE, STATUS } = require('../constant/const');
const Hotel = require('./hotel');
const OrderDetails = require("../model/order_details");
const HotelUser = require('./hotelUser');

const TableBooking = sequelize.define("hms_tableBooking_mst", {

    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    totalAmount: {
        type: DataTypes.DOUBLE,
        defaultValue: 0
    },
    gst_no: {
        type: DataTypes.STRING,
    },
    advance: {
        type: DataTypes.DOUBLE,
        defaultValue: 0
    },
    no_of_person: {
        type: DataTypes.INTEGER,
        defaultValue: 1
    },

    booking_date: {
        type: DataTypes.DATE,
        allowNull: false
    },
    start_time: {
        type: DataTypes.STRING,
        allowNull: false
    },
    end_time: {
        type: DataTypes.STRING,
        allowNull: false
    },

    enter_by: {
        type: DataTypes.STRING
    },
    modified_by: {
        type: DataTypes.STRING
    },
    status: {
        type: DataTypes.BOOLEAN,
        defaultValue: true
    },
    booking_id: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    deleted: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    }

})




module.exports = TableBooking