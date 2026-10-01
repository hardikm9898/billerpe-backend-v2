const { DataTypes } = require("sequelize");
const sequelize = require("../connection/connect");

// A file outlets download from the Web POS (Operations -> Apps & Downloads,
// owner decision 2026-10-01): the local server installer and the Captain App
// APK. Published with scripts/publish-app-download.js, kept on this server's
// disk (app-downloads/<app>/<version>/<file_name>) and handed to an outlet's
// exe with its device token (controller/sync/appDownloadController.js); the
// exe then serves it to the outlet's own PC and phones.
const AppDownload = sequelize.define("app_downloads", {
    // "exe-installer" or "captain-app".
    app: { type: DataTypes.STRING(32), allowNull: false },
    version: { type: DataTypes.STRING(64), allowNull: false },
    file_name: { type: DataTypes.STRING(128), allowNull: false },
    local_path: { type: DataTypes.STRING(255), allowNull: false },
    sha256: { type: DataTypes.STRING(64), allowNull: false },
    size_bytes: { type: DataTypes.BIGINT, allowNull: false },
    // Withdrawn = no longer offered; the newest active one per app is shown.
    active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    notes: { type: DataTypes.STRING, allowNull: true },
});

module.exports = AppDownload;
