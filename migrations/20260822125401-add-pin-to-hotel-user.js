'use strict';

// Adds the `pin` column backing PIN-based login (controller/auth.js
// pinLogin). hms_hotelUser_masters is in TABLES_TO_SKIP_ALTER (server.js),
// so this table never gets an automatic ALTER at boot - this migration is
// the first real, tracked schema change for it, replacing the one-off
// manual ALTER TABLE used to unblock local dev before this tooling existed.
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('hms_hotelUser_masters', 'pin', {
      type: Sequelize.STRING,
      allowNull: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('hms_hotelUser_masters', 'pin');
  },
};
