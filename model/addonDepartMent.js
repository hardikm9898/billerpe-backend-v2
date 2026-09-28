const { DataTypes } = require('sequelize');
const sequelize = require("../connection/connect");
const Addons = require('./addons');



const AddonDepartment = sequelize.define("hms_addon_department_mst", {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    // Task 10 (menu catalogue push) - see model/recipes.js's local_id comment.
    local_id: {
        type: DataTypes.INTEGER,
        allowNull: true
    },
    department_name: {
        type: DataTypes.STRING,
        allowNull: false
    },
    maximum_allowed_addon: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    minimum_allowed_addon: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    singleSelection: {
        type: DataTypes.BOOLEAN,
        defaultValue: true
    },
    active: {
        type: DataTypes.BOOLEAN,
        defaultValue: true
    },
    // Deleted (gone from every list) vs merely inactive (active:false - still
    // listed on the outlet's Menu screens, hidden from billing). Written by
    // the outlet exe, synced both ways - migration 20260928120000.
    is_deleted: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
})



// AddonDepartment.hasMany(Addons, { foreignKey: 'department_id', onDelete: "CASCADE", onUpdate: "CASCADE" })
// Addons.belongsTo(AddonDepartment, { foreignKey: 'department_id', onDelete: "SET NULL", onUpdate: "CASCADE" })


module.exports = AddonDepartment