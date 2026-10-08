const { Op } = require("sequelize");
const { sequelize, CrmLeadV2, CrmInquiry, CrmTaskV2, CrmActivity, CrmCall, CrmAssignment, AdmUser, CrmWaChat, CrmEscalation } = require("../../model");
const { RuleError } = require("../../appv1/core");
const queue = require("../../services/admin/queue");
const { need } = require("../auth");
const config = require("./config");
const scope = require("./scope");
const { syncNext, addTask, cancelOpen, openCount, scoreFacts } = require("./tasks");
const { scoreLead, band, weights } = require("./score");
const { assign, pickOwner } = require("./assign");
const { notify } = require("./notify");
const { normalizePhone, firstContactDue, txt, intOrNull, json, parse, moment, TZ } = require("./util");

// Leads: list, detail, create, edit, outcome (the heart of the CRM: every
// call or chat ends with an outcome that sets the next action), stage moves,
// won / lost / reopen, notes, reassign, tasks and merging duplicates.
// Rule kept everywhere: an OPEN lead always has at least one open task.

const NOT_FOUND = "This lead does not exist or is not yours.";

/* ------------------------------ helpers ------------------------------ */

async function names(ids) {
    const list = [...new Set(ids.filter(Boolean))];
    if (!list.length) return new Map();
    return new Map((await AdmUser.findAll({ where: { id: list }, attributes: ["id", "name"], raw: true })).map((u) => [u.id, u.name]));
}

function row(l, c, who) {
    const st = c.stageById.get(l.stage_id) || { id: l.stage_id, name: "?", stage_key: "?", kind: "open" };
    const reason = l.lost_reason_id ? c.reasonById.get(l.lost_reason_id) : null;
    return {
        id: l.id,
        name: l.name,
        phone: l.phone,
        phoneValid: !!l.phone_valid,
        restaurant: l.restaurant_name,
        city: l.city,
        source: l.source,
        stage: { id: st.id, key: st.stage_key, name: st.name, kind: st.kind },
        owner: l.owner_id ? { id: l.owner_id, name: who.get(l.owner_id) || `#${l.owner_id}` } : null,
        score: l.score,
        band: band(l.score),
        nextAction: l.next_action_at ? { at: l.next_action_at, type: l.next_action_type, note: l.next_action_note } : null,
        lastActivityAt: l.last_activity_at,
        firstContactAt: l.first_contact_at,
        responseDueAt: l.response_due_at,
        lostReason: reason ? reason.name : null,
        revisitAt: l.revisit_at,
        wonAt: l.won_at,
        createdAt: l.createdAt,
    };
}

async function getLead(s, id, t, lock = false) {
    const lead = await CrmLeadV2.findOne({ where: { id: Number(id) || 0, deleted_at: null }, transaction: t, ...(lock && t ? { lock: t.LOCK.UPDATE } : {}) });
    if (!lead || !(await scope.canSee(s, lead))) throw new RuleError(NOT_FOUND);
    return lead;
}

const isOpen = (c, lead) => c.stageById.get(lead.stage_id)?.kind === "open";

async function recalc(lead, t) {
    const c = await config.load();
    const facts = await scoreFacts(lead.id, t);
    const { score } = scoreLead(lead.get ? lead.get({ plain: true }) : lead, c.stageById.get(lead.stage_id)?.stage_key, facts, new Date(), await weights());
    if (score !== lead.score) await CrmLeadV2.update({ score }, { where: { id: lead.id }, transaction: t });
    return score;
}

const activity = (leadId, type, actorId, body, data, t, extra = {}) =>
    CrmActivity.create({ lead_id: leadId, type, actor_id: actorId, body: String(body || "").slice(0, 1000), data: data ? JSON.stringify(data) : null, at: new Date(), ...extra }, { transaction: t });

function parseDue(v, label = "next action") {
    const d = v ? new Date(v) : null;
    if (!d || Number.isNaN(d.getTime())) throw new RuleError(`Choose when the ${label} is due.`);
    if (d.getTime() < Date.now() - 5 * 60000) throw new RuleError(`The ${label} cannot be in the past.`);
    if (d.getTime() > Date.now() + 400 * 86400000) throw new RuleError(`The ${label} is too far ahead (more than a year).`);
    return d;
}

function cleanNext(next) {
    if (!next || typeof next !== "object") throw new RuleError("Every open lead needs a next action: choose what and when.");
    const type = String(next.type || "");
    if (!config.NEXT_TYPES.includes(type)) throw new RuleError("Choose the next action (call, WhatsApp, demo...).");
    return { type, dueAt: parseDue(next.dueAt), note: txt(next.note, 300) };
}

/* ------------------------------ list ------------------------------ */

const VIEWS = ["my_open", "open", "overdue", "new", "unassigned", "revisit", "won_month", "lost", "all"];

async function viewWhere(s, view, c, now) {
    const open = { stage_id: c.openStageIds };
    const won = c.stages.filter((x) => x.kind === "won").map((x) => x.id);
    const lost = c.stages.filter((x) => x.kind === "lost").map((x) => x.id);
    switch (view) {
        case "my_open":
            return { ...open, owner_id: s.user.id };
        case "open":
            return open;
        case "overdue":
            return { ...open, next_action_at: { [Op.lt]: now } };
        case "new":
            return { stage_id: c.stageByKey.get("new")?.id || 0, first_contact_at: null };
        case "unassigned":
            return { ...open, owner_id: null };
        case "revisit":
            return { stage_id: lost, revisit_at: { [Op.ne]: null } };
        case "won_month":
            return { stage_id: won, won_at: { [Op.gte]: moment(now).tz(TZ).startOf("month").toDate() } };
        case "lost":
            return { stage_id: lost };
        default:
            return {};
    }
}

