const { Op } = require("sequelize");
const { sequelize, CrmLeadV2, CrmTaskV2 } = require("../../model");
const worker = require("../../services/admin/worker");
const config = require("./config");
const { reopen, recalc, activity } = require("./leads");
const { syncNext, addTask } = require("./tasks");
const { assign, pickOwner, canTakeLeads } = require("./assign");
const { notify } = require("./notify");
const { workingHours, addWorkingMinutes, moment, TZ } = require("./util");

// Background work of the sales CRM, run by the admin worker:
//   crm.sweep   every 5 minutes - keeps the next-action rule true:
//     1. "Not now" leads whose revisit date came: reopened for their owner
//     2. open leads with no open task: a "set the next action" task + alert
//     3. open leads whose owner can no longer take leads: reassigned
//     4. unassigned open leads: assigned when someone is available
//   crm.rescore every 6 hours - scores fade with silence.

const LIMIT = 200;

/** `only` (tests): limit every step to these lead ids. */
async function sweep({ only = null } = {}) {
    const scopeIds = only ? { id: only } : {};
    const c = await config.load();
    const now = new Date();
    const wh = await workingHours();
    const nowDue = addWorkingMinutes(wh, now, 0);
    const day = moment(now).tz(TZ).format("YYYY-MM-DD");
    const lostIds = c.stages.filter((s) => s.kind === "lost").map((s) => s.id);
    const done = { revisited: 0, repaired: 0, reassigned: 0, assigned: 0 };

    // 1. revisits
    const due = await CrmLeadV2.findAll({ where: { ...scopeIds, stage_id: lostIds, revisit_at: { [Op.lte]: now }, merged_into_id: null, deleted_at: null }, order: [["revisit_at", "ASC"]], limit: LIMIT });
    for (const lead of due) {
        await sequelize.transaction(async (t) => {
            const reason = lead.lost_reason_id ? c.reasonById.get(lead.lost_reason_id) : null;
            if (!(await canTakeLeads(lead.owner_id))) {
                const pick = await pickOwner({ excludeLeadId: lead.id }, now);
                await assign(lead, pick ? pick.id : null, { reason: pick ? `${pick.reason} (revisit)` : "Revisit: nobody can take leads" }, t);
            }
            await reopen(null, lead.id, { stageId: c.stageByKey.get("contacted").id, next: { type: "call", dueAt: nowDue, note: `Revisit: ${reason ? reason.name : "lost earlier"}` } }, { system: true, transaction: t, why: `Revisit date reached (${reason ? reason.name : "lost"})` });
            await notify(lead.owner_id, { type: "lead.revisit", title: `Time to revisit ${lead.name || lead.phone}`, body: reason ? `Lost earlier: ${reason.name}` : "Lost earlier", link: `/leads/${lead.id}`, ref: `revisit:${lead.id}:${day}` }, { transaction: t });
        });
        done.revisited += 1;
    }

    // 2. open leads without a next action
    const bare = await CrmLeadV2.findAll({ where: { ...scopeIds, stage_id: c.openStageIds, next_action_at: null, merged_into_id: null, deleted_at: null }, limit: LIMIT });
    for (const lead of bare) {
        await sequelize.transaction(async (t) => {
            const open = await CrmTaskV2.count({ where: { lead_id: lead.id, status: "open" }, transaction: t });
            if (open) return syncNext(lead.id, t);
            await addTask({ leadId: lead.id, ownerId: lead.owner_id, type: "call", dueAt: nowDue, note: "Set the next action", origin: "rule" }, t);
            await syncNext(lead.id, t);
            await activity(lead.id, "system", null, "No next action was set: a follow-up was added", null, t);
            await notify(lead.owner_id, { type: "lead.no_next", title: `${lead.name || lead.phone} had no next action`, body: "A follow-up call was added for now.", link: `/leads/${lead.id}`, ref: `nonext:${lead.id}:${day}` }, { transaction: t });
        });
        done.repaired += 1;
    }

    // 3 + 4. owner gone / no owner
    const owned = await CrmLeadV2.findAll({ where: { ...scopeIds, stage_id: c.openStageIds, merged_into_id: null, deleted_at: null }, attributes: ["owner_id"], group: ["owner_id"], raw: true });
    const gone = [];
    for (const o of owned) if (o.owner_id && !(await canTakeLeads(o.owner_id))) gone.push(o.owner_id);
    const orphans = await CrmLeadV2.findAll({ where: { ...scopeIds, stage_id: c.openStageIds, merged_into_id: null, deleted_at: null, [Op.or]: [{ owner_id: null }, ...(gone.length ? [{ owner_id: gone }] : [])] }, order: [["createdAt", "ASC"]], limit: LIMIT });
    for (const lead of orphans) {
        const pick = await pickOwner({ phoneKey: "", excludeLeadId: lead.id }, now);
        if (!pick) break;
        const prev = lead.owner_id;
        await sequelize.transaction(async (t) => {
            await assign(lead, pick.id, { reason: prev ? `${pick.reason} (previous owner cannot take leads)` : pick.reason }, t);
        });
        if (prev) done.reassigned += 1;
        else done.assigned += 1;
    }
    return JSON.stringify(done);
}

async function rescore() {
    const c = await config.load();
    let n = 0;
    let last = 0;
    for (;;) {
        const rows = await CrmLeadV2.findAll({ where: { stage_id: c.openStageIds, merged_into_id: null, deleted_at: null, id: { [Op.gt]: last } }, order: [["id", "ASC"]], limit: 300 });
        if (!rows.length) break;
        for (const l of rows) {
            await recalc(l);
            n += 1;
        }
        last = rows[rows.length - 1].id;
    }
    return `rescored ${n}`;
}

worker.registerJob("crm.sweep", () => sweep());
worker.registerJob("crm.rescore", rescore);
worker.registerSchedule("crm.sweep", 300);
worker.registerSchedule("crm.rescore", 6 * 3600);

module.exports = { sweep, rescore };
