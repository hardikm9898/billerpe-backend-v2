const { DataTypes } = require("sequelize");
const sequelize = require("../connection/connect");

// BillerPe SuperAdmin phase 7: support tickets. Schema owned by migration
// 20261013100000-create-support; listed in server.js TABLES_TO_SKIP_ALTER.
// The ticket itself stays a row of the old hms_raise_ticket_msts (the
// outlet apps and older code create those); everything the queue needs -
// subject, channel, owner, timers, rating - lives in sup_tickets beside it
// (one row per ticket, made for any ticket within a minute: sup.timers).

const T = DataTypes;

// state: new (nobody answered yet) | open | waiting (on the customer: the
// fix timer pauses) | closed. hms_raise_ticket_msts.status follows it
// (new | open | close) for the older screens.
// channel: webpos | pos_app | owner_app | whatsapp | phone | email | staff | old_app
const SupTicket = sequelize.define("sup_ticket", {
    id: { type: T.INTEGER, primaryKey: true, autoIncrement: true },
    ticket_id: { type: T.INTEGER, allowNull: false, unique: "sup_tickets_ticket" },
    hotel_id: { type: T.INTEGER, allowNull: true },
    account_id: { type: T.INTEGER, allowNull: true },
    subject: { type: T.STRING(160), allowNull: false, defaultValue: "" },
    category: { type: T.STRING(40), allowNull: false, defaultValue: "Other" },
    // high | medium | low
    priority: { type: T.STRING(8), allowNull: false, defaultValue: "medium" },
    channel: { type: T.STRING(12), allowNull: false, defaultValue: "old_app" },
    state: { type: T.STRING(8), allowNull: false, defaultValue: "new" },
    assignee_id: { type: T.INTEGER, allowNull: true },
    assigned_at: { type: T.DATE, allowNull: true },
    raised_by: { type: T.STRING(160), allowNull: false, defaultValue: "" },
    contact_name: { type: T.STRING(120), allowNull: false, defaultValue: "" },
    // Last 10 digits; replies go here on WhatsApp.
    contact_mobile: { type: T.STRING(15), allowNull: false, defaultValue: "" },
    wa_chat_id: { type: T.INTEGER, allowNull: true },
    created_by: { type: T.INTEGER, allowNull: true },
    opened_at: { type: T.DATE, allowNull: false },
    first_reply_due: { type: T.DATE, allowNull: true },
    first_reply_at: { type: T.DATE, allowNull: true },
    resolve_due: { type: T.DATE, allowNull: true },
    // Working minutes spent waiting on the customer (added to the fix timer).
    paused_minutes: { type: T.INTEGER, allowNull: false, defaultValue: 0 },
    waiting_since: { type: T.DATE, allowNull: true },
    late_reply_at: { type: T.DATE, allowNull: true },
    late_fix_at: { type: T.DATE, allowNull: true },
    closed_at: { type: T.DATE, allowNull: true },
    closed_by: { type: T.INTEGER, allowNull: true },
    resolution: { type: T.STRING(500), allowNull: false, defaultValue: "" },
    reopened: { type: T.INTEGER, allowNull: false, defaultValue: 0 },
    // 1 (poor) | 3 (okay) | 5 (good)
    rating: { type: T.INTEGER, allowNull: true },
    rating_asked_at: { type: T.DATE, allowNull: true },
    rated_at: { type: T.DATE, allowNull: true },
    last_customer_at: { type: T.DATE, allowNull: true },
    last_staff_at: { type: T.DATE, allowNull: true },
}, {
    tableName: "sup_tickets",
    indexes: [
        { fields: ["state"], name: "sup_tickets_state" },
        { fields: ["assignee_id", "state"], name: "sup_tickets_assignee" },
        { fields: ["hotel_id"], name: "sup_tickets_hotel" },
        { fields: ["account_id"], name: "sup_tickets_account" },
        { fields: ["contact_mobile"], name: "sup_tickets_mobile" },
    ],
});

// The conversation (replaces the JSON comment column).
// kind: customer | staff (seen by the customer) | note (internal) | system
// via: panel | whatsapp | phone | email | webpos | pos_app | owner_app | old
// wa_status: sent | simulated | template | failed | not_sent (staff replies only)
const SupTicketMessage = sequelize.define("sup_ticket_message", {
    id: { type: T.INTEGER, primaryKey: true, autoIncrement: true },
    ticket_id: { type: T.INTEGER, allowNull: false },
    kind: { type: T.STRING(10), allowNull: false },
    author_id: { type: T.INTEGER, allowNull: true },
    author_name: { type: T.STRING(120), allowNull: false, defaultValue: "" },
    via: { type: T.STRING(10), allowNull: false, defaultValue: "panel" },
    body: { type: T.TEXT, allowNull: false },
    // JSON [{ url, name, mime }]
    files: { type: T.TEXT, allowNull: true },
    wa_message_id: { type: T.BIGINT, allowNull: true },
    wa_status: { type: T.STRING(10), allowNull: true },
    wa_note: { type: T.STRING(200), allowNull: true },
    at: { type: T.DATE, allowNull: false },
}, { tableName: "sup_ticket_messages", updatedAt: false, indexes: [{ fields: ["ticket_id", "at"], name: "sup_ticket_messages_ticket" }] });

module.exports = { SupTicket, SupTicketMessage };
