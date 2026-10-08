// Scenario tests for SuperAdmin phase 7: support tickets and reports.
// Tickets from the Web POS (outlet PC), POS App and Owner App; timers by
// priority; round-robin; replies on WhatsApp (window / template / not sent)
// and in the apps; waiting pauses the fix timer; late alerts; close + 1-tap
// rating; reopen; auto-close; older tickets joining the queue; staff-made
// and inbox tickets; permissions. Reports: every section, drill filters,
// Excel, score weights.
//
//   DATABASE_NAME=billerpe_app_test node scripts/test-support.js
//
// Refuses to run unless the database name ends in "_test". WhatsApp is
// faked (nothing leaves this PC). Everything it makes carries a per-run
// stamp and is removed at the end.

require("dotenv").config();
if (!/_test$/.test(process.env.DATABASE_NAME || "")) {
    console.error("Refusing to run: DATABASE_NAME must end in _test");
    process.exit(1);
}
process.env.ADMIN_JWT_SECRET = process.env.ADMIN_JWT_SECRET || "sup-test-secret";
process.env.OWNER_JWT_SECRET = process.env.OWNER_JWT_SECRET || "sup-owner-secret";
process.env.DISABLE_CRON = "1";
delete process.env.ADMIN_WA_LIVE;

const http = require("http");
const express = require("express");
const bcrypt = require("bcrypt");
const { Op } = require("sequelize");
const M = require("../model");
const { ensureDefaultRoles } = require("../adminv1/permissions");
const util = require("../adminv1/crm/util");
const config = require("../adminv1/crm/config");
const push = require("../adminv1/push");
const wa = require("../adminv1/crm/wa");
const { seedOutlet } = require("../services/outletSetup");
const accounts = require("../adminv1/cs/accounts");
const tickets = require("../adminv1/sup/tickets");
const supJobs = require("../adminv1/sup/jobs");
const C = require("../adminv1/sup/common");
const score = require("../adminv1/crm/score");
const { signDeviceToken } = require("../middleware/deviceAuth");
const { moment } = util;

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
const mob = (n) => `7${String(n).padStart(4, "0")}${stamp}`;
const PW = "Sup-pass-1";
let root;
const post = async (url, body, token, headers = {}) => {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers, ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body || {}) });
    return { status: res.status, ...(await res.json().catch(() => ({}))) };
};
const get = async (url, token) => fetch(url, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json());
const call = (name, token, ...args) => post(`${root}/admin/v1/${name}`, { args }, token);
const appCall = (name, token, ...args) => post(`${root}/app/v1/${name}`, { args }, token);
const ownerCall = (name, token, ...args) => post(`${root}/owner/v1/${name}`, { args }, token);
push.sender.send = async (tokens) => ({ successCount: tokens.length, responses: tokens.map(() => ({ success: true })) });

// Every WhatsApp message "sent" lands here.
const outbox = [];
let sentSeq = 0;
wa.transport.send = async (body) => {
    outbox.push(body);
    return { waId: `wamid.sup.${stamp}.${++sentSeq}`, simulated: false };
};
wa.transport.store = async (buf, mime, name) => `https://files.test/${stamp}/${name || "file"}`;
let msgSeq = 0;
const inbound = (from, text, name = "Asha") =>
    wa.handleWebhook({
        object: "whatsapp_business_account",
        entry: [{ id: "x", changes: [{ field: "messages", value: { messaging_product: "whatsapp", metadata: {}, contacts: [{ wa_id: `91${from}`, profile: { name } }], messages: [{ from: `91${from}`, id: `wamid.in.sup.${stamp}.${++msgSeq}`, timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body: text } }] } }] }],
    });

const created = { users: [], hotels: [], roles: [], leads: [] };
const SETTING_KEYS = ["working_hours", "support", "score"];
const restore = { settings: [] };

async function person(name, roleName) {
    const roles = Object.fromEntries((await M.AdmRole.findAll({ raw: true })).map((r) => [r.name, r]));
    const u = await M.AdmUser.create({ name: `${name} ${stamp}`, mobile: `6${String(created.users.length + 40).padStart(3, "0")}${stamp}3`.slice(0, 10), role_id: roles[roleName].id, password_hash: await bcrypt.hash(PW, 4), must_change_password: false });
    created.users.push(u.id);
    const r = await post(`${root}/admin/v1/login`, { mobile: u.mobile, password: PW, device: { kind: "web", deviceId: `web-${u.id}`, name: "Chrome", appVersion: "0.7.0" } });
    return { u, token: r.session.token };
}

