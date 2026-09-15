'use strict';

// hms_order_msts is in server.js's TABLES_TO_SKIP_ALTER, so this is the
// only way it gets these columns at all - see model/order.js's own comment
// on delivery_charge/packaging_charge for why they exist.
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('hms_order_msts', 'delivery_charge', {
      type: Sequelize.DOUBLE,
      defaultValue: 0,
    });
    await queryInterface.addColumn('hms_order_msts', 'packaging_charge', {
      type: Sequelize.DOUBLE,
      defaultValue: 0,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('hms_order_msts', 'delivery_charge');
    await queryInterface.removeColumn('hms_order_msts', 'packaging_charge');
  },
};
