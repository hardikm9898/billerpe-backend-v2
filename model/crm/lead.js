const { DataTypes } = require("sequelize")
const sequelize = require("../../connection/connect")

const Lead = sequelize.define("crm_lead_mst", {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    name: {
        type: DataTypes.STRING,
        defaultValue: ""
    },
    phone_number: {
        type: DataTypes.STRING,
        allowNull: false
    },
    email: {
        type: DataTypes.STRING,
        defaultValue: ""
    },
    message: {
        type: DataTypes.STRING,
        defaultValue: ""
    },
    source: {
        type: DataTypes.ENUM("website", "meta_facebook", "meta_instagram", "manual"),
        allowNull: false,
        defaultValue: "manual"
    },
    campaign_name: {
        type: DataTypes.STRING,
        allowNull: true
    },
    adset_name: {
        type: DataTypes.STRING,
        allowNull: true
    },
    ad_name: {
        type: DataTypes.STRING,
        allowNull: true
    },
    lead_form_name: {
        type: DataTypes.STRING,
        allowNull: true
    },
    status: {
        type: DataTypes.ENUM(
            "NEW",
            "INTERESTED",
            "SEMI_INTERESTED",
            "NOT_INTERESTED",
            "FAKE_LEAD",
            "ASSIGNED",
            "CONTACT_ATTEMPTED",
            "NO_ANSWER",
            "BUSY",
            "CALLBACK_REQUESTED",
            "WRONG_NUMBER",
            "DEMO_SCHEDULED",
            "DEMO_COMPLETED",
            "DEMO_MISSED",
            "PROPOSAL_SENT",
            "NEGOTIATION",
            "APPROVAL_PENDING",
            "PAYMENT_PENDING",
            "CONVERTED",
            "LOST",
            "REOPENED"
        ),
        defaultValue: "NEW"
    },
    priority: {
        type: DataTypes.ENUM("P1", "P2", "P3", "P4"),
        defaultValue: "P3"
    },
    assigned_to: {
        type: DataTypes.INTEGER,
        allowNull: true
    },
    assigned_by: {
        type: DataTypes.INTEGER,
        allowNull: true
    },
    converted_hotel_id: {
        type: DataTypes.INTEGER,
        allowNull: true
    },
    source_lead_id: {
        type: DataTypes.STRING,
        allowNull: true
    },
    website_user_id: {
        type: DataTypes.INTEGER,
        allowNull: true
    },
    deleted: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    }
})

module.exports = Lead
