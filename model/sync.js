const { DataTypes } = require("sequelize")
const sequelize = require("../connection/connect");

const SyncIndexDB = sequelize.define("hms_sync_index_mst", {

    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    hotel_id: { type: DataTypes.INTEGER, defaultValue: 0, },
    menu_version: {
        type: DataTypes.INTEGER, defaultValue: 1
    },
    menu_categ_version: {
        type: DataTypes.DOUBLE, defaultValue: 1
    }
})

module.exports = SyncIndexDB

