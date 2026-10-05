'use strict';

// BillerPe Owner App (Plan 1 owners): one row per phone an owner is logged
// in on (model/ownerApp.js).
module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = (await queryInterface.showAllTables()).map((t) => (typeof t === 'string' ? t : t.tableName));
    if (tables.includes('owner_devices')) return;
    await queryInterface.createTable('owner_devices', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      owner_mobile: { type: Sequelize.STRING(15), allowNull: false },
      hotel_user_id: { type: Sequelize.INTEGER, allowNull: false },
      password_fp: { type: Sequelize.STRING(16), allowNull: false },
      device_id: { type: Sequelize.STRING(64), allowNull: false },
      name: { type: Sequelize.STRING(80), allowNull: false, defaultValue: '' },
      make: { type: Sequelize.STRING(60), allowNull: false, defaultValue: '' },
      model: { type: Sequelize.STRING(60), allowNull: false, defaultValue: '' },
      android: { type: Sequelize.STRING(20), allowNull: false, defaultValue: '' },
      app_version: { type: Sequelize.STRING(20), allowNull: false, defaultValue: '' },
      push_token: { type: Sequelize.STRING(255), allowNull: true },
      language: { type: Sequelize.STRING(8), allowNull: false, defaultValue: 'en' },
      status: { type: Sequelize.STRING(16), allowNull: false, defaultValue: 'active' },
      last_active: { type: Sequelize.DATE, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('owner_devices', ['owner_mobile', 'device_id'], { name: 'owner_devices_mobile_device', unique: true });
    await queryInterface.addIndex('owner_devices', ['owner_mobile', 'status'], { name: 'owner_devices_mobile_status' });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('owner_devices');
  },
};
