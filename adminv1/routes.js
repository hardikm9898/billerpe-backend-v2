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
const calls = require("./crm/calls");
const csAccounts = require("./cs/accounts");
const csOutlets = require("./cs/outlets");
const csOnboarding = require("./cs/onboarding");
const csWon = require("./cs/won");
const csToday = require("./cs/today");
const bilCatalog = require("./bil/catalog");
const bilInvoices = require("./bil/invoices");
const bilPayments = require("./bil/payments");
const bilRenewals = require("./bil/renewals");
const bilHardware = require("./bil/hardware");
const bilPdf = require("./bil/pdf");
const bilShare = require("./bil/share");
const bilCommon = require("./bil/common");
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

// The sales app uploads a call recording as the raw request body (they are
// often larger than a JSON call allows): POST /admin/v1/app/recording/<callId>
// with Content-Type = the file's type and X-File-Name.
router.post("/app/recording/:callId", express.raw({ type: () => true, limit: "60mb" }), (req, res) => {
    calls.upload(req.staff, req.params.callId, req.body, { mime: String(req.headers["content-type"] || "application/octet-stream").split(";")[0], name: decodeURIComponent(String(req.headers["x-file-name"] || "")) }).then(
        (r) => res.json({ ok: true, result: r }),
        (err) => {
            if (err instanceof RuleError) return res.json({ ok: false, error: err.message });
            console.error("[adminv1] recording:", err);
            return res.json({ ok: false, error: GENERIC });
        },
    );
});

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

    /* sales app (phase 4) */
    appCalls: (s, input) => calls.sync(s, input || {}),
    appLookup: (s, number) => calls.lookup(s, number),
    appLeadCache: (s) => calls.cache(s),
    appNoRecording: (s, callId) => calls.noRecording(s, callId),
    appSetPush: (s, token) => calls.setPush(s, token),
    callRecording: (s, callId) => calls.play(s, callId),

    /* customers and outlet operations (phase 5) */
    leadWonCustomer: (s, id, input) => csWon.win(s, id, input || {}),
    wonFindOutlets: (s, q) => csWon.findOutlets(s, q),
    accountAddOutlet: (s, id, input) => csWon.addOutlet(s, id, input || {}),
    planNames: () => ({ plans: csWon.PLAN_NAMES }),
    csToday: (s) => csToday.today(s),
    accounts: (s, query) => csAccounts.list(s, query || {}),
    account: (s, id) => csAccounts.detail(s, id),
    accountUpdate: (s, id, input) => csAccounts.update(s, id, input || {}),
    accountOwner: (s, id, ownerId, reason) => csAccounts.setOwner(s, id, ownerId, reason),
    accountNote: (s, id, text) => csAccounts.addNote(s, id, text),
    accountTaskAdd: (s, id, input) => csAccounts.taskAdd(s, id, input || {}),
    accountTaskDone: (s, taskId, result) => csAccounts.taskDone(s, taskId, result),
    accountTaskMove: (s, taskId, dueAt) => csAccounts.taskMove(s, taskId, dueAt),
    accountPick: (s, q) => csAccounts.pick(s, q),
    onboardingTick: (s, itemId, done, note) => csOnboarding.tick(s, itemId, done !== false, note),
    onboardingItem: (s, itemId, input) => csOnboarding.setItem(s, itemId, input || {}),
    onboardingStart: (s, hotelId) => csOnboarding.startFor(s, hotelId),
    outlets: (s, query) => csOutlets.list(s, query || {}),
    outlet: (s, hotelId) => csOutlets.detail(s, hotelId),
    outletPlan: (s, hotelId, input) => csOutlets.switchPlan(s, hotelId, input || {}),
    outletReleasePc: (s, hotelId, reason) => csOutlets.releasePc(s, hotelId, reason),
    outletDeviceLogout: (s, hotelId, deviceId, reason) => csOutlets.logoutDevice(s, hotelId, deviceId, reason),
    outletMove: (s, hotelId, accountId, reason) => csAccounts.moveOutlet(s, hotelId, accountId, reason),
    outletOpenAs: (s, hotelId, reason) => csOutlets.openAs(s, hotelId, reason),
    supportEnd: (s, sessionId) => csOutlets.endSupport(s, sessionId),
    /* billing and renewals (phase 6) */
    billingInfo: async (s) => {
        auth.need(s, "billing.view");
        const sel = await bilCommon.seller();
        const { BilCounter } = require("../model");
        const fy = bilCommon.fyOf();
        const counters = await BilCounter.findAll({ where: { fy }, raw: true });
        return { live: bilPayments.live(), fy, states: bilCommon.STATES, seller: sel, reminderTemplateText: bilRenewals.TEMPLATE_TEXT, next: Object.fromEntries(["invoice", "credit", "receipt"].map((k) => [k, (counters.find((c) => c.kind === k) || {}).next || 1])) };
    },
    billingCounter: async (s, kind, next) => {
        auth.need(s, "billing.approve");
        auth.need(s, "settings.manage");
        if (!["invoice", "credit", "receipt"].includes(kind)) throw new RuleError("Unknown series.");
        const n = Number(next);
        if (!Number.isInteger(n) || n < 1 || n > 99999) throw new RuleError("The next number: from 1 to 99999.");
        const { BilCounter, sequelize } = require("../model");
        const fy = bilCommon.fyOf();
        return sequelize.transaction(async (t) => {
            const [row] = await BilCounter.findOrCreate({ where: { kind, fy }, defaults: { next: 1 }, transaction: t, lock: t.LOCK.UPDATE });
            if (n < row.next) throw new RuleError(`Numbers up to ${row.next - 1} are already used this year: the next can only go up.`);
            await row.update({ next: n }, { transaction: t });
            await require("./audit").write(s, { action: "billing.counter", entity: "bil_counter", entityId: `${kind}:${fy}`, summary: `Next ${kind} number for ${fy} set to ${n}` }, { transaction: t });
            return { kind, fy, next: n };
        });
    },
    catalog: (s) => bilCatalog.list(s),
    catalogSave: (s, input) => bilCatalog.save(s, input || {}),
    invoices: (s, query) => bilInvoices.list(s, query || {}),
    invoice: (s, id) => bilInvoices.detail(s, id),
    invoiceDraft: (s, input) => bilInvoices.saveDraft(s, input || {}),
    invoiceUpdate: (s, id, input) => bilInvoices.saveDraft(s, input || {}, id),
    invoiceIssue: (s, id) => bilInvoices.issue(s, id),
    invoiceApprove: (s, id) => bilInvoices.approve(s, id),
    invoiceToDraft: (s, id, reason) => bilInvoices.toDraft(s, id, reason),
    invoiceCancel: (s, id, reason) => bilInvoices.cancel(s, id, reason),
    invoicePdf: (s, id) => bilPdf.pdf(s, id),
    invoiceSend: (s, id) => bilShare.send(s, id),
    invoiceLink: (s, id) => bilPayments.createLink(s, id),
    dues: (s) => bilInvoices.dues(s),
    payments: (s) => bilPayments.pendingList(s),
    paymentRecord: (s, invoiceId, input) => bilPayments.record(s, invoiceId, input || {}),
    paymentDecide: (s, id, ok, reason) => bilPayments.decide(s, id, !!ok, reason),
    paymentProof: (s, id) => bilPayments.proofLink(s, id),
    payLinkSimulate: (s, linkId, state) => bilPayments.simulate(s, linkId, state),
    renewals: (s, query) => bilRenewals.list(s, query || {}),
    renewalStage: (s, id, stage, note) => bilRenewals.setStage(s, id, stage, note),
    renewalInvoice: (s, id) => bilRenewals.makeInvoice(s, id),
    renewalChurn: (s, id, reason) => bilRenewals.churn(s, id, reason),
    renewalExtend: (s, id, reason) => bilRenewals.staffExtend(s, id, reason),
    hardwareOrders: (s, query) => bilHardware.list(s, query || {}),
    hardwareStatus: (s, id, input) => bilHardware.setStatus(s, id, input || {}),
    hardwareCreate: (s, input) => bilHardware.create(s, input || {}),

    healthRun: async (s) => {
        auth.need(s, "settings.manage");
        const job = await queue.enqueue({ kind: "cs.health", maxAttempts: 1 });
        return { jobId: job.id };
    },

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
