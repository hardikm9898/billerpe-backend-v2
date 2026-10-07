const { DataTypes } = require("sequelize");
const sequelize = require("../connection/connect");

// BillerPe SuperAdmin sales CRM (phase 2). Schema owned by migration
// 20261008120000-create-crm-core; listed in server.js TABLES_TO_SKIP_ALTER.
// The old CRM tables (crm_*_msts, model/crm/) are not used by the new panel.
// All times are UTC in the database; working hours are Asia/Kolkata.

const T = DataTypes;

// Pipeline stages. kind: open | won | lost. stage_key of built-in stages
// (new, contacted, qualified, demo, proposal, won, lost) never changes.
const CrmStage = sequelize.define("crm_stage", {
    id: { type: T.INTEGER, primaryKey: true, autoIncrement: true },
    stage_key: { type: T.STRING(30), allowNull: false, unique: "crm_stages_key" },
    name: { type: T.STRING(60), allowNull: false },
    kind: { type: T.STRING(8), allowNull: false, defaultValue: "open" },
    sort: { type: T.INTEGER, allowNull: false, defaultValue: 0 },
    hours_allowed: { type: T.INTEGER, allowNull: true },
    active: { type: T.BOOLEAN, allowNull: false, defaultValue: true },
    is_system: { type: T.BOOLEAN, allowNull: false, defaultValue: false },
}, { tableName: "crm_stages" });

// Why a lead was lost. revisit_days set = the lead comes back after that long ("Not now").
const CrmLostReason = sequelize.define("crm_lost_reason", {
    id: { type: T.INTEGER, primaryKey: true, autoIncrement: true },
    reason_key: { type: T.STRING(30), allowNull: false, unique: "crm_lost_reasons_key" },
    name: { type: T.STRING(80), allowNull: false },
    revisit_days: { type: T.INTEGER, allowNull: true },
    sort: { type: T.INTEGER, allowNull: false, defaultValue: 0 },
    active: { type: T.BOOLEAN, allowNull: false, defaultValue: true },
    is_system: { type: T.BOOLEAN, allowNull: false, defaultValue: false },
}, { tableName: "crm_lost_reasons" });

// What happened on a call or chat, with the next action it suggests.
// reached = the person was spoken to. lost_reason_key set = closes the lead.
const CrmOutcome = sequelize.define("crm_outcome", {
    id: { type: T.INTEGER, primaryKey: true, autoIncrement: true },
    outcome_key: { type: T.STRING(30), allowNull: false, unique: "crm_outcomes_key" },
    name: { type: T.STRING(60), allowNull: false },
    reached: { type: T.BOOLEAN, allowNull: false, defaultValue: false },
    next_type: { type: T.STRING(16), allowNull: true },
    // Working minutes until the suggested next action.
    next_after_minutes: { type: T.INTEGER, allowNull: true },
    suggest_stage_key: { type: T.STRING(30), allowNull: true },
    lost_reason_key: { type: T.STRING(30), allowNull: true },
    sort: { type: T.INTEGER, allowNull: false, defaultValue: 0 },
    active: { type: T.BOOLEAN, allowNull: false, defaultValue: true },
    is_system: { type: T.BOOLEAN, allowNull: false, defaultValue: false },
}, { tableName: "crm_outcomes" });

