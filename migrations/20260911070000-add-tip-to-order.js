'use strict';

// hms_order_msts is in server.js's TABLES_TO_SKIP_ALTER, so this is the
// only way it gets this column at all - see model/order.js's own comment
// on the tip field for why it exists and how it's attributed.
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // Guarded: model/order.js already declares tip, so a fresh sync-created
    // table has it before this migration ever runs.
    const table = await queryInterface.describeTable('hms_order_msts');
    if (!table.tip) {
      await queryInterface.addColumn('hms_order_msts', 'tip', {
        type: Sequelize.DOUBLE,
        defaultValue: 0,
      });
    }
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('hms_order_msts', 'tip');
  },
};
