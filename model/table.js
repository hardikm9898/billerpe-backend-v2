const { DataTypes } = require("sequelize")
const sequelize = require("../connection/connect")

const TableCatagories = require("./table_catg");
const { types } = require("joi");


const Table = sequelize.define("hms_table_mst", {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    table_name: {
        type: DataTypes.STRING,
    },

    capacity: {
        type: DataTypes.INTEGER,

    },
    table_status: {
        type: DataTypes.ENUM,
        values: ["R", "F", "P", "H", "B"], // R-Running F-free P-settle pending H-hold B- booked table
        defaultValue: "F"
    },
    active: {
        type: DataTypes.BOOLEAN,
        defaultValue: true
    },
    type: {
        type: DataTypes.ENUM,
        values: ["R", "T"], //
        defaultValue: "T"
    },
    // QR table ordering - see migrations/20260908130000-add-qr-version-to-table.js
    // and controller/qrOrder.js's createQrOrder for why this exists (the
    // one lever to kill a specific leaked/abused table's QR link).
    qr_version: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 1,
    }

})



module.exports = Table

