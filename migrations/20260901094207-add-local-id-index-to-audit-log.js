'use strict';

// AuditLog (billerpe-local-exe's model/auditLog.js push target) is a brand
// new table, not an existing one gaining a column - its Sequelize
// `define()` already declares `local_id` inline, so `sync({alter:true})`
// creates the column on first boot without help. The unique index still
// gets its own migration here, matching every other Task-2 entity
// (20260901074800-add-local-id-to-operations-entities.js) rather than
// relying on sync()'s automatic index handling, which this codebase
// deliberately doesn't trust in production (see server.js's qi.addIndex/
// removeIndex overrides).
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // Guarded: this model's `local_id` column is real (declared inline, per
    // this file's own comment above), but the model does not declare this
    // INDEX, so a fresh sync-created table is still missing it - unlike the
    // column, which the guard below correctly leaves alone if already there
    // from a re-run.
    const indexes = await queryInterface.showIndex('hms_auditLog_msts');
    if (!indexes.some((i) => i.name === 'hms_auditLog_msts_hotel_local_id_unique')) {
      await queryInterface.addIndex('hms_auditLog_msts', {
        fields: ['hotel_id', 'local_id'],
        unique: true,
        name: 'hms_auditLog_msts_hotel_local_id_unique',
        where: { local_id: { [Sequelize.Op.ne]: null } },
      });
    }
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('hms_auditLog_msts', 'hms_auditLog_msts_hotel_local_id_unique');
  },
};
