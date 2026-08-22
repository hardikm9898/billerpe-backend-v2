const { Sequelize, DataTypes } = require("sequelize")
const sequelize = require("../connection/connect")
const Hotel = require("./hotel")
const Table = require("./table")

const TableCatagories = sequelize.define("hms_table_categ", {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    table_catag_nm: {
        type: DataTypes.STRING,
        allowNull: false
    },
    enter_by: {
        type: DataTypes.STRING,
    },
    // hotel_id: {
    //     type: DataTypes.INTEGER,
    //     references: {
    //         model: Hotel,
    //         key: "id"
    //     },
    //     allowNull: false
    // },
    active: {
        type: DataTypes.BOOLEAN,
        defaultValue: true
    },
    type: {
        type: DataTypes.ENUM,
        values: ["R", "T"],
        defaultValue: "T"
    }

})



module.exports = TableCatagories


