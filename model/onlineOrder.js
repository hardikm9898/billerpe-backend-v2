
const { DataTypes } = require('sequelize');
const sequelize = require("../connection/connect")

const { ORDER_TYPE } = require('../constant/const');

const OnlineOrderDetails = require('./onlineOrderDetails');

const OnlineOrders = sequelize.define("hms_online_order_mst", {

    id: {
        type: DataTypes.DOUBLE,
        primaryKey: true,
        autoIncrement: true
    },
    zomato_id: {
        type: DataTypes.DOUBLE,
        defaultValue: 0
    },
    bill_no: {
        type: DataTypes.STRING,
        defaultValue: '0'
    },
    resId: {
        type: DataTypes.STRING,
        defaultValue: null
    },
    status: {
        type: DataTypes.STRING,
        defaultValue: ""
    },
    creator_name: {
        type: DataTypes.STRING,
        defaultValue: ""
    },
    rider_name: {
        type: DataTypes.STRING,
        defaultValue: ''
    },
    address: {
        type: DataTypes.STRING,
        defaultValue: ''
    },
    rider_number: {
        type: DataTypes.DOUBLE,
        defaultValue: 0
    },
    paymentMethod: {
        type: DataTypes.STRING,
        defaultValue: ""
    },
    order_message: {
        type: DataTypes.STRING,
        defaultValue: ""
    },
    totalDiscount: {
        type: DataTypes.DOUBLE,
        defaultValue: 0
    },
    sub_total: {
        type: DataTypes.DOUBLE,
        defaultValue: 0
    },
    gst: {
        type: DataTypes.DOUBLE,
        defaultValue: 0
    },
    grandAmount: {
        type: DataTypes.DOUBLE,
        defaultValue: 0
    },
    otp: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    },
    order_type: {
        type: DataTypes.STRING,
        defaultValue: ORDER_TYPE.DELIVERY
    },

    preparation_time: {
        type: DataTypes.DATE,
        defaultValue: new Date
    },
    deleted: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    clientUpdatedStatus: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    }

})


// OnlineOrders.hasMany(OnlineOrderDetails, { foreignKey: 'orderId', onDelete: "SET NULL", onUpdate: 'CASCADE' });
// OnlineOrderDetails.belongsTo(OnlineOrders, {
//     foreignKey: "orderId",
//     as: "order", onDelete: "SET NULL", onUpdate: 'CASCADE'
// });

module.exports = OnlineOrders   