async function list(s, query = {}) {
    const c = await config.load();
    const now = new Date();
    const base = { ...(await scope.leadWhere(s)), deleted_at: null, merged_into_id: null };
    const view = VIEWS.includes(query.view) ? query.view : "my_open";
    if (view === "unassigned" && !s.can("leads.view_all")) throw new RuleError("You do not have permission for this.");
    const where = { ...base, ...(await viewWhere(s, view, c, now)) };
    const q = txt(query.q, 60);
    if (q) {
        const d = q.replace(/\D/g, "");
        where[Op.or] = [
            { name: { [Op.like]: `%${q}%` } },
            { restaurant_name: { [Op.like]: `%${q}%` } },
            { city: { [Op.like]: `%${q}%` } },
            { email: { [Op.like]: `%${q}%` } },
            ...(d.length >= 4 ? [{ phone_key: { [Op.like]: `%${d.slice(-10)}%` } }] : []),
        ];
    }
    if (query.stageId) where.stage_id = Number(query.stageId) || 0;
    if (query.source) where.source = String(query.source).slice(0, 20);
    if (query.ownerId === "none") where.owner_id = null;
    else if (query.ownerId) {
        const o = Number(query.ownerId) || 0;
        if (base.owner_id && !base.owner_id.includes(o)) throw new RuleError("You do not have permission for this.");
        where.owner_id = o;
    }
    if (query.band === "hot") where.score = { [Op.gte]: 60 };
    else if (query.band === "warm") where.score = { [Op.gte]: 30, [Op.lt]: 60 };
    else if (query.band === "cold") where.score = { [Op.lt]: 30 };
    // Report drill-downs (phase 7): created / won in a period (India dates), stage kind, lost reason, never contacted.
    const day = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) ? moment.tz(String(v), TZ) : null);
    const range = (fromV, toV) => {
        const f = day(fromV);
        const t2 = day(toV);
        if (!f && !t2) return null;
        return { ...(f ? { [Op.gte]: f.startOf("day").toDate() } : {}), ...(t2 ? { [Op.lt]: t2.add(1, "day").startOf("day").toDate() } : {}) };
    };
    const created = range(query.from, query.to);
    if (created) where.createdAt = created;
    const wonIn = range(query.wonFrom, query.wonTo);
    if (wonIn) where.won_at = wonIn;
    if (["won", "lost", "open"].includes(query.stageKind) && !query.stageId) where.stage_id = c.stages.filter((st) => st.kind === query.stageKind).map((st) => st.id);
    if (query.lostReasonId === "none") where.lost_reason_id = null;
    else if (query.lostReasonId) where.lost_reason_id = Number(query.lostReasonId) || 0;
    if (query.contacted === "no") where.first_contact_at = null;

    const order =
        view === "won_month" ? [["won_at", "DESC"]] : view === "lost" ? [["closed_at", "DESC"]] : view === "revisit" ? [["revisit_at", "ASC"]] : view === "all" ? [["createdAt", "DESC"]] : [[sequelize.literal("next_action_at IS NULL"), "DESC"], ["next_action_at", "ASC"], ["id", "ASC"]];
    const limit = Math.min(100, Math.max(10, Number(query.limit) || 50));
    const page = Math.max(1, Number(query.page) || 1);
    const { rows, count } = await CrmLeadV2.findAndCountAll({ where, order: [...order, ["id", "DESC"]], limit, offset: (page - 1) * limit, raw: true });
    const who = await names(rows.map((r) => r.owner_id));

    const counts = {};
    for (const v of ["my_open", "overdue", "new", "revisit", "won_month", ...(s.can("leads.view_all") ? ["unassigned"] : [])]) {
        counts[v] = await CrmLeadV2.count({ where: { ...base, ...(await viewWhere(s, v, c, now)) } });
    }
    return { serverTime: now.toISOString(), view, total: count, page, limit, counts, leads: rows.map((r) => row(r, c, who)) };
}

/* ------------------------------ detail ------------------------------ */

