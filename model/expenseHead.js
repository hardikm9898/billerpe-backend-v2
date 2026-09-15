
const { DataTypes } = require("sequelize")
const sequelize = require("../connection/connect")



const ExpenseHead = sequelize.define("hms_expense_head_mst", {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    // Task 2 push half - see model/Inventory/supplyer.js's local_id comment.
    local_id: { type: DataTypes.INTEGER, allowNull: true },
    expense_head_name: {
        type: DataTypes.STRING,
        require: true
    },
    deleted: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    }

})

module.exports = ExpenseHead

