'use strict';

// Franchise outlets in the Owner App / Owner Dashboard (model/ownerApp.js
// OwnerOutletLink): an outlet shown to its franchise owner instead of the
// owner in its own owner_number.
module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = (await queryInterface.showAllTables()).map((t) => (typeof t === 'string' ? t : t.tableName));
    if (tables.includes('owner_outlet_links')) return;
    await queryInterface.createTable('owner_outlet_links', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      owner_mobile: { type: Sequelize.STRING(15), allowNull: false },
      hotel_id: { type: Sequelize.INTEGER, allowNull: false },
      note: { type: Sequelize.STRING(160), allowNull: false, defaultValue: '' },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('owner_outlet_links', ['hotel_id'], { unique: true, name: 'owner_outlet_links_hotel' });
    await queryInterface.addIndex('owner_outlet_links', ['owner_mobile'], { name: 'owner_outlet_links_owner' });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('owner_outlet_links');
  },
};
