'use strict';

// Owner App stock: levels and daily ledger totals uploaded by Plan 1 outlet
// PCs (model/ownerApp.js OwnerStockLevel / OwnerStockDay).
module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = (await queryInterface.showAllTables()).map((t) => (typeof t === 'string' ? t : t.tableName));
    const id = { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false };
    const stamps = { createdAt: { type: Sequelize.DATE, allowNull: false }, updatedAt: { type: Sequelize.DATE, allowNull: false } };
    const num = { type: Sequelize.DOUBLE, allowNull: false, defaultValue: 0 };
    if (!tables.includes('owner_stock_levels')) {
      await queryInterface.createTable('owner_stock_levels', {
        id, hotel_id: { type: Sequelize.INTEGER, allowNull: false }, kind: { type: Sequelize.STRING(8), allowNull: false },
        item_id: { type: Sequelize.INTEGER, allowNull: false }, qty: num, cost: num, value: num, ...stamps,
      });
      await queryInterface.addIndex('owner_stock_levels', ['hotel_id'], { name: 'owner_stock_levels_hotel' });
    }
    if (!tables.includes('owner_stock_days')) {
      const cols = {};
      for (const c of ['purchased', 'used', 'wastage', 'manual', 'opening_entry']) {
        cols[`${c}_qty`] = num;
        cols[`${c}_value`] = num;
      }
      await queryInterface.createTable('owner_stock_days', {
        id, hotel_id: { type: Sequelize.INTEGER, allowNull: false }, business_date: { type: Sequelize.DATEONLY, allowNull: false },
        kind: { type: Sequelize.STRING(8), allowNull: false }, item_id: { type: Sequelize.INTEGER, allowNull: false }, ...cols, ...stamps,
      });
      await queryInterface.addIndex('owner_stock_days', ['hotel_id', 'business_date'], { name: 'owner_stock_days_hotel_date' });
    }
  },

  async down(queryInterface) {
    await queryInterface.dropTable('owner_stock_days');
    await queryInterface.dropTable('owner_stock_levels');
  },
};
