'use strict';

// The date printed on a bill is the moment the BILL was generated, not when
// the table was opened and not the trading day (owner rule, 2026-09-22: a
// table that sat overnight printed yesterday's date). The exe stamps this
// when a bill is generated or settled and syncs it up
// (billerpe-local-exe/helpers/orderTotals.js#stampBilledAt).
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const columns = await queryInterface.describeTable('hms_order_msts');
    if (!columns.billed_at) {
      await queryInterface.addColumn('hms_order_msts', 'billed_at', {
        type: Sequelize.DATE,
        allowNull: true,
      });
    }
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('hms_order_msts', 'billed_at').catch(() => {});
  },
};
