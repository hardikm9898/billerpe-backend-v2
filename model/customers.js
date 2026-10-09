const { DataTypes } = require("sequelize");
const sequelize = require("../connection/connect");

// BillerPe SuperAdmin phase 5: customers after the sale. Schema owned by
// migration 20261011100000-create-customers; listed in server.js
// TABLES_TO_SKIP_ALTER. The outlet tables (hotel_registrations, orders, PC
// registrations) get no new columns: everything here points at them by
// hotel_id, so the panel can never break outlet billing or sync.

const T = DataTypes;

// One customer = one owner (mobile) with all their outlets.
// health: green | amber | red | grey (no live outlet to judge).
const CsAccount = sequelize.define("cs_account", {
    id: { type: T.INTEGER, primaryKey: true, autoIncrement: true },
    name: { type: T.STRING(120), allowNull: false, defaultValue: "" },
    // Last 10 digits; one account per owner mobile.
    owner_mobile: { type: T.STRING(15), allowNull: false, unique: "cs_accounts_mobile" },
    owner_name: { type: T.STRING(120), allowNull: false, defaultValue: "" },
    email: { type: T.STRING(120), allowNull: false, defaultValue: "" },
    city: { type: T.STRING(60), allowNull: false, defaultValue: "" },
    success_owner_id: { type: T.INTEGER, allowNull: true },
    won_by_id: { type: T.INTEGER, allowNull: true },
    lead_id: { type: T.INTEGER, allowNull: true },
    // won (Mark won) | existing (an outlet that was live before the CRM) | outlet (an outlet made elsewhere later)
    origin: { type: T.STRING(10), allowNull: false, defaultValue: "existing" },
    health: { type: T.STRING(6), allowNull: false, defaultValue: "grey" },
    // JSON [{ hotelId, outlet, level, text }]
    health_reasons: { type: T.TEXT, allowNull: true },
    health_at: { type: T.DATE, allowNull: true },
    customer_since: { type: T.DATE, allowNull: true },
    note: { type: T.STRING(500), allowNull: false, defaultValue: "" },
}, { tableName: "cs_accounts", indexes: [{ fields: ["success_owner_id"], name: "cs_accounts_owner" }, { fields: ["health"], name: "cs_accounts_health" }] });

// An outlet (hotel_registrations row) in an account. One account per outlet.
// signals = the last health check's numbers (JSON), so lists need no recount.
const CsAccountOutlet = sequelize.define("cs_account_outlet", {
    id: { type: T.INTEGER, primaryKey: true, autoIncrement: true },
    account_id: { type: T.INTEGER, allowNull: false },
    hotel_id: { type: T.INTEGER, allowNull: false, unique: "cs_account_outlets_hotel" },
    // Plan bought, as sold (Suite Pro, App Standard...). Billing (phase 6) makes it a catalog row.
    plan_name: { type: T.STRING(40), allowNull: false, defaultValue: "" },
    // none | active | done
    onboarding: { type: T.STRING(8), allowNull: false, defaultValue: "none" },
    onboarding_started_at: { type: T.DATE, allowNull: true },
    onboarding_done_at: { type: T.DATE, allowNull: true },
    health: { type: T.STRING(6), allowNull: false, defaultValue: "grey" },
    health_reasons: { type: T.TEXT, allowNull: true },
    health_at: { type: T.DATE, allowNull: true },
    // When the outlet turned its current colour.
    health_since: { type: T.DATE, allowNull: true },
    signals: { type: T.TEXT, allowNull: true },
    linked_by: { type: T.INTEGER, allowNull: true },
}, { tableName: "cs_account_outlets", indexes: [{ fields: ["account_id"], name: "cs_account_outlets_account" }, { fields: ["health"], name: "cs_account_outlets_health" }] });

// One line of an outlet's onboarding checklist. auto = ticked by the outlet's
// own data (outlet | menu | pc | app_devices | first_bill); done_by null = by itself.
const CsOnboardingItem = sequelize.define("cs_onboarding_item", {
    id: { type: T.INTEGER, primaryKey: true, autoIncrement: true },
    hotel_id: { type: T.INTEGER, allowNull: false },
    account_id: { type: T.INTEGER, allowNull: false },
    item_key: { type: T.STRING(30), allowNull: false },
    title: { type: T.STRING(120), allowNull: false },
    sort: { type: T.INTEGER, allowNull: false, defaultValue: 0 },
    auto: { type: T.STRING(16), allowNull: true },
    owner_id: { type: T.INTEGER, allowNull: true },
    due_at: { type: T.DATE, allowNull: true },
    done_at: { type: T.DATE, allowNull: true },
    done_by: { type: T.INTEGER, allowNull: true },
    note: { type: T.STRING(300), allowNull: false, defaultValue: "" },
    // Proof (owner 2026-10-09, migration 20261017100000): photo | call | note for steps
    // ticked by hand; the stored photo; the paid invoice behind "Payment received".
    proof_kind: { type: T.STRING(8), allowNull: true },
    proof: { type: T.STRING(500), allowNull: true },
    invoice_id: { type: T.INTEGER, allowNull: true },
}, {
    tableName: "cs_onboarding_items",
    indexes: [{ unique: true, fields: ["hotel_id", "item_key"], name: "cs_onboarding_items_hotel_key" }, { fields: ["owner_id", "done_at", "due_at"], name: "cs_onboarding_items_owner" }],
});

