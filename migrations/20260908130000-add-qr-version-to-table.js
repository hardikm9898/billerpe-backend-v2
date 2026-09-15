'use strict';

// QR table ordering - a table's QR link is deliberately stable/printable
// (no rotating token), which means anyone who ever sees that link can
// resubmit an order for it indefinitely. qr_version is the one lever staff
// have to kill a specific leaked/abused table's link without touching any
// other table: bump it, reprint just that one QR (controller/qrOrder.js's
// createQrOrder validates the submitted version against this column and
// rejects a stale one), everything else keeps working unchanged.
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('hms_table_msts', 'qr_version', {
      type: Sequelize.INTEGER,
      allowNull: false,
      defaultValue: 1,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('hms_table_msts', 'qr_version');
  },
};
