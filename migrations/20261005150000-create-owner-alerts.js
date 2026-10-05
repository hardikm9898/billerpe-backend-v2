'use strict';

// Owner App alerts: alerts, per-owner alert rules, outlet PC offline spells
// (model/ownerApp.js OwnerAlert / OwnerSetting / OwnerOfflinePeriod).
module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = (await queryInterface.showAllTables()).map((t) => (typeof t === 'string' ? t : t.tableName));
    const id = { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false };
    const stamps = { createdAt: { type: Sequelize.DATE, allowNull: false }, updatedAt: { type: Sequelize.DATE, allowNull: false } };
    if (!tables.includes('owner_alerts')) {
      await queryInterface.createTable('owner_alerts', {
        id,
        owner_mobile: { type: Sequelize.STRING(15), allowNull: false },
        hotel_id: { type: Sequelize.INTEGER, allowNull: true },
        kind: { type: Sequelize.STRING(24), allowNull: false },
        ref: { type: Sequelize.STRING(120), allowNull: false },
        title: { type: Sequelize.STRING(160), allowNull: false },
        body: { type: Sequelize.STRING(400), allowNull: false, defaultValue: '' },
        link: { type: Sequelize.STRING(160), allowNull: false, defaultValue: '/alerts' },
        event_at: { type: Sequelize.DATE, allowNull: false },
        read_at: { type: Sequelize.DATE, allowNull: true },
        pushed: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
        ...stamps,
      });
      await queryInterface.addIndex('owner_alerts', ['owner_mobile', 'ref'], { name: 'owner_alerts_owner_ref', unique: true });
      await queryInterface.addIndex('owner_alerts', ['owner_mobile', 'event_at'], { name: 'owner_alerts_owner_time' });
    }
    if (!tables.includes('owner_settings')) {
      await queryInterface.createTable('owner_settings', {
        id, owner_mobile: { type: Sequelize.STRING(15), allowNull: false, unique: true }, rules: { type: Sequelize.TEXT, allowNull: true }, ...stamps,
      });
    }
    if (!tables.includes('owner_offline_periods')) {
      await queryInterface.createTable('owner_offline_periods', {
        id, hotel_id: { type: Sequelize.INTEGER, allowNull: false }, started_at: { type: Sequelize.DATE, allowNull: false }, ended_at: { type: Sequelize.DATE, allowNull: true }, ...stamps,
      });
      await queryInterface.addIndex('owner_offline_periods', ['hotel_id', 'started_at'], { name: 'owner_offline_hotel_start' });
    }
  },

  async down(queryInterface) {
    await queryInterface.dropTable('owner_offline_periods');
    await queryInterface.dropTable('owner_settings');
    await queryInterface.dropTable('owner_alerts');
  },
};
