'use strict';

// BillerPe POS App (Plan 2): the cloud becomes the billing authority for
// outlets on the CLOUD_APP plan (no exe). Adds:
//
//  - hotel_registrations.product_plan  LOCAL_SUITE (Web POS + Captain via exe,
//    the default for every existing outlet) | CLOUD_APP (POS App only). Set
//    by superadmin; decides who may bill (exe vs /app/v1) - see
//    appv1/plan.js.
//  - hotel_registrations.app_device_limit  per outlet, superadmin only.
//  - hotel_registrations.token_reset_at  manual token reset (exe already has it).
//  - hms_order_msts guests / menu_catalog_id / token_ready_at, and
//    roundOff / packaging_override / service_override - the
//    bill engine's persisted inputs/outputs (same columns as the exe).
//  - hms_orderdetails firedBy / kds_hidden / route_kitchen_id /
//    route_printer_ref / kds_state - who sent a line (remove-item rule),
//    bill-with-KOT lines never on a KDS, custom-item routing, KDS progress.
//  - hms_res_settings.supplier_payment_expense / qr_ordering.
//  - new tables: app_devices, app_client_keys, app_queue_entries, app_alerts,
//    hms_stock_movements (+ hms_raw_material_consumptions.semi_finished_item_id).
//
// Every addColumn is guarded so the migration is safe to re-run on a
// database where sync({alter}) already added a column.
// Table names are case sensitive on Linux MySQL (hms_orderDetails) but
// lower-cased on Windows: every existing table is looked up by its real
// spelling in this database.
async function realNames(queryInterface) {
  const tables = (await queryInterface.showAllTables()).map((t) => String(t.tableName ?? t));
  return (name) => tables.find((t) => t.toLowerCase() === name.toLowerCase()) ?? name;
}

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const real = await realNames(queryInterface);
    const add = async (table, column, spec) => {
      const name = real(table);
      const cols = await queryInterface.describeTable(name);
      if (!cols[column]) await queryInterface.addColumn(name, column, spec);
    };

    await add('hotel_registrations', 'product_plan', { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'LOCAL_SUITE' });
    await add('hotel_registrations', 'app_device_limit', { type: Sequelize.INTEGER, allowNull: false, defaultValue: 3 });
    await add('hotel_registrations', 'token_reset_at', { type: Sequelize.DATE, allowNull: true });

    await add('hms_order_msts', 'roundOff', { type: Sequelize.DOUBLE, allowNull: false, defaultValue: 0 });
    await add('hms_order_msts', 'packaging_override', { type: Sequelize.DOUBLE, allowNull: true });
    await add('hms_order_msts', 'service_override', { type: Sequelize.DOUBLE, allowNull: true });
    // Guests, the menu the order uses, and when a pickup was marked ready -
    // the POS App keeps these on the server (the Captain App kept guests on
    // the phone only). token_ready_at is the exe's own column name.
    await add('hms_order_msts', 'guests', { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 });
    await add('hms_order_msts', 'menu_catalog_id', { type: Sequelize.INTEGER, allowNull: true });
    await add('hms_order_msts', 'token_ready_at', { type: Sequelize.DATE, allowNull: true });

    await add('hms_orderDetails', 'firedBy', { type: Sequelize.INTEGER, allowNull: true });
    await add('hms_orderDetails', 'kds_hidden', { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false });
    await add('hms_orderDetails', 'route_kitchen_id', { type: Sequelize.INTEGER, allowNull: true });
    await add('hms_orderDetails', 'route_printer_ref', { type: Sequelize.STRING(64), allowNull: true });
    await add('hms_orderDetails', 'kds_state', { type: Sequelize.STRING(16), allowNull: true });

    // Quick "86" toggle: item is on the menu but cannot be ordered today.
    await add('hms_menu_msts', 'out_of_stock', { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false });

    await add('hms_res_settings', 'supplier_payment_expense', { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true });
    await add('hms_res_settings', 'qr_ordering', { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true });

    // Stock for POS App outlets lives on the cloud: sale consumption can use
    // semi-finished items, and every stock change is journalled (the exe's
    // own stock ledger, ported).
    await add('hms_raw_material_consumptions', 'semi_finished_item_id', { type: Sequelize.INTEGER, allowNull: true });
    // Reservation marked by staff (seated / noshow); empty = decided by the
    // clock and the table's orders, like the exe's reservation timer.
    await add('hms_tableBooking_msts', 'app_status', { type: Sequelize.STRING(16), allowNull: true });
    // Supplier payment <-> its auto expense (exe stock overhaul, 2026-09-25).
    await add('hms_expense_entry_msts', 'purchase_payment_id', { type: Sequelize.INTEGER, allowNull: true });
    await add('hms_purchase_payments', 'expense_entry_id', { type: Sequelize.INTEGER, allowNull: true });
    // Which expense / supplier payment a drawer movement paid (exe columns):
    // editing or deleting it corrects the drawer while its session is open.
    await add('hms_cashMovement_msts', 'expense_entry_id', { type: Sequelize.INTEGER, allowNull: true });
    await add('hms_cashMovement_msts', 'purchase_payment_id', { type: Sequelize.INTEGER, allowNull: true });

    const tables = await queryInterface.showAllTables();
    const has = (t) => tables.map((x) => String(x.tableName ?? x).toLowerCase()).includes(t);

    if (!has('app_devices')) {
      await queryInterface.createTable('app_devices', {
        id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
        hotel_id: { type: Sequelize.INTEGER, allowNull: false },
        device_id: { type: Sequelize.STRING(64), allowNull: false },
        name: { type: Sequelize.STRING(80), allowNull: false, defaultValue: '' },
        make: { type: Sequelize.STRING(60), allowNull: false, defaultValue: '' },
        model: { type: Sequelize.STRING(60), allowNull: false, defaultValue: '' },
        android: { type: Sequelize.STRING(20), allowNull: false, defaultValue: '' },
        app_version: { type: Sequelize.STRING(20), allowNull: false, defaultValue: '' },
        hotel_user_id: { type: Sequelize.INTEGER, allowNull: true },
        last_active: { type: Sequelize.DATE, allowNull: true },
        printers: { type: Sequelize.TEXT('long'), allowNull: true },
        print_kots: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
        status: { type: Sequelize.STRING(16), allowNull: false, defaultValue: 'active' },
        createdAt: { type: Sequelize.DATE, allowNull: false },
        updatedAt: { type: Sequelize.DATE, allowNull: false },
      });
      await queryInterface.addIndex('app_devices', ['hotel_id', 'device_id'], { unique: true, name: 'app_devices_hotel_device' });
    }

    if (!has('app_client_keys')) {
      await queryInterface.createTable('app_client_keys', {
        id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
        hotel_id: { type: Sequelize.INTEGER, allowNull: false },
        client_key: { type: Sequelize.STRING(80), allowNull: false },
        result: { type: Sequelize.TEXT('long'), allowNull: true },
        createdAt: { type: Sequelize.DATE, allowNull: false },
        updatedAt: { type: Sequelize.DATE, allowNull: false },
      });
      await queryInterface.addIndex('app_client_keys', ['hotel_id', 'client_key'], { unique: true, name: 'app_client_keys_hotel_key' });
    }

    if (!has('app_queue_entries')) {
      await queryInterface.createTable('app_queue_entries', {
        id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
        hotel_id: { type: Sequelize.INTEGER, allowNull: false },
        name: { type: Sequelize.STRING(80), allowNull: false },
        mobile: { type: Sequelize.STRING(15), allowNull: false, defaultValue: '' },
        guests: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1 },
        status: { type: Sequelize.STRING(16), allowNull: false, defaultValue: 'waiting' },
        note: { type: Sequelize.STRING(200), allowNull: true },
        joined_at: { type: Sequelize.DATE, allowNull: false },
        called_at: { type: Sequelize.DATE, allowNull: true },
        createdAt: { type: Sequelize.DATE, allowNull: false },
        updatedAt: { type: Sequelize.DATE, allowNull: false },
      });
      await queryInterface.addIndex('app_queue_entries', ['hotel_id', 'status']);
    }

    if (!has('app_alerts')) {
      await queryInterface.createTable('app_alerts', {
        id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
        hotel_id: { type: Sequelize.INTEGER, allowNull: false },
        kind: { type: Sequelize.STRING(30), allowNull: false },
        title: { type: Sequelize.STRING(160), allowNull: false },
        body: { type: Sequelize.STRING(400), allowNull: false, defaultValue: '' },
        link: { type: Sequelize.STRING(160), allowNull: true },
        for_user_id: { type: Sequelize.INTEGER, allowNull: true },
        for_roles: { type: Sequelize.STRING(200), allowNull: true },
        read_by: { type: Sequelize.TEXT, allowNull: true },
        createdAt: { type: Sequelize.DATE, allowNull: false },
        updatedAt: { type: Sequelize.DATE, allowNull: false },
      });
      await queryInterface.addIndex('app_alerts', ['hotel_id', 'createdAt']);
    }

    if (!has('hms_stock_movements')) {
      await queryInterface.createTable('hms_stock_movements', {
        id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
        hotel_id: { type: Sequelize.INTEGER, allowNull: false },
        raw_material_id: { type: Sequelize.INTEGER, allowNull: true },
        semi_finished_item_id: { type: Sequelize.INTEGER, allowNull: true },
        business_date: { type: Sequelize.DATEONLY, allowNull: false },
        type: { type: Sequelize.STRING, allowNull: false },
        qty: { type: Sequelize.DOUBLE, allowNull: false },
        unit_cost: { type: Sequelize.DOUBLE, defaultValue: 0 },
        value: { type: Sequelize.DOUBLE, defaultValue: 0 },
        balance_qty: { type: Sequelize.DOUBLE, defaultValue: 0 },
        ref_type: { type: Sequelize.STRING, allowNull: true },
        ref_id: { type: Sequelize.INTEGER, allowNull: true },
        note: { type: Sequelize.STRING, defaultValue: '' },
        user_id: { type: Sequelize.INTEGER, allowNull: true },
        createdAt: { type: Sequelize.DATE, allowNull: false },
        updatedAt: { type: Sequelize.DATE, allowNull: false },
      });
      await queryInterface.addIndex('hms_stock_movements', ['hotel_id', 'raw_material_id', 'business_date']);
      await queryInterface.addIndex('hms_stock_movements', ['hotel_id', 'business_date']);
      await queryInterface.addIndex('hms_stock_movements', ['ref_type', 'ref_id']);
    }
  },

  async down(queryInterface) {
    const real = await realNames(queryInterface);
    for (const t of ['hms_stock_movements', 'app_alerts', 'app_queue_entries', 'app_client_keys', 'app_devices']) {
      await queryInterface.dropTable(real(t)).catch(() => {});
    }
    const drop = (table, column) => queryInterface.removeColumn(real(table), column).catch(() => {});
    await drop('hms_raw_material_consumptions', 'semi_finished_item_id');
    await drop('hms_expense_entry_msts', 'purchase_payment_id');
    await drop('hms_tableBooking_msts', 'app_status');
    await drop('hms_purchase_payments', 'expense_entry_id');
    await drop('hms_cashMovement_msts', 'expense_entry_id');
    await drop('hms_cashMovement_msts', 'purchase_payment_id');
    await drop('hms_res_settings', 'qr_ordering');
    await drop('hms_menu_msts', 'out_of_stock');
    await drop('hms_res_settings', 'supplier_payment_expense');
    for (const c of ['kds_state', 'route_printer_ref', 'route_kitchen_id', 'kds_hidden', 'firedBy']) await drop('hms_orderDetails', c);
    for (const c of ['token_ready_at', 'menu_catalog_id', 'guests', 'service_override', 'packaging_override', 'roundOff']) await drop('hms_order_msts', c);
    for (const c of ['token_reset_at', 'app_device_limit', 'product_plan']) await drop('hotel_registrations', c);
  },
};
