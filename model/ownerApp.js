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

// A change the owner made from the app, until the outlet PC has pulled it
// (migration 20261005140000). entity = the sync entity name
// (controller/sync/syncRegistry.js), item_id = this server's row id. The
// sync pull sets synced_at when it serves that row to the outlet's PC.
const OwnerChange = sequelize.define("owner_change", {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    hotel_id: { type: DataTypes.INTEGER, allowNull: false },
    entity: { type: DataTypes.STRING(40), allowNull: false },
    item_id: { type: DataTypes.INTEGER, allowNull: false },
    label: { type: DataTypes.STRING(120), allowNull: false, defaultValue: "" },
    synced_at: { type: DataTypes.DATE, allowNull: true },
}, {
    tableName: "owner_changes",
    indexes: [{ fields: ["hotel_id", "entity", "synced_at"], name: "owner_changes_pending" }],
});

// Owner App alerts (phase 4, migration 20261005150000). One row per owner
// (10-digit mobile) per event; `ref` makes each event unique per owner, so
// a re-scan or a late upload never alerts twice. Pushed to the owner's
// phones when created (ownerv1/push.js).
const OwnerAlert = sequelize.define("owner_alert", {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    owner_mobile: { type: DataTypes.STRING(15), allowNull: false },
    hotel_id: { type: DataTypes.INTEGER, allowNull: true },
    // pc-offline | pc-online | cancel-after-kot | discount | edited | cash-diff | low-stock | summary
    kind: { type: DataTypes.STRING(24), allowNull: false },
    ref: { type: DataTypes.STRING(120), allowNull: false },
    title: { type: DataTypes.STRING(160), allowNull: false },
    body: { type: DataTypes.STRING(400), allowNull: false, defaultValue: "" },
    link: { type: DataTypes.STRING(160), allowNull: false, defaultValue: "/alerts" },
    event_at: { type: DataTypes.DATE, allowNull: false },
    read_at: { type: DataTypes.DATE, allowNull: true },
    pushed: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
}, {
    tableName: "owner_alerts",
    indexes: [
        { unique: true, fields: ["owner_mobile", "ref"], name: "owner_alerts_owner_ref" },
        { fields: ["owner_mobile", "event_at"], name: "owner_alerts_owner_time" },
    ],
});

// The owner's alert rules (one row per owner mobile; JSON, defaults in
// ownerv1/alerts.js RULE_DEFAULTS).
const OwnerSetting = sequelize.define("owner_setting", {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    owner_mobile: { type: DataTypes.STRING(15), allowNull: false, unique: "owner_settings_mobile" },
    rules: { type: DataTypes.TEXT, allowNull: true },
}, { tableName: "owner_settings" });

// An outlet PC's offline spells (no heartbeat for over 3 minutes), for the
// PC screen's history and the offline / back-online alerts.
const OwnerOfflinePeriod = sequelize.define("owner_offline_period", {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    hotel_id: { type: DataTypes.INTEGER, allowNull: false },
    started_at: { type: DataTypes.DATE, allowNull: false },
    ended_at: { type: DataTypes.DATE, allowNull: true },
}, {
    tableName: "owner_offline_periods",
    indexes: [{ fields: ["hotel_id", "started_at"], name: "owner_offline_hotel_start" }],
});

module.exports = { OwnerDevice, OwnerStockLevel, OwnerStockDay, OwnerChange, OwnerAlert, OwnerSetting, OwnerOfflinePeriod };
