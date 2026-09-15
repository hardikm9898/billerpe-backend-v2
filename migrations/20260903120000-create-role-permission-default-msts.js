'use strict';

const { ROLES, ROLE_PERMISSION_DEFAULTS, ROLE_SPECIAL_DEFAULTS } = require("../constant/rolePermissionDefaults");

// New role-level permission "template" table - see model/rolePermissionDefault.js
// for the full design rationale. Backfills one row per (existing hotel, role)
// with the exact same default matrix the frontend has always shipped
// hardcoded locally, so every hotel starts with identical behavior to
// before this table existed; new hotels get the same seed via
// controller/hotel.js's addHotelDetails.
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('hms_role_permission_default_msts', {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      hotel_id: { type: Sequelize.INTEGER, allowNull: false },
      role: {
        type: Sequelize.ENUM("Owner", "Manager", "Cashier", "Captain", "Kitchen Staff", "Inventory Manager", "Accountant"),
        allowNull: false,
      },
      permissions: { type: Sequelize.JSON, allowNull: false },
      special_permissions: { type: Sequelize.JSON, allowNull: false },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
    });
    await queryInterface.addIndex('hms_role_permission_default_msts', ['hotel_id']);

    const hotels = await queryInterface.sequelize.query(
      'SELECT id FROM hotel_registrations',
      { type: Sequelize.QueryTypes.SELECT },
    );
    const now = new Date();
    const rows = [];
    for (const hotel of hotels) {
      for (const role of ROLES) {
        rows.push({
          hotel_id: hotel.id,
          role,
          permissions: JSON.stringify(ROLE_PERMISSION_DEFAULTS[role]),
          special_permissions: JSON.stringify(ROLE_SPECIAL_DEFAULTS[role]),
          createdAt: now,
          updatedAt: now,
        });
      }
    }
    if (rows.length) {
      await queryInterface.bulkInsert('hms_role_permission_default_msts', rows);
    }
  },

  async down(queryInterface) {
    await queryInterface.dropTable('hms_role_permission_default_msts');
  },
};
