const { DataTypes } = require("sequelize");
const sequelize = require("../connection/connect");

// Tables used only by the BillerPe POS App (Plan 2, /app/v1). Created by
// migration 20260926100000-plan2-pos-app (and by boot sync on a fresh DB).

// One row per phone/tablet logged in to an outlet. The per-outlet limit is
// Hotel.app_device_limit (superadmin). Printers are set up per device (owner
// decision: the phone that sends a KOT prints it on its own printers).
const AppDevice = sequelize.define("app_device", {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    hotel_id: { type: DataTypes.INTEGER, allowNull: false },
    device_id: { type: DataTypes.STRING(64), allowNull: false },
    name: { type: DataTypes.STRING(80), allowNull: false, defaultValue: "" },
    make: { type: DataTypes.STRING(60), allowNull: false, defaultValue: "" },
    model: { type: DataTypes.STRING(60), allowNull: false, defaultValue: "" },
    android: { type: DataTypes.STRING(20), allowNull: false, defaultValue: "" },
    app_version: { type: DataTypes.STRING(20), allowNull: false, defaultValue: "" },
    hotel_user_id: { type: DataTypes.INTEGER, allowNull: true },
    last_active: { type: DataTypes.DATE, allowNull: true },
    // JSON DevicePrinter[] (BillerPe POS App src/lib/pos/types.ts)
    printers: { type: DataTypes.TEXT("long"), allowNull: true },
    print_kots: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    // active | revoked (logged out by the owner - its token stops working)
    status: { type: DataTypes.STRING(16), allowNull: false, defaultValue: "active" },
}, {
    tableName: "app_devices",
    indexes: [{ unique: true, fields: ["hotel_id", "device_id"], name: "app_devices_hotel_device" }],
});

// One-time request keys: a retried tap (weak mobile data) is applied once.
const AppClientKey = sequelize.define("app_client_key", {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    hotel_id: { type: DataTypes.INTEGER, allowNull: false },
    client_key: { type: DataTypes.STRING(80), allowNull: false },
    result: { type: DataTypes.TEXT("long"), allowNull: true },
}, {
    tableName: "app_client_keys",
    indexes: [{ unique: true, fields: ["hotel_id", "client_key"], name: "app_client_keys_hotel_key" }],
});

// Walk-in waitlist.
const AppQueueEntry = sequelize.define("app_queue_entry", {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    hotel_id: { type: DataTypes.INTEGER, allowNull: false },
    name: { type: DataTypes.STRING(80), allowNull: false },
    mobile: { type: DataTypes.STRING(15), allowNull: false, defaultValue: "" },
    guests: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
    // waiting | called | seated | noshow | cancelled
    status: { type: DataTypes.STRING(16), allowNull: false, defaultValue: "waiting" },
    note: { type: DataTypes.STRING(200), allowNull: true },
    joined_at: { type: DataTypes.DATE, allowNull: false },
    called_at: { type: DataTypes.DATE, allowNull: true },
}, { tableName: "app_queue_entries", indexes: [{ fields: ["hotel_id", "status"] }] });

// In-app alerts: food ready (to the captain who sent it), bill requested
// (counter roles), QR order, reservation due. read_by = JSON [hotelUserId].
const AppAlert = sequelize.define("app_alert", {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    hotel_id: { type: DataTypes.INTEGER, allowNull: false },
    kind: { type: DataTypes.STRING(30), allowNull: false },
    title: { type: DataTypes.STRING(160), allowNull: false },
    body: { type: DataTypes.STRING(400), allowNull: false, defaultValue: "" },
    link: { type: DataTypes.STRING(160), allowNull: true },
    for_user_id: { type: DataTypes.INTEGER, allowNull: true },
    for_roles: { type: DataTypes.STRING(200), allowNull: true },
    read_by: { type: DataTypes.TEXT, allowNull: true },
}, { tableName: "app_alerts", indexes: [{ fields: ["hotel_id", "createdAt"] }] });

module.exports = { AppDevice, AppClientKey, AppQueueEntry, AppAlert };
