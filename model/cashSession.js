const { DataTypes } = require("sequelize")
const sequelize = require("../connection/connect")

const CashSession = sequelize.define("hms_cashSession_mst", {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    opening_float: {
        type: DataTypes.DOUBLE,
        defaultValue: 0
    },
    status: {
        type: DataTypes.STRING,
        defaultValue: "Open"
    },
    opened_at: {
        type: DataTypes.DATE,
        defaultValue: () => new Date()
    },
    closed_at: {
        type: DataTypes.DATE,
        allowNull: true
    },
    counted_cash: {
        type: DataTypes.DOUBLE,
        allowNull: true
    },
    variance: {
        type: DataTypes.DOUBLE,
        allowNull: true
    },
    variance_reason: {
        type: DataTypes.STRING,
        allowNull: true
    },
    deleted: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    }
})

module.exports = CashSession
