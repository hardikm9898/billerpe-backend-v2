'use strict';

// BillerPe's menu photo library and outlets' photo requests (model/menuPhotos.js, owner 2026-10-09).
module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = (await queryInterface.showAllTables()).map((t) => (typeof t === 'string' ? t : t.tableName));
    const id = { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false };
    const Sd = (n, d = '') => ({ type: Sequelize.STRING(n), allowNull: false, defaultValue: d });
    const I = { type: Sequelize.INTEGER, allowNull: true };
    const stamps = { createdAt: { type: Sequelize.DATE, allowNull: false }, updatedAt: { type: Sequelize.DATE, allowNull: false } };
    const make = async (name, cols, indexes = []) => {
      if (tables.includes(name)) return;
      await queryInterface.createTable(name, cols);
      for (const [fields, opts] of indexes) await queryInterface.addIndex(name, fields, opts);
    };

    await make('menu_photos', {
      id,
      name: { type: Sequelize.STRING(120), allowNull: false },
      search_key: { type: Sequelize.STRING(140), allowNull: false },
      aliases: Sd(500),
      veg: Sd(8),
      cuisine: Sd(40),
      url: { type: Sequelize.STRING(255), allowNull: false },
      thumb: { type: Sequelize.STRING(255), allowNull: false },
      bytes: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      legacy_id: I,
      uses: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      created_by: I,
      ...stamps,
    }, [
      [['search_key'], { name: 'menu_photos_key', unique: true }],
      [['active'], { name: 'menu_photos_active' }],
      [['url'], { name: 'menu_photos_url' }],
    ]);

    await make('menu_photo_requests', {
      id,
      hotel_id: { type: Sequelize.INTEGER, allowNull: false },
      menu_id: I,
      item_name: { type: Sequelize.STRING(120), allowNull: false },
      search_key: { type: Sequelize.STRING(140), allowNull: false },
      status: Sd(8, 'open'),
      asked_by: Sd(80),
      photo_id: I,
      note: Sd(200),
      done_by: I,
      done_at: { type: Sequelize.DATE, allowNull: true },
      ...stamps,
    }, [
      [['status', 'search_key'], { name: 'menu_photo_requests_status' }],
      [['hotel_id'], { name: 'menu_photo_requests_hotel' }],
    ]);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('menu_photo_requests');
    await queryInterface.dropTable('menu_photos');
  },
};
