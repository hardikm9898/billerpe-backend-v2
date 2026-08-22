
const { DataTypes } = require("sequelize")
const sequelize = require("../connection/connect")

const SemiFinishedItem = sequelize.define("hms_semi_finished_items_mst", {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    hotel_id: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    name: {
        type: DataTypes.STRING,
        allowNull: false
    },
    unit_id: {
        type: DataTypes.INTEGER,
        allowNull: true
    },
    min_stock_level: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    min_stock_qty: {
        type: DataTypes.DECIMAL(10, 4),
        defaultValue: 0
    }
})

module.exports = SemiFinishedItem
