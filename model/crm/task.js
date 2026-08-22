const { DataTypes } = require("sequelize")
const sequelize = require("../../connection/connect")

const CrmTask = sequelize.define("crm_task_mst", {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    lead_id: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    assigned_to: {
        type: DataTypes.INTEGER,
        allowNull: true
    },
    task_type: {
        type: DataTypes.ENUM("call", "demo", "followup", "payment_reminder", "onboarding"),
        allowNull: false
    },
    status: {
        type: DataTypes.ENUM("pending", "in_progress", "completed", "missed"),
        defaultValue: "pending"
    },
    due_at: {
        type: DataTypes.DATE,
        allowNull: true
    },
    completed_at: {
        type: DataTypes.DATE,
        allowNull: true
    },
    notes: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    created_by: {
        type: DataTypes.INTEGER,
        allowNull: true
    }
})

module.exports = CrmTask