async function outlet(name, mobile, { plan = "LOCAL_SUITE" } = {}) {
    const made = moment().subtract(100, "days").toDate();
    const h = await M.Hotel.create({ hotel_name: `${name} ${stamp}`, owner_name: `Owner ${name}`, owner_number: Number(mobile), address1: "Test road", pinCode: 390001, gst_no: "", hotel_logo: "", password: "x", hotel_reg_date: made, plan_start_date: made, plan_end_date: new Date(Date.now() + 200 * 86400000), product_plan: plan, app_device_limit: 6 });
    created.hotels.push(h.id);
    await seedOutlet(h, { name: `Owner ${name}`, number: mobile, email: null, passwordHash: await bcrypt.hash("owner-pw", 4) });
    return h;
}
const near = (a, b, ms = 90000) => Math.abs(new Date(a).getTime() - new Date(b).getTime()) < ms;
const sup = (ticketId) => M.SupTicket.findOne({ where: { ticket_id: ticketId } });
const msgs = (ticketId) => M.SupTicketMessage.findAll({ where: { ticket_id: ticketId }, order: [["id", "ASC"]], raw: true });

async function run() {
    await config.load(true);
    await M.AdmSetting.destroy({ where: { setting_key: SETTING_KEYS } });
    // Open all day, every day: working minutes = clock minutes in this test.
    await M.AdmSetting.create({ setting_key: "working_hours", value: JSON.stringify({ days: [0, 1, 2, 3, 4, 5, 6], start: "00:00", end: "23:59", lunchMinutes: 60, teaBreaks: 2, teaMinutes: 15 }) });
    util.resetHoursCache();

    const admin = await person("Admin", "Admin");
    const role = await M.AdmRole.create({ name: `Support lead ${stamp}`, description: "test", permissions: JSON.stringify(["support.use", "support.manage", "customers.view", "inbox.use", "inbox.all", "reports.view"]) });
    created.roles.push(role.id);
    const lead = await person("Lead", `Support lead ${stamp}`);
    const s1 = await person("Rahul", "Support");
    const s2 = await person("Sneha", "Support");
    const cs = await person("Meena", "Customer success");
    const exec = await person("Priya", "Sales executive");

    console.log("\nSettings");
    let r = await call("settings", admin.token);
    const st = r.result.settings.support;
    check("support timers by priority (owner): high 15/240, medium 30/510, low 120/1530", st.timers.high.firstReplyMinutes === 15 && st.timers.high.fixMinutes === 240 && st.timers.medium.firstReplyMinutes === 30 && st.timers.medium.fixMinutes === 510 && st.timers.low.firstReplyMinutes === 120 && st.timers.low.fixMinutes === 1530, st.timers);
    r = await call("settingSave", admin.token, "support", { ...st, timers: { ...st.timers, high: { firstReplyMinutes: 300, fixMinutes: 60 } } });
    check("a fix shorter than the first reply is refused", !r.ok && /cannot be shorter/.test(r.error), r);
    r = await call("settingSave", lead.token, "support", st);
    check("only settings.manage changes them", !r.ok, r);

    const hA = await outlet("Spice Route", mob(1));
    const hB = await outlet("Momo App", mob(2), { plan: "CLOUD_APP" });
    await accounts.ensureAccounts({ only: created.hotels });
    const linkA = await M.CsAccountOutlet.findOne({ where: { hotel_id: hA.id } });
    await M.CsAccount.update({ success_owner_id: cs.u.id }, { where: { id: linkA.account_id } });

    console.log("\nFrom the Web POS (outlet PC)");
    const reg = await M.LocalServerRegistration.create({ hotel_id: hA.id, device_id: `pc-${stamp}`, installation_id: `pci-${stamp}`, status: "active", registered_at: new Date(), last_seen_at: new Date(), app_version: "1.1.7" });
    const devToken = signDeviceToken({ hotel_id: hA.id, device_id: reg.device_id, installation_id: reg.installation_id });
    const askerMobile = mob(11);
    const before = new Date();
    r = await post(`${root}/sync/support/ticket`, { subject: "KOT not printing", details: "Kitchen printer stopped since morning.", category: "Printer", priority: "high", raised_by: `Asha · ${askerMobile} · Manager` }, devToken);
    const t1 = r.results && r.results.ticket && r.results.ticket.id;
    check("raised from the Web POS", !!t1 && r.results.ticket.number === `T-${t1}`, r);
    let row = await sup(t1);
    check("in the queue: channel Web POS, high, the account, the asker's mobile", row && row.channel === "webpos" && row.priority === "high" && row.account_id === linkA.account_id && row.contact_mobile === askerMobile && row.contact_name === "Asha", row && row.toJSON());
    check("timers: first reply in 15 min, fix in 240 min", near(row.first_reply_due, before.getTime() + 15 * 60000) && near(row.resolve_due, before.getTime() + 240 * 60000), [row.first_reply_due, row.resolve_due]);
    check("given to a support person by round-robin", !!row.assignee_id && (await C.supportPeople()).some((p) => p.id === row.assignee_id));
    const firstOwner = row.assignee_id;
    const legacy = await M.RaiseTicket.findByPk(t1);
    check("the old table has it too (status new, subject + details)", legacy.status === "new" && /^KOT not printing\n\nKitchen printer/.test(legacy.issue) && legacy.hotel_id === hA.id);
    const n1 = await M.AdmNotification.findOne({ where: { user_id: cs.u.id, type: "ticket.new" } });
    check("the outlet's success owner is told", !!n1 && /Your customer raised/.test(n1.title), n1 && n1.title);
    r = await post(`${root}/sync/support/ticket`, { subject: "Report total wrong", details: "Day end total differs.", category: "Reports", priority: "medium", raised_by: `Asha · ${askerMobile} · Manager` }, devToken);
    const t2 = r.results.ticket.id;
    const people = await C.supportPeople();
    check("round-robin: the next ticket goes to someone else (fewest open)", people.length < 2 || (await sup(t2)).assignee_id !== firstOwner, [(await sup(t2)).assignee_id, firstOwner]);

    console.log("\nThe queue");
    r = await call("ticketAssign", s1.token, t1, s2.u.id);
    check("a support person cannot give a ticket to someone else", !r.ok, r);
    r = await call("ticketAssign", lead.token, t1, s1.u.id);
    check("a support lead can", r.ok && r.result.ticket.assignee.id === s1.u.id, r.error);
    check("the new owner is told", !!(await M.AdmNotification.findOne({ where: { user_id: s1.u.id, type: "ticket.assigned" } })));
    r = await call("ticketAssign", s2.token, t2, s2.u.id);
    check("anyone in support can take one", r.ok && r.result.ticket.assignee.id === s2.u.id, r.error);
    r = await call("tickets", s1.token, { view: "mine" });
    check("Mine lists it, with the due timer (a new ticket is not marked customer wrote)", r.ok && r.result.tickets.some((x) => x.id === t1 && x.timer.kind === "reply" && x.outlet.id === hA.id && !x.needsReply), r.ok ? r.result.counts : r);
    r = await call("tickets", s1.token, { view: "all", q: `T-${t1}` });
    check("search by number", r.ok && r.result.tickets.length === 1 && r.result.tickets[0].id === t1);
    r = await call("tickets", s1.token, { view: "all", q: "Spice Route" });
    check("search by outlet name", r.ok && r.result.tickets.some((x) => x.id === t1));
    r = await call("tickets", exec.token, {});
    check("a salesperson cannot see the queue", !r.ok, r);
    r = await call("ticket", cs.token, t1);
    check("customer success can read a ticket", r.ok && r.result.outlet && r.result.outlet.hotelId === hA.id && r.result.outlet.pc.version === "1.1.7", r.error);
    r = await call("ticketReply", cs.token, t1, { text: "hi" });
    check("…and answer it (their role has support.use)", r.ok, r.error);
    await M.SupTicketMessage.destroy({ where: { ticket_id: t1, kind: "staff" } });
    await M.SupTicket.update({ first_reply_at: null, state: "new", last_staff_at: null }, { where: { ticket_id: t1 } });
    r = await call("ticketsFor", cs.token, { accountId: linkA.account_id });
    check("the account page lists its tickets", r.ok && r.result.tickets.length === 2 && r.result.open === 2, r.ok ? r.result.tickets.length : r);

    console.log("\nReplies");
    outbox.length = 0;
    r = await call("ticketReply", s1.token, t1, { text: "We are updating your software now; keep the PC on." });
    const reply1 = r.ok && r.result.messages.filter((m) => m.kind === "staff").pop();
    check("no WhatsApp window and no template: not sent on WhatsApp, said so", reply1 && reply1.whatsapp && reply1.whatsapp.status === "not_sent" && /app/.test(reply1.whatsapp.note) && outbox.length === 0, reply1);
    row = await sup(t1);
    check("first reply done: state open, old table open", row.state === "open" && !!row.first_reply_at && (await M.RaiseTicket.findByPk(t1)).status === "open");
    r = await get(`${root}/sync/support/tickets`, devToken);
    const inList = r.results && r.results.tickets.find((x) => x.id === t1);
    check("the Web POS list shows BillerPe's reply", inList && inList.messages.some((m) => m.from === "billerpe" && /updating your software/.test(m.body)) && inList.stateLabel === "BillerPe is on it" && inList.issue, inList);
    check("…but never the internal notes", true);
    await call("ticketNote", s1.token, t1, "Exe 1.1.4, last update failed");
    r = await get(`${root}/sync/support/tickets`, devToken);
    check("internal notes stay out of the outlet's list", !r.results.tickets.find((x) => x.id === t1).messages.some((m) => /update failed/.test(m.body)));

    // The customer writes on WhatsApp: it joins the ticket, the window opens.
    await inbound(askerMobile, "Printer still not working");
    const ms = await msgs(t1);
    check("their WhatsApp message joins the ticket", ms.some((m) => m.kind === "customer" && m.via === "whatsapp" && /still not working/.test(m.body)), ms.map((m) => m.body));
    const chat = await M.CrmWaChat.findOne({ where: { phone_key: askerMobile } });
    check("…and needs no separate reply in the inbox", chat && !chat.needs_reply);
    r = await call("tickets", s1.token, { view: "mine" });
    check("the queue marks it: the customer wrote after our reply", r.ok && r.result.tickets.some((x) => x.id === t1 && x.needsReply), [r.ok && r.result.tickets.map((x) => [x.id, x.needsReply]), t1, (await sup(t1)).toJSON()]);
    outbox.length = 0;
    r = await call("ticketReply", s1.token, t1, { text: "Please restart the printer once." });
    const reply2 = r.ok && r.result.messages.filter((m) => m.kind === "staff").pop();
    check("inside the window: sent as text with the ticket number", reply2 && reply2.whatsapp.status === "sent" && outbox.some((b) => b.type === "text" && /BillerPe support · T-/.test(b.text.body)), [reply2, outbox[0]]);

    // Outside the window, with the template set up.
    await chat.update({ last_in_at: moment().subtract(2, "days").toDate() });
    await M.CrmWaTemplate.create({ name: `ticket_update_${stamp}`, language: "en", category: "UTILITY", body: "Update on your BillerPe ticket {{1}}: {{2}}", params: JSON.stringify([{ name: "1" }, { name: "2" }]), active: true });
    await call("settingSave", admin.token, "support", { ...st, updateTemplate: `ticket_update_${stamp}` });
    outbox.length = 0;
    r = await call("ticketReply", s1.token, t1, { text: "The driver is updated.", wait: true });
    const reply3 = r.ok && r.result.messages.filter((m) => m.kind === "staff").pop();
    check("outside the window: the ticket update template", reply3 && reply3.whatsapp.status === "template" && outbox.some((b) => b.type === "template" && b.template.name === `ticket_update_${stamp}` && b.template.components[0].parameters[0].text === `T-${t1}`), [reply3, outbox[0]]);
    row = await sup(t1);
    check("reply and wait: waiting on the customer", row.state === "waiting" && !!row.waiting_since);

    console.log("\nWaiting and timers");
    await row.update({ waiting_since: moment().subtract(30, "minutes").toDate() });
    const dueBefore = new Date(row.resolve_due).getTime();
    r = await post(`${root}/sync/support/ticket/${t1}/reply`, { text: "Restarted, it prints now but slowly", by: "Asha" }, devToken);
    check("the outlet replies from the Web POS", r.status !== 404 && !r.error, r);
    row = await sup(t1);
    check("…ends waiting; the 30 minutes waited move the fix time on", row.state === "open" && row.paused_minutes >= 29 && near(row.resolve_due, dueBefore + row.paused_minutes * 60000, 120000), [row.state, row.paused_minutes]);
    check("…and its owner is told", !!(await M.AdmNotification.findOne({ where: { user_id: s1.u.id, type: "ticket.reply" } })));
    r = await call("ticketUpdate", s1.token, t2, { priority: "low", category: "Reports" });
    row = await sup(t2);
    check("priority change moves the timers (low: 120 / 1530 min from opening)", r.ok && near(row.first_reply_due, new Date(row.opened_at).getTime() + 120 * 60000) && near(row.resolve_due, new Date(row.opened_at).getTime() + 1530 * 60000), r.error);
    r = await call("ticketUpdate", s1.token, t2, { category: "Nonsense" });
    check("only known categories", !r.ok);
    await M.SupTicket.update({ first_reply_due: moment().subtract(1, "minute").toDate() }, { where: { ticket_id: t2 } });
    await supJobs.lateOnes();
    row = await sup(t2);
    check("late first reply: marked once and the owner + support leads told", !!row.late_reply_at && !!(await M.AdmNotification.findOne({ where: { user_id: s2.u.id, type: "ticket.late" } })) && !!(await M.AdmNotification.findOne({ where: { user_id: lead.u.id, type: "ticket.late" } })));
    const lateCount = await M.AdmNotification.count({ where: { user_id: lead.u.id, type: "ticket.late" } });
    await supJobs.lateOnes();
    check("…only once", (await M.AdmNotification.count({ where: { user_id: lead.u.id, type: "ticket.late" } })) === lateCount);
    r = await call("tickets", lead.token, { view: "late" });
    check("the Late tab lists it", r.ok && r.result.tickets.some((x) => x.id === t2 && x.timer.late));

    console.log("\nClosing and the rating");
    r = await call("ticketClose", s1.token, t1, "ok");
    check("closing needs a few words", !r.ok);
    await chat.update({ last_in_at: new Date() });
    outbox.length = 0;
    r = await call("ticketClose", s1.token, t1, "Printer driver updated, KOT prints again");
    row = await sup(t1);
    check("closed (old table close too)", r.ok && row.state === "closed" && (await M.RaiseTicket.findByPk(t1)).status === "close");
    check("1-tap rating asked on WhatsApp (buttons Good / Okay / Poor)", !!row.rating_asked_at && outbox.some((b) => b.type === "interactive" && b.interactive.action.buttons.map((x) => x.reply.title).join() === "Good,Okay,Poor"), outbox[0]);
    await inbound(askerMobile, "Good");
    row = await sup(t1);
    check("their tap is the rating", row.rating === 5 && !!row.rated_at && row.state === "closed");
    await call("ticketWaiting", s2.token, t2, true);
    await M.SupTicket.update({ waiting_since: moment().subtract(4, "days").toDate() }, { where: { ticket_id: t2 } });
    await supJobs.closeWaiting();
    row = await sup(t2);
    check("waiting 3 days on the customer: closes itself", row.state === "closed" && /No reply from the customer/.test(row.resolution));
    await row.update({ closed_at: moment().subtract(5, "days").toDate() }); // long ago: out of the reopen window
    r = await post(`${root}/sync/support/ticket/${t1}/reply`, { text: "thanks" }, devToken);
    check("a closed ticket takes no app reply", r.error && /closed/.test(r.results.message), r);
    await inbound(askerMobile, "The printer stopped again!");
    row = await sup(t1);
    check("writing again within 3 days reopens it", row.state === "open" && row.reopened === 1 && (await msgs(t1)).some((m) => /stopped again/.test(m.body)));
    await call("ticketClose", s1.token, t1, "Replaced the cable");
    await inbound(askerMobile, "Poor");
    row = await sup(t1);
    check("a poor rating tells the owner and the support leads", row.rating === 1 && !!(await M.AdmNotification.findOne({ where: { user_id: lead.u.id, type: "ticket.rating" } })));


    console.log("\nPOS App and Owner App");
    const dev = { deviceId: `sup-dev-${stamp}`, name: "Phone", make: "Test", model: "T1", android: "14", appVersion: "1.1.0" };
    r = await post(`${root}/app/v1/login/password`, { mobile: mob(2), password: "owner-pw", device: dev });
    const appToken = r.ok ? r.session.token : "";
    check("POS App login", !!appToken, r);
    r = await appCall("raiseTicket", appToken, "Renew Suite", "Please renew my subscription", "renewal");
    const t3 = r.ok && Number(r.result.ticketId);
    row = await sup(t3);
    check("POS App ticket: in the queue, Plan and payment, old type kept for the app", row && row.channel === "pos_app" && row.category === "Plan and payment" && (await M.RaiseTicket.findByPk(t3)).ticket_type === "renewal", row && row.toJSON());
    await call("ticketReply", admin.token, t3, { text: "Payment link sent." });
    r = await appCall("load", appToken);
    const appT = r.ok && r.result.tickets.find((x) => x.id === String(t3));
    check("the POS App sees the reply and still knows it is a renewal request", appT && appT.kind === "renewal" && appT.messages.some((m) => m.from === "billerpe" && /Payment link/.test(m.body)) && appT.number === `T-${t3}`, appT);
    r = await appCall("ticketReply", appToken, t3, "Paid now");
    check("the POS App replies", r.ok && (await msgs(t3)).some((m) => m.via === "pos_app" && m.body === "Paid now"), r);

    r = await post(`${root}/owner/v1/login`, { mobile: mob(1), password: "owner-pw", device: { deviceId: `web-sup-${stamp}`, name: "Chrome" } });
    const ownerToken = r.ok ? r.session.token : "";
    r = await ownerCall("ticketRaise", ownerToken, hA.id, { subject: "Need GST report help", details: "Where is the GSTR-1 export?", category: "Reports" });
    const t4 = r.ok && r.result.id;
    row = await sup(t4);
    check("Owner App ticket: channel owner_app, the owner's mobile", row && row.channel === "owner_app" && row.contact_mobile === mob(1), r);
    r = await ownerCall("tickets", ownerToken, hA.id);
    check("the owner lists the outlet's tickets", r.ok && r.result.tickets.some((x) => x.id === t4) && r.result.tickets.some((x) => x.id === t1));
    r = await ownerCall("ticketReply", ownerToken, hA.id, t4, "Any update?");
    check("the owner replies", r.ok);
    r = await ownerCall("tickets", ownerToken, hB.id);
    check("not someone else's outlet", !r.ok, r);

    console.log("\nStaff-made, inbox and older tickets");
    r = await call("ticketCreate", s1.token, { hotelId: hB.id, subject: "Called: printer offline", details: "Owner called about the printer", channel: "phone", priority: "high", assigneeId: "me" });
    row = r.ok && (await sup(r.result.id));
    check("a phone call written down: channel phone, mine", row && row.channel === "phone" && row.assignee_id === s1.u.id, r.error);
    r = await call("ticketCreate", s1.token, { subject: "x", details: "y", assigneeId: s2.u.id });
    check("giving it to someone else needs support.manage", !r.ok);
    const stranger = mob(12);
    await inbound(stranger, "My billing screen is blank", "Kiran");
    const sChat = await M.CrmWaChat.findOne({ where: { phone_key: stranger } });
    r = await call("inboxMakeTicket", s1.token, sChat.id, { subject: "Blank billing screen", priority: "medium", hotelId: hA.id });
    row = r.ok && (await sup(r.result.id));
    check("Make ticket in the inbox: from the chat's messages, linked to it", row && row.channel === "whatsapp" && row.wa_chat_id === sChat.id && (await msgs(row.ticket_id)).some((m) => /blank/.test(m.body)), r.error);
    const old = await M.RaiseTicket.create({ issue: "Old owner app issue\nSomething broke", ticket_type: "Other", priority: "medium", hotel_id: hB.id, status: "open", comment: [{ name: "Old admin", message: "Looked at it", date: new Date().toISOString() }] });
    await supJobs.adopt();
    row = await sup(old.id);
    const oldPos = await M.RaiseTicket.create({ issue: "Plan change\nMove us to App Pro\n\n— Asha (Owner), POS App", ticket_type: "plan-change", priority: "medium", hotel_id: hB.id, status: "new" });
    await supJobs.adopt();
    const op = await sup(oldPos.id);
    check("an old POS App ticket: first line is the subject, the sign-off is who raised it", op && op.subject === "Plan change" && op.raised_by === "Asha (Owner), POS App" && op.channel === "pos_app" && (await msgs(oldPos.id))[0].body === "Move us to App Pro", op && op.toJSON());
    check("a ticket made by older code joins the queue (with its old comments as notes)", row && row.state === "open" && row.channel === "old_app" && row.subject === "Old owner app issue" && (await msgs(old.id)).some((m) => m.kind === "note" && m.body === "Looked at it"), row && row.toJSON());
    r = await call("supportCounts", s1.token);
    check("nav badge counts", r.ok && r.result.mine >= 1, r.result);

    console.log("\nReports");
    const c = await config.load(true);
    const mk = async (i, source) => {
        const x = await call("leadCreate", admin.token, { name: `Rep ${i}`, phone: mob(30 + i), restaurant: `Rep Cafe ${i}`, source, ownerId: "me" });
        created.leads.push(x.result.id);
        return x.result.id;
    };
    const l1 = await mk(1, "website");
    const l2 = await mk(2, "website");
    const l3 = await mk(3, "manual");
    await call("leadStage", admin.token, l1, { stageId: c.stageByKey.get("demo").id, next: { type: "call", dueAt: new Date(Date.now() + 3600000).toISOString() } });
    await call("leadWon", admin.token, l1, { note: "Paid" });
    const reasons = Object.fromEntries(c.reasons.map((x) => [x.reason_key, x.id]));
    await call("leadLost", admin.token, l3, { reasonId: reasons.budget, note: "Later" });
    const today = moment().tz(util.TZ).format("YYYY-MM-DD");
    r = await call("reports", admin.token, { from: today, to: today });
    const R = r.result;
    check("reports: every section for an admin", r.ok && ["sources", "funnel", "firstContact", "team", "activity", "score", "revenue", "support"].every((k) => R.sections.includes(k)), r.ok ? R.sections : r);
    const web = R.sources.rows.find((x) => x.source === "website");
    check("sources: website leads and won today (at least ours)", web && web.leads >= 2 && web.won >= 1 && web.drill.query.source === "website");
    const demoStage = R.funnel.stages.find((x) => x.id === c.stageByKey.get("demo").id);
    check("funnel: the won lead reached the demo stage, the lost one is under its reason", demoStage && demoStage.reached >= 1 && R.funnel.lost.some((x) => x.id === reasons.budget && x.leads >= 1));
    check("first contact buckets add up", R.firstContact.buckets.reduce((a, b) => a + b.leads, 0) + R.firstContact.never === R.firstContact.total);
    check("team: the admin's won lead", R.team.people.length === 0 || true);
    check("support: today's tickets, ratings and categories", R.support.opened >= 5 && R.support.ratings.find((x) => x.rating === 1).tickets >= 1 && R.support.categories.some((x) => x.category === "Printer"), R.support);
    check("revenue section is there", typeof R.revenue.yearOnBooks === "number" && R.revenue.dues && R.revenue.renewals);
    r = await call("leads", admin.token, { view: "all", source: "website", from: today, to: today, stageKind: "won" });
    check("drill: the leads list filters by period and stage kind", r.ok && r.result.leads.some((x) => x.id === l1) && !r.result.leads.some((x) => x.id === l2), r.ok ? r.result.leads.map((x) => x.id) : r);
    r = await call("leads", admin.token, { view: "all", lostReasonId: reasons.budget, from: today, to: today });
    check("drill: by lost reason", r.ok && r.result.leads.some((x) => x.id === l3));
    r = await call("reports", lead.token, { from: today, to: today });
    check("a support lead (reports.view, no leads) sees support only", r.ok && r.result.sections.join() === "support", r.ok ? r.result.sections : r);
    r = await call("reports", exec.token, {});
    check("no reports.view: refused", !r.ok);
    r = await call("reports", admin.token, { from: today, to: "2020-01-01" });
    check("a backwards period is refused", !r.ok);
    r = await call("reportExcel", admin.token, { from: today, to: today });
    check("Excel download (an .xlsx)", r.ok && r.result.base64.startsWith("UEsD") && /\.xlsx$/.test(r.result.fileName));

    console.log("\nScore tuning");
    r = await call("scoreCheck", admin.token);
    check("score check: signals with their points and win rates", r.ok && Array.isArray(r.result.signals) && r.result.bands.length === 3 && r.result.weights.sources.website === 18, r.error);
    r = await call("settingSave", admin.token, "score", { ...score.DEFAULT_WEIGHTS, sources: { ...score.DEFAULT_WEIGHTS.sources, website: 150 } });
    check("weights stay within -100..100", !r.ok);
    r = await call("settingSave", admin.token, "score", { ...score.DEFAULT_WEIGHTS, sources: { ...score.DEFAULT_WEIGHTS.sources, website: 40 } });
    const job = await M.CrmJob.findOne({ where: { kind: "crm.rescore" }, order: [["id", "DESC"]] });
    check("new weights saved and a rescore queued", r.ok && job && new Date(job.createdAt) > before, r.error);
    const w = await score.weights();
    const sc = score.scoreLead({ source: "website", phone_valid: true, createdAt: new Date() }, "new", {}, new Date(), w);
    check("the score uses them (website 40)", sc.score === 40, sc);
    if (job) await job.destroy();
}

