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
    },
    // Sync engine v2 (controller/sync/*) - the exe's own row id for this
    // row, the idempotency key for a repeat push. See migration
    // 20260916100000 for why this table needs it.
    local_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
    },
    // Display order (Table Category screen, table grid section tabs/list) -
    // same idea as Menu_categ's own rank. Synced both ways like every other
    // column here (controller/sync/syncRegistry.js's generic push/pull).
    rank: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
    },
})



module.exports = TableCatagories


