const { Op } = require("sequelize");
const { sequelize, AdmSetting, AdmAuditLog, AdmUser } = require("../model");
const { RuleError } = require("../appv1/core");
const audit = require("./audit");
const { need } = require("./auth");
const aiDefaults = require("./crm/aiDefaults");

// Panel settings (Settings screen). Each key holds one JSON object; the
// defaults are the owner's answers from the design doc (7 Oct 2026).

const DEFAULTS = {
    // Mon-Sat (1-6, Sunday = 0 off), 10:30 to 19:00, lunch at any time.
    working_hours: { days: [1, 2, 3, 4, 5, 6], start: "10:30", end: "19:00", lunchMinutes: 60, teaBreaks: 2, teaMinutes: 15 },
    // Working minutes. Salesperson -> manager -> admin.
    // Leads that arrive at night or on Sunday wait in a morning queue that must be
    // cleared in the first working hour (two on Monday, which carries Sunday's leads).
    timers: { firstContactMinutes: 15, managerActMinutes: 15, overdueToManagerMinutes: 60, overdueToAdminMinutes: 60, morningQueueMinutes: 60, mondayMorningMinutes: 120 },
    // BillerPe's own GST invoices. The GSTIN is a demo one until replaced.
    company: {
        name: "BillerPe",
        gstin: "24AAAAA0000A1Z5",
        gstinIsDemo: true,
        state: "Gujarat",
        stateCode: "24",
        address: "",
        invoicePrefix: "BPE",
        creditNotePrefix: "BCN",
        receiptPrefix: "BPR",
        sac: "997331",
    },
    // AI replies all day; after a person replies in a chat the AI stays quiet there.
    whatsapp_ai: { aiAllDay: true, aiQuietHoursAfterHuman: 24, templateFrom: "09:00", templateTo: "21:00" },
    // The WhatsApp AI assistant: on/off, model, script and knowledge (crm/aiDefaults.js).
    ai_assistant: aiDefaults.DEFAULTS,
    // 9:30 summary for every salesperson: in the panel, and on WhatsApp once the
    // staff template is approved by Meta.
    digest: { enabled: true, time: "09:30", whatsapp: true, templateName: "staff_daily_digest" },
    // Customers after the sale (phase 5): "Open as outlet" opens the web Owner
    // Dashboard at ownerDashboardUrl for supportMinutes; the onboarding
    // checklist every new outlet gets (auto = ticked by the outlet's own data;
    // plan = suite | app | all); the limits of the health check.
    customers: {
        ownerDashboardUrl: "",
        supportMinutes: 30,
        trialDays: 14,
        onboardingNewDays: 30,
        onboarding: [
            { key: "payment", title: "Payment received", auto: "payment", plan: "all", dueDays: 0 },
            { key: "outlet", title: "Outlet created, owner can log in", auto: "outlet", plan: "all", dueDays: 0 },
            { key: "menu", title: "Menu uploaded", auto: "menu", plan: "all", dueDays: 2 },
            { key: "pc", title: "Outlet PC installed and registered", auto: "pc", plan: "suite", dueDays: 3 },
            { key: "app_devices", title: "POS App installed on the outlet's phones", auto: "app_devices", plan: "app", dueDays: 3 },
            { key: "printers", title: "Printers set up", auto: null, plan: "all", dueDays: 3 },
            { key: "first_bill", title: "First bill made", auto: "first_bill", plan: "all", dueDays: 4 },
            { key: "training", title: "Staff training done", auto: null, plan: "all", dueDays: 5 },
            { key: "day7", title: "Day-7 check call", auto: null, plan: "all", dueDays: 7 },
            { key: "day30", title: "Day-30 review", auto: null, plan: "all", dueDays: 30 },
        ],
        health: { noBillsDays: 3, lowBillsPct: 30, dipBillsPct: 60, minNormalBills: 5, pcOfflineHours: 24, pcAmberHours: 16, backlogHours: 6, versionsBehind: 2, planWarnDays: 15, ticketDays: 3, onboardingLateDays: 1, ebillLow: 100 },
    },
};

