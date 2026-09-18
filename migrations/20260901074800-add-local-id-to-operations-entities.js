'use strict';

// Task 2 (operations local-only entities), push half. These 12 tables'
// local (SQLite) rows and this database's own auto-increment ids share no
// id space at all - a recipe created on the exe has no relationship to any
// MySQL id here. `local_id` (paired with hotel_id - or cashSessionId for
// hms_cashMovement_msts, the one table here with no hotel_id of its own)
// gives push a real, reliable upsert key: the exe always knows its own
// row's id, so re-pushing the same local row (a retry, or an edit after an
// earlier successful push) updates in place instead of creating a
// duplicate every time. See controller/offline/offlineEntityPush.js for
// the consuming side.
//
// Several of these tables are in server.js's TABLES_TO_SKIP_ALTER (recipes,
// semi-finished items/recipes, purchase orders, expense entries, wastage) -
// they never get an automatic ALTER at boot, so this migration is the only
// way any of them gets this column at all, not just the safer one.
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const hotelScoped = [
      'hms_recipes_msts',
      'hms_semi_finished_items_msts',
      'hms_semi_finished_recipes_msts',
      'hms_expense_head_msts',
      'hms_expense_entry_msts',
      'hms_cashSession_msts',
      'hms_promo_codes',
      'hms_watage_msts',
      'hms_purchase_orders',
      'hms_purchase_payments',
      'hms_suppliers',
    ];

    // Guarded per-column and per-index, same pattern as 20260916100000:
    // every one of these 12 models already declares `local_id` (confirmed
    // against model/*.js, 2026-09-18), so on a fresh database sync()
    // creates the column before this migration ever runs - but NONE of
    // these models declares the unique index, so that half genuinely still
    // needs to run. An unguarded addColumn failing on the FIRST table in
    // this loop used to abort before the index for ANY table got created,
    // including tables where the index really was still missing.
    for (const table of hotelScoped) {
      const columns = await queryInterface.describeTable(table);
      if (!columns.local_id) {
        await queryInterface.addColumn(table, 'local_id', { type: Sequelize.INTEGER, allowNull: true });
      }
      const indexes = await queryInterface.showIndex(table);
      const indexName = `${table}_hotel_local_id_unique`;
      if (!indexes.some((i) => i.name === indexName)) {
        await queryInterface.addIndex(table, {
          fields: ['hotel_id', 'local_id'],
          unique: true,
          name: indexName,
          where: { local_id: { [Sequelize.Op.ne]: null } },
        });
      }
    }

    // hms_cashMovement_msts has no hotel_id of its own (only cashSessionId
    // -> hms_cashSession_msts -> hotel_id) - scope the uniqueness by
    // cashSessionId instead, which is enough to disambiguate (a local_id is
    // only ever meaningful within the local exe's own db, and cashSessionId
    // already ties a movement to one specific hotel's session).
    const cmColumns = await queryInterface.describeTable('hms_cashMovement_msts');
    if (!cmColumns.local_id) {
      await queryInterface.addColumn('hms_cashMovement_msts', 'local_id', { type: Sequelize.INTEGER, allowNull: true });
    }
    const cmIndexes = await queryInterface.showIndex('hms_cashMovement_msts');
    if (!cmIndexes.some((i) => i.name === 'hms_cashMovement_msts_session_local_id_unique')) {
      await queryInterface.addIndex('hms_cashMovement_msts', {
        fields: ['cashSessionId', 'local_id'],
        unique: true,
        name: 'hms_cashMovement_msts_session_local_id_unique',
        where: { local_id: { [Sequelize.Op.ne]: null } },
      });
    }
  },

  async down(queryInterface) {
    const tables = [
      'hms_recipes_msts', 'hms_semi_finished_items_msts', 'hms_semi_finished_recipes_msts',
      'hms_expense_head_msts', 'hms_expense_entry_msts', 'hms_cashSession_msts', 'hms_promo_codes',
      'hms_watage_msts', 'hms_purchase_orders', 'hms_purchase_payments', 'hms_suppliers', 'hms_cashMovement_msts',
    ];
    for (const table of tables) {
      await queryInterface.removeColumn(table, 'local_id');
    }
  },
};
