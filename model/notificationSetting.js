const { DataTypes } = require("sequelize");
const sequelize = require("../connection/connect");

// Per-hotel, per-trigger, per-channel notification toggle. Confirmed
// nothing like this existed anywhere before (no RestaurantSetting column,
// no per-hotel config table) - the 6 triggers are the same fixed set
// billerpe-pos-pro-v2's own mock/data.ts already seeds (Order settled, KOT
// ready, Low stock, Sync failure, Cash variance, Reservation reminder), so
// this is a management-list-only build: it persists what a hotel WANTS
// sent, matching this app's own toggleNotificationSetting UI, but doesn't
// itself wire up any real WhatsApp/SMS sending logic - those remain the
// separate, hardcoded call sites they already were (WhatsApp fixed at its
// call sites, SMS dead/commented-out code), unchanged by this table.
const NotificationSetting = sequelize.define("hms_notification_setting_mst", {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
    },
    trigger: {
        type: DataTypes.STRING,
        allowNull: false,
    },
    whatsapp: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
    },
    sms: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
    },
    in_app: {
        type: DataTypes.BOOLEAN,
        defaultValue: true,
    },
    // Sync engine v2 (controller/sync/*) - the exe's own row id, the
    // idempotency key for a repeat push. See migration 20260916100000.
    local_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
    },
});

module.exports = NotificationSetting;
