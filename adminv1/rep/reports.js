const { QueryTypes } = require("sequelize");
const { sequelize, AdmUser } = require("../../model");
const { RuleError } = require("../../appv1/core");
const { need } = require("../auth");
const perms = require("../permissions");
const config = require("../crm/config");
const scope = require("../crm/scope");
const { weights } = require("../crm/score");
const { workingHours, workingMinutesBetween, moment, TZ, parse } = require("../crm/util");
const { RATING } = require("../sup/common");

// Reports (phase 7; design "Reports": sales, team and revenue, every number
// opens the list behind it). One call answers every section the person may
// see for one period (India dates, both ends included):
//   sources, funnel, first contact, team, activity  - leads they can see (reports.view)
//   revenue                                          - also billing.view
//   support                                          - also support.use
//   score                                            - how the lead-score signals win
// Each number carries `drill`: the panel list (and its filters) behind it.

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function period(query = {}) {
    const today = moment().tz(TZ).format("YYYY-MM-DD");
    const to = DAY.test(query.to || "") ? query.to : today;
    const from = DAY.test(query.from || "") ? query.from : moment.tz(to, TZ).subtract(29, "days").format("YYYY-MM-DD");
    if (from > to) throw new RuleError("The period must start before it ends.");
    if (moment.tz(to, TZ).diff(moment.tz(from, TZ), "days") > 800) throw new RuleError("Choose a period of at most two years.");
    return { from, to, start: moment.tz(from, TZ).startOf("day").toDate(), end: moment.tz(to, TZ).add(1, "day").startOf("day").toDate() };
}

const q = (sql, replacements) => sequelize.query(sql, { type: QueryTypes.SELECT, replacements });
const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);
const n = (v) => Number(v) || 0;

/** "AND l.owner_id IN (...)" for people who see only some leads. */
async function ownerFilter(s, alias = "l") {
    const owners = await scope.visibleOwners(s);
    if (owners === null) return { sql: "", repl: {} };
    return { sql: ` AND ${alias}.owner_id IN (:owners)`, repl: { owners: owners.length ? owners : [0] } };
}

const LEAD_BASE = "l.deleted_at IS NULL AND l.merged_into_id IS NULL";
const SOURCE_LABEL = { meta: "Meta Lead Ads", website: "Website", manual: "Manual", referral: "Referral", phone: "Phone call", whatsapp: "WhatsApp", import: "Import" };

/* ------------------------------ sales ------------------------------ */

async function sources(p, of) {
    const rows = await q(
        `SELECT l.source, COUNT(*) n, SUM(st.kind = 'won') won, SUM(st.kind = 'lost') lost FROM crm_leads l JOIN crm_stages st ON st.id = l.stage_id
         WHERE ${LEAD_BASE} AND l.createdAt >= :start AND l.createdAt < :end${of.sql} GROUP BY l.source ORDER BY n DESC`,
        { start: p.start, end: p.end, ...of.repl },
    );
    const total = rows.reduce((a, r) => a + n(r.n), 0);
    const won = rows.reduce((a, r) => a + n(r.won), 0);
    const ads = new Map();
    const meta = await q(
        `SELECT l.source_detail sd, st.kind FROM crm_leads l JOIN crm_stages st ON st.id = l.stage_id
         WHERE ${LEAD_BASE} AND l.source = 'meta' AND l.createdAt >= :start AND l.createdAt < :end${of.sql}`,
        { start: p.start, end: p.end, ...of.repl },
    );
    for (const r of meta) {
        const d = parse(r.sd) || {};
        const ad = String(d.ad || d.campaign || "").trim();
        if (!ad) continue;
        const a = ads.get(ad) || { ad, leads: 0, won: 0 };
        a.leads += 1;
        if (r.kind === "won") a.won += 1;
        ads.set(ad, a);
    }
    const adRows = [...ads.values()].filter((a) => a.leads >= 5).map((a) => ({ ...a, rate: pct(a.won, a.leads) })).sort((a, b) => b.rate - a.rate || b.leads - a.leads);
    return {
        total,
        won,
        rate: pct(won, total),
        rows: rows.map((r) => ({
            source: r.source,
            label: SOURCE_LABEL[r.source] || r.source,
            leads: n(r.n),
            won: n(r.won),
            lost: n(r.lost),
            rate: pct(n(r.won), n(r.n)),
            drill: { to: "leads", query: { view: "all", source: r.source, from: p.from, to: p.to } },
            drillWon: { to: "leads", query: { view: "all", source: r.source, from: p.from, to: p.to, stageKind: "won" } },
        })),
        bestAd: adRows[0] || null,
        weakestAd: adRows.length > 1 ? adRows[adRows.length - 1] : null,
        ads: adRows.slice(0, 15),
    };
}

