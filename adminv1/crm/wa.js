const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const { Op } = require("sequelize");
const {
    sequelize, CrmWaChat, CrmWaMessage, CrmWaTemplate, CrmWaOptout, CrmLeadV2, CrmCampaignRcpt, AdmUser, Hotel, HotelUser, User,
} = require("../../model");
const { RuleError } = require("../../appv1/core");
const queue = require("../../services/admin/queue");
const settings = require("../settings");
const config = require("./config");
const { normalizePhone, moment, TZ, txt, parse } = require("./util");

// The WhatsApp side of the CRM: one chat per number, every message in and
// out, Meta-approved templates, opt-outs and the 24-hour rule.
//
// One WhatsApp number serves BillerPe's bills, OTPs and the sales inbox
// (owner, 7 Oct 2026). So a message from a restaurant's guest or one of our
// customers must never get the sales AI: classify() decides who wrote.
//
// Sending really reaches Meta only when ADMIN_WA_LIVE=1. Otherwise every send
// is stored as "simulated" and nothing leaves the server (local copies, tests,
// UAT). The panel shows which mode the server is in.

const GRAPH = "https://graph.facebook.com/v22.0";
const WINDOW_MS = 24 * 3600 * 1000;
const live = () => process.env.ADMIN_WA_LIVE === "1";

/* ------------------------------ transport ------------------------------ */

const errOf = (e) => String(e?.response?.data?.error?.message || e?.message || e || "WhatsApp error").slice(0, 300);

/** Talks to Meta (live) or pretends to (simulated). Tests replace it. */
const transport = {
    async send(body) {
        if (!live()) return { waId: `sim.${crypto.randomUUID()}`, simulated: true };
        const res = await axios.post(`${GRAPH}/${process.env.WHATSAPPPHONEID}/messages`, body, {
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.WHATSAPPTOKEN}` },
            timeout: 20000,
        });
        const waId = res.data?.messages?.[0]?.id;
        if (!waId) throw new Error("WhatsApp did not return a message id");
        return { waId, simulated: false };
    },
    /** An inbound photo / voice note / file -> { buffer, mime }. */
    async fetchMedia(mediaId) {
        if (!live()) return null;
        const auth = { Authorization: `Bearer ${process.env.WHATSAPPTOKEN}` };
        const meta = await axios.get(`${GRAPH}/${mediaId}`, { headers: auth, timeout: 20000 });
        const file = await axios.get(meta.data.url, { headers: auth, responseType: "arraybuffer", timeout: 60000 });
        return { buffer: Buffer.from(file.data), mime: meta.data.mime_type || file.headers["content-type"] || "application/octet-stream" };
    },
    /** Keeps a file where WhatsApp (and the panel) can fetch it -> public URL. */
    async store(buffer, mime, name) {
        const ext = (path.extname(String(name || "")) || `.${String(mime || "").split("/")[1] || "bin"}`).replace(/[^.\w]/g, "").slice(0, 8);
        const key = `crm-wa/${moment().tz(TZ).format("YYYY/MM")}/${Date.now()}-${crypto.randomBytes(5).toString("hex")}${ext}`;
        if (live()) {
            const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
            const bucket = process.env.ADMIN_FILES_BUCKET || "bpe-upload-data";
            const region = process.env.ADMIN_FILES_REGION || "ap-south-1";
            await new S3Client({ region }).send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: buffer, ContentType: mime, ACL: "public-read" }));
            return `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
        }
        const file = path.join(__dirname, "../../public", key);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, buffer);
        return `/${key}`;
    },
};

/* ------------------------------ helpers ------------------------------ */

/** "+919876543210" / "09876543210" -> { digits: "919876543210", key } or null. */
function waNumber(raw) {
    const p = normalizePhone(raw);
    if (!p.valid) return null;
    return { digits: p.phone.replace(/\D/g, ""), key: p.key, phone: p.phone };
}

const windowOpen = (chat, now = Date.now()) => !!chat.last_in_at && now - new Date(chat.last_in_at).getTime() < WINDOW_MS;
const windowEndsAt = (chat) => (chat.last_in_at ? new Date(new Date(chat.last_in_at).getTime() + WINDOW_MS) : null);

async function optedOut(phoneKey, t) {
    return !!(await CrmWaOptout.findOne({ where: { phone_key: phoneKey }, transaction: t }));
}

