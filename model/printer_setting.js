const { DataTypes } = require('sequelize');
const sequelize = require("../connection/connect");

const PrinterSetting = sequelize.define("hms_printer_setting", {

    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false
    },

    printer_name: {
        type: DataTypes.STRING,
    },

    print_type: {
        type: DataTypes.ENUM,
        values: ["K", "I"],
        allowNull: false
    },

    printer_size: {
        type: DataTypes.ENUM,
        values: ['2', '3', '4'],
        defaultValue: '3'
    },

    number_of_copies: {
        type: DataTypes.INTEGER,
        defaultValue: 1
    },

    multi: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },

    default: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },

    table_ids: {
        type: DataTypes.JSON,
        defaultValue: [],
    },

    menu_categ_ids: {
        type: DataTypes.JSON,
        defaultValue: [],
    },
    item_ids: {
        type: DataTypes.JSON,
        defaultValue: []
    }
    ,
    order_type: {
        type: DataTypes.JSON,
        defaultValue: []
    }

});

module.exports = PrinterSetting;