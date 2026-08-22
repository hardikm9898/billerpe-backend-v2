const { DataTypes } = require("sequelize")
const sequelize = require("../../connection/connect")

const LeadActivity = sequelize.define("crm_lead_activity_mst", {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    lead_id: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    actor_id: {
        type: DataTypes.INTEGER,
        allowNull: true
    },
    activity_type: {
        type: DataTypes.ENUM(
            "call",
            "whatsapp",
            "status_change",
            "note",
            "assignment",
            "demo",
            "payment",
            "task",
            "system"
        ),
        allowNull: false
    },
    old_value: {
        type: DataTypes.STRING,
        allowNull: true
    },
    new_value: {
        type: DataTypes.STRING,
        allowNull: true
    },
    description: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    metadata: {
        type: DataTypes.JSON,
        defaultValue: {}
    }
})

module.exports = LeadActivity
