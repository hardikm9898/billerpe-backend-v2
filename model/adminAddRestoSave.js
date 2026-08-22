const { DataTypes } = require('sequelize');
const sequelize = require("../connection/connect");
const { DATE } = require('sequelize/lib/data-types');

const AdminAddRestoSave = sequelize.define("hms_admin_save_mst", {
    id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
    },
    userId: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    },
    hotel_name: { type: DataTypes.STRING, defaultValue: "" },
    owner_name: { type: DataTypes.STRING, defaultValue: "" },
    owner_number: { type: DataTypes.DOUBLE, defaultValue: 0 },
    owner_email_id: { type: DataTypes.STRING, defaultValue: "" },
    address1: { type: DataTypes.STRING, defaultValue: "" },
    address2: { type: DataTypes.STRING, defaultValue: "" },
    pinCode: { type: DataTypes.INTEGER, defaultValue: 0 },
    contact1: { type: DataTypes.DOUBLE, defaultValue: 0 },
    contact2: { type: DataTypes.DOUBLE, defaultValue: 0 },
    email_id: { type: DataTypes.STRING, defaultValue: "" },
    gst_no: { type: DataTypes.STRING, defaultValue: "" },
    gst_reg_name: { type: DataTypes.STRING, defaultValue: "" },
    hotel_logo: { type: DataTypes.STRING, defaultValue: "" },
    fssai_no: { type: DataTypes.STRING, defaultValue: "" },
    hotel_reg_date: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
    password: { type: DataTypes.STRING, defaultValue: "" },
    plan_id: { type: DataTypes.INTEGER, defaultValue: 0 },
    name: { type: DataTypes.STRING, defaultValue: "" },
    plan_start_date: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
    plan_end_date: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
    discount: { type: DataTypes.ENUM("fix", "pr") },
    discountrate: { type: DataTypes.INTEGER, defaultValue: 0 },
    discountValue: { type: DataTypes.INTEGER, defaultValue: 0 },
    subTotal: { type: DataTypes.DOUBLE, defaultValue: 0 },
    grandAmount: { type: DataTypes.DOUBLE, defaultValue: 0 },
    gst_calculated: { type: DataTypes.BOOLEAN, defaultValue: true },
    gst: { type: DataTypes.DOUBLE, defaultValue: 0 },
    amount_paid: { type: DataTypes.DOUBLE, defaultValue: 0 },
    UTR_No: { type: DataTypes.STRING, defaultValue: "" }, // better to keep as string if it contains numbers with leading zeros
    payment_image: { type: DataTypes.STRING, defaultValue: "" },
    payment_date: { type: DATE, defaultValue: new Date() }
});

module.exports = AdminAddRestoSave;
