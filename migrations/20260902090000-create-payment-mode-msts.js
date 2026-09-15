'use strict';

// Hotel-configurable payment mode labels - see model/paymentMode.js for
// the full design rationale (management list only, doesn't change the
// fixed cash/upi/card/due settlement columns on hms_order_msts).
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('hms_payment_mode_msts', {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      hotel_id: { type: Sequelize.INTEGER, allowNull: false },
      name: { type: Sequelize.STRING, allowNull: false },
      active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      deletable: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      enter_by: { type: Sequelize.STRING, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
    });

    await queryInterface.addIndex('hms_payment_mode_msts', ['hotel_id']);

    // Backfill: every existing hotel gets the same 4 defaults
    // billerpe-pos-pro-v2's own mock/ops-seed.ts already ships as the
    // starting list (Cash/Due protected, UPI/Card removable) - matches
    // what every hotel already implicitly has today via the fixed
    // settlement columns, just not yet as a real per-hotel row set.
    const hotels = await queryInterface.sequelize.query('SELECT id, hotel_name FROM hotel_registrations', {
      type: Sequelize.QueryTypes.SELECT,
    });
    const now = new Date();
    const defaults = [
      { name: 'Cash', deletable: false },
      { name: 'UPI', deletable: true },
      { name: 'Card', deletable: true },
      { name: 'Due', deletable: false },
    ];
    for (const hotel of hotels) {
      for (const mode of defaults) {
        await queryInterface.sequelize.query(
          `INSERT INTO hms_payment_mode_msts (hotel_id, name, active, deletable, enter_by, createdAt, updatedAt)
           VALUES (:hotelId, :name, true, :deletable, :enterBy, :now, :now)`,
          {
            replacements: {
              hotelId: hotel.id,
              name: mode.name,
              deletable: mode.deletable,
              enterBy: hotel.hotel_name ?? null,
              now,
            },
          },
        );
      }
    }
  },

  async down(queryInterface) {
    await queryInterface.dropTable('hms_payment_mode_msts');
  },
};
