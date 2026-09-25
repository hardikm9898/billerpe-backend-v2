
const { DataTypes } = require("sequelize")
const sequelize = require("../connection/connect");
const HotelUser = require("./hotelUser");
const ExpenseHead = require("./expenseHead");
const moment = require("moment");



const ExpenseEntry = sequelize.define("hms_expense_entry_mst", {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    // Task 2 push half - see model/Inventory/supplyer.js's local_id comment.
    local_id: { type: DataTypes.INTEGER, allowNull: true },
    amount: {
        type: DataTypes.STRING,
        require: true,
    },
    reason: {
        type: DataTypes.STRING,
        require: true
    },
    paymentMode: {
        type: DataTypes.STRING,
        require: true
    },
    addExpense: {
        type: DataTypes.BOOLEAN,
        defaultValue: true
    },
    active: {
        type: DataTypes.BOOLEAN,
        defaultValue: true
    },
    business_date: {
        type: DataTypes.DATEONLY,
        defaultValue: () => moment().format("YYYY-MM-DD"),
        index: true
    },
    // POS App (Plan 2): supplier payment <-> its auto expense (exe column).
    purchase_payment_id: { type: DataTypes.INTEGER, allowNull: true },
    deleted: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    }
})
// ExpenseEntry.belongsTo(ExpenseHead, { foreignKey: 'expense_head_id' })
// ExpenseHead.hasMany(ExpenseEntry, {
//     foreignKey: 'expense_head_id', onDelete: 'SET NULL',

// })


// HotelUser.hasMany(ExpenseEntry, {
//     foreignKey: 'user_id',
// });
module.exports = ExpenseEntry

