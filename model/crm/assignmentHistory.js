const { DataTypes } = require("sequelize")
const sequelize = require("../../connection/connect")

const AssignmentHistory = sequelize.define("crm_lead_assignment_history_mst", {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    lead_id: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    from_employee_id: {
        type: DataTypes.INTEGER,
        allowNull: true
    },
    to_employee_id: {
        type: DataTypes.INTEGER,
        allowNull: true
    },
    reason: {
        type: DataTypes.STRING,
        allowNull: true
    },
    assigned_by: {
        type: DataTypes.INTEGER,
        allowNull: true
    },
    assigned_at: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
    }
})

module.exports = AssignmentHistory
