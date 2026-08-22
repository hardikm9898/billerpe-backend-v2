
const { DataTypes } = require("sequelize")
const sequelize = require("../connection/connect");

const RawMaterial = require("./rawItem");
const HotelUser = require("./hotelUser");
const moment = require("moment")

const StockHistory = sequelize.define("hms_stock_history_mst", {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    qty: {
        type: DataTypes.DOUBLE,
        require: true
    },
    price: {
        type: DataTypes.STRING,
        require: true
    },
    total_amount: {
        type: DataTypes.STRING,
        require: true
    },
    deleted: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    stock_in: {
        type: DataTypes.BOOLEAN,
        require: true
    },
    business_date: {
        type: DataTypes.DATEONLY,
        defaultValue: () => moment().format("YYYY-MM-DD"),
        index: true
    }
})

// RawMaterial.hasMany(StockHistory,
//     {
//         foreignKey: 'raw_material_id',
//     });

// StockHistory.belongsTo(RawMaterial, { foreignKey: 'raw_material_id' })
// HotelUser.hasMany(StockHistory, {
//     foreignKey: 'user_id',
// });

module.exports = StockHistory

