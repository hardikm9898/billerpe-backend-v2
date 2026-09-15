const { DataTypes } = require('sequelize');
const sequelize = require("../connection/connect");
const Addons = sequelize.define("hms_addon_mst", {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    // Task 10 (menu catalogue push) - see model/recipes.js's local_id comment.
    local_id: {
        type: DataTypes.INTEGER,
        allowNull: true
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