/** How far the period's leads got: the furthest stage each reached (now, or on its way to won/lost). */
async function funnel(p, of) {
    const c = await config.load();
    const leads = await q(
        `SELECT l.id, l.stage_id, l.lost_reason_id FROM crm_leads l WHERE ${LEAD_BASE} AND l.createdAt >= :start AND l.createdAt < :end${of.sql}`,
        { start: p.start, end: p.end, ...of.repl },
    );
    const openStages = c.stages.filter((st) => st.kind === "open").sort((a, b) => a.sort - b.sort);
    const sortByName = new Map(c.stages.map((st) => [st.name, st.sort]));
    const furthest = new Map();
    for (const l of leads) {
        const st = c.stageById.get(l.stage_id);
        furthest.set(l.id, st && st.kind === "won" ? Infinity : st && st.kind === "open" ? st.sort : -Infinity);
    }
    if (leads.length) {
        const moves = await q("SELECT a.lead_id, a.data FROM crm_activities a WHERE a.type = 'stage' AND a.lead_id IN (:ids)", { ids: leads.map((l) => l.id) });
        for (const m of moves) {
            const d = parse(m.data) || {};
            const to = Array.isArray(d.stage) ? d.stage[1] : null;
            const sort = to ? sortByName.get(to) : undefined;
            if (sort !== undefined && sort > (furthest.get(m.lead_id) ?? -Infinity)) furthest.set(m.lead_id, sort);
        }
    }
    const first = openStages[0];
    const stages = openStages.map((st) => ({
        id: st.id,
        name: st.name,
        reached: leads.filter((l) => (st === first ? true : (furthest.get(l.id) ?? -Infinity) >= st.sort)).length,
        now: leads.filter((l) => l.stage_id === st.id).length,
        drill: { to: "leads", query: { view: "all", stageId: st.id, from: p.from, to: p.to } },
    }));
    const wonStage = c.stages.find((st) => st.kind === "won");
    const won = leads.filter((l) => c.stageById.get(l.stage_id)?.kind === "won").length;
    const lostRows = new Map();
    for (const l of leads) {
        if (c.stageById.get(l.stage_id)?.kind !== "lost") continue;
        const r = c.reasonById.get(l.lost_reason_id);
        const k = r ? r.id : 0;
        const x = lostRows.get(k) || { id: k, name: r ? r.name : "No reason", leads: 0, drill: { to: "leads", query: { view: "all", stageKind: "lost", lostReasonId: k || "none", from: p.from, to: p.to } } };
        x.leads += 1;
        lostRows.set(k, x);
    }
    return {
        total: leads.length,
        stages: [...stages, { id: wonStage ? wonStage.id : 0, name: "Won", reached: won, now: won, drill: { to: "leads", query: { view: "all", stageKind: "won", from: p.from, to: p.to } } }],
        lost: [...lostRows.values()].sort((a, b) => b.leads - a.leads),
        lostTotal: [...lostRows.values()].reduce((a, r) => a + r.leads, 0),
    };
}

const SPEED = [
    { key: "15m", label: "Within 15 working minutes", max: 15 },
    { key: "1h", label: "15 to 60 minutes", max: 60 },
    { key: "4h", label: "1 to 4 working hours", max: 240 },
    { key: "day", label: "Same working day or next", max: 1020 },
    { key: "later", label: "Later", max: Infinity },
];

