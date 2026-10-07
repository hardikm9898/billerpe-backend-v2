const { Op } = require("sequelize");
const { sequelize, CrmEscalation, CrmLeadV2, CrmTaskV2, CrmActivity, CrmCall, AdmUser, AdmBreak, AdmLeave } = require("../../model");
const { RuleError } = require("../../appv1/core");
const worker = require("../../services/admin/worker");
const settings = require("../settings");
const { need } = require("../auth");
const config = require("./config");
const scope = require("./scope");
const { notify, peopleWith } = require("./notify");
const { canTakeLeads } = require("./assign");
const { workingHours, isWorkingTime, addWorkingMinutes, workingMinutesBetween, firstContactDue, todayRange, moment, TZ } = require("./util");

// The escalation chain (owner, 7 Oct 2026): the salesperson is responsible;
// when the first call to a new lead is late, or a next action is overdue, the
// salesperson's manager is told (level 1); if the manager does not act in
// time, the admins are told (level 2). Times are working minutes from
// Settings > Timers. An escalation closes by itself when the lead is called,
// the task is done or moved, the lead is reassigned or closed.

const ids = (list) => `,${[...new Set(list)].join(",")},`;
const idList = (s) => String(s || "").split(",").filter(Boolean).map(Number);

async function chainFor(ownerId) {
    const automation = require("./automation");
    const managers = await automation.managersOf(ownerId);
    const admins = (await automation.admins()).filter((id) => id !== ownerId);
    return { managers: managers.filter((id) => id !== ownerId), admins };
}

async function raise({ ref, lead, task = null, kind, ownerId, level, to, nextLevelAt, title, body }) {
    if (!to.length) return null;
    let row;
    try {
        row = await CrmEscalation.create({ ref, lead_id: lead.id, task_id: task ? task.id : null, kind, level, owner_id: ownerId || null, to_ids: ids(to), status: "open", raised_at: new Date(), next_level_at: nextLevelAt });
    } catch (e) {
        if (e.name === "SequelizeUniqueConstraintError") return null;
        throw e;
    }
    for (const id of to) await notify(id, { type: level === 1 ? "esc.manager" : "esc.admin", title, body, link: `/leads/${lead.id}`, ref: `esc:${row.id}:${id}` });
    return row;
}

/** Closes open escalations whose reason is gone. Returns how many. */
async function resolveOpen(now = new Date(), onlyLeadId = null) {
    const open = await CrmEscalation.findAll({ where: { status: "open", ...(onlyLeadId ? { lead_id: onlyLeadId } : {}) } });
    const c = await config.load();
    let n = 0;
    for (const e of open) {
        const lead = await CrmLeadV2.findByPk(e.lead_id);
        let how = "";
        let by = null;
        if (!lead || lead.deleted_at || lead.merged_into_id || c.stageById.get(lead.stage_id)?.kind !== "open") how = "Lead closed";
        else if (e.kind === "first_contact") {
            if (lead.first_contact_at) {
                how = "Called";
                const last = await CrmActivity.findOne({ where: { lead_id: lead.id, type: "outcome" }, order: [["id", "DESC"]], attributes: ["actor_id"] });
                by = last ? last.actor_id : null;
            } else if ((lead.owner_id || null) !== (e.owner_id || null)) {
                how = "Reassigned";
                await lead.update({ response_due_at: await firstContactDue(now) });
            } else if (lead.response_due_at && new Date(lead.response_due_at) > now) how = "New time set";
        } else if (e.kind === "overdue" && e.task_id) {
            const task = await CrmTaskV2.findByPk(e.task_id);
            if (!task || task.status !== "open") {
                how = task && task.status === "done" ? "Done" : "Task closed";
                by = task ? task.done_by : null;
            } else if (new Date(task.due_at) > now) how = "Moved to a new time";
            else if ((task.owner_id || null) !== (e.owner_id || null)) how = "Reassigned";
        }
        if (!how) continue;
        await e.update({ status: "done", handled_at: now, handled_by: by, how });
        n += 1;
    }
    return n;
}

