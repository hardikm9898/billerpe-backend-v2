
const { DataTypes } = require("sequelize")
const sequelize = require("../connection/connect");

const RawMaterial = require("./rawItem");


const StockInHand = sequelize.define("hms_stock_in_hand_mst", {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    qty: {
        type: DataTypes.FLOAT,
        allowNull: false
    },
    price: {
        type: DataTypes.STRING,
        require: true
    },
    average_price: {
        type: DataTypes.STRING,
        defaultValue: '0',
        require: true
    },
    total_amount: {
        type: DataTypes.DOUBLE,
        require: true
    },
    deleted: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    available_stock_Consiompsion_qty: {
        type: DataTypes.DOUBLE,
        defaultValue: 1
    }

})

// RawMaterial.hasOne(StockInHand,
//     {
//         foreignKey: 'raw_material_id',
//     });

// StockInHand.belongsTo(RawMaterial, { foreignKey: 'raw_material_id' })

module.exports = StockInHand

