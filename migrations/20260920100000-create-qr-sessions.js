'use strict';

// Server-side QR ordering sessions (model/qrSession.js): one customer's
// visit at one table, keyed by mobile, holding every round they submit.
// Also a one-time client_key per round so a retried submission is saved
// once. Owner-approved design, 2026-09-20. Idempotent: server.js's boot
// sync may already have created the table/columns from the models.
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const exists = await queryInterface.describeTable('hms_qr_session_msts').then(() => true, () => false);
    if (!exists) await queryInterface.createTable('hms_qr_session_msts', {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      hotel_id: { type: Sequelize.INTEGER, allowNull: false },
      table_id: { type: Sequelize.INTEGER, allowNull: false },
      customer_mobile: { type: Sequelize.STRING, allowNull: false },
      customer_name: { type: Sequelize.STRING, allowNull: true },
      session_key: { type: Sequelize.STRING(64), allowNull: false },
      status: { type: Sequelize.ENUM('open', 'closed'), allowNull: false, defaultValue: 'open' },
      bill_ready: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      closed_reason: { type: Sequelize.STRING, allowNull: true },
      closed_at: { type: Sequelize.DATE, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
    });

    const sessionIndexes = await queryInterface.showIndex('hms_qr_session_msts');
    const has = (list, name) => list.some((i) => i.name === name);
    if (!has(sessionIndexes, 'qr_session_key_unique') && !sessionIndexes.some((i) => i.unique && i.fields?.some((f) => f.attribute === 'session_key'))) {
      await queryInterface.addIndex('hms_qr_session_msts', { fields: ['session_key'], unique: true, name: 'qr_session_key_unique' });
    }
    if (!has(sessionIndexes, 'qr_session_lookup')) {
      await queryInterface.addIndex('hms_qr_session_msts', { fields: ['hotel_id', 'table_id', 'status', 'customer_mobile'], name: 'qr_session_lookup' });
    }

    const orderColumns = await queryInterface.describeTable('hms_qr_order_msts');
    if (!orderColumns.session_id) {
      await queryInterface.addColumn('hms_qr_order_msts', 'session_id', { type: Sequelize.INTEGER, allowNull: true });
    }
    if (!orderColumns.client_key) {
      await queryInterface.addColumn('hms_qr_order_msts', 'client_key', { type: Sequelize.STRING(64), allowNull: true });
    }
    const orderIndexes = await queryInterface.showIndex('hms_qr_order_msts');
    if (!has(orderIndexes, 'qr_order_session_client_key_unique')) {
      // NULLs are distinct in a MySQL unique index, so rounds from before
      // sessions existed (both columns NULL) never collide.
      await queryInterface.addIndex('hms_qr_order_msts', {
        fields: ['session_id', 'client_key'], unique: true, name: 'qr_order_session_client_key_unique',
      });
    }
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('hms_qr_order_msts', 'qr_order_session_client_key_unique').catch(() => {});
    await queryInterface.removeColumn('hms_qr_order_msts', 'client_key').catch(() => {});
    await queryInterface.removeColumn('hms_qr_order_msts', 'session_id').catch(() => {});
    await queryInterface.dropTable('hms_qr_session_msts');
  },
};