/** Job crm.escalate (every minute, working time only). */
async function check(now = new Date()) {
    const wh = await workingHours();
    const resolved = await resolveOpen(now);
    if (!isWorkingTime(wh, now)) return { resolved, raised: 0, up: 0 };
    const automation = require("./automation");
    const timers = await settings.read("timers");
    const c = await config.load();
    let raised = 0;
    let up = 0;
    const name = async (id) => (id ? (await AdmUser.findByPk(id, { attributes: ["name"] }))?.name || "Someone" : "Nobody");

    if (await automation.ruleOn("first_contact")) {
        const late = await CrmLeadV2.findAll({ where: { stage_id: c.stageByKey.get("new")?.id || 0, first_contact_at: null, deleted_at: null, merged_into_id: null, response_due_at: { [Op.lt]: now } }, limit: 300 });
        for (const lead of late) {
            if (await CrmEscalation.findOne({ where: { lead_id: lead.id, status: "open" }, attributes: ["id"] })) continue;
            const ref = `fc:${lead.id}:${new Date(lead.response_due_at).getTime()}`;
            if (await CrmEscalation.findOne({ where: { ref: { [Op.like]: `${ref}%` } }, attributes: ["id"] })) continue;
            const chain = lead.owner_id ? await chainFor(lead.owner_id) : { managers: (await peopleWith("leads.assign")).map((p) => p.id), admins: await automation.admins() };
            const waited = workingMinutesBetween(wh, lead.createdAt < lead.response_due_at ? lead.createdAt : lead.response_due_at, now);
            const who = lead.owner_id ? await name(lead.owner_id) : "Nobody (no owner)";
            const title = `Not called in time: ${lead.name || lead.phone}`;
            const body = `${who} has not called. Waiting ${waited} working min (limit ${timers.firstContactMinutes}).`;
            const toManagers = chain.managers.length > 0;
            const row = await raise({ ref, lead, kind: "first_contact", ownerId: lead.owner_id, level: toManagers ? 1 : 2, to: toManagers ? chain.managers : chain.admins, nextLevelAt: toManagers ? addWorkingMinutes(wh, now, timers.managerActMinutes) : null, title, body });
            if (row) {
                raised += 1;
                if (lead.owner_id) await notify(lead.owner_id, { type: "esc.owner", title: `First call is late: ${lead.name || lead.phone}`, body: `Your manager has been told. Call now.`, link: `/leads/${lead.id}`, ref: `esc:${row.id}:owner` });
            }
        }
    }

    if (await automation.ruleOn("overdue_escalation")) {
        const roughly = new Date(now.getTime() - timers.overdueToManagerMinutes * 60000);
        const tasks = await CrmTaskV2.findAll({ where: { status: "open", due_at: { [Op.lt]: roughly } }, order: [["due_at", "ASC"]], limit: 500 });
        for (const task of tasks) {
            if (workingMinutesBetween(wh, task.due_at, now) < timers.overdueToManagerMinutes) continue;
            const lead = await CrmLeadV2.findByPk(task.lead_id);
            if (!lead || lead.deleted_at || lead.merged_into_id || c.stageById.get(lead.stage_id)?.kind !== "open") continue;
            if (await CrmEscalation.findOne({ where: { lead_id: lead.id, status: "open" }, attributes: ["id"] })) continue;
            const ref = `od:${task.id}:${new Date(task.due_at).getTime()}`;
            if (await CrmEscalation.findOne({ where: { ref: { [Op.like]: `${ref}%` } }, attributes: ["id"] })) continue;
            const owner = task.owner_id || lead.owner_id;
            const chain = owner ? await chainFor(owner) : { managers: (await peopleWith("leads.assign")).map((p) => p.id), admins: await automation.admins() };
            const late = workingMinutesBetween(wh, task.due_at, now);
            const lateText = late >= 60 ? `${Math.floor(late / 60)} h ${late % 60} min` : `${late} min`;
            const toManagers = chain.managers.length > 0;
            const row = await raise({
                ref, lead, task, kind: "overdue", ownerId: owner, level: toManagers ? 1 : 2, to: toManagers ? chain.managers : chain.admins,
                nextLevelAt: toManagers ? addWorkingMinutes(wh, now, timers.overdueToAdminMinutes) : null,
                title: `Overdue follow-up: ${lead.name || lead.phone}`, body: `${task.note || task.type} · overdue ${lateText} (working time) · owner ${await name(owner)}`,
            });
            if (row) raised += 1;
        }
    }

    // Level 1 not handled in time -> the admins.
    const stale = await CrmEscalation.findAll({ where: { status: "open", level: 1, next_level_at: { [Op.lte]: now } } });
    for (const e of stale) {
        const lead = await CrmLeadV2.findByPk(e.lead_id);
        if (!lead) continue;
        const admins = (await automation.admins()).filter((id) => id !== e.owner_id);
        await e.update({ status: "expired", how: "Not handled by the manager in time" });
        const row = await raise({
            ref: `${e.ref}:L2`, lead, task: e.task_id ? { id: e.task_id } : null, kind: e.kind, ownerId: e.owner_id, level: 2, to: admins, nextLevelAt: null,
            title: `${e.kind === "first_contact" ? "Still not called" : "Still overdue"}: ${lead.name || lead.phone}`, body: `The manager did not act in time. Owner ${await name(e.owner_id)}.`,
        });
        if (row) up += 1;
    }
    return { resolved, raised, up };
}

