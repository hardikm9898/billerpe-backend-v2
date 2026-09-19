const { Sequelize, DataTypes } = require("sequelize")
const sequelize = require("../connection/connect")
const Hotel = require("./hotel")
const User = require("./user")


const Role = sequelize.define("role_mst", {
    role_cd: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    role_name: {
        type: DataTypes.ENUM,
        // S/C/A/U/B: legacy short codes (see constant/const.js USER_ROLE) -
        // C=Captain A=Admin B=Biller U=Normal User S=Super. The 7 named
        // values are billerpe-pos-pro's role model (see migrations/
        // 20260824062338-extend-role-name-enum.js) - both sets coexist,
        // neither replaces the other.
        values: ['S', 'C', 'A', 'U', 'B', 'Owner', 'Manager', 'Cashier', 'Captain', 'Kitchen Staff', 'Inventory Manager', 'Accountant'],
        defaultValue: "U"
    },
    enter_by: {
        type: DataTypes.STRING
    },
    modify_by: {
        type: DataTypes.STRING
    },
    local_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
    },
})


module.exports = Role

