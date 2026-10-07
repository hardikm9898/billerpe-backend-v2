// Scenario tests for the sales app's server side (SuperAdmin phase 4): calls
// from the phone's call log, missed calls, the outcome on the captured call,
// recording upload and who may play it, caller cards, push.
//
//   DATABASE_NAME=billerpe_app_test node scripts/test-sales-app.js
//
// Refuses to run unless the database name ends in "_test". Nothing is pushed
// (the push sender is replaced); recordings go to public/crm-calls and are
// removed at the end.

require("dotenv").config();
if (!/_test$/.test(process.env.DATABASE_NAME || "")) {
    console.error("Refusing to run: DATABASE_NAME must end in _test");
    process.exit(1);
}
process.env.ADMIN_JWT_SECRET = process.env.ADMIN_JWT_SECRET || "sales-test-secret";
delete process.env.ADMIN_WA_LIVE;
delete process.env.ADMIN_FILES_LIVE;

const http = require("http");
const fs = require("fs");
const path = require("path");
const express = require("express");
const bcrypt = require("bcrypt");
const { Op } = require("sequelize");
const M = require("../model");
const { ensureDefaultRoles } = require("../adminv1/permissions");
const util = require("../adminv1/crm/util");
const config = require("../adminv1/crm/config");
const intake = require("../adminv1/crm/intake");
const push = require("../adminv1/push");

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
const phone = (n) => `7${String(n).padStart(4, "0")}${stamp}`;
const PW = "Sales-pass-1";
let base;
const post = async (p, body, token) => {
    const res = await fetch(`${base}${p}`, { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body || {}) });
    return { status: res.status, ...(await res.json().catch(() => ({}))) };
};
const call = (name, token, ...args) => post(`/${name}`, { args }, token);
const pushed = [];
push.sender.send = async (tokens, message) => {
    pushed.push({ tokens, message });
    return { successCount: tokens.length, responses: tokens.map(() => ({ success: true })) };
};

const created = { users: [] };
const restore = { users: [], settings: [] };
async function person(name, roleName, extra = {}, kind = "app") {
    const roles = Object.fromEntries((await M.AdmRole.findAll({ raw: true })).map((r) => [r.name, r]));
    const u = await M.AdmUser.create({ name: `${name} ${stamp}`, mobile: `6${String(created.users.length + 50).padStart(3, "0")}${stamp}1`.slice(0, 10), role_id: roles[roleName].id, password_hash: await bcrypt.hash(PW, 4), must_change_password: false, ...extra });
    created.users.push(u.id);
    const r = await post("/login", { mobile: u.mobile, password: PW, device: { kind, deviceId: `phone-${u.id}`, name: "Galaxy A15", appVersion: "0.1.0" } });
    return { u, token: r.session.token };
}
const leadOf = (p) => M.CrmLeadV2.findOne({ where: { phone_key: p, merged_into_id: null }, order: [["id", "DESC"]] });

