'use strict';

// Restores the orderId column that model/ebillCreditDebit.js has always
// had commented out. controller/kto.js's debit-side EBillCreditDebit.create
// calls already pass `orderId` (see the debit entries created when an
// e-bill is sent) but it was silently dropped since Sequelize ignores any
// field not declared on the model - every e-bill debit ledger row has
// lost which order it was for. hms_ebillCreditDebit_msts is in
// TABLES_TO_SKIP_ALTER (server.js), so this table never gets an automatic
// ALTER at boot. The local dev DB already had this column (leftover from
// before this table was frozen off auto-alter, confirmed live via
// describeTable) - guarded with an existence check so this migration is
// still the real, tracked fix for any environment that's missing it.
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('hms_ebillCreditDebit_msts');
    if (!table.orderId) {
      await queryInterface.addColumn('hms_ebillCreditDebit_msts', 'orderId', {
        type: Sequelize.INTEGER,
        allowNull: true,
      });
    }
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('hms_ebillCreditDebit_msts', 'orderId');
  },
};
