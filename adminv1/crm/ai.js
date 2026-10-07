const { Op } = require("sequelize");
const { sequelize, CrmWaChat, CrmWaMessage, CrmLeadV2, CrmTaskV2, AdmUser } = require("../../model");
const { RuleError } = require("../../appv1/core");
const queue = require("../../services/admin/queue");
const worker = require("../../services/admin/worker");
const settings = require("../settings");
const { need } = require("../auth");
const config = require("./config");
const wa = require("./wa");
const { notify, peopleWith } = require("./notify");
const { addTask, syncNext } = require("./tasks");
const { workingHours, isWorkingTime, addWorkingMinutes, moment, TZ, txt } = require("./util");

// The WhatsApp AI assistant, inside the CRM (it used to be a separate service
// that never saw the salesperson's replies). It answers lead chats all day
// (owner, 7 Oct 2026), steps back for aiQuietHoursAfterHuman hours once a
// person replies in a chat, books calls into the owner's tasks, fills empty
// business details and hands over anything about money or problems.
//
// Claude is called only with ANTHROPIC_API_KEY set; ADMIN_AI_FAKE=1 gives a
// fixed local answer instead (tests, UAT without a key).

const API = "https://api.anthropic.com/v1/messages";

/* ------------------------------ when the AI answers ------------------------------ */

/** Why the AI will not answer this chat right now, or null if it will. */
async function blockedReason(chat, ai, now = new Date()) {
    if (!ai.enabled) return "The AI assistant is switched off";
    if (chat.kind !== "lead") return `Not a lead (${chat.kind})`;
    const w = await settings.read("whatsapp_ai");
    if (!w.aiAllDay && isWorkingTime(await workingHours(), now)) return "During working hours a person answers";
    if (chat.ai_off) return "AI switched off in this chat";
    if (chat.ai_paused_until && new Date(chat.ai_paused_until) > now) return "A person is handling this chat";
    if (!chat.lead_id) return "No lead";
    const lead = await CrmLeadV2.findByPk(chat.lead_id, { attributes: ["id", "stage_id"] });
    const c = await config.load();
    if (lead && c.stageById.get(lead.stage_id)?.kind === "won") return "Already a customer";
    if (await wa.optedOut(chat.phone_key)) return "Opted out";
    return null;
}

/** Inbound hook (wa.onInbound): queue the AI reply, or tell a person. */
async function onInbound({ chat, message }) {
    const ai = await settings.read("ai_assistant");
    if (message.kind === "reaction") return;
    const blocked = await blockedReason(chat, ai);
    const media = !["text", "location"].includes(message.kind);
    if (!blocked && !media) {
        await queue.enqueue({ kind: "wa.ai", payload: { chatId: chat.id, messageId: Number(message.id) }, runAt: new Date(Date.now() + ai.delaySeconds * 1000), dedupeKey: `wa.ai:${message.id}`, maxAttempts: 2 });
        return;
    }
    // A photo or voice note (often a payment screenshot) or a chat the AI must not answer: a person replies.
    const why = !blocked && media ? `Sent ${message.kind === "audio" ? "a voice note" : `a${message.kind === "image" ? "n image" : ` ${message.kind}`}`}` : null;
    await needsPerson(chat, why || "", { silentReason: !!blocked && !media });
}

/**
 * A person must answer this chat: tell the lead's owner (or the people who
 * see every chat, for guests and customers) and, for a lead, make sure there
 * is a "Reply on WhatsApp" task.
 */