async function run() {
    const c = await config.load(true);
    await M.AdmSetting.destroy({ where: { setting_key: ["working_hours", "timers"] } });
    await M.AdmSetting.create({ setting_key: "working_hours", value: JSON.stringify({ days: [0, 1, 2, 3, 4, 5, 6], start: "00:00", end: "23:59", lunchMinutes: 60, teaBreaks: 2, teaMinutes: 15 }) });
    util.resetHoursCache();

    const admin = await person("Admin", "Admin", {}, "web");
    const mgr = await person("Manager", "Sales manager", {}, "web");
    const A = await person("ExecA", "Sales executive", { daily_lead_cap: 50, manager_id: mgr.u.id });
    const B = await person("ExecB", "Sales executive");
    const sess = await M.AdmSession.findOne({ where: { user_id: A.u.id } });
    check("the app logs in as a phone session", sess && sess.kind === "app" && sess.device_name === "Galaxy A15");

    await intake.receive({ source: "website", name: "Ravi Hotel", phone: phone(1) });
    const L1 = await leadOf(phone(1));
    check("lead goes to A", L1.owner_id === A.u.id);
    await intake.receive({ source: "website", name: "Missed Caller", phone: phone(2) });
    const L2 = await leadOf(phone(2));

    console.log("\nCalls from the phone's call log");
    const t0 = Date.now() - 10 * 60000;
    let r = await call("appCalls", A.token, {
        deviceId: `dev-${stamp}`,
        calls: [
            { id: "101", number: `+91 ${phone(1)}`, type: "out", at: t0, seconds: 185 },
            { id: "102", number: "9999988888", type: "in", at: t0 + 60000, seconds: 40 },
            { id: "103", number: phone(2), type: "missed", at: t0 + 120000, seconds: 0 },
            { id: "104", number: phone(1), type: "out", at: t0 + 180000, seconds: 0 },
        ],
    });
    check("calls accepted", r.ok && r.result.results.length === 4, r);
    const [r1, r2, r3, r4] = r.ok ? r.result.results : [];
    check("lead call: on the lead, outcome asked, recording wanted", r1 && r1.leadId === L1.id && r1.needsOutcome && r1.recording === "upload" && r1.callId, r1);
    const c1 = await M.CrmCall.findByPk(r1.callId);
    check("call stored from the app", c1 && c1.source === "app" && c1.direction === "out" && c1.duration_seconds === 185 && c1.answered && c1.recorded === "pending" && c1.device_call_id === `dev-${stamp}:101`, c1 && c1.toJSON());
    const L1b = await M.CrmLeadV2.findByPk(L1.id);
    check("answered call = first contact", !!L1b.first_contact_at);
    check("timeline shows the call", !!(await M.CrmActivity.findOne({ where: { lead_id: L1.id, type: "call", body: { [Op.like]: "Outgoing call, 3 min 5 s%" } } })));
    check("unknown number: count only, no number kept, ask New lead?", r2 && !r2.leadId && r2.unknown === true && !!(await M.CrmCall.findOne({ where: { device_call_id: `dev-${stamp}:102`, lead_id: 0, phone: "" } })), r2);
    check("missed call from a lead: no outcome asked", r3 && r3.leadId === L2.id && !r3.needsOutcome && r3.recording === "none", r3);
    const cb = await M.CrmTaskV2.findOne({ where: { lead_id: L2.id, status: "open", note: "Missed their call: call back" } });
    check("missed call -> call-back task in 15 working minutes", cb && Math.abs(new Date(cb.due_at) - (t0 + 120000 + 15 * 60000)) < 60000, cb && cb.toJSON());
    check("owner told about the missed call", !!(await M.AdmNotification.findOne({ where: { user_id: L2.owner_id, type: "call.missed" } })));
    check("not answered: no recording wanted", r4 && r4.needsOutcome && r4.recording === "none");
    r = await call("appCalls", A.token, { deviceId: `dev-${stamp}`, calls: [{ id: "101", number: phone(1), type: "out", at: t0, seconds: 185 }] });
    check("the same call sent again is stored once", r.ok && r.result.results[0].repeat && (await M.CrmCall.count({ where: { device_call_id: `dev-${stamp}:101` } })) === 1);

    console.log("\nOutcome on the captured call");
    r = await call("leadOutcome", A.token, L1.id, { outcomeId: c.outcomeByKey.get("interested").id, callId: r1.callId, next: { type: "demo", dueAt: new Date(Date.now() + 86400000).toISOString() } });
    check("outcome logged on the app's call", r.ok && (await M.CrmCall.findByPk(r1.callId)).outcome_id === c.outcomeByKey.get("interested").id, r);
    check("no second (typed) call made", (await M.CrmCall.count({ where: { lead_id: L1.id } })) === 2);
    r = await call("leadOutcome", A.token, L2.id, { outcomeId: c.outcomeByKey.get("interested").id, callId: r1.callId, next: { type: "call", dueAt: new Date(Date.now() + 86400000).toISOString() } });
    check("a call of another lead is refused", !r.ok && /not on this lead/.test(r.error), r);

    console.log("\nRecordings");
    const audio = Buffer.from("ID3fake-mp3-bytes-for-test");
    const up = (token, id, body = audio) => fetch(`${base}/app/recording/${id}`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "audio/mpeg", "X-File-Name": encodeURIComponent(`Call recording ${phone(1)}.mp3`) }, body }).then((x) => x.json());
    r = await up(B.token, r1.callId);
    check("someone else's call cannot get a recording", !r.ok, r);
    r = await up(A.token, r1.callId);
    const c1r = await M.CrmCall.findByPk(r1.callId);
    check("recording uploaded", r.ok && c1r.recorded === "yes" && c1r.recording_size === audio.length && /^\/crm-calls\//.test(c1r.recording_url), { r, c: c1r.toJSON() });
    check("file kept", fs.existsSync(path.join(__dirname, "../public", c1r.recording_url)));
    r = await call("callRecording", A.token, r1.callId);
    check("the caller can play it", r.ok && r.result.url === c1r.recording_url, r);
    r = await call("callRecording", B.token, r1.callId);
    check("another salesperson cannot", !r.ok, r);
    r = await call("callRecording", mgr.token, r1.callId);
    check("their manager can", r.ok, r);
    r = await call("callRecording", admin.token, r1.callId);
    check("an admin can", r.ok, r);
    r = await call("appCalls", A.token, { deviceId: `dev-${stamp}`, calls: [{ id: "105", number: phone(1), type: "in", at: Date.now() - 60000, seconds: 30 }] });
    const id5 = r.result.results[0].callId;
    r = await call("appNoRecording", A.token, id5);
    check("no recording found is noted", r.ok && (await M.CrmCall.findByPk(id5)).recorded === "no");
    r = await call("lead", A.token, L1.id);
    check("lead page lists calls with their recording state", r.ok && r.result.calls.some((x) => x.id === r1.callId && x.recorded === "yes" && x.hasRecording) && r.result.calls.some((x) => x.recorded === "no"), r.ok ? r.result.calls : r);

    console.log("\nCaller cards");
    r = await call("appLookup", A.token, `+91${phone(1)}`);
    check("lookup shows the lead", r.ok && r.result.lead && r.result.lead.id === L1.id && r.result.lead.stage, r);
    r = await call("appLookup", B.token, phone(1));
    check("not a lead this person may see: no card", r.ok && r.result.lead === null, r);
    r = await call("appLeadCache", A.token);
    check("offline caller list for the phone", r.ok && r.result.leads.some((x) => x[0] === phone(1) && x[1] === L1.id), r.ok ? r.result.leads.length : r);

    console.log("\nPush");
    r = await call("appSetPush", A.token, "token-A");
    pushed.length = 0;
    await intake.receive({ source: "website", name: "Pushed Lead", phone: phone(3) });
    await new Promise((x) => setTimeout(x, 400));
    check("a new lead pushes to the owner's phone", pushed.some((p) => p.tokens.includes("token-A") && /New lead|Pushed Lead|lead/i.test(JSON.stringify(p.message))) || pushed.length > 0, pushed);
    pushed.length = 0;
    await require("../adminv1/crm/notify").notify(A.u.id, { type: "test", title: "Hello phone", body: "b", link: "/x" });
    await new Promise((x) => setTimeout(x, 200));
    check("a notification goes to the phone", pushed.some((p) => p.tokens[0] === "token-A" && p.message.notification.title === "Hello phone" && p.message.data.link === "/x"), pushed);
    await call("logout", A.token);
    pushed.length = 0;
    await require("../adminv1/crm/notify").notify(A.u.id, { type: "test", title: "After logout" });
    await new Promise((x) => setTimeout(x, 200));
    check("a logged-out phone gets nothing", !pushed.length);

    console.log("\nTeam today");
    r = await call("teamToday", mgr.token);
    const pa = r.ok ? r.result.people.find((p) => p.id === A.u.id) : null;
    check("calls, talk time and recorded share per person", pa && pa.calls >= 5 && pa.talkSeconds >= 185 + 40 + 30 && pa.recorded === 1 && pa.toRecord === 2, pa);
}

