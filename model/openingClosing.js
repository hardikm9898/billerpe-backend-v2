const { DataTypes } = require('sequelize');
const sequelize = require("../connection/connect");


const OpeningClosing = sequelize.define("hms_opening_closing_mst", {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false
    },
    opening_balance: {
        type: DataTypes.STRING
    },
    closing_balance: {
        type: DataTypes.STRING,
    },

},
)

// Merchant.hasMany(Hotel, { foreignKey: "merchant_id", onDelete: "CASCADE" })
// Hotel.belongsTo(Merchant, { foreignKey: "merchant_id", onDelete: "CASCADE" })



module.exports = OpeningClosing