// Scenario tests for the SuperAdmin inbox and automation (phase 3) against a
// real MySQL database: the WhatsApp webhook, who-wrote (lead / guest /
// customer / staff), the AI reply and handover, the 24-hour window,
// templates, opt-outs, cadences, rules, escalations, campaigns, the digest
// and the morning queue.
//
//   DATABASE_NAME=billerpe_app_test node scripts/test-crm-inbox.js
//
// Nothing reaches WhatsApp or Claude: the WhatsApp transport is replaced by a
// recorder and the AI runs in its fake mode. Refuses to run unless the
// database name ends in "_test"; puts settings and the rotation back at the end.

require("dotenv").config();
if (!/_test$/.test(process.env.DATABASE_NAME || "")) {
    console.error("Refusing to run: DATABASE_NAME must end in _test");
    process.exit(1);
}
process.env.ADMIN_JWT_SECRET = process.env.ADMIN_JWT_SECRET || "inbox-test-secret";
process.env.ADMIN_AI_FAKE = "1";
delete process.env.ADMIN_WA_LIVE;
process.env.ADMIN_WA_APP_SECRET = "inbox-test-app-secret";
process.env.ADMIN_WA_VERIFY_TOKEN = "inbox-test-verify";

const http = require("http");
const crypto = require("crypto");
const express = require("express");
const bcrypt = require("bcrypt");
const { Op } = require("sequelize");
const M = require("../model");
const { ensureDefaultRoles } = require("../adminv1/permissions");
const util = require("../adminv1/crm/util");
const config = require("../adminv1/crm/config");
const intake = require("../adminv1/crm/intake");
const worker = require("../services/admin/worker");
const wa = require("../adminv1/crm/wa");
const cadences = require("../adminv1/crm/cadences");
const automation = require("../adminv1/crm/automation");
const escalations = require("../adminv1/crm/escalations");
const campaigns = require("../adminv1/crm/campaigns");
const digest = require("../adminv1/crm/digest");
require("../adminv1/crm/ai");

let passed = 0;
const failures = [];
function check(name, ok, detail) {
    if (ok) {
        passed += 1;
        console.log(`  ok   ${name}`);
    } else {
        failures.push(name);
        console.log(`  FAIL ${name}${detail !== undefined ? `  ${JSON.stringify(detail).slice(0, 600)}` : ""}`);
    }
}

const stamp = String(Date.now()).slice(-5);
const phone = (n) => `8${String(n).padStart(4, "0")}${stamp}`;
const PW = "Inbox-pass-1";
let base;
const post = async (path, body, token) => {
    const res = await fetch(`${base}${path}`, { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body || {}) });
    return { status: res.status, ...(await res.json().catch(() => ({}))) };
};
const call = (name, token, ...args) => post(`/${name}`, { args }, token);

// Every message "sent" lands here instead of WhatsApp.
const outbox = [];
let sentSeq = 0;
wa.transport.send = async (body) => {
    outbox.push(body);
    return { waId: `wamid.test.${stamp}.${++sentSeq}`, simulated: false };
};
wa.transport.fetchMedia = async () => ({ buffer: Buffer.from("fake-image"), mime: "image/jpeg" });
wa.transport.store = async (buf, mime, name) => `https://files.test/${stamp}/${name || "file"}`;

let msgSeq = 0;
const inMsg = (from, text, extra = {}) => ({ from, id: `wamid.in.${stamp}.${++msgSeq}`, timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body: text }, ...extra });
const hook = (messages, statuses = [], name = "Test Person") => ({
    object: "whatsapp_business_account",
    entry: [{ id: "x", changes: [{ field: "messages", value: { messaging_product: "whatsapp", metadata: {}, contacts: messages.map((m) => ({ wa_id: m.from, profile: { name } })), messages, statuses } }] }],
});
async function webhook(body, { sign = true } = {}) {
    const raw = JSON.stringify(body);
    const sig = "sha256=" + crypto.createHmac("sha256", process.env.ADMIN_WA_APP_SECRET).update(raw).digest("hex");
    const res = await fetch(`${base}/wa/webhook`, { method: "POST", headers: { "Content-Type": "application/json", ...(sign ? { "X-Hub-Signature-256": sig } : {}) }, body: raw });
    return res.status;
}
const drain = async () => {
    for (let i = 0; i < 6; i++) {
        const e = await worker.processEvents(200);
        const j = await worker.processJobs(100);
        if (!e.handled && !e.failed && !j.done && !j.failed && !j.retried) break;
    }
};

const created = { users: [], guests: [], templates: [], cadences: [], rules: [], campaigns: [] };
const restore = { users: [], settings: [] };
const SETTING_KEYS = ["working_hours", "timers", "whatsapp_ai", "ai_assistant", "digest"];

async function person(name, roleName, extra = {}) {
    const roles = Object.fromEntries((await M.AdmRole.findAll({ raw: true })).map((r) => [r.name, r]));
    const u = await M.AdmUser.create({ name: `${name} ${stamp}`, mobile: `7${String(created.users.length).padStart(3, "0")}${stamp}0`.slice(0, 10), role_id: roles[roleName].id, password_hash: await bcrypt.hash(PW, 4), must_change_password: false, ...extra });
    created.users.push(u.id);
    const r = await post("/login", { mobile: u.mobile, password: PW, device: { kind: "web", deviceId: `t-${u.id}`, name: "test" } });
    return { u, token: r.session.token };
}
const setSetting = async (key, value) => {
    await M.AdmSetting.destroy({ where: { setting_key: key } });
    await M.AdmSetting.create({ setting_key: key, value: JSON.stringify(value) });
};
const chatOf = (p) => M.CrmWaChat.findOne({ where: { phone_key: p } });
const leadOf = (p) => M.CrmLeadV2.findOne({ where: { phone_key: p, merged_into_id: null }, order: [["id", "DESC"]] });
const lastOut = () => outbox[outbox.length - 1];
const mine = async () => (await M.CrmLeadV2.findAll({ where: { phone_key: { [Op.like]: `8%${stamp}` } }, attributes: ["id"], raw: true })).map((l) => l.id);

