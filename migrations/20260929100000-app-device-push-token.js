'use strict';

// POS App push notifications (owner list 2026-09-29 #9): the Firebase
// Cloud Messaging token of the phone, so alerts reach it when the app is
// closed. Safe to re-run.
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const columns = await queryInterface.describeTable('app_devices');
    if (!columns.push_token) {
      await queryInterface.addColumn('app_devices', 'push_token', { type: Sequelize.STRING(255), allowNull: true });
    }
  },

  async down(queryInterface) {
    const columns = await queryInterface.describeTable('app_devices');
    if (columns.push_token) await queryInterface.removeColumn('app_devices', 'push_token');
  },
};
