const { DataTypes } = require("sequelize");
const sequelize = require("../connection/connect");

// BillerPe SuperAdmin (admin.billerpe.in, /admin/v1). Schema owned by
// migration 20261008100000-create-admin-foundation; listed in server.js
// TABLES_TO_SKIP_ALTER so boot sync only creates them on a fresh database.
// These are BillerPe's own staff (sales, customer success, support), never a
// restaurant's staff - those stay in hms_hotelUser_masters.

// A named set of permissions (adminv1/permissions.js). "*" = everything.
const AdmRole = sequelize.define("adm_role", {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    name: { type: DataTypes.STRING(60), allowNull: false, unique: "adm_roles_name" },
    description: { type: DataTypes.STRING(200), allowNull: false, defaultValue: "" },
    // JSON array of permission keys.
    permissions: { type: DataTypes.TEXT, allowNull: true },
    // Built-in roles can be edited but not deleted or renamed.
    is_system: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
}, { tableName: "adm_roles" });

const AdmTeam = sequelize.define("adm_team", {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    name: { type: DataTypes.STRING(60), allowNull: false, unique: "adm_teams_name" },
    manager_id: { type: DataTypes.INTEGER, allowNull: true },
    active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
}, { tableName: "adm_teams" });

// One login per person. mobile = 10 digits, the login name.
const AdmUser = sequelize.define("adm_user", {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    name: { type: DataTypes.STRING(80), allowNull: false },
    mobile: { type: DataTypes.STRING(10), allowNull: false, unique: "adm_users_mobile" },
    email: { type: DataTypes.STRING(120), allowNull: false, defaultValue: "" },
    password_hash: { type: DataTypes.STRING(100), allowNull: false },
    // Set for a new login and after a reset: the panel asks for a new password first.
    must_change_password: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    role_id: { type: DataTypes.INTEGER, allowNull: false },
    team_id: { type: DataTypes.INTEGER, allowNull: true },
    // Who gets this person's escalations (adm_users.id).
    manager_id: { type: DataTypes.INTEGER, allowNull: true },
    // "HH:MM"; null = the company working hours (adm_settings working_hours).
    shift_start: { type: DataTypes.STRING(5), allowNull: true },
    shift_end: { type: DataTypes.STRING(5), allowNull: true },
    // New leads per day for round-robin; null = no cap / not in the rotation.
    daily_lead_cap: { type: DataTypes.INTEGER, allowNull: true },
    languages: { type: DataTypes.STRING(60), allowNull: false, defaultValue: "" },
    // active | disabled
    status: { type: DataTypes.STRING(12), allowNull: false, defaultValue: "active" },
    last_login_at: { type: DataTypes.DATE, allowNull: true },
}, {
    tableName: "adm_users",
    indexes: [{ fields: ["role_id"], name: "adm_users_role" }, { fields: ["team_id"], name: "adm_users_team" }],
});

const AdmLeave = sequelize.define("adm_leave", {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    user_id: { type: DataTypes.INTEGER, allowNull: false },
    from_date: { type: DataTypes.DATEONLY, allowNull: false },
    to_date: { type: DataTypes.DATEONLY, allowNull: false },
    note: { type: DataTypes.STRING(160), allowNull: false, defaultValue: "" },
    created_by: { type: DataTypes.INTEGER, allowNull: true },
}, { tableName: "adm_leaves", indexes: [{ fields: ["user_id", "from_date"], name: "adm_leaves_user_from" }] });

// One row per browser or phone a person is logged in on. The token carries
// the row id; logging out (or out elsewhere), a password change (password_fp)
// or 30 idle days end it.
const AdmSession = sequelize.define("adm_session", {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    user_id: { type: DataTypes.INTEGER, allowNull: false },
    // web | app (the sales app on a company phone)
    kind: { type: DataTypes.STRING(8), allowNull: false, defaultValue: "web" },
    device_id: { type: DataTypes.STRING(64), allowNull: false, defaultValue: "" },
    device_name: { type: DataTypes.STRING(80), allowNull: false, defaultValue: "" },
    app_version: { type: DataTypes.STRING(20), allowNull: false, defaultValue: "" },
    ip: { type: DataTypes.STRING(64), allowNull: false, defaultValue: "" },
    password_fp: { type: DataTypes.STRING(16), allowNull: false },
    push_token: { type: DataTypes.STRING(255), allowNull: true },
    last_active: { type: DataTypes.DATE, allowNull: true },
    revoked_at: { type: DataTypes.DATE, allowNull: true },
}, { tableName: "adm_sessions", indexes: [{ fields: ["user_id", "revoked_at"], name: "adm_sessions_user_open" }] });

