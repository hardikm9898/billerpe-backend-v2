
const { DataTypes } = require("sequelize")
const sequelize = require("../connection/connect");
const HotelUser = require("./hotelUser");
const Order = require("./order");
const User = require("./user");
const moment = require("moment")


const DuePaymentReceive = sequelize.define("hms_due_payment_receive", {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    amount: {
        type: DataTypes.DOUBLE,
        defaultValue: 0,
    },
    business_date: {
        type: DataTypes.DATEONLY,
        defaultValue: () => moment().format("YYYY-MM-DD"),
        index: true
    },
    payment_mode: {
        type: DataTypes.STRING,
        allowNull: false
    },
    bill_no: {
        type: DataTypes.STRING,
        allowNull: false
    },
    deleted: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    // Sync engine v2: the outlet server's own id for a due it collected
    // (billerpe-local-exe model/dueReceipt.js), the idempotency key for a
    // repeat push. Migration 20261003100000.
    local_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
    }

})


module.exports = DuePaymentReceive

