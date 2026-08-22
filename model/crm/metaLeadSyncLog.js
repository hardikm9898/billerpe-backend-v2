const { DataTypes } = require("sequelize")
const sequelize = require("../../connection/connect")

const MetaLeadSyncLog = sequelize.define("crm_meta_lead_sync_log_mst", {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    meta_lead_id: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true
    },
    page_id: {
        type: DataTypes.STRING,
        allowNull: true
    },
    form_id: {
        type: DataTypes.STRING,
        allowNull: true
    },
    campaign_id: {
        type: DataTypes.STRING,
        allowNull: true
    },
    adset_id: {
        type: DataTypes.STRING,
        allowNull: true
    },
    ad_id: {
        type: DataTypes.STRING,
        allowNull: true
    },
    raw_payload: {
        type: DataTypes.JSON,
        defaultValue: {}
    },
    processed: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    crm_lead_id: {
        type: DataTypes.INTEGER,
        allowNull: true
    },
    received_at: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
    }
})

module.exports = MetaLeadSyncLog