const AUTO_ITEMS = ["payment", "outlet", "menu", "pc", "app_devices", "first_bill"];

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const int = (v, min, max, label) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < min || n > max) throw new RuleError(`${label} must be a whole number from ${min} to ${max}.`);
    return n;
};
const time = (v, label) => {
    const s = String(v || "");
    if (!HHMM.test(s)) throw new RuleError(`${label}: write the time as HH:MM, for example 10:30.`);
    return s;
};
const text = (v, n) => String(v ?? "").trim().slice(0, n);

const VALIDATE = {
    working_hours: (v) => {
        const days = [...new Set((Array.isArray(v.days) ? v.days : []).map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort();
        if (!days.length) throw new RuleError("Choose at least one working day.");
        const start = time(v.start, "Day starts");
        const end = time(v.end, "Day ends");
        if (start >= end) throw new RuleError("The working day must end after it starts.");
        return { days, start, end, lunchMinutes: int(v.lunchMinutes, 0, 180, "Lunch"), teaBreaks: int(v.teaBreaks, 0, 6, "Tea breaks"), teaMinutes: int(v.teaMinutes, 0, 60, "Tea break minutes") };
    },
    timers: (v) => ({
        firstContactMinutes: int(v.firstContactMinutes, 1, 600, "First contact"),
        managerActMinutes: int(v.managerActMinutes, 1, 600, "Manager must act within"),
        overdueToManagerMinutes: int(v.overdueToManagerMinutes, 1, 1440, "Overdue to manager"),
        overdueToAdminMinutes: int(v.overdueToAdminMinutes, 1, 1440, "Overdue to admin"),
        morningQueueMinutes: int(v.morningQueueMinutes ?? DEFAULTS.timers.morningQueueMinutes, 1, 600, "Morning queue"),
        mondayMorningMinutes: int(v.mondayMorningMinutes ?? DEFAULTS.timers.mondayMorningMinutes, 1, 600, "Monday morning queue"),
    }),
    company: (v) => {
        const gstin = text(v.gstin, 15).toUpperCase();
        if (!/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(gstin)) throw new RuleError("The GSTIN does not look right (15 characters, for example 24AAAAA0000A1Z5).");
        const prefix = (p, label) => {
            const s = text(p, 6).toUpperCase();
            if (!/^[A-Z]{2,6}$/.test(s)) throw new RuleError(`${label}: use 2 to 6 letters.`);
            return s;
        };
        const out = {
            name: text(v.name, 120) || "BillerPe",
            gstin,
            gstinIsDemo: gstin === DEFAULTS.company.gstin,
            state: text(v.state, 40),
            stateCode: gstin.slice(0, 2),
            address: text(v.address, 300),
            invoicePrefix: prefix(v.invoicePrefix, "Invoice prefix"),
            creditNotePrefix: prefix(v.creditNotePrefix, "Credit note prefix"),
            receiptPrefix: prefix(v.receiptPrefix, "Receipt prefix"),
            sac: text(v.sac, 8),
        };
        if (new Set([out.invoicePrefix, out.creditNotePrefix, out.receiptPrefix]).size < 3) throw new RuleError("Invoices, credit notes and receipts need different prefixes.");
        return out;
    },
    whatsapp_ai: (v) => {
        const templateFrom = time(v.templateFrom, "Templates from");
        const templateTo = time(v.templateTo, "Templates until");
        if (templateFrom >= templateTo) throw new RuleError("Template sending must end after it starts.");
        return { aiAllDay: v.aiAllDay !== false, aiQuietHoursAfterHuman: int(v.aiQuietHoursAfterHuman, 0, 168, "AI quiet hours"), templateFrom, templateTo };
    },
    ai_assistant: (v) => {
        const model = text(v.model, 60) || aiDefaults.DEFAULTS.model;
        if (!/^claude-[a-z0-9.-]+$/.test(model)) throw new RuleError("Write a Claude model id, for example claude-haiku-4-5.");
        const instructions = text(v.instructions, 8000);
        if (instructions.length < 40) throw new RuleError("Write the AI's instructions (at least a few lines).");
        const knowledge = (Array.isArray(v.knowledge) ? v.knowledge : [])
            .map((k) => ({ topic: text(k && k.topic, 80), answer: text(k && k.answer, 3000) }))
            .filter((k) => k.topic || k.answer);
        if (knowledge.some((k) => !k.topic || !k.answer)) throw new RuleError("Every knowledge entry needs a topic and an answer.");
        if (knowledge.length > 60) throw new RuleError("Keep the knowledge to 60 entries or fewer.");
        return {
            enabled: v.enabled !== false,
            model,
            delaySeconds: int(v.delaySeconds ?? 12, 0, 120, "Wait before replying"),
            maxRepliesPerChatPerDay: int(v.maxRepliesPerChatPerDay ?? 25, 1, 200, "AI replies per chat per day"),
            maxRepliesPerDay: int(v.maxRepliesPerDay ?? 1500, 1, 20000, "AI replies per day"),
            instructions,
            knowledge,
        };
    },
    customers: (v) => {
        const d = DEFAULTS.customers;
        let url = text(v.ownerDashboardUrl, 200).replace(/\/+$/, "");
        if (url && !/^https:\/\/[^\s/]+(\/\S*)?$/.test(url) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/\S*)?$/.test(url)) throw new RuleError("Owner Dashboard address: write the full https:// address, for example https://owner.billerpe.in.");
        const seen = new Set();
        const onboarding = (Array.isArray(v.onboarding) ? v.onboarding : d.onboarding).map((it, i) => {
            const title = text(it && it.title, 120);
            if (!title) throw new RuleError(`Onboarding step ${i + 1} needs a name.`);
            let key = text(it && it.key, 30).toLowerCase().replace(/[^a-z0-9_]/g, "_") || title.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 30);
            while (seen.has(key)) key = `${key.slice(0, 26)}_${i}`;
            seen.add(key);
            const auto = AUTO_ITEMS.includes(it && it.auto) ? it.auto : null;
            const plan = ["suite", "app"].includes(it && it.plan) ? it.plan : "all";
            return { key, title, auto, plan, dueDays: int(it && it.dueDays !== undefined ? it.dueDays : 0, 0, 120, `Days for "${title}"`) };
        });
        if (!onboarding.length) throw new RuleError("Keep at least one onboarding step.");
        if (onboarding.length > 25) throw new RuleError("Keep the checklist to 25 steps or fewer.");
        const h = { ...d.health, ...(v.health || {}) };
        const health = {
            noBillsDays: int(h.noBillsDays, 2, 30, "Red after days without bills"),
            lowBillsPct: int(h.lowBillsPct, 1, 99, "Red below % of normal bills"),
            dipBillsPct: int(h.dipBillsPct, 1, 99, "Amber below % of normal bills"),
            minNormalBills: int(h.minNormalBills, 1, 1000, "Judge bills only from this many a day"),
            pcOfflineHours: int(h.pcOfflineHours, 1, 240, "Red when the PC is offline for"),
            pcAmberHours: int(h.pcAmberHours, 1, 240, "Amber when the PC is offline for"),
            backlogHours: int(h.backlogHours, 1, 72, "Red when bills wait to upload for"),
            versionsBehind: int(h.versionsBehind, 1, 20, "Red when this many versions behind"),
            planWarnDays: int(h.planWarnDays, 1, 90, "Amber this many days before the plan ends"),
            ticketDays: int(h.ticketDays, 1, 60, "Amber when a ticket is open for"),
            onboardingLateDays: int(h.onboardingLateDays, 0, 30, "Amber when an onboarding step is late by"),
            ebillLow: int(h.ebillLow, 0, 100000, "Amber below this many e-bill credits"),
        };
        if (health.lowBillsPct >= health.dipBillsPct) throw new RuleError("The red bills limit must be below the amber one.");
        if (health.pcAmberHours >= health.pcOfflineHours) throw new RuleError("The amber PC-offline time must be shorter than the red one.");
        return {
            ownerDashboardUrl: url,
            supportMinutes: int(v.supportMinutes ?? d.supportMinutes, 5, 120, "Support session minutes"),
            trialDays: int(v.trialDays ?? d.trialDays, 1, 90, "Free trial days"),
            onboardingNewDays: int(v.onboardingNewDays ?? d.onboardingNewDays, 0, 365, "Onboarding for outlets newer than"),
            onboarding,
            health,
        };
    },
    digest: (v) => ({
        enabled: v.enabled !== false,
        time: time(v.time, "Digest time"),
        whatsapp: v.whatsapp !== false,
        templateName: text(v.templateName, 80) || "staff_daily_digest",
    }),
};

