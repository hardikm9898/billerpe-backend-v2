
const { Sequelize, DataTypes } = require('sequelize');
const sequelize = require("../connection/connect");
const User = require("./user");
const Table = require('./table');
const { MESSAGE, STATUS } = require('../constant/const');
const Hotel = require('./hotel');
const OrderDetails = require("../model/order_details");
const HotelUser = require('./hotelUser');
const moment = require("moment")

const Order = sequelize.define("hms_order_mst", {

    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    totalAmount: {
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
    order_type: {
        type: DataTypes.STRING,
    },
    bill_no: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: '0000'
    },
    isOffline: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    payment: {
        type: DataTypes.STRING,
        defaultValue: STATUS.PENDING
    },
    status: {
        type: DataTypes.STRING,
        defaultValue: STATUS.DISPATCH
    },
    payment_type: {
        type: DataTypes.STRING,
        defaultValue: null
    },
    cash: {
        type: DataTypes.DOUBLE,
        defaultValue: 0
    },
    upi: {
        type: DataTypes.DOUBLE,
        defaultValue: 0
    },
    card: {
        type: DataTypes.DOUBLE,
        defaultValue: 0
    },
    due: {
        type: DataTypes.DOUBLE,
        defaultValue: 0
    },
    total_sgst: {
        type: DataTypes.DOUBLE,
        defaultValue: 0
    },
    total_cgst: {
        type: DataTypes.DOUBLE,
        defaultValue: 0
    },
    deleted: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    totalDiscount: {
        type: DataTypes.DOUBLE,
        defaultValue: 0
    },
    discount_reason: {
        type: DataTypes.STRING,
        defaultValue: ""
    },
    discount_value: {
        type: DataTypes.FLOAT,
        defaultValue: 0
    },
    version:{
        type:DataTypes.INTEGER,
        defaultValue:0
    },
    discount_type: {
        type: DataTypes.ENUM,
        values: ['fix', 'pr'],
        defaultValue: 'fix'
    },
    token: { type: DataTypes.INTEGER, defaultValue: 0 },
    created_from: {
        type: DataTypes.STRING,
        defaultValue: "web"
    },
    tableTime: { type: DataTypes.DATE, defaultValue: new Date() },
    table_time_sated: { type: DataTypes.BOOLEAN, defaultValue: false },
    timeOver: {
        type: DataTypes.BOOLEAN, defaultValue: false
    },
    service_charge: {
        type: DataTypes.DOUBLE,
        defaultValue: 0
    },
    business_date: {
        type: DataTypes.DATEONLY,
        defaultValue: () => moment().format("YYYY-MM-DD"),
        index: true
    }
},
    {
        indexes: [
            { fields: ["hotel_id", "business_date"] },             // existing — date-range queries
            { fields: ["hotel_id", "payment", "deleted"] },        // dashboard sum/count (most critical)
            { fields: ["hotel_id", "order_type", "payment"] },     // dine-in / pickup breakdown
            { fields: ["hotel_id", "status", "deleted"] },         // active order listing
            { fields: ["TableId", "payment"] },                    // table-level order lookups
        ],
        hooks: {
            beforeValidate(order) {
                if (
                    order.discount_type === 'fix' &&
                    (!order.discount_value || order.discount_value === 0)
                ) {
                    order.discount_value = order.totalDiscount;
                }
            },

            // fires when Order.update() static method is used
            beforeBulkUpdate(options) {
                options.attributes.version = sequelize.literal('version + 1');
            },
            beforeUpdate(order) {
                if (
                    order.discount_type === 'fix' &&
                    (!order.discount_value || order.discount_value === 0)
                ) {
                    order.discount_value = order.totalDiscount;
                }
                order.version = sequelize.literal('version + 1');
            },

        }
    }
)



module.exports = Order