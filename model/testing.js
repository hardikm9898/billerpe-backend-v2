const { DataTypes } = require('sequelize');
const sequelize = require("../connection/connect")


const Testing = sequelize.define("hms_testing_mst", {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    variants: {
        type: DataTypes.JSON,
        allowNull: true
    },


})

module.exports = Testing