/* ------------------------------ panel ------------------------------ */

/** "Needs you now": open escalations for me (admins and view_all see them all). */
async function mine(s) {
    need(s, "leads.edit");
    await resolveOpen();
    const all = s.can("leads.view_all");
    const where = { status: "open", ...(all ? {} : { to_ids: { [Op.like]: `%,${s.user.id},%` } }) };
    const rows = await CrmEscalation.findAll({ where, order: [["raised_at", "ASC"]], limit: 100 });
    const leadIds = [...new Set(rows.map((r) => r.lead_id))];
    const leads = new Map((await CrmLeadV2.findAll({ where: { id: leadIds }, raw: true })).map((l) => [l.id, l]));
    const people = new Map((await AdmUser.findAll({ where: { id: [...new Set(rows.map((r) => r.owner_id).filter(Boolean))] }, attributes: ["id", "name"], raw: true })).map((u) => [u.id, u.name]));
    const tasks = new Map((await CrmTaskV2.findAll({ where: { id: rows.map((r) => r.task_id).filter(Boolean) }, raw: true })).map((t) => [t.id, t]));
    const wh = await workingHours();
    const now = new Date();
    return {
        escalations: rows.map((e) => {
            const l = leads.get(e.lead_id) || {};
            const t = e.task_id ? tasks.get(e.task_id) : null;
            return {
                id: e.id, kind: e.kind, level: e.level, raisedAt: e.raised_at, nextLevelAt: e.next_level_at, forMe: idList(e.to_ids).includes(s.user.id),
                lead: { id: l.id, name: l.name || l.phone || "", phone: l.phone || "", restaurant: l.restaurant_name || "", city: l.city || "", ownerId: l.owner_id || null },
                owner: e.owner_id ? people.get(e.owner_id) || "" : "",
                task: t ? { id: t.id, type: t.type, note: t.note, dueAt: t.due_at } : null,
                waitedMinutes: e.kind === "first_contact" ? workingMinutesBetween(wh, l.response_due_at || e.raised_at, now) : t ? workingMinutesBetween(wh, t.due_at, now) : 0,
            };
        }),
    };
}

