const { DataTypes } = require('sequelize');
const sequelize = require("../../connection/connect");

// Receiving end of billerpe-local-exe's audit-log push (model/auditLog.js
// there) - append-only, push-only (see that file's own comment), no read
// UI here yet. Task 2 push half - see model/Inventory/supplyer.js's
// local_id comment for what local_id/the paired unique index are for.
const AuditLog = sequelize.define("hms_auditLog_mst", {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    local_id: { type: DataTypes.INTEGER, allowNull: true },
    hotel_id: { type: DataTypes.INTEGER, allowNull: false },
    user_id: { type: DataTypes.STRING, allowNull: true },
    user_name: { type: DataTypes.STRING, allowNull: false },
    action: { type: DataTypes.STRING, allowNull: false },
    entity: { type: DataTypes.STRING, allowNull: false },
    before: { type: DataTypes.STRING, defaultValue: "" },
    after: { type: DataTypes.STRING, defaultValue: "" },
    reason: { type: DataTypes.STRING, allowNull: true },
    device: { type: DataTypes.STRING, allowNull: true },
    ip: { type: DataTypes.STRING, allowNull: true },
});

module.exports = AuditLog;
