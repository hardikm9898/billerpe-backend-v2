const { DataTypes } = require("sequelize");
const sequelize = require("../connection/connect");

// Tables used only by the BillerPe Owner App (Plan 1 owners, /owner/v1).
// Created by migration 20261005100000-create-owner-devices (and by boot sync
// on a fresh DB).

// One row per phone an owner is logged in on. The owner is a PERSON (their
// mobile), not an outlet: one login covers every Plan 1 outlet whose
// owner_number is that mobile. Logging out revokes the row, which ends the
// token; changing the password at the outlet ends it too (password_fp).
const OwnerDevice = sequelize.define("owner_device", {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    // Last 10 digits of the owner's mobile.
    owner_mobile: { type: DataTypes.STRING(15), allowNull: false },
    // The staff row whose password was used to log in (hms_hotelUser_masters.id).
    hotel_user_id: { type: DataTypes.INTEGER, allowNull: false },
    // Fingerprint of that row's password hash at login.
    password_fp: { type: DataTypes.STRING(16), allowNull: false },
    device_id: { type: DataTypes.STRING(64), allowNull: false },
    name: { type: DataTypes.STRING(80), allowNull: false, defaultValue: "" },
    make: { type: DataTypes.STRING(60), allowNull: false, defaultValue: "" },
    model: { type: DataTypes.STRING(60), allowNull: false, defaultValue: "" },
    android: { type: DataTypes.STRING(20), allowNull: false, defaultValue: "" },
    app_version: { type: DataTypes.STRING(20), allowNull: false, defaultValue: "" },
    // Firebase Cloud Messaging token (BillerPe Owner Firebase project).
    push_token: { type: DataTypes.STRING(255), allowNull: true },
    language: { type: DataTypes.STRING(8), allowNull: false, defaultValue: "en" },
    // active | revoked
    status: { type: DataTypes.STRING(16), allowNull: false, defaultValue: "active" },
    last_active: { type: DataTypes.DATE, allowNull: true },
}, {
    tableName: "owner_devices",
    indexes: [
        { unique: true, fields: ["owner_mobile", "device_id"], name: "owner_devices_mobile_device" },
        { fields: ["owner_mobile", "status"], name: "owner_devices_mobile_status" },
    ],
});

// Stock of a Plan 1 outlet as its PC last uploaded it (billerpe-local-exe
// services/sync/pushStock.js, migration 20261005130000). The PC owns its
// stock; these are read-only copies for the owner's phone, never pulled back.
// item_id is the cloud id of the raw material (kind "raw") or semi-finished
// item ("semi"). One row per item; replaced whole on every snapshot.
const OwnerStockLevel = sequelize.define("owner_stock_level", {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    hotel_id: { type: DataTypes.INTEGER, allowNull: false },
    kind: { type: DataTypes.STRING(8), allowNull: false },
    item_id: { type: DataTypes.INTEGER, allowNull: false },
    // consumption unit (the unit the apps show)
    qty: { type: DataTypes.DOUBLE, allowNull: false, defaultValue: 0 },
    // per consumption unit
    cost: { type: DataTypes.DOUBLE, allowNull: false, defaultValue: 0 },
    value: { type: DataTypes.DOUBLE, allowNull: false, defaultValue: 0 },
}, {
    tableName: "owner_stock_levels",
    indexes: [{ fields: ["hotel_id"], name: "owner_stock_levels_hotel" }],
});

// Per business day, per item: the stock ledger's columns (purchase units,
// like the PC's own ledger). A day is replaced whole when the PC sends it.
// Opening of any period = the sum of every day before it.
const OwnerStockDay = sequelize.define("owner_stock_day", {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    hotel_id: { type: DataTypes.INTEGER, allowNull: false },
    business_date: { type: DataTypes.DATEONLY, allowNull: false },
    kind: { type: DataTypes.STRING(8), allowNull: false },
    item_id: { type: DataTypes.INTEGER, allowNull: false },
    purchased_qty: { type: DataTypes.DOUBLE, allowNull: false, defaultValue: 0 },
    purchased_value: { type: DataTypes.DOUBLE, allowNull: false, defaultValue: 0 },
    used_qty: { type: DataTypes.DOUBLE, allowNull: false, defaultValue: 0 },
    used_value: { type: DataTypes.DOUBLE, allowNull: false, defaultValue: 0 },
    wastage_qty: { type: DataTypes.DOUBLE, allowNull: false, defaultValue: 0 },
    wastage_value: { type: DataTypes.DOUBLE, allowNull: false, defaultValue: 0 },
    manual_qty: { type: DataTypes.DOUBLE, allowNull: false, defaultValue: 0 },
    manual_value: { type: DataTypes.DOUBLE, allowNull: false, defaultValue: 0 },
    opening_entry_qty: { type: DataTypes.DOUBLE, allowNull: false, defaultValue: 0 },
    opening_entry_value: { type: DataTypes.DOUBLE, allowNull: false, defaultValue: 0 },
}, {
    tableName: "owner_stock_days",
    indexes: [{ fields: ["hotel_id", "business_date"], name: "owner_stock_days_hotel_date" }],
});

module.exports = { OwnerDevice, OwnerStockLevel, OwnerStockDay };
