const { DataTypes } = require("sequelize")
const sequelize = require("../connection/connect")

const CashMovement = sequelize.define("hms_cashMovement_mst", {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    // Task 2 push half - see model/Inventory/supplyer.js's local_id
    // comment. Scoped by cashSessionId here, not hotel_id (this table has
    // no hotel_id of its own).
    local_id: { type: DataTypes.INTEGER, allowNull: true },
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
    },
    // POS App (Plan 2), same columns as the exe: the expense / supplier
    // payment this drawer movement paid.
    expense_entry_id: { type: DataTypes.INTEGER, allowNull: true },
    purchase_payment_id: { type: DataTypes.INTEGER, allowNull: true },
})

module.exports = CashMovement