async function detail(s, id) {
    const c = await config.load();
    const lead = await getLead(s, id);
    const l = lead.get({ plain: true });
    const [tasks, acts, calls, inquiries, dups] = await Promise.all([
        CrmTaskV2.findAll({ where: { lead_id: l.id }, order: [["status", "DESC"], ["due_at", "ASC"]], limit: 60, raw: true }),
        CrmActivity.findAll({ where: { lead_id: l.id }, order: [["at", "DESC"], ["id", "DESC"]], limit: 200, raw: true }),
        CrmCall.findAll({ where: { lead_id: l.id }, order: [["started_at", "DESC"]], limit: 50, raw: true }),
        CrmInquiry.findAll({ where: { lead_id: l.id }, order: [["received_at", "DESC"]], limit: 30, raw: true }),
        l.phone_key && l.phone_key.length >= 10 ? CrmLeadV2.findAll({ where: { phone_key: l.phone_key, id: { [Op.ne]: l.id }, deleted_at: null }, attributes: ["id", "name", "stage_id", "owner_id", "createdAt", "merged_into_id"], raw: true }) : [],
    ]);
    const who = await names([l.owner_id, ...tasks.map((x) => x.owner_id), ...acts.map((x) => x.actor_id), ...calls.map((x) => x.user_id), ...dups.map((d) => d.owner_id)]);
    const facts = await scoreFacts(l.id);
    const sc = scoreLead(l, c.stageById.get(l.stage_id)?.stage_key, facts, new Date(), await weights());
    return {
        serverTime: new Date().toISOString(),
        lead: {
            ...row(l, c, who),
            altPhone: l.alt_phone,
            email: l.email,
            businessType: l.business_type,
            state: l.state,
            outlets: l.outlets_count,
            tables: l.tables_count,
            currentSoftware: l.current_software,
            planInterest: l.plan_interest,
            hardwareNeed: l.hardware_need,
            budget: l.budget,
            decisionMaker: l.decision_maker,
            expectedStart: l.expected_start,
            dealAmount: l.deal_amount === null ? null : Number(l.deal_amount),
            agreedAmount: l.agreed_amount === null ? null : Number(l.agreed_amount),
            payDueOn: l.pay_due_on,
            payRef: l.pay_ref,
            sourceDetail: parse(l.source_detail),
            lostNote: l.lost_note,
            mergedIntoId: l.merged_into_id,
            scoreReasons: sc.reasons,
            canEdit: s.can("leads.edit"),
            canAssign: s.can("leads.assign"),
            canMerge: s.can("leads.delete"),
        },
        tasks: tasks.map((x) => ({ id: x.id, type: x.type, note: x.note, dueAt: x.due_at, status: x.status, owner: x.owner_id ? who.get(x.owner_id) || "" : "", doneAt: x.done_at, outcome: x.outcome_id ? c.outcomeById.get(x.outcome_id)?.name || "" : "", origin: x.origin })),
        timeline: acts.map((a) => ({ id: a.id, type: a.type, at: a.at, actor: a.actor_id ? who.get(a.actor_id) || `#${a.actor_id}` : "System", outcome: a.outcome_id ? c.outcomeById.get(a.outcome_id)?.name || "" : "", body: a.body, data: parse(a.data) })),
        calls: calls.map((x) => ({ id: x.id, at: x.started_at, by: x.user_id ? who.get(x.user_id) || "" : "", direction: x.direction, seconds: x.duration_seconds, answered: !!x.answered, source: x.source, recorded: x.recorded, hasRecording: !!x.recording_url, outcome: x.outcome_id ? c.outcomeById.get(x.outcome_id)?.name || "" : "" })),
        inquiries: inquiries.map((q) => ({ id: q.id, source: q.source, at: q.received_at, message: q.message, detail: parse(q.source_detail) })),
        duplicates: dups.map((d) => ({ id: d.id, name: d.name, stage: c.stageById.get(d.stage_id)?.name || "", owner: d.owner_id ? who.get(d.owner_id) || "" : "", createdAt: d.createdAt, mergedIntoId: d.merged_into_id })),
        whatsapp: await chatSummary(l),
        cadences: await require("./cadences").forLead(l.id),
        escalations: (await CrmEscalation.findAll({ where: { lead_id: l.id, status: "open" }, raw: true })).map((e) => ({ id: e.id, kind: e.kind, level: e.level, raisedAt: e.raised_at, nextLevelAt: e.next_level_at })),
        customer: await customerOf(l),
    };
}

/** A won lead's customer account and outlet (phase 5), when there is one. */
async function customerOf(l) {
    const { CsAccount, CsAccountOutlet, Hotel } = require("../../model");
    const link = l.hotel_id ? await CsAccountOutlet.findOne({ where: { hotel_id: l.hotel_id }, attributes: ["account_id", "hotel_id", "onboarding", "health"], raw: true }) : null;
    const acc = link ? await CsAccount.findOne({ where: { id: link.account_id }, attributes: ["id", "name"], raw: true }) : await CsAccount.findOne({ where: { lead_id: l.id }, attributes: ["id", "name"], raw: true });
    if (!acc && !l.hotel_id) return null;
    const hotel = l.hotel_id ? await Hotel.findOne({ where: { id: l.hotel_id }, attributes: ["id", "hotel_name"], raw: true }) : null;
    return { accountId: acc ? acc.id : null, accountName: acc ? acc.name : "", hotelId: hotel ? hotel.id : null, outlet: hotel ? hotel.hotel_name : "", onboarding: link ? link.onboarding : "none", health: link ? link.health : "grey" };
}

/** The lead's WhatsApp chat, for the lead page. */
async function chatSummary(l) {
    const chat = l.phone_key && l.phone_key.length >= 10 ? await CrmWaChat.findOne({ where: { [Op.or]: [{ lead_id: l.id }, { phone_key: l.phone_key }] }, order: [["last_message_at", "DESC"]] }) : null;
    if (!chat) return null;
    const wa = require("./wa");
    return { chatId: chat.id, preview: chat.preview, lastAt: chat.last_message_at, lastInAt: chat.last_in_at, needsReply: !!chat.needs_reply, unread: chat.unread, windowOpen: wa.windowOpen(chat), optedOut: await wa.optedOut(chat.phone_key) };
}

/* ------------------------------ create / edit ------------------------------ */

