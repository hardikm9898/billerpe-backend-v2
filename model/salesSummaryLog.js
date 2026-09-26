const { DataTypes } = require("sequelize");
const sequelize = require("../connection/connect");

// One row per outlet per business day: the owner's WhatsApp sales summary for
// that day. The row is claimed before sending, so a restart or a second server
// process never sends the same day twice. Created by migration
// 20260926160000-sales-summary-log (the unique index comes from there).
const SalesSummaryLog = sequelize.define("hms_sales_summary_log", {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    hotel_id: { type: DataTypes.INTEGER, allowNull: false },
    business_date: { type: DataTypes.DATEONLY, allowNull: false },
    // sending | sent | failed
    status: { type: DataTypes.STRING(10), allowNull: false, defaultValue: "sending" },
    attempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    next_try_at: { type: DataTypes.DATE, allowNull: true },
    message_id: { type: DataTypes.STRING(120), allowNull: true },
    error: { type: DataTypes.STRING(255), allowNull: true },
}, {
    tableName: "hms_sales_summary_logs",
    indexes: [{ unique: true, fields: ["hotel_id", "business_date"], name: "hms_sales_summary_logs_hotel_day" }],
});

module.exports = SalesSummaryLog;
