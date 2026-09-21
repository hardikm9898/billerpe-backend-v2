'use strict';

// Tickets raised from the Web POS carry a subject plus a full description
// of what happened, which does not fit the old VARCHAR(255) `issue` column.
// hms_raise_ticket_msts is in server.js's TABLES_TO_SKIP_ALTER, so a
// migration is the only way the column changes.
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.changeColumn('hms_raise_ticket_msts', 'issue', {
      type: Sequelize.TEXT,
      allowNull: true,
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.changeColumn('hms_raise_ticket_msts', 'issue', {
      type: Sequelize.STRING,
      defaultValue: '',
    });
  },
};