const DETAIL_FIELDS = {
    name: ["name", 120],
    email: ["email", 120],
    altPhone: ["alt_phone", 24],
    restaurant: ["restaurant_name", 120],
    businessType: ["business_type", 30],
    city: ["city", 60],
    state: ["state", 40],
    currentSoftware: ["current_software", 80],
    planInterest: ["plan_interest", 30],
    hardwareNeed: ["hardware_need", 120],
    budget: ["budget", 60],
    decisionMaker: ["decision_maker", 120],
    payRef: ["pay_ref", 80],
};

function detailFields(input) {
    const out = {};
    for (const [k, [col, n]] of Object.entries(DETAIL_FIELDS)) if (input[k] !== undefined) out[col] = txt(input[k], n);
    for (const [k, col] of [["outlets", "outlets_count"], ["tables", "tables_count"]]) {
        if (input[k] !== undefined) {
            const v = intOrNull(input[k]);
            if (Number.isNaN(v) || (v !== null && (v < 0 || v > 10000))) throw new RuleError("Outlets and tables must be whole numbers.");
            out[col] = v;
        }
    }
    if (input.expectedStart !== undefined) {
        const v = input.expectedStart ? String(input.expectedStart) : null;
        if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new RuleError("Choose the expected start date.");
        out.expected_start = v;
    }
    // Payment tracking: rupees, before GST as quoted.
    for (const [k, col] of [["dealAmount", "deal_amount"], ["agreedAmount", "agreed_amount"]]) {
        if (input[k] === undefined) continue;
        const raw = input[k] === null || input[k] === "" ? null : Number(String(input[k]).replace(/[,\s₹]/g, ""));
        if (raw !== null && (!Number.isFinite(raw) || raw < 0 || raw > 100000000)) throw new RuleError("Write the amount in rupees, for example 11999.");
        out[col] = raw === null ? null : Math.round(raw * 100) / 100;
    }
    if (input.payDueOn !== undefined) {
        const v = input.payDueOn ? String(input.payDueOn) : null;
        if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new RuleError("Choose the payment due date.");
        out.pay_due_on = v;
    }
    if (out.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out.email)) throw new RuleError("The email address does not look right.");
    return out;
}

/** An open (not merged, not deleted) lead with this phone, if any. */
async function findByPhone(key, t) {
    if (!key || key.length < 10) return null;
    return CrmLeadV2.findOne({ where: { phone_key: key, deleted_at: null, merged_into_id: null }, order: [["id", "DESC"]], transaction: t });
}

/**
 * Creates a lead row in stage New with its first-contact task, owner and
 * timeline. Used by manual entry and by intake. Returns the lead.
 */
async function createLead({ fields, phone, source, sourceDetail = null, actorId = null, ownerId, message = "", at = new Date() }, t) {
    const c = await config.load();
    const responseDue = await firstContactDue(at);
    const lead = await CrmLeadV2.create(
        { ...fields, phone: phone.phone, phone_key: phone.key, phone_valid: phone.valid, source, source_detail: json(sourceDetail), stage_id: c.stageByKey.get("new").id, owner_id: null, response_due_at: responseDue, last_activity_at: null, created_by: actorId },
        { transaction: t },
    );
    await activity(lead.id, "created", actorId, message ? `Lead from ${source}: ${message}` : `Lead from ${source}`, { source, sourceDetail }, t);
    if (phone.valid) await require("./wa").linkLead(phone.key, lead.id, t);
    let owner = ownerId;
    let reason = actorId ? "Added by hand" : "";
    if (owner === undefined) {
        const pick = await pickOwner({ phoneKey: phone.key, excludeLeadId: lead.id }, at);
        owner = pick ? pick.id : null;
        reason = pick ? pick.reason : "Nobody can take leads right now";
    }
    if (owner) await assign(lead, owner, { byId: ownerId !== undefined ? actorId : null, reason }, t);
    await addTask({ leadId: lead.id, ownerId: owner || null, type: "call", dueAt: responseDue, note: "First call", origin: "intake", createdBy: actorId }, t);
    await syncNext(lead.id, t);
    await queue.emit({ type: "lead.created", entity: "crm_lead", entityId: lead.id, data: { source }, actorId }, { transaction: t });
    await recalc(lead, t);
    return lead;
}

/** New lead by hand. A number already in the CRM is not added again: the answer names the existing lead. */
async function create(s, input = {}) {
    need(s, "leads.edit");
    const phone = normalizePhone(input.phone);
    if (!phone.valid) throw new RuleError("Enter a valid mobile number (10 digits for India).");
    const fields = detailFields(input);
    if (!fields.name && !fields.restaurant_name) throw new RuleError("Enter the person's name or the restaurant.");
    const source = ["manual", "referral", "phone", "whatsapp", "website", "meta"].includes(input.source) ? input.source : "manual";
    return sequelize.transaction(async (t) => {
        const existing = await findByPhone(phone.key, t);
        if (existing) {
            const who = await names([existing.owner_id]);
            return { duplicate: { id: existing.id, name: existing.name || existing.phone, owner: existing.owner_id ? who.get(existing.owner_id) || "" : "nobody" } };
        }
        let ownerId;
        if (input.ownerId === "me" || (!s.can("leads.assign") && input.ownerId !== "auto")) ownerId = s.user.id;
        else if (input.ownerId && input.ownerId !== "auto") ownerId = Number(input.ownerId) || null;
        const lead = await createLead({ fields, phone, source, sourceDetail: input.referredBy ? { referredBy: txt(input.referredBy, 120) } : null, actorId: s.user.id, ownerId, message: txt(input.message, 500) }, t);
        if (input.message) await CrmInquiry.create({ lead_id: lead.id, source, name: fields.name || "", phone: phone.phone, email: fields.email || "", message: txt(input.message, 1000), received_at: new Date() }, { transaction: t });
        return { id: lead.id };
    });
}

