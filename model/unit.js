
const { DataTypes } = require("sequelize")
const sequelize = require("../connection/connect")



const Unit = sequelize.define("hms_unit_mst", {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    unit_name: {
        type: DataTypes.STRING,
        require: true
    },
    shortName: {
        type: DataTypes.STRING,
        require: true
    },
    // Sync engine v2 (controller/sync/*) - the exe's own row id for this
    // row, the idempotency key for a repeat push. See migration
    // 20260916100000 for why this table needs it.
    local_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
    },
})



module.exports = Unit

