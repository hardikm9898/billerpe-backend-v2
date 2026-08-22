const { DataTypes } = require("sequelize")
const sequelize = require("../../connection/connect")

const WhatsappCampaign = sequelize.define("crm_whatsapp_campaign_mst", {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    name: {
        type: DataTypes.STRING,
        allowNull: false
    },
    message: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    lead_filter: {
        type: DataTypes.JSON,
        allowNull: true
    },
    total_recipients: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    },
    sent_count: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    },
    failed_count: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    },
    template_id: {
        type: DataTypes.INTEGER,
        allowNull: true
    },
    param_values: {
        type: DataTypes.JSON,
        allowNull: true
    },
    created_by: {
        type: DataTypes.INTEGER,
        allowNull: true
    },
    scheduled_at: {
        type: DataTypes.DATE,
        allowNull: true
    },
    status: {
        type: DataTypes.ENUM("draft", "scheduled", "running", "completed"),
        defaultValue: "draft"
    }
})

module.exports = WhatsappCampaign
