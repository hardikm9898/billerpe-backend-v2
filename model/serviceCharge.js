const { DataTypes } = require("sequelize")
const sequelize = require("../connection/connect");
const Order = require("./order");
const Hotel = require("./hotel");



const ServiceCharge = sequelize.define("hms_serviceCharge_mst", {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    active: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },

    service_charge_type: {
        type: DataTypes.ENUM,
        values: ['fixed', 'percentage'],    // 0->pickup 1->dinin 2->both 3-->off
        defaultValue: 'fixed'
    },
    calculation_on: {
        type: DataTypes.ENUM,
        values: ['core', 'total'],    // 0->pickup 1->dinin 2->both 3-->off
        defaultValue: 'core'
    },
    service_charge_value: {
        type: DataTypes.DOUBLE,
        // 0->pickup 1->dinin 2->both 3-->off
        defaultValue: 0
    },
    service_charge_automatic: {
        type: DataTypes.JSON,
        defaultValue: ['']
    },

    calculation_on_tax: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    greater_less: {
        type: DataTypes.ENUM,
        values: ['1', '2', '3'],    // 1->greater 2->less 3-->none
        defaultValue: '3'
    },
    greater_less_amount: {
        type: DataTypes.DOUBLE,
        defaultValue: 0
    }

})

module.exports = ServiceCharge

