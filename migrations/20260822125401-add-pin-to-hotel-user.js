'use strict';

// Adds the `pin` column backing PIN-based login (controller/auth.js
// pinLogin). hms_hotelUser_masters is in TABLES_TO_SKIP_ALTER (server.js),
// so this table never gets an automatic ALTER at boot - this migration is
// the first real, tracked schema change for it, replacing the one-off
// manual ALTER TABLE used to unblock local dev before this tooling existed.
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // Guarded the same way 20260825110622/20260916100000 are: on a
    // genuinely fresh database, server.js's boot-time sync() creates this
    // table from the CURRENT model/hotelUser.js, which already declares
    // `pin` - so an unguarded addColumn fails with "Duplicate column name
    // 'pin'" the instant sync has run even once before this migration does
    // (confirmed live, 2026-09-18, on the very first fresh install this
    // migration history was ever replayed against).
    const table = await queryInterface.describeTable('hms_hotelUser_masters');
    if (!table.pin) {
      await queryInterface.addColumn('hms_hotelUser_masters', 'pin', {
        type: Sequelize.STRING,
        allowNull: true,
      });
    }
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('hms_hotelUser_masters', 'pin');
  },
};
