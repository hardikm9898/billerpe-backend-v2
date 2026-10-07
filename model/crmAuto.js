const { DataTypes } = require("sequelize");
const sequelize = require("../connection/connect");

// BillerPe SuperAdmin phase 3: the WhatsApp inbox, templates, opt-outs,
// automation rules, cadences, campaigns and escalations. Schema owned by
// migration 20261009100000-create-crm-inbox-automation; listed in server.js
// TABLES_TO_SKIP_ALTER. The old wa_agent_* tables (controller/
// whatsappAgentController.js) are not used by the new panel.

const T = DataTypes;

// One chat per WhatsApp number. kind: lead | guest (a restaurant's customer) |
// customer (a BillerPe restaurant owner or staff) | staff (our own team) | other.
const CrmWaChat = sequelize.define("crm_wa_chat", {
    id: { type: T.INTEGER, primaryKey: true, autoIncrement: true },
    // Digits with country code, as WhatsApp sends them (919876543210).
    phone: { type: T.STRING(20), allowNull: false },
    phone_key: { type: T.STRING(15), allowNull: false, unique: "crm_wa_chats_phone_key" },
    name: { type: T.STRING(120), allowNull: false, defaultValue: "" },
    kind: { type: T.STRING(10), allowNull: false, defaultValue: "lead" },
    // Restaurant name for guests and customers.
    label: { type: T.STRING(120), allowNull: false, defaultValue: "" },
    lead_id: { type: T.INTEGER, allowNull: true },
    hotel_id: { type: T.INTEGER, allowNull: true },
    last_in_at: { type: T.DATE, allowNull: true },
    last_out_at: { type: T.DATE, allowNull: true },
    last_message_at: { type: T.DATE, allowNull: true },
    preview: { type: T.STRING(200), allowNull: false, defaultValue: "" },
    unread: { type: T.INTEGER, allowNull: false, defaultValue: 0 },
    // The last word is theirs and nobody (person or AI) has answered yet.
    needs_reply: { type: T.BOOLEAN, allowNull: false, defaultValue: false },
    // The AI stays quiet here until then (a person replied, or "Take over").
    ai_paused_until: { type: T.DATE, allowNull: true },
    ai_off: { type: T.BOOLEAN, allowNull: false, defaultValue: false },
    handover_reason: { type: T.STRING(200), allowNull: false, defaultValue: "" },
    status: { type: T.STRING(8), allowNull: false, defaultValue: "open" },
    // "lb1c:<old id>" = old SuperAdmin inbox (wa_agent_conversations).
    legacy_id: { type: T.STRING(40), allowNull: true, unique: "crm_wa_chats_legacy" },
}, {
    tableName: "crm_wa_chats",
    indexes: [{ fields: ["last_message_at"], name: "crm_wa_chats_last" }, { fields: ["lead_id"], name: "crm_wa_chats_lead" }],
});

// direction: in | out. kind: text | template | image | document | audio | video |
// sticker | location | reaction | note (an internal line, never sent).
// sender: customer | ai | user | rule | cadence | campaign | system.
// status: received | queued | sent | delivered | read | failed | simulated.
const CrmWaMessage = sequelize.define("crm_wa_message", {
    id: { type: T.BIGINT, primaryKey: true, autoIncrement: true },
    chat_id: { type: T.INTEGER, allowNull: false },
    wa_id: { type: T.STRING(120), allowNull: true, unique: "crm_wa_messages_wa_id" },
    direction: { type: T.STRING(3), allowNull: false },
    kind: { type: T.STRING(10), allowNull: false, defaultValue: "text" },
    body: { type: T.TEXT, allowNull: true },
    template_id: { type: T.INTEGER, allowNull: true },
    template_name: { type: T.STRING(80), allowNull: true },
    params: { type: T.TEXT, allowNull: true },
    media_id: { type: T.STRING(120), allowNull: true },
    media_url: { type: T.STRING(500), allowNull: true },
    mime_type: { type: T.STRING(80), allowNull: true },
    file_name: { type: T.STRING(200), allowNull: true },
    sender: { type: T.STRING(10), allowNull: false, defaultValue: "customer" },
    user_id: { type: T.INTEGER, allowNull: true },
    status: { type: T.STRING(10), allowNull: false, defaultValue: "received" },
    error: { type: T.STRING(300), allowNull: true },
    at: { type: T.DATE, allowNull: false },
    campaign_id: { type: T.INTEGER, allowNull: true },
    enrollment_id: { type: T.INTEGER, allowNull: true },
    legacy_id: { type: T.STRING(40), allowNull: true, unique: "crm_wa_messages_legacy" },
}, {
    tableName: "crm_wa_messages",
    updatedAt: false,
    indexes: [{ fields: ["chat_id", "id"], name: "crm_wa_messages_chat" }, { fields: ["status", "at"], name: "crm_wa_messages_status" }],
});

