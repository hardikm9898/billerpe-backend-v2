const { DataTypes } = require('sequelize');
const sequelize = require("../connection/connect")


const InvoiceFormate = sequelize.define("hms_invoice_formate_mst", {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },

    headerLine1: {
        type: DataTypes.STRING
    },
    headerLine2: {
        type: DataTypes.STRING
    },
    headerLine3: {
        type: DataTypes.STRING
    },
    headerLine4: {
        type: DataTypes.STRING
    },
    headerLine5: {
        type: DataTypes.STRING
    },
    headerLine6: {
        type: DataTypes.STRING
    },
    headerLine7: {
        type: DataTypes.STRING
    },
    headerLine8: {
        type: DataTypes.STRING
    },
    headerLine9: {
        type: DataTypes.STRING
    },
    headerLine10: {
        type: DataTypes.STRING
    },
    footerLine1: {
        type: DataTypes.STRING
    },
    footerLine2: {
        type: DataTypes.STRING
    },
    footerLine3: {
        type: DataTypes.STRING
    },
    footerLine4: {
        type: DataTypes.STRING
    },
    footerLine5: {
        type: DataTypes.STRING
    },
    footerLine6: {
        type: DataTypes.STRING
    },
    footerLine7: {
        type: DataTypes.STRING
    },
    footerLine8: {
        type: DataTypes.STRING
    },
    footerLine9: {
        type: DataTypes.STRING
    },
    footerLine10: {
        type: DataTypes.STRING
    },
    fontF1: {
        type: DataTypes.STRING,
        defaultValue: "12px"
    },
    fontF2: {
        type: DataTypes.STRING,
        defaultValue: "12px"
    },
    fontF3: {
        type: DataTypes.STRING,
        defaultValue: "12px"
    },
    fontF4: {
        type: DataTypes.STRING,
        defaultValue: "12px"
    },
    fontF5: {
        type: DataTypes.STRING,
        defaultValue: "12px"
    },
    fontF6: {
        type: DataTypes.STRING,
        defaultValue: "12px"
    },
    fontF7: {
        type: DataTypes.STRING,
        defaultValue: "12px"
    },
    fontF8: {
        type: DataTypes.STRING,
        defaultValue: "12px"
    },
    fontF9: {
        type: DataTypes.STRING,
        defaultValue: "12px"
    },
    fontF10: {
        type: DataTypes.STRING,
        defaultValue: "12px"
    },
    fontH1: {
        type: DataTypes.STRING,
        defaultValue: "12px"
    },
    fontH2: {
        type: DataTypes.STRING,
        defaultValue: "12px"
    },
    fontH3: {
        type: DataTypes.STRING,
        defaultValue: "12px"
    },
    fontH4: {
        type: DataTypes.STRING,
        defaultValue: "12px"
    },
    fontH5: {
        type: DataTypes.STRING,
        defaultValue: "12px"
    },
    fontH6: {
        type: DataTypes.STRING,
        defaultValue: "12px"
    },
    fontH7: {
        type: DataTypes.STRING,
        defaultValue: "12px"
    },
    fontH8: {
        type: DataTypes.STRING,
        defaultValue: "12px"
    },
    fontH9: {
        type: DataTypes.STRING,
        defaultValue: "12px"
    },
    fontH10: {
        type: DataTypes.STRING,
        defaultValue: "12px"
    }

})




module.exports = InvoiceFormate