async function update(s, id, input = {}) {
    need(s, "leads.edit");
    return sequelize.transaction(async (t) => {
        const lead = await getLead(s, id, t, true);
        const fields = detailFields(input);
        if (input.phone !== undefined) {
            const p = normalizePhone(input.phone);
            if (!p.valid) throw new RuleError("Enter a valid mobile number.");
            if (p.key !== lead.phone_key) {
                const other = await findByPhone(p.key, t);
                if (other && other.id !== lead.id) throw new RuleError(`This number is already on another lead (#${other.id}). Merge them instead.`);
            }
            Object.assign(fields, { phone: p.phone, phone_key: p.key, phone_valid: true });
        }
        const before = lead.get({ plain: true });
        const norm = (k, v) => (/_amount$/.test(k) && v !== null && v !== undefined ? String(Number(v)) : String(v ?? ""));
        const changed = Object.keys(fields).filter((k) => norm(k, before[k]) !== norm(k, fields[k]));
        if (!changed.length) return { id: lead.id };
        await lead.update(fields, { transaction: t });
        await activity(lead.id, "edit", s.user.id, `Updated ${changed.map((k) => k.replace(/_/g, " ")).join(", ")}`, { changed: Object.fromEntries(changed.map((k) => [k, [before[k], fields[k]]])) }, t);
        await recalc(lead, t);
        return { id: lead.id };
    });
}

/* ------------------------------ outcome ------------------------------ */

/**
 * Logs what happened on a call or chat. The outcome's lost reason closes
 * the lead; any other outcome needs the next action (type + when). The
 * earliest open task is marked done with this outcome. Optional: a typed
 * call (direction, seconds), a stage move, a note.
 */
async function logOutcome(s, id, input = {}) {
    need(s, "leads.edit");
    const c = await config.load();
    const outcome = c.outcomeById.get(Number(input.outcomeId) || 0);
    if (!outcome || !outcome.active) throw new RuleError("Choose what happened.");
    const note = txt(input.note, 1000);
    const r = await sequelize.transaction(async (t) => {
        const lead = await getLead(s, id, t, true);
        if (!isOpen(c, lead)) throw new RuleError("This lead is closed. Reopen it first.");
        const now = new Date();
        const prevStage = c.stageById.get(lead.stage_id);

        // The task being worked = the earliest open one. A contact also
        // settles every other open call / WhatsApp task (a first call and an
        // "enquired again" call back are the same call); planned demos,
        // proposals, payments and visits stay.
        const task = await CrmTaskV2.findOne({ where: { lead_id: lead.id, status: "open" }, order: [["due_at", "ASC"], ["id", "ASC"]], transaction: t });
        if (task) await task.update({ status: "done", done_at: now, done_by: s.user.id, outcome_id: outcome.id }, { transaction: t });
        await CrmTaskV2.update({ status: "done", done_at: now, done_by: s.user.id, outcome_id: outcome.id }, { where: { lead_id: lead.id, status: "open", type: ["call", "whatsapp"] }, transaction: t });

        // the call, when this was a call (call: false = a WhatsApp chat or a visit)
        const wasCall = input.call === false ? false : input.call ? true : !task || task.type === "call";
        // The sales app already logged the call from the phone's call log: the outcome goes on it.
        const appCall = input.callId ? await CrmCall.findOne({ where: { id: Number(input.callId) || 0, lead_id: lead.id }, transaction: t }) : null;
        if (input.callId && !appCall) throw new RuleError("That call is not on this lead.");
        if (appCall) await appCall.update({ outcome_id: outcome.id }, { transaction: t });
        else if (wasCall) {
            const call = input.call && typeof input.call === "object" ? input.call : {};
            const secs = Math.max(0, Math.min(36000, Number(call.seconds) || 0));
            await CrmCall.create({ lead_id: lead.id, user_id: s.user.id, source: "typed", direction: call.direction === "in" ? "in" : "out", phone: lead.phone, started_at: call.at ? new Date(call.at) : now, duration_seconds: secs, answered: !!outcome.reached, outcome_id: outcome.id }, { transaction: t });
        }

        const fields = { last_activity_at: now };
        if (!lead.first_contact_at) fields.first_contact_at = now;
        if (!lead.owner_id) await assign(lead, s.user.id, { byId: s.user.id, reason: "Took the lead by working it" }, t);

        const lostReason = outcome.lost_reason_key ? c.reasonByKey.get(outcome.lost_reason_key) : input.lostReasonId ? c.reasonById.get(Number(input.lostReasonId)) : null;
        let next = null;
        let toStage = prevStage;
        if (lostReason) {
            await cancelOpen(lead.id, t);
            const lostStage = c.stages.find((x) => x.kind === "lost");
            const revisit = input.revisitAt ? parseDue(input.revisitAt, "revisit date") : lostReason.revisit_days ? moment(now).add(lostReason.revisit_days, "days").toDate() : null;
            Object.assign(fields, { stage_id: lostStage.id, lost_reason_id: lostReason.id, lost_note: note.slice(0, 300), revisit_at: revisit, closed_at: now });
            toStage = lostStage;
        } else {
            next = cleanNext(input.next);
            const wanted = input.stageId ? c.stageById.get(Number(input.stageId)) : null;
            if (wanted && wanted.kind !== "open") throw new RuleError("Use Mark won or Mark lost to close a lead.");
            const suggested = outcome.suggest_stage_key ? c.stageByKey.get(outcome.suggest_stage_key) : null;
            if (wanted) toStage = wanted;
            else if (suggested && suggested.kind === "open" && suggested.sort > prevStage.sort) toStage = suggested;
            if (toStage.id !== prevStage.id) fields.stage_id = toStage.id;
            await addTask({ leadId: lead.id, ownerId: lead.owner_id || s.user.id, type: next.type, dueAt: next.dueAt, note: next.note, origin: "outcome", createdBy: s.user.id }, t);
        }
        await lead.update(fields, { transaction: t });
        const data = { outcome: outcome.outcome_key, reached: !!outcome.reached, stage: toStage.id !== prevStage.id ? [prevStage.name, toStage.name] : undefined, next: next ? { type: next.type, at: next.dueAt, note: next.note } : undefined, lostReason: lostReason ? lostReason.name : undefined, revisitAt: fields.revisit_at || undefined };
        await activity(lead.id, "outcome", s.user.id, note, data, t, { outcome_id: outcome.id });
        await syncNext(lead.id, t);
        await recalc(lead, t);
        await queue.emit({ type: lostReason ? "lead.lost" : "lead.outcome", entity: "crm_lead", entityId: lead.id, data, actorId: s.user.id }, { transaction: t });
        return { id: lead.id, closed: !!lostReason };
    });
    return r;
}