/** Template sending hours (whatsapp_ai setting, India time). */
async function templateWindow(now = new Date()) {
    const w = await settings.read("whatsapp_ai");
    const m = moment(now).tz(TZ);
    const at = (hhmm, day = m) => {
        const [h, mi] = hhmm.split(":").map(Number);
        return day.clone().hour(h).minute(mi).second(0).millisecond(0);
    };
    const from = at(w.templateFrom);
    const to = at(w.templateTo);
    if (m.isBefore(from)) return { open: false, nextOpen: from.toDate() };
    if (!m.isBefore(to)) return { open: false, nextOpen: at(w.templateFrom, m.clone().add(1, "day")).toDate() };
    return { open: true, nextOpen: now };
}

/** Marketing templates sent to this chat since the start of today (India time). */
async function autoTemplatesToday(chatId, now = new Date(), t) {
    const start = moment(now).tz(TZ).startOf("day").toDate();
    return CrmWaMessage.count({ where: { chat_id: chatId, kind: "template", sender: ["rule", "cadence", "campaign"], at: { [Op.gte]: start }, status: { [Op.ne]: "failed" } }, transaction: t });
}

/** Fills a template's {{n}} for the panel's copy of what was sent. */
function fillBody(body, values) {
    return String(body || "").replace(/\{\{(\d+)\}\}/g, (m, n) => (values[Number(n) - 1] !== undefined ? String(values[Number(n) - 1]) : m));
}

/** Values for a template's params from the lead and its owner. */
async function paramValues(template, { lead = null, owner = null, overrides = [] } = {}) {
    const defs = parse(template.params) || [];
    return defs.map((p, i) => {
        if (overrides[i] !== undefined && overrides[i] !== null && String(overrides[i]).trim() !== "") return String(overrides[i]).slice(0, 200);
        const first = (n) => String(n || "").trim().split(/\s+/)[0] || "";
        switch (p.source) {
            case "lead.name": return first(lead?.name) || "Sir";
            case "lead.restaurant": return lead?.restaurant_name || lead?.name || "your restaurant";
            case "owner.name": return first(owner?.name) || "BillerPe team";
            case "owner.mobile": return owner?.mobile ? `+91 ${owner.mobile}` : "";
            default: return String(p.value ?? "").slice(0, 200);
        }
    });
}

/* ------------------------------ who wrote ------------------------------ */

const like = (key) => ({ [Op.like]: `%${key}` });

/**
 * Who a number belongs to, in this order: a lead, our own staff, a BillerPe
 * customer (restaurant owner or staff), a restaurant's guest. null = nobody
 * we know (a new prospect).
 */
async function classify(phoneKey, t) {
    if (!phoneKey || phoneKey.length < 10) return { kind: "other" };
    const lead = await CrmLeadV2.findOne({ where: { phone_key: phoneKey, deleted_at: null, merged_into_id: null }, order: [["id", "DESC"]], transaction: t });
    if (lead) return { kind: "lead", leadId: lead.id };
    if (await AdmUser.findOne({ where: { mobile: phoneKey }, attributes: ["id"], transaction: t })) return { kind: "staff" };
    const hotel = await Hotel.findOne({ where: { [Op.or]: [{ owner_number: like(phoneKey) }, { contact1: like(phoneKey) }, { contact2: like(phoneKey) }] }, attributes: ["id", "hotel_name"], transaction: t });
    if (hotel) return { kind: "customer", hotelId: hotel.id, label: hotel.hotel_name || "" };
    const hotelUser = await HotelUser.findOne({ where: { number: like(phoneKey) }, attributes: ["hotel_id"], transaction: t });
    if (hotelUser) {
        const h = await Hotel.findByPk(hotelUser.hotel_id, { attributes: ["id", "hotel_name"], transaction: t });
        return { kind: "customer", hotelId: hotelUser.hotel_id, label: h ? h.hotel_name || "" : "" };
    }
    const guest = await User.findOne({ where: { number: like(phoneKey) }, attributes: ["hotel_id"], order: [["id", "DESC"]], transaction: t });
    if (guest) {
        const h = guest.hotel_id ? await Hotel.findByPk(guest.hotel_id, { attributes: ["id", "hotel_name"], transaction: t }) : null;
        return { kind: "guest", hotelId: guest.hotel_id || null, label: h ? h.hotel_name || "" : "" };
    }
    return null;
}

