const { Sequelize, DataTypes } = require('sequelize');
const sequelize = require("../connection/connect")
const Hotel = require("./hotel");
const PrinterSetting = require('./printer_setting');

const Menu_categ = sequelize.define("hms_menu_categ", {
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
    // hotel_id: {
    //     type: DataTypes.INTEGER,
    //     references: {
    //         model: Hotel,
    //         key: "id"
    //     }
    // },
    rank: { type: DataTypes.INTEGER, defaultValue: 0 },
    active: {
        type: DataTypes.BOOLEAN, defaultValue: true
    },
    menu_categ_nm: {
        type: DataTypes.STRING
    },
    enter_by: {
        type: DataTypes.STRING
    },
    enter_dt: {
        type: DataTypes.DATE
    }
})

// PrinterSetting.belongsTo(Menu_categ, {
//     foreignKey: 'menu_categ_id', onDelete: 'CASCADE', onUpdate: 'CASCADE'
// }),
//     Menu_categ.hasOne(PrinterSetting, {
//         foreignKey: 'menu_categ_id', onDelete: 'CASCADE', onUpdate: 'CASCADE'
//     })

module.exports = Menu_categ