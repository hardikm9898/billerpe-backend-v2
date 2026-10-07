const { Op } = require("sequelize");
const { sequelize, CrmStage, CrmOutcome, CrmLostReason } = require("../../model");
const { RuleError } = require("../../appv1/core");
const audit = require("../audit");
const { need } = require("../auth");

// Stages, outcomes and lost reasons (Settings -> Pipeline). The built-in
// rows are created on first use; their keys never change, their names and
// timings can. Read through a short cache: every lead screen needs them.

const NEXT_TYPES = ["call", "whatsapp", "demo", "proposal", "payment", "visit", "other"];
const NEXT_LABEL = { call: "Call", whatsapp: "WhatsApp", demo: "Demo", proposal: "Send proposal", payment: "Payment follow-up", visit: "Visit", other: "Follow-up" };
const BUSINESS_TYPES = ["QSR", "Cafe", "Fine dine", "Family restaurant", "Cloud kitchen", "Bar and lounge", "Sweet shop and bakery", "Food court", "Other"];

const STAGES = [
    { stage_key: "new", name: "New", kind: "open", sort: 1 },
    { stage_key: "contacted", name: "Contacted", kind: "open", sort: 2 },
    { stage_key: "qualified", name: "Qualified", kind: "open", sort: 3 },
    { stage_key: "demo", name: "Demo", kind: "open", sort: 4 },
    { stage_key: "proposal", name: "Proposal and payment", kind: "open", sort: 5 },
    { stage_key: "won", name: "Won", kind: "won", sort: 90 },
    { stage_key: "lost", name: "Lost", kind: "lost", sort: 99 },
];

const LOST_REASONS = [
    { reason_key: "not_interested", name: "Not interested", revisit_days: null, sort: 1 },
    { reason_key: "not_now", name: "Not now (revisit later)", revisit_days: 30, sort: 2 },
    { reason_key: "budget", name: "Budget", revisit_days: 60, sort: 3 },
    { reason_key: "staying", name: "Staying with current software", revisit_days: 90, sort: 4 },
    { reason_key: "competitor", name: "Bought another software", revisit_days: 300, sort: 5 },
    { reason_key: "unreachable", name: "Unreachable", revisit_days: 60, sort: 6 },
    { reason_key: "not_restaurant", name: "Not a restaurant", revisit_days: null, sort: 7 },
    { reason_key: "wrong_number", name: "Wrong number", revisit_days: null, sort: 8 },
    { reason_key: "duplicate", name: "Duplicate", revisit_days: null, sort: 9 },
];

// next_after_minutes = working minutes.
const OUTCOMES = [
    { outcome_key: "interested", name: "Interested", reached: true, next_type: "call", next_after_minutes: 450, suggest_stage_key: "contacted", sort: 1 },
    { outcome_key: "callback", name: "Call back later", reached: true, next_type: "call", next_after_minutes: 180, suggest_stage_key: "contacted", sort: 2 },
    { outcome_key: "no_answer", name: "No answer", reached: false, next_type: "call", next_after_minutes: 180, sort: 3 },
    { outcome_key: "busy", name: "Busy", reached: false, next_type: "call", next_after_minutes: 60, sort: 4 },
    { outcome_key: "switched_off", name: "Switched off", reached: false, next_type: "call", next_after_minutes: 450, sort: 5 },
    { outcome_key: "whatsapp", name: "Asked for details on WhatsApp", reached: true, next_type: "whatsapp", next_after_minutes: 0, suggest_stage_key: "contacted", sort: 6 },
    { outcome_key: "demo_booked", name: "Demo booked", reached: true, next_type: "demo", next_after_minutes: 450, suggest_stage_key: "demo", sort: 7 },
    { outcome_key: "demo_done", name: "Demo done", reached: true, next_type: "proposal", next_after_minutes: 60, suggest_stage_key: "proposal", sort: 8 },
    { outcome_key: "demo_noshow", name: "Demo no-show", reached: false, next_type: "call", next_after_minutes: 60, sort: 9 },
    { outcome_key: "not_interested", name: "Not interested", reached: true, lost_reason_key: "not_interested", sort: 10 },
    { outcome_key: "wrong_number", name: "Wrong number", reached: false, lost_reason_key: "wrong_number", sort: 11 },
];

