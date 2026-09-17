'use strict';

// Sync engine v2 (controller/sync/*). Same mechanism and reasoning as
// 20260901074800 (operations entities) and 20260911140000 (menu entities):
// a row created on a restaurant's local exe owns an id in that exe's own
// autoincrement space, which has no relationship to an id here. `local_id`
// (paired with hotel_id in a unique index) is the idempotency key that lets
// a repeat push - or a later edit of the same local row - land on the same
// cloud row instead of inserting a duplicate every time.
//
// These seven tables could all be created on the exe already (its
// routes/index.js exposes real create endpoints for tables, table
// categories, tax types, kitchens, units and raw materials, and every order
// creates a customer row) but had NO push path at all, so the cloud simply
// never learned about them. That is also what made an exe-created table or
// tax type unusable in a pushed order: the order carried a TableId /
// hmsTaxTypeMstId that does not exist here, which is the
// ER_NO_REFERENCED_ROW_2 class of failure this whole pass exists to end.
//
// Every one of these tables is in server.js's TABLES_TO_SKIP_ALTER, so a
// migration is the only way they get the column.
const TABLES = [
  'hms_table_categs',
  'hms_table_msts',
  'hms_tax_type_msts',
  'hms_kitchen_settings',
  'hms_unit_msts',
  'hms_rawMaterial_msts',
  'hms_user_masters',
  // Outlet config a future admin panel will edit centrally, but which the
  // Web POS also writes straight to the exe today. Without local_id these
  // could only ever flow one way, so every periodic pull had to be told to
  // SKIP them (the exe's own PERIODIC_SKIP_STEPS) or it would overwrite a
  // same-minute local edit with the cloud's stale copy. With a push path
  // they become ordinary two-way entities: last write wins by updatedAt.
  'hms_payment_mode_msts',
  'hms_bill_charge_msts',
  'hms_notification_setting_msts',
  'hms_role_permission_default_msts',
];

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    for (const table of TABLES) {
      const columns = await queryInterface.describeTable(table);
      if (!columns.local_id) {
        await queryInterface.addColumn(table, 'local_id', { type: Sequelize.INTEGER, allowNull: true });
      }
      // Partial-unique on (hotel_id, local_id): MySQL treats NULLs as
      // distinct, so rows that predate this column (local_id NULL) never
      // collide with each other, exactly as in the earlier migrations.
      const indexes = await queryInterface.showIndex(table);
      const name = `${table}_hotel_local_id_unique`;
      if (!indexes.some((i) => i.name === name)) {
        await queryInterface.addIndex(table, {
          fields: ['hotel_id', 'local_id'],
          unique: true,
          name,
          where: { local_id: { [Sequelize.Op.ne]: null } },
        });
      }
    }

    // Long-lived per-device credential for the exe's background sync. The
    // exe used to authenticate every sync call as the OWNER (the cookie pair
    // from restaurantLogin), which restaurantLogin itself invalidates the
    // moment that owner logs in anywhere else - it overwrites
    // HotelUser.refresh_token and caps sessions per user. That is the real,
    // confirmed cause of an outlet's sync dying mid-shift with "device may
    // need re-registration". A token bound to this registration row instead
    // only ever stops working when a SuperAdmin releases the registration or
    // another PC takes it over (both mint a new installation_id, and the
    // token carries the one it was issued for).
    const reg = await queryInterface.describeTable('local_server_registrations');
    if (!reg.token_issued_at) {
      await queryInterface.addColumn('local_server_registrations', 'token_issued_at', {
        type: Sequelize.DATE, allowNull: true,
      });
    }
  },

  async down(queryInterface) {
    for (const table of TABLES) {
      await queryInterface.removeIndex(table, `${table}_hotel_local_id_unique`).catch(() => {});
      await queryInterface.removeColumn(table, 'local_id').catch(() => {});
    }
    await queryInterface.removeColumn('local_server_registrations', 'token_issued_at').catch(() => {});
  },
};
