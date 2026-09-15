const { DataTypes } = require("sequelize");
const sequelize = require("../connection/connect");

// A named menu catalogue (e.g. "Main Menu", "Bar Menu") - each one owns a
// fully independent set of categories/variants/addon-groups, scoped via
// menu_catalog_id on those tables (see model/menu_categ.js, variants.js,
// addonDepartMent.js). Named MenuCatalog, not Menu, to avoid colliding with
// the existing Menu model (model/menu.js, hms_menu_mst) which represents an
// individual menu ITEM, not a catalogue.
//
// table_category_ids/order_types mirror billerpe-pos-pro-v2's Menu type and
// exist so its resolveMenu() auto-selection (store.tsx) - "the first
// non-default menu whose table-category and order-type scope both match,
// else the default" - has real per-hotel data to work from instead of
// local-only state. Same JSON-array-scoping shape already used by
// model/kitchen.js's table_ids/menu_categ_ids/order_type for kitchen
// routing.
const MenuCatalog = sequelize.define("hms_menu_catalog_mst", {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
    },
    // Task 10 (menu catalogue push) - see model/recipes.js's local_id comment.
    local_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
    },
    name: {
        type: DataTypes.STRING,
    },
    is_default: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
    },
    active: {
        type: DataTypes.BOOLEAN,
        defaultValue: true,
    },
    table_category_ids: {
        type: DataTypes.JSON,
        defaultValue: [],
    },
    order_types: {
        type: DataTypes.JSON,
        defaultValue: [],
    },
    enter_by: {
        type: DataTypes.STRING,
    },
});

module.exports = MenuCatalog;
