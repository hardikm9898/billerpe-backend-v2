
const { DataTypes } = require("sequelize")
const sequelize = require("../connection/connect")

const PurchaseRollsAndPrinter = sequelize.define("hms_purchase_roll_mst", {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    name: {
        type: DataTypes.STRING,
        require: true
    },
    email: { type: DataTypes.STRING, defaultValue: null },
    mobile: {
        type: DataTypes.DOUBLE,
        require: true
    },
    address1: {
        type: DataTypes.STRING,
        require: true
    },
    address2: {
        type: DataTypes.STRING,
        require: true
    },
    city: {
        type: DataTypes.STRING,
        require: true
    },
    state: {
        type: DataTypes.STRING,
        require: true
    },
    Country: { type: DataTypes.STRING, require: true },
    pincode: {
        type: DataTypes.INTEGER, require: true
    },
    items: {
        type: DataTypes.JSON,
        defaultValue: []
    },
    subtotal: {
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
    payment_status: {
        type: DataTypes.ENUM,
        values: ['pending', 'completed'],
        defaultValue: 'pending'
    },
    order_tracking_id: {
        type: DataTypes.STRING,
        defaultValue: ''
    },
    order_status: {
        type: DataTypes.ENUM,
        values: ['pending', 'shipped', 'delivered'],
        defaultValue: 'pending'
    },
    order_approval_status: {
        type: DataTypes.ENUM,
        values: ['pending', 'approved', 'rejected'],
        defaultValue: 'pending'
    },
    reject_reason: {
        type: DataTypes.STRING,
        defaultValue: ''
    }

}, {
    freezeTableName: true,
    // timestamps: false       
})


module.exports = PurchaseRollsAndPrinter

