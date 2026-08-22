const { DataTypes } = require('sequelize');
const sequelize = require("../connection/connect");
const Table = require('./table');
const HotelUser = require('./hotelUser');
const Order = require('./order');


const TimeLine = sequelize.define("hms_timeline_mst", {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    sub_total: {
        type: DataTypes.DOUBLE,
        defaultValue: 0
    },

    order_type: {
        type: DataTypes.STRING,
    },
    bill_no: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: '0000'
    },
    order_status: {
        type: DataTypes.STRING,
    },
    items: {
        type: DataTypes.JSON,
        defaultValue: []
    },
    created_Date: {
        type: DataTypes.DATE,
        defaultValue: new Date()
    },
    from: {
        type: DataTypes.STRING,
    },
    device_name: {
        type: DataTypes.STRING,
        defaultValue: ''
    },
    event_name: {
        type: DataTypes.STRING,
        defaultValue: ''
    },
    deleted: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    action: {
        type: DataTypes.STRING,
        defaultValue: ''
    },
    creator: {
        type: DataTypes.STRING,
        defaultValue: ''
    },
    gst: {
        type: DataTypes.DOUBLE,
        defaultValue: 0
    },
    grandAmount: {
        type: DataTypes.DOUBLE,
        defaultValue: 0
    },
    discount: {
        type: DataTypes.DOUBLE,
        defaultValue: 0
    },
    service_charge: {
        type: DataTypes.DOUBLE,
        defaultValue: 0
    }

})

module.exports = TimeLine