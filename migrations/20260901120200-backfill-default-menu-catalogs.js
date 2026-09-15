'use strict';

// Every hotel needs exactly one default MenuCatalog before menu_catalog_id
// means anything to the app - this is a one-time, small-data backfill (one
// row per existing hotel, at most a few hundred rows for this codebase),
// not an ongoing operational query, so doing it inline in a migration
// (rather than a separate one-off script) is acceptable here.
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const hotels = await queryInterface.sequelize.query(
      'SELECT id, hotel_name FROM hotel_registrations',
      { type: Sequelize.QueryTypes.SELECT },
    );

    for (const hotel of hotels) {
      const now = new Date();
      const [catalogId] = await queryInterface.sequelize.query(
        `INSERT INTO hms_menu_catalog_msts
           (hotel_id, name, is_default, active, table_category_ids, order_types, enter_by, createdAt, updatedAt)
         VALUES (:hotelId, :name, true, true, :emptyArr, :emptyArr, :enterBy, :now, :now)`,
        {
          replacements: {
            hotelId: hotel.id,
            name: 'Main Menu',
            emptyArr: JSON.stringify([]),
            enterBy: hotel.hotel_name ?? null,
            now,
          },
          type: Sequelize.QueryTypes.INSERT,
        },
      );

      // Real (pluralized) table names - see 20260901120100's own fix note.
      for (const table of ['hms_menu_categs', 'hms_variant_msts', 'hms_addon_department_msts']) {
        await queryInterface.sequelize.query(
          `UPDATE ${table} SET menu_catalog_id = :catalogId
             WHERE hotel_id = :hotelId AND menu_catalog_id IS NULL`,
          { replacements: { catalogId, hotelId: hotel.id } },
        );
      }
    }
  },

  async down(queryInterface) {
    for (const table of ['hms_menu_categs', 'hms_variant_msts', 'hms_addon_department_msts']) {
      await queryInterface.sequelize.query(`UPDATE ${table} SET menu_catalog_id = NULL`);
    }
    await queryInterface.sequelize.query('DELETE FROM hms_menu_catalog_msts');
  },
};
