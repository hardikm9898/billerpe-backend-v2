const { Sequelize, DataTypes } = require('sequelize');
const sequelize = require("../connection/connect")
const Hotel = require("./hotel");
const Role = require('./role_mst');
const UserAccess = require('./userAccess');

const HotelUser = sequelize.define("hms_hotelUser_master", {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false
    },
    email: {
        type: DataTypes.STRING,
    },
    name: {
        type: DataTypes.STRING,

    },
    active: {
        type: DataTypes.BOOLEAN,
        defaultValue: true
    },
    number: {
        type: DataTypes.STRING,
    },
    password: {
        type: DataTypes.STRING,

    },
    pin: {
        type: DataTypes.STRING,
        allowNull: true,
    },
    device_id: {
        type: DataTypes.STRING,
        defaultValue: ""
    },
    refresh_token: {
        type: DataTypes.STRING,
        defaultValue: ""
    }
},
)

module.exports = HotelUser