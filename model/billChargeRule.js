const { DataTypes } = require("sequelize");
const sequelize = require("../connection/connect");

// Delivery and Packaging charge rules - same field shape as
// hms_serviceCharge_mst (model/serviceCharge.js), which
// billerpe-pos-pro-v2's own BillChargeRule/ServiceChargeRule types already
// mirror 1:1 on the frontend. Unlike ServiceCharge (Hotel.hasOne, exactly
// one row per hotel), this needs two independent rows per hotel - one for
// delivery, one for packaging - so it's Hotel.hasMany with a `rule_for`
// discriminator instead of a second near-duplicate table.
const BillChargeRule = sequelize.define("hms_bill_charge_mst", {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
    },
    rule_for: {
        type: DataTypes.ENUM,
        values: ["delivery", "packaging"],
        allowNull: false,
    },
    active: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
    },
    charge_type: {
        type: DataTypes.ENUM,
        values: ["fixed", "percentage"],
        defaultValue: "fixed",
    },
    charge_value: {
        type: DataTypes.DOUBLE,
        defaultValue: 0,
    },
    calculation_on: {
        type: DataTypes.ENUM,
        values: ["core", "total"],
        defaultValue: "core",
    },
    charge_automatic: {
        type: DataTypes.JSON,
        defaultValue: [],
    },
    calculation_on_tax: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
    },
    greater_less: {
        type: DataTypes.ENUM,
        values: ["1", "2", "3"],
        defaultValue: "3",
    },
    greater_less_amount: {
        type: DataTypes.DOUBLE,
        defaultValue: 0,
    },
    enter_by: {
        type: DataTypes.STRING,
    },
});

module.exports = BillChargeRule;
