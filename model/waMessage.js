const { DataTypes } = require("sequelize");
const sequelize = require("../connection/connect");

const WaMessage = sequelize.define(
    "wa_agent_messages",
    {
        id: {
            type:          DataTypes.INTEGER,
            primaryKey:    true,
            autoIncrement: true,
        },
        messageId: {
            type:      DataTypes.STRING(200),
            allowNull: false,
        },
        phone: {
            type:      DataTypes.STRING(30),
            allowNull: false,
        },
        text: {
            type:         DataTypes.TEXT,
            defaultValue: '',
        },
        direction: {
            type:         DataTypes.ENUM('inbound', 'outbound'),
            defaultValue: 'inbound',
        },
        ts: {
            type:         DataTypes.BIGINT,
            defaultValue: 0,
        },
        status: {
            type:      DataTypes.STRING(30),
            allowNull: true,
        },
        type: {
            type:         DataTypes.STRING(50),
            defaultValue: 'text',
        },
    },
    {
        tableName:  "wa_agent_messages",
        timestamps: true,
        indexes: [
            { fields: ['phone'] },
            { fields: ['messageId'] },
        ],
    }
);

module.exports = WaMessage;
