'use strict';

// Menu photos while billing (owner 2026-10-09): on by default, an outlet can
// switch them off for a dense text-only grid.
module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = (await queryInterface.showAllTables()).map((t) => String(t.tableName ?? t));
    const table = tables.find((t) => t.toLowerCase() === 'hms_res_settings') ?? 'hms_res_settings';
    const cols = await queryInterface.describeTable(table);
    if (!cols.billing_photos) await queryInterface.addColumn(table, 'billing_photos', { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true });
  },

  async down(queryInterface) {
    const tables = (await queryInterface.showAllTables()).map((t) => String(t.tableName ?? t));
    const table = tables.find((t) => t.toLowerCase() === 'hms_res_settings') ?? 'hms_res_settings';
    await queryInterface.removeColumn(table, 'billing_photos');
  },
};