/** How fast the period's leads got a first contact by a person (working time). */
async function firstContact(p, of) {
    const wh = await workingHours();
    const rows = await q(
        `SELECT l.id, l.createdAt created, l.first_contact_at fc FROM crm_leads l WHERE ${LEAD_BASE} AND l.createdAt >= :start AND l.createdAt < :end${of.sql}`,
        { start: p.start, end: p.end, ...of.repl },
    );
    const buckets = SPEED.map((b) => ({ key: b.key, label: b.label, leads: 0 }));
    let never = 0;
    const mins = [];
    for (const r of rows) {
        if (!r.fc) {
            never += 1;
            continue;
        }
        const m = workingMinutesBetween(wh, r.created, r.fc);
        mins.push(m);
        buckets[SPEED.findIndex((b) => m <= b.max)].leads += 1;
    }
    mins.sort((a, b) => a - b);
    return {
        total: rows.length,
        contacted: mins.length,
        never,
        onTime: buckets[0].leads,
        onTimeRate: pct(buckets[0].leads, rows.length),
        medianMinutes: mins.length ? mins[Math.floor(mins.length / 2)] : null,
        buckets,
        drillNever: { to: "leads", query: { view: "all", from: p.from, to: p.to, contacted: "no" } },
    };
}

/** People who can work leads (and whose leads this person may see). */
async function salesPeople(s) {
    const owners = await scope.visibleOwners(s);
    const roles = (await require("../../model").AdmRole.findAll({ raw: true })).filter((r) => perms.can(perms.parse(r.permissions), "leads.edit")).map((r) => r.id);
    const where = { role_id: roles.length ? roles : [0] };
    if (owners !== null) where.id = owners.length ? owners : [0];
    return AdmUser.findAll({ where, attributes: ["id", "name", "status"], order: [["name", "ASC"]], raw: true });
}

async function team(s, p) {
    const people = await salesPeople(s);
    const ids = people.map((u) => u.id);
    if (!ids.length) return { people: [] };
    const by = (rows, k = "uid") => new Map(rows.map((r) => [r[k], r]));
    const calls = by(await q("SELECT user_id uid, COUNT(*) calls, SUM(answered) answered, SUM(CASE WHEN answered THEN duration_seconds ELSE 0 END) talk FROM crm_calls WHERE user_id IN (:ids) AND started_at >= :start AND started_at < :end GROUP BY user_id", { ids, start: p.start, end: p.end }));
    // On time = first contact within the first-contact target in working minutes (as the First contact section).
    const wh = await workingHours();
    const target = (await require("../settings").read("timers")).firstContactMinutes || 15;
    const assigned = new Map();
    for (const l of await q(`SELECT l.owner_id uid, l.createdAt created, l.first_contact_at fc FROM crm_leads l WHERE ${LEAD_BASE} AND l.owner_id IN (:ids) AND l.createdAt >= :start AND l.createdAt < :end`, { ids, start: p.start, end: p.end })) {
        const a = assigned.get(l.uid) || { n: 0, ontime: 0 };
        a.n += 1;
        if (l.fc && workingMinutesBetween(wh, l.created, l.fc) <= target) a.ontime += 1;
        assigned.set(l.uid, a);
    }
    const won = by(await q(`SELECT l.owner_id uid, COUNT(*) n FROM crm_leads l WHERE ${LEAD_BASE} AND l.owner_id IN (:ids) AND l.won_at >= :start AND l.won_at < :end GROUP BY l.owner_id`, { ids, start: p.start, end: p.end }));
    const c = await config.load();
    const open = by(await q(`SELECT l.owner_id uid, COUNT(*) n FROM crm_leads l WHERE ${LEAD_BASE} AND l.owner_id IN (:ids) AND l.stage_id IN (:open) GROUP BY l.owner_id`, { ids, open: c.openStageIds.length ? c.openStageIds : [0] }));
    const overdue = by(await q("SELECT owner_id uid, COUNT(*) n FROM crm_tasks WHERE owner_id IN (:ids) AND status = 'open' AND due_at < UTC_TIMESTAMP() GROUP BY owner_id", { ids }));
    return {
        people: people.map((u) => {
            const cl = calls.get(u.id) || {};
            const a = assigned.get(u.id) || {};
            return {
                id: u.id,
                name: u.name,
                active: u.status === "active",
                calls: n(cl.calls),
                answered: n(cl.answered),
                talkMinutes: Math.round(n(cl.talk) / 60),
                newLeads: n(a.n),
                firstContactOnTime: pct(n(a.ontime), n(a.n)),
                won: n((won.get(u.id) || {}).n),
                openLeads: n((open.get(u.id) || {}).n),
                overdueTasks: n((overdue.get(u.id) || {}).n),
                drill: { to: "leads", query: { view: "all", ownerId: u.id, from: p.from, to: p.to } },
                drillWon: { to: "leads", query: { view: "all", ownerId: u.id, wonFrom: p.from, wonTo: p.to } },
            };
        }),
    };
}

