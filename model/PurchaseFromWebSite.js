
const { DataTypes } = require("sequelize")
const sequelize = require("../connection/connect")


const TempWebsitePurchase = sequelize.define("hms_temp_website_purchase_mst", {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    hotel_name: {
        type: DataTypes.STRING,
        allowNull: false
    },
    name: {
        type: DataTypes.STRING,
        allowNull: false
    },
    mobile: {
        type: DataTypes.DOUBLE,
        allowNull: false
    },
    email: {
        type: DataTypes.STRING,
        allowNull: false
    }, plan_id: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    password: {
        type: DataTypes.STRING,
        allowNull: false
    },
    pincode: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    refer_code: {
        type: DataTypes.STRING,
        defaultValue: ""
    },
    address1: {
        type: DataTypes.STRING,
        allowNull: false
    },
    address2: {
        type: DataTypes.STRING,
        defaultValue: ""
    },
}, {
    freezeTableName: true,
    // timestamps: false       
})



module.exports = TempWebsitePurchase

