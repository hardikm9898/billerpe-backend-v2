const { Op, QueryTypes } = require("sequelize");
const { sequelize, CrmWaChat, CrmWaMessage, CrmWaTemplate, CrmLeadV2, CrmTaskV2, CrmActivity, AdmUser } = require("../../model");
const { RuleError } = require("../../appv1/core");
const settings = require("../settings");
const { need } = require("../auth");
const config = require("./config");
const scope = require("./scope");
const wa = require("./wa");
const ai = require("./ai");
const { syncNext } = require("./tasks");
const { band } = require("./score");
const { workingHours, addWorkingMinutes, txt, parse } = require("./util");

// The shared WhatsApp inbox. A salesperson sees the chats of the leads they
// may see; "inbox.all" also sees guests, customers and unknown numbers. A
// person's reply pauses the AI in that chat (whatsapp_ai.aiQuietHoursAfterHuman).

const VIEWS = ["mine", "needs_reply", "unread", "ai", "not_lead", "all"];
const PAGE = 30;

function canUse(s) {
    if (!s.can("inbox.use") && !s.can("inbox.all")) throw new RuleError("You do not have permission for this.");
}

/** SQL for the chats this person may see (alias c = crm_wa_chats, l = crm_leads). */
async function visibleSql(s) {
    if (s.can("inbox.all") && s.can("leads.view_all")) return { sql: "1=1", repl: {} };
    let owners;
    try {
        owners = await scope.visibleOwners(s);
    } catch {
        owners = [];
    }
    const leadPart = owners === null ? "l.id IS NOT NULL" : owners.length ? "l.owner_id IN (:owners)" : "1=0";
    const sql = s.can("inbox.all") ? `((c.kind = 'lead' AND ${leadPart}) OR c.kind <> 'lead' OR c.lead_id IS NULL)` : `(c.kind = 'lead' AND ${leadPart})`;
    return { sql, repl: { owners: owners || [] } };
}

async function aiEnabled() {
    return (await settings.read("ai_assistant")).enabled;
}

function viewSql(view, me) {
    switch (view) {
        case "mine": return { sql: "l.owner_id = :me", repl: { me } };
        case "needs_reply": return { sql: "c.needs_reply = 1", repl: {} };
        case "unread": return { sql: "c.unread > 0", repl: {} };
        case "ai": return { sql: "c.kind = 'lead' AND c.ai_off = 0 AND (c.ai_paused_until IS NULL OR c.ai_paused_until < UTC_TIMESTAMP())", repl: {} };
        case "not_lead": return { sql: "c.kind <> 'lead'", repl: {} };
        default: return { sql: "1=1", repl: {} };
    }
}

function aiState(c, enabled, now = Date.now()) {
    if (c.kind !== "lead") return "none";
    if (!enabled || c.ai_off) return "off";
    if (c.ai_paused_until && new Date(c.ai_paused_until).getTime() > now) return "paused";
    return "ai";
}

