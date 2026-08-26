const { DataTypes } = require("sequelize")
const sequelize = require("../connection/connect")

const CashMovement = sequelize.define("hms_cashMovement_mst", {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    type: {
        type: DataTypes.STRING,
        allowNull: false
    },
    // Negative for Withdraw/Expense, positive for Opening/Add/Settlement -
    // matches the frontend's own convention (drawer balance is just the
    // sum of every movement's amount).
    amount: {
        type: DataTypes.DOUBLE,
        defaultValue: 0
    },
    reason: {
        type: DataTypes.STRING,
        allowNull: true
    },
    at: {
        type: DataTypes.DATE,
        defaultValue: () => new Date()
    }
})

module.exports = CashMovement
