const { DataTypes } = require("sequelize")
const sequelize = require("../../connection/connect")

const CrmNotification = sequelize.define("crm_notification_mst", {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    recipient_id: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    type: {
        type: DataTypes.STRING,
        allowNull: false
    },
    title: {
        type: DataTypes.STRING,
        defaultValue: ""
    },
    body: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    link: {
        type: DataTypes.STRING,
        allowNull: true
    },
    is_read: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    lead_id: {
        type: DataTypes.INTEGER,
        allowNull: true
    }
})

module.exports = CrmNotification
