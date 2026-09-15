const { Sequelize, DataTypes } = require('sequelize');
const sequelize = require("../../connection/connect");
const moment = require("moment");

const Westage = sequelize.define("hms_watage_mst", {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    // Task 2 push half - see model/Inventory/supplyer.js's local_id comment.
    local_id: { type: DataTypes.INTEGER, allowNull: true },
    qty: {
        type: DataTypes.FLOAT,
        allowNull: false
    },
    average_price: {
        type: DataTypes.FLOAT,
        allowNull: false
    },
    deleted_status: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    notes: {
        type: DataTypes.STRING,
        defaultValue: ""
    },
    reason: {
        type: DataTypes.STRING,
        defaultValue: ""
    },
    business_date: {
        type: DataTypes.DATEONLY,
        defaultValue: () => moment().format("YYYY-MM-DD"),
        index: true
    }
});

module.exports = Westage;