/* ------------------------------ stage / won / lost / reopen ------------------------------ */

/** Pipeline drag: a new open stage needs the next action; it replaces the open tasks. */
async function moveStage(s, id, input = {}) {
    need(s, "leads.edit");
    const c = await config.load();
    const stage = c.stageById.get(Number(input.stageId) || 0);
    if (!stage || stage.kind !== "open") throw new RuleError("Use Mark won or Mark lost to close a lead.");
    const next = cleanNext(input.next);
    return sequelize.transaction(async (t) => {
        const lead = await getLead(s, id, t, true);
        if (!isOpen(c, lead)) throw new RuleError("This lead is closed. Reopen it first.");
        const from = c.stageById.get(lead.stage_id);
        if (from.id === stage.id) throw new RuleError("The lead is already in this stage.");
        await cancelOpen(lead.id, t);
        await addTask({ leadId: lead.id, ownerId: lead.owner_id || s.user.id, type: next.type, dueAt: next.dueAt, note: next.note, origin: "manual", createdBy: s.user.id }, t);
        await lead.update({ stage_id: stage.id, last_activity_at: new Date() }, { transaction: t });
        await activity(lead.id, "stage", s.user.id, txt(input.note, 500), { stage: [from.name, stage.name], next: { type: next.type, at: next.dueAt } }, t);
        await syncNext(lead.id, t);
        await recalc(lead, t);
        await queue.emit({ type: "lead.stage", entity: "crm_lead", entityId: lead.id, data: { from: from.stage_key, to: stage.stage_key }, actorId: s.user.id }, { transaction: t });
        return { id: lead.id };
    });
}

async function markWon(s, id, input = {}) {
    need(s, "leads.edit");
    return sequelize.transaction(async (t) => {
        const lead = await getLead(s, id, t, true);
        await wonIn(s, lead, input, t);
        return { id: lead.id };
    });
}

/** Closes a locked, open lead as won inside `t` (also used by Mark won -> customer, adminv1/cs/won.js). */
async function wonIn(s, lead, input, t) {
    const c = await config.load();
    if (!isOpen(c, lead)) throw new RuleError("This lead is already closed.");
    const won = c.stages.find((x) => x.kind === "won");
    const now = new Date();
    await cancelOpen(lead.id, t);
    await lead.update({ stage_id: won.id, won_at: now, closed_at: now, last_activity_at: now, revisit_at: null, ...(input.hotelId ? { hotel_id: input.hotelId } : {}) }, { transaction: t });
    await activity(lead.id, "won", s.user.id, txt(input.note, 500), input.data || null, t);
    await syncNext(lead.id, t);
    await queue.emit({ type: "lead.won", entity: "crm_lead", entityId: lead.id, actorId: s.user.id }, { transaction: t });
    return lead;
}

async function markLost(s, id, input = {}) {
    need(s, "leads.edit");
    const c = await config.load();
    const reason = c.reasonById.get(Number(input.reasonId) || 0);
    if (!reason || !reason.active) throw new RuleError("Choose why the lead was lost.");
    return sequelize.transaction(async (t) => {
        const lead = await getLead(s, id, t, true);
        if (!isOpen(c, lead)) throw new RuleError("This lead is already closed.");
        const lostStage = c.stages.find((x) => x.kind === "lost");
        const now = new Date();
        const revisit = input.revisitAt ? parseDue(input.revisitAt, "revisit date") : reason.revisit_days ? moment(now).add(reason.revisit_days, "days").toDate() : null;
        await cancelOpen(lead.id, t);
        await lead.update({ stage_id: lostStage.id, lost_reason_id: reason.id, lost_note: txt(input.note, 300), revisit_at: revisit, closed_at: now, last_activity_at: now }, { transaction: t });
        await activity(lead.id, "lost", s.user.id, txt(input.note, 500), { lostReason: reason.name, revisitAt: revisit }, t);
        await syncNext(lead.id, t);
        await queue.emit({ type: "lead.lost", entity: "crm_lead", entityId: lead.id, data: { reason: reason.reason_key }, actorId: s.user.id }, { transaction: t });
        return { id: lead.id };
    });
}

