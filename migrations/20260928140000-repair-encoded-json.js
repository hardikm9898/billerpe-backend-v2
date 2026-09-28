'use strict';

// JSON values that sync stored as encoded text, layer on layer
// (controller/sync/jsonColumns.js): '"[]"', '"\"[]\""' ... instead of [].
// Decodes them back to the real value. Only rows still holding a JSON
// *string* that decodes to an array/object are touched; updatedAt is left
// alone so this doesn't set off a re-sync of every row (each exe repairs its
// own copy at startup). Safe to re-run.
const TARGETS = [
  ['hms_menu_catalog_msts', 'id', ['table_category_ids', 'order_types']],
  ['hms_tax_type_msts', 'id', ['order_type', 'table_categ_ids', 'menu_ids']],
  ['hms_serviceCharge_msts', 'id', ['service_charge_automatic']],
  ['hms_bill_charge_msts', 'id', ['charge_automatic']],
  ['hms_role_permission_default_msts', 'id', ['permissions', 'special_permissions']],
  ['hms_printer_settings', 'id', ['table_ids', 'menu_categ_ids', 'item_ids', 'order_type']],
  ['hms_kitchen_settings', 'id', ['table_ids', 'menu_categ_ids', 'order_type']],
  ['hms_hotelUser_masters', 'id', ['permission_overrides']],
];

function decode(value) {
  let v = value;
  for (let i = 0; i < 8 && typeof v === 'string'; i++) {
    try {
      v = JSON.parse(v);
    } catch {
      break;
    }
  }
  return v;
}

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const db = queryInterface.sequelize;
    // Case-insensitive: MySQL/MariaDB on Windows lists every table in lower
    // case (lower_case_table_names=1), Linux keeps the real case.
    const existing = new Set(
      (await queryInterface.showAllTables()).map((t) => String(typeof t === 'string' ? t : t.tableName).toLowerCase()),
    );
    let fixed = 0;
    for (const [table, pk, cols] of TARGETS) {
      if (!existing.has(table.toLowerCase())) continue;
      const described = await queryInterface.describeTable(table);
      for (const col of cols) {
        if (!described[col]) continue;
        const rows = await db.query(
          `SELECT \`${pk}\` AS id, \`${col}\` AS v FROM \`${table}\` WHERE \`${col}\` IS NOT NULL AND TRIM(\`${col}\`) LIKE '"%'`,
          { type: Sequelize.QueryTypes.SELECT },
        );
        for (const r of rows) {
          const decoded = decode(r.v);
          if (decoded === null || typeof decoded !== 'object') continue; // a genuine text value
          await db.query(`UPDATE \`${table}\` SET \`${col}\` = ? WHERE \`${pk}\` = ?`, {
            replacements: [JSON.stringify(decoded), r.id],
          });
          fixed++;
        }
      }
    }
    console.log(`[migration] repaired ${fixed} double-encoded JSON value(s)`);
  },

  async down() {
    // Nothing to undo: the repaired values are the correct ones.
  },
};
