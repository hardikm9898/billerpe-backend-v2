const { DataTypes } = require('sequelize');
const sequelize = require("../connection/connect");
const HotelUser = require('./hotelUser');


const Variants = sequelize.define("hms_variant_mst", {
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
    variants_name: {
        type: DataTypes.STRING,
        allowNull: false
    },
    active: {
        type: DataTypes.BOOLEAN,
        defaultValue: true
    },
})


module.exports = Variants