/** What each person did, day by day (calls, outcomes, notes, WhatsApp, tasks done). */
async function activity(s, p) {
    const people = await salesPeople(s);
    const ids = people.map((u) => u.id);
    if (!ids.length) return { people: [], days: [] };
    const tz = "+05:30";
    const dayCol = (col) => `DATE(CONVERT_TZ(${col}, '+00:00', '${tz}'))`;
    const rows = [
        ...(await q(`SELECT user_id uid, ${dayCol("started_at")} d, 'calls' k, COUNT(*) n FROM crm_calls WHERE user_id IN (:ids) AND started_at >= :start AND started_at < :end GROUP BY uid, d`, { ids, start: p.start, end: p.end })),
        ...(await q(`SELECT actor_id uid, ${dayCol("at")} d, CASE type WHEN 'outcome' THEN 'outcomes' WHEN 'note' THEN 'notes' ELSE 'moves' END k, COUNT(*) n FROM crm_activities WHERE actor_id IN (:ids) AND type IN ('outcome','note','stage','won','lost') AND at >= :start AND at < :end GROUP BY uid, d, k`, { ids, start: p.start, end: p.end })),
        ...(await q(`SELECT user_id uid, ${dayCol("at")} d, 'whatsapp' k, COUNT(*) n FROM crm_wa_messages WHERE user_id IN (:ids) AND direction = 'out' AND sender = 'user' AND at >= :start AND at < :end GROUP BY uid, d`, { ids, start: p.start, end: p.end })),
        ...(await q(`SELECT owner_id uid, ${dayCol("done_at")} d, 'tasks' k, COUNT(*) n FROM crm_tasks WHERE owner_id IN (:ids) AND status = 'done' AND done_at >= :start AND done_at < :end GROUP BY uid, d`, { ids, start: p.start, end: p.end })),
    ];
    const KINDS = ["calls", "outcomes", "notes", "whatsapp", "tasks", "moves"];
    const per = new Map(people.map((u) => [u.id, Object.fromEntries(KINDS.map((k) => [k, 0]))]));
    const days = new Map();
    for (const r of rows) {
        const d = moment(r.d).format("YYYY-MM-DD");
        const x = per.get(r.uid);
        if (x) x[r.k] += n(r.n);
        const day = days.get(d) || Object.fromEntries([["date", d], ...KINDS.map((k) => [k, 0])]);
        day[r.k] += n(r.n);
        days.set(d, day);
    }
    return {
        people: people.map((u) => ({ id: u.id, name: u.name, ...per.get(u.id), total: KINDS.reduce((a, k) => a + per.get(u.id)[k], 0) })).sort((a, b) => b.total - a.total),
        days: [...days.values()].sort((a, b) => (a.date < b.date ? -1 : 1)),
    };
}

/* ------------------------------ money ------------------------------ */

