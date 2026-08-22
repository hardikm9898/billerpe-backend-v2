/**
 * capture_alter_queries.js
 *
 * SUPERSEDED as the way to actually apply schema changes: this project now
 * has real tracked migrations (see migrations/, run via `npm run migrate`).
 * Write a migration (`npm run migrate:generate -- <name>`) instead of
 * pasting output from this script into a MySQL editor by hand.
 *
 * Still useful for what it always did well: previewing what
 * `sequelize.sync({ alter: true })` WOULD do for the tables not in
 * TABLES_TO_SKIP_ALTER, without touching the DB - e.g. to sanity-check a
 * model change before writing the migration for it.
 *
 * Runs sequelize.sync({ alter: true }) on ALL models but intercepts
 * every SQL query BEFORE it hits the DB — logs it to console + file,
 * never executes it, never fails.
 *
 * Usage:
 *   node capture_alter_queries.js
 *
 * Output:
 *   - Console: every query printed live
 *   - File:    alter_queries_<timestamp>.sql  (ready to paste into MySQL editor)
 */

require("dotenv").config();
const { Sequelize } = require("sequelize");
const fs = require("fs");
const path = require("path");

// ─── 1. Create a FAKE Sequelize instance ─────────────────────────────────────
// Same credentials so it can READ the real schema (needed for alter diffing),
// but we override query() so nothing is ever written.

const realSequelize = require("./connection/connect")

// ─── 2. Collect queries ───────────────────────────────────────────────────────
const capturedQueries = [];

// ─── 3. Patch the QueryInterface to intercept writes ─────────────────────────
// Sequelize internally calls this.sequelize.query() for every ALTER/CREATE/DROP.
// We replace it with our logger that:
//   - lets SELECT / SHOW / DESCRIBE pass through (needed to diff schema)
//   - captures and skips every DDL write (ALTER, CREATE INDEX, DROP, etc.)

const originalQuery = realSequelize.query.bind(realSequelize);

realSequelize.query = async function (sql, options) {
    const sqlStr = typeof sql === "string" ? sql : sql?.query ?? String(sql);
    const trimmed = sqlStr.trim();

    // Read-only queries — let these through so Sequelize can inspect real schema
    const isRead = /^(SELECT|SHOW|DESCRIBE|DESC|EXPLAIN|SET\s+NAMES|SET\s+time_zone)/i.test(trimmed);

    if (isRead) {
        return originalQuery(sql, options);
    }

    // DDL / write query — capture it, don't execute
    capturedQueries.push(trimmed);
    console.log("\n── CAPTURED ──────────────────────────────────────────");
    console.log(trimmed + ";");

    // Return a fake result that satisfies Sequelize internals
    return [[], {}];
};


let appModels;
try {
    // Option A: your models/index.js exports the sequelize instance + models
    const modelModule = require("./model/index");          // adjust path if needed

    // Re-associate every model with our patched sequelize instance
    // so sync() uses our intercepted query()
    const originalInstance = modelModule.sequelize;

    // Copy all registered models over to our patched instance
    Object.values(originalInstance.models).forEach((Model) => {
        // Re-init the model on our patched sequelize
        Model.init(Model.getAttributes(), {
            ...Model.options,
            sequelize: realSequelize,
        });
    });

    appModels = Object.values(realSequelize.models);
    console.log(`✔ Loaded ${appModels.length} models from your project\n`);
} catch (err) {
    console.error("✖ Could not load models:", err.message);
    console.error("  → Check the require path for your model index on line ~60");
    process.exit(1);
}

// ─── 5. Tables to skip (same list as your server.js) ─────────────────────────

