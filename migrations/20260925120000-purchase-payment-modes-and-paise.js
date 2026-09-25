'use strict';

// Supplier payments (owner request, 2026-09-25): a purchase-order payment
// now carries the outlet's own payment mode (Cash, UPI, Card, a custom mode,
// Cheque, Bank transfer). payment_mode was ENUM(card, cheque, online, other,
// cash), so an outlet's "UPI" payment could not be stored here when the exe
// pushed it. Purchase money columns were INTEGER / BIGINT and dropped paise.
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const pay = await queryInterface.describeTable('hms_purchase_payments');
    if (pay.payment_mode) {
      await queryInterface.changeColumn('hms_purchase_payments', 'payment_mode', { type: Sequelize.STRING(60), allowNull: true });
    }
    if (pay.amount) {
      await queryInterface.changeColumn('hms_purchase_payments', 'amount', { type: Sequelize.DOUBLE, defaultValue: 0 });
    }
    const po = await queryInterface.describeTable('hms_purchase_orders');
    for (const col of ['sub_total', 'discount_value', 'grandAmount', 'discount', 'delivery_charge']) {
      if (po[col]) {
        await queryInterface.changeColumn('hms_purchase_orders', col, { type: Sequelize.DOUBLE, defaultValue: 0 });
      }
    }
  },

  async down() {
    // Not reversed: narrowing back to ENUM / INTEGER would lose data.
  },
};
