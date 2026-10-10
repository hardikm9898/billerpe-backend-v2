'use strict';

// Table timer (owner list 2026-10-10): a default time limit per table and per
// section (buffets, gaming slots), and each running order's own timer -
// when its time is over and when staff last tapped "Seen" on the alarm.
// appv1/tableTimer.js (POS App); outlet PCs keep the same columns locally.
async function tableNamed(queryInterface, name) {
  const tables = (await queryInterface.showAllTables()).map((t) => String(t.tableName ?? t));
  return tables.find((t) => t.toLowerCase() === name) ?? name;
}

const COLUMNS = [
  ['hms_table_msts', 'time_limit', 'INTEGER'],
  ['hms_table_categs', 'time_limit', 'INTEGER'],
  ['hms_order_msts', 'timer_ends_at', 'DATE'],
  ['hms_order_msts', 'timer_seen_at', 'DATE'],
];

module.exports = {
  async up(queryInterface, Sequelize) {
    for (const [name, column, type] of COLUMNS) {
      const table = await tableNamed(queryInterface, name);
      const cols = await queryInterface.describeTable(table);
      if (!cols[column]) await queryInterface.addColumn(table, column, { type: Sequelize[type], allowNull: true });
    }
  },

  async down(queryInterface) {
    for (const [name, column] of COLUMNS) {
      const table = await tableNamed(queryInterface, name);
      const cols = await queryInterface.describeTable(table);
      if (cols[column]) await queryInterface.removeColumn(table, column);
    }
  },
};
