const { Sequelize, DataTypes } = require("sequelize");
const sequelize = require("../connection/connect")

const WhatsappTemplate = sequelize.define(
    "hms_whatsapp_template_msts",
    {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true,
        },
        name: {
            type: DataTypes.STRING(150),
            allowNull: false,
        },
        active: {
            type: DataTypes.BOOLEAN,
            defaultValue: true,
        },
        params: {
            type: DataTypes.JSON,
            defaultValue: []
        },
        default_image: { type: DataTypes.STRING, defaultValue: "" }

    },
    {
        tableName: "hms_whatsapp_template_msts",
        timestamps: true,
        indexes: [
            {
                unique: true,
                fields: ["name"], // 👈 KEY POINT
            },
        ],
    }
);

module.exports = WhatsappTemplate