const { DataTypes } = require('sequelize');
const sequelize = require("../connection/connect");

const WebSiteProducts = sequelize.define("hms_website_products", {

    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false
    },
    title: { type: DataTypes.STRING, defaultValue: "" },
    images: {
        type: DataTypes.JSON,
        defaultValue: []
    },
    keyFeatures: {
        type: DataTypes.JSON,
        defaultValue: []
    },
    price: {
        type: DataTypes.FLOAT,
        defaultValue: 0
    },
    offer_active: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    offer_price: {
        type: DataTypes.FLOAT,
        defaultValue: 0
    },
    offer: {
        type: DataTypes.STRING,
        defaultValue: ""
    },
    status: {
        type: DataTypes.BOOLEAN,
        defaultValue: true
    },

});

module.exports = WebSiteProducts;