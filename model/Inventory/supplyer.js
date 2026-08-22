const { Sequelize, DataTypes } = require('sequelize');
const sequelize = require("../../connection/connect");

const Supplier = sequelize.define("hms_supplier", {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
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