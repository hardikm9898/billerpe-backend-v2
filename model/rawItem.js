
const { DataTypes } = require("sequelize")
const sequelize = require("../connection/connect");
const Unit = require("./unit");


const RawMaterial = sequelize.define("hms_rawMaterial_mst", {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    raw_material_name: {
        type: DataTypes.STRING,
        require: true
    },
    purchase_price: {
        type: DataTypes.STRING,
        require: true
    },
    conversion_qty: {
        type: DataTypes.INTEGER,
        defaultValue: 1
    },
    mini_stock_level: {
        type: DataTypes.INTEGER, defaultValue: 0
    },
    mini_stock_level_qty: {
        type: DataTypes.INTEGER, defaultValue: 0
    },
    minimum_stock_level: {
        type: DataTypes.BOOLEAN, defaultValue: false
    },
    // Sync engine v2 (controller/sync/*) - the exe's own row id for this
    // row, the idempotency key for a repeat push. See migration
    // 20260916100000 for why this table needs it.
    local_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
    },
})


module.exports = RawMaterial

