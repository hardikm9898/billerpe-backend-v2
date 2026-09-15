'use strict';

// hms_order_msts is in server.js's TABLES_TO_SKIP_ALTER, so this is the
// only way it gets this column at all - see model/order.js's own comment
// on the billPrintCount field for why it exists.
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('hms_order_msts', 'billPrintCount', {
      type: Sequelize.INTEGER,
      defaultValue: 0,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('hms_order_msts', 'billPrintCount');
  },
};