async function revenue(p) {
    const [issued] = await q("SELECT COUNT(*) n, COALESCE(SUM(CASE WHEN kind = 'credit_note' THEN -total ELSE total END), 0) total FROM bil_invoices WHERE demo = 0 AND number IS NOT NULL AND status NOT IN ('draft','approval','cancelled') AND issued_at >= :start AND issued_at < :end", p);
    const [paid] = await q("SELECT COUNT(*) n, COALESCE(SUM(p.amount), 0) total FROM bil_payments p JOIN bil_invoices i ON i.id = p.invoice_id WHERE i.demo = 0 AND p.status = 'approved' AND p.received_on >= :from AND p.received_on <= :to", { from: p.from, to: p.to });
    const [year] = await q("SELECT COALESCE(SUM(CASE WHEN kind = 'credit_note' THEN -total ELSE total END), 0) total FROM bil_invoices WHERE demo = 0 AND number IS NOT NULL AND status NOT IN ('draft','approval','cancelled') AND issued_at >= UTC_TIMESTAMP() - INTERVAL 365 DAY", {});
    const [due] = await q("SELECT COUNT(*) n, COALESCE(SUM(total - paid), 0) total FROM bil_invoices WHERE demo = 0 AND status IN ('issued','part_paid')", {});
    const [paying] = await q(
        `SELECT COUNT(DISTINCT h.id) n FROM hotel_registrations h JOIN bil_invoices i ON i.hotel_id = h.id AND i.demo = 0 AND i.kind = 'invoice' AND i.status = 'paid'
         JOIN bil_invoice_lines li ON li.invoice_id = i.id AND li.kind = 'plan' WHERE h.plan_end_date > UTC_TIMESTAMP()`,
        {},
    );
    const ren = await q("SELECT stage, COUNT(*) n FROM cs_renewals WHERE ends_on >= :from AND ends_on <= :to GROUP BY stage", { from: p.from, to: p.to });
    const r = Object.fromEntries(ren.map((x) => [x.stage, n(x.n)]));
    const decided = (r.paid || 0) + (r.churned || 0);
    const byItem = await q(
        `SELECT li.kind, COALESCE(SUM(li.amount), 0) amount, COUNT(DISTINCT i.id) invoices FROM bil_invoice_lines li JOIN bil_invoices i ON i.id = li.invoice_id
         WHERE i.demo = 0 AND i.kind = 'invoice' AND i.number IS NOT NULL AND i.status NOT IN ('draft','approval','cancelled') AND i.issued_at >= :start AND i.issued_at < :end GROUP BY li.kind`,
        p,
    );
    return {
        issued: { count: n(issued.n), total: n(issued.total), drill: { to: "invoices", query: { view: "all", from: p.from, to: p.to } } },
        paid: { count: n(paid.n), total: n(paid.total) },
        yearOnBooks: n(year.total),
        dues: { count: n(due.n), total: n(due.total), drill: { to: "dues", query: {} } },
        payingOutlets: n(paying.n),
        renewals: { due: Object.values(r).reduce((a, x) => a + x, 0), paid: r.paid || 0, churned: r.churned || 0, open: (r.upcoming || 0) + (r.contacted || 0) + (r.invoiced || 0), rate: decided ? pct(r.paid || 0, decided) : null, drill: { to: "renewals", query: {} } },
        byKind: byItem.map((x) => ({ kind: x.kind, amount: n(x.amount), invoices: n(x.invoices) })),
    };
}

/* ------------------------------ support ------------------------------ */

