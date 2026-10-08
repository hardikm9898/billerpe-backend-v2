'use strict';

// Lead payment tracking (the old panel's per-lead "Payment" tab): proposal
// amount, agreed amount, payment due date, payment reference. New nullable
// columns on crm_leads only.
module.exports = {
  async up(queryInterface, Sequelize) {
    const cols = await queryInterface.describeTable('crm_leads');
    const add = async (name, spec) => {
      if (!cols[name]) await queryInterface.addColumn('crm_leads', name, spec);
    };
    await add('deal_amount', { type: Sequelize.DECIMAL(12, 2), allowNull: true });
    await add('agreed_amount', { type: Sequelize.DECIMAL(12, 2), allowNull: true });
    await add('pay_due_on', { type: Sequelize.DATEONLY, allowNull: true });
    await add('pay_ref', { type: Sequelize.STRING(80), allowNull: false, defaultValue: '' });
  },

  async down(queryInterface) {
    for (const c of ['pay_ref', 'pay_due_on', 'agreed_amount', 'deal_amount']) await queryInterface.removeColumn('crm_leads', c);
  },
};
