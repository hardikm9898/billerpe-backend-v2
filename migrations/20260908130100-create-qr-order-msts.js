'use strict';

// QR table ordering - see model/qrOrder.js for the full design rationale.
// This row is only ever the handoff/inbox record between a customer's
// phone and the exe; the exe is what actually creates the real, billable
// order once staff accepts (see billerpe-local-exe/controller/qrOrder.js).
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('hms_qr_order_msts', {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      hotel_id: { type: Sequelize.INTEGER, allowNull: false },
      table_id: { type: Sequelize.INTEGER, allowNull: false },
      // The qr_version the customer's QR actually encoded at scan time -
      // captured here (not just checked-and-discarded at submit) so staff
      // reviewing a pending order, or investigating an abuse report after
      // the fact, can see whether it came from a link that's since been
      // invalidated.
      qr_version: { type: Sequelize.INTEGER, allowNull: false },
      customer_name: { type: Sequelize.STRING, allowNull: true },
      customer_mobile: { type: Sequelize.STRING, allowNull: false },
      // Same shape as kotOrder's cart.items[].menuItems[] (billerpe-pos-pro-v2's
      // KotCartItem) - deliberately, so the exe's accept handler feeds this
      // straight into the existing buildKotRows/createNewKotOrder path with
      // no reshaping.
      items: { type: Sequelize.JSON, allowNull: false },
      status: {
        type: Sequelize.ENUM('pending', 'accepted', 'rejected', 'expired'),
        allowNull: false,
        defaultValue: 'pending',
      },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
    });

    await queryInterface.addIndex('hms_qr_order_msts', ['hotel_id', 'status']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('hms_qr_order_msts');
  },
};
