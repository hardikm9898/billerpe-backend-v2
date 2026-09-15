'use strict';

// New top-level "menu catalogue" concept (e.g. "Main Menu", "Bar Menu") -
// see model/menuCatalog.js for the full design rationale. This table has no
// data of its own to backfill (it doesn't exist yet); the next migration
// adds menu_catalog_id to the tables that reference it, and the one after
// that seeds a default catalogue per existing hotel and points their
// existing rows at it.
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('hms_menu_catalog_msts', {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      hotel_id: { type: Sequelize.INTEGER, allowNull: false },
      name: { type: Sequelize.STRING, allowNull: false },
      is_default: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      table_category_ids: { type: Sequelize.JSON, allowNull: true },
      order_types: { type: Sequelize.JSON, allowNull: true },
      enter_by: { type: Sequelize.STRING, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
    });

    await queryInterface.addIndex('hms_menu_catalog_msts', ['hotel_id']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('hms_menu_catalog_msts');
  },
};
