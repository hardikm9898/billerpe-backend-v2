'use strict';

// Task 10 (menu catalogue push). Menu/Menu_categ/MenuCatalog/Variants/
// AddonDepartment/Addons and their two join tables can all be created
// directly on the exe, offline - same "exe's local SQLite id shares no id
// space with this database's own auto-increment id" problem the 12
// operations entities already solved (see 20260901074800, this migration's
// direct template). `local_id` (paired with hotel_id) gives push a real
// upsert key: find by (hotel_id, local_id) first, update if found, create
// if not - see controller/offline/offlineEntityPush.js for the consuming
// side, and the sibling ENTITY_MODELS entries added alongside this.
//
// Fixes a real production incident: an order referencing a menu item the
// exe created locally and offline failed to sync at all
// (SequelizeForeignKeyConstraintError on MenuId), because Menu had no path
// to ever reach the cloud - see services/cloudPushOperations.js (exe) and
// offlineEntityPush.js's own updated ENTITY_MODELS for the fix.
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = [
      'hms_menu_catalog_msts',
      'hms_menu_categs',
      'hms_menu_msts',
      'hms_variant_msts',
      'hms_addon_department_msts',
      'hms_addon_msts',
      'hms_menu_variant_msts',
      'hms_menu_addon_msts',
    ];

    for (const table of tables) {
      await queryInterface.addColumn(table, 'local_id', { type: Sequelize.INTEGER, allowNull: true });
      await queryInterface.addIndex(table, {
        fields: ['hotel_id', 'local_id'],
        unique: true,
        name: `${table}_hotel_local_id_unique`,
        where: { local_id: { [Sequelize.Op.ne]: null } },
      });
    }
  },

  async down(queryInterface) {
    const tables = [
      'hms_menu_catalog_msts', 'hms_menu_categs', 'hms_menu_msts', 'hms_variant_msts',
      'hms_addon_department_msts', 'hms_addon_msts', 'hms_menu_variant_msts', 'hms_menu_addon_msts',
    ];
    for (const table of tables) {
      await queryInterface.removeColumn(table, 'local_id');
    }
  },
};
