const { DataTypes } = require("sequelize");
const sequelize = require("../connection/connect");

// Central authority for "which PC is this restaurant's active local server"
// (architecture memo, Phase A). The table's real uniqueness guarantee -
// only one row can have status='active' for a given hotel_id - lives in the
// migration as a generated `active_hotel_id` column + unique index, not
// here; MySQL has no native partial-unique-index syntax, so the DB-level
// enforcement has to happen that way. This model only needs the real
// columns for reads/writes, and is excluded from server.js's ALTER-on-boot
// (TABLES_TO_SKIP_ALTER) so an auto-sync can never touch the generated
// column or its index.
const LocalServerRegistration = sequelize.define("local_server_registrations", {
    hotel_id: { type: DataTypes.INTEGER, allowNull: false },
    // Persistent identity the EXE generates once (crypto.randomUUID()) and
    // keeps on disk next to its local DB - survives EXE restarts/rebuilds
    // on the same PC, but is naturally fresh on a genuinely different PC.
    device_id: { type: DataTypes.STRING, allowNull: false },
    // Minted fresh on every successful (re-)registration, unlike device_id -
    // gives an audit trail that distinguishes "same PC reconnected" from
    // "this hotel's server was transferred" even when device_id happens to
    // repeat (e.g. a restored disk image).
    installation_id: { type: DataTypes.STRING, allowNull: false },
    status: { type: DataTypes.ENUM("active", "released"), allowNull: false, defaultValue: "active" },
    hostname: { type: DataTypes.STRING, allowNull: true },
    app_version: { type: DataTypes.STRING, allowNull: true },
    os_info: { type: DataTypes.STRING, allowNull: true },
    registered_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    released_at: { type: DataTypes.DATE, allowNull: true },
    // SuperAdminUser.id of whoever released it - see §7 of the architecture
    // memo: only a SuperAdmin can ever clear this field's owning row.
    released_by: { type: DataTypes.INTEGER, allowNull: true },
    last_seen_at: { type: DataTypes.DATE, allowNull: true },
}, {
    indexes: [
        { fields: ["hotel_id"] },
        { fields: ["device_id"] },
    ],
});

module.exports = LocalServerRegistration;