// Meta-approved message templates. body is the approved text with {{1}}, {{2}}
// for the panel's preview; params says what fills each number:
// [{ label, source: "lead.name" | "lead.restaurant" | "owner.name" | "owner.mobile" | "custom", value }].
const CrmWaTemplate = sequelize.define("crm_wa_template", {
    id: { type: T.INTEGER, primaryKey: true, autoIncrement: true },
    name: { type: T.STRING(80), allowNull: false },
    language: { type: T.STRING(10), allowNull: false, defaultValue: "en" },
    category: { type: T.STRING(12), allowNull: false, defaultValue: "marketing" },
    body: { type: T.TEXT, allowNull: true },
    params: { type: T.TEXT, allowNull: true },
    header_image: { type: T.STRING(500), allowNull: true },
    active: { type: T.BOOLEAN, allowNull: false, defaultValue: true },
    legacy_id: { type: T.STRING(40), allowNull: true, unique: "crm_wa_templates_legacy" },
    created_by: { type: T.INTEGER, allowNull: true },
}, { tableName: "crm_wa_templates", indexes: [{ unique: true, fields: ["name", "language"], name: "crm_wa_templates_name" }] });

// Numbers that asked not to get marketing messages. Campaigns, cadences and
// rules never send templates to them; replies to their own messages still go.
const CrmWaOptout = sequelize.define("crm_wa_optout", {
    id: { type: T.INTEGER, primaryKey: true, autoIncrement: true },
    phone_key: { type: T.STRING(15), allowNull: false, unique: "crm_wa_optouts_phone" },
    reason: { type: T.STRING(200), allowNull: false, defaultValue: "" },
    // keyword (they wrote STOP) | manual | import
    source: { type: T.STRING(10), allowNull: false, defaultValue: "manual" },
    by_id: { type: T.INTEGER, allowNull: true },
    at: { type: T.DATE, allowNull: false },
}, { tableName: "crm_wa_optouts", updatedAt: false });

// When-If-Then rules. rule_key marks a built-in rule (edit its params, switch it
// off, never delete it). trigger: an event type (lead.created, lead.outcome,
// lead.stage, lead.won, lead.lost, wa.received) or a built-in timer.
const CrmRule = sequelize.define("crm_rule", {
    id: { type: T.INTEGER, primaryKey: true, autoIncrement: true },
    rule_key: { type: T.STRING(40), allowNull: true, unique: "crm_rules_key" },
    name: { type: T.STRING(80), allowNull: false },
    description: { type: T.STRING(300), allowNull: false, defaultValue: "" },
    trigger: { type: T.STRING(40), allowNull: false },
    conditions: { type: T.TEXT, allowNull: true },
    actions: { type: T.TEXT, allowNull: true },
    guards: { type: T.TEXT, allowNull: true },
    params: { type: T.TEXT, allowNull: true },
    active: { type: T.BOOLEAN, allowNull: false, defaultValue: true },
    sort: { type: T.INTEGER, allowNull: false, defaultValue: 0 },
    created_by: { type: T.INTEGER, allowNull: true },
    updated_by: { type: T.INTEGER, allowNull: true },
}, { tableName: "crm_rules" });

