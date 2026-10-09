'use strict';

// Onboarding steps need proof (owner 2026-10-09): what kind (photo | call |
// note), the stored photo, and for "Payment received" the paid invoice.
module.exports = {
  async up(queryInterface, Sequelize) {
    const cols = await queryInterface.describeTable('cs_onboarding_items');
    if (!cols.proof_kind) await queryInterface.addColumn('cs_onboarding_items', 'proof_kind', { type: Sequelize.STRING(8), allowNull: true });
    if (!cols.proof) await queryInterface.addColumn('cs_onboarding_items', 'proof', { type: Sequelize.STRING(500), allowNull: true });
    if (!cols.invoice_id) await queryInterface.addColumn('cs_onboarding_items', 'invoice_id', { type: Sequelize.INTEGER, allowNull: true });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('cs_onboarding_items', 'invoice_id');
    await queryInterface.removeColumn('cs_onboarding_items', 'proof');
    await queryInterface.removeColumn('cs_onboarding_items', 'proof_kind');
  },
};
