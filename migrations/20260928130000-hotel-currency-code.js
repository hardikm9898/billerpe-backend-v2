'use strict';

// Outlet currency (owner decision, 2026-09-28): next to the existing
// `currency` symbol, the code it belongs to ("INR" default; "OTHER" = the
// owner's own symbol). Decides number grouping on the POS. Safe to re-run.
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const columns = await queryInterface.describeTable('hotel_registrations');
    if (!columns.currency_code) {
      await queryInterface.addColumn('hotel_registrations', 'currency_code', { type: Sequelize.STRING, allowNull: true, defaultValue: 'INR' });
    }
  },

  async down(queryInterface) {
    const columns = await queryInterface.describeTable('hotel_registrations');
    if (columns.currency_code) await queryInterface.removeColumn('hotel_registrations', 'currency_code');
  },
};
