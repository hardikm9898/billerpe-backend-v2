const { DataTypes } = require("sequelize")
const sequelize = require("../../connection/connect")

const DemoSchedule = sequelize.define("crm_demo_schedule_mst", {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    lead_id: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    executive_id: {
        type: DataTypes.INTEGER,
        allowNull: true
    },
    scheduled_at: {
        type: DataTypes.DATE,
        allowNull: false
    },
    mode: {
        type: DataTypes.ENUM("online", "onsite", "call"),
        defaultValue: "online"
    },
    outcome: {
        type: DataTypes.ENUM("completed", "missed", "rescheduled"),
        allowNull: true
    },
    notes: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    reschedule_count: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    }
})

module.exports = DemoSchedule
