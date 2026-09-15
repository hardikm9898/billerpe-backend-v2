'use strict';

// Scopes categories, variants and addon-departments to a menu catalogue.
// Nullable, no FK constraint - matches this codebase's established
// plain-column convention (see 20260901074800's own comment: no migration
// here uses Sequelize `references`, associations alone live in
// model/index.js). Every existing row gets backfilled to point at a
// per-hotel default catalogue in the next migration; going forward the app
// always sends a real menu_catalog_id, so in practice it's never left null
// after that, even though the column itself stays nullable like every other
// FK-ish column in this codebase.
//
// Menu items (hms_menu_msts) deliberately get no column here - they're
// already only scoped indirectly via their category's menu_catalog_id,
// matching billerpe-pos-pro-v2's MenuItem type, which has no menuId field
// of its own either.
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // Sequelize auto-pluralizes a define() name into its real table name
    // (model/menu_categ.js's "hms_menu_categ" -> hms_menu_categs, etc,
    // confirmed against the live schema) - these three are the real,
    // pluralized table names, not the singular define() strings.
    const tables = ['hms_menu_categs', 'hms_variant_msts', 'hms_addon_department_msts'];
    for (const table of tables) {
      await queryInterface.addColumn(table, 'menu_catalog_id', { type: Sequelize.INTEGER, allowNull: true });
      await queryInterface.addIndex(table, ['menu_catalog_id']);
    }
  },

  async down(queryInterface) {
    const tables = ['hms_menu_categs', 'hms_variant_msts', 'hms_addon_department_msts'];
    for (const table of tables) {
      await queryInterface.removeColumn(table, 'menu_catalog_id');
    }
  },
};
