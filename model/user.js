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
    },
    // Customer deleted in the outlet's Customer Data (exe controller/customer.js
    // #deleteCustomerData, pushed with the row; migration 20260930100000).
    // Hidden from customer lists; settled bills keep showing the name.
    deleted_at: {
        type: DataTypes.DATE,
        allowNull: true
    },
    // Sync engine v2 (controller/sync/*) - the exe's own row id for this
    // row, the idempotency key for a repeat push. See migration
    // 20260916100000 for why this table needs it.
    local_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
    },
},
)





module.exports = User