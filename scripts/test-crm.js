// Scenario tests for the SuperAdmin sales CRM (phase 2) against a real MySQL
// database: intake, assignment, scope, outcomes and the next-action rule,
// lost / revisit / reopen, won, merge, the sweep, My Day, pipeline, breaks.
//
//   DATABASE_NAME=billerpe_app_test node scripts/test-crm.js
//
// Refuses to run unless the database name ends in "_test". Uses fresh phone
// numbers, switches other people out of the lead rotation for the run, and
// puts everything back at the end.

require("dotenv").config();
if (!/_test$/.test(process.env.DATABASE_NAME || "")) {
    console.error("Refusing to run: DATABASE_NAME must end in _test");
    process.exit(1);
}
process.env.ADMIN_JWT_SECRET = process.env.ADMIN_JWT_SECRET || "crm-test-secret";

const http = require("http");
const express = require("express");
const bcrypt = require("bcrypt");
const { Op } = require("sequelize");
const M = require("../model");
const { ensureDefaultRoles } = require("../adminv1/permissions");
const util = require("../adminv1/crm/util");
const intake = require("../adminv1/crm/intake");
const jobs = require("../adminv1/crm/jobs");
const config = require("../adminv1/crm/config");
const worker = require("../services/admin/worker");

let passed = 0;
const failures = [];
function check(name, ok, detail) {
    if (ok) {
        passed += 1;
        console.log(`  ok   ${name}`);
    } else {
        failures.push(name);
        console.log(`  FAIL ${name}${detail !== undefined ? `  ${JSON.stringify(detail).slice(0, 500)}` : ""}`);
    }
}

const stamp = String(Date.now()).slice(-5);
const phone = (n) => `9${String(n).padStart(4, "0")}${stamp}`;
const PW = "Crm-pass-1";
let base;
const post = async (path, body, token) => {
    const res = await fetch(`${base}${path}`, { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body || {}) });
    return { status: res.status, ...(await res.json().catch(() => ({}))) };
};
const call = (name, token, ...args) => post(`/${name}`, { args }, token);
const soon = (min) => new Date(Date.now() + min * 60000).toISOString();

const created = { users: [], leadsBefore: 0 };
const restore = { users: [], settings: [] };

async function person(name, roleName, extra = {}) {
    const roles = Object.fromEntries((await M.AdmRole.findAll({ raw: true })).map((r) => [r.name, r]));
    const u = await M.AdmUser.create({ name: `${name} ${stamp}`, mobile: `6${String(created.users.length).padStart(3, "0")}${stamp}0`.slice(0, 10), role_id: roles[roleName].id, password_hash: await bcrypt.hash(PW, 4), must_change_password: false, ...extra });
    created.users.push(u.id);
    const r = await post("/login", { mobile: u.mobile, password: PW, device: { kind: "web", deviceId: `t-${u.id}`, name: "test" } });
    return { u, token: r.session.token };
}

// The test's own leads (the test DB may hold other data, e.g. a migration run).
const mine = async () => (await M.CrmLeadV2.findAll({ where: { phone_key: { [Op.like]: `9%${stamp}` } }, attributes: ["id"], raw: true })).map((l) => l.id);

