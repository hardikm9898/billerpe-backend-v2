'use strict';

// Outlet setup at creation (owner 2026-10-09): cs_outlet_setups
// (model/csSetup.js) and what a catalog plan includes free
// (bil_items.includes, JSON [{ itemId, qty }] of inventory items).
module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = (await queryInterface.showAllTables()).map((t) => (typeof t === 'string' ? t : t.tableName));
    const items = await queryInterface.describeTable('bil_items');
    if (!items.includes) await queryInterface.addColumn('bil_items', 'includes', { type: Sequelize.TEXT, allowNull: true });
    if (tables.includes('cs_outlet_setups')) return;
    const Sd = (n, d = '') => ({ type: Sequelize.STRING(n), allowNull: false, defaultValue: d });
    const I = { type: Sequelize.INTEGER, allowNull: true };
    const D = { type: Sequelize.DATE, allowNull: true };
    const M = { type: Sequelize.DECIMAL(12, 2), allowNull: false, defaultValue: 0 };
    await queryInterface.createTable('cs_outlet_setups', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      status: Sd(10, 'approval'),
      source: Sd(10, 'new'),
      hotel_id: I,
      account_id: I,
      lead_id: I,
      outlet_name: Sd(120),
      owner_mobile: Sd(10),
      plan_item_id: I,
      plan_label: Sd(120),
      years: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1 },
      includes: { type: Sequelize.TEXT, allowNull: true },
      request: { type: Sequelize.TEXT, allowNull: true },
      reasons: { type: Sequelize.TEXT, allowNull: true },
      total: M,
      token_amount: M,
      invoice_id: I,
      token_payment_id: I,
      pay_by: D,
      frozen_at: D,
      created_by: I,
      decided_by: I,
      decided_at: D,
      reject_reason: Sd(200),
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('cs_outlet_setups', ['hotel_id'], { name: 'cs_outlet_setups_hotel', unique: true });
    await queryInterface.addIndex('cs_outlet_setups', ['status'], { name: 'cs_outlet_setups_status' });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('cs_outlet_setups');
    await queryInterface.removeColumn('bil_items', 'includes');
  },
};
