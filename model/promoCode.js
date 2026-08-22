const { DataTypes } = require('sequelize');
const sequelize = require("../connection/connect");

const PromoCode = sequelize.define("hms_promo_code", {

    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false
    },

    promo_code_name: {
        type: DataTypes.STRING,
    },

    promo_code: {
        type: DataTypes.STRING,
    },

    discount_type: {
        type: DataTypes.ENUM,
        values: ['fix', 'pr'],
        defaultValue: 'fix'
    },

    discount_value: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    },

    status: {
        type: DataTypes.BOOLEAN,
        defaultValue: true
    },

});

module.exports = PromoCode;