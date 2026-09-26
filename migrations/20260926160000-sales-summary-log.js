'use strict';

// The owner's daily WhatsApp sales summary: one row per outlet per business
// day, claimed before sending, so it goes out once when the day closes - never
// again after a restart, from a second server process, or for an outlet with
// no hms_res_settings row (that one used to get it every minute).
// Safe to re-run; the unique index is added even when boot sync already
// created the table (sync skips indexes on this table).
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = (await queryInterface.showAllTables()).map((t) => String(t.tableName ?? t).toLowerCase());
    if (!tables.includes('hms_sales_summary_logs')) {
      await queryInterface.createTable('hms_sales_summary_logs', {
        id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
        hotel_id: { type: Sequelize.INTEGER, allowNull: false },
        business_date: { type: Sequelize.DATEONLY, allowNull: false },
        status: { type: Sequelize.STRING(10), allowNull: false, defaultValue: 'sending' },
        attempts: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
        next_try_at: { type: Sequelize.DATE, allowNull: true },
        message_id: { type: Sequelize.STRING(120), allowNull: true },
        error: { type: Sequelize.STRING(255), allowNull: true },
        createdAt: { type: Sequelize.DATE, allowNull: false },
        updatedAt: { type: Sequelize.DATE, allowNull: false },
      });
    }
    const indexes = await queryInterface.showIndex('hms_sales_summary_logs');
    if (!indexes.some((i) => i.name === 'hms_sales_summary_logs_hotel_day')) {
      // A table made by boot sync has no unique index yet: keep the first row per outlet/day.
      await queryInterface.sequelize.query(
        'DELETE a FROM hms_sales_summary_logs a JOIN hms_sales_summary_logs b ON a.hotel_id = b.hotel_id AND a.business_date = b.business_date AND a.id > b.id',
      );
      await queryInterface.addIndex('hms_sales_summary_logs', ['hotel_id', 'business_date'], { unique: true, name: 'hms_sales_summary_logs_hotel_day' });
    }
  },

  async down(queryInterface) {
    await queryInterface.dropTable('hms_sales_summary_logs');
  },
};