const TABLES_TO_SKIP_ALTER = [
    "franchise_orders",
    "franchise_order_items",

    'hms_sync_index_msts',
    'hms_order_msts',
    "hms_res_settings",
    "hms_ebillCreditDebit_msts",
    'hms_purchase_orders',
    'hms_purchase_rawMaterials',
    'hms_due_payment_receives',
    'hms_expense_entry_msts',
    'hms_stock_history_msts',
    'hms_raw_material_consumptions',
    'hms_watage_msts',

    'hms_recipes_msts',
    'hms_opening_closing_msts',
    'hms_raise_ticket_msts',
    'hotel_registrations',
    'hms_user_masters',
    'hms_whatsapp_template_msts',
    'hms_website_user_msts',
    'hms_website_products',
    'hms_temp_website_purchase_mst',
    'role_msts',
    'hms_user_accesses',
    'hms_table_categs',
    'hms_table_msts',
    'hms_printer_settings',
    'hms_menu_categs',
    'hms_hotelUser_masters',
    'hms_variant_msts',
    'hms_orderDetails',
    'AdminCarts',
    'hms_tableBooking_msts',
    'hms_invoice_formate_msts',
    'hms_online_orderDetails_msts',
    'hms_online_order_msts',
    'hms_unit_msts',
    'hms_rawMaterial_msts',
    'hms_stock_in_hand_msts',
    'hms_expense_head_msts',
    'hms_menu_variant_msts',
    'hms_testing_msts',
    'hms_addon_msts',
    'hms_addon_department_msts',
    'hms_menu_addon_msts',
    'hms_serviceCharge_msts',
    'hms_promo_codes',
    'hms_suppliers',
    'hms_purchase_payments',

    'hms_kitchen_settings',
    'hms_timeline_msts',
    'hms_ebillCredit_msts',
    'hms_tax_type_msts',
    'hms_order_tax_msts',
    'hms_subscription_payments',
    'hms_subscription_msts',
    'phone_pay_payment_links',
    'hms_plan_msts',
    'hms_admin_save_msts',
    'hms_merchant_msts',
    'hms_carts',
    'hms_purchase_roll_mst',
    'hms_discount_codes',
    'hms_image_msts',
    'AppUpdates',
    'user_sessions',
    'hms_superAdmin_users'
];

// ─── 6. Run sync (intercepted) ────────────────────────────────────────────────
(async () => {
    try {
        await realSequelize.authenticate();
        console.log("✔ Connected to DB (read-only interception active)\n");
    } catch (err) {
        console.error("✖ DB connection failed:", err.message);
        process.exit(1);
    }

    console.log("Running sync({ alter: true }) — DDL queries will be captured, not executed...\n");

    await Promise.all(
        appModels.map(async (model) => {
            const tableName = model.getTableName();
            const shouldAlter = !TABLES_TO_SKIP_ALTER.includes(tableName);

            if (!shouldAlter) {
                console.log(`SKIP  ${tableName}`);
                return;
            }

            try {
                await model.sync({ alter: true });
            } catch (err) {
                // Errors here are from our fake result confusing Sequelize internals — safe to ignore
                // The query was already captured before the fake result was returned
            }
        })
    );

    // ─── 7. Write SQL file ────────────────────────────────────────────────────
    if (capturedQueries.length === 0) {
        console.log("\n✔ No ALTER queries generated — schema is already up to date.");
    } else {
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        const filename = `alter_queries_${timestamp}.sql`;

        const header = [
            "-- ============================================================",
            `-- Captured ALTER queries  |  ${new Date().toISOString()}`,
            `-- Total: ${capturedQueries.length} quer${capturedQueries.length === 1 ? "y" : "ies"}`,
            "-- Run these manually in your MySQL editor.",
            "-- Tip: run one at a time and verify before moving to the next.",
            "-- ============================================================",
            "",
        ].join("\n");

        const body = capturedQueries.map((q) => q + ";").join("\n\n");

        fs.writeFileSync(filename, header + body + "\n");

        console.log("\n══════════════════════════════════════════════════════");
        console.log(`✔ ${capturedQueries.length} quer${capturedQueries.length === 1 ? "y" : "ies"} saved → ${filename}`);
        console.log("══════════════════════════════════════════════════════");
    }

    await realSequelize.close();
})();