async function support(p) {
    const wh = await workingHours();
    const rows = await q("SELECT * FROM sup_tickets WHERE opened_at >= :start AND opened_at < :end", p);
    const cats = new Map();
    const chans = new Map();
    const firstMins = [];
    let replyOnTime = 0;
    let replied = 0;
    let closed = 0;
    let fixOnTime = 0;
    const closeMins = [];
    for (const r of rows) {
        const c = cats.get(r.category) || { category: r.category, tickets: 0, open: 0, drill: { to: "support", query: { view: "all", category: r.category } } };
        c.tickets += 1;
        if (r.state !== "closed") c.open += 1;
        cats.set(r.category, c);
        chans.set(r.channel, (chans.get(r.channel) || 0) + 1);
        if (r.first_reply_at) {
            replied += 1;
            firstMins.push(workingMinutesBetween(wh, r.opened_at, r.first_reply_at));
            if (!r.first_reply_due || new Date(r.first_reply_at) <= new Date(r.first_reply_due)) replyOnTime += 1;
        }
        if (r.state === "closed" && r.closed_at) {
            closed += 1;
            closeMins.push(Math.max(0, workingMinutesBetween(wh, r.opened_at, r.closed_at) - (r.paused_minutes || 0)));
            if (!r.resolve_due || new Date(r.closed_at) <= new Date(r.resolve_due)) fixOnTime += 1;
        }
    }
    const med = (a) => (a.length ? a.sort((x, y) => x - y)[Math.floor(a.length / 2)] : null);
    const ratings = await q("SELECT rating, COUNT(*) n FROM sup_tickets WHERE rated_at >= :start AND rated_at < :end AND rating IS NOT NULL GROUP BY rating", p);
    const [now] = await q("SELECT SUM(state <> 'closed') open, SUM(state <> 'closed' AND ((first_reply_at IS NULL AND first_reply_due < UTC_TIMESTAMP()) OR (state <> 'waiting' AND resolve_due < UTC_TIMESTAMP()))) late FROM sup_tickets", {});
    const people = await q(
        `SELECT t.assignee_id uid, u.name, COUNT(*) tickets, SUM(t.state = 'closed') closed, SUM(t.first_reply_at IS NOT NULL AND t.first_reply_at <= t.first_reply_due) reply_on_time, SUM(t.first_reply_at IS NOT NULL) replied, SUM(t.rating = 1) poor
         FROM sup_tickets t JOIN adm_users u ON u.id = t.assignee_id WHERE t.opened_at >= :start AND t.opened_at < :end GROUP BY t.assignee_id, u.name ORDER BY tickets DESC`,
        p,
    );
    const { CHANNELS } = require("../sup/common");
    return {
        opened: rows.length,
        replied,
        replyOnTimeRate: pct(replyOnTime, replied),
        medianFirstReplyMinutes: med(firstMins),
        closed,
        fixOnTimeRate: pct(fixOnTime, closed),
        medianCloseMinutes: med(closeMins),
        openNow: n(now && now.open),
        lateNow: n(now && now.late),
        drillOpen: { to: "support", query: { view: "open" } },
        drillLate: { to: "support", query: { view: "late" } },
        categories: [...cats.values()].sort((a, b) => b.tickets - a.tickets),
        channels: [...chans.entries()].map(([k, v]) => ({ channel: k, label: CHANNELS[k] || k, tickets: v })).sort((a, b) => b.tickets - a.tickets),
        ratings: [5, 3, 1].map((r) => ({ rating: r, label: RATING[r], tickets: n((ratings.find((x) => n(x.rating) === r) || {}).n) })),
        people: people.map((x) => ({ id: x.uid, name: x.name, tickets: n(x.tickets), closed: n(x.closed), replyOnTimeRate: pct(n(x.reply_on_time), n(x.replied)), poor: n(x.poor), drill: { to: "support", query: { view: "all", assigneeId: x.uid } } })),
    };
}

/* ------------------------------ lead score ------------------------------ */

/**
 * Score tuning: for the period's decided leads (won or lost), how often a
 * lead with each signal the score counts was won, beside the points the
 * signal gets now. A signal that wins far above the average deserves more.
 */
