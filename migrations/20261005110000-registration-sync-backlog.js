'use strict';

// Owner App: what an outlet PC still has to upload, reported on its 60 s
// heartbeat (x-exe-pending-orders / x-exe-last-push-age). Null for an exe
// too old to send them.
module.exports = {
  async up(queryInterface, Sequelize) {
    const cols = await queryInterface.describeTable('local_server_registrations');
    if (!cols.pending_orders) await queryInterface.addColumn('local_server_registrations', 'pending_orders', { type: Sequelize.INTEGER, allowNull: true });
    if (!cols.last_push_at) await queryInterface.addColumn('local_server_registrations', 'last_push_at', { type: Sequelize.DATE, allowNull: true });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('local_server_registrations', 'pending_orders');
    await queryInterface.removeColumn('local_server_registrations', 'last_push_at');
  },
};