// A lead. phone = +91XXXXXXXXXX style; phone_key = last 10 digits (the
// duplicate key; one OPEN lead per phone_key is kept by the intake code).
// next_action_* = a copy of the earliest open task (crm/tasks.js syncNext).
const CrmLeadV2 = sequelize.define("crm_lead", {
    id: { type: T.INTEGER, primaryKey: true, autoIncrement: true },
    name: { type: T.STRING(120), allowNull: false, defaultValue: "" },
    phone: { type: T.STRING(24), allowNull: false, defaultValue: "" },
    phone_key: { type: T.STRING(15), allowNull: false, defaultValue: "" },
    phone_valid: { type: T.BOOLEAN, allowNull: false, defaultValue: true },
    alt_phone: { type: T.STRING(24), allowNull: false, defaultValue: "" },
    email: { type: T.STRING(120), allowNull: false, defaultValue: "" },
    restaurant_name: { type: T.STRING(120), allowNull: false, defaultValue: "" },
    business_type: { type: T.STRING(30), allowNull: false, defaultValue: "" },
    city: { type: T.STRING(60), allowNull: false, defaultValue: "" },
    state: { type: T.STRING(40), allowNull: false, defaultValue: "" },
    outlets_count: { type: T.INTEGER, allowNull: true },
    tables_count: { type: T.INTEGER, allowNull: true },
    current_software: { type: T.STRING(80), allowNull: false, defaultValue: "" },
    plan_interest: { type: T.STRING(30), allowNull: false, defaultValue: "" },
    hardware_need: { type: T.STRING(120), allowNull: false, defaultValue: "" },
    budget: { type: T.STRING(60), allowNull: false, defaultValue: "" },
    decision_maker: { type: T.STRING(120), allowNull: false, defaultValue: "" },
    expected_start: { type: T.DATEONLY, allowNull: true },
    // website | meta | whatsapp | phone | manual | referral | import
    source: { type: T.STRING(20), allowNull: false, defaultValue: "manual" },
    // JSON: campaign, adset, ad, form, utm...
    source_detail: { type: T.TEXT, allowNull: true },
    stage_id: { type: T.INTEGER, allowNull: false },
    owner_id: { type: T.INTEGER, allowNull: true },
    score: { type: T.INTEGER, allowNull: false, defaultValue: 0 },
    next_action_at: { type: T.DATE, allowNull: true },
    next_action_type: { type: T.STRING(16), allowNull: true },
    next_action_note: { type: T.STRING(200), allowNull: true },
    last_activity_at: { type: T.DATE, allowNull: true },
    first_contact_at: { type: T.DATE, allowNull: true },
    response_due_at: { type: T.DATE, allowNull: true },
    lost_reason_id: { type: T.INTEGER, allowNull: true },
    lost_note: { type: T.STRING(300), allowNull: false, defaultValue: "" },
    revisit_at: { type: T.DATE, allowNull: true },
    won_at: { type: T.DATE, allowNull: true },
    closed_at: { type: T.DATE, allowNull: true },
    hotel_id: { type: T.INTEGER, allowNull: true },
    merged_into_id: { type: T.INTEGER, allowNull: true },
    // "lb1:<old id>" = old SuperAdmin CRM, "v2:<id>" = v2 crm_lead_msts.
    legacy_id: { type: T.STRING(40), allowNull: true, unique: "crm_leads_legacy" },
    created_by: { type: T.INTEGER, allowNull: true },
    deleted_at: { type: T.DATE, allowNull: true },
}, {
    tableName: "crm_leads",
    indexes: [
        { fields: ["phone_key"], name: "crm_leads_phone_key" },
        { fields: ["owner_id", "next_action_at"], name: "crm_leads_owner_next" },
        { fields: ["stage_id", "next_action_at"], name: "crm_leads_stage_next" },
        { fields: ["revisit_at"], name: "crm_leads_revisit" },
        { fields: ["createdAt"], name: "crm_leads_created" },
    ],
});

// Every inbound inquiry, kept even when it joins an existing lead.
const CrmInquiry = sequelize.define("crm_inquiry", {
    id: { type: T.INTEGER, primaryKey: true, autoIncrement: true },
    lead_id: { type: T.INTEGER, allowNull: false },
    source: { type: T.STRING(20), allowNull: false },
    // Meta lead id etc. - the same delivery is never stored twice.
    external_id: { type: T.STRING(80), allowNull: true, unique: "crm_inquiries_external" },
    name: { type: T.STRING(120), allowNull: false, defaultValue: "" },
    phone: { type: T.STRING(40), allowNull: false, defaultValue: "" },
    email: { type: T.STRING(120), allowNull: false, defaultValue: "" },
    message: { type: T.STRING(1000), allowNull: false, defaultValue: "" },
    source_detail: { type: T.TEXT, allowNull: true },
    received_at: { type: T.DATE, allowNull: false },
    legacy_id: { type: T.STRING(40), allowNull: true, unique: "crm_inquiries_legacy" },
}, { tableName: "crm_inquiries", indexes: [{ fields: ["lead_id"], name: "crm_inquiries_lead" }] });

// A next action / to-do. type: call | whatsapp | demo | proposal | payment | visit | other.
// status: open | done | cancelled. origin: manual | outcome | intake | rule | migration.
const CrmTaskV2 = sequelize.define("crm_task", {
    id: { type: T.INTEGER, primaryKey: true, autoIncrement: true },
    lead_id: { type: T.INTEGER, allowNull: false },
    owner_id: { type: T.INTEGER, allowNull: true },
    type: { type: T.STRING(16), allowNull: false, defaultValue: "call" },
    note: { type: T.STRING(300), allowNull: false, defaultValue: "" },
    due_at: { type: T.DATE, allowNull: false },
    status: { type: T.STRING(10), allowNull: false, defaultValue: "open" },
    done_at: { type: T.DATE, allowNull: true },
    done_by: { type: T.INTEGER, allowNull: true },
    outcome_id: { type: T.INTEGER, allowNull: true },
    origin: { type: T.STRING(12), allowNull: false, defaultValue: "manual" },
    created_by: { type: T.INTEGER, allowNull: true },
    legacy_id: { type: T.STRING(40), allowNull: true, unique: "crm_tasks_legacy" },
}, {
    tableName: "crm_tasks",
    indexes: [{ fields: ["lead_id", "status"], name: "crm_tasks_lead_status" }, { fields: ["owner_id", "status", "due_at"], name: "crm_tasks_owner_due" }],
});