async function list(s, query = {}) {
    canUse(s);
    // People who see others' chats start on what waits for a reply; a salesperson on their own chats.
    const view = VIEWS.includes(query.view) ? query.view : s.can("inbox.all") || s.can("leads.view_all") || s.can("leads.view_team") ? "needs_reply" : "mine";
    const vis = await visibleSql(s);
    const q = txt(query.q, 60);
    const search = q ? "(c.name LIKE :q OR c.phone LIKE :q OR c.label LIKE :q OR l.name LIKE :q OR l.restaurant_name LIKE :q)" : "1=1";
    const base = `FROM crm_wa_chats c LEFT JOIN crm_leads l ON l.id = c.lead_id WHERE ${vis.sql} AND ${search}`;
    const repl = { ...vis.repl, me: s.user.id, q: `%${q}%` };
    const v = viewSql(view, s.user.id);
    const page = Math.max(1, Number(query.page) || 1);
    const rows = await sequelize.query(
        `SELECT c.*, l.name AS lead_name, l.restaurant_name, l.owner_id, l.stage_id, l.score ${base} AND ${v.sql} ORDER BY c.needs_reply DESC, c.last_message_at DESC, c.id DESC LIMIT ${PAGE} OFFSET ${(page - 1) * PAGE}`,
        { replacements: { ...repl, ...v.repl }, type: QueryTypes.SELECT },
    );
    const counts = {};
    for (const key of VIEWS) {
        const vv = viewSql(key, s.user.id);
        const [r] = await sequelize.query(`SELECT COUNT(*) n ${base} AND ${vv.sql}`, { replacements: { ...repl, ...vv.repl }, type: QueryTypes.SELECT });
        counts[key] = Number(r.n);
    }
    const [nr] = await sequelize.query(`SELECT COUNT(*) n ${base} AND c.needs_reply = 1`, { replacements: repl, type: QueryTypes.SELECT });
    const c = await config.load();
    const owners = new Map((await AdmUser.findAll({ where: { id: [...new Set(rows.map((r) => r.owner_id).filter(Boolean))] }, attributes: ["id", "name"], raw: true })).map((u) => [u.id, u.name]));
    const enabled = await aiEnabled();
    return {
        view,
        counts,
        needsReply: Number(nr.n),
        page,
        pageSize: PAGE,
        chats: rows.map((r) => ({
            id: r.id, name: r.lead_name || r.name || `+${r.phone}`, phone: `+${r.phone}`, kind: r.kind, label: r.label, preview: r.preview, lastAt: r.last_message_at, unread: r.unread, needsReply: !!r.needs_reply,
            ai: aiState(r, enabled), windowOpen: wa.windowOpen(r), status: r.status,
            lead: r.lead_id && r.stage_id ? { id: r.lead_id, restaurant: r.restaurant_name || "", stage: c.stageById.get(r.stage_id)?.name || "", stageKind: c.stageById.get(r.stage_id)?.kind || "open", owner: owners.get(r.owner_id) || "", ownerId: r.owner_id || null, band: band(r.score || 0) } : null,
        })),
    };
}

/** Number of chats waiting for a reply (the menu badge). */
async function waiting(s) {
    if (!s.can("inbox.use") && !s.can("inbox.all")) return { n: 0 };
    const vis = await visibleSql(s);
    const mineOnly = !s.can("inbox.all") && !s.can("leads.view_all") && !s.can("leads.view_team");
    const [r] = await sequelize.query(`SELECT COUNT(*) n FROM crm_wa_chats c LEFT JOIN crm_leads l ON l.id = c.lead_id WHERE ${vis.sql} AND c.needs_reply = 1${mineOnly ? " AND l.owner_id = :me" : ""}`, { replacements: { ...vis.repl, me: s.user.id }, type: QueryTypes.SELECT });
    return { n: Number(r.n) };
}

async function getChat(s, id) {
    canUse(s);
    const chat = await CrmWaChat.findByPk(Number(id) || 0);
    if (!chat) throw new RuleError("This chat no longer exists.");
    const vis = await visibleSql(s);
    const [ok] = await sequelize.query(`SELECT c.id FROM crm_wa_chats c LEFT JOIN crm_leads l ON l.id = c.lead_id WHERE c.id = :id AND ${vis.sql}`, { replacements: { ...vis.repl, id: chat.id }, type: QueryTypes.SELECT });
    if (!ok) throw new RuleError("This chat is not visible to you.");
    return chat;
}

function viewMessage(m, names) {
    return {
        id: Number(m.id), direction: m.direction, kind: m.kind, body: m.body || "", templateName: m.template_name || null, mediaUrl: m.media_url || null, mime: m.mime_type || null, fileName: m.file_name || null,
        sender: m.sender, by: m.user_id ? names.get(m.user_id) || "" : "", status: m.status, error: m.error || null, at: m.at,
    };
}

