const { Op, fn, col } = require("sequelize");
const { CrmLeadV2, CrmTaskV2, CrmCall, CrmActivity, AdmBreak } = require("../../model");
const { RuleError } = require("../../appv1/core");
const { need } = require("../auth");
const settings = require("../settings");
const config = require("./config");
const scope = require("./scope");
const { row, names } = require("./leads");
const { todayRange } = require("./util");

// My Day (the salesperson's home): one queue - overdue oldest first, new
// leads waiting for first contact, then the rest of today - plus today's
// numbers and the person's break.

async function myDay(s) {
    need(s, "leads.edit");
    const c = await config.load();
    const now = new Date();
    const { start, end } = todayRange(now);
    const me = s.user.id;
    const openLead = { stage_id: c.openStageIds, deleted_at: null, merged_into_id: null, owner_id: me };

    const tasks = await CrmTaskV2.findAll({ where: { owner_id: me, status: "open", due_at: { [Op.lt]: end } }, order: [["due_at", "ASC"], ["id", "ASC"]], limit: 400, raw: true });
    const waitingLeads = await CrmLeadV2.findAll({ where: { ...openLead, stage_id: c.stageByKey.get("new")?.id || 0, first_contact_at: null }, order: [["response_due_at", "ASC"]], limit: 200, raw: true });
    const leadIds = [...new Set([...tasks.map((t) => t.lead_id), ...waitingLeads.map((l) => l.id)])];
    const leads = new Map((await CrmLeadV2.findAll({ where: { id: leadIds, deleted_at: null, merged_into_id: null }, raw: true })).map((l) => [l.id, l]));
    const who = await names([me]);

    const item = (task, lead) => ({ taskId: task ? task.id : null, type: task ? task.type : "call", note: task ? task.note : "First call", dueAt: task ? task.due_at : lead.response_due_at, lead: row(lead, c, who) });
    const used = new Set();
    const overdue = [];
    const waiting = [];
    const later = [];
    for (const t of tasks) {
        const l = leads.get(t.lead_id);
        if (!l || used.has(l.id) || c.stageById.get(l.stage_id)?.kind !== "open") continue;
        if (new Date(t.due_at) < now) {
            overdue.push(item(t, l));
            used.add(l.id);
        }
    }
    for (const l of waitingLeads) {
        if (used.has(l.id)) continue;
        const t = tasks.find((x) => x.lead_id === l.id) || null;
        waiting.push(item(t, l));
        used.add(l.id);
    }
    for (const t of tasks) {
        const l = leads.get(t.lead_id);
        if (!l || used.has(l.id) || c.stageById.get(l.stage_id)?.kind !== "open" || new Date(t.due_at) < now) continue;
        later.push(item(t, l));
        used.add(l.id);
    }
    const quietBefore = new Date(now.getTime() - 3 * 86400000);
    const hotQuietRows = await CrmLeadV2.findAll({
        where: { ...openLead, score: { [Op.gte]: 60 }, [Op.or]: [{ last_activity_at: { [Op.lt]: quietBefore } }, { last_activity_at: null, createdAt: { [Op.lt]: quietBefore } }] },
        order: [["score", "DESC"]],
        limit: 20,
        raw: true,
    });

    const callsToday = await CrmCall.findAll({ where: { user_id: me, started_at: { [Op.gte]: start } }, attributes: [[fn("COUNT", col("id")), "n"], [fn("SUM", col("duration_seconds")), "secs"]], raw: true });
    const outcomesToday = await CrmActivity.count({ where: { actor_id: me, type: "outcome", at: { [Op.gte]: start } } });
    const firsts = await CrmLeadV2.findAll({ where: { owner_id: me, first_contact_at: { [Op.gte]: start } }, attributes: ["first_contact_at", "response_due_at"], raw: true });
    const onTime = firsts.filter((f) => !f.response_due_at || new Date(f.first_contact_at) <= new Date(f.response_due_at)).length;
    const brk = await AdmBreak.findOne({ where: { user_id: me, ended_at: null, ends_at: { [Op.gt]: now } }, raw: true });
    const wh = await settings.read("working_hours");
    return {
        serverTime: now.toISOString(),
        counts: { overdue: overdue.length, waiting: waiting.length, later: later.length, hotQuiet: hotQuietRows.length },
        oldestOverdueAt: overdue[0] ? overdue[0].dueAt : null,
        nextWaitingDueAt: waiting[0] ? waiting[0].dueAt : null,
        overdue,
        waiting,
        later,
        hotQuiet: hotQuietRows.map((l) => ({ taskId: null, type: l.next_action_type || "call", note: "Hot lead, no contact for 3+ days", dueAt: l.next_action_at, lead: row(l, c, who) })),
        today: { calls: Number(callsToday[0]?.n) || 0, talkSeconds: Number(callsToday[0]?.secs) || 0, outcomes: outcomesToday, firstContacts: firsts.length, firstContactsOnTime: onTime },
        breakUntil: brk ? brk.ends_at : null,
        breakKind: brk ? brk.kind : null,
        workingHours: wh,
    };
}

