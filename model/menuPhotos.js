const { DataTypes } = require("sequelize");
const sequelize = require("../connection/connect");

// BillerPe's menu photo library (owner 2026-10-09): photos are uploaded only
// from SuperAdmin, resized to one standard size and kept in S3; outlets
// search and pick, never upload. Schema owned by migration
// 20261019100000-menu-photos; listed in server.js TABLES_TO_SKIP_ALTER.

const T = DataTypes;

// name = as shown ("Paneer Tikka"); search_key = the name folded for search
// (one row per key: "Paneer Tikka" twice is refused); aliases = extra search
// words, comma separated ("panir tikka, paneer tika"). url = the standard
// photo, thumb = the small one billing tiles use. veg: veg | nonveg | egg | ''.
// legacy_id = the hms_image_msts row it came from (the old panel's library).
// uses = outlets whose menu shows it (recounted by the job menu.photos).
const MenuPhoto = sequelize.define("menu_photo", {
    id: { type: T.INTEGER, primaryKey: true, autoIncrement: true },
    name: { type: T.STRING(120), allowNull: false },
    search_key: { type: T.STRING(140), allowNull: false, unique: "menu_photos_key" },
    aliases: { type: T.STRING(500), allowNull: false, defaultValue: "" },
    veg: { type: T.STRING(8), allowNull: false, defaultValue: "" },
    cuisine: { type: T.STRING(40), allowNull: false, defaultValue: "" },
    url: { type: T.STRING(255), allowNull: false },
    thumb: { type: T.STRING(255), allowNull: false },
    bytes: { type: T.INTEGER, allowNull: false, defaultValue: 0 },
    legacy_id: { type: T.INTEGER, allowNull: true },
    uses: { type: T.INTEGER, allowNull: false, defaultValue: 0 },
    active: { type: T.BOOLEAN, allowNull: false, defaultValue: true },
    created_by: { type: T.INTEGER, allowNull: true },
}, { tableName: "menu_photos", indexes: [{ fields: ["active"], name: "menu_photos_active" }, { fields: ["url"], name: "menu_photos_url" }] });

// An outlet asked for a photo the library does not have. status: open | done
// (a photo was set on the item) | closed (not uploaded, with a reason).
const MenuPhotoRequest = sequelize.define("menu_photo_request", {
    id: { type: T.INTEGER, primaryKey: true, autoIncrement: true },
    hotel_id: { type: T.INTEGER, allowNull: false },
    menu_id: { type: T.INTEGER, allowNull: true },
    item_name: { type: T.STRING(120), allowNull: false },
    search_key: { type: T.STRING(140), allowNull: false },
    status: { type: T.STRING(8), allowNull: false, defaultValue: "open" },
    asked_by: { type: T.STRING(80), allowNull: false, defaultValue: "" },
    photo_id: { type: T.INTEGER, allowNull: true },
    note: { type: T.STRING(200), allowNull: false, defaultValue: "" },
    done_by: { type: T.INTEGER, allowNull: true },
    done_at: { type: T.DATE, allowNull: true },
}, { tableName: "menu_photo_requests", indexes: [{ fields: ["status", "search_key"], name: "menu_photo_requests_status" }, { fields: ["hotel_id"], name: "menu_photo_requests_hotel" }] });

module.exports = { MenuPhoto, MenuPhotoRequest };
