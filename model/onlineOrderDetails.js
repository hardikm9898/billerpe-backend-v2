const { DataTypes } = require('sequelize');
const sequelize = require("../connection/connect");



const OnlineOrderDetails = sequelize.define("hms_online_orderDetails_mst", {
    id: {
        type: DataTypes.DOUBLE,
        autoIncrement: true,
        primaryKey: true,
    },
    zomato_id: {
        type: DataTypes.STRING,
        defaultValue: ''
    },
    item_name: {
        type: DataTypes.STRING,
        defaultValue: ""
    },
    qty: {
        type: DataTypes.INTEGER,
        defaultValue: 1
    },
    unitCost: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    },
    totalCost: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    },

});


module.exports = OnlineOrderDetails;