async function run() {
    /* ---------- pure helpers ---------- */
    console.log("\nPhone numbers and working time");
    const np = util.normalizePhone;
    check("10 digits -> +91", np("98765 43210").phone === "+919876543210" && np("98765 43210").valid);
    check("+91 with spaces", np("+91 98765-43210").key === "9876543210");
    check("0 prefix", np("09876543210").phone === "+919876543210");
    check("international kept", np("+44 7911 123456").phone === "+447911123456" && np("+44 7911 123456").valid);
    check("garbage is invalid", !np("+1").valid && !np("*.").valid && !np("12345").valid);
    const wh = { days: [1, 2, 3, 4, 5, 6], start: "10:30", end: "19:00" };
    const ist = (s) => util.moment.tz(s, "YYYY-MM-DD HH:mm", "Asia/Kolkata").toDate();
    const fmt = (d) => util.moment(d).tz("Asia/Kolkata").format("ddd HH:mm");
    check("Fri 18:50 + 15 working min = Sat 10:35", fmt(util.addWorkingMinutes(wh, ist("2026-10-09 18:50"), 15)) === "Sat 10:35", fmt(util.addWorkingMinutes(wh, ist("2026-10-09 18:50"), 15)));
    check("Sat 18:55 + 15 = Mon 10:40 (Sunday off)", fmt(util.addWorkingMinutes(wh, ist("2026-10-10 18:55"), 15)) === "Mon 10:40");
    check("Sunday noon + 15 = Mon 10:45", fmt(util.addWorkingMinutes(wh, ist("2026-10-11 12:00"), 15)) === "Mon 10:45");
    check("night lead 23:10 + 15 = next day 10:45", fmt(util.addWorkingMinutes(wh, ist("2026-10-07 23:10"), 15)) === "Thu 10:45");
    check("working minutes Sat 18:50 -> Mon 10:40 = 20", util.workingMinutesBetween(wh, ist("2026-10-10 18:50"), ist("2026-10-12 10:40")) === 20, util.workingMinutesBetween(wh, ist("2026-10-10 18:50"), ist("2026-10-12 10:40")));
    check("isWorkingTime: Sun is off", !util.isWorkingTime(wh, ist("2026-10-11 12:00")) && util.isWorkingTime(wh, ist("2026-10-12 12:00")));

    /* ---------- people ---------- */
    // Every day, all day, so the test does not depend on the clock.
    await M.AdmSetting.destroy({ where: { setting_key: ["working_hours", "timers"] } });
    await M.AdmSetting.create({ setting_key: "working_hours", value: JSON.stringify({ days: [0, 1, 2, 3, 4, 5, 6], start: "00:00", end: "23:59", lunchMinutes: 60, teaBreaks: 2, teaMinutes: 15 }) });
    util.resetHoursCache();
    const admin = await person("Admin", "Admin");
    const mgr = await person("Manager", "Sales manager");
    const A = await person("ExecA", "Sales executive", { daily_lead_cap: 2, manager_id: mgr.u.id });
    const B = await person("ExecB", "Sales executive", { daily_lead_cap: 3, manager_id: mgr.u.id });
    const C = await person("ExecC", "Sales executive", { daily_lead_cap: 5 });
    const D = await person("ExecD", "Sales executive", { daily_lead_cap: 5 });
    const today = util.moment().tz("Asia/Kolkata").format("YYYY-MM-DD");
    await M.AdmLeave.create({ user_id: C.u.id, from_date: today, to_date: today, note: "test" });
    let r = await call("breakStart", D.token, "tea");
    check("D starts a tea break", r.ok && r.result.breakKind === "tea", r);
    r = await call("breakStart", D.token, "tea");
    check("second break at once refused", !r.ok && /already on a break/.test(r.error), r);

    /* ---------- intake + round-robin ---------- */
    console.log("\nIntake and round-robin");
    const ids = [];
    for (let i = 1; i <= 5; i++) {
        const x = await intake.receive({ source: "website", name: `Lead ${i}`, phone: `+91 ${phone(i)}`, email: `l${i}@example.com`, message: `Need billing ${i}` });
        ids.push(x.leadId);
    }
    const leads5 = await M.CrmLeadV2.findAll({ where: { id: ids }, order: [["id", "ASC"]], raw: true });
    const owners = leads5.map((l) => (l.owner_id === A.u.id ? "A" : l.owner_id === B.u.id ? "B" : String(l.owner_id)));
    check("round-robin by share of daily number, skipping leave and break: A B B A B", owners.join(" ") === "A B B A B", owners);
    const c = await config.load();
    check("new leads are in New with a first-call task", leads5.every((l) => l.stage_id === c.stageByKey.get("new").id && l.next_action_type === "call" && l.next_action_note === "First call"));
    const first = leads5[0];
    check("first contact due about 15 min after arrival", Math.abs(new Date(first.response_due_at) - new Date(first.createdAt) - 15 * 60000) < 90000, [first.createdAt, first.response_due_at]);
    check("owner notified", (await M.AdmNotification.count({ where: { user_id: A.u.id, type: "lead.assigned" } })) === 2);

    const again = await intake.receive({ source: "website", name: "Lead 1 again", phone: `0${phone(1)}`, message: "Still waiting for a call" });
    check("repeat number joins the same lead", again.leadId === ids[0] && again.joined, again);
    check("two inquiries on the lead, one lead", (await M.CrmInquiry.count({ where: { lead_id: ids[0] } })) === 2 && (await M.CrmLeadV2.count({ where: { phone_key: phone(1) } })) === 1);
    check("owner told about the repeat", (await M.AdmNotification.count({ where: { user_id: A.u.id, type: "lead.inquiry" } })) === 1);
    const m1 = await intake.receive({ source: "meta", externalId: `meta:t${stamp}`, name: "Meta One", phone: phone(6), sourceDetail: { campaign: "Hand POS Machine - Video" } });
    const m2 = await intake.receive({ source: "meta", externalId: `meta:t${stamp}`, name: "Meta One", phone: phone(6) });
    check("same Meta delivery stored once", m2.repeat && m2.leadId === m1.leadId && (await M.CrmInquiry.count({ where: { lead_id: m1.leadId } })) === 1, m2);

    /* ---------- manual + scope ---------- */
    console.log("\nManual leads and who sees what");
    r = await call("leadCreate", A.token, { name: "Walk in", phone: phone(1) });
    check("manual lead with a known number returns the existing lead", r.ok && r.result.duplicate && r.result.duplicate.id === ids[0], r);
    r = await call("leadCreate", A.token, { name: "Referral Raj", phone: phone(7), restaurant: "Raj Dhaba", city: "Anand", outlets: 2, source: "referral" });
    check("salesperson's own lead stays theirs", r.ok && (await M.CrmLeadV2.findByPk(r.result.id)).owner_id === A.u.id, r);
    const rajId = r.result.id;
    const bLead = leads5[1].id;
    r = await call("lead", A.token, bLead);
    check("A cannot open B's lead", !r.ok && /not yours/.test(r.error), r);
    r = await call("lead", mgr.token, bLead);
    check("manager opens a team member's lead", r.ok && r.result.lead.id === bLead, r);
    r = await call("leads", A.token, { view: "my_open" });
    check("A's list: only A's leads", r.ok && r.result.leads.length >= 3 && r.result.leads.every((l) => l.owner && l.owner.id === A.u.id), r.result && r.result.leads.map((l) => l.owner));
    r = await call("leads", A.token, { view: "unassigned" });
    check("salesperson cannot list unassigned leads", !r.ok, r);
    r = await call("leads", mgr.token, { view: "open", q: phone(2).slice(-6) });
    check("search by part of a phone number", r.ok && r.result.leads.length === 1 && r.result.leads[0].id === bLead, r.result);
    r = await call("leadAssign", A.token, ids[0], B.u.id, "test");
    check("salesperson cannot reassign", !r.ok, r);

    /* ---------- outcomes ---------- */
    console.log("\nOutcomes and the next-action rule");
    const o = Object.fromEntries(c.outcomes.map((x) => [x.outcome_key, x.id]));
    r = await call("leadOutcome", A.token, ids[0], { outcomeId: o.interested, note: "Wants Suite Pro" });
    check("outcome without a next action refused", !r.ok && /next action/.test(r.error), r);
    r = await call("leadOutcome", A.token, ids[0], { outcomeId: o.interested, note: "Wants Suite Pro", next: { type: "call", dueAt: soon(-30) } });
    check("next action in the past refused", !r.ok && /past/.test(r.error), r);
    const scoreBefore = (await M.CrmLeadV2.findByPk(ids[0])).score;
    r = await call("leadOutcome", A.token, ids[0], { outcomeId: o.interested, note: "Wants Suite Pro", call: { seconds: 240 }, next: { type: "demo", dueAt: soon(120), note: "Online demo" } });
    check("interested + demo next", r.ok, r);
    let L = await M.CrmLeadV2.findByPk(ids[0]);
    check("New -> Contacted, first contact set, next action = the demo", L.stage_id === c.stageByKey.get("contacted").id && L.first_contact_at && L.next_action_type === "demo" && L.next_action_note === "Online demo", L.get({ plain: true }));
    check("call recorded as answered, 240 s", (await M.CrmCall.count({ where: { lead_id: ids[0], answered: true, duration_seconds: 240 } })) === 1);
    check("first call and 'enquired again' call back both settled by this call", (await M.CrmTaskV2.count({ where: { lead_id: ids[0], status: "done", outcome_id: o.interested } })) === 2 && (await M.CrmTaskV2.count({ where: { lead_id: ids[0], status: "open" } })) === 1);
    check("score went up after speaking", L.score > scoreBefore, [scoreBefore, L.score]);
    r = await call("leadOutcome", A.token, ids[3], { outcomeId: o.no_answer, next: { type: "call", dueAt: soon(180) } });
    L = await M.CrmLeadV2.findByPk(ids[3]);
    check("no answer: stays New, unanswered call, first attempt counted", r.ok && L.stage_id === c.stageByKey.get("new").id && L.first_contact_at && (await M.CrmCall.count({ where: { lead_id: ids[3], answered: false } })) === 1, r);
    r = await call("leadOutcome", A.token, rajId, { outcomeId: o.whatsapp, call: false, next: { type: "whatsapp", dueAt: soon(5), note: "Send price list" } });
    check("WhatsApp outcome without a call", r.ok && (await M.CrmCall.count({ where: { lead_id: rajId } })) === 0, r);

    /* ---------- tasks ---------- */
    let detail = (await call("lead", A.token, rajId)).result;
    const onlyTask = detail.tasks.find((t) => t.status === "open");
    r = await call("taskUpdate", A.token, onlyTask.id, { cancel: true });
    check("cancelling the only next action refused", !r.ok && /needs a next action/.test(r.error), r);
    r = await call("leadTaskAdd", A.token, rajId, { type: "visit", dueAt: soon(60 * 24), note: "Visit the outlet" });
    check("second next action added", r.ok, r);
    r = await call("taskUpdate", A.token, onlyTask.id, { cancel: true });
    L = await M.CrmLeadV2.findByPk(rajId);
    check("then the first can be cancelled; next action = the visit", r.ok && L.next_action_type === "visit", [r, L.next_action_type]);
    r = await call("taskUpdate", A.token, (await M.CrmTaskV2.findOne({ where: { lead_id: rajId, status: "open" } })).id, { dueAt: soon(90) });
    L = await M.CrmLeadV2.findByPk(rajId);
    check("moving a task moves the lead's next action", r.ok && Math.abs(new Date(L.next_action_at) - Date.now() - 90 * 60000) < 60000);

    /* ---------- stage, won, lost, revisit ---------- */
    console.log("\nStages, won, lost, revisit");
    r = await call("leadStage", A.token, rajId, { stageId: c.stageByKey.get("qualified").id });
    check("stage move without a next action refused", !r.ok, r);
    r = await call("leadStage", A.token, rajId, { stageId: c.stageByKey.get("won").id, next: { type: "call", dueAt: soon(10) } });
    check("cannot drag into Won", !r.ok && /Mark won/.test(r.error), r);
    r = await call("leadStage", A.token, rajId, { stageId: c.stageByKey.get("qualified").id, next: { type: "demo", dueAt: soon(30) } });
    L = await M.CrmLeadV2.findByPk(rajId);
    check("moved to Qualified; old next actions replaced", r.ok && L.stage_id === c.stageByKey.get("qualified").id && (await M.CrmTaskV2.count({ where: { lead_id: rajId, status: "open" } })) === 1, r);
    r = await call("leadWon", A.token, rajId, { note: "Paid Suite Pro" });
    L = await M.CrmLeadV2.findByPk(rajId);
    check("won: closed, no open tasks", r.ok && L.won_at && (await M.CrmTaskV2.count({ where: { lead_id: rajId, status: "open" } })) === 0 && L.next_action_at === null);
    r = await call("leads", A.token, { view: "won_month" });
    check("won this month view", r.ok && r.result.leads.some((l) => l.id === rajId) && r.result.counts.won_month >= 1, r.result && r.result.counts);
    const wonInq = await intake.receive({ source: "website", name: "Raj", phone: phone(7), message: "Need a second printer" });
    L = await M.CrmLeadV2.findByPk(rajId);
    check("a customer enquiring again stays Won (owner told)", wonInq.customer && L.won_at && (await M.AdmNotification.count({ where: { user_id: A.u.id, type: "lead.customer_inquiry" } })) === 1);

    r = await call("leadOutcome", B.token, ids[1], { outcomeId: o.not_interested, note: "Uses Petpooja" });
    L = await M.CrmLeadV2.findByPk(ids[1]);
    check("not interested closes the lead as lost", r.ok && r.result.closed && L.stage_id === c.stageByKey.get("lost").id && L.lost_reason_id === c.reasonByKey.get("not_interested").id && !L.revisit_at);
    const reasons = Object.fromEntries(c.reasons.map((x) => [x.reason_key, x.id]));
    r = await call("leadLost", B.token, ids[2], { reasonId: reasons.not_now, note: "Opening in December" });
    L = await M.CrmLeadV2.findByPk(ids[2]);
    check("not now: revisit in 30 days", r.ok && Math.round((new Date(L.revisit_at) - Date.now()) / 86400000) === 30);
    r = await call("leads", B.token, { view: "revisit" });
    check("revisit view lists it", r.ok && r.result.leads.some((l) => l.id === ids[2]));
    await L.update({ revisit_at: new Date(Date.now() - 60000) });
    let sw = JSON.parse(await jobs.sweep({ only: await mine() }));
    L = await M.CrmLeadV2.findByPk(ids[2]);
    check("sweep reopens it on the revisit date with a call", sw.revisited >= 1 && L.stage_id === c.stageByKey.get("contacted").id && !L.revisit_at && /Revisit/.test(L.next_action_note), [sw, L.next_action_note]);
    check("owner told to revisit", (await M.AdmNotification.count({ where: { user_id: B.u.id, type: "lead.revisit" } })) === 1);

    const lostAgain = await intake.receive({ source: "meta", name: "Lead 2", phone: phone(2), message: "Changed my mind" });
    L = await M.CrmLeadV2.findByPk(ids[1]);
    check("a lost lead enquiring again is reopened", lostAgain.reopened && c.stageById.get(L.stage_id).kind === "open" && /Enquired again/.test(L.next_action_note), lostAgain);

    /* ---------- sweep ---------- */
    console.log("\nSweep");
    await M.CrmTaskV2.update({ status: "cancelled" }, { where: { lead_id: ids[3], status: "open" } });
    await M.CrmLeadV2.update({ next_action_at: null, next_action_type: null }, { where: { id: ids[3] } });
    sw = JSON.parse(await jobs.sweep({ only: await mine() }));
    L = await M.CrmLeadV2.findByPk(ids[3]);
    check("an open lead with no next action gets one", sw.repaired >= 1 && L.next_action_note === "Set the next action", sw);

    await M.AdmUser.update({ status: "disabled" }, { where: { id: B.u.id } });
    sw = JSON.parse(await jobs.sweep({ only: await mine() }));
    const bOpen = await M.CrmLeadV2.count({ where: { owner_id: B.u.id, stage_id: c.openStageIds } });
    check("a switched-off person's open leads move to someone who can take them", sw.reassigned >= 1 && bOpen === 0, sw);
    const moved = await M.CrmLeadV2.findByPk(ids[4]);
    check("their open tasks move with the lead", (await M.CrmTaskV2.count({ where: { lead_id: moved.id, status: "open", owner_id: moved.owner_id } })) >= 1 && moved.owner_id !== B.u.id);
    await M.AdmUser.update({ status: "active" }, { where: { id: B.u.id } });

    /* ---------- unassigned ---------- */
    await M.AdmUser.update({ daily_lead_cap: null }, { where: { id: [A.u.id, B.u.id, C.u.id, D.u.id] } });
    const orphan = await intake.receive({ source: "website", name: "No owner", phone: phone(8) });
    L = await M.CrmLeadV2.findByPk(orphan.leadId);
    check("nobody in the rotation: lead waits unassigned, admins told", !L.owner_id && (await M.AdmNotification.count({ where: { user_id: admin.u.id, type: "lead.unassigned" } })) === 1);
    r = await call("leads", admin.token, { view: "unassigned", q: phone(8) });
    check("admin's unassigned view shows it", r.ok && r.result.leads.some((l) => l.id === orphan.leadId), r.result && r.result.counts);
    await M.AdmUser.update({ daily_lead_cap: 3 }, { where: { id: A.u.id } });
    sw = JSON.parse(await jobs.sweep({ only: await mine() }));
    L = await M.CrmLeadV2.findByPk(orphan.leadId);
    check("sweep assigns it once someone can take leads", sw.assigned >= 1 && L.owner_id === A.u.id, sw);
    r = await call("leadOutcome", admin.token, orphan.leadId, { outcomeId: o.callback, next: { type: "call", dueAt: soon(60) } });
    check("admin can work any lead", r.ok, r);

    /* ---------- merge ---------- */
    console.log("\nMerge, My Day, pipeline");
    const other = await intake.receive({ source: "website", name: "Lead 1 office", phone: phone(9), email: "office@example.com" });
    await M.CrmLeadV2.update({ owner_id: A.u.id }, { where: { id: other.leadId } });
    r = await call("leadMerge", A.token, other.leadId, ids[0]);
    check("salesperson cannot merge", !r.ok, r);
    r = await call("leadMerge", admin.token, other.leadId, ids[0]);
    const merged = await M.CrmLeadV2.findByPk(other.leadId);
    check("merge: duplicate closed into the kept lead, inquiries moved", r.ok && merged.merged_into_id === ids[0] && (await M.CrmInquiry.count({ where: { lead_id: ids[0] } })) === 3, r);
    check("merged lead leaves the lists", !(await call("leads", admin.token, { view: "all" })).result.leads.some((l) => l.id === other.leadId));

    /* ---------- my day / pipeline ---------- */
    await M.CrmTaskV2.update({ due_at: new Date(Date.now() - 2 * 3600000) }, { where: { lead_id: ids[0], status: "open" } });
    await M.CrmLeadV2.update({ next_action_at: new Date(Date.now() - 2 * 3600000) }, { where: { id: ids[0] } });
    r = await call("myDay", A.token);
    const md = r.result;
    const dues = md.overdue.map((x) => new Date(x.dueAt).getTime());
    check("My Day: the late demo is overdue, list oldest first", r.ok && md.overdue.some((x) => x.lead.id === ids[0]) && dues.every((d, i) => i === 0 || dues[i - 1] <= d), md && md.overdue.map((x) => x.lead.id));
    check("My Day: counts and today's numbers", md.counts.overdue >= 1 && md.today.calls >= 2 && md.today.outcomes >= 3, md && md.today);
    check("My Day: no lead twice", (() => {
        const all = [...md.overdue, ...md.waiting, ...md.later].map((x) => x.lead.id);
        return all.length === new Set(all).size;
    })());
    r = await call("myDay", D.token);
    check("My Day shows the break", r.ok && r.result.breakUntil && r.result.breakKind === "tea", r.result && r.result.breakUntil);
    r = await call("breakEnd", D.token);
    check("break ended", r.ok && (await call("myDay", D.token)).result.breakUntil === null);
    r = await call("pipeline", A.token, { owner: "mine" });
    check("pipeline: five open stages with A's leads", r.ok && r.result.columns.length === 5 && r.result.columns.reduce((a, col) => a + col.count, 0) >= 3, r.result && r.result.columns.map((x) => [x.stage.key, x.count]));
    r = await call("pipeline", A.token, { owner: "all" });
    check("pipeline 'all' for a salesperson still shows only their own", r.ok && r.result.columns.every((col) => col.leads.every((l) => l.owner && l.owner.id === A.u.id)));

    /* ---------- detail + timeline ---------- */
    detail = (await call("lead", A.token, ids[0])).result;
    const types = detail.timeline.map((t) => t.type);
    check("timeline: created, owner, inquiry, outcome, merge", ["created", "owner", "inquiry", "outcome", "merge"].every((t) => types.includes(t)), types);
    check("score explained", Array.isArray(detail.lead.scoreReasons) && detail.lead.scoreReasons.length >= 2);

    /* ---------- config ---------- */
    console.log("\nSettings: stages, outcomes, reasons");
    r = await call("crmStageSave", A.token, { id: c.stageByKey.get("demo").id, name: "Demo" });
    check("salesperson cannot change stages", !r.ok, r);
    r = await call("crmStageSave", admin.token, { id: c.stageByKey.get("proposal").id, name: `Proposal ${stamp}`, sort: 5 });
    check("admin renames a stage", r.ok && (await config.view()).stages.find((x) => x.key === "proposal").name === `Proposal ${stamp}`);
    await call("crmStageSave", admin.token, { id: c.stageByKey.get("proposal").id, name: "Proposal and payment", sort: 5 });
    r = await call("crmOutcomeSave", admin.token, { name: `Visited outlet ${stamp}`, reached: true, nextType: "proposal", nextAfterMinutes: 60 });
    check("admin adds an outcome", r.ok, r);
    r = await call("crmOutcomeSave", admin.token, { name: "Bad", lostReason: "nope" });
    check("outcome with an unknown lost reason refused", !r.ok, r);
    await M.CrmOutcome.destroy({ where: { outcome_key: { [Op.like]: `visited_outlet_${stamp}` } } });
    config.invalidate();

    /* ---------- worker schedule ---------- */
    const before = await M.CrmJob.count({ where: { kind: "crm.sweep" } });
    await worker.queueSchedules();
    await worker.queueSchedules();
    check("sweep scheduled once per slot", (await M.CrmJob.count({ where: { kind: "crm.sweep" } })) === before + 1);
}