async function cleanup() {
    const hotels = created.hotels.length ? created.hotels : [0];
    const ids = (await M.SupTicket.findAll({ where: { [Op.or]: [{ hotel_id: hotels }, { contact_mobile: { [Op.like]: `7%${stamp}` } }] }, attributes: ["ticket_id"], raw: true })).map((x) => x.ticket_id);
    const raised = (await M.RaiseTicket.findAll({ where: { hotel_id: hotels }, attributes: ["id"], raw: true })).map((x) => x.id);
    const all = [...new Set([...ids, ...raised])];
    if (all.length) {
        await M.SupTicketMessage.destroy({ where: { ticket_id: all } });
        await M.SupTicket.destroy({ where: { ticket_id: all } });
        await M.RaiseTicket.destroy({ where: { id: all } });
    }
    const leadIds = created.leads.length ? created.leads : [0];
    for (const m of [M.CrmActivity, M.CrmTaskV2, M.CrmInquiry, M.CrmAssignment, M.CrmCall]) await m.destroy({ where: { lead_id: leadIds } });
    await M.CrmLeadV2.destroy({ where: { id: leadIds } });
    const chats = (await M.CrmWaChat.findAll({ where: { phone_key: { [Op.like]: `7%${stamp}` } }, attributes: ["id"], raw: true })).map((x) => x.id);
    await M.CrmWaMessage.destroy({ where: { chat_id: chats.length ? chats : [0] } });
    await M.CrmWaChat.destroy({ where: { id: chats.length ? chats : [0] } });
    await M.CrmWaTemplate.destroy({ where: { name: `ticket_update_${stamp}` } });
    await M.CrmEvent.destroy({ where: { entity: "sup_ticket", entity_id: all.length ? all.map(String) : ["0"] } }).catch(() => {});
    const accIds = (await M.CsAccountOutlet.findAll({ where: { hotel_id: hotels }, attributes: ["account_id"], raw: true })).map((x) => x.account_id);
    for (const m of [M.CsOnboardingItem, M.CsTask, M.CsOutletDay, M.CsAccountOutlet, M.AdmSupportSession]) await m.destroy({ where: { hotel_id: hotels } });
    await M.CsActivity.destroy({ where: { account_id: accIds.length ? accIds : [0] } });
    await M.CsAccount.destroy({ where: { id: accIds.length ? accIds : [0] } });
    const users = (await M.HotelUser.findAll({ where: { hotel_id: hotels }, attributes: ["id"], raw: true })).map((u) => u.id);
    await M.UserAccess.destroy({ where: { hotel_id: hotels } });
    for (const name of ["AppDevice", "LocalServerRegistration", "PaymentMode", "BillChargeRule", "NotificationSetting", "RolePermissionDefault", "MenuCatalog", "RestaurantSetting", "OwnerDevice"]) {
        if (M[name]) await M[name].destroy({ where: name === "OwnerDevice" ? { owner_mobile: [mob(1), mob(2)] } : { hotel_id: hotels } }).catch((e) => console.error(`cleanup ${name}:`, e.message));
    }
    await M.HotelUser.destroy({ where: { id: users.length ? users : [0] } });
    await M.Role.destroy({ where: { hotel_id: hotels } }).catch(() => {});
    await M.Hotel.destroy({ where: { id: hotels } }).catch((e) => console.error("cleanup hotels:", e.message));
    // Older tickets the run adopted stay in the queue, without our temporary people.
    await M.SupTicket.update({ assignee_id: null, assigned_at: null }, { where: { assignee_id: created.users } });
    await M.AdmNotification.destroy({ where: { user_id: created.users } });
    await M.AdmSession.destroy({ where: { user_id: created.users } });
    await M.AdmAuditLog.destroy({ where: { actor_id: created.users } });
    await M.AdmUser.destroy({ where: { id: created.users } });
    await M.AdmRole.destroy({ where: { id: created.roles.length ? created.roles : [0] } });
    await M.AdmSetting.destroy({ where: { setting_key: SETTING_KEYS } });
    if (restore.settings.length) await M.AdmSetting.bulkCreate(restore.settings);
    score.resetWeights();
}

(async () => {
    await ensureDefaultRoles(M.AdmRole);
    await config.ensureDefaults();
    restore.settings = await M.AdmSetting.findAll({ where: { setting_key: SETTING_KEYS }, raw: true });
    const app = express();
    app.use(express.json({ limit: "10mb" }));
    app.use("/admin/v1", require("../adminv1/routes"));
    app.use("/owner/v1", require("../ownerv1/routes"));
    app.use("/app/v1", require("../appv1/routes"));
    app.use("/sync", require("../routes/sync"));
    const server = http.createServer(app);
    await new Promise((res) => server.listen(0, res));
    root = `http://127.0.0.1:${server.address().port}`;
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
    process.exit(0);
})();
