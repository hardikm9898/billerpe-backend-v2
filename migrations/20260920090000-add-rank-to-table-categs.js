'use strict';

// Table Category screen's "Sort order" field did nothing: the model had no
// column to hold it, so every save silently discarded it and the display
// always fell back to id order (owner report, 2026-09-20). Same shape as
// Menu_categ's own rank. hms_table_categs is in server.js's
// TABLES_TO_SKIP_ALTER, so a migration is the only way it gets this column.
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const columns = await queryInterface.describeTable('hms_table_categs');
    if (!columns.rank) {
      await queryInterface.addColumn('hms_table_categs', 'rank', {
        type: Sequelize.INTEGER,
        defaultValue: 0,
      });
    }
    // Backfill: existing categories keep today's id order the first time
    // this runs, rather than every one collapsing to rank 0.
    await queryInterface.sequelize.query(`
      UPDATE hms_table_categs t
      JOIN (
        SELECT id, ROW_NUMBER() OVER (PARTITION BY hotel_id ORDER BY id) AS rn
        FROM hms_table_categs
      ) ranked ON ranked.id = t.id
      SET t.rank = ranked.rn
      WHERE t.rank = 0
    `);
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('hms_table_categs', 'rank').catch(() => {});
  },
};
