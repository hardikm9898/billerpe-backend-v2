const express = require("express");
const cors = require("cors");
const { RuleError } = require("../appv1/core");
const auth = require("./auth");
const staff = require("./staff");
const settings = require("./settings");
const worker = require("../services/admin/worker");
const queue = require("../services/admin/queue");
const crmConfig = require("./crm/config");
const leads = require("./crm/leads");
const myday = require("./crm/myday");
const notifications = require("./crm/notify");

// BillerPe SuperAdmin API (admin.billerpe.in and the sales app): /admin/v1.
// Same shape as /owner/v1: POST /admin/v1/<method> with { args: [...] },
// answer { ok: true, result } or { ok: false, error }. 401 { code:
// "session-ended" } sends the panel back to login; { code: "change-password" }
// means the person must replace a temporary password first.

const router = express.Router();

router.use(cors({ origin: true, credentials: false }));
router.options("*", cors({ origin: true, credentials: false }));

const GENERIC = "Something went wrong. Please try again.";
const ipOf = (req) => String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "").split(",")[0].trim().replace(/^::ffff:/, "");

/* ------------------------------ session (no token) ------------------------------ */

router.post("/login", (req, res) => {
    const { mobile, password, device } = req.body || {};
    auth.login({ mobile, password, device, ip: ipOf(req) }).then((r) => res.json(r), (e) => {
        console.error("[adminv1] login:", e);
        res.json({ ok: false, error: "network", message: GENERIC });
    });
});

router.post("/resume", (req, res) => {
    auth.resume({ token: (req.body || {}).token }).then((r) => res.json(r), (e) => {
        console.error("[adminv1] resume:", e);
        res.json({ ok: false, error: "network", message: GENERIC });
    });
});

/* ------------------------------ everything else ------------------------------ */

router.use(auth.requireStaff);

/** name -> fn(staff, ...args). Every handler checks its own permission (auth.need). */
const HANDLERS = {
    /* me */
    me: (s) => auth.me(s),
    logout: (s) => auth.logout(s),
    sessions: (s) => auth.sessions(s),
    logoutSession: (s, id) => auth.logoutSession(s, id),
    changePassword: (s, oldPassword, newPassword) => auth.changePassword(s, oldPassword, newPassword),

    /* staff, roles, teams, leave */
    people: () => staff.people(),
    staffList: (s) => staff.list(s),
    staffSave: (s, input) => staff.save(s, input || {}),
    staffSetStatus: (s, id, active, reason) => staff.setStatus(s, id, !!active, reason),
    staffResetPassword: (s, id) => staff.resetPassword(s, id),
    roles: (s) => staff.roles(s),
    roleNames: (s) => staff.roleNames(s),
    roleSave: (s, input) => staff.saveRole(s, input || {}),
    roleDelete: (s, id) => staff.deleteRole(s, id),
    teams: (s) => staff.teams(s),
    teamSave: (s, input) => staff.saveTeam(s, input || {}),
    leaves: (s, query) => staff.leaves(s, query || {}),
    leaveSave: (s, input) => staff.saveLeave(s, input || {}),
    leaveDelete: (s, id) => staff.deleteLeave(s, id),

    /* settings + audit */
    settings: () => settings.all(),
    settingSave: (s, key, value) => settings.save(s, key, value),
    auditLog: (s, query) => settings.auditLog(s, query || {}),

    /* sales CRM (phase 2) */
    crmConfig: () => crmConfig.view(),
    crmStageSave: (s, input) => crmConfig.saveStage(s, input || {}),
    crmOutcomeSave: (s, input) => crmConfig.saveOutcome(s, input || {}),
    crmReasonSave: (s, input) => crmConfig.saveReason(s, input || {}),
    myDay: (s) => myday.myDay(s),
    pipeline: (s, query) => myday.pipeline(s, query || {}),
    breakStart: (s, kind) => myday.startBreak(s, kind),
    breakEnd: (s) => myday.endBreak(s),
    leads: (s, query) => leads.list(s, query || {}),
    lead: (s, id) => leads.detail(s, id),
    leadCreate: (s, input) => leads.create(s, input || {}),
    leadUpdate: (s, id, input) => leads.update(s, id, input || {}),
    leadOutcome: (s, id, input) => leads.logOutcome(s, id, input || {}),
    leadStage: (s, id, input) => leads.moveStage(s, id, input || {}),
    leadWon: (s, id, input) => leads.markWon(s, id, input || {}),
    leadLost: (s, id, input) => leads.markLost(s, id, input || {}),
    leadReopen: (s, id, input) => leads.reopen(s, id, input || {}),
    leadNote: (s, id, text) => leads.addNote(s, id, text),
    leadAssign: (s, id, toId, reason) => leads.reassign(s, id, toId, reason),
    leadTaskAdd: (s, id, input) => leads.addLeadTask(s, id, input || {}),
    taskUpdate: (s, taskId, input) => leads.updateTask(s, taskId, input || {}),
    leadMerge: (s, fromId, intoId) => leads.merge(s, fromId, intoId),
    notifications: (s, query) => notifications.list(s, query || {}),
    notificationCount: (s) => notifications.unreadCount(s),
    notificationsRead: (s, ids) => notifications.markRead(s, ids ?? "all"),

    /* worker */
    workerStatus: (s) => {
        auth.need(s, "settings.manage");
        return worker.status();
    },
    workerTest: async (s) => {
        auth.need(s, "settings.manage");
        const job = await queue.enqueue({ kind: "system.ping", payload: { note: `test by ${s.user.name}` }, maxAttempts: 1 });
        return { jobId: job.id };
    },
    workerJob: async (s, id) => {
        auth.need(s, "settings.manage");
        const { CrmJob } = require("../model");
        const j = await CrmJob.findOne({ where: { id: Number(id) || 0 }, attributes: ["id", "kind", "status", "attempts", "result", "last_error", "done_at"], raw: true });
        if (!j) throw new RuleError("No such job.");
        return { job: j };
    },
};

router.post("/:name", (req, res) => {
    const fn = HANDLERS[req.params.name];
    if (!fn) return res.status(404).json({ ok: false, error: "Unknown call" });
    const args = Array.isArray(req.body?.args) ? req.body.args : [];
    Promise.resolve()
        .then(() => fn(req.staff, ...args))
        .then(
            (result) => res.json({ ok: true, result: result ?? {} }),
            (err) => {
                if (err instanceof RuleError) return res.json({ ok: false, error: err.message });
                console.error(`[adminv1] ${req.params.name}:`, err);
                return res.json({ ok: false, error: GENERIC });
            },
        );
});

module.exports = router;
