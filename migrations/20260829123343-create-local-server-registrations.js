'use strict';

// Phase A of the local-first architecture migration (see the architecture
// memo): the central authority for "which PC is this restaurant's active
// local server". Nothing like this existed before this migration -
// controller/deviceRegistration.js on billerpe-local-exe never had a real
// device-registration endpoint to call on this side; today's registration
// is just the owner's normal login, so nothing stops two PCs from both
// registering as the same hotel's active server.
//
// MySQL has no native partial-unique-index syntax (`UNIQUE ... WHERE
// status = 'active'`, which Postgres/SQLite support directly), so "only one
// active row per hotel_id" is emulated with a STORED generated column that
// collapses to NULL for every non-active row - MySQL treats multiple NULLs
// in a UNIQUE index as distinct, so only rows that are actually active can
// ever collide on hotel_id. This is what makes §6 of the architecture spec
// ("one active local server per restaurant") a real database constraint
// instead of an app-level check-then-insert with a race window.
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('local_server_registrations', {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      hotel_id: { type: Sequelize.INTEGER, allowNull: false },
      device_id: { type: Sequelize.STRING, allowNull: false },
      installation_id: { type: Sequelize.STRING, allowNull: false },
      status: { type: Sequelize.ENUM('active', 'released'), allowNull: false, defaultValue: 'active' },
      hostname: { type: Sequelize.STRING, allowNull: true },
      app_version: { type: Sequelize.STRING, allowNull: true },
      os_info: { type: Sequelize.STRING, allowNull: true },
      registered_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
      released_at: { type: Sequelize.DATE, allowNull: true },
      released_by: { type: Sequelize.INTEGER, allowNull: true },
      last_seen_at: { type: Sequelize.DATE, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
    });

    await queryInterface.addIndex('local_server_registrations', ['hotel_id']);
    await queryInterface.addIndex('local_server_registrations', ['device_id']);

    await queryInterface.sequelize.query(`
      ALTER TABLE local_server_registrations
      ADD COLUMN active_hotel_id INT
        GENERATED ALWAYS AS (CASE WHEN status = 'active' THEN hotel_id ELSE NULL END) STORED,
      ADD UNIQUE INDEX uniq_active_hotel (active_hotel_id)
    `);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('local_server_registrations');
  },
};