/** Lost (or won by mistake) back to an open stage, with its next action. */
async function reopen(s, id, input = {}, opts = {}) {
    if (!opts.system) need(s, "leads.edit");
    const c = await config.load();
    const stage = input.stageId ? c.stageById.get(Number(input.stageId)) : c.stageByKey.get("contacted");
    if (!stage || stage.kind !== "open") throw new RuleError("Choose an open stage.");
    const next = opts.system ? input.next : cleanNext(input.next);
    const run = async (t) => {
        const lead = opts.system ? await CrmLeadV2.findOne({ where: { id }, transaction: t, lock: t.LOCK.UPDATE }) : await getLead(s, id, t, true);
        if (isOpen(c, lead)) throw new RuleError("This lead is already open.");
        await lead.update({ stage_id: stage.id, lost_reason_id: null, lost_note: "", revisit_at: null, closed_at: null, won_at: null, last_activity_at: new Date() }, { transaction: t });
        await addTask({ leadId: lead.id, ownerId: lead.owner_id, type: next.type, dueAt: next.dueAt, note: next.note, origin: opts.system ? "rule" : "manual", createdBy: opts.system ? null : s.user.id }, t);
        await activity(lead.id, "reopen", opts.system ? null : s.user.id, txt(input.note, 500) || (opts.system ? opts.why || "Reopened" : ""), { stage: stage.name }, t);
        await syncNext(lead.id, t);
        await recalc(lead, t);
        await queue.emit({ type: "lead.reopened", entity: "crm_lead", entityId: lead.id, data: { why: opts.why || "manual" }, actorId: opts.system ? null : s.user.id }, { transaction: t });
        return lead;
    };
    return opts.transaction ? run(opts.transaction) : sequelize.transaction(run).then((l) => ({ id: l.id }));
}

/* ------------------------------ notes, owner, tasks ------------------------------ */

async function addNote(s, id, text) {
    need(s, "leads.edit");
    const body = txt(text, 1000);
    if (!body) throw new RuleError("Write the note first.");
    return sequelize.transaction(async (t) => {
        const lead = await getLead(s, id, t, true);
        await activity(lead.id, "note", s.user.id, body, null, t);
        await lead.update({ last_activity_at: new Date() }, { transaction: t });
        return { id: lead.id };
    });
}

async function reassign(s, id, toId, reason) {
    need(s, "leads.assign");
    const to = toId ? Number(toId) : null;
    if (to) {
        const u = await AdmUser.findOne({ where: { id: to, status: "active" }, raw: true });
        if (!u) throw new RuleError("Choose an active person.");
        const owners = await scope.visibleOwners(s);
        if (owners !== null && !owners.includes(to)) throw new RuleError("You can give leads only to your own team.");
    }
    return sequelize.transaction(async (t) => {
        const lead = await getLead(s, id, t, true);
        await assign(lead, to, { byId: s.user.id, reason: txt(reason, 200) || "Reassigned" }, t);
        return { id: lead.id };
    });
}

/**
 * Many leads at once (old panel: bulk-select + bulk-assign). toId = a
 * person, or "auto" = round-robin for each lead, as if it had just come in.
 * Managers without "see every lead" give only to their own team.
 */
async function reassignMany(s, ids, toId, reason) {
    need(s, "leads.assign");
    const list = [...new Set((Array.isArray(ids) ? ids : []).map(Number).filter(Boolean))];
    if (!list.length) throw new RuleError("Choose at least one lead.");
    if (list.length > 200) throw new RuleError("Assign at most 200 leads at a time.");
    const auto = toId === "auto";
    const to = auto ? null : Number(toId) || null;
    if (!auto) {
        if (!to) throw new RuleError("Choose who gets the leads.");
        const u = await AdmUser.findOne({ where: { id: to, status: "active" }, raw: true });
        if (!u) throw new RuleError("Choose an active person.");
        const owners = await scope.visibleOwners(s);
        if (owners !== null && !owners.includes(to)) throw new RuleError("You can give leads only to your own team.");
    }
    const { pickOwner } = require("./assign");
    const why = txt(reason, 200) || (auto ? "Round-robin (bulk)" : "Reassigned (bulk)");
    let done = 0;
    const skipped = [];
    for (const id of list) {
        try {
            await sequelize.transaction(async (t) => {
                const lead = await getLead(s, id, t, true);
                const target = auto ? await pickOwner({ phoneKey: lead.phone_key, excludeLeadId: lead.id }) : { id: to, reason: why };
                if (!target) throw new RuleError("Nobody can take leads right now.");
                await assign(lead, target.id, { byId: s.user.id, reason: auto ? `${why} · ${target.reason}` : why }, t);
            });
            done += 1;
        } catch (e) {
            if (!(e instanceof RuleError)) throw e;
            skipped.push({ id, why: e.message });
        }
    }
    return { assigned: done, skipped };
}

/** Every open lead with no owner, by round-robin (old panel: "auto-assign unassigned"). */
async function assignUnassigned(s) {
    need(s, "leads.assign");
    if (!s.can("leads.view_all")) throw new RuleError("You do not have permission for this.");
    const c = await config.load();
    const rows = await CrmLeadV2.findAll({ where: { owner_id: null, stage_id: c.openStageIds, deleted_at: null, merged_into_id: null }, attributes: ["id"], order: [["createdAt", "ASC"]], limit: 200, raw: true });
    if (!rows.length) return { assigned: 0, skipped: [] };
    return reassignMany(s, rows.map((r) => r.id), "auto", "Round-robin (assign all unassigned)");
}

