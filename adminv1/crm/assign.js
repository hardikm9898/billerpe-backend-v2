const { Op } = require("sequelize");
const { CrmLeadV2, CrmTaskV2, CrmAssignment, CrmActivity, AdmUser, AdmRole, AdmLeave, AdmBreak } = require("../../model");
const perms = require("../permissions");
const queue = require("../../services/admin/queue");
const { notify } = require("./notify");
const { workingHours, isWorkingTime, todayRange, moment, TZ } = require("./util");

// Who gets a new lead (design doc: Assignment).
// 1. Same phone number came before: back to that lead's owner, if they can still take leads.
// 2. Else weighted round-robin among people who: are active, can work leads,
//    have "new leads per day" set, are not on leave today, are not on a
//    break, and are inside their shift. The one with the lowest share of
//    their own daily number today wins (ties: fewer leads today, then the
//    one who got a lead longest ago).
// 3. Outside working hours nobody is on shift: the same rotation without the
//    shift and break checks, so the lead waits in its owner's morning queue.
// 4. Nobody at all: left unassigned; people who can assign are told.

async function rotationPeople() {
    const roles = (await AdmRole.findAll({ raw: true })).filter((r) => perms.can(perms.parse(r.permissions), "leads.edit")).map((r) => r.id);
    if (!roles.length) return [];
    return AdmUser.findAll({ where: { status: "active", role_id: roles, daily_lead_cap: { [Op.gt]: 0 } }, raw: true });
}

async function canTakeLeads(userId) {
    if (!userId) return false;
    const u = await AdmUser.findOne({ where: { id: userId, status: "active" }, raw: true });
    if (!u) return false;
    const role = await AdmRole.findOne({ where: { id: u.role_id }, raw: true });
    return !!role && perms.can(perms.parse(role.permissions), "leads.edit");
}

const inShift = (wh, u, now) => {
    const m = moment(now).tz(TZ);
    if (!wh.days.includes(m.day())) return false;
    const hhmm = m.format("HH:mm");
    return hhmm >= (u.shift_start || wh.start) && hhmm < (u.shift_end || wh.end);
};

async function pickOwner({ phoneKey = "", excludeLeadId = 0 } = {}, now = new Date()) {
    if (phoneKey && phoneKey.length >= 10) {
        const prev = await CrmLeadV2.findOne({
            where: { phone_key: phoneKey, owner_id: { [Op.ne]: null }, id: { [Op.ne]: excludeLeadId || 0 } },
            order: [["updatedAt", "DESC"]],
            attributes: ["owner_id"],
            raw: true,
        });
        if (prev && (await canTakeLeads(prev.owner_id))) return { id: prev.owner_id, reason: "Same number as an earlier lead: back to its owner" };
    }
    const people = await rotationPeople();
    if (!people.length) return null;
    const ids = people.map((p) => p.id);
    const today = moment(now).tz(TZ).format("YYYY-MM-DD");
    const onLeave = new Set((await AdmLeave.findAll({ where: { user_id: ids, from_date: { [Op.lte]: today }, to_date: { [Op.gte]: today } }, attributes: ["user_id"], raw: true })).map((l) => l.user_id));
    const onBreak = new Set((await AdmBreak.findAll({ where: { user_id: ids, ended_at: null, started_at: { [Op.lte]: now }, ends_at: { [Op.gt]: now } }, attributes: ["user_id"], raw: true })).map((b) => b.user_id));
    const wh = await workingHours();
    const working = isWorkingTime(wh, now);
    let pool = people.filter((p) => !onLeave.has(p.id));
    if (working) {
        const live = pool.filter((p) => !onBreak.has(p.id) && inShift(wh, p, now));
        if (live.length) pool = live;
    }
    if (!pool.length) return null;
    const { start } = todayRange(now);
    const rows = await CrmAssignment.findAll({ where: { to_id: pool.map((p) => p.id), by_id: null, at: { [Op.gte]: start } }, attributes: ["to_id", "at"], raw: true });
    const lastEver = await CrmAssignment.findAll({ where: { to_id: pool.map((p) => p.id) }, attributes: ["to_id", [CrmAssignment.sequelize.fn("MAX", CrmAssignment.sequelize.col("at")), "last"]], group: ["to_id"], raw: true });
    const lastAt = new Map(lastEver.map((r) => [r.to_id, new Date(r.last).getTime()]));
    const count = new Map();
    for (const r of rows) count.set(r.to_id, (count.get(r.to_id) || 0) + 1);
    const ranked = pool
        .map((p) => ({ p, n: count.get(p.id) || 0, ratio: (count.get(p.id) || 0) / p.daily_lead_cap, last: lastAt.get(p.id) || 0 }))
        .sort((a, b) => a.ratio - b.ratio || a.n - b.n || a.last - b.last || a.p.id - b.p.id);
    const best = ranked[0];
    return { id: best.p.id, reason: `Round-robin: ${best.n + 1} of ${best.p.daily_lead_cap} today${working ? "" : " (outside working hours)"}` };
}

/**
 * Gives a lead to a person (or nobody), moving its open tasks too, with an
 * assignment row, a timeline entry, an event and a notification.
 * byId null = by a rule.
 */
async function assign(lead, toId, { byId = null, reason = "" } = {}, t) {
    const fromId = lead.owner_id || null;
    const to = toId || null;
    if (fromId === to) return lead;
    await lead.update({ owner_id: to }, { transaction: t });
    await CrmTaskV2.update({ owner_id: to }, { where: { lead_id: lead.id, status: "open" }, transaction: t });
    await CrmAssignment.create({ lead_id: lead.id, from_id: fromId, to_id: to, by_id: byId, reason: String(reason).slice(0, 200), at: new Date() }, { transaction: t });
    const names = new Map((await AdmUser.findAll({ where: { id: [fromId, to].filter(Boolean) }, attributes: ["id", "name"], raw: true, transaction: t })).map((u) => [u.id, u.name]));
    const body = to ? `${fromId ? `${names.get(fromId) || "Someone"} → ` : ""}${names.get(to) || "Someone"}${reason ? ` · ${reason}` : ""}` : `Unassigned${reason ? ` · ${reason}` : ""}`;
    await CrmActivity.create({ lead_id: lead.id, type: "owner", actor_id: byId, body, data: JSON.stringify({ from: fromId, to }), at: new Date() }, { transaction: t });
    await queue.emit({ type: "lead.assigned", entity: "crm_lead", entityId: lead.id, data: { from: fromId, to, reason }, actorId: byId }, { transaction: t });
    if (to && to !== byId) {
        await notify(to, { type: "lead.assigned", title: `New lead for you: ${lead.name || lead.phone}`, body: [lead.restaurant_name, lead.city].filter(Boolean).join(" · ") || reason, link: `/leads/${lead.id}`, ref: `assigned:${lead.id}:${Date.now()}` }, { transaction: t });
    }
    return lead;
}

module.exports = { pickOwner, assign, canTakeLeads, rotationPeople };