/** Pipeline board: the open stages with counts and the most urgent cards. */
async function pipeline(s, query = {}) {
    const c = await config.load();
    const base = { ...(await scope.leadWhere(s)), deleted_at: null, merged_into_id: null };
    const owner = query.owner || "mine";
    if (owner === "mine") base.owner_id = s.user.id;
    else if (owner !== "all" && owner !== "team") {
        const o = Number(owner) || 0;
        if (Array.isArray(base.owner_id) && !base.owner_id.includes(o)) throw new RuleError("You do not have permission for this.");
        base.owner_id = o;
    }
    if (query.source) base.source = String(query.source).slice(0, 20);
    if (query.band === "hot") base.score = { [Op.gte]: 60 };
    else if (query.band === "warm") base.score = { [Op.gte]: 30, [Op.lt]: 60 };
    else if (query.band === "cold") base.score = { [Op.lt]: 30 };
    const per = Math.min(60, Math.max(5, Number(query.perStage) || 25));
    const stages = c.stages.filter((st) => st.kind === "open" && st.active);
    const out = [];
    const all = [];
    for (const st of stages) {
        const where = { ...base, stage_id: st.id };
        const count = await CrmLeadV2.count({ where });
        const rows = await CrmLeadV2.findAll({ where, order: [["next_action_at", "ASC"], ["id", "ASC"]], limit: per, raw: true });
        all.push(...rows);
        out.push({ stage: { id: st.id, key: st.stage_key, name: st.name }, count, rows });
    }
    const who = await names(all.map((r) => r.owner_id));
    return { serverTime: new Date().toISOString(), columns: out.map((x) => ({ stage: x.stage, count: x.count, leads: x.rows.map((r) => row(r, c, who)) })) };
}

/* ------------------------------ breaks ------------------------------ */

async function startBreak(s, kind) {
    const k = kind === "lunch" ? "lunch" : "tea";
    const now = new Date();
    const open = await AdmBreak.findOne({ where: { user_id: s.user.id, ended_at: null, ends_at: { [Op.gt]: now } } });
    if (open) throw new RuleError("You are already on a break.");
    const wh = await settings.read("working_hours");
    const minutes = k === "lunch" ? wh.lunchMinutes : wh.teaMinutes;
    if (!minutes) throw new RuleError("This break is not part of the working hours.");
    const { start } = todayRange(now);
    const taken = await AdmBreak.count({ where: { user_id: s.user.id, kind: k, started_at: { [Op.gte]: start } } });
    if (k === "lunch" && taken >= 1) throw new RuleError("Lunch was already taken today.");
    if (k === "tea" && taken >= wh.teaBreaks) throw new RuleError(`All ${wh.teaBreaks} tea breaks were taken today.`);
    const row = await AdmBreak.create({ user_id: s.user.id, kind: k, started_at: now, ends_at: new Date(now.getTime() + minutes * 60000) });
    return { breakUntil: row.ends_at, breakKind: k };
}

async function endBreak(s) {
    const now = new Date();
    await AdmBreak.update({ ended_at: now }, { where: { user_id: s.user.id, ended_at: null, ends_at: { [Op.gt]: now } } });
    return { breakUntil: null };
}

module.exports = { myDay, pipeline, startBreak, endBreak };