// Every time a rule ran (or would have, in a dry run). result: done | skipped | failed.
const CrmRuleRun = sequelize.define("crm_rule_run", {
    id: { type: T.BIGINT, primaryKey: true, autoIncrement: true },
    rule_id: { type: T.INTEGER, allowNull: false },
    lead_id: { type: T.INTEGER, allowNull: true },
    event_id: { type: T.BIGINT, allowNull: true },
    result: { type: T.STRING(8), allowNull: false },
    details: { type: T.STRING(500), allowNull: false, defaultValue: "" },
    at: { type: T.DATE, allowNull: false },
}, {
    tableName: "crm_rule_runs",
    updatedAt: false,
    indexes: [{ fields: ["rule_id", "at"], name: "crm_rule_runs_rule" }, { fields: ["lead_id", "rule_id"], name: "crm_rule_runs_lead" }],
});

// A sequence of call tasks and WhatsApp templates. enroll_on: manual |
// lead.created | outcome:<key> | migration. stop_on: JSON { reply, demo, stage, closed }.
const CrmCadence = sequelize.define("crm_cadence", {
    id: { type: T.INTEGER, primaryKey: true, autoIncrement: true },
    cadence_key: { type: T.STRING(40), allowNull: true, unique: "crm_cadences_key" },
    name: { type: T.STRING(80), allowNull: false },
    description: { type: T.STRING(300), allowNull: false, defaultValue: "" },
    enroll_on: { type: T.STRING(40), allowNull: false, defaultValue: "manual" },
    stop_on: { type: T.TEXT, allowNull: true },
    active: { type: T.BOOLEAN, allowNull: false, defaultValue: true },
    created_by: { type: T.INTEGER, allowNull: true },
}, { tableName: "crm_cadences" });

// action: call (a call task) | whatsapp (a "send a WhatsApp" task) | template
// (sent by the worker). day_offset from enrolment; at_time HH:MM in India time
// (null = the enrolment's own time on that day).
const CrmCadenceStep = sequelize.define("crm_cadence_step", {
    id: { type: T.INTEGER, primaryKey: true, autoIncrement: true },
    cadence_id: { type: T.INTEGER, allowNull: false },
    sort: { type: T.INTEGER, allowNull: false, defaultValue: 0 },
    day_offset: { type: T.INTEGER, allowNull: false, defaultValue: 0 },
    at_time: { type: T.STRING(5), allowNull: true },
    action: { type: T.STRING(10), allowNull: false, defaultValue: "call" },
    template_id: { type: T.INTEGER, allowNull: true },
    note: { type: T.STRING(200), allowNull: false, defaultValue: "" },
}, { tableName: "crm_cadence_steps", indexes: [{ fields: ["cadence_id", "sort"], name: "crm_cadence_steps_cadence" }] });

// One lead in one cadence. status: running | done | stopped.
const CrmCadenceEnrollment = sequelize.define("crm_cadence_enrollment", {
    id: { type: T.INTEGER, primaryKey: true, autoIncrement: true },
    cadence_id: { type: T.INTEGER, allowNull: false },
    lead_id: { type: T.INTEGER, allowNull: false },
    // Index into the cadence's steps (by sort) of the next step to run.
    step_index: { type: T.INTEGER, allowNull: false, defaultValue: 0 },
    next_run_at: { type: T.DATE, allowNull: true },
    status: { type: T.STRING(8), allowNull: false, defaultValue: "running" },
    stop_reason: { type: T.STRING(80), allowNull: false, defaultValue: "" },
    started_at: { type: T.DATE, allowNull: false },
    ended_at: { type: T.DATE, allowNull: true },
    replied_at: { type: T.DATE, allowNull: true },
    by_id: { type: T.INTEGER, allowNull: true },
    origin: { type: T.STRING(12), allowNull: false, defaultValue: "manual" },
}, {
    tableName: "crm_cadence_enrollments",
    indexes: [{ fields: ["status", "next_run_at"], name: "crm_cadence_enr_due" }, { fields: ["lead_id", "status"], name: "crm_cadence_enr_lead" }, { fields: ["cadence_id", "status"], name: "crm_cadence_enr_cadence" }],
});

