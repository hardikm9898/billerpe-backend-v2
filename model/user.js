const { Sequelize, DataTypes } = require('sequelize');
const sequelize = require("../connection/connect")
const Hotel = require("./hotel");
const Role = require('./role_mst');
const UserAccess = require('./userAccess');

const User = sequelize.define("hms_user_master", {

    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false
    },
    email: {
        type: DataTypes.STRING,
        defaultValue: ''
    },
    name: {
        type: DataTypes.STRING,
        defaultValue: ''

    },
    gstin: {
        type: DataTypes.STRING,
        defaultValue: ''
    },

    number: {
        type: DataTypes.STRING,
        defaultValue: ''
    },
    address: {
        type: DataTypes.STRING,
        defaultValue: ''
    },
    isPlaceholder: {
        type: DataTypes.BOOLEAN,
        defaultValue: true
    }

},
)





module.exports = User