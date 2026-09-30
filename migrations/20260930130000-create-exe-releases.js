'use strict';

// Automatic exe updates (owner decision 2026-09-30): published builds of the
// outlet local server (model/exeRelease.js), and what each outlet reports
// about its own update on the heartbeat (local_server_registrations
// .update_status - app_version already existed and is now kept current).
module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = (await queryInterface.showAllTables()).map((t) => (typeof t === 'string' ? t : t.tableName));
    if (!tables.includes('exe_releases')) {
      await queryInterface.createTable('exe_releases', {
        id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
        version: { type: Sequelize.STRING(64), allowNull: false },
        s3_bucket: { type: Sequelize.STRING(128), allowNull: true },
        s3_key: { type: Sequelize.STRING(255), allowNull: true },
        local_path: { type: Sequelize.STRING(255), allowNull: true },
        sha256: { type: Sequelize.STRING(64), allowNull: false },
        size_bytes: { type: Sequelize.BIGINT, allowNull: false },
        active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
        notes: { type: Sequelize.STRING(255), allowNull: true },
        createdAt: { type: Sequelize.DATE, allowNull: false },
        updatedAt: { type: Sequelize.DATE, allowNull: false },
      });
      await queryInterface.addIndex('exe_releases', ['version'], { name: 'exe_releases_version_unique', unique: true });
    }

    const regTable = tables.find((t) => t.toLowerCase() === 'local_server_registrations') || 'local_server_registrations';
    const columns = await queryInterface.describeTable(regTable);
    if (!columns.update_status) {
      // "downloading 1.2.0", "ready 1.2.0", "failed 1.2.0: <why>" - empty
      // when there is nothing to report.
      await queryInterface.addColumn(regTable, 'update_status', { type: Sequelize.STRING(255), allowNull: true });
    }
  },

  async down(queryInterface) {
    await queryInterface.dropTable('exe_releases');
    await queryInterface.removeColumn('local_server_registrations', 'update_status');
  },
};