async function detail(s, id, query = {}) {
    const chat = await getChat(s, id);
    const where = { chat_id: chat.id };
    if (query.after) where.id = { [Op.gt]: Number(query.after) };
    else if (query.before) where.id = { [Op.lt]: Number(query.before) };
    const rows = await CrmWaMessage.findAll({ where, order: [["id", query.after ? "ASC" : "DESC"]], limit: query.after ? 200 : 60 });
    const msgs = query.after ? rows : rows.reverse();
    const names = new Map((await AdmUser.findAll({ where: { id: [...new Set(msgs.map((m) => m.user_id).filter(Boolean))] }, attributes: ["id", "name"], raw: true })).map((u) => [u.id, u.name]));
    const c = await config.load();
    const lead = chat.lead_id ? await CrmLeadV2.findByPk(chat.lead_id) : null;
    const owner = lead && lead.owner_id ? await AdmUser.findByPk(lead.owner_id, { attributes: ["id", "name", "mobile"] }) : null;
    const enabled = await aiEnabled();
    const out = {
        chat: {
            id: chat.id, name: lead?.name || chat.name || `+${chat.phone}`, profileName: chat.name, phone: `+${chat.phone}`, kind: chat.kind, label: chat.label, status: chat.status, unread: chat.unread, needsReply: chat.needs_reply,
            windowOpen: wa.windowOpen(chat), windowEndsAt: wa.windowEndsAt(chat), optedOut: await wa.optedOut(chat.phone_key),
            ai: aiState(chat, enabled), aiPausedUntil: chat.ai_paused_until, handoverReason: chat.handover_reason, aiEnabled: enabled,
        },
        messages: msgs.map((m) => viewMessage(m, names)),
        more: !query.after && rows.length === 60,
        live: wa.live(),
    };
    if (query.after) return out;
    out.lead = lead
        ? {
            id: lead.id, name: lead.name, restaurant: lead.restaurant_name, city: lead.city, outlets: lead.outlets_count, tables: lead.tables_count, source: lead.source,
            stage: c.stageById.get(lead.stage_id)?.name || "", stageKind: c.stageById.get(lead.stage_id)?.kind || "open", score: lead.score, band: band(lead.score),
            owner: owner ? owner.name : "", ownerId: lead.owner_id, nextAction: lead.next_action_at ? { at: lead.next_action_at, type: lead.next_action_type, note: lead.next_action_note } : null,
            closed: !!lead.deleted_at || !!lead.merged_into_id,
        }
        : null;
    const templates = await CrmWaTemplate.findAll({ where: { active: true }, order: [["name", "ASC"]] });
    out.templates = [];
    for (const t of templates) out.templates.push({ id: t.id, name: t.name, body: t.body || "", params: parse(t.params) || [], headerImage: t.header_image || "", values: await wa.paramValues(t, { lead, owner: owner || s.user }) });
    out.cadences = lead ? await require("./cadences").forLead(lead.id) : [];
    return out;
}

/* ------------------------------ sending ------------------------------ */

