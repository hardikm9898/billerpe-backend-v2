'use strict';

// Inactive vs deleted for menu categories, variants and addon groups (owner
// decision, 2026-09-28). active:false used to mean "deleted"; now it means
// "inactive - listed, not sold" and a delete also sets is_deleted. Menu items
// (hms_menu_msts) already had the column. Existing rows keep is_deleted = 0,
// so anything already switched off shows as inactive (owner's choice).
// Safe to re-run: boot sync may already have added the column.
const TABLES = ['hms_menu_categs', 'hms_variant_msts', 'hms_addon_department_msts'];

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    for (const table of TABLES) {
      const columns = await queryInterface.describeTable(table);
      if (!columns.is_deleted) {
        await queryInterface.addColumn(table, 'is_deleted', { type: Sequelize.BOOLEAN, allowNull: true, defaultValue: false });
      }
    }
  },

  async down(queryInterface) {
    for (const table of TABLES) {
      const columns = await queryInterface.describeTable(table);
      if (columns.is_deleted) await queryInterface.removeColumn(table, 'is_deleted');
    }
  },
};
