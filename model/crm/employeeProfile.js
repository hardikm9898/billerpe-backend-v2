const { DataTypes } = require("sequelize")
const sequelize = require("../../connection/connect")

const EmployeeProfile = sequelize.define("crm_employee_profile_mst", {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    superAdmin_user_id: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    employee_type: {
        type: DataTypes.ENUM(
            "manager",
            "calling_executive",
            "demo_executive",
            "followup_executive",
            "onboarding_executive",
            "support_executive"
        ),
        allowNull: false
    },
    manager_id: {
        type: DataTypes.INTEGER,
        allowNull: true
    },
    is_active: {
        type: DataTypes.BOOLEAN,
        defaultValue: true
    },
    daily_capacity: {
        type: DataTypes.INTEGER,
        allowNull: true
    }
})

module.exports = EmployeeProfile