/** The chat for a number, made on first use. */
async function chatFor(raw, { name = "" } = {}, t) {
    const n = waNumber(raw);
    if (!n) throw new RuleError("This number cannot get WhatsApp messages.");
    let chat = await CrmWaChat.findOne({ where: { phone_key: n.key }, transaction: t });
    if (chat) return chat;
    const who = (await classify(n.key, t)) || { kind: "lead" };
    try {
        chat = await CrmWaChat.create({ phone: n.digits, phone_key: n.key, name: txt(name, 120), kind: who.kind, label: who.label || "", lead_id: who.leadId || null, hotel_id: who.hotelId || null }, { transaction: t });
    } catch (e) {
        if (e.name !== "SequelizeUniqueConstraintError") throw e;
        chat = await CrmWaChat.findOne({ where: { phone_key: n.key }, transaction: t });
    }
    return chat;
}

/** Points a number's chat at a lead (a lead was made or merged). */
async function linkLead(phoneKey, leadId, t) {
    if (!phoneKey) return;
    await CrmWaChat.update({ lead_id: leadId, kind: "lead" }, { where: { phone_key: phoneKey }, transaction: t });
}

/* ------------------------------ sending ------------------------------ */

const preview = (s) => String(s || "").replace(/\s+/g, " ").trim().slice(0, 200);

async function record(chat, fields, t) {
    const at = fields.at || new Date();
    const msg = await CrmWaMessage.create({ chat_id: chat.id, at, ...fields }, { transaction: t });
    const patch = { last_message_at: at, preview: preview(fields.kind === "note" ? chat.preview : fields.body || `[${fields.kind}]`) };
    if (fields.direction === "out" && fields.kind !== "note") {
        patch.last_out_at = at;
        if (["user", "ai"].includes(fields.sender)) patch.needs_reply = false;
    }
    if (fields.kind === "note") delete patch.last_message_at;
    await CrmWaChat.update(patch, { where: { id: chat.id }, transaction: t });
    return msg;
}

/** Sends a prepared Meta payload for a stored "queued" message and stores the result. */
async function deliver(msg, body) {
    let r;
    try {
        r = await transport.send(body);
    } catch (e) {
        await msg.update({ status: "failed", error: errOf(e) });
        return msg;
    }
    await msg.update({ wa_id: r.waId, status: r.simulated ? "simulated" : "sent", error: null });
    return msg;
}

/** A free-text reply. Only inside the 24-hour window. */
async function sendText(chat, text, { sender = "user", userId = null } = {}) {
    const body = String(text || "").trim().slice(0, 4000);
    if (!body) throw new RuleError("Type a message first.");
    if (!windowOpen(chat)) throw new RuleError("The 24-hour window is closed: they have not written in the last 24 hours. Send a template instead.");
    const msg = await record(chat, { direction: "out", kind: "text", body, sender, user_id: userId, status: "queued" });
    return deliver(msg, { messaging_product: "whatsapp", to: chat.phone, type: "text", text: { body, preview_url: true } });
}

/**
 * A question with up to 3 reply buttons (the ticket rating). Only inside
 * the window; the answer comes back as an ordinary message with the
 * button's title as its text.
 */
async function sendButtons(chat, text, buttons, { sender = "user", userId = null } = {}) {
    const body = String(text || "").trim().slice(0, 1000);
    if (!windowOpen(chat)) throw new RuleError("The 24-hour window is closed. Send a template instead.");
    const list = (buttons || []).slice(0, 3).map((b) => ({ type: "reply", reply: { id: txt(b.id, 200), title: txt(b.title, 20) } }));
    const shown = [body, list.map((b) => `[${b.reply.title}]`).join(" ")].join("\n");
    const msg = await record(chat, { direction: "out", kind: "text", body: shown, sender, user_id: userId, status: "queued" });
    return deliver(msg, { messaging_product: "whatsapp", to: chat.phone, type: "interactive", interactive: { type: "button", body: { text: body }, action: { buttons: list } } });
}

