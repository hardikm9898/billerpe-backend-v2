
const { DataTypes } = require("sequelize")
const sequelize = require("../connection/connect")

const SemiFinishedRecipe = sequelize.define("hms_semi_finished_recipes_mst", {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    hotel_id: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    semi_finished_item_id: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    raw_material_id: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    consumption_qty: {
        type: DataTypes.DECIMAL(10, 4),
        allowNull: false
    }
}, {
    indexes: [
        {
            unique: true,
            name: "uniq_sfi_recipe_ingredient",
            fields: ["hotel_id", "semi_finished_item_id", "raw_material_id"]
        }
    ]
})

module.exports = SemiFinishedRecipe
