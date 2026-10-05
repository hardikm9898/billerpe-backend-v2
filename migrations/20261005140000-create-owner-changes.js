'use strict';

// Owner App changes waiting for the outlet PC (model/ownerApp.js OwnerChange).
module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = (await queryInterface.showAllTables()).map((t) => (typeof t === 'string' ? t : t.tableName));
    if (tables.includes('owner_changes')) return;
    await queryInterface.createTable('owner_changes', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      hotel_id: { type: Sequelize.INTEGER, allowNull: false },
      entity: { type: Sequelize.STRING(40), allowNull: false },
      item_id: { type: Sequelize.INTEGER, allowNull: false },
      label: { type: Sequelize.STRING(120), allowNull: false, defaultValue: '' },
      synced_at: { type: Sequelize.DATE, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('owner_changes', ['hotel_id', 'entity', 'synced_at'], { name: 'owner_changes_pending' });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('owner_changes');
  },
};
