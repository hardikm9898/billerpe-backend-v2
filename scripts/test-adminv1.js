// Scenario tests for the BillerPe SuperAdmin foundation (/admin/v1, the
// event log, the job queue and the worker) against a real MySQL database.
//
//   DATABASE_NAME=billerpe_app_test node scripts/test-adminv1.js
//
// Refuses to run against any database whose name does not end in "_test".
// Every run uses fresh mobile numbers and deletes what it created.

require("dotenv").config();
if (!/_test$/.test(process.env.DATABASE_NAME || "")) {
    console.error("Refusing to run: DATABASE_NAME must end in _test");
    process.exit(1);
}
process.env.ADMIN_JWT_SECRET = process.env.ADMIN_JWT_SECRET || "adminv1-test-secret";

const http = require("http");
const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { Op } = require("sequelize");
const M = require("../model");
const { ensureDefaultRoles } = require("../adminv1/permissions");
const queue = require("../services/admin/queue");
const worker = require("../services/admin/worker");

let passed = 0;
const failures = [];
function check(name, ok, detail) {
    if (ok) {
        passed += 1;
        console.log(`  ok   ${name}`);
    } else {
        failures.push(name);
        console.log(`  FAIL ${name}${detail !== undefined ? `  ${JSON.stringify(detail).slice(0, 400)}` : ""}`);
    }
}

const stamp = String(Date.now()).slice(-6);
const mobile = (n) => `7${n}${stamp}`.padEnd(10, "0").slice(0, 10);
const ADMIN_PW = "Admin-pass-1";
let base;

