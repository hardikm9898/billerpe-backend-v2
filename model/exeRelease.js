const { DataTypes } = require("sequelize");
const sequelize = require("../connection/connect");

// A published build of the outlet's local server (billerpe-local-exe.exe).
// Every outlet's exe hears about the newest active one on its 60s heartbeat,
// downloads it in the background and installs it itself - at night, or when
// staff press "Restart & update" on the Web POS System page (owner decision,
// 2026-09-30: 1000+ outlets cannot be updated by hand).
//
// The file is on this server's own disk (local_path, served by
// controller/sync/exeReleaseController.js#getFile) - the way it is used now
// (owner, 2026-09-30: no S3 access yet) - or in S3 (s3_bucket/s3_key,
// private; each exe gets a short-lived presigned link) when published --s3.
const ExeRelease = sequelize.define("exe_releases", {
    // The exe's own package.json version. An outlet installs a release only
    // when it is HIGHER than what it runs - never a downgrade (a bad release
    // is withdrawn by publishing a fixed higher one, or deactivating it
    // before outlets install it).
    version: { type: DataTypes.STRING, allowNull: false },
    s3_bucket: { type: DataTypes.STRING, allowNull: true },
    s3_key: { type: DataTypes.STRING, allowNull: true },
    local_path: { type: DataTypes.STRING, allowNull: true },
    // Checked by the exe after download, before it will install anything.
    sha256: { type: DataTypes.STRING(64), allowNull: false },
    size_bytes: { type: DataTypes.BIGINT, allowNull: false },
    // Withdrawing a release = flipping this. Outlets that have not installed
    // it yet stop being offered it on their next heartbeat.
    active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    notes: { type: DataTypes.STRING, allowNull: true },
});

module.exports = ExeRelease;