async function read(key) {
    const row = await AdmSetting.findOne({ where: { setting_key: key }, raw: true });
    if (!row) return { ...DEFAULTS[key] };
    try {
        return { ...DEFAULTS[key], ...JSON.parse(row.value || "{}") };
    } catch {
        return { ...DEFAULTS[key] };
    }
}

/** Every setting (any signed-in person can read them; the panel needs hours and timers everywhere). */
async function all() {
    const out = {};
    for (const key of Object.keys(DEFAULTS)) out[key] = await read(key);
    return { settings: out };
}

async function save(s, key, value) {
    need(s, "settings.manage");
    if (!VALIDATE[key]) throw new RuleError("Unknown setting.");
    const clean = VALIDATE[key](value || {});
    return sequelize.transaction(async (t) => {
        const before = await read(key);
        const [row, created] = await AdmSetting.findOrCreate({ where: { setting_key: key }, defaults: { value: JSON.stringify(clean), updated_by: s.user.id }, transaction: t });
        if (!created) await row.update({ value: JSON.stringify(clean), updated_by: s.user.id }, { transaction: t });
        await audit.write(s, { action: "settings.update", entity: "adm_setting", entityId: key, summary: `Changed ${key.replace(/_/g, " ")}`, before, after: clean }, { transaction: t });
        return { key, value: clean };
    });
}

