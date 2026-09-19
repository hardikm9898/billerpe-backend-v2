const { Sequelize, DataTypes } = require('sequelize');
const sequelize = require("../connection/connect")
const Hotel = require("./hotel");
const Role = require('./role_mst');
const User = require('./user');

const UserAccess = sequelize.define("hms_user_access", {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false
    },

    access_name: {
        type: DataTypes.STRING,
    },
    create: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    edit: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    delete: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    read: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    local_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
    }
},)





module.exports = UserAccess