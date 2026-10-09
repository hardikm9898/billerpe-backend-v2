'use strict';

// BillerPe SuperAdmin: the office stock of printers, rolls and other items
// given to outlets (model/inventory.js, owner 2026-10-09).
module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = (await queryInterface.showAllTables()).map((t) => (typeof t === 'string' ? t : t.tableName));
    const id = { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false };
    const Sd = (n, d = '') => ({ type: Sequelize.STRING(n), allowNull: false, defaultValue: d });
    const I = { type: Sequelize.INTEGER, allowNull: true };
    const N = (d = 0) => ({ type: Sequelize.INTEGER, allowNull: false, defaultValue: d });
    const D = { type: Sequelize.DATE, allowNull: true };
    const stamps = { createdAt: { type: Sequelize.DATE, allowNull: false }, updatedAt: { type: Sequelize.DATE, allowNull: false } };
    const make = async (name, cols, indexes = []) => {
      if (tables.includes(name)) return;
      await queryInterface.createTable(name, cols);
      for (const [fields, opts] of indexes) await queryInterface.addIndex(name, fields, opts);
    };

    await make('inv_items', {
      id,
      code: { type: Sequelize.STRING(30), allowNull: false },
      name: { type: Sequelize.STRING(80), allowNull: false },
      category: Sd(12, 'other'),
      unit: Sd(12, 'pcs'),
      price: { type: Sequelize.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
      gst_rate: { type: Sequelize.DECIMAL(5, 2), allowNull: false, defaultValue: 18 },
      hsn: Sd(8),
      stock_office: N(),
      stock_damaged: N(),
      low_at: N(),
      sort: N(),
      active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      ...stamps,
    }, [[['code'], { name: 'inv_items_code', unique: true }]]);

    await make('inv_moves', {
      id,
      item_id: { type: Sequelize.INTEGER, allowNull: false },
      kind: { type: Sequelize.STRING(10), allowNull: false },
      qty: { type: Sequelize.INTEGER, allowNull: false },
      bucket: Sd(8, 'office'),
      hotel_id: I,
      invoice_id: I,
      setup_id: I,
      basis: Sd(8),
      carrier: Sd(10),
      ref: Sd(80),
      serials: Sd(400),
      unit_cost: { type: Sequelize.DECIMAL(12, 2), allowNull: true },
      proof: { type: Sequelize.STRING(500), allowNull: true },
      note: Sd(300),
      status: Sd(10, 'done'),
      created_by: I,
      decided_by: I,
      decided_at: D,
      reject_reason: Sd(200),
      ...stamps,
    }, [
      [['item_id', 'status'], { name: 'inv_moves_item' }],
      [['hotel_id'], { name: 'inv_moves_hotel' }],
      [['invoice_id'], { name: 'inv_moves_invoice' }],
      [['status'], { name: 'inv_moves_status' }],
    ]);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('inv_moves');
    await queryInterface.dropTable('inv_items');
  },
};
