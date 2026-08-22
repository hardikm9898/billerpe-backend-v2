const { Sequelize, DataTypes } = require('sequelize');
const sequelize = require("../connection/connect")
const Hotel = require("./hotel");
const Role = require('./role_mst');
const UserAccess = require('./userAccess');

const Merchant = sequelize.define("hms_merchant_mst", {

    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false
    },
    chain_name: {
        type: DataTypes.STRING
    },
    number: {
        type: DataTypes.STRING,
    },
    password: {
        type: DataTypes.STRING,

    }
},
)

// Merchant.hasMany(Hotel, { foreignKey: "merchant_id", onDelete: "CASCADE" })
// Hotel.belongsTo(Merchant, { foreignKey: "merchant_id", onDelete: "CASCADE" })



module.exports = Merchant