const { Sequelize, DataTypes } = require('sequelize');
const sequelize = require("../connection/connect")
const Hotel = require("./hotel")
const menu_categ = require("../model/menu_categ");
const Menu_categ = require('../model/menu_categ');

const Menu = sequelize.define("hms_menu_mst", {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    // hotel_id: {
    //     type: DataTypes.INTEGER,
    //     references: {
    //         model: Hotel,
    //         key: "id"
    //     }
    // },
    // menu_categ_id: {
    //     type: DataTypes.INTEGER,
    //     references: {
    //         model: menu_categ,
    //         key: "id"
    //     }
    // },
    item_name: {
        type: DataTypes.STRING,
        allowNull: false
    },
    barcode_value:{
         type: DataTypes.STRING,
        defaultValue:''
    },
    price: {
        type: DataTypes.STRING,
        allowNull: false
    },
    foodImage: {
        type: DataTypes.STRING,

    },
    sub_categories: {
        type: DataTypes.STRING,
        defaultValue: "regular"
    },
    description: {
        type: DataTypes.STRING,
        defaultValue: ""
    },
    shortCode: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: "all"
    },
    gst_type: {
        type: DataTypes.ENUM,
        values: ['S', 'G'],
        defaultValue: "S"
    },
    active: {
        type: DataTypes.BOOLEAN,
        defaultValue: true
    },
    enter_by: {
        type: DataTypes.STRING
    },
    stockTrack: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    favorite: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    is_deleted: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    }
}, {
    indexes: [
        { fields: ["hotel_id", "active"] },                      // menu listing (most common query)
        { fields: ["hotel_id", "menu_categ_id", "active"] }      // category-filtered menu display
    ]
})

// Menu_categ.hasMany(Menu, {
//     foreignKey: 'menu_categ_id',
// });

// Menu.belongsTo(menu_categ, { foreignKey: 'menu_categ_id' })

module.exports = Menu