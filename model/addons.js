const { DataTypes } = require('sequelize');
const sequelize = require("../connection/connect");
const Addons = sequelize.define("hms_addon_mst", {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    addon_name: {
        type: DataTypes.STRING,
        allowNull: false
    },
    price: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    attributes: {
        type: DataTypes.ENUM,
        values: ['veg', 'non-veg', 'egg'],
        defaultValue: 'veg'
    },
})


module.exports = Addons