/** After a person writes in a chat: the AI steps back, the lead counts as contacted, the reply task moves on. */
async function afterHumanSend(s, chat) {
    const quiet = (await settings.read("whatsapp_ai")).aiQuietHoursAfterHuman;
    const patch = { needs_reply: false, unread: 0, handover_reason: "" };
    if (quiet > 0) patch.ai_paused_until = new Date(Date.now() + quiet * 3600000);
    await chat.update(patch);
    if (!chat.lead_id) return;
    await sequelize.transaction(async (t) => {
        const lead = await CrmLeadV2.findByPk(chat.lead_id, { transaction: t, lock: t.LOCK.UPDATE });
        if (!lead) return;
        const now = new Date();
        const fields = { last_activity_at: now };
        if (!lead.first_contact_at && chat.last_in_at) fields.first_contact_at = now;
        await lead.update(fields, { transaction: t });
        // A "Reply on WhatsApp" task is done; if it was the only next action it becomes a follow-up tomorrow.
        const replyTasks = await CrmTaskV2.findAll({ where: { lead_id: lead.id, status: "open", type: "whatsapp", note: { [Op.like]: "Reply on WhatsApp%" } }, transaction: t });
        for (const task of replyTasks) {
            const others = await CrmTaskV2.count({ where: { lead_id: lead.id, status: "open", id: { [Op.ne]: task.id } }, transaction: t });
            if (others) await task.update({ status: "done", done_at: now, done_by: s.user.id }, { transaction: t });
            else {
                const wh = await workingHours();
                await task.update({ type: "call", note: "Follow up on the WhatsApp chat", due_at: addWorkingMinutes(wh, now, 8 * 60) }, { transaction: t });
            }
        }
        if (replyTasks.length) await syncNext(lead.id, t);
        const recent = await CrmActivity.findOne({ where: { lead_id: lead.id, type: "whatsapp", actor_id: s.user.id, at: { [Op.gte]: new Date(now - 30 * 60000) } }, transaction: t });
        if (!recent) {
            const { activity } = require("./leads");
            await activity(lead.id, "whatsapp", s.user.id, "Replied on WhatsApp", { chat: chat.id }, t);
        }
    });
}

async function sendText(s, id, text) {
    const chat = await getChat(s, id);
    const msg = await wa.sendText(chat, text, { sender: "user", userId: s.user.id });
    await afterHumanSend(s, chat);
    if (msg.status === "failed") throw new RuleError(`WhatsApp did not take the message: ${msg.error}`);
    return { id: Number(msg.id), status: msg.status };
}

async function sendTemplate(s, id, templateId, values) {
    const chat = await getChat(s, id);
    const tpl = await CrmWaTemplate.findByPk(Number(templateId) || 0);
    const r = await wa.sendTemplate(chat, tpl, Array.isArray(values) ? values : [], { sender: "user", userId: s.user.id });
    await afterHumanSend(s, chat);
    if (r.message.status === "failed") throw new RuleError(`WhatsApp did not take the template: ${r.message.error}`);
    return { id: Number(r.message.id), status: r.message.status };
}

const FILE_TYPES = { "image/jpeg": 5, "image/png": 5, "image/webp": 5, "application/pdf": 3.5, "video/mp4": 3.5, "audio/mpeg": 3.5, "audio/ogg": 3.5 };

async function sendFile(s, id, input = {}) {
    const chat = await getChat(s, id);
    const mime = String(input.mime || "");
    if (!FILE_TYPES[mime]) throw new RuleError("Send a photo (JPG, PNG), a PDF, an MP4 video or an MP3 / OGG audio.");
    const buf = Buffer.from(String(input.data || ""), "base64");
    if (!buf.length) throw new RuleError("The file is empty.");
    if (buf.length > 3.5 * 1024 * 1024) throw new RuleError("Files up to 3.5 MB can be sent from the panel.");
    if (!wa.windowOpen(chat)) throw new RuleError("The 24-hour window is closed. Send a template instead.");
    const url = await wa.transport.store(buf, mime, txt(input.name, 120));
    const msg = await wa.sendMedia(chat, { url, mime, fileName: txt(input.name, 120), caption: txt(input.caption, 1000) }, { sender: "user", userId: s.user.id });
    await afterHumanSend(s, chat);
    if (msg.status === "failed") throw new RuleError(`WhatsApp did not take the file: ${msg.error}`);
    return { id: Number(msg.id), status: msg.status };
}

/* ------------------------------ chat controls ------------------------------ */

async function takeOver(s, id) {
    const chat = await getChat(s, id);
    const quiet = Math.max(1, (await settings.read("whatsapp_ai")).aiQuietHoursAfterHuman);
    await chat.update({ ai_paused_until: new Date(Date.now() + quiet * 3600000) });
    await wa.note(chat, `${s.user.name} took over; the AI stays quiet for ${quiet} h`);
    return { ok: true };
}

