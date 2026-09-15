const { Sequelize, DataTypes } = require('sequelize');
const sequelize = require("../../connection/connect");

const Supplier = sequelize.define("hms_supplier", {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    // Task 2 push half - the exe's own local row id, so a re-push (retry,
    // or an edit after an earlier successful push) upserts in place instead
    // of creating a duplicate. See controller/offline/offlineEntityPush.js.
    local_id: { type: DataTypes.INTEGER, allowNull: true },
    name: {
        type: DataTypes.STRING,
        allowNull: false
    },
    deleted_status: { 
        type: DataTypes.BOOLEAN, 
        defaultValue: false 
    }
});

module.exports = Supplier;