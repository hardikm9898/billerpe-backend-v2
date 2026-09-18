'use strict';

// Same reasoning and shape as 20260901074800-add-local-id-to-operations-
// entities.js (the 12 operations-entity tables): hms_order_msts is in
// server.js's TABLES_TO_SKIP_ALTER, so this is the only way it gets this
// column at all. Needed to let a synced offline order get a REAL bill_no
// on its first sync (see controller/offline/offline.js's
// syncOrderDataWithDataBase) instead of keeping its "OFF#" placeholder
// forever - the exe's own local_id (its own Order.id, sent as `local_id`
// in the push payload) is the reliable idempotency key going forward,
// since the bill_no itself is no longer stable across a renumbering push.
// Existing already-synced rows keep local_id NULL - offline.js's own
// fallback still matches those by their existing "OFF#" bill_no and
// backfills local_id onto them the next time they're touched, rather than
// renumbering historical bills.
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // Guarded: model/order.js already declares the local_id COLUMN, so on a
    // fresh database sync's own CREATE TABLE beats this migration to it -
    // but the model's own `indexes:` option (5 entries) does not include
    // this one, so the index genuinely still needs to run.
    const columns = await queryInterface.describeTable('hms_order_msts');
    if (!columns.local_id) {
      await queryInterface.addColumn('hms_order_msts', 'local_id', { type: Sequelize.INTEGER, allowNull: true });
    }
    const indexes = await queryInterface.showIndex('hms_order_msts');
    if (!indexes.some((i) => i.name === 'hms_order_msts_hotel_local_id_unique')) {
      await queryInterface.addIndex('hms_order_msts', {
        fields: ['hotel_id', 'local_id'],
        unique: true,
        name: 'hms_order_msts_hotel_local_id_unique',
        where: { local_id: { [Sequelize.Op.ne]: null } },
      });
    }
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('hms_order_msts', 'local_id');
  },
};
