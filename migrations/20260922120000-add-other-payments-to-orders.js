'use strict';

// Custom payment modes (owner report, 2026-09-22): a bill paid with a mode
// the outlet added itself (Paytm, ...) could not be settled, because an order
// only had the fixed cash/upi/card/due columns. The exe now stores those
// amounts as other_payments (JSON [{ name, amount }]) + other_amount (their
// total) and syncs them here (controller/sync/syncController.js ORDER_FIELDS).
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const columns = await queryInterface.describeTable('hms_order_msts');
    if (!columns.other_payments) {
      await queryInterface.addColumn('hms_order_msts', 'other_payments', {
        type: Sequelize.TEXT,
        allowNull: true,
      });
    }
    if (!columns.other_amount) {
      await queryInterface.addColumn('hms_order_msts', 'other_amount', {
        type: Sequelize.DOUBLE,
        defaultValue: 0,
      });
    }
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('hms_order_msts', 'other_payments').catch(() => {});
    await queryInterface.removeColumn('hms_order_msts', 'other_amount').catch(() => {});
  },
};