async function scoreSignals(s, p, of) {
    const c = await config.load();
    const w = await weights();
    const decided = c.stages.filter((st) => st.kind !== "open").map((st) => st.id);
    const leads = await q(
        `SELECT l.id, l.source, l.stage_id, l.score, l.outlets_count, l.restaurant_name, l.city, l.business_type, l.current_software, l.plan_interest, l.decision_maker, l.phone_valid
         FROM crm_leads l WHERE ${LEAD_BASE} AND l.createdAt >= :start AND l.createdAt < :end AND l.stage_id IN (:decided)${of.sql}`,
        { start: p.start, end: p.end, decided: decided.length ? decided : [0], ...of.repl },
    );
    const won = (l) => c.stageById.get(l.stage_id)?.kind === "won";
    const ids = leads.map((l) => l.id);
    const reachedKeys = c.outcomes.filter((o) => o.reached).map((o) => o.id);
    const demoKey = c.outcomeByKey.get("demo_done");
    const reached = new Map(ids.length && reachedKeys.length ? (await q("SELECT lead_id, COUNT(*) n FROM crm_activities WHERE type = 'outcome' AND lead_id IN (:ids) AND outcome_id IN (:keys) GROUP BY lead_id", { ids, keys: reachedKeys })).map((r) => [r.lead_id, n(r.n)]) : []);
    const demo = new Set(ids.length && demoKey ? (await q("SELECT DISTINCT lead_id FROM crm_activities WHERE type = 'outcome' AND lead_id IN (:ids) AND outcome_id = :k", { ids, k: demoKey.id })).map((r) => r.lead_id) : []);
    const wa = new Map(ids.length ? (await q("SELECT c.lead_id, COUNT(*) n FROM crm_wa_messages m JOIN crm_wa_chats c ON c.id = m.chat_id WHERE m.direction = 'in' AND c.lead_id IN (:ids) GROUP BY c.lead_id", { ids })).map((r) => [r.lead_id, n(r.n)]) : []);
    const total = leads.length;
    const totalWon = leads.filter(won).length;
    const base = pct(totalWon, total);
    const signal = (key, label, points, test) => {
        const has = leads.filter(test);
        const hw = has.filter(won).length;
        return { key, label, points, leads: has.length, won: hw, rate: pct(hw, has.length), lift: base && has.length ? Math.round((pct(hw, has.length) / base) * 10) / 10 : null };
    };
    const details = (l) => ["restaurant_name", "city", "business_type", "current_software", "plan_interest", "decision_maker"].filter((k) => l[k]).length >= 3;
    const signals = [
        ...Object.keys(w.sources).map((src) => signal(`source:${src}`, `Source: ${SOURCE_LABEL[src] || src}`, w.sources[src], (l) => l.source === src)),
        signal("multiOutlet", "2 or more outlets", w.multiOutlet, (l) => n(l.outlets_count) >= 2),
        signal("detailsKnown", "Business details known", w.detailsKnown, details),
        signal("planInterest", "Plan of interest known", w.planInterest, (l) => !!l.plan_interest),
        signal("reached", "Spoken to at least once", w.reachedBase, (l) => (reached.get(l.id) || 0) > 0),
        signal("reached3", "Spoken to 3 or more times", Math.min(w.reachedMax, w.reachedBase + 3 * w.reachedEach), (l) => (reached.get(l.id) || 0) >= 3),
        signal("demoDone", "Demo done", w.demoDone, (l) => demo.has(l.id)),
        signal("whatsapp", "Wrote on WhatsApp", w.waBase, (l) => (wa.get(l.id) || 0) > 0),
        signal("badPhone", "Phone number looks wrong", w.badPhone, (l) => !l.phone_valid),
    ].filter((x) => x.leads > 0);
    const bands = [
        { band: "hot", label: "Hot (60+)", test: (l) => l.score >= 60 },
        { band: "warm", label: "Warm (30-59)", test: (l) => l.score >= 30 && l.score < 60 },
        { band: "cold", label: "Cold (under 30)", test: (l) => l.score < 30 },
    ].map((b) => {
        const has = leads.filter(b.test);
        return { band: b.band, label: b.label, leads: has.length, won: has.filter(won).length, rate: pct(has.filter(won).length, has.length) };
    });
    return { decided: total, won: totalWon, rate: base, signals, bands, weights: w, canEdit: s.can("settings.manage") };
}

/* ------------------------------ all of it ------------------------------ */

async function all(s, query = {}) {
    need(s, "reports.view");
    const p = period(query);
    const of = await ownerFilter(s).catch(() => null);
    const out = { serverTime: new Date().toISOString(), from: p.from, to: p.to, sections: [] };
    if (of) {
        out.sources = await sources(p, of);
        out.funnel = await funnel(p, of);
        out.firstContact = await firstContact(p, of);
        out.team = await team(s, p);
        out.activity = await activity(s, p);
        out.score = await scoreSignals(s, p, of);
        out.sections.push("sources", "funnel", "firstContact", "team", "activity", "score");
    }
    if (s.can("billing.view")) {
        out.revenue = await revenue(p);
        out.sections.push("revenue");
    }
    if (s.can("support.use") || s.can("support.manage")) {
        out.support = await support(p);
        out.sections.push("support");
    }
    return out;
}

/** score tuning data alone (Settings -> Lead score). */
async function scoreCheck(s) {
    need(s, "reports.view");
    const p = period({ from: moment().tz(TZ).subtract(180, "days").format("YYYY-MM-DD") });
    const of = await ownerFilter(s);
    return { from: p.from, to: p.to, ...(await scoreSignals(s, p, of)) };
}

