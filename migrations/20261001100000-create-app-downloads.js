'use strict';

// Files outlets download from the Web POS - the local server installer and
// the Captain App APK (model/appDownload.js, owner decision 2026-10-01).
module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = (await queryInterface.showAllTables()).map((t) => (typeof t === 'string' ? t : t.tableName));
    if (tables.includes('app_downloads')) return;
    await queryInterface.createTable('app_downloads', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      app: { type: Sequelize.STRING(32), allowNull: false },
      version: { type: Sequelize.STRING(64), allowNull: false },
      file_name: { type: Sequelize.STRING(128), allowNull: false },
      local_path: { type: Sequelize.STRING(255), allowNull: false },
      sha256: { type: Sequelize.STRING(64), allowNull: false },
      size_bytes: { type: Sequelize.BIGINT, allowNull: false },
      active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      notes: { type: Sequelize.STRING(255), allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('app_downloads', ['app', 'version'], { name: 'app_downloads_app_version_unique', unique: true });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('app_downloads');
  },
};