const MEDIA_KIND = (mime) => (/^image\//.test(mime) ? "image" : /^video\//.test(mime) ? "video" : /^audio\//.test(mime) ? "audio" : "document");

/** A photo, video, voice note or file (by public URL). Only inside the window. */
async function sendMedia(chat, { url, mime, fileName = "", caption = "" }, { sender = "user", userId = null } = {}) {
    if (!windowOpen(chat)) throw new RuleError("The 24-hour window is closed. Send a template instead.");
    const kind = MEDIA_KIND(mime);
    const msg = await record(chat, { direction: "out", kind, body: txt(caption, 1000) || null, media_url: url, mime_type: mime, file_name: txt(fileName, 200), sender, user_id: userId, status: "queued" });
    const link = /^https?:/.test(url) ? url : `${process.env.ADMIN_PUBLIC_URL || ""}${url}`;
    const media = { link, ...(caption && kind !== "audio" ? { caption: txt(caption, 1000) } : {}), ...(kind === "document" && fileName ? { filename: txt(fileName, 200) } : {}) };
    return deliver(msg, { messaging_product: "whatsapp", to: chat.phone, type: kind, [kind]: media });
}

/**
 * A Meta-approved template (allowed at any time). Automatic senders (rule,
 * cadence, campaign) also respect opt-outs, the sending hours and one
 * marketing template per lead per day: they get { skipped, reason, retryAt }
 * instead of an error so the worker can try again later.
 */
async function sendTemplate(chat, template, values, { sender = "user", userId = null, campaignId = null, enrollmentId = null, now = new Date() } = {}) {
    if (!template || !template.active) throw new RuleError("Choose an active template.");
    const defs = parse(template.params) || [];
    const vals = (values || []).map((v) => String(v ?? "").slice(0, 200));
    const auto = ["rule", "cadence", "campaign"].includes(sender);
    if (vals.length !== defs.length || vals.some((v) => !v.trim())) {
        if (auto) return { skipped: true, reason: `template ${template.name} has a value with no text (set it in Templates)` };
        throw new RuleError(`This template needs ${defs.length} value${defs.length === 1 ? "" : "s"}.`);
    }
    if (await optedOut(chat.phone_key)) {
        if (auto) return { skipped: true, reason: "opted out" };
        throw new RuleError("This number asked not to get WhatsApp messages from us (opt-out).");
    }
    if (auto) {
        if (chat.kind !== "lead") return { skipped: true, reason: `not a lead (${chat.kind})` };
        const w = await templateWindow(now);
        if (!w.open) return { skipped: true, reason: "outside sending hours", retryAt: w.nextOpen };
        if ((await autoTemplatesToday(chat.id, now)) >= 1) {
            const w2 = await templateWindow(moment(now).tz(TZ).add(1, "day").startOf("day").toDate());
            return { skipped: true, reason: "already got an automatic message today", retryAt: w2.nextOpen };
        }
    }
    const filled = fillBody(template.body, vals) || `[Template: ${template.name}]${vals.length ? ` ${vals.join(", ")}` : ""}`;
    const msg = await record(chat, {
        direction: "out", kind: "template", body: filled, template_id: template.id, template_name: template.name, params: JSON.stringify(vals),
        media_url: template.header_image || null, sender, user_id: userId, status: "queued", campaign_id: campaignId, enrollment_id: enrollmentId, at: now,
    });
    const components = [];
    if (template.header_image) components.push({ type: "header", parameters: [{ type: "image", image: { link: template.header_image } }] });
    if (vals.length) components.push({ type: "body", parameters: vals.map((v) => ({ type: "text", text: v })) });
    await deliver(msg, { messaging_product: "whatsapp", to: chat.phone, type: "template", template: { name: template.name, language: { code: template.language || "en" }, components } });
    return { message: msg };
}

/** An internal line in the chat (never sent): "AI set a call for 14:00". */
async function note(chat, body, t) {
    return record(chat, { direction: "out", kind: "note", body: txt(body, 1000), sender: "system", status: "sent" }, t);
}

/* ------------------------------ opt-outs ------------------------------ */

const STOP_WORDS = new Set(["STOP", "STOP ALL", "UNSUBSCRIBE", "OPT OUT", "OPTOUT"]);
const START_WORDS = new Set(["START", "UNSTOP", "SUBSCRIBE"]);

async function setOptout(phoneKey, on, { source = "manual", reason = "", byId = null } = {}, t) {
    if (on) {
        if (!(await optedOut(phoneKey, t))) await CrmWaOptout.create({ phone_key: phoneKey, source, reason: txt(reason, 200), by_id: byId, at: new Date() }, { transaction: t });
    } else {
        await CrmWaOptout.destroy({ where: { phone_key: phoneKey }, transaction: t });
    }
}

/* ------------------------------ inbound (webhook) ------------------------------ */

const STATUS_RANK = { queued: 0, simulated: 1, sent: 1, delivered: 2, read: 3, failed: 4 };

function inboundText(m) {
    switch (m.type) {
        case "text": return m.text?.body || "";
        case "image": return m.image?.caption || "";
        case "video": return m.video?.caption || "";
        case "document": return m.document?.caption || m.document?.filename || "";
        case "location": return [m.location?.name, m.location?.address, m.location ? `${m.location.latitude},${m.location.longitude}` : ""].filter(Boolean).join(" · ");
        case "reaction": return m.reaction?.emoji ? `Reacted ${m.reaction.emoji}` : "Reacted";
        case "button": return m.button?.text || "";
        case "interactive": return m.interactive?.button_reply?.title || m.interactive?.list_reply?.title || "";
        case "contacts": return (m.contacts || []).map((c) => `${c.name?.formatted_name || ""} ${(c.phones || []).map((p) => p.phone).join(" ")}`.trim()).join("; ");
        default: return "";
    }
}
const KINDS = new Set(["text", "image", "video", "audio", "document", "sticker", "location", "reaction"]);

/** A delivery tick for something we sent (ignored for bills/OTPs and other senders). */
async function applyStatus(st) {
    const status = st.status === "failed" ? "failed" : st.status;
    if (!(status in STATUS_RANK)) return;
    const msg = await CrmWaMessage.findOne({ where: { wa_id: st.id } });
    if (msg && STATUS_RANK[status] > (STATUS_RANK[msg.status] ?? 0)) {
        await msg.update({ status, error: status === "failed" ? errOf({ message: st.errors?.[0]?.title || st.errors?.[0]?.message || "Failed" }) : msg.error });
    }
    const at = st.timestamp ? new Date(Number(st.timestamp) * 1000) : new Date();
    const r = await CrmCampaignRcpt.findOne({ where: { wa_id: st.id } });
    if (r) {
        const patch = {};
        if (status === "delivered" && !r.delivered_at) patch.delivered_at = at;
        if (status === "read") Object.assign(patch, { read_at: r.read_at || at, delivered_at: r.delivered_at || at });
        if (STATUS_RANK[status] > (STATUS_RANK[r.status] ?? 0)) patch.status = status;
        if (status === "failed") patch.error = errOf({ message: st.errors?.[0]?.title || "Failed" });
        if (Object.keys(patch).length) await r.update(patch);
    }
}

/**
 * One inbound message from the webhook. Stores it (once, by WhatsApp id),
 * makes or reopens the lead for an unknown number, and queues the AI reply,
 * the media download and the automation event. Returns { chat, message } or
 * null for a repeat delivery.
 */
async function receiveMessage(m, contact) {
    const n = waNumber(m.from);
    if (!n) return null;
    if (await CrmWaMessage.findOne({ where: { wa_id: m.id }, attributes: ["id"] })) return null;
    const at = m.timestamp ? new Date(Number(m.timestamp) * 1000) : new Date();
    const kind = KINDS.has(m.type) ? m.type : "text";
    const body = inboundText(m) || (m.type === "unsupported" ? "[A message type WhatsApp could not show]" : "");
    const media = ["image", "video", "audio", "document", "sticker"].includes(m.type) ? m[m.type] : null;
    const profile = txt(contact?.profile?.name, 120);
    const word = String(body).trim().toUpperCase();

    let chat = await chatFor(n.digits, { name: profile });
    if (profile && chat.name !== profile) await chat.update({ name: profile });

    // A new prospect (or a closed lead) writing in becomes a lead / reopens.
    let leadEvent = null;
    if (chat.kind === "lead" && !STOP_WORDS.has(word)) {
        const lead = chat.lead_id ? await CrmLeadV2.findByPk(chat.lead_id) : null;
        const c = await config.load();
        const stageKind = lead ? c.stageById.get(lead.stage_id)?.kind : null;
        if (!lead || lead.deleted_at || lead.merged_into_id || stageKind === "lost") {
            const intake = require("./intake");
            const r = await intake.receive({ source: "whatsapp", name: profile, phone: n.phone, message: body || `[${kind}]`, receivedAt: at, sourceDetail: { channel: "whatsapp" } });
            if (r && r.leadId) {
                await chat.update({ lead_id: r.leadId, kind: "lead" });
                leadEvent = r.created ? "created" : r.reopened ? "reopened" : "joined";
            }
        }
    }

    const result = await sequelize.transaction(async (t) => {
        let msg;
        try {
            msg = await CrmWaMessage.create({
                chat_id: chat.id, wa_id: m.id, direction: "in", kind, body: body || null, media_id: media?.id || null, mime_type: media?.mime_type || null,
                file_name: m.document?.filename ? txt(m.document.filename, 200) : null, sender: "customer", status: "received", at,
            }, { transaction: t });
        } catch (e) {
            if (e.name === "SequelizeUniqueConstraintError") return null;
            throw e;
        }
        await CrmWaChat.update(
            { last_in_at: at, last_message_at: at, preview: preview(body || `[${kind}]`), unread: sequelize.literal("unread + 1"), needs_reply: kind !== "reaction", status: "open" },
            { where: { id: chat.id }, transaction: t },
        );
        if (STOP_WORDS.has(word)) {
            await setOptout(n.key, true, { source: "keyword", reason: `Wrote "${body.trim().slice(0, 40)}"` }, t);
            await note(chat, "They asked not to get marketing messages (opt-out). Cadences and campaigns will skip this number.", t);
        } else if (START_WORDS.has(word)) {
            await setOptout(n.key, false, {}, t);
            await note(chat, "They opted back in to WhatsApp messages.", t);
        }
        await queue.emit({ type: "wa.received", entity: "crm_wa_chat", entityId: chat.id, data: { messageId: msg.id, leadId: chat.lead_id, kind: chat.kind, msgKind: kind, leadEvent, optout: STOP_WORDS.has(word) }, actorId: null }, { transaction: t });
        if (media?.id) await queue.enqueue({ kind: "wa.media", payload: { messageId: msg.id }, dedupeKey: `wa.media:${msg.id}` }, { transaction: t });
        return msg;
    });
    if (!result) return null;
    chat = await CrmWaChat.findByPk(chat.id);
    return { chat, message: result, leadEvent };
}

/** Meta's webhook body (whatsapp_business_account). */
async function handleWebhook(body) {
    const out = { messages: 0, statuses: 0 };
    if (!body || body.object !== "whatsapp_business_account") return out;
    for (const entry of body.entry || []) {
        for (const change of entry.changes || []) {
            const v = change.value || {};
            for (const st of v.statuses || []) {
                await applyStatus(st);
                out.statuses += 1;
            }
            for (const m of v.messages || []) {
                const contact = (v.contacts || []).find((c) => c.wa_id === m.from) || (v.contacts || [])[0];
                const r = await receiveMessage(m, contact);
                if (r) {
                    out.messages += 1;
                    await afterInbound(r);
                }
            }
        }
    }
    return out;
}

/** Hooks other modules add (the AI reply, notifications). */
const inboundHooks = [];
const onInbound = (fn) => inboundHooks.push(fn);
async function afterInbound(r) {
    for (const fn of inboundHooks) {
        try {
            await fn(r);
        } catch (e) {
            console.error("[crm wa] inbound hook:", e && e.message);
        }
    }
}

/** Downloads an inbound photo / file from Meta and keeps a copy (job wa.media). */
async function fetchInboundMedia(messageId) {
    const msg = await CrmWaMessage.findByPk(messageId);
    if (!msg || !msg.media_id || msg.media_url) return "nothing to fetch";
    const got = await transport.fetchMedia(msg.media_id);
    if (!got) return "simulated (no download)";
    const url = await transport.store(got.buffer, got.mime, msg.file_name || "");
    await msg.update({ media_url: url, mime_type: got.mime });
    return "stored";
}

module.exports = {
    transport, live, waNumber, windowOpen, windowEndsAt, optedOut, setOptout, templateWindow, autoTemplatesToday, fillBody, paramValues,
    classify, chatFor, linkLead, record, sendText, sendButtons, sendMedia, sendTemplate, note, receiveMessage, handleWebhook, applyStatus, onInbound, fetchInboundMedia, STOP_WORDS,
};
