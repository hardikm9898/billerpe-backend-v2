const { DataTypes } = require("sequelize")
const sequelize = require("../../connection/connect")

const AutomationRule = sequelize.define("crm_automation_rule_mst", {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    name: {
        type: DataTypes.STRING,
        allowNull: false
    },
    trigger_type: {
        type: DataTypes.ENUM("lead_not_contacted", "demo_no_response", "payment_pending_reminder"),
        allowNull: false
    },
    trigger_condition: {
        type: DataTypes.JSON,
        defaultValue: {}
    },
    action_type: {
        type: DataTypes.ENUM("notify_manager", "create_task", "send_whatsapp", "change_priority"),
        allowNull: false
    },
    action_config: {
        type: DataTypes.JSON,
        defaultValue: {}
    },
    is_active: {
        type: DataTypes.BOOLEAN,
        defaultValue: true
    }
})

module.exports = AutomationRule