async function cleanup() {
    const leadIds = (await M.CrmLeadV2.findAll({ where: { phone_key: { [Op.like]: `9%${stamp}` } }, attributes: ["id"], raw: true })).map((l) => l.id);
    if (leadIds.length) {
        for (const m of [M.CrmInquiry, M.CrmTaskV2, M.CrmActivity, M.CrmCall, M.CrmAssignment]) await m.destroy({ where: { lead_id: leadIds } });
        await M.CrmLeadV2.destroy({ where: { id: leadIds } });
    }
    if (created.users.length) {
        await M.AdmNotification.destroy({ where: { user_id: created.users } });
        await M.AdmBreak.destroy({ where: { user_id: created.users } });
        await M.AdmLeave.destroy({ where: { user_id: created.users } });
        await M.AdmSession.destroy({ where: { user_id: created.users } });
        await M.AdmAuditLog.destroy({ where: { actor_id: created.users } });
        await M.AdmUser.destroy({ where: { id: created.users } });
    }
    await M.CrmEvent.destroy({ where: { entity: "crm_lead", entity_id: leadIds.map(String) } });
    await M.CrmJob.destroy({ where: { kind: ["crm.sweep", "crm.rescore"], status: "queued" } });
    for (const u of restore.users) await M.AdmUser.update({ daily_lead_cap: u.daily_lead_cap }, { where: { id: u.id } });
    await M.AdmSetting.destroy({ where: { setting_key: ["working_hours", "timers"] } });
    if (restore.settings.length) await M.AdmSetting.bulkCreate(restore.settings);
}

(async () => {
    await ensureDefaultRoles(M.AdmRole);
    await config.ensureDefaults();
    // Other people in the test DB leave the rotation for this run.
    restore.users = await M.AdmUser.findAll({ where: { daily_lead_cap: { [Op.ne]: null } }, attributes: ["id", "daily_lead_cap"], raw: true });
    await M.AdmUser.update({ daily_lead_cap: null }, { where: { id: restore.users.map((u) => u.id) } });
    restore.settings = await M.AdmSetting.findAll({ where: { setting_key: ["working_hours", "timers"] }, raw: true });

    const app = express();
    app.use(express.json());
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
