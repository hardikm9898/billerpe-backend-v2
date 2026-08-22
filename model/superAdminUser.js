const { DataTypes } = require('sequelize');
const sequelize = require("../connection/connect")

module.exports = (sequelize, DataTypes, Hotel) => {
    const SuperAdminUser = sequelize.define("hms_superAdmin_user", {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true,
            allowNull: false
        },
        name: {
            type: DataTypes.STRING,
            allowNull: false
        },
        number: {
            type: DataTypes.BIGINT(11),
            allowNull: false
        },
        role: {
            type: DataTypes.ENUM,
            values: ["Admin", "User"]
        },
        password: {
            type: DataTypes.STRING,
            allowNull: false
        },
        referal_code: {
            type: DataTypes.STRING,
            defaultValue: ""
        }
    });
    Hotel.belongsTo(SuperAdminUser, { foreignKey: 'created_by' });
    SuperAdminUser.hasMany(Hotel, { foreignKey: 'created_by' });
    return SuperAdminUser;
};