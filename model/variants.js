const { DataTypes } = require('sequelize');
const sequelize = require("../connection/connect");
const HotelUser = require('./hotelUser');


const Variants = sequelize.define("hms_variant_mst", {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
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