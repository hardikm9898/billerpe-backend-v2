const { DataTypes } = require("sequelize")
const sequelize = require("../../connection/connect")

const AutomationLog = sequelize.define("crm_automation_log_mst", {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    rule_id: {
        type: DataTypes.INTEGER,
        allowNull: true
    },
    lead_id: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    executed_at: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
    },
    result: {
        type: DataTypes.STRING,
        allowNull: true
    },
    details: {
        type: DataTypes.JSON,
        defaultValue: {}
    }
})

module.exports = AutomationLog