// One row per outlet per day (India time): bills and the health it ended with.
// The 4-week "normal" for each outlet is read from here.
const CsOutletDay = sequelize.define("cs_outlet_day", {
    id: { type: T.INTEGER, primaryKey: true, autoIncrement: true },
    hotel_id: { type: T.INTEGER, allowNull: false },
    day: { type: T.DATEONLY, allowNull: false },
    bills: { type: T.INTEGER, allowNull: false, defaultValue: 0 },
    sales: { type: T.DOUBLE, allowNull: false, defaultValue: 0 },
    health: { type: T.STRING(6), allowNull: true },
    reasons: { type: T.TEXT, allowNull: true },
}, { tableName: "cs_outlet_days", indexes: [{ unique: true, fields: ["hotel_id", "day"], name: "cs_outlet_days_hotel_day" }, { fields: ["day"], name: "cs_outlet_days_day" }] });

// Next actions for customers (health follow-ups, calls, visits). Lead tasks stay in crm_tasks.
// origin: manual | health | rule. ref unique = a rule never makes the same task twice.
const CsTask = sequelize.define("cs_task", {
    id: { type: T.INTEGER, primaryKey: true, autoIncrement: true },
    account_id: { type: T.INTEGER, allowNull: false },
    hotel_id: { type: T.INTEGER, allowNull: true },
    owner_id: { type: T.INTEGER, allowNull: true },
    type: { type: T.STRING(16), allowNull: false, defaultValue: "call" },
    note: { type: T.STRING(300), allowNull: false, defaultValue: "" },
    due_at: { type: T.DATE, allowNull: false },
    status: { type: T.STRING(10), allowNull: false, defaultValue: "open" },
    done_at: { type: T.DATE, allowNull: true },
    done_by: { type: T.INTEGER, allowNull: true },
    result: { type: T.STRING(300), allowNull: false, defaultValue: "" },
    origin: { type: T.STRING(12), allowNull: false, defaultValue: "manual" },
    ref: { type: T.STRING(80), allowNull: true, unique: "cs_tasks_ref" },
    created_by: { type: T.INTEGER, allowNull: true },
}, { tableName: "cs_tasks", indexes: [{ fields: ["owner_id", "status", "due_at"], name: "cs_tasks_owner_due" }, { fields: ["account_id", "status"], name: "cs_tasks_account" }] });

// The account's timeline (append-only). type: created | won | note | health |
// onboarding | owner | plan | pc | devices | open_as | task | link | call.
const CsActivity = sequelize.define("cs_activity", {
    id: { type: T.BIGINT, primaryKey: true, autoIncrement: true },
    account_id: { type: T.INTEGER, allowNull: false },
    hotel_id: { type: T.INTEGER, allowNull: true },
    type: { type: T.STRING(16), allowNull: false },
    actor_id: { type: T.INTEGER, allowNull: true },
    body: { type: T.STRING(1000), allowNull: false, defaultValue: "" },
    data: { type: T.TEXT, allowNull: true },
    at: { type: T.DATE, allowNull: false },
}, { tableName: "cs_activities", updatedAt: false, indexes: [{ fields: ["account_id", "at"], name: "cs_activities_account_at" }] });

// "Open as outlet": a 30-minute Owner Dashboard session for BillerPe support,
// with the reason. The token carries only this row's id.
const AdmSupportSession = sequelize.define("adm_support_session", {
    id: { type: T.INTEGER, primaryKey: true, autoIncrement: true },
    user_id: { type: T.INTEGER, allowNull: false },
    hotel_id: { type: T.INTEGER, allowNull: false },
    reason: { type: T.STRING(300), allowNull: false },
    expires_at: { type: T.DATE, allowNull: false },
    ended_at: { type: T.DATE, allowNull: true },
    last_used_at: { type: T.DATE, allowNull: true },
    writes: { type: T.INTEGER, allowNull: false, defaultValue: 0 },
    ip: { type: T.STRING(64), allowNull: false, defaultValue: "" },
}, { tableName: "adm_support_sessions", indexes: [{ fields: ["hotel_id", "createdAt"], name: "adm_support_sessions_hotel" }, { fields: ["user_id", "createdAt"], name: "adm_support_sessions_user" }] });

module.exports = { CsAccount, CsAccountOutlet, CsOnboardingItem, CsOutletDay, CsTask, CsActivity, AdmSupportSession };