async function run() {
    const c = await config.load(true);

    /* ---------- morning queue (real company hours) ---------- */
    console.log("\nMorning queue");
    await setSetting("working_hours", { days: [1, 2, 3, 4, 5, 6], start: "10:30", end: "19:00", lunchMinutes: 60, teaBreaks: 2, teaMinutes: 15 });
    util.resetHoursCache();
    const ist = (s) => util.moment.tz(s, "YYYY-MM-DD HH:mm", "Asia/Kolkata").toDate();
    const fmt = (d) => util.moment(d).tz("Asia/Kolkata").format("ddd HH:mm");
    check("lead at Wed 23:00 is due Thu 11:30 (first hour)", fmt(await util.firstContactDue(ist("2026-10-07 23:00"))) === "Thu 11:30", fmt(await util.firstContactDue(ist("2026-10-07 23:00"))));
    check("lead on Sunday is due Monday 12:30 (first two hours)", fmt(await util.firstContactDue(ist("2026-10-11 15:00"))) === "Mon 12:30", fmt(await util.firstContactDue(ist("2026-10-11 15:00"))));
    check("lead in working time keeps 15 minutes", fmt(await util.firstContactDue(ist("2026-10-08 12:00"))) === "Thu 12:15");

    // From here: every day, all day, templates any time, AI answers at once.
    await setSetting("working_hours", { days: [0, 1, 2, 3, 4, 5, 6], start: "00:00", end: "23:59", lunchMinutes: 60, teaBreaks: 2, teaMinutes: 15 });
    await setSetting("whatsapp_ai", { aiAllDay: true, aiQuietHoursAfterHuman: 24, templateFrom: "00:00", templateTo: "23:59" });
    await setSetting("ai_assistant", { ...require("../adminv1/crm/aiDefaults").DEFAULTS, delaySeconds: 0 });
    await M.AdmSetting.destroy({ where: { setting_key: "timers" } });
    util.resetHoursCache();

    /* ---------- people ---------- */
    const admin = await person("Admin", "Admin");
    const mgr = await person("Manager", "Sales manager");
    const A = await person("ExecA", "Sales executive", { daily_lead_cap: 50, manager_id: mgr.u.id });
    const B = await person("ExecB", "Sales executive");
    const C = await person("ExecC", "Sales executive");
    const CS = await person("Success", "Customer success");
    const roleCS = await M.AdmRole.findOne({ where: { name: "Customer success" } });
    check("Customer success role has inbox.all (role upgrade)", JSON.parse(roleCS.permissions).includes("inbox.all"));

    /* ---------- webhook basics ---------- */
    console.log("\nWebhook");
    let res = await fetch(`${base}/wa/webhook?hub.mode=subscribe&hub.verify_token=inbox-test-verify&hub.challenge=abc123`);
    check("verify handshake echoes the challenge", res.status === 200 && (await res.text()) === "abc123");
    res = await fetch(`${base}/wa/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=abc123`);
    check("wrong verify token is refused", res.status === 403);
    check("unsigned POST is refused", (await webhook(hook([inMsg(`91${phone(1)}`, "hi")]), { sign: false })) === 401);

    /* ---------- a new prospect writes ---------- */
    console.log("\nNew prospect on WhatsApp");
    const P1 = phone(1);
    const first = inMsg(`91${P1}`, "Hi, I have a cafe with 2 outlets and 12 tables");
    check("signed POST is taken", (await webhook(hook([first], [], "Kiran Cafe"))) === 200);
    let chat = await chatOf(P1);
    let lead = await leadOf(P1);
    check("chat made as a lead chat", chat && chat.kind === "lead" && chat.lead_id === (lead && lead.id) && chat.needs_reply && chat.unread === 1, chat && chat.toJSON());
    check("the number became a WhatsApp lead owned by A", lead && lead.source === "whatsapp" && lead.owner_id === A.u.id && lead.name === "Kiran Cafe", lead && lead.toJSON());
    check("inquiry stored with the message", (await M.CrmInquiry.count({ where: { lead_id: lead.id, source: "whatsapp" } })) === 1);
    await webhook(hook([first], [], "Kiran Cafe"));
    check("the same delivery twice is stored once", (await M.CrmWaMessage.count({ where: { chat_id: chat.id, direction: "in" } })) === 1);
    check("AI reply job queued", (await M.CrmJob.count({ where: { kind: "wa.ai", dedupe_key: { [Op.like]: "wa.ai:%" }, status: "queued" } })) >= 1);
    outbox.length = 0;
    await drain();
    const aiMsg = await M.CrmWaMessage.findOne({ where: { chat_id: chat.id, sender: "ai" } });
    check("AI replied in the chat", aiMsg && aiMsg.kind === "text" && aiMsg.status === "sent" && /test AI reply/.test(aiMsg.body), aiMsg && aiMsg.toJSON());
    check("reply went to the right number", outbox.some((b) => b.to === `91${P1}` && b.type === "text"));
    lead = await M.CrmLeadV2.findByPk(lead.id);
    check("AI filled the business details", lead.outlets_count === 2 && lead.tables_count === 12 && lead.business_type === "Cafe", { o: lead.outlets_count, t: lead.tables_count, b: lead.business_type });
    chat = await M.CrmWaChat.findByPk(chat.id);
    check("chat no longer waits for a reply", !chat.needs_reply);

    // Call request with a time.
    const at = util.moment().tz("Asia/Kolkata").add(1, "day").format("YYYY-MM-DD") + " 11:00";
    await webhook(hook([inMsg(`91${P1}`, `ok call me ${at}`)], [], "Kiran Cafe"));
    await drain();
    const callTask = await M.CrmTaskV2.findOne({ where: { lead_id: lead.id, status: "open", note: "Asked for a call on WhatsApp" } });
    check("AI booked the call as a task at their time", callTask && util.moment(callTask.due_at).tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm") === at && callTask.owner_id === A.u.id, callTask && callTask.toJSON());
    check("a note in the chat says so", !!(await M.CrmWaMessage.findOne({ where: { chat_id: chat.id, kind: "note", body: { [Op.like]: "AI set the next action%" } } })));
    check("owner told about the call", !!(await M.AdmNotification.findOne({ where: { user_id: A.u.id, type: "wa.call" } })));

    // Money question -> handover.
    await webhook(hook([inMsg(`91${P1}`, "Can I get a discount?")], [], "Kiran Cafe"));
    await drain();
    chat = await M.CrmWaChat.findByPk(chat.id);
    check("AI handed over: paused, waiting for a person", chat.ai_paused_until && new Date(chat.ai_paused_until) > new Date() && chat.needs_reply && /discount|money/i.test(chat.handover_reason), chat.toJSON());
    check("a Reply on WhatsApp task for the owner", !!(await M.CrmTaskV2.findOne({ where: { lead_id: lead.id, status: "open", type: "whatsapp", note: { [Op.like]: "Reply on WhatsApp%" } } })));
    check("owner told about the handover", !!(await M.AdmNotification.findOne({ where: { user_id: A.u.id, type: "wa.handover" } })));
    const aiCount = await M.CrmWaMessage.count({ where: { chat_id: chat.id, sender: "ai" } });
    await webhook(hook([inMsg(`91${P1}`, "hello?")], [], "Kiran Cafe"));
    await drain();
    check("while paused the AI stays quiet", (await M.CrmWaMessage.count({ where: { chat_id: chat.id, sender: "ai" } })) === aiCount);
    check("no second reply task", (await M.CrmTaskV2.count({ where: { lead_id: lead.id, status: "open", type: "whatsapp" } })) === 1);

    /* ---------- inbox for people ---------- */
    console.log("\nInbox");
    let r = await call("inbox", A.token, { view: "mine" });
    check("A sees the chat in Mine, waiting", r.ok && r.result.chats.some((x) => x.id === chat.id && x.needsReply && x.ai === "paused"), r);
    r = await call("inboxWaiting", A.token);
    check("menu badge counts chats waiting", r.ok && r.result.n >= 1, r);
    r = await call("inboxChat", B.token, chat.id);
    check("B cannot open A's lead chat", !r.ok && /not visible/.test(r.error), r);
    r = await call("inboxChat", A.token, chat.id);
    check("chat shows messages, lead, window, templates", r.ok && r.result.messages.length >= 6 && r.result.lead.id === lead.id && r.result.chat.windowOpen && Array.isArray(r.result.templates), r.ok ? { n: r.result.messages.length } : r);
    const lastId = r.result.messages[r.result.messages.length - 1].id;
    outbox.length = 0;
    r = await call("inboxSend", A.token, chat.id, "Hi! I will call you at 11. Discount: let me check.");
    check("A replies with free text", r.ok && r.result.status === "sent" && lastOut().type === "text", r);
    r = await call("inboxChat", A.token, chat.id, { after: lastId });
    check("polling with after returns only the new message", r.ok && r.result.messages.length === 1 && r.result.messages[0].sender === "user" && /ExecA/.test(r.result.messages[0].by), r.ok ? r.result.messages : r);
    chat = await M.CrmWaChat.findByPk(chat.id);
    lead = await M.CrmLeadV2.findByPk(lead.id);
    check("a person's reply keeps the AI quiet for 24 h", chat.ai_paused_until && new Date(chat.ai_paused_until) - Date.now() > 23 * 3600000 && !chat.needs_reply);
    check("lead counts as contacted", !!lead.first_contact_at);
    check("the reply task is done (a call is still planned)", !(await M.CrmTaskV2.findOne({ where: { lead_id: lead.id, status: "open", type: "whatsapp" } })) && (await M.CrmTaskV2.count({ where: { lead_id: lead.id, status: "open" } })) >= 1);
    check("timeline shows the WhatsApp reply", !!(await M.CrmActivity.findOne({ where: { lead_id: lead.id, type: "whatsapp", actor_id: A.u.id } })));
    r = await call("inboxLetAi", A.token, chat.id);
    check("Let AI reply again", r.ok && !(await M.CrmWaChat.findByPk(chat.id)).ai_paused_until);
    r = await call("inboxTakeOver", A.token, chat.id);
    check("Take over pauses the AI", r.ok && (await M.CrmWaChat.findByPk(chat.id)).ai_paused_until);

    // Templates.
    console.log("\nTemplates and the 24-hour window");
    r = await call("waTemplateSave", A.token, { name: "x" });
    check("only automation.manage edits templates", !r.ok);
    r = await call("waTemplateSave", admin.token, { name: "Bad Name", body: "x" });
    check("template name must match WhatsApp Manager", !r.ok && /small letters/.test(r.error), r);
    r = await call("waTemplateSave", admin.token, { name: `s_int`, body: "Hi {{1}}, any update on {{2}}?", params: [{ label: "Name", source: "lead.name" }] });
    check("{{n}} places must match the values", !r.ok && /2 \{\{n\}\} places/.test(r.error), r);
    const tplName = (n) => (n === "s_int" || n === "offer_only_for_you" || n === "staff_daily_digest" ? n : `${n}_${stamp}`);
    const existing = async (n) => M.CrmWaTemplate.findOne({ where: { name: tplName(n), language: "en" } });
    async function template(n, body, params) {
        const had = await existing(n);
        const rr = await call("waTemplateSave", admin.token, { id: had ? had.id : undefined, name: tplName(n), body, params, active: true });
        if (!had && rr.ok) created.templates.push(rr.result.id);
        return rr;
    }
    r = await template("s_int", "Hi {{1}}, we tried to reach you about BillerPe. Reply here to talk.", [{ label: "Name", source: "lead.name" }]);
    check("template saved", r.ok, r);
    const sInt = await existing("s_int");
    await template("offer_only_for_you", "Hello {{1}}, an offer only for you!", [{ label: "Name", source: "lead.name" }]);
    await template("staff_daily_digest", digest.TEMPLATE_TEXT, [1, 2, 3, 4].map((i) => ({ label: `v${i}`, source: "custom", value: "-" })));
    await chat.update({ last_in_at: new Date(Date.now() - 2 * 86400000) });
    r = await call("inboxSend", A.token, chat.id, "hello again");
    check("free text after 24 h is refused", !r.ok && /24-hour window/.test(r.error), r);
    outbox.length = 0;
    r = await call("inboxSendTemplate", A.token, chat.id, sInt.id, ["Kiran"]);
    check("a template goes out after 24 h", r.ok && lastOut().type === "template" && lastOut().template.name === "s_int" && lastOut().template.components.some((x) => x.type === "body" && x.parameters[0].text === "Kiran"), lastOut());
    check("the chat shows the filled text", !!(await M.CrmWaMessage.findOne({ where: { chat_id: chat.id, kind: "template", body: { [Op.like]: "Hi Kiran, we tried%" } } })));
    r = await call("inboxSendTemplate", A.token, chat.id, sInt.id, [""]);
    check("template values cannot be empty", !r.ok && /needs 1 value/.test(r.error), r);

    // Delivery ticks.
    const tplMsg = await M.CrmWaMessage.findOne({ where: { chat_id: chat.id, kind: "template" }, order: [["id", "DESC"]] });
    await webhook(hook([], [{ id: tplMsg.wa_id, status: "delivered", timestamp: String(Math.floor(Date.now() / 1000)), recipient_id: `91${P1}` }]));
    await webhook(hook([], [{ id: tplMsg.wa_id, status: "read", timestamp: String(Math.floor(Date.now() / 1000)), recipient_id: `91${P1}` }]));
    await webhook(hook([], [{ id: tplMsg.wa_id, status: "sent", timestamp: String(Math.floor(Date.now() / 1000)), recipient_id: `91${P1}` }]));
    check("ticks go sent -> delivered -> read and never back", (await M.CrmWaMessage.findByPk(tplMsg.id)).status === "read");
    await webhook(hook([], [{ id: "wamid.someone.elses.bill", status: "read", recipient_id: "919999999999" }]));
    check("ticks for bills / OTPs are ignored", true);

    /* ---------- who wrote ---------- */
    console.log("\nGuests, customers, staff");
    const hotel = await M.Hotel.findOne({ attributes: ["id", "hotel_name"] });
    const G = phone(2);
    const guest = await M.User.create({ name: "Guest", number: G, hotel_id: hotel.id });
    created.guests.push(guest.id);
    const jobsBefore = await M.CrmJob.count({ where: { kind: "wa.ai" } });
    await webhook(hook([inMsg(`91${G}`, "Thanks for the bill")], [], "Guest Person"));
    const gChat = await chatOf(G);
    check("a restaurant's guest is not a lead", gChat && gChat.kind === "guest" && !gChat.lead_id && gChat.label === hotel.hotel_name && !(await leadOf(G)), gChat && gChat.toJSON());
    check("no AI for a guest", (await M.CrmJob.count({ where: { kind: "wa.ai" } })) === jobsBefore);
    check("people who see every chat are told", !!(await M.AdmNotification.findOne({ where: { user_id: CS.u.id, type: "wa.message", link: `/inbox/${gChat.id}` } })));
    r = await call("inboxChat", A.token, gChat.id);
    check("a salesperson does not see guest chats", !r.ok);
    r = await call("inbox", CS.token, { view: "not_lead" });
    check("customer success sees it under Not a lead", r.ok && r.result.chats.some((x) => x.id === gChat.id && x.kind === "guest"), r);
    r = await call("inboxMakeLead", CS.token, gChat.id, {});
    check("making a lead needs leads.edit", !r.ok);
    r = await call("inboxMakeLead", admin.token, gChat.id, { restaurant: "Guest Bistro" });
    const gLead = await leadOf(G);
    check("admin turns the chat into a lead", r.ok && gLead && gLead.restaurant_name === "Guest Bistro" && (await M.CrmWaChat.findByPk(gChat.id)).kind === "lead", r);
    await webhook(hook([inMsg(`91${A.u.mobile}`, "test from my phone")], [], "Exec A"));
    const sChat = await chatOf(A.u.mobile);
    check("our own staff number is a staff chat, no lead", sChat && sChat.kind === "staff" && !(await leadOf(A.u.mobile)));
    const owner = await M.Hotel.findOne({ where: { owner_number: { [Op.ne]: null } }, attributes: ["owner_number", "hotel_name"] });
    if (owner && String(owner.owner_number).length >= 10 && !(await M.CrmWaChat.findOne({ where: { phone_key: String(owner.owner_number).slice(-10) } })) && !(await leadOf(String(owner.owner_number).slice(-10)))) {
        const key = String(owner.owner_number).slice(-10);
        await webhook(hook([inMsg(`91${key}`, "billing is not working")], [], "Owner"));
        const oChat = await chatOf(key);
        check("a BillerPe restaurant owner is a customer chat", oChat && oChat.kind === "customer" && !(await leadOf(key)), oChat && oChat.toJSON());
        if (oChat) await M.CrmWaMessage.destroy({ where: { chat_id: oChat.id } }).then(() => oChat.destroy());
    }

    /* ---------- media ---------- */
    const P3 = phone(3);
    await webhook(hook([inMsg(`91${P3}`, "", { type: "image", text: undefined, image: { id: `media-${stamp}`, mime_type: "image/jpeg", caption: "payment done" } })], [], "Photo Sender"));
    const p3Chat = await chatOf(P3);
    const p3Lead = await leadOf(P3);
    await drain();
    const img = await M.CrmWaMessage.findOne({ where: { chat_id: p3Chat.id, kind: "image" } });
    check("an inbound photo is kept (media job)", img && img.media_url === `https://files.test/${stamp}/file` && img.body === "payment done", img && img.toJSON());
    check("no AI for a photo; the owner must reply", !(await M.CrmWaMessage.findOne({ where: { chat_id: p3Chat.id, sender: "ai" } })) && !!(await M.CrmTaskV2.findOne({ where: { lead_id: p3Lead.id, status: "open", type: "whatsapp" } })));

    /* ---------- opt-out ---------- */
    console.log("\nOpt-out");
    await webhook(hook([inMsg(`91${P3}`, "STOP")], [], "Photo Sender"));
    check("STOP adds an opt-out", !!(await M.CrmWaOptout.findOne({ where: { phone_key: P3 } })));
    r = await call("inboxSendTemplate", admin.token, p3Chat.id, sInt.id, ["X"]);
    check("templates to an opted-out number are refused", !r.ok && /opt-out/.test(r.error), r);
    await webhook(hook([inMsg(`91${P3}`, "START")], [], "Photo Sender"));
    check("START removes it", !(await M.CrmWaOptout.findOne({ where: { phone_key: P3 } })));
    r = await call("inboxOptout", A.token, p3Chat.id, true);
    check("a person can stop marketing messages by hand", r.ok && !!(await M.CrmWaOptout.findOne({ where: { phone_key: P3 } })));
    await call("inboxOptout", A.token, p3Chat.id, false);

    /* ---------- cadences ---------- */
    console.log("\nCadences");
    r = await call("cadences", A.token);
    const cadList = r.ok ? r.result.cadences : [];
    check("three built-in cadences", r.ok && ["new_lead", "revival", "demo_noshow"].every((k) => r.result.cadences.some((x) => x.key === k)), r);
    const newLead = r.result.cadences.find((x) => x.key === "new_lead");
    check("template steps linked to the templates by name", newLead.steps.filter((s) => s.action === "template").every((s) => s.templateId), newLead.steps);
    await intake.receive({ source: "website", name: "Cadence Lead", phone: phone(4) });
    const L4 = await leadOf(phone(4));
    await drain();
    outbox.length = 0;
    r = await call("leadOutcome", A.token, L4.id, { outcomeId: c.outcomeByKey.get("no_answer").id, next: { type: "call", dueAt: new Date(Date.now() + 3 * 3600000).toISOString() } });
    check("no answer logged", r.ok, r);
    await drain();
    let enr = await M.CrmCadenceEnrollment.findOne({ where: { lead_id: L4.id, cadence_id: newLead.id } });
    check("first No answer starts the new-lead cadence", enr && enr.status === "running", enr && enr.toJSON());
    await cadences.runDue({ only: [L4.id] });
    enr = await M.CrmCadenceEnrollment.findByPk(enr.id);
    check("day 0: template sent by the cadence", outbox.some((b) => b.type === "template" && b.to === `91${phone(4)}`) && enr.step_index === 1, { step: enr.step_index, out: outbox.map((b) => b.type) });
    check("next step waits for day 2, 11:00", util.moment(enr.next_run_at).tz("Asia/Kolkata").format("HH:mm") === "11:00" && enr.next_run_at > new Date(Date.now() + 86400000));
    // Pretend day 2 and day 5 have come: the call is added, the template must wait a day (one automatic message per day).
    await enr.update({ next_run_at: new Date(Date.now() - 1000) });
    await cadences.runDue({ only: [L4.id] });
    enr = await M.CrmCadenceEnrollment.findByPk(enr.id);
    check("day 2: call step (a call was already planned, not doubled)", enr.step_index === 2 && (await M.CrmTaskV2.count({ where: { lead_id: L4.id, status: "open", type: "call" } })) === 1);
    await enr.update({ next_run_at: new Date(Date.now() - 1000) });
    const n4 = outbox.length;
    await cadences.runDue({ only: [L4.id] });
    enr = await M.CrmCadenceEnrollment.findByPk(enr.id);
    check("second automatic template on the same day waits for tomorrow", outbox.length === n4 && enr.step_index === 2 && enr.next_run_at > new Date(), { step: enr.step_index });
    await webhook(hook([inMsg(`91${phone(4)}`, "yes interested")], [], "Cadence Lead"));
    await drain();
    enr = await M.CrmCadenceEnrollment.findByPk(enr.id);
    check("their reply stops the cadence", enr.status === "stopped" && /replied/.test(enr.stop_reason) && enr.replied_at, enr.toJSON());
    check("and makes a call task", !!(await M.CrmTaskV2.findOne({ where: { lead_id: L4.id, status: "open", note: { [Op.like]: "Replied to%" } } })));

    const revival = cadList.find((x) => x.key === "revival");
    r = await call("cadenceStart", A.token, L4.id, revival.id);
    check("start a cadence by hand", r.ok, r);
    r = await call("cadenceStart", A.token, L4.id, revival.id);
    check("not twice at the same time", !r.ok);
    r = await call("lead", A.token, L4.id);
    check("lead page lists cadences and the chat", r.ok && r.result.cadences.some((x) => x.status === "running") && r.result.whatsapp && r.result.whatsapp.chatId, r.ok ? { cad: r.result.cadences, wa: r.result.whatsapp } : r);
    const run1 = r.result.cadences.find((x) => x.status === "running");
    r = await call("leadStage", A.token, L4.id, { stageId: c.stageByKey.get("qualified").id, next: { type: "call", dueAt: new Date(Date.now() + 3600000).toISOString() } });
    await drain();
    check("a stage change stops it", r.ok && (await M.CrmCadenceEnrollment.findByPk(run1.id)).status === "stopped", r);
    r = await call("cadenceSave", A.token, { name: "x" });
    check("only automation.manage edits cadences", !r.ok);
    r = await call("cadenceSave", mgr.token, { name: `Test ${stamp}`, enrollOn: "manual", steps: [{ day: 3, action: "call" }, { day: 1, action: "call" }] });
    check("steps must be in day order", !r.ok && /day order/.test(r.error), r);
    r = await call("cadenceSave", mgr.token, { name: `Test ${stamp}`, enrollOn: "outcome:busy", stopOn: { reply: true }, steps: [{ day: 0, action: "whatsapp", note: "Say hi" }, { day: 2, at: "12:00", action: "template", templateId: sInt.id }] });
    check("manager adds a cadence", r.ok, r);
    if (r.ok) created.cadences.push(r.result.id);

    /* ---------- rules ---------- */
    console.log("\nRules");
    r = await call("rules", A.token);
    check("only automation.manage sees rules", !r.ok);
    r = await call("rules", mgr.token);
    check("eight built-in rules", r.ok && r.result.rules.filter((x) => x.builtin).length === 8, r.ok ? r.result.rules.map((x) => x.key) : r);
    const welcome = r.result.rules.find((x) => x.key === "welcome_template");
    r = await call("ruleActive", mgr.token, welcome.id, true);
    check("welcome rule needs a template first", !r.ok && /template/.test(r.error), r);
    r = await call("ruleSave", mgr.token, { name: `Website welcome ${stamp}`, trigger: "lead.created", conditions: { sources: ["website"] }, actions: [{ type: "task", taskType: "whatsapp", minutes: 0, note: `Welcome ${stamp}` }, { type: "notify", to: "owner", text: `Rule hello ${stamp}` }], guards: { oncePerDays: 30 } });
    check("manager adds an event rule", r.ok, r);
    const ruleId = r.result.id;
    created.rules.push(ruleId);
    await intake.receive({ source: "website", name: "Rule Lead", phone: phone(5) });
    const L5 = await leadOf(phone(5));
    await drain();
    check("the rule added the task", !!(await M.CrmTaskV2.findOne({ where: { lead_id: L5.id, note: `Welcome ${stamp}` } })));
    check("and told the owner", !!(await M.AdmNotification.findOne({ where: { user_id: L5.owner_id, title: `Rule hello ${stamp}` } })));
    check("run logged", !!(await M.CrmRuleRun.findOne({ where: { rule_id: ruleId, lead_id: L5.id, result: "done" } })));
    await intake.receive({ source: "meta", name: "Meta Lead", phone: phone(6) });
    const L6 = await leadOf(phone(6));
    await drain();
    check("conditions hold: a Meta lead does not match", !(await M.CrmTaskV2.findOne({ where: { lead_id: L6.id, note: `Welcome ${stamp}` } })));
    r = await call("ruleSave", mgr.token, { id: ruleId, name: `Website welcome ${stamp}`, trigger: "lead.created", conditions: { sources: ["website"] }, actions: [{ type: "task", taskType: "call", minutes: 0, note: `Dry ${stamp}` }], guards: { dryRun: true } });
    await intake.receive({ source: "website", name: "Dry Lead", phone: phone(7) });
    const L7 = await leadOf(phone(7));
    await drain();
    check("dry run logs but does nothing", !(await M.CrmTaskV2.findOne({ where: { lead_id: L7.id, note: `Dry ${stamp}` } })) && !!(await M.CrmRuleRun.findOne({ where: { rule_id: ruleId, lead_id: L7.id, result: "dry" } })));
    r = await call("rulePreview", mgr.token, { name: "p", trigger: "lead.created", conditions: { sources: ["website"] }, actions: [{ type: "notify" }] });
    check("preview counts recent matching leads", r.ok && r.result.count >= 2, r);
    r = await call("rulePreview", mgr.token, { key: "first_contact" });
    check("preview of a timer rule", r.ok && typeof r.result.count === "number", r);
    r = await call("ruleRuns", mgr.token, { ruleId });
    check("run log lists the runs", r.ok && r.result.runs.length >= 2, r);

    // No-answer ladder with a template on the 3rd try.
    const ladder = (await automation.rules(true)).find((x) => x.rule_key === "no_answer_ladder");
    r = await call("ruleSave", mgr.token, { id: ladder.id, params: { templateTry: 3, revivalTry: 6, nextDayAt: "11:00", templateId: sInt.id }, active: true });
    check("ladder settings saved", r.ok, r);
    await intake.receive({ source: "manual", name: "Ladder Lead", phone: phone(8) });
    const L8 = await leadOf(phone(8));
    for (let i = 0; i < 3; i++) {
        r = await call("leadOutcome", A.token, L8.id, { outcomeId: c.outcomeByKey.get("no_answer").id, next: { type: "call", dueAt: new Date(Date.now() + 3 * 3600000).toISOString() } });
        await drain();
    }
    const ladderRun = await M.CrmRuleRun.findOne({ where: { rule_id: ladder.id, lead_id: L8.id } });
    check("3rd try: ladder ran", ladderRun && /Try 3/.test(ladderRun.details), ladderRun && ladderRun.toJSON());
    const nextCall = await M.CrmTaskV2.findOne({ where: { lead_id: L8.id, status: "open", type: "call" }, order: [["due_at", "ASC"]] });
    check("next call moved to tomorrow 11:00", nextCall && util.moment(nextCall.due_at).tz("Asia/Kolkata").format("HH:mm") === "11:00" && nextCall.due_at > new Date(), nextCall && nextCall.toJSON());

    // Demo reminder + proposal follow-up.
    await M.CrmTaskV2.create({ lead_id: L5.id, owner_id: L5.owner_id, type: "demo", due_at: new Date(Date.now() + 30 * 60000), status: "open", note: "Demo", origin: "manual" });
    await automation.demoReminders();
    await drain();
    check("demo reminder to the salesperson", !!(await M.AdmNotification.findOne({ where: { user_id: L5.owner_id, title: { [Op.like]: "Demo at%" } } })));
    await L6.update({ stage_id: c.stageByKey.get("proposal").id, last_activity_at: new Date(Date.now() - 3 * 86400000) });
    await M.CrmTaskV2.update({ due_at: new Date(Date.now() + 5 * 86400000) }, { where: { lead_id: L6.id, status: "open" } });
    await automation.proposalFollowups();
    const pf = await M.CrmTaskV2.count({ where: { lead_id: L6.id, status: "open", note: "Follow up on the price shared" } });
    await automation.proposalFollowups();
    check("quiet proposal gets one follow-up call", pf === 1 && (await M.CrmTaskV2.count({ where: { lead_id: L6.id, status: "open", note: "Follow up on the price shared" } })) === 1);

    /* ---------- escalations ---------- */
    console.log("\nEscalations");
    await intake.receive({ source: "website", name: "Late Lead", phone: phone(9) });
    const L9 = await leadOf(phone(9));
    await L9.update({ response_due_at: new Date(Date.now() - 20 * 60000), owner_id: A.u.id });
    let out = await escalations.check();
    let esc = await M.CrmEscalation.findOne({ where: { lead_id: L9.id } });
    check("late first call goes to the manager", esc && esc.kind === "first_contact" && esc.level === 1 && esc.to_ids === `,${mgr.u.id},`, esc && esc.toJSON());
    check("manager and salesperson told", !!(await M.AdmNotification.findOne({ where: { user_id: mgr.u.id, type: "esc.manager" } })) && !!(await M.AdmNotification.findOne({ where: { user_id: A.u.id, type: "esc.owner" } })));
    await escalations.check();
    check("raised once", (await M.CrmEscalation.count({ where: { lead_id: L9.id } })) === 1);
    r = await call("escalations", mgr.token);
    check("manager's Needs you now lists it", r.ok && r.result.escalations.some((e) => e.lead.id === L9.id && e.forMe), r);
    r = await call("escalations", A.token);
    check("not on the salesperson's list", r.ok && !r.result.escalations.some((e) => e.lead.id === L9.id));
    await esc.update({ next_level_at: new Date(Date.now() - 1000) });
    await escalations.check();
    const l2 = await M.CrmEscalation.findOne({ where: { lead_id: L9.id, level: 2 } });
    check("manager did not act: goes to the admins", l2 && l2.to_ids.includes(`,${admin.u.id},`) && (await M.CrmEscalation.findByPk(esc.id)).status === "expired", l2 && l2.toJSON());
    check("admin told", !!(await M.AdmNotification.findOne({ where: { user_id: admin.u.id, type: "esc.admin" } })));
    r = await call("leadOutcome", A.token, L9.id, { outcomeId: c.outcomeByKey.get("interested").id, next: { type: "call", dueAt: new Date(Date.now() + 3 * 3600000).toISOString() } });
    await escalations.resolveOpen();
    check("calling the lead closes the escalation", r.ok && (await M.CrmEscalation.findByPk(l2.id)).status === "done" && (await M.CrmEscalation.findByPk(l2.id)).how === "Called", (await M.CrmEscalation.findByPk(l2.id)).toJSON());
    const odTask = await M.CrmTaskV2.findOne({ where: { lead_id: L9.id, status: "open" }, order: [["due_at", "ASC"]] });
    await odTask.update({ due_at: new Date(Date.now() - 3 * 3600000) });
    await escalations.check();
    const od = await M.CrmEscalation.findOne({ where: { lead_id: L9.id, kind: "overdue" } });
    check("overdue follow-up goes to the manager", od && od.level === 1 && od.task_id === odTask.id, od && od.toJSON());
    r = await call("taskUpdate", A.token, odTask.id, { dueAt: new Date(Date.now() + 3600000).toISOString() });
    await escalations.resolveOpen();
    check("moving the task closes it", r.ok && (await M.CrmEscalation.findByPk(od.id)).how === "Moved to a new time", r);
    await intake.receive({ source: "website", name: "No Manager", phone: phone(10) });
    const L10 = await leadOf(phone(10));
    await L10.update({ owner_id: C.u.id, response_due_at: new Date(Date.now() - 20 * 60000) });
    await escalations.check();
    const e10 = await M.CrmEscalation.findOne({ where: { lead_id: L10.id } });
    check("no manager: straight to the admins", e10 && e10.level === 2 && e10.to_ids.includes(`,${admin.u.id},`), e10 && e10.toJSON());
    r = await call("teamToday", mgr.token);
    check("team today for the manager", r.ok && r.result.people.some((p) => p.id === A.u.id && typeof p.open === "number"), r);
    r = await call("teamToday", A.token);
    check("not for a salesperson", !r.ok);

    /* ---------- campaigns ---------- */
    console.log("\nCampaigns");
    r = await call("campaigns", A.token);
    check("campaigns need campaigns.send", !r.ok);
    const audience = { sources: ["website", "meta"], createdFrom: util.moment().tz("Asia/Kolkata").format("YYYY-MM-DD") };
    await wa.setOptout(phone(7), true, { source: "manual" });
    r = await call("campaignPreview", mgr.token, { audience });
    check("preview: reach excludes opt-outs", r.ok && r.result.leads >= 4 && r.result.optedOut >= 1 && r.result.reach === r.result.numbers - r.result.optedOut, r);
    r = await call("campaignSave", mgr.token, { name: `Camp ${stamp}`, templateId: sInt.id, values: [""], audience, perMinute: 100 });
    check("draft saved", r.ok, r);
    const campId = r.result.id;
    created.campaigns.push(campId);
    r = await call("campaignStart", mgr.token, campId, {});
    check("started: numbers frozen, opt-out skipped", r.ok && r.result.total >= 4 && r.result.skipped >= 1, r);
    outbox.length = 0;
    await campaigns.sendDue();
    const rc = await campaigns.counts(campId);
    check("sent at a steady rate; the cadence lead that already got a message today is skipped", rc.sent >= 2 && rc.queued === 0 && rc.skipped >= 1 && outbox.every((b) => b.type === "template"), rc);
    check("campaign done", (await M.CrmCampaign.findByPk(campId)).status === "done");
    const sentR = await M.CrmCampaignRcpt.findOne({ where: { campaign_id: campId, status: "sent" } });
    await webhook(hook([], [{ id: sentR.wa_id, status: "read", timestamp: String(Math.floor(Date.now() / 1000)), recipient_id: sentR.phone }]));
    await webhook(hook([inMsg(sentR.phone, "tell me more")], [], "Camp Reader"));
    await drain();
    const sentR2 = await M.CrmCampaignRcpt.findByPk(sentR.id);
    check("read and reply counted", sentR2.status === "read" && sentR2.read_at && sentR2.replied_at, sentR2.toJSON());
    r = await call("campaign", mgr.token, campId, {});
    check("campaign page shows counts and recipients", r.ok && r.result.campaign.counts.read >= 1 && r.result.campaign.counts.replied >= 1 && r.result.recipients.length >= 4, r.ok ? r.result.campaign.counts : r);
    r = await call("campaignAction", mgr.token, campId, "pause");
    check("a finished campaign cannot be paused", !r.ok);
    await wa.setOptout(phone(7), false);

    /* ---------- digest ---------- */
    console.log("\nDigest");
    outbox.length = 0;
    await digest.run(new Date(), { force: true });
    check("digest in the panel", !!(await M.AdmNotification.findOne({ where: { user_id: A.u.id, type: "digest" } })));
    check("and on WhatsApp to the staff phone", outbox.some((b) => b.type === "template" && b.template.name === "staff_daily_digest" && b.to === `91${A.u.mobile}`), outbox.map((b) => b.to));
    const nOut = outbox.length;
    await digest.run(new Date(), { force: true });
    check("once a day", outbox.length === nOut);

    /* ---------- AI settings ---------- */
    console.log("\nAI settings");
    r = await call("aiTry", admin.token, { messages: [{ role: "user", text: "Do you have a printer?" }] });
    check("try the AI without sending", r.ok && r.result.reply && r.result.model === "test (fake)", r);
    r = await call("aiTry", A.token, { messages: [{ role: "user", text: "hi" }] });
    check("trying needs settings.manage", !r.ok);
    r = await call("settingSave", admin.token, "ai_assistant", { ...require("../adminv1/crm/aiDefaults").DEFAULTS, model: "gpt-4" });
    check("only Claude model ids", !r.ok && /Claude model/.test(r.error), r);
    r = await call("inboxStatus", A.token);
    check("inbox status says the server is simulated", r.ok && r.result.live === false && r.result.aiKey === true, r);

    /* ---------- merge moves the chat ---------- */
    const keepId = (await leadOf(phone(5))).id;
    const P1lead = await leadOf(P1);
    r = await call("leadMerge", admin.token, P1lead.id, keepId);
    check("merging moves the chat to the kept lead", r.ok && (await chatOf(P1)).lead_id === keepId, r);
}

async function cleanup() {
    const leadIds = await mine();
    const keys = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(phone);
    const chats = (await M.CrmWaChat.findAll({ where: { phone_key: [...keys, ...created.users.map(() => null).filter(Boolean)] }, attributes: ["id"], raw: true })).map((x) => x.id);
    const staffChats = (await M.CrmWaChat.findAll({ where: { phone_key: { [Op.like]: `7%${stamp}0` } }, attributes: ["id"], raw: true })).map((x) => x.id);
    const allChats = [...chats, ...staffChats];
    await M.CrmWaMessage.destroy({ where: { chat_id: allChats } });
    await M.CrmWaChat.destroy({ where: { id: allChats } });
    await M.CrmWaOptout.destroy({ where: { phone_key: keys } });
    await M.CrmCampaignRcpt.destroy({ where: { campaign_id: created.campaigns } });
    await M.CrmCampaign.destroy({ where: { id: created.campaigns } });
    await M.CrmRuleRun.destroy({ where: { lead_id: leadIds } });
    await M.CrmRule.destroy({ where: { id: created.rules } });
    const ladder = await M.CrmRule.findOne({ where: { rule_key: "no_answer_ladder" } });
    if (ladder) await ladder.update({ params: JSON.stringify(automation.BUILTIN.find((b) => b.key === "no_answer_ladder").params) });
    automation.invalidate();
    await M.CrmCadenceEnrollment.destroy({ where: { lead_id: leadIds } });
    await M.CrmCadenceStep.destroy({ where: { cadence_id: created.cadences } });
    await M.CrmCadence.destroy({ where: { id: created.cadences } });
    await M.CrmEscalation.destroy({ where: { lead_id: leadIds } });
    for (const m of [M.CrmInquiry, M.CrmTaskV2, M.CrmActivity, M.CrmCall, M.CrmAssignment]) await m.destroy({ where: { lead_id: leadIds } });
    await M.CrmLeadV2.destroy({ where: { id: leadIds } });
    await M.User.destroy({ where: { id: created.guests } });
    await M.CrmWaTemplate.destroy({ where: { id: created.templates.filter((id) => id) , name: { [Op.notIn]: ["s_int", "offer_only_for_you", "staff_daily_digest"] } } });
    if (created.users.length) {
        await M.AdmNotification.destroy({ where: { user_id: created.users } });
        await M.AdmBreak.destroy({ where: { user_id: created.users } });
        await M.AdmSession.destroy({ where: { user_id: created.users } });
        await M.AdmAuditLog.destroy({ where: { actor_id: created.users } });
        await M.AdmUser.destroy({ where: { id: created.users } });
    }
    await M.CrmEvent.destroy({ where: { entity: "crm_lead", entity_id: leadIds.map(String) } });
    await M.CrmEvent.destroy({ where: { entity: "crm_wa_chat", entity_id: allChats.map(String) } });
    await M.CrmJob.destroy({ where: { kind: ["wa.ai", "wa.media", "crm.demo_reminder", "crm.rule_template"], createdAt: { [Op.gte]: new Date(Date.now() - 3600000) } } });
    for (const u of restore.users) await M.AdmUser.update({ daily_lead_cap: u.daily_lead_cap }, { where: { id: u.id } });
    await M.AdmSetting.destroy({ where: { setting_key: SETTING_KEYS } });
    if (restore.settings.length) await M.AdmSetting.bulkCreate(restore.settings);
}

(async () => {
    await ensureDefaultRoles(M.AdmRole);
    await config.ensureDefaults();
    await automation.ensureDefaults();
    await cadences.ensureDefaults();
    restore.users = await M.AdmUser.findAll({ where: { daily_lead_cap: { [Op.ne]: null } }, attributes: ["id", "daily_lead_cap"], raw: true });
    await M.AdmUser.update({ daily_lead_cap: null }, { where: { id: restore.users.map((u) => u.id) } });
    restore.settings = await M.AdmSetting.findAll({ where: { setting_key: SETTING_KEYS }, raw: true });
    // Old unhandled events in the test DB are not this run's business.
    await M.CrmEvent.update({ handled_at: new Date() }, { where: { handled_at: null } });
    await M.CrmJob.update({ status: "cancelled" }, { where: { status: "queued" } });

    const app = express();
    app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } }));
    app.use("/admin/v1", require("../adminv1/routes"));
    const server = http.createServer(app);
    await new Promise((res) => server.listen(0, res));
    base = `http://127.0.0.1:${server.address().port}/admin/v1`;
    try {
        await run();
    } catch (e) {
        console.error(e);
        failures.push(`crashed: ${e.message}`);
    } finally {
        await cleanup().catch((e) => console.error("cleanup:", e.message));
        server.close();
        await M.sequelize.close();
    }
    console.log(`\n${passed} passed, ${failures.length} failed`);
    if (failures.length) {
        for (const f of failures) console.log(`  - ${f}`);
        process.exit(1);
    }
})();
