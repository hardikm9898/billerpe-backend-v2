const { DataTypes } = require("sequelize")
const sequelize = require("../../connection/connect")

// Provider-agnostic call log — `provider`/`provider_call_id`/`recording_url` stay
// nullable until a telephony integration is chosen; only services/crm/calling/*
// should need to change when that happens, not this schema.
const CallLog = sequelize.define("crm_call_log_mst", {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    lead_id: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    task_id: {
        type: DataTypes.INTEGER,
        allowNull: true
    },
    caller_id: {
        type: DataTypes.INTEGER,
        allowNull: true
    },
    direction: {
        type: DataTypes.ENUM("outbound", "inbound"),
        allowNull: false
    },
    provider: {
        type: DataTypes.STRING,
        allowNull: true
    },
    provider_call_id: {
        type: DataTypes.STRING,
        allowNull: true
    },
    duration_seconds: {
        type: DataTypes.INTEGER,
        allowNull: true
    },
    recording_url: {
        type: DataTypes.STRING,
        allowNull: true
    },
    outcome: {
        type: DataTypes.ENUM("connected", "no_answer", "busy", "wrong_number", "call_back_requested"),
        allowNull: true
    },
    notes: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    called_at: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
    }
})

module.exports = CallLog
