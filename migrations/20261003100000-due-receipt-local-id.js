'use strict';

// Dues collected on an outlet's own server (billerpe-local-exe
// controller/order.js#settleDue) now reach hms_due_payment_receives through
// sync (entity "dueReceipts"). Before, only the bill's new cash / due went
// up, so the cloud had no record of WHEN a due was paid: the dashboard and
// the closing WhatsApp counted the money on the bill's old day (owner report
// 2026-10-03, hotels 2, 3 and 6). `local_id` (unique with hotel_id) is the
// idempotency key every pushed table has - see 20260916100000.
// Table names are looked up by their real spelling (case-sensitive on Linux).
const TABLE = 'hms_due_payment_receives';
const INDEX = `${TABLE}_hotel_local_id_unique`;

async function realName(queryInterface) {
  const tables = (await queryInterface.showAllTables()).map((t) => String(t.tableName ?? t));
  return tables.find((t) => t.toLowerCase() === TABLE) ?? TABLE;
}

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await realName(queryInterface);
    const columns = await queryInterface.describeTable(table);
    if (!columns.local_id) {
      await queryInterface.addColumn(table, 'local_id', { type: Sequelize.INTEGER, allowNull: true });
    }
    const indexes = await queryInterface.showIndex(table);
    if (!indexes.some((i) => i.name === INDEX)) {
      // MySQL treats NULLs as distinct: rows written here (local_id NULL)
      // never collide with each other.
      await queryInterface.addIndex(table, { fields: ['hotel_id', 'local_id'], unique: true, name: INDEX });
    }
  },

  async down(queryInterface) {
    const table = await realName(queryInterface);
    await queryInterface.removeIndex(table, INDEX).catch(() => {});
    await queryInterface.removeColumn(table, 'local_id').catch(() => {});
  },
};
