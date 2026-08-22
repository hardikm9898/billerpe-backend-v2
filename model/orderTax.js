
const { DataTypes } = require("sequelize")
const sequelize = require("../connection/connect")
const Order = require("./order")
const TaxType = require("./taxType")




const OrderTax = sequelize.define("hms_order_tax_mst", {

    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    amount: {
        type: DataTypes.DOUBLE,
        defaultValue: 0
    },
    tax_type: {
        type: DataTypes.STRING,
        values: ["fix", "pr"],
        defaultValue: "pr"
    },
    tax_value: {
        type: DataTypes.DOUBLE,
        defaultValue: 0
    }
})


// OrderTax.belongsTo(Order, { foreignKey: "hmsOrderMstId" });
// Order.hasMany(OrderTax, { foreignKey: "hmsOrderMstId" });


// OrderTax.belongsTo(TaxType, { foreignKey: "hmsTaxTypeMstId" });

// // TaxType has many OrderTax records
// TaxType.hasMany(OrderTax, { foreignKey: "hmsTaxTypeMstId" });

module.exports = OrderTax

