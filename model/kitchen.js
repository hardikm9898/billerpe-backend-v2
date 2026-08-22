const { DataTypes } = require('sequelize');
const sequelize = require("../connection/connect");

const KitchenSetting = sequelize.define("hms_kitchen_setting", {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false
    },
    kitchen_name: {
        type: DataTypes.STRING,
    },
    table_ids: {
        type: DataTypes.JSON,
        defaultValue: [],
    },

    menu_categ_ids: {
        type: DataTypes.JSON,
        defaultValue: [],
    },
    order_type: {
        type: DataTypes.JSON,
        defaultValue: []
    }
});

module.exports = KitchenSetting;