async function needsPerson(chat, reason = "", { silentReason = false, handover = false } = {}) {
    const who = chat.name || `+${chat.phone}`;
    const hourRef = moment().tz(TZ).format("YYYYMMDDHH");
    if (chat.kind === "lead" && chat.lead_id) {
        const lead = await CrmLeadV2.findByPk(chat.lead_id);
        if (!lead) return;
        const c = await config.load();
        const open = c.stageById.get(lead.stage_id)?.kind === "open";
        const automation = require("./automation");
        if (open && (handover || (await automation.ruleOn("wa_reply_task")))) {
            await sequelize.transaction(async (t) => {
                const has = await CrmTaskV2.findOne({ where: { lead_id: lead.id, status: "open", type: "whatsapp" }, transaction: t });
                if (!has) {
                    const wh = await workingHours();
                    await addTask({ leadId: lead.id, ownerId: lead.owner_id, type: "whatsapp", dueAt: addWorkingMinutes(wh, new Date(), 0), note: `Reply on WhatsApp${reason ? `: ${reason}` : ""}`.slice(0, 300), origin: "rule" }, t);
                    await syncNext(lead.id, t);
                }
            });
        }
        const to = lead.owner_id ? [lead.owner_id] : (await peopleWith("leads.assign")).map((p) => p.id);
        for (const id of to) {
            await notify(id, { type: handover ? "wa.handover" : "wa.message", title: handover ? `AI handed over: ${who}` : `WhatsApp from ${who}`, body: reason || chat.preview || "", link: `/inbox/${chat.id}`, ref: `wa:${chat.id}:${handover ? "h" : "m"}:${hourRef}` });
        }
        return;
    }
    if (silentReason && chat.kind === "staff") return;
    for (const p of await peopleWith("inbox.all")) {
        await notify(p.id, { type: "wa.message", title: `WhatsApp from ${who}${chat.label ? ` (${chat.label})` : ""}`, body: `${chat.kind === "guest" ? "A restaurant's guest" : chat.kind === "customer" ? "A BillerPe customer" : "Not a lead"}: ${chat.preview || ""}`.slice(0, 400), link: `/inbox/${chat.id}`, ref: `wa:${chat.id}:m:${hourRef}` });
    }
}

/* ------------------------------ talking to Claude ------------------------------ */

/** The chat as Claude messages: theirs = user, ours (AI, people, templates) = assistant. */
function conversation(messages, names) {
    const out = [];
    for (const m of messages) {
        if (m.kind === "note") continue;
        const role = m.direction === "in" ? "user" : "assistant";
        let text = m.body || "";
        if (m.direction === "in" && m.kind !== "text") text = `[sent ${m.kind === "audio" ? "a voice note" : `a ${m.kind}`}]${text ? ` ${text}` : ""}`;
        if (m.direction === "out" && m.kind === "template") text = `[WhatsApp template we sent] ${text}`;
        if (m.direction === "out" && m.sender === "user") text = `[${names.get(m.user_id) || "Salesperson"}, a person on our team, wrote] ${text}`;
        if (m.direction === "out" && m.kind !== "text" && m.kind !== "template") text = `[we sent a ${m.kind}] ${text}`;
        if (!text.trim()) continue;
        const last = out[out.length - 1];
        if (last && last.role === role) last.content += `\n${text}`;
        else out.push({ role, content: text });
    }
    if (out.length && out[0].role === "assistant") out.unshift({ role: "user", content: "(earlier messages)" });
    return out;
}

function systemPrompt(ai, { lead, owner, now, wh }) {
    const m = moment(now).tz(TZ);
    const nextOpen = isWorkingTime(wh, now) ? "now" : moment(addWorkingMinutes(wh, now, 0)).tz(TZ).format("dddd D MMM, h:mm A");
    const facts = [
        `Customer name: ${lead?.name || "unknown"}`,
        lead?.restaurant_name ? `Restaurant: ${lead.restaurant_name}` : null,
        lead?.city ? `City: ${lead.city}` : null,
        lead?.business_type ? `Business type: ${lead.business_type}` : null,
        lead?.outlets_count ? `Outlets: ${lead.outlets_count}` : null,
        lead?.tables_count ? `Tables: ${lead.tables_count}` : null,
        lead?.current_software ? `Uses today: ${lead.current_software}` : null,
        `Their salesperson: ${(owner?.name || "our sales team").split(/\s+/)[0]}`,
        `Time now in India: ${m.format("dddd D MMM YYYY, h:mm A")}`,
        `Sales team works ${wh.start} to ${wh.end}, ${wh.days.length === 6 && !wh.days.includes(0) ? "Monday to Saturday" : "on working days"}. Next working time: ${nextOpen}.`,
    ].filter(Boolean);
    const kb = (ai.knowledge || []).map((k) => `## ${k.topic}\n${k.answer}`).join("\n\n");
    return `${ai.instructions}

WHAT WE KNOW ABOUT THIS CUSTOMER
${facts.join("\n")}

KNOWLEDGE (the only facts you may use)
${kb}

ANSWER FORMAT
Answer with one JSON object and nothing else:
{"reply": "the WhatsApp message to send", "handover": false, "handover_reason": "", "call": {"wanted": false, "at": ""}, "details": {"restaurant_name": "", "city": "", "business_type": "", "outlets_count": null, "tables_count": null, "current_software": "", "plan_interest": ""}}
Fill "details" only with what the customer said in this chat. business_type is one of: ${config.BUSINESS_TYPES.join(", ")}. plan_interest is "Suite" or "POS App" or "".`;
}

function parseAnswer(raw) {
    const s = String(raw || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
    const start = s.indexOf("{");
    const end = s.lastIndexOf("}");
    try {
        const j = JSON.parse(start >= 0 ? s.slice(start, end + 1) : s);
        return { reply: txt(j.reply, 3000), handover: !!j.handover, handoverReason: txt(j.handover_reason, 200), call: j.call && j.call.wanted ? { at: txt(j.call.at, 20) } : null, details: j.details && typeof j.details === "object" ? j.details : {} };
    } catch {
        return { reply: txt(s, 3000), handover: false, handoverReason: "", call: null, details: {} };
    }
}

/** A canned answer for tests and servers without an API key (ADMIN_AI_FAKE=1). */
function fakeAnswer(history) {
    const last = [...history].reverse().find((m) => m.role === "user");
    const text = String(last ? last.content : "").toLowerCase();
    if (/discount|refund|cod|paid|payment/.test(text)) return { reply: "Thank you! Your salesperson will reply to you here in a few minutes.", handover: true, handoverReason: "Asked about money (discount / payment)", call: null, details: {} };
    const details = {};
    const outlets = text.match(/(\d+)\s*outlets?/);
    if (outlets) details.outlets_count = Number(outlets[1]);
    const tables = text.match(/(\d+)\s*tables?/);
    if (tables) details.tables_count = Number(tables[1]);
    if (/\bcafe|café/.test(text)) details.business_type = "Cafe";
    const call = /call me/.test(text) ? { at: (text.match(/(\d{4}-\d{2}-\d{2} \d{2}:\d{2})/) || [])[1] || "" } : null;
    return { reply: `Thanks for your message! (test AI reply)${call ? " Your salesperson will call you." : " Which city is your restaurant in?"}`, handover: false, handoverReason: "", call, details };
}

async function callClaude(ai, system, messages) {
    if (process.env.ADMIN_AI_FAKE === "1") return fakeAnswer(messages);
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) throw new RuleError("The AI has no API key on this server (ANTHROPIC_API_KEY).");
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 45000);
    try {
        const res = await fetch(API, {
            method: "POST",
            headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
            body: JSON.stringify({ model: ai.model, max_tokens: 800, system, messages }),
            signal: ctrl.signal,
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(`AI ${res.status}: ${body?.error?.message || res.statusText}`.slice(0, 300));
        const text = (body.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
        return parseAnswer(text);
    } finally {
        clearTimeout(timer);
    }
}

/* ------------------------------ the reply job ------------------------------ */

const DETAIL_FIELDS = { restaurant_name: 120, city: 60, current_software: 80 };

/** Fills only empty business details from what the AI noted. Returns the labels filled. */
async function fillDetails(lead, d, t) {
    const patch = {};
    const said = [];
    for (const [k, n] of Object.entries(DETAIL_FIELDS)) {
        const v = txt(d[k], n);
        if (v && !lead[k]) {
            patch[k] = v;
            said.push(v);
        }
    }
    if (d.business_type && config.BUSINESS_TYPES.includes(d.business_type) && !lead.business_type) {
        patch.business_type = d.business_type;
        said.push(d.business_type);
    }
    for (const k of ["outlets_count", "tables_count"]) {
        const v = Number(d[k]);
        if (Number.isInteger(v) && v > 0 && v < 10000 && !lead[k]) {
            patch[k] = v;
            said.push(`${v} ${k === "outlets_count" ? "outlet" : "table"}${v === 1 ? "" : "s"}`);
        }
    }
    if (["Suite", "POS App"].includes(d.plan_interest) && !lead.plan_interest) {
        patch.plan_interest = d.plan_interest;
        said.push(`interested in ${d.plan_interest}`);
    }
    if (Object.keys(patch).length) await lead.update(patch, { transaction: t });
    return said;
}

/** When the AI booked a call: their time if it is a working time, else the next one. */
function callTime(wh, at, now) {
    const m = at ? moment.tz(at, "YYYY-MM-DD HH:mm", true, TZ) : null;
    if (m && m.isValid() && m.toDate() > now) return isWorkingTime(wh, m.toDate()) ? m.toDate() : addWorkingMinutes(wh, m.toDate(), 0);
    return addWorkingMinutes(wh, now, 10);
}

async function replyJob({ chatId, messageId }, job) {
    const now = new Date();
    const ai = await settings.read("ai_assistant");
    let chat = await CrmWaChat.findByPk(chatId);
    if (!chat) return "chat gone";
    const latest = await CrmWaMessage.findOne({ where: { chat_id: chat.id, kind: { [Op.ne]: "note" } }, order: [["id", "DESC"]] });
    if (!latest || Number(latest.id) !== Number(messageId) || latest.direction !== "in") return "newer message or already answered";
    const blocked = await blockedReason(chat, ai, now);
    if (blocked) return `skipped: ${blocked}`;
    if (!wa.windowOpen(chat, now.getTime())) return "skipped: window closed";
    const start = moment(now).tz(TZ).startOf("day").toDate();
    if ((await CrmWaMessage.count({ where: { chat_id: chat.id, sender: "ai", at: { [Op.gte]: start } } })) >= ai.maxRepliesPerChatPerDay) {
        await needsPerson(chat, "The AI reached its daily limit in this chat", { handover: true });
        return "skipped: chat limit";
    }
    if ((await CrmWaMessage.count({ where: { sender: "ai", at: { [Op.gte]: start } } })) >= ai.maxRepliesPerDay) {
        await needsPerson(chat, "The AI reached its daily limit", { handover: true });
        return "skipped: daily limit";
    }

    const lead = await CrmLeadV2.findByPk(chat.lead_id);
    const owner = lead && lead.owner_id ? await AdmUser.findByPk(lead.owner_id, { attributes: ["id", "name", "mobile"] }) : null;
    const recent = (await CrmWaMessage.findAll({ where: { chat_id: chat.id }, order: [["id", "DESC"]], limit: 24 })).reverse();
    const userIds = [...new Set(recent.map((m) => m.user_id).filter(Boolean))];
    const names = new Map((await AdmUser.findAll({ where: { id: userIds }, attributes: ["id", "name"], raw: true })).map((u) => [u.id, u.name.split(/\s+/)[0]]));
    const wh = await workingHours();

    let answer;
    try {
        answer = await callClaude(ai, systemPrompt(ai, { lead, owner, now, wh }), conversation(recent, names));
    } catch (e) {
        if (job && job.attempts >= job.max_attempts) await needsPerson(chat, "The AI could not answer (service error)", { handover: true });
        throw e;
    }

    // A person may have answered while the AI was thinking.
    chat = await CrmWaChat.findByPk(chat.id);
    const newer = await CrmWaMessage.count({ where: { chat_id: chat.id, id: { [Op.gt]: messageId }, kind: { [Op.ne]: "note" } } });
    if (newer) return "a newer message arrived; not sent";

    if (!answer.reply && !answer.handover) answer = { ...answer, handover: true, handoverReason: answer.handoverReason || "The AI had no answer" };
    if (answer.reply) await wa.sendText(chat, answer.reply, { sender: "ai" });

    const done = [];
    if (lead) {
        await sequelize.transaction(async (t) => {
            const fresh = await CrmLeadV2.findByPk(lead.id, { transaction: t, lock: t.LOCK.UPDATE });
            const said = await fillDetails(fresh, answer.details || {}, t);
            const { activity } = require("./leads");
            if (said.length) {
                await activity(fresh.id, "system", null, `AI noted from WhatsApp: ${said.join(", ")}`, { ai: true }, t);
                done.push("details");
            }
            const c = await config.load();
            if (answer.call && c.stageById.get(fresh.stage_id)?.kind === "open") {
                const when = callTime(wh, answer.call.at, now);
                await addTask({ leadId: fresh.id, ownerId: fresh.owner_id, type: "call", dueAt: when, note: "Asked for a call on WhatsApp", origin: "ai" }, t);
                await syncNext(fresh.id, t);
                const label = moment(when).tz(TZ).format("ddd D MMM, h:mm A");
                await activity(fresh.id, "task", null, `AI booked a call for ${label} (asked on WhatsApp)`, { ai: true, at: when }, t);
                await wa.note(chat, `AI set the next action: call at ${label}${owner ? ` · told ${owner.name.split(/\s+/)[0]}` : ""}`, t);
                if (fresh.owner_id) await notify(fresh.owner_id, { type: "wa.call", title: `Call ${fresh.name || fresh.phone} at ${label}`, body: "They asked for a call on WhatsApp (booked by the AI).", link: `/leads/${fresh.id}`, ref: `aicall:${fresh.id}:${messageId}` }, { transaction: t });
                done.push("call");
            }
        });
    }
    if (answer.handover) {
        const quiet = (await settings.read("whatsapp_ai")).aiQuietHoursAfterHuman;
        await CrmWaChat.update({ handover_reason: answer.handoverReason || "Needs a person", ai_paused_until: new Date(now.getTime() + Math.max(1, quiet) * 3600000), needs_reply: true }, { where: { id: chat.id } });
        chat = await CrmWaChat.findByPk(chat.id);
        await wa.note(chat, `AI handed over to a person: ${answer.handoverReason || "needs a person"}`);
        await needsPerson(chat, answer.handoverReason || "Needs a person", { handover: true });
        done.push("handover");
    }
    return `replied${done.length ? ` (${done.join(", ")})` : ""}`;
}

/* ------------------------------ panel ------------------------------ */

/** Settings > AI assistant > Try it: the reply the AI would send, nothing is sent. */
async function tryIt(s, input = {}) {
    need(s, "settings.manage");
    const ai = { ...(await settings.read("ai_assistant")), ...(input.draft && typeof input.draft === "object" ? input.draft : {}) };
    const msgs = (Array.isArray(input.messages) ? input.messages : []).slice(-20).map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: txt(m.text, 2000) })).filter((m) => m.content);
    if (!msgs.length || msgs[msgs.length - 1].role !== "user") throw new RuleError("Write a customer message to try.");
    if (msgs[0].role === "assistant") msgs.unshift({ role: "user", content: "(earlier messages)" });
    const wh = await workingHours();
    const lead = { name: txt(input.name, 60) || "Test customer" };
    const answer = await callClaude(ai, systemPrompt(ai, { lead, owner: s.user, now: new Date(), wh }), msgs);
    return { ...answer, model: process.env.ADMIN_AI_FAKE === "1" ? "test (fake)" : ai.model };
}

/** What the panel shows about the AI on this server. */
function status() {
    return { live: wa.live(), aiKey: !!process.env.ANTHROPIC_API_KEY || process.env.ADMIN_AI_FAKE === "1", fake: process.env.ADMIN_AI_FAKE === "1" };
}

wa.onInbound(onInbound);
worker.registerJob("wa.ai", replyJob);
worker.registerJob("wa.media", ({ messageId }) => wa.fetchInboundMedia(messageId));

module.exports = { onInbound, needsPerson, replyJob, tryIt, status, conversation, parseAnswer, blockedReason, callTime };
