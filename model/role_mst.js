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
        values: ['S', 'C', 'A', 'U', 'B'],      // TODO C=Captain A=Admin B=Biller U=Normal User
        defaultValue: "U"
    },
    enter_by: {
        type: DataTypes.STRING
    },
    modify_by: {
        type: DataTypes.STRING
    },
})


module.exports = Role

