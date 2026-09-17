
const { DataTypes } = require("sequelize")
const sequelize = require("../connection/connect");
const OrderTax = require("./orderTax");




const TaxType = sequelize.define("hms_tax_type_mst", {

    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    tax_name: {
        type: DataTypes.STRING,
    },
    tax_value: {
        type: DataTypes.STRING,
        values: ["fix", "pr"],
        defaultValue: "pr"
    },
    amount: {
        type: DataTypes.DOUBLE,
        defaultValue: 0
    },
    order_type: {
        type: DataTypes.JSON,
        defaultValue: []
    },
    active: {
        type: DataTypes.BOOLEAN,
        defaultValue: true
    }
    , table_categ_ids: {
        type: DataTypes.JSON,
        defaultValue: [],
    },
    menu_ids: {
        type: DataTypes.JSON,
        defaultValue: [],
    },
    // Sync engine v2 (controller/sync/*) - the exe's own row id for this
    // row, the idempotency key for a repeat push. See migration
    // 20260916100000 for why this table needs it.
    local_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
    },
})

module.exports = TaxType