/** The same numbers as an Excel file (one sheet per section), base64. */
async function excel(s, query = {}) {
    const r = await all(s, query);
    const ExcelJS = require("exceljs");
    const wb = new ExcelJS.Workbook();
    wb.creator = "BillerPe";
    const sheet = (name, cols, rows) => {
        const ws = wb.addWorksheet(name);
        ws.columns = cols.map(([header, key, width]) => ({ header, key, width: width || 16 }));
        ws.getRow(1).font = { bold: true };
        for (const row of rows) ws.addRow(row);
    };
    const title = `${r.from} to ${r.to}`;
    if (r.sources) sheet("Sources", [["Source", "label", 24], ["Leads", "leads"], ["Won", "won"], ["Lost", "lost"], ["Win rate %", "rate"]], r.sources.rows);
    if (r.sources && r.sources.ads.length) sheet("Meta ads", [["Ad", "ad", 48], ["Leads", "leads"], ["Won", "won"], ["Win rate %", "rate"]], r.sources.ads);
    if (r.funnel) sheet("Funnel", [["Stage", "name", 24], ["Reached", "reached"], ["There now", "now"]], r.funnel.stages);
    if (r.funnel) sheet("Lost reasons", [["Reason", "name", 32], ["Leads", "leads"]], r.funnel.lost);
    if (r.firstContact) sheet("First contact", [["How fast", "label", 32], ["Leads", "leads"]], [...r.firstContact.buckets, { label: "Never contacted", leads: r.firstContact.never }]);
    if (r.team) sheet("Team", [["Person", "name", 22], ["Calls", "calls"], ["Answered", "answered"], ["Talk minutes", "talkMinutes"], ["New leads", "newLeads"], ["First contact on time %", "firstContactOnTime", 22], ["Won", "won"], ["Open leads", "openLeads"], ["Overdue tasks", "overdueTasks"]], r.team.people);
    if (r.activity) sheet("Activity", [["Person", "name", 22], ["Calls", "calls"], ["Outcomes", "outcomes"], ["Notes", "notes"], ["WhatsApp", "whatsapp"], ["Tasks done", "tasks"], ["Stage moves", "moves"], ["Total", "total"]], r.activity.people);
    if (r.revenue) sheet("Revenue", [["What", "k", 32], ["Value", "v", 18]], [
        { k: "Invoiced (net of credit notes)", v: r.revenue.issued.total },
        { k: "Invoices", v: r.revenue.issued.count },
        { k: "Payments received", v: r.revenue.paid.total },
        { k: "Last 12 months on books", v: r.revenue.yearOnBooks },
        { k: "Dues now", v: r.revenue.dues.total },
        { k: "Paying outlets", v: r.revenue.payingOutlets },
        { k: "Renewal rate %", v: r.revenue.renewals.rate ?? "" },
    ]);
    if (r.support) {
        sheet("Support", [["What", "k", 36], ["Value", "v", 14]], [
            { k: "Tickets opened", v: r.support.opened },
            { k: "First reply on time %", v: r.support.replyOnTimeRate },
            { k: "Median first reply (working minutes)", v: r.support.medianFirstReplyMinutes ?? "" },
            { k: "Closed", v: r.support.closed },
            { k: "Fixed on time %", v: r.support.fixOnTimeRate },
            ...r.support.ratings.map((x) => ({ k: `Rated ${x.label}`, v: x.tickets })),
        ]);
        sheet("Ticket categories", [["Category", "category", 28], ["Tickets", "tickets"], ["Still open", "open"]], r.support.categories);
    }
    if (r.score) sheet("Score signals", [["Signal", "label", 32], ["Points now", "points"], ["Leads", "leads"], ["Won", "won"], ["Win rate %", "rate"], ["x average", "lift"]], r.score.signals);
    const buf = await wb.xlsx.writeBuffer();
    return { fileName: `BillerPe reports ${title}.xlsx`, base64: Buffer.from(buf).toString("base64") };
}

module.exports = { all, excel, scoreCheck, period };