// Who changed what. Written by adminv1/audit.js in the same transaction as
// the change; never updated or deleted.
const AdmAuditLog = sequelize.define("adm_audit_log", {
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    actor_id: { type: DataTypes.INTEGER, allowNull: true },
    action: { type: DataTypes.STRING(60), allowNull: false },
    entity: { type: DataTypes.STRING(40), allowNull: false, defaultValue: "" },
    entity_id: { type: DataTypes.STRING(40), allowNull: false, defaultValue: "" },
    summary: { type: DataTypes.STRING(300), allowNull: false, defaultValue: "" },
    before_json: { type: DataTypes.TEXT, allowNull: true },
    after_json: { type: DataTypes.TEXT, allowNull: true },
    reason: { type: DataTypes.STRING(300), allowNull: false, defaultValue: "" },
    ip: { type: DataTypes.STRING(64), allowNull: false, defaultValue: "" },
}, {
    tableName: "adm_audit_log",
    updatedAt: false,
    indexes: [
        { fields: ["createdAt"], name: "adm_audit_time" },
        { fields: ["entity", "entity_id"], name: "adm_audit_entity" },
        { fields: ["actor_id", "createdAt"], name: "adm_audit_actor" },
    ],
});

// Panel settings, one JSON value per key (defaults in adminv1/settings.js).
const AdmSetting = sequelize.define("adm_setting", {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    setting_key: { type: DataTypes.STRING(60), allowNull: false, unique: "adm_settings_key" },
    value: { type: DataTypes.TEXT, allowNull: true },
    updated_by: { type: DataTypes.INTEGER, allowNull: true },
}, { tableName: "adm_settings" });

// Event log: every change the automation may react to is written here in
// the same transaction as the change (services/admin/events.js). The admin
// worker hands each event to its subscribers once.
const CrmEvent = sequelize.define("crm_event", {
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    type: { type: DataTypes.STRING(60), allowNull: false },
    entity: { type: DataTypes.STRING(40), allowNull: false, defaultValue: "" },
    entity_id: { type: DataTypes.STRING(40), allowNull: false, defaultValue: "" },
    data: { type: DataTypes.TEXT, allowNull: true },
    actor_id: { type: DataTypes.INTEGER, allowNull: true },
    claimed_by: { type: DataTypes.STRING(40), allowNull: true },
    claimed_until: { type: DataTypes.DATE, allowNull: true },
    handled_at: { type: DataTypes.DATE, allowNull: true },
    attempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    last_error: { type: DataTypes.STRING(500), allowNull: true },
}, {
    tableName: "crm_events",
    updatedAt: false,
    indexes: [{ fields: ["handled_at", "id"], name: "crm_events_pending" }, { fields: ["entity", "entity_id"], name: "crm_events_entity" }],
});

// Durable job queue (services/admin/jobs.js): run_at in UTC; a job is
// claimed by one worker at a time and retried with back-off.
const CrmJob = sequelize.define("crm_job", {
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    kind: { type: DataTypes.STRING(60), allowNull: false },
    payload: { type: DataTypes.TEXT, allowNull: true },
    run_at: { type: DataTypes.DATE, allowNull: false },
    // queued | done | failed | cancelled
    status: { type: DataTypes.STRING(12), allowNull: false, defaultValue: "queued" },
    attempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    max_attempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 3 },
    // Same key = same job: a second enqueue is skipped.
    dedupe_key: { type: DataTypes.STRING(160), allowNull: true, unique: "crm_jobs_dedupe" },
    claimed_by: { type: DataTypes.STRING(40), allowNull: true },
    claimed_until: { type: DataTypes.DATE, allowNull: true },
    last_error: { type: DataTypes.STRING(500), allowNull: true },
    result: { type: DataTypes.STRING(500), allowNull: true },
    done_at: { type: DataTypes.DATE, allowNull: true },
}, { tableName: "crm_jobs", indexes: [{ fields: ["status", "run_at"], name: "crm_jobs_due" }] });

module.exports = { AdmRole, AdmTeam, AdmUser, AdmLeave, AdmSession, AdmAuditLog, AdmSetting, CrmEvent, CrmJob };
