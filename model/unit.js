
const { DataTypes } = require("sequelize")
const sequelize = require("../connection/connect")



const Unit = sequelize.define("hms_unit_mst", {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    unit_name: {
        type: DataTypes.STRING,
        require: true
    },
    shortName: {
        type: DataTypes.STRING,
        require: true
    }

})



module.exports = Unit