/* ------------------------------ audit log ------------------------------ */

/** Newest first, 50 per page; `before` = the last id of the previous page. */
async function auditLog(s, query = {}) {
    need(s, "audit.view");
    const where = {};
    if (query.before) where.id = { [Op.lt]: Number(query.before) || 0 };
    if (query.actorId) where.actor_id = Number(query.actorId) || 0;
    if (query.entity) where.entity = String(query.entity).slice(0, 40);
    if (query.entityId) where.entity_id = String(query.entityId).slice(0, 40);
    if (query.q) where[Op.or] = [{ summary: { [Op.like]: `%${String(query.q).slice(0, 60)}%` } }, { action: { [Op.like]: `%${String(query.q).slice(0, 60)}%` } }];
    const rows = await AdmAuditLog.findAll({ where, order: [["id", "DESC"]], limit: 51, raw: true });
    const page = rows.slice(0, 50);
    const names = new Map((await AdmUser.findAll({ where: { id: [...new Set(page.map((r) => r.actor_id).filter(Boolean))] }, attributes: ["id", "name"], raw: true })).map((u) => [u.id, u.name]));
    const parse = (t) => {
        try {
            return t ? JSON.parse(t) : null;
        } catch {
            return null;
        }
    };
    return {
        entries: page.map((r) => ({
            id: r.id,
            at: r.createdAt,
            actor: r.actor_id ? names.get(r.actor_id) || `#${r.actor_id}` : "System",
            action: r.action,
            entity: r.entity,
            entityId: r.entity_id,
            summary: r.summary,
            reason: r.reason,
            ip: r.ip,
            before: parse(r.before_json),
            after: parse(r.after_json),
        })),
        more: rows.length > 50,
    };
}

module.exports = { DEFAULTS, read, all, save, auditLog };