async function post(path, body, token) {
    const res = await fetch(`${base}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(body || {}),
    });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, ...json };
}
const call = (name, token, ...args) => post(`/${name}`, { args }, token);
const web = (name) => ({ kind: "web", deviceId: `web-${name}-${stamp}`, name });
const login = (m, password, dev = web("Chrome")) => post("/login", { mobile: m, password, device: dev });

const start = {};

async function run() {
    for (const [k, model] of [["audit", M.AdmAuditLog], ["event", M.CrmEvent], ["job", M.CrmJob]]) start[k] = (await model.max("id")) || 0;
    // Settings are global: start from the defaults, put the rows back at the end.
    const settingsBefore = await M.AdmSetting.findAll({ raw: true });
    await M.AdmSetting.destroy({ where: {} });

    await ensureDefaultRoles(M.AdmRole);
    const roles = Object.fromEntries((await M.AdmRole.findAll({ raw: true })).map((r) => [r.name, r]));
    check("five built-in roles exist", ["Admin", "Sales manager", "Sales executive", "Customer success", "Support"].every((n) => roles[n] && roles[n].is_system));

    const ADMIN = mobile(1);
    const admin = await M.AdmUser.create({ name: `Test Admin ${stamp}`, mobile: ADMIN, role_id: roles.Admin.id, password_hash: await bcrypt.hash(ADMIN_PW, 4), must_change_password: true });

    /* ---------- login ---------- */
    console.log("\nLogin and sessions");
    let r = await login(ADMIN, "nope");
    check("wrong password refused", !r.ok && r.error === "wrong-password", r);
    r = await login(`+91 ${ADMIN.slice(0, 5)} ${ADMIN.slice(5)}`, ADMIN_PW);
    check("login with +91 and spaces works", r.ok && r.session.token && r.session.user.mustChangePassword === true, r);
    let adminToken = r.session.token;
    check("login answer carries role and permissions", r.session.user.role.name === "Admin" && r.session.user.permissions.includes("*"), r.session.user);

    r = await call("staffList", adminToken);
    check("temporary password blocks other calls", !r.ok && r.code === "change-password", r);
    r = await call("me", adminToken);
    check("me allowed before the password change", r.ok && r.result.user.id === admin.id, r);

    const second = await login(ADMIN, ADMIN_PW, web("Firefox"));
    check("second browser logs in", second.ok, second);

    r = await call("changePassword", adminToken, "wrong", "Better-pass-2");
    check("change password needs the current one", !r.ok && /current password/.test(r.error), r);
    r = await call("changePassword", adminToken, ADMIN_PW, "short1");
    check("weak password refused", !r.ok && /8 characters/.test(r.error), r);
    r = await call("changePassword", adminToken, ADMIN_PW, "Better-pass-2");
    check("password changed", r.ok && r.result.user.mustChangePassword === false, r);
    r = await call("staffList", adminToken);
    check("this session keeps working after the change", r.ok, r);
    r = await call("me", second.session.token);
    check("other browser logged out by the password change", r.status === 401 && r.code === "session-ended", r);

    const ownerToken = jwt.sign({ typ: "owner-app", sid: 1, uid: admin.id }, process.env.ADMIN_JWT_SECRET);
    r = await call("me", ownerToken);
    check("a token of another app is refused", r.status === 401, r);
    r = await post("/resume", { token: adminToken });
    check("resume accepts a live token", r.ok && r.session.user.id === admin.id, r);
    r = await post("/resume", { token: "garbage" });
    check("resume refuses a bad token", !r.ok && r.error === "session-ended", r);

    const LOCKME = mobile(9);
    await M.AdmUser.create({ name: `Lock ${stamp}`, mobile: LOCKME, role_id: roles.Support.id, password_hash: await bcrypt.hash("Right-pass-1", 4), must_change_password: false });
    for (let i = 0; i < 5; i++) await login(LOCKME, "bad");
    r = await login(LOCKME, "Right-pass-1");
    check("5 wrong passwords lock the mobile", !r.ok && r.error === "locked", r);

    /* ---------- staff ---------- */
    console.log("\nStaff, teams, leave");
    const EXEC = mobile(2);
    r = await call("staffSave", adminToken, { name: "", mobile: EXEC, roleId: roles["Sales executive"].id });
    check("name required", !r.ok && /name/.test(r.error), r);
    r = await call("staffSave", adminToken, { name: "Priya", mobile: "12345", roleId: roles["Sales executive"].id });
    check("10-digit mobile required", !r.ok && /10-digit/.test(r.error), r);
    r = await call("staffSave", adminToken, { name: "Priya", mobile: ADMIN, roleId: roles["Sales executive"].id });
    check("duplicate mobile refused", !r.ok && /already uses/.test(r.error), r);
    r = await call("staffSave", adminToken, { name: "Priya", mobile: EXEC, roleId: roles["Sales executive"].id, shiftStart: "19:00", shiftEnd: "10:30" });
    check("shift must end after it starts", !r.ok && /end after/.test(r.error), r);
    r = await call("staffSave", adminToken, { name: "Priya", mobile: EXEC, roleId: 999999 });
    check("role required", !r.ok && /role/.test(r.error), r);

    r = await call("teamSave", adminToken, { name: `Sales ${stamp}`, managerId: admin.id });
    check("team created", r.ok && r.result.id, r);
    const teamId = r.result.id;
    r = await call("staffSave", adminToken, { name: "Priya", mobile: EXEC, email: "priya@example.com", roleId: roles["Sales executive"].id, teamId, managerId: admin.id, shiftStart: "10:30", shiftEnd: "19:00", dailyLeadCap: 50 });
    check("salesperson created with a temporary password", r.ok && /^[A-Za-z2-9]{10}$/.test(r.result.temporaryPassword || ""), r);
    const execId = r.result.id;
    const execTemp = r.result.temporaryPassword;
    const execRow = await M.AdmUser.findOne({ where: { id: execId }, raw: true });
    check("stored as bcrypt, never plain", execRow.password_hash.startsWith("$2") && execRow.password_hash !== execTemp);

    r = await login(EXEC, execTemp, { kind: "app", deviceId: `app-${stamp}`, name: "Samsung A35", appVersion: "0.1.0" });
    check("salesperson logs in from the sales app", r.ok && r.session.user.mustChangePassword, r);
    let execToken = r.session.token;
    r = await call("changePassword", execToken, execTemp, "Priya-pass-1");
    check("salesperson sets own password", r.ok, r);
    r = await call("staffList", execToken);
    check("salesperson cannot see the staff list", !r.ok && /permission/.test(r.error), r);
    r = await call("settingSave", execToken, "timers", { firstContactMinutes: 5, managerActMinutes: 5, overdueToManagerMinutes: 5, overdueToAdminMinutes: 5 });
    check("salesperson cannot change settings", !r.ok && /permission/.test(r.error), r);
    r = await call("auditLog", execToken, {});
    check("salesperson cannot read the audit log", !r.ok && /permission/.test(r.error), r);
    r = await call("people", execToken);
    check("salesperson sees names for pickers", r.ok && r.result.people.some((p) => p.id === admin.id) && r.result.people.every((p) => !("mobile" in p)), r);

    r = await call("staffList", adminToken);
    const listed = r.ok && r.result.staff.find((p) => p.id === execId);
    check("staff list shows role, team, shift, cap", listed && listed.role === "Sales executive" && listed.team === `Sales ${stamp}` && listed.shiftStart === "10:30" && listed.dailyLeadCap === 50, listed);

    r = await call("staffSave", adminToken, { id: execId, name: "Priya S", mobile: EXEC, roleId: roles["Sales executive"].id, teamId, managerId: execId });
    check("cannot be own manager", !r.ok && /own manager/.test(r.error), r);
    r = await call("staffSave", adminToken, { id: execId, name: "Priya S", mobile: EXEC, roleId: roles["Sales executive"].id, teamId, managerId: admin.id, dailyLeadCap: 40 });
    check("salesperson edited", r.ok, r);

    r = await call("leaveSave", adminToken, { userId: execId, from: "2026-10-20", to: "2026-10-19" });
    check("leave must end on or after its start", !r.ok, r);
    r = await call("leaveSave", adminToken, { userId: execId, from: "2099-01-10", to: "2099-01-12", note: "Wedding" });
    check("leave added", r.ok, r);
    const leaveId = r.result.id;
    r = await call("leaves", execToken, {});
    check("salesperson sees own leave", r.ok && r.result.leaves.some((l) => l.id === leaveId && l.from === "2099-01-10"), r);
    r = await call("leaveSave", execToken, { userId: execId, from: "2099-02-01", to: "2099-02-01" });
    check("salesperson cannot add leave", !r.ok, r);
    r = await call("leaveDelete", adminToken, leaveId);
    check("leave removed", r.ok, r);

    r = await call("staffSetStatus", adminToken, execId, false, "");
    check("switching off needs a reason", !r.ok && /why/.test(r.error), r);
    r = await call("staffSetStatus", adminToken, admin.id, false, "test");
    check("cannot switch off yourself", !r.ok && /own login/.test(r.error), r);
    r = await call("staffSetStatus", adminToken, execId, false, "Left the company");
    check("salesperson switched off", r.ok && r.result.status === "disabled", r);
    r = await call("me", execToken);
    check("switched-off person's session ends", r.status === 401, r);
    r = await login(EXEC, "Priya-pass-1");
    check("switched-off person cannot log in", !r.ok && r.error === "disabled", r);
    r = await call("staffSetStatus", adminToken, execId, true);
    check("switched back on", r.ok && r.result.status === "active", r);
    r = await login(EXEC, "Priya-pass-1");
    execToken = r.session && r.session.token;
    check("logs in again after switching on", r.ok, r);

    r = await call("staffResetPassword", adminToken, execId);
    check("password reset gives a new temporary password", r.ok && r.result.temporaryPassword && r.result.temporaryPassword !== execTemp, r);
    r = await call("me", execToken);
    check("reset ends the person's sessions", r.status === 401, r);

    /* ---------- the last admin ---------- */
    console.log("\nAdmin protection and roles");
    r = await call("staffSave", adminToken, { id: admin.id, name: admin.name, mobile: ADMIN, roleId: roles["Sales executive"].id });
    const otherAdmins = await M.AdmUser.count({ where: { role_id: roles.Admin.id, status: "active", id: { [Op.ne]: admin.id } } });
    if (otherAdmins === 0) check("the only admin cannot drop the Admin role", !r.ok && /Admin role/.test(r.error), r);
    else check("role change allowed while another admin exists (test DB has one)", r.ok, r);
    if (r.ok) await M.AdmUser.update({ role_id: roles.Admin.id }, { where: { id: admin.id } });

    r = await call("roles", adminToken);
    check("roles list with the permission catalog", r.ok && r.result.catalog.length > 10 && r.result.roles.find((x) => x.name === "Admin").permissions.includes("*"), r);
    r = await call("roleSave", adminToken, { id: roles["Sales executive"].id, name: "Sellers", permissions: ["leads.view_own"] });
    check("built-in role keeps its name", !r.ok && /keep their name/.test(r.error), r);
    r = await call("roleSave", adminToken, { name: `Trainee ${stamp}`, permissions: ["leads.view_own", "not.a.permission"] });
    check("custom role created", r.ok, r);
    const traineeId = r.result.id;
    const trainee = await M.AdmRole.findOne({ where: { id: traineeId }, raw: true });
    check("unknown permission keys are dropped", JSON.parse(trainee.permissions).join() === "leads.view_own", trainee.permissions);
    await M.AdmUser.update({ role_id: traineeId }, { where: { id: execId } });
    r = await call("roleDelete", adminToken, traineeId);
    check("role in use cannot be deleted", !r.ok && /Give them another role/.test(r.error), r);
    await M.AdmUser.update({ role_id: roles["Sales executive"].id }, { where: { id: execId } });
    r = await call("roleDelete", adminToken, traineeId);
    check("unused custom role deleted", r.ok, r);
    r = await call("roleDelete", adminToken, roles.Support.id);
    check("built-in role cannot be deleted", !r.ok, r);

    /* ---------- settings ---------- */
    console.log("\nSettings");
    r = await call("settings", adminToken);
    const st = r.ok && r.result.settings;
    check("defaults: Mon-Sat 10:30-19:00, 15 min first contact, demo GSTIN, AI all day",
        st && st.working_hours.days.join() === "1,2,3,4,5,6" && st.working_hours.start === "10:30" && st.timers.firstContactMinutes === 15 && st.company.gstinIsDemo && st.whatsapp_ai.aiAllDay, st);
    r = await call("settingSave", adminToken, "working_hours", { days: [1, 2], start: "19:00", end: "10:30", lunchMinutes: 60, teaBreaks: 2, teaMinutes: 15 });
    check("working day must end after it starts", !r.ok, r);
    r = await call("settingSave", adminToken, "working_hours", { days: [1, 2, 3, 4, 5, 6], start: "11:00", end: "19:00", lunchMinutes: 60, teaBreaks: 2, teaMinutes: 15 });
    check("working hours saved", r.ok && r.result.value.start === "11:00", r);
    r = await call("settingSave", adminToken, "company", { ...st.company, gstin: "12345" });
    check("bad GSTIN refused", !r.ok && /GSTIN/.test(r.error), r);
    r = await call("settingSave", adminToken, "company", { ...st.company, gstin: "27ABCDE1234F1Z5", state: "Maharashtra" });
    check("real-looking GSTIN clears the demo flag and sets the state code", r.ok && r.result.value.gstinIsDemo === false && r.result.value.stateCode === "27", r);
    r = await call("settingSave", adminToken, "nope", {});
    check("unknown setting refused", !r.ok, r);

    /* ---------- audit ---------- */
    console.log("\nAudit log");
    r = await call("auditLog", adminToken, {});
    const entries = r.ok ? r.result.entries : [];
    const mine = entries.filter((e) => Number(e.id) > start.audit);
    check("logins, staff, roles, leave and settings changes are audited",
        ["auth.login", "staff.create", "staff.update", "staff.disable", "staff.enable", "staff.reset_password", "role.create", "role.delete", "leave.create", "leave.delete", "settings.update", "auth.change_password"].every((a) => mine.some((e) => e.action === a)),
        [...new Set(mine.map((e) => e.action))]);
    check("switch-off reason is in the log", mine.some((e) => e.action === "staff.disable" && e.reason === "Left the company"));
    check("no password hash in any audit entry", mine.every((e) => !JSON.stringify(e).includes("password_hash") && !JSON.stringify(e).includes("$2b$")));
    r = await call("auditLog", adminToken, { q: "Changed working hours" });
    check("audit search", r.ok && r.result.entries.length >= 1 && r.result.entries.every((e) => /working hours/.test(e.summary)), r);

    /* ---------- sessions ---------- */
    console.log("\nSessions");
    const phone = await login(ADMIN, "Better-pass-2", { kind: "app", deviceId: `adm-app-${stamp}`, name: "Admin phone" });
    r = await call("sessions", adminToken);
    const phoneRow = r.ok && r.result.sessions.find((x) => x.name === "Admin phone");
    check("sessions list shows this browser and the phone", r.ok && r.result.sessions.some((x) => x.current) && phoneRow, r);
    r = await call("logoutSession", adminToken, phoneRow.id);
    check("logged the phone out from the browser", r.ok && !r.result.sessions.some((x) => x.id === phoneRow.id), r);
    r = await call("me", phone.session.token);
    check("the phone's token stops working", r.status === 401, r);
    const idle = await login(ADMIN, "Better-pass-2", web("Old laptop"));
    const idleSid = jwt.decode(idle.session.token).sid;
    await M.AdmSession.update({ last_active: new Date(Date.now() - 31 * 86400000) }, { where: { id: idleSid } });
    r = await call("me", idle.session.token);
    check("a session idle for 31 days ends", r.status === 401, r);

    /* ---------- worker ---------- */
    console.log("\nEvent log, job queue and worker");
    const evCount = await M.CrmEvent.count({ where: { id: { [Op.gt]: start.event }, type: { [Op.in]: ["staff.created", "staff.updated", "staff.disabled", "staff.enabled", "staff.leave_added"] } } });
    check("staff changes were written to the event log", evCount >= 5, evCount);

    const seen = [];
    worker.subscribe("test.hello", async (ev, data) => seen.push(data.n));
    let flaky = 0;
    worker.subscribe("test.flaky", async () => {
        flaky += 1;
        throw new Error("subscriber broke");
    });
    await queue.emit({ type: "test.hello", entity: "test", entityId: stamp, data: { n: 7 } });
    const bad = await queue.emit({ type: "test.flaky", entity: "test", entityId: stamp });
    // Drain everything waiting (earlier test runs or the staff events above).
    for (let i = 0; i < 10; i++) {
        const x = await worker.processEvents(200);
        if (!x.handled && !x.failed) break;
    }
    check("subscriber got the event once", seen.join() === "7", seen);
    await bad.reload();
    check("a failing subscriber leaves the event for a later retry", !bad.handled_at && bad.attempts === 1 && /broke/.test(bad.last_error) && new Date(bad.claimed_until) > new Date(), bad.get({ plain: true }));
    const again = await worker.processEvents(200);
    check("not retried before its back-off", flaky === 1 && again.failed === 0, { flaky, again });

    const ping = await queue.enqueue({ kind: "system.ping", payload: { note: "hi" }, dedupeKey: `ping-${stamp}` });
    const dup = await queue.enqueue({ kind: "system.ping", payload: { note: "again" }, dedupeKey: `ping-${stamp}` });
    check("same dedupe key = same job", dup.id === ping.id);
    const later = await queue.enqueue({ kind: "system.ping", runAt: new Date(Date.now() + 3600000) });
    const nohandler = await queue.enqueue({ kind: `test.unknown.${stamp}` });
    let fails = 0;
    worker.registerJob(`test.fail.${stamp}`, async () => {
        fails += 1;
        throw new Error("boom");
    });
    const failing = await queue.enqueue({ kind: `test.fail.${stamp}`, maxAttempts: 2 });
    for (let i = 0; i < 5; i++) {
        const x = await worker.processJobs(200);
        if (!x.done && !x.failed && !x.retried) break;
    }
    await Promise.all([ping, later, nohandler, failing].map((j) => j.reload()));
    check("due job ran", ping.status === "done" && ping.result === "pong: hi", ping.get({ plain: true }));
    check("future job waits", later.status === "queued" && later.attempts === 0);
    check("job without a handler fails at once", nohandler.status === "failed" && /No handler/.test(nohandler.last_error));
    check("failing job is retried later, not at once", failing.status === "queued" && failing.attempts === 1 && fails === 1 && new Date(failing.run_at) > new Date(Date.now() + 30000), failing.get({ plain: true }));
    await failing.update({ run_at: new Date(Date.now() - 1000) });
    await worker.processJobs(200);
    await failing.reload();
    check("after its last attempt the job is failed", failing.status === "failed" && failing.attempts === 2 && fails === 2, failing.get({ plain: true }));

    // Two workers at once never run the same job twice.
    const ran = new Map();
    worker.registerJob(`test.count.${stamp}`, async (p) => {
        ran.set(p.i, (ran.get(p.i) || 0) + 1);
        await new Promise((res) => setTimeout(res, 5));
    });
    for (let i = 0; i < 12; i++) await queue.enqueue({ kind: `test.count.${stamp}`, payload: { i } });
    await Promise.all([worker.processJobs(200), worker.processJobs(200), worker.processJobs(200)]);
    for (let i = 0; i < 3; i++) await worker.processJobs(200);
    check("12 jobs, 3 workers in parallel: each ran exactly once", ran.size === 12 && [...ran.values()].every((n) => n === 1), [...ran.entries()]);

    await queue.cancel({ id: later.id });
    await later.reload();
    check("queued job can be cancelled", later.status === "cancelled");

    await worker.heartbeat(true);
    r = await call("workerStatus", adminToken);
    check("worker status: running with queue counts", r.ok && r.result.running === true && typeof r.result.queue.jobs_due === "number", r);
    r = await call("workerTest", adminToken);
    check("panel test button queues a ping", r.ok && r.result.jobId, r);
    await worker.processJobs(200);
    r = await call("workerJob", adminToken, r.result.jobId);
    check("the test ping is done", r.ok && r.result.job.status === "done" && /pong: test by/.test(r.result.job.result), r);
    r = await call("workerStatus", execToken);
    check("worker status is admin-only", !r.ok || r.status === 401, r);

    /* ---------- logout ---------- */
    r = await call("logout", adminToken);
    check("logout", r.ok, r);
    r = await call("me", adminToken);
    check("token dead after logout", r.status === 401, r);

    return { settingsBefore };
}

async function cleanup(ctx) {
    const users = await M.AdmUser.findAll({ where: { mobile: { [Op.like]: `7%${stamp}%` } }, attributes: ["id"], raw: true });
    const ids = users.map((u) => u.id);
    if (ids.length) {
        await M.AdmSession.destroy({ where: { user_id: ids } });
        await M.AdmLeave.destroy({ where: { user_id: ids } });
        await M.AdmUser.destroy({ where: { id: ids } });
    }
    await M.AdmTeam.destroy({ where: { name: { [Op.like]: `%${stamp}` } } });
    await M.AdmRole.destroy({ where: { name: { [Op.like]: `%${stamp}` } } });
    await M.AdmAuditLog.destroy({ where: { id: { [Op.gt]: start.audit || 0 } } });
    await M.CrmEvent.destroy({ where: { id: { [Op.gt]: start.event || 0 } } });
    await M.CrmJob.destroy({ where: { id: { [Op.gt]: start.job || 0 } } });
    if (ctx && ctx.settingsBefore) {
        await M.AdmSetting.destroy({ where: {} });
        if (ctx.settingsBefore.length) await M.AdmSetting.bulkCreate(ctx.settingsBefore);
    }
}

(async () => {
    const app = express();
    app.use(express.json());
    app.use("/admin/v1", require("../adminv1/routes"));
    const server = http.createServer(app);
    await new Promise((res) => server.listen(0, res));
    base = `http://127.0.0.1:${server.address().port}/admin/v1`;
    let ctx;
    try {
        ctx = { settingsBefore: await M.AdmSetting.findAll({ raw: true }) };
        Object.assign(ctx, await run());
    } catch (e) {
        console.error(e);
        failures.push(`crashed: ${e.message}`);
    } finally {
        await cleanup(ctx).catch((e) => console.error("cleanup:", e.message));
        server.close();
        await M.sequelize.close();
    }
    console.log(`\n${passed} passed, ${failures.length} failed`);
    if (failures.length) {
        for (const f of failures) console.log(`  - ${f}`);
        process.exit(1);
    }
})();
