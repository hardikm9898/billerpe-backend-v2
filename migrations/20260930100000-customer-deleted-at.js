'use strict';

// Customer deleted in an outlet's Customer Data (owner list 2026-09-29 #4):
// the exe marks every record with that mobile deleted_at and pushes it.
// Customer lists hide such rows; settled bills keep showing the name.
// Table names are looked up by their real spelling (case-sensitive on Linux).
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = (await queryInterface.showAllTables()).map((t) => String(t.tableName ?? t));
    const table = tables.find((t) => t.toLowerCase() === 'hms_user_masters') ?? 'hms_user_masters';
    const cols = await queryInterface.describeTable(table);
    if (!cols.deleted_at) {
      await queryInterface.addColumn(table, 'deleted_at', { type: Sequelize.DATE, allowNull: true });
    }
  },

  async down(queryInterface) {
    const tables = (await queryInterface.showAllTables()).map((t) => String(t.tableName ?? t));
    const table = tables.find((t) => t.toLowerCase() === 'hms_user_masters') ?? 'hms_user_masters';
    await queryInterface.removeColumn(table, 'deleted_at').catch(() => {});
  },
};
