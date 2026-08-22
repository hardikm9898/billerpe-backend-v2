const { DataTypes } = require("sequelize")
const sequelize = require("../../connection/connect")

const CampaignRecipient = sequelize.define("crm_campaign_recipient_mst", {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    campaign_id: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    lead_id: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    phone_number: {
        type: DataTypes.STRING(30),
        allowNull: true
    },
    status: {
        type: DataTypes.ENUM("queued", "sent", "delivered", "read", "failed"),
        defaultValue: "queued"
    },
    sent_at: {
        type: DataTypes.DATE,
        allowNull: true
    },
    error_message: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    delivered_at: {
        type: DataTypes.DATE,
        allowNull: true
    },
    read_at: {
        type: DataTypes.DATE,
        allowNull: true
    }
})

module.exports = CampaignRecipient
