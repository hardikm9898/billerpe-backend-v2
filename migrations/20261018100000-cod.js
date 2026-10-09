'use strict';

// India Post cash on delivery (owner 2026-10-09): parcels and the cheques
// (remittances) that pay many of them at once (model/cod.js).
module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = (await queryInterface.showAllTables()).map((t) => (typeof t === 'string' ? t : t.tableName));
    const id = { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false };
    const Sd = (n, d = '') => ({ type: Sequelize.STRING(n), allowNull: false, defaultValue: d });
    const I = { type: Sequelize.INTEGER, allowNull: true };
    const M = { type: Sequelize.DECIMAL(12, 2), allowNull: false, defaultValue: 0 };
    const stamps = { createdAt: { type: Sequelize.DATE, allowNull: false }, updatedAt: { type: Sequelize.DATE, allowNull: false } };
    if (!tables.includes('bil_cod_parcels')) {
      await queryInterface.createTable('bil_cod_parcels', {
        id,
        invoice_id: { type: Sequelize.INTEGER, allowNull: false },
        hotel_id: I,
        consignment: { type: Sequelize.STRING(40), allowNull: false },
        amount: M,
        booked_on: { type: Sequelize.DATEONLY, allowNull: false },
        status: Sd(10, 'booked'),
        remit_id: I,
        move_id: I,
        note: Sd(300),
        created_by: I,
        ...stamps,
      });
      await queryInterface.addIndex('bil_cod_parcels', ['consignment'], { name: 'bil_cod_parcels_consignment', unique: true });
      await queryInterface.addIndex('bil_cod_parcels', ['status'], { name: 'bil_cod_parcels_status' });
      await queryInterface.addIndex('bil_cod_parcels', ['invoice_id'], { name: 'bil_cod_parcels_invoice' });
    }
    if (!tables.includes('bil_cod_remits')) {
      await queryInterface.createTable('bil_cod_remits', {
        id,
        reference: { type: Sequelize.STRING(60), allowNull: false },
        received_on: { type: Sequelize.DATEONLY, allowNull: false },
        amount: M,
        parcels_total: M,
        charges: M,
        proof: { type: Sequelize.STRING(500), allowNull: true },
        note: Sd(300),
        status: Sd(10, 'pending'),
        created_by: I,
        decided_by: I,
        decided_at: { type: Sequelize.DATE, allowNull: true },
        reject_reason: Sd(200),
        ...stamps,
      });
      await queryInterface.addIndex('bil_cod_remits', ['status'], { name: 'bil_cod_remits_status' });
    }
  },

  async down(queryInterface) {
    await queryInterface.dropTable('bil_cod_remits');
    await queryInterface.dropTable('bil_cod_parcels');
  },
};