let ensured = false;
async function ensureDefaults() {
    if (ensured) return;
    for (const s of STAGES) if (!(await CrmStage.findOne({ where: { stage_key: s.stage_key } }))) await CrmStage.create({ ...s, is_system: true });
    for (const r of LOST_REASONS) if (!(await CrmLostReason.findOne({ where: { reason_key: r.reason_key } }))) await CrmLostReason.create({ ...r, is_system: true });
    for (const o of OUTCOMES) if (!(await CrmOutcome.findOne({ where: { outcome_key: o.outcome_key } }))) await CrmOutcome.create({ ...o, is_system: true });
    ensured = true;
}

let cache = null;
let cachedAt = 0;
async function load(force = false) {
    if (!force && cache && Date.now() - cachedAt < 30000) return cache;
    await ensureDefaults();
    const [stages, outcomes, reasons] = await Promise.all([
        CrmStage.findAll({ order: [["sort", "ASC"], ["id", "ASC"]], raw: true }),
        CrmOutcome.findAll({ order: [["sort", "ASC"], ["id", "ASC"]], raw: true }),
        CrmLostReason.findAll({ order: [["sort", "ASC"], ["id", "ASC"]], raw: true }),
    ]);
    const byKey = (rows, k) => new Map(rows.map((r) => [r[k], r]));
    cache = {
        stages,
        outcomes,
        reasons,
        stageById: new Map(stages.map((s) => [s.id, s])),
        stageByKey: byKey(stages, "stage_key"),
        outcomeById: new Map(outcomes.map((o) => [o.id, o])),
        outcomeByKey: byKey(outcomes, "outcome_key"),
        reasonById: new Map(reasons.map((r) => [r.id, r])),
        reasonByKey: byKey(reasons, "reason_key"),
        openStageIds: stages.filter((s) => s.kind === "open").map((s) => s.id),
    };
    cachedAt = Date.now();
    return cache;
}
const invalidate = () => {
    cache = null;
};

const stageView = (s) => ({ id: s.id, key: s.stage_key, name: s.name, kind: s.kind, sort: s.sort, active: !!s.active, system: !!s.is_system, hoursAllowed: s.hours_allowed });
const outcomeView = (o) => ({ id: o.id, key: o.outcome_key, name: o.name, reached: !!o.reached, nextType: o.next_type, nextAfterMinutes: o.next_after_minutes, suggestStage: o.suggest_stage_key, lostReason: o.lost_reason_key, active: !!o.active, system: !!o.is_system, sort: o.sort });
const reasonView = (r) => ({ id: r.id, key: r.reason_key, name: r.name, revisitDays: r.revisit_days, active: !!r.active, system: !!r.is_system, sort: r.sort });

/** For every lead screen. */
async function view() {
    const c = await load();
    return {
        stages: c.stages.map(stageView),
        outcomes: c.outcomes.map(outcomeView),
        lostReasons: c.reasons.map(reasonView),
        nextTypes: NEXT_TYPES.map((k) => ({ key: k, name: NEXT_LABEL[k] })),
        businessTypes: BUSINESS_TYPES,
        sources: ["website", "meta", "whatsapp", "phone", "manual", "referral", "import"],
    };
}

const txt = (v, n) => String(v ?? "").trim().slice(0, n);
const slug = (v) => txt(v, 40).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 30);

async function saveStage(s, input = {}) {
    need(s, "settings.manage");
    const id = Number(input.id) || 0;
    const name = txt(input.name, 60);
    if (!name) throw new RuleError("Enter the stage name.");
    const hours = input.hoursAllowed === "" || input.hoursAllowed == null ? null : Number(input.hoursAllowed);
    if (hours !== null && (!Number.isInteger(hours) || hours < 1 || hours > 8760)) throw new RuleError("Hours allowed must be a whole number of hours.");
    const sort = Number.isInteger(Number(input.sort)) ? Number(input.sort) : 50;
    const r = await sequelize.transaction(async (t) => {
        if (id) {
            const row = await CrmStage.findOne({ where: { id }, transaction: t });
            if (!row) throw new RuleError("This stage no longer exists.");
            const before = row.get({ plain: true });
            const fields = { name, hours_allowed: hours };
            if (row.kind === "open") {
                fields.sort = Math.max(1, Math.min(89, sort));
                if (!row.is_system) fields.active = input.active !== false;
            }
            await row.update(fields, { transaction: t });
            await audit.write(s, { action: "crm.stage.update", entity: "crm_stage", entityId: row.id, summary: `Edited stage ${row.name}`, before, after: row }, { transaction: t });
            return { id: row.id };
        }
        const key = slug(input.key || name) || `stage_${Date.now()}`;
        if (await CrmStage.findOne({ where: { stage_key: key }, transaction: t })) throw new RuleError("A stage with this name already exists.");
        const row = await CrmStage.create({ stage_key: key, name, kind: "open", sort: Math.max(1, Math.min(89, sort)), hours_allowed: hours, is_system: false }, { transaction: t });
        await audit.write(s, { action: "crm.stage.create", entity: "crm_stage", entityId: row.id, summary: `Added stage ${row.name}`, after: row }, { transaction: t });
        return { id: row.id };
    });
    invalidate();
    return r;
}