/** Adds a next action (an open lead can have several: a call today, a demo on Friday). */
async function addLeadTask(s, id, input = {}) {
    need(s, "leads.edit");
    const c = await config.load();
    const next = cleanNext(input);
    return sequelize.transaction(async (t) => {
        const lead = await getLead(s, id, t, true);
        if (!isOpen(c, lead)) throw new RuleError("This lead is closed. Reopen it first.");
        const task = await addTask({ leadId: lead.id, ownerId: lead.owner_id || s.user.id, type: next.type, dueAt: next.dueAt, note: next.note, origin: "manual", createdBy: s.user.id }, t);
        await activity(lead.id, "task", s.user.id, `${config.NEXT_LABEL[next.type]} planned`, { type: next.type, at: next.dueAt, note: next.note }, t);
        await syncNext(lead.id, t);
        return { id: task.id };
    });
}

/** Moves or rewords an open task; cancelling the last open task of an open lead is refused. */
async function updateTask(s, taskId, input = {}) {
    need(s, "leads.edit");
    const c = await config.load();
    return sequelize.transaction(async (t) => {
        const task = await CrmTaskV2.findOne({ where: { id: Number(taskId) || 0 }, transaction: t, lock: t.LOCK.UPDATE });
        if (!task) throw new RuleError("This task no longer exists.");
        const lead = await getLead(s, task.lead_id, t, true);
        if (task.status !== "open") throw new RuleError("This task is already closed.");
        if (input.cancel) {
            if (isOpen(c, lead) && (await openCount(lead.id, t)) <= 1) throw new RuleError("An open lead needs a next action. Add the new one first, or log an outcome.");
            await task.update({ status: "cancelled", done_at: new Date(), done_by: s.user.id }, { transaction: t });
            await activity(lead.id, "task", s.user.id, `${config.NEXT_LABEL[task.type]} cancelled`, null, t);
        } else {
            const fields = {};
            if (input.dueAt) fields.due_at = parseDue(input.dueAt);
            if (input.note !== undefined) fields.note = txt(input.note, 300);
            if (input.type) {
                if (!config.NEXT_TYPES.includes(input.type)) throw new RuleError("Choose the action type.");
                fields.type = input.type;
            }
            await task.update(fields, { transaction: t });
            if (fields.due_at) await activity(lead.id, "task", s.user.id, `${config.NEXT_LABEL[task.type]} moved`, { at: fields.due_at }, t);
        }
        await syncNext(lead.id, t);
        return { id: task.id };
    });
}

/* ------------------------------ merge ------------------------------ */

/** Joins `fromId` into `intoId`: inquiries, calls and open tasks move; the duplicate is closed as merged. */
async function merge(s, fromId, intoId) {
    need(s, "leads.delete");
    const c = await config.load();
    if (Number(fromId) === Number(intoId)) throw new RuleError("Choose two different leads.");
    return sequelize.transaction(async (t) => {
        const from = await getLead(s, fromId, t, true);
        const into = await getLead(s, intoId, t, true);
        if (from.merged_into_id) throw new RuleError("That lead was already merged.");
        await CrmInquiry.update({ lead_id: into.id }, { where: { lead_id: from.id }, transaction: t });
        await CrmCall.update({ lead_id: into.id }, { where: { lead_id: from.id }, transaction: t });
        await CrmTaskV2.update({ lead_id: into.id, owner_id: into.owner_id }, { where: { lead_id: from.id, status: "open" }, transaction: t });
        await CrmWaChat.update({ lead_id: into.id, kind: "lead" }, { where: { lead_id: from.id }, transaction: t });
        await require("./cadences").stopForLead(from.id, "merged", null, t);
        const dup = c.reasonByKey.get("duplicate");
        const lostStage = c.stages.find((x) => x.kind === "lost");
        await from.update({ merged_into_id: into.id, stage_id: lostStage.id, lost_reason_id: dup ? dup.id : null, closed_at: new Date(), revisit_at: null }, { transaction: t });
        // Fill empty details of the kept lead from the duplicate.
        const keep = into.get({ plain: true });
        const fill = {};
        for (const [col] of Object.values(DETAIL_FIELDS)) if (!keep[col] && from[col]) fill[col] = from[col];
        if (!keep.outlets_count && from.outlets_count) fill.outlets_count = from.outlets_count;
        if (Object.keys(fill).length) await into.update(fill, { transaction: t });
        if (!isOpen(c, into) && (await openCount(into.id, t))) await cancelOpen(into.id, t);
        await activity(into.id, "merge", s.user.id, `Merged lead #${from.id} (${from.name || from.phone}) into this one`, { from: from.id }, t);
        await activity(from.id, "merge", s.user.id, `Merged into lead #${into.id}`, { into: into.id }, t);
        await syncNext(into.id, t);
        await syncNext(from.id, t);
        await recalc(into, t);
        return { id: into.id };
    });
}

module.exports = { list, detail, create, update, logOutcome, moveStage, markWon, wonIn, markLost, reopen, addNote, reassign, reassignMany, assignUnassigned, addLeadTask, updateTask, merge, createLead, findByPhone, recalc, activity, row, names, getLead };