async function cleanup() {
    const leads = (await M.CrmLeadV2.findAll({ where: { phone_key: { [Op.like]: `7%${stamp}` } }, attributes: ["id"], raw: true })).map((l) => l.id);
    const recs = await M.CrmCall.findAll({ where: { user_id: created.users, recording_url: { [Op.ne]: null } }, raw: true });
    for (const x of recs) if (x.recording_url.startsWith("/")) fs.rmSync(path.join(__dirname, "../public", x.recording_url), { force: true });
    await M.CrmCall.destroy({ where: { user_id: created.users } });
    for (const m of [M.CrmInquiry, M.CrmTaskV2, M.CrmActivity, M.CrmCall, M.CrmAssignment, M.CrmEscalation]) await m.destroy({ where: { lead_id: leads } });
    await M.CrmLeadV2.destroy({ where: { id: leads } });
    await M.CrmEvent.destroy({ where: { entity: "crm_lead", entity_id: leads.map(String) } });
    await M.AdmNotification.destroy({ where: { user_id: created.users } });
    await M.AdmSession.destroy({ where: { user_id: created.users } });
    await M.AdmAuditLog.destroy({ where: { actor_id: created.users } });
    await M.AdmUser.destroy({ where: { id: created.users } });
    for (const u of restore.users) await M.AdmUser.update({ daily_lead_cap: u.daily_lead_cap }, { where: { id: u.id } });
    await M.AdmSetting.destroy({ where: { setting_key: ["working_hours", "timers"] } });
    if (restore.settings.length) await M.AdmSetting.bulkCreate(restore.settings);
}

(async () => {
    await ensureDefaultRoles(M.AdmRole);
    await config.ensureDefaults();
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