async function saveOutcome(s, input = {}) {
    need(s, "settings.manage");
    const id = Number(input.id) || 0;
    const name = txt(input.name, 60);
    if (!name) throw new RuleError("Enter the outcome name.");
    const c = await load(true);
    const lostReason = input.lostReason ? String(input.lostReason) : null;
    if (lostReason && !c.reasonByKey.has(lostReason)) throw new RuleError("Choose an existing lost reason.");
    const nextType = lostReason ? null : String(input.nextType || "call");
    if (nextType && !NEXT_TYPES.includes(nextType)) throw new RuleError("Choose the next action type.");
    const after = lostReason ? null : Number(input.nextAfterMinutes);
    if (!lostReason && (!Number.isInteger(after) || after < 0 || after > 60 * 24 * 30)) throw new RuleError("Next action after: whole minutes, 0 or more.");
    const suggest = input.suggestStage ? String(input.suggestStage) : null;
    if (suggest && !c.stageByKey.has(suggest)) throw new RuleError("Choose an existing stage.");
    const fields = { name, reached: !!input.reached, next_type: nextType, next_after_minutes: after, suggest_stage_key: suggest, lost_reason_key: lostReason, sort: Number(input.sort) || 50, active: input.active !== false };
    const r = await sequelize.transaction(async (t) => {
        if (id) {
            const row = await CrmOutcome.findOne({ where: { id }, transaction: t });
            if (!row) throw new RuleError("This outcome no longer exists.");
            const before = row.get({ plain: true });
            await row.update(fields, { transaction: t });
            await audit.write(s, { action: "crm.outcome.update", entity: "crm_outcome", entityId: row.id, summary: `Edited outcome ${row.name}`, before, after: row }, { transaction: t });
            return { id: row.id };
        }
        const key = slug(name);
        if (await CrmOutcome.findOne({ where: { outcome_key: key }, transaction: t })) throw new RuleError("An outcome with this name already exists.");
        const row = await CrmOutcome.create({ ...fields, outcome_key: key, is_system: false }, { transaction: t });
        await audit.write(s, { action: "crm.outcome.create", entity: "crm_outcome", entityId: row.id, summary: `Added outcome ${row.name}`, after: row }, { transaction: t });
        return { id: row.id };
    });
    invalidate();
    return r;
}

async function saveReason(s, input = {}) {
    need(s, "settings.manage");
    const id = Number(input.id) || 0;
    const name = txt(input.name, 80);
    if (!name) throw new RuleError("Enter the reason.");
    const days = input.revisitDays === "" || input.revisitDays == null ? null : Number(input.revisitDays);
    if (days !== null && (!Number.isInteger(days) || days < 1 || days > 730)) throw new RuleError("Revisit after: 1 to 730 days, or empty for never.");
    const fields = { name, revisit_days: days, sort: Number(input.sort) || 50, active: input.active !== false };
    const r = await sequelize.transaction(async (t) => {
        if (id) {
            const row = await CrmLostReason.findOne({ where: { id }, transaction: t });
            if (!row) throw new RuleError("This reason no longer exists.");
            const before = row.get({ plain: true });
            await row.update(fields, { transaction: t });
            await audit.write(s, { action: "crm.reason.update", entity: "crm_lost_reason", entityId: row.id, summary: `Edited lost reason ${row.name}`, before, after: row }, { transaction: t });
            return { id: row.id };
        }
        const key = slug(name);
        if (await CrmLostReason.findOne({ where: { reason_key: key }, transaction: t })) throw new RuleError("A reason with this name already exists.");
        const row = await CrmLostReason.create({ ...fields, reason_key: key, is_system: false }, { transaction: t });
        await audit.write(s, { action: "crm.reason.create", entity: "crm_lost_reason", entityId: row.id, summary: `Added lost reason ${row.name}`, after: row }, { transaction: t });
        return { id: row.id };
    });
    invalidate();
    return r;
}

module.exports = { load, view, invalidate, ensureDefaults, saveStage, saveOutcome, saveReason, NEXT_TYPES, NEXT_LABEL, BUSINESS_TYPES, Op };