// A bulk template send. status: draft | scheduled | sending | paused | done | cancelled.
// audience: JSON filter over leads (stages, sources, bands, owners, cities,
// quietDays, createdFrom, createdTo).
const CrmCampaign = sequelize.define("crm_campaign", {
    id: { type: T.INTEGER, primaryKey: true, autoIncrement: true },
    name: { type: T.STRING(120), allowNull: false },
    template_id: { type: T.INTEGER, allowNull: true },
    params: { type: T.TEXT, allowNull: true },
    audience: { type: T.TEXT, allowNull: true },
    status: { type: T.STRING(10), allowNull: false, defaultValue: "draft" },
    scheduled_at: { type: T.DATE, allowNull: true },
    started_at: { type: T.DATE, allowNull: true },
    finished_at: { type: T.DATE, allowNull: true },
    per_minute: { type: T.INTEGER, allowNull: false, defaultValue: 30 },
    total: { type: T.INTEGER, allowNull: false, defaultValue: 0 },
    created_by: { type: T.INTEGER, allowNull: true },
    legacy_id: { type: T.STRING(40), allowNull: true, unique: "crm_campaigns_legacy" },
}, { tableName: "crm_campaigns" });

// status: queued | sent | delivered | read | failed | skipped (opt-out, no number, ...).
const CrmCampaignRcpt = sequelize.define("crm_campaign_recipient", {
    id: { type: T.BIGINT, primaryKey: true, autoIncrement: true },
    campaign_id: { type: T.INTEGER, allowNull: false },
    lead_id: { type: T.INTEGER, allowNull: true },
    phone_key: { type: T.STRING(15), allowNull: false },
    phone: { type: T.STRING(20), allowNull: false },
    status: { type: T.STRING(10), allowNull: false, defaultValue: "queued" },
    wa_id: { type: T.STRING(120), allowNull: true },
    error: { type: T.STRING(300), allowNull: true },
    sent_at: { type: T.DATE, allowNull: true },
    delivered_at: { type: T.DATE, allowNull: true },
    read_at: { type: T.DATE, allowNull: true },
    replied_at: { type: T.DATE, allowNull: true },
    legacy_id: { type: T.STRING(40), allowNull: true, unique: "crm_campaign_rcpt_legacy" },
}, {
    tableName: "crm_campaign_recipients",
    indexes: [{ unique: true, fields: ["campaign_id", "phone_key"], name: "crm_campaign_rcpt_phone" }, { fields: ["campaign_id", "status"], name: "crm_campaign_rcpt_status" }, { fields: ["wa_id"], name: "crm_campaign_rcpt_wa" }],
});

// The escalation chain: salesperson -> manager (level 1) -> admin (level 2).
// kind: first_contact | overdue | handover. ref is unique so a timer never
// escalates the same thing twice.
const CrmEscalation = sequelize.define("crm_escalation", {
    id: { type: T.INTEGER, primaryKey: true, autoIncrement: true },
    ref: { type: T.STRING(80), allowNull: false, unique: "crm_escalations_ref" },
    lead_id: { type: T.INTEGER, allowNull: false },
    task_id: { type: T.INTEGER, allowNull: true },
    kind: { type: T.STRING(14), allowNull: false },
    level: { type: T.INTEGER, allowNull: false, defaultValue: 1 },
    owner_id: { type: T.INTEGER, allowNull: true },
    // Who must act now (the manager, then the admins).
    to_ids: { type: T.STRING(200), allowNull: false, defaultValue: "" },
    status: { type: T.STRING(8), allowNull: false, defaultValue: "open" },
    raised_at: { type: T.DATE, allowNull: false },
    // When it goes up to the next level if nobody acts (null = top level).
    next_level_at: { type: T.DATE, allowNull: true },
    handled_by: { type: T.INTEGER, allowNull: true },
    handled_at: { type: T.DATE, allowNull: true },
    how: { type: T.STRING(120), allowNull: false, defaultValue: "" },
}, {
    tableName: "crm_escalations",
    indexes: [{ fields: ["status", "next_level_at"], name: "crm_escalations_due" }, { fields: ["lead_id", "status"], name: "crm_escalations_lead" }],
});

module.exports = { CrmWaChat, CrmWaMessage, CrmWaTemplate, CrmWaOptout, CrmRule, CrmRuleRun, CrmCadence, CrmCadenceStep, CrmCadenceEnrollment, CrmCampaign, CrmCampaignRcpt, CrmEscalation };
