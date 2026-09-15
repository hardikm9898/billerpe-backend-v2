const { DataTypes } = require('sequelize');
const sequelize = require("../connection/connect");
const Variants = require('./variants');
const Menu = require('./menu');
const AddonDepartment = require('./addonDepartMent');



const MenuAddon = sequelize.define("hms_menu_addon_mst", {
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
    menu_id: {
        type: DataTypes.INTEGER,
        references: { model: Menu }
    },
    addon_department_id: {
        type: DataTypes.INTEGER,
        references: { model: AddonDepartment }
    },
    active: {
        type: DataTypes.BOOLEAN,
        defaultValue: true
    }

})

// AddonDepartment.belongsToMany(Menu, { through: "hms_menu_addon_mst", foreignKey: "addon_department_id", as: "menuData", onDelete: "SET NULL", onUpdate: "CASCADE" })

// Menu.belongsToMany(AddonDepartment, {
//     through: "hms_menu_addon_mst",
//     as: "addonDepartmentData",
//     foreignKey: "menu_id", onDelete: "SET NULL", onUpdate: "CASCADE"
// });

// MenuAddon.belongsTo(AddonDepartment, { foreignKey: 'addon_department_id' })
// AddonDepartment.hasMany(MenuAddon, { foreignKey: 'addon_department_id' })

// MenuAddon.belongsTo(Menu, { foreignKey: 'menu_id' })
// Menu.hasMany(AddonDepartment, { foreignKey: 'menu_id' })


module.exports = MenuAddon