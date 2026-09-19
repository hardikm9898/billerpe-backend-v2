'use strict';

// Staff accounts become two-way sync entities (controller/sync/syncRegistry
// .js): an owner can add a kitchen or captain login on the restaurant's exe
// with no internet, and it reaches the cloud in the background. Before this
// they were pull-only, so a staff login created on the exe never existed
// here - and re-registering that PC (which rebuilds its database from the
// cloud) would have deleted it.
//
// Same local_id + unique (hotel_id, local_id) shape as 20260916100000. Push
// matches these three by identity (mobile number, role name) rather than
// by id, so the index is only the idempotency key for repeat pushes.
//
// permission_overrides: per-user exceptions to the role's permissions, set
// from the Web POS Users screen. They previously lived only in one browser
// tab's memory and were lost on refresh.
//
// All three tables are in server.js's TABLES_TO_SKIP_ALTER, so a migration
// is the only way they get these columns.
const TABLES = ['role_msts', 'hms_hotelUser_masters', 'hms_user_accesses'];

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    for (const table of TABLES) {
      const columns = await queryInterface.describeTable(table);
      if (!columns.local_id) {
        await queryInterface.addColumn(table, 'local_id', { type: Sequelize.INTEGER, allowNull: true });
      }
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

    const users = await queryInterface.describeTable('hms_hotelUser_masters');
    if (!users.permission_overrides) {
      await queryInterface.addColumn('hms_hotelUser_masters', 'permission_overrides', {
        type: Sequelize.JSON,
        allowNull: true,
      });
    }
  },

  async down(queryInterface) {
    for (const table of TABLES) {
      await queryInterface.removeIndex(table, `${table}_hotel_local_id_unique`).catch(() => {});
      await queryInterface.removeColumn(table, 'local_id').catch(() => {});
    }
    await queryInterface.removeColumn('hms_hotelUser_masters', 'permission_overrides').catch(() => {});
  },
};
