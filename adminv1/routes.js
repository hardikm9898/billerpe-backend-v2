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
const wa = require("./crm/wa");
const inbox = require("./crm/inbox");
const ai = require("./crm/ai");
const templates = require("./crm/templates");
const automation = require("./crm/automation");
const cadences = require("./crm/cadences");
const campaigns = require("./crm/campaigns");
const escalations = require("./crm/escalations");
const digest = require("./crm/digest");
const perms = require("./permissions");

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

/* ------------------------------ WhatsApp webhook (Meta) ------------------------------ */

// Meta's callback URL for the WhatsApp number: https://<api>/admin/v1/wa/webhook.
// GET = the one-time verify handshake; POST = messages and delivery ticks,
// signed with the Meta app secret (refused when the secret is not set).
const crypto = require("crypto");
router.get("/wa/webhook", (req, res) => {
    const token = process.env.ADMIN_WA_VERIFY_TOKEN || process.env.WA_VERIFY_TOKEN;
    if (req.query["hub.mode"] === "subscribe" && token && req.query["hub.verify_token"] === token) return res.status(200).send(String(req.query["hub.challenge"] || ""));
    return res.sendStatus(403);
});
router.post("/wa/webhook", (req, res) => {
    const secret = process.env.ADMIN_WA_APP_SECRET || process.env.META_APP_SECRET;
    if (!secret) return res.sendStatus(503);
    const sig = String(req.headers["x-hub-signature-256"] || "");
    const expected = "sha256=" + crypto.createHmac("sha256", secret).update(req.rawBody || Buffer.alloc(0)).digest("hex");
    if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return res.sendStatus(401);
    wa.handleWebhook(req.body).then(
        () => res.sendStatus(200),
        (e) => {
            console.error("[adminv1] wa webhook:", e);
            res.sendStatus(500);
        },
    );
});

// Built-in roles get the permissions later phases added (once).
setImmediate(() => perms.upgradeRoles().catch((e) => console.error("[adminv1] role upgrade:", e && e.message)));

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

    /* WhatsApp inbox (phase 3) */
    inbox: (s, query) => inbox.list(s, query || {}),
    inboxWaiting: (s) => inbox.waiting(s),
    inboxChat: (s, id, query) => inbox.detail(s, id, query || {}),
    inboxSend: (s, id, text) => inbox.sendText(s, id, text),
    inboxSendTemplate: (s, id, templateId, values) => inbox.sendTemplate(s, id, templateId, values),
    inboxSendFile: (s, id, file) => inbox.sendFile(s, id, file || {}),
    inboxTakeOver: (s, id) => inbox.takeOver(s, id),
    inboxLetAi: (s, id) => inbox.letAi(s, id),
    inboxAiOff: (s, id) => inbox.aiOff(s, id),
    inboxRead: (s, id) => inbox.markRead(s, id),
    inboxDone: (s, id, done) => inbox.setDone(s, id, done !== false),
    inboxMakeLead: (s, id, input) => inbox.makeLead(s, id, input || {}),
    inboxSetKind: (s, id, kind) => inbox.setKind(s, id, kind),
    inboxOptout: (s, id, on) => inbox.setOptout(s, id, !!on),
    inboxForLead: (s, leadId) => inbox.forLead(s, leadId),
    inboxStatus: (s) => inbox.status(s),
    waTemplates: (s, query) => templates.list(s, query || {}),
    waTemplateSave: (s, input) => templates.save(s, input || {}),
    aiTry: (s, input) => ai.tryIt(s, input || {}),

    /* automation, cadences, campaigns, escalations */
    rules: (s) => automation.list(s),
    ruleSave: (s, input) => automation.save(s, input || {}),
    ruleActive: (s, id, active) => automation.setActive(s, id, !!active),
    ruleDelete: (s, id) => automation.remove(s, id),
    rulePreview: (s, input) => automation.preview(s, input || {}),
    ruleRuns: (s, query) => automation.runLog(s, query || {}),
    cadences: async (s) => {
        await cadences.ensureDefaults();
        return cadences.list(s);
    },
    cadenceSave: (s, input) => cadences.save(s, input || {}),
    cadenceStart: (s, leadId, cadenceId) => cadences.start(s, leadId, cadenceId),
    cadenceStop: (s, enrollmentId) => cadences.stop(s, enrollmentId),
    campaigns: (s) => campaigns.list(s),
    campaign: (s, id, query) => campaigns.detail(s, id, query || {}),
    campaignPreview: (s, input) => campaigns.preview(s, input || {}),
    campaignSave: (s, input) => campaigns.save(s, input || {}),
    campaignStart: (s, id, input) => campaigns.start(s, id, input || {}),
    campaignAction: (s, id, action) => campaigns.setStatus(s, id, action),
    escalations: (s) => escalations.mine(s),
    teamToday: (s) => escalations.teamToday(s),
    digestTemplateText: () => ({ text: digest.TEMPLATE_TEXT }),

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
