const { Op } = require("sequelize");
const { sequelize, AdmSetting, AdmAuditLog, AdmUser } = require("../model");
const { RuleError } = require("../appv1/core");
const audit = require("./audit");
const { need } = require("./auth");

// Panel settings (Settings screen). Each key holds one JSON object; the
// defaults are the owner's answers from the design doc (7 Oct 2026).

const DEFAULTS = {
    // Mon-Sat (1-6, Sunday = 0 off), 10:30 to 19:00, lunch at any time.
    working_hours: { days: [1, 2, 3, 4, 5, 6], start: "10:30", end: "19:00", lunchMinutes: 60, teaBreaks: 2, teaMinutes: 15 },
    // Working minutes. Salesperson -> manager -> admin.
    timers: { firstContactMinutes: 15, managerActMinutes: 15, overdueToManagerMinutes: 60, overdueToAdminMinutes: 60 },
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
};

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
