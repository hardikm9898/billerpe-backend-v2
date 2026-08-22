const { DataTypes } = require('sequelize');
const sequelize = require("../connection/connect")


const webSiteUserData = sequelize.define("hms_website_user_msts", {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false
    },
    email: {
        type: DataTypes.STRING,
        defaultValue: ''
    },
    name: {
        type: DataTypes.STRING,
        defaultValue: ''

    },
    phone_number: {
        type: DataTypes.STRING,
        allowNull: false
    },
    message: {
        type: DataTypes.STRING,
        defaultValue: ''
    },
    status: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
    },
    taken_by: {
        type: DataTypes.STRING,
        defaultValue: ""
    }

},
)





module.exports = webSiteUserData