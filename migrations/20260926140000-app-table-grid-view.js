'use strict';

// POS App (Plan 2): the tables screen's layout per outlet - "tabs" (section
// tabs, "All" = one grid) or "sections" (every section under its heading),
// the Web POS's Table grid view (owner bug list 2026-09-26).
// Table names are looked up by their real spelling (case-sensitive on Linux).
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = (await queryInterface.showAllTables()).map((t) => String(t.tableName ?? t));
    const table = tables.find((t) => t.toLowerCase() === 'hms_res_settings') ?? 'hms_res_settings';
    const cols = await queryInterface.describeTable(table);
    if (!cols.table_grid_view) {
      await queryInterface.addColumn(table, 'table_grid_view', { type: Sequelize.STRING(10), allowNull: false, defaultValue: 'tabs' });
    }
  },

  async down(queryInterface) {
    const tables = (await queryInterface.showAllTables()).map((t) => String(t.tableName ?? t));
    const table = tables.find((t) => t.toLowerCase() === 'hms_res_settings') ?? 'hms_res_settings';
    await queryInterface.removeColumn(table, 'table_grid_view').catch(() => {});
  },
};
