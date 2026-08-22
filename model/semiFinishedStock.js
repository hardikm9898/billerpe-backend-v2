
const { DataTypes } = require("sequelize")
const sequelize = require("../connection/connect")

const SemiFinishedStock = sequelize.define("hms_semi_finished_stock", {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    hotel_id: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    semi_finished_item_id: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    available_qty: {
        type: DataTypes.DECIMAL(10, 4),
        defaultValue: 0
    },
    cost_per_unit: {
        type: DataTypes.DECIMAL(10, 4),
        defaultValue: 0
    },
    total_amount: {
        type: DataTypes.DECIMAL(10, 2),
        defaultValue: 0
    }
})

module.exports = SemiFinishedStock
