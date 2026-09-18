'use strict';

// hms_order_msts is in server.js's TABLES_TO_SKIP_ALTER, so this is the
// only way it gets these columns at all - see model/order.js's own comment
// on delivery_charge/packaging_charge for why they exist.
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // Guarded: model/order.js already declares both columns, so a fresh
    // sync-created table has them before this migration ever runs.
    const table = await queryInterface.describeTable('hms_order_msts');
    if (!table.delivery_charge) {
      await queryInterface.addColumn('hms_order_msts', 'delivery_charge', {
        type: Sequelize.DOUBLE,
        defaultValue: 0,
      });
    }
    if (!table.packaging_charge) {
      await queryInterface.addColumn('hms_order_msts', 'packaging_charge', {
        type: Sequelize.DOUBLE,
        defaultValue: 0,
      });
    }
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('hms_order_msts', 'delivery_charge');
    await queryInterface.removeColumn('hms_order_msts', 'packaging_charge');
  },
};
