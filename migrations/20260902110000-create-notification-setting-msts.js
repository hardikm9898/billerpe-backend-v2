'use strict';

// Per-hotel, per-trigger, per-channel notification toggles - see
// model/notificationSetting.js for the full design rationale (a
// management-list-only build; doesn't itself wire up real WhatsApp/SMS
// sending logic).
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('hms_notification_setting_msts', {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      hotel_id: { type: Sequelize.INTEGER, allowNull: false },
      trigger: { type: Sequelize.STRING, allowNull: false },
      whatsapp: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      sms: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      in_app: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
    });

    await queryInterface.addIndex('hms_notification_setting_msts', ['hotel_id', 'trigger'], {
      unique: true,
      name: 'hms_notification_setting_msts_hotel_trigger_unique',
    });

    // Backfill: every existing hotel gets the same 6 triggers with the
    // same defaults as billerpe-pos-pro-v2's own mock/data.ts.
    const hotels = await queryInterface.sequelize.query('SELECT id FROM hotel_registrations', {
      type: Sequelize.QueryTypes.SELECT,
    });
    const now = new Date();
    const defaults = [
      { trigger: 'Order settled', whatsapp: true, sms: false, in_app: true },
      { trigger: 'KOT ready', whatsapp: false, sms: false, in_app: true },
      { trigger: 'Low stock', whatsapp: true, sms: true, in_app: true },
      { trigger: 'Sync failure', whatsapp: false, sms: false, in_app: true },
      { trigger: 'Cash variance', whatsapp: true, sms: false, in_app: true },
      { trigger: 'Reservation reminder', whatsapp: true, sms: true, in_app: true },
    ];
    for (const hotel of hotels) {
      for (const row of defaults) {
        // `trigger` is a MySQL/MariaDB reserved word - backtick-quoted here
        // (createTable/addIndex above already quote it correctly on their
        // own; only this raw INSERT needed the same treatment).
        await queryInterface.sequelize.query(
          'INSERT INTO hms_notification_setting_msts (hotel_id, `trigger`, whatsapp, sms, in_app, createdAt, updatedAt) ' +
          'VALUES (:hotelId, :trigger, :whatsapp, :sms, :inApp, :now, :now)',
          {
            replacements: {
              hotelId: hotel.id,
              trigger: row.trigger,
              whatsapp: row.whatsapp,
              sms: row.sms,
              inApp: row.in_app,
              now,
            },
          },
        );
      }
    }
  },

  async down(queryInterface) {
    await queryInterface.dropTable('hms_notification_setting_msts');
  },
};
