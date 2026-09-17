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
    },
    // Sync engine v2 (controller/sync/*) - the exe's own row id for this
    // row, the idempotency key for a repeat push. See migration
    // 20260916100000 for why this table needs it.
    local_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
    },
});

module.exports = KitchenSetting;