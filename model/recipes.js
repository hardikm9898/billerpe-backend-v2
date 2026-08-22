
const { DataTypes } = require("sequelize")
const sequelize = require("../connection/connect");
const RawMaterial = require("./rawItem");
const Menu = require("./menu");


const Recipes = sequelize.define(
    "hms_recipes_mst",
    {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },

        hotel_id: {
            type: DataTypes.INTEGER,
            allowNull: false
        },

        menu_id: {
            type: DataTypes.INTEGER,
            allowNull: false
        },

        variant_id: {
            type: DataTypes.INTEGER,
            allowNull: true
        },

        addon_id: {
            type: DataTypes.INTEGER,
            allowNull: true
        },

        raw_material_id: {
            type: DataTypes.INTEGER,
            allowNull: true
        },

        semi_finished_item_id: {
            type: DataTypes.INTEGER,
            allowNull: true
        },

        consumption_qty: {
            type: DataTypes.DECIMAL(10, 4),
            allowNull: false
        }
    },
    {


        // 🔥 INDEXES GO HERE
        indexes: [
            {
                name: "idx_recipe_lookup",
                fields: ["hotel_id", "menu_id", "variant_id", "addon_id"]
            },
            {
                unique: true,
                name: "uniq_recipe_raw_material",
                fields: [
                    "hotel_id",
                    "menu_id",
                    "variant_id",
                    "addon_id",
                    "raw_material_id"
                ]
            },
            {
                unique: true,
                name: "uniq_recipe_sfi",
                fields: [
                    "hotel_id",
                    "menu_id",
                    "variant_id",
                    "addon_id",
                    "semi_finished_item_id"
                ]
            }
        ]
    }
);



// Menu.hasMany(Recipes, {
//     as: "menu",
//     foreignKey: 'menu_id',
// });
// Recipes.belongsTo(Menu, { as: "menu", foreignKey: 'menu_id' })

// RawMaterial.hasMany(Recipes, { as: "rawMaterial", foreignKey: 'raw_material_id' })
// Recipes.belongsTo(RawMaterial, { as: "rawMaterial", foreignKey: 'raw_material_id' })

module.exports = Recipes