// The lead's timeline (append-only). type: created | inquiry | outcome | call | note |
// stage | owner | task | won | lost | reopen | merge | edit | system.
const CrmActivity = sequelize.define("crm_activity", {
    id: { type: T.BIGINT, primaryKey: true, autoIncrement: true },
    lead_id: { type: T.INTEGER, allowNull: false },
    type: { type: T.STRING(16), allowNull: false },
    actor_id: { type: T.INTEGER, allowNull: true },
    outcome_id: { type: T.INTEGER, allowNull: true },
    body: { type: T.STRING(1000), allowNull: false, defaultValue: "" },
    data: { type: T.TEXT, allowNull: true },
    at: { type: T.DATE, allowNull: false },
    legacy_id: { type: T.STRING(40), allowNull: true, unique: "crm_activities_legacy" },
}, {
    tableName: "crm_activities",
    updatedAt: false,
    indexes: [{ fields: ["lead_id", "at"], name: "crm_activities_lead_at" }, { fields: ["actor_id", "at"], name: "crm_activities_actor_at" }],
});

// A phone call. source: typed (logged by hand) | app (the sales app, phase 4).
const CrmCall = sequelize.define("crm_call", {
    id: { type: T.INTEGER, primaryKey: true, autoIncrement: true },
    lead_id: { type: T.INTEGER, allowNull: false },
    user_id: { type: T.INTEGER, allowNull: true },
    source: { type: T.STRING(10), allowNull: false, defaultValue: "typed" },
    device_call_id: { type: T.STRING(80), allowNull: true, unique: "crm_calls_device" },
    direction: { type: T.STRING(8), allowNull: false, defaultValue: "out" },
    phone: { type: T.STRING(24), allowNull: false, defaultValue: "" },
    started_at: { type: T.DATE, allowNull: false },
    duration_seconds: { type: T.INTEGER, allowNull: false, defaultValue: 0 },
    answered: { type: T.BOOLEAN, allowNull: false, defaultValue: false },
    outcome_id: { type: T.INTEGER, allowNull: true },
    recording_url: { type: T.STRING(500), allowNull: true },
    legacy_id: { type: T.STRING(40), allowNull: true, unique: "crm_calls_legacy" },
}, { tableName: "crm_calls", indexes: [{ fields: ["lead_id", "started_at"], name: "crm_calls_lead" }, { fields: ["user_id", "started_at"], name: "crm_calls_user" }] });

// Every owner change and why. by_id null = by a rule (round-robin).
const CrmAssignment = sequelize.define("crm_assignment", {
    id: { type: T.INTEGER, primaryKey: true, autoIncrement: true },
    lead_id: { type: T.INTEGER, allowNull: false },
    from_id: { type: T.INTEGER, allowNull: true },
    to_id: { type: T.INTEGER, allowNull: true },
    by_id: { type: T.INTEGER, allowNull: true },
    reason: { type: T.STRING(200), allowNull: false, defaultValue: "" },
    at: { type: T.DATE, allowNull: false },
}, { tableName: "crm_assignments", indexes: [{ fields: ["to_id", "at"], name: "crm_assignments_to_at" }, { fields: ["lead_id"], name: "crm_assignments_lead" }] });

// In-panel notifications. ref unique per person = the same event never notifies twice.
const AdmNotification = sequelize.define("adm_notification", {
    id: { type: T.BIGINT, primaryKey: true, autoIncrement: true },
    user_id: { type: T.INTEGER, allowNull: false },
    type: { type: T.STRING(30), allowNull: false },
    title: { type: T.STRING(160), allowNull: false },
    body: { type: T.STRING(400), allowNull: false, defaultValue: "" },
    link: { type: T.STRING(160), allowNull: false, defaultValue: "" },
    ref: { type: T.STRING(120), allowNull: true },
    read_at: { type: T.DATE, allowNull: true },
}, {
    tableName: "adm_notifications",
    indexes: [{ fields: ["user_id", "read_at"], name: "adm_notifications_user_read" }, { unique: true, fields: ["user_id", "ref"], name: "adm_notifications_user_ref" }],
});

// Lunch and tea breaks (the Break button). While on a break a person gets no new leads.
const AdmBreak = sequelize.define("adm_break", {
    id: { type: T.INTEGER, primaryKey: true, autoIncrement: true },
    user_id: { type: T.INTEGER, allowNull: false },
    kind: { type: T.STRING(8), allowNull: false, defaultValue: "tea" },
    started_at: { type: T.DATE, allowNull: false },
    ends_at: { type: T.DATE, allowNull: false },
    ended_at: { type: T.DATE, allowNull: true },
}, { tableName: "adm_breaks", indexes: [{ fields: ["user_id", "started_at"], name: "adm_breaks_user" }] });

module.exports = { CrmStage, CrmLostReason, CrmOutcome, CrmLeadV2, CrmInquiry, CrmTaskV2, CrmActivity, CrmCall, CrmAssignment, AdmNotification, AdmBreak };
