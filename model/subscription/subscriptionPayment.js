const { DataTypes, Sequelize } = require("sequelize");
const sequelize = require("../../connection/connect");
const Subscription = require("./subscription");

const SubscriptionPayment = sequelize.define('hms_subscription_payment', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    amount_paid: {
        type: DataTypes.DOUBLE,
        allowNull: false
    },
    payment_date: {
        type: DataTypes.DATE,
        defaultValue: new Date()
    },
    payment_method: {
        type: DataTypes.STRING,
        allowNull: true
    },
    payment_image: {
        type: DataTypes.STRING,
        allowNull: true
    },
    UTR_No: {
        type: DataTypes.STRING,
        allowNull: true
    },
    note: {
        type: DataTypes.STRING,
        allowNull: true
    }
});


module.exports = SubscriptionPayment;
