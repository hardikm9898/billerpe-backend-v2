'use strict';

// POS App owner alerts (owner list 2026-09-29 #10): which alerts the owner
// wants (cancel after KOT, big discount + limit %, cash difference at close),
// JSON, per outlet. Null = all on, 20% (appv1/ownerAlerts.js defaults).
// Table names are looked up by their real spelling (case-sensitive on Linux).
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = (await queryInterface.showAllTables()).map((t) => String(t.tableName ?? t));
    const table = tables.find((t) => t.toLowerCase() === 'hms_res_settings') ?? 'hms_res_settings';
    const cols = await queryInterface.describeTable(table);
    if (!cols.owner_alerts) {
      await queryInterface.addColumn(table, 'owner_alerts', { type: Sequelize.TEXT, allowNull: true });
    }
  },

  async down(queryInterface) {
    const tables = (await queryInterface.showAllTables()).map((t) => String(t.tableName ?? t));
    const table = tables.find((t) => t.toLowerCase() === 'hms_res_settings') ?? 'hms_res_settings';
    await queryInterface.removeColumn(table, 'owner_alerts').catch(() => {});
  },
};
