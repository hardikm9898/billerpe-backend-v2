'use strict';

// Internal procurement-request workflow (was 100% frontend-mock in
// billerpe-pos-pro-v2 until now) - see model/Inventory/requisition.js and
// model/Inventory/requisitionItem.js for the design rationale. Brand new
// concept, no existing data to backfill.
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('hms_requisition_msts', {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      hotel_id: { type: Sequelize.INTEGER, allowNull: false },
      req_no: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      business_date: { type: Sequelize.DATEONLY, allowNull: true },
      status: {
        type: Sequelize.ENUM("Pending", "Accepted", "Out for delivery", "Delivered", "Rejected"),
        allowNull: false,
        defaultValue: "Pending",
      },
      remarks: { type: Sequelize.STRING, allowNull: true },
      raised_by: { type: Sequelize.STRING, allowNull: true },
      purchase_order_id: { type: Sequelize.INTEGER, allowNull: true },
      deleted_status: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
    });
    await queryInterface.addIndex('hms_requisition_msts', ['hotel_id']);

    await queryInterface.createTable('hms_requisition_item_msts', {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      hotel_id: { type: Sequelize.INTEGER, allowNull: false },
      requisition_id: { type: Sequelize.INTEGER, allowNull: false },
      raw_material_id: { type: Sequelize.INTEGER, allowNull: false },
      ordered_qty: { type: Sequelize.FLOAT, allowNull: false, defaultValue: 0 },
      approved_qty: { type: Sequelize.FLOAT, allowNull: true },
      unit_price: { type: Sequelize.FLOAT, allowNull: false, defaultValue: 0 },
      deleted_status: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
    });
    await queryInterface.addIndex('hms_requisition_item_msts', ['requisition_id']);
    await queryInterface.addIndex('hms_requisition_item_msts', ['hotel_id']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('hms_requisition_item_msts');
    await queryInterface.dropTable('hms_requisition_msts');
  },
};