async function letAi(s, id) {
    const chat = await getChat(s, id);
    if (chat.kind !== "lead") throw new RuleError("The AI only answers leads.");
    await chat.update({ ai_paused_until: null, ai_off: false, handover_reason: "" });
    await wa.note(chat, `${s.user.name} let the AI answer again`);
    return { ok: true };
}

async function aiOff(s, id) {
    const chat = await getChat(s, id);
    await chat.update({ ai_off: true });
    await wa.note(chat, `${s.user.name} switched the AI off in this chat`);
    return { ok: true };
}

async function markRead(s, id) {
    const chat = await getChat(s, id);
    if (chat.unread) await chat.update({ unread: 0 });
    return { ok: true };
}

async function setDone(s, id, done) {
    const chat = await getChat(s, id);
    await chat.update({ needs_reply: !done ? true : false, ...(done ? { unread: 0 } : {}) });
    return { ok: true };
}

/** A guest / customer / unknown chat becomes a lead (or joins the lead with this number). */
async function makeLead(s, id, input = {}) {
    need(s, "leads.edit");
    const chat = await getChat(s, id);
    if (chat.kind === "lead" && chat.lead_id) throw new RuleError("This chat is already a lead.");
    const intake = require("./intake");
    const first = await CrmWaMessage.findOne({ where: { chat_id: chat.id, direction: "in" }, order: [["id", "DESC"]] });
    const r = await intake.receive({ source: "whatsapp", name: txt(input.name, 120) || chat.name, phone: `+${chat.phone}`, message: first ? first.body || "" : "", fields: input.restaurant ? { restaurant_name: txt(input.restaurant, 120) } : {}, sourceDetail: { channel: "whatsapp", by: s.user.name } });
    await chat.update({ kind: "lead", lead_id: r.leadId });
    await wa.note(chat, `${s.user.name} made this chat a lead`);
    return { leadId: r.leadId };
}

async function setKind(s, id, kind) {
    need(s, "inbox.all");
    const chat = await getChat(s, id);
    if (!["guest", "customer", "other"].includes(kind)) throw new RuleError("Choose guest, customer or other.");
    await chat.update({ kind, needs_reply: false });
    await wa.note(chat, `${s.user.name} marked this chat as ${kind === "guest" ? "a restaurant's guest" : kind === "customer" ? "a BillerPe customer" : "not a lead"}`);
    return { ok: true };
}

async function setOptout(s, id, on) {
    const chat = await getChat(s, id);
    await sequelize.transaction(async (t) => {
        await wa.setOptout(chat.phone_key, !!on, { source: "manual", reason: `By ${s.user.name}`, byId: s.user.id }, t);
        await wa.note(chat, on ? `${s.user.name} stopped marketing messages to this number` : `${s.user.name} allowed marketing messages again`, t);
        if (on && chat.lead_id) await require("./cadences").stopForLead(chat.lead_id, "opted out", null, t);
    });
    return { ok: true };
}

/** The chat for a lead (lead page "WhatsApp" button); made if the lead never chatted. */
async function forLead(s, leadId) {
    canUse(s);
    const lead = await CrmLeadV2.findByPk(Number(leadId) || 0);
    if (!lead || lead.deleted_at || !(await scope.canSee(s, lead))) throw new RuleError("This lead is not visible to you.");
    if (!lead.phone_valid) throw new RuleError("This lead's number cannot get WhatsApp messages.");
    const chat = await wa.chatFor(lead.phone, { name: lead.name });
    if (chat.lead_id !== lead.id) await chat.update({ lead_id: lead.id, kind: "lead" });
    return { chatId: chat.id };
}

/** What the inbox and settings show about this server. */
async function status(s) {
    canUse(s);
    return { ...ai.status(), aiEnabled: await aiEnabled() };
}

module.exports = { list, waiting, detail, sendText, sendTemplate, sendFile, takeOver, letAi, aiOff, markRead, setDone, makeLead, setKind, setOptout, forLead, status, VIEWS };
