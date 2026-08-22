const { DataTypes } = require("sequelize");
const sequelize = require("../connection/connect");

const WaConversation = sequelize.define(
    "wa_agent_conversations",
    {
        id: {
            type:          DataTypes.INTEGER,
            primaryKey:    true,
            autoIncrement: true,
        },
        phone: {
            type:      DataTypes.STRING(30),
            allowNull: false,
            unique:    true,
        },
        name: {
            type:         DataTypes.STRING(200),
            defaultValue: '',
        },
        profilePic: {
            type:      DataTypes.STRING(500),
            allowNull: true,
        },
        status: {
            type:         DataTypes.ENUM('open', 'pending', 'resolved'),
            defaultValue: 'open',
        },
        unread: {
            type:         DataTypes.INTEGER,
            defaultValue: 0,
        },
        lastMessageTime: {
            type:         DataTypes.BIGINT,
            defaultValue: 0,
        },
        isManual: {
            type:         DataTypes.BOOLEAN,
            defaultValue: false,
        },
        lead_id: {
            type:         DataTypes.INTEGER,
            allowNull:    true,
            defaultValue: null,
        },
    },
    {
        tableName:  "wa_agent_conversations",
        timestamps: true,
    }
);

module.exports = WaConversation;