/** Team today (managers): each person's status and today's numbers. */
async function teamToday(s) {
    if (!s.can("leads.view_team") && !s.can("leads.view_all")) throw new RuleError("You do not have permission for this.");
    const owners = await scope.visibleOwners(s);
    const c = await config.load();
    const { rotationPeople } = require("./assign");
    const rot = new Set((await rotationPeople()).map((p) => p.id));
    const people = await AdmUser.findAll({ where: { status: "active", ...(owners ? { id: owners } : {}) }, attributes: ["id", "name", "shift_start", "shift_end", "daily_lead_cap"], order: [["name", "ASC"]], raw: true });
    const now = new Date();
    const wh = await workingHours();
    const hhmm = moment(now).tz(TZ).format("HH:mm");
    const workDay = wh.days.includes(moment(now).tz(TZ).day());
    const { start } = todayRange(now);
    const out = [];
    for (const p of people) {
        const open = await CrmLeadV2.count({ where: { owner_id: p.id, stage_id: c.openStageIds, deleted_at: null, merged_into_id: null } });
        const tasksOpen = await CrmTaskV2.count({ where: { owner_id: p.id, status: "open", due_at: { [Op.lt]: now } } });
        if (!open && !rot.has(p.id)) continue;
        const brk = await AdmBreak.findOne({ where: { user_id: p.id, ended_at: null, ends_at: { [Op.gt]: now } }, raw: true });
        const today = moment(now).tz(TZ).format("YYYY-MM-DD");
        const leave = await AdmLeave.findOne({ where: { user_id: p.id, from_date: { [Op.lte]: today }, to_date: { [Op.gte]: today } }, raw: true });
        const onShift = workDay && hhmm >= (p.shift_start || wh.start) && hhmm < (p.shift_end || wh.end);
        const outcomes = await CrmActivity.count({ where: { actor_id: p.id, type: "outcome", at: { [Op.gte]: start } } });
        const calls = await CrmCall.findAll({ where: { user_id: p.id, started_at: { [Op.gte]: start } }, attributes: [[sequelize.fn("COUNT", sequelize.col("id")), "n"], [sequelize.fn("SUM", sequelize.col("duration_seconds")), "secs"]], raw: true });
        const firsts = await CrmLeadV2.findAll({ where: { owner_id: p.id, first_contact_at: { [Op.gte]: start } }, attributes: ["first_contact_at", "response_due_at"], raw: true });
        const onTime = firsts.filter((f) => !f.response_due_at || new Date(f.first_contact_at) <= new Date(f.response_due_at)).length;
        const esc = await CrmEscalation.count({ where: { owner_id: p.id, status: "open" } });
        const newToday = await CrmLeadV2.count({ where: { owner_id: p.id, createdAt: { [Op.gte]: start } } });
        out.push({
            id: p.id, name: p.name,
            shift: `${p.shift_start || wh.start} to ${p.shift_end || wh.end}`,
            status: leave ? "leave" : brk ? "break" : !onShift ? "off" : (await canTakeLeads(p.id)) ? "available" : "off",
            breakKind: brk ? brk.kind : null, breakUntil: brk ? brk.ends_at : null,
            inRotation: rot.has(p.id), open, overdue: tasksOpen, outcomes, calls: Number(calls[0]?.n) || 0, talkSeconds: Number(calls[0]?.secs) || 0,
            firstContacts: firsts.length, firstContactsOnTime: onTime, escalations: esc, newToday,
        });
    }
    const unassigned = s.can("leads.view_all") ? await CrmLeadV2.count({ where: { owner_id: null, stage_id: c.openStageIds, deleted_at: null, merged_into_id: null } }) : null;
    const newToday = await CrmLeadV2.count({ where: { createdAt: { [Op.gte]: start }, deleted_at: null, ...(owners ? { owner_id: owners } : {}) } });
    return { people: out, unassigned, newToday, serverTime: now.toISOString() };
}

worker.registerJob("crm.escalate", () => check().then((r) => `resolved ${r.resolved}, raised ${r.raised}, to admins ${r.up}`));
worker.registerSchedule("crm.escalate", 60);

module.exports = { check, resolveOpen, mine, teamToday, chainFor };
