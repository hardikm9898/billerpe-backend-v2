
const { DataTypes } = require("sequelize");
const sequelize = require("../connection/connect");

const UserSession = sequelize.define("user_sessions", {
    user_id: { type: DataTypes.INTEGER, allowNull: false },
    device_id: { type: DataTypes.STRING, allowNull: false },
    token: { type: DataTypes.STRING(512), allowNull: false },
    created_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
}, {
    indexes: [
        { fields: ["user_id", "token"] }  // adminAuth session lookup on every authenticated request
    ]
});


module.exports = UserSession