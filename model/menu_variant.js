const { DataTypes } = require('sequelize');
const sequelize = require("../connection/connect");
const Variants = require('./variants');
const Menu = require('./menu');



const MenuVariants = sequelize.define("hms_menu_variant_mst", {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    menu_id: {
        type: DataTypes.INTEGER,
        references: { model: Menu }
    },
    variant_id: {
        type: DataTypes.INTEGER,
        references: { model: Variants }
    },
    variant_price: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    },
})

// Menu.belongsToMany(Variants, { through: MenuVariants, foreignKey: "menu_id", as: "menuData" })
// Variants.belongsToMany(Menu, { through: MenuVariants, foreignKey: "variant_id", as: "variantData" })


// Variants.belongsToMany(Menu, { through: "hms_menu_variant_mst", foreignKey: "variant_id", as: "menuData" })

// Menu.belongsToMany(Variants, {
//     through: "hms_menu_variant_mst",
//     as: "variantData",
//     foreignKey: "menu_id",
// });

// MenuVariants.belongsTo(Variants, { foreignKey: 'variant_id' })
// Variants.hasMany(MenuVariants, { foreignKey: 'variant_id' })

// MenuVariants.belongsTo(Menu, { foreignKey: 'menu_id' })
// Menu.hasMany(MenuVariants, { foreignKey: 'menu_id' })

module.exports = MenuVariants