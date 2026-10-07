const { Op } = require("sequelize");
const { sequelize, CrmCadence, CrmCadenceStep, CrmCadenceEnrollment, CrmWaTemplate, CrmLeadV2, CrmTaskV2, AdmUser } = require("../../model");
const { RuleError } = require("../../appv1/core");
const worker = require("../../services/admin/worker");
const audit = require("../audit");
const { need } = require("../auth");
const config = require("./config");
const scope = require("./scope");
const wa = require("./wa");
const { addTask, syncNext } = require("./tasks");
const { notify } = require("./notify");
const { workingHours, addWorkingMinutes, firstContactDue, moment, TZ, txt, parse } = require("./util");

// Cadences: a lead gets a short sequence of call tasks and WhatsApp
// templates, and the sequence stops by itself when they reply, book a demo,
// change stage or the lead closes. They replace the old drips, which sent the
// same template twice a day for 15 days (owner chose lighter cadences,
// 7 Oct 2026): at most one automatic WhatsApp per lead per day, days spread out.

const STOP_FLAGS = ["reply", "demo", "stage", "closed"];
const ACTIONS = ["call", "whatsapp", "template"];
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

// Templates are linked by name once they exist (the old CRM's approved ones
// are imported by scripts/migrate-old-crm.js).
const DEFAULTS = [
    {
        key: "new_lead",
        name: "New lead, no answer",
        description: "Starts after the first No answer / Switched off on a new lead. Day 0 and 5 WhatsApp, day 2 and 10 calls, day 20 last WhatsApp.",
        enrollOn: "outcome:no_answer,switched_off",
        stopOn: { reply: true, demo: true, stage: true, closed: true },
        steps: [
            { day: 0, at: null, action: "template", template: "s_int", note: "We could not reach you" },
            { day: 2, at: "11:00", action: "call", note: "Cadence: second try" },
            { day: 5, at: "11:00", action: "template", template: "offer_only_for_you", note: "Offer" },
            { day: 10, at: "11:00", action: "call", note: "Cadence: third try" },
            { day: 20, at: "11:00", action: "template", template: "s_int", note: "Last check-in" },
        ],
    },
    {
        key: "revival",
        name: "Revival of old leads",
        description: "For old leads nobody has spoken to in a while (the 1,745 moved from the old CRM). Three WhatsApp messages over two weeks; a reply becomes a call task.",
        enrollOn: "manual",
        stopOn: { reply: true, demo: true, stage: true, closed: true },
        steps: [
            { day: 0, at: "10:30", action: "template", template: "offer_only_for_you", note: "Offer" },
            { day: 5, at: "11:00", action: "template", template: "s_int", note: "Follow-up" },
            { day: 14, at: "11:00", action: "template", template: "s_int", note: "Last check-in" },
        ],
    },
    {
        key: "demo_noshow",
        name: "Demo no-show",
        description: "After a Demo no-show outcome: a WhatsApp task to send new slots the same day, a call the next day.",
        enrollOn: "outcome:demo_noshow",
        stopOn: { reply: false, demo: true, stage: true, closed: true },
        steps: [
            { day: 0, at: null, action: "whatsapp", note: "Send new demo slots" },
            { day: 1, at: "11:00", action: "call", note: "Book the demo again" },
        ],
    },
];

async function ensureDefaults() {
    for (const d of DEFAULTS) {
        if (await CrmCadence.findOne({ where: { cadence_key: d.key } })) continue;
        await sequelize.transaction(async (t) => {
            const c = await CrmCadence.create({ cadence_key: d.key, name: d.name, description: d.description, enroll_on: d.enrollOn, stop_on: JSON.stringify(d.stopOn), active: true }, { transaction: t });
            for (const [i, st] of d.steps.entries()) {
                const tpl = st.template ? await CrmWaTemplate.findOne({ where: { name: st.template }, transaction: t }) : null;
                await CrmCadenceStep.create({ cadence_id: c.id, sort: i, day_offset: st.day, at_time: st.at, action: st.action, template_id: tpl ? tpl.id : null, note: st.note || "" }, { transaction: t });
            }
        });
    }
}

/** Template steps of the built-in cadences that still have no template get the one with their default name. */
async function linkDefaultTemplates() {
    let n = 0;
    for (const d of DEFAULTS) {
        const c = await CrmCadence.findOne({ where: { cadence_key: d.key } });
        if (!c) continue;
        const steps = await CrmCadenceStep.findAll({ where: { cadence_id: c.id }, order: [["sort", "ASC"]] });
        for (const [i, st] of steps.entries()) {
            const want = d.steps[i] && d.steps[i].template;
            if (st.action !== "template" || !want) continue;
            if (st.template_id && (await CrmWaTemplate.findByPk(st.template_id))) continue;
            const tpl = await CrmWaTemplate.findOne({ where: { name: want, active: true } });
            if (tpl) {
                await st.update({ template_id: tpl.id });
                n += 1;
            }
        }
    }
    return n;
}

/* ------------------------------ timing ------------------------------ */

/** When step `st` of an enrolment runs: started_at + day_offset days, at at_time (India time). */
function stepTime(enr, st) {
    const base = moment(enr.started_at).tz(TZ).add(st.day_offset, "days");
    if (!st.at_time) return base.toDate();
    const [h, m] = st.at_time.split(":").map(Number);
    return base.hour(h).minute(m).second(0).millisecond(0).toDate();
}

async function stepsOf(cadenceId, t) {
    return CrmCadenceStep.findAll({ where: { cadence_id: cadenceId }, order: [["sort", "ASC"], ["id", "ASC"]], transaction: t });
}

/* ------------------------------ enrol / stop ------------------------------ */

/**
 * Puts a lead into a cadence. Never twice into the same running cadence;
 * `once` = never again after it ran before (automatic enrolments).
 */
async function enroll(leadId, cadenceId, { byId = null, origin = "manual", once = false, startAt = new Date() } = {}, t) {
    const cad = await CrmCadence.findByPk(cadenceId, { transaction: t });
    if (!cad || !cad.active) return null;
    const where = { cadence_id: cad.id, lead_id: leadId, ...(once ? {} : { status: "running" }) };
    if (await CrmCadenceEnrollment.findOne({ where, transaction: t })) return null;
    const steps = await stepsOf(cad.id, t);
    if (!steps.length) return null;
    const enr = await CrmCadenceEnrollment.create({ cadence_id: cad.id, lead_id: leadId, step_index: 0, status: "running", started_at: startAt, by_id: byId, origin, next_run_at: startAt }, { transaction: t });
    const first = stepTime(enr, steps[0]);
    await enr.update({ next_run_at: first < startAt ? startAt : first }, { transaction: t });
    const { activity } = require("./leads");
    await activity(leadId, "system", byId, `Started the cadence "${cad.name}"`, { cadence: cad.id }, t);
    return enr;
}

/** Stops running cadences of a lead whose stop_on has `flag` (or all, flag null). */
async function stopForLead(leadId, reason, flag = null, t) {
    const running = await CrmCadenceEnrollment.findAll({ where: { lead_id: leadId, status: "running" }, transaction: t });
    const stopped = [];
    for (const enr of running) {
        const cad = await CrmCadence.findByPk(enr.cadence_id, { transaction: t });
        const stopOn = parse(cad && cad.stop_on) || {};
        if (flag && !stopOn[flag]) continue;
        await enr.update({ status: "stopped", stop_reason: txt(reason, 80), ended_at: new Date(), next_run_at: null, ...(flag === "reply" ? { replied_at: new Date() } : {}) }, { transaction: t });
        stopped.push({ enr, cad });
    }
    return stopped;
}

/* ------------------------------ running steps ------------------------------ */

async function runStep(enr, now = new Date()) {
    const cad = await CrmCadence.findByPk(enr.cadence_id);
    const lead = await CrmLeadV2.findByPk(enr.lead_id);
    const c = await config.load();
    const end = (status, reason) => enr.update({ status, stop_reason: reason, ended_at: now, next_run_at: null });
    if (!cad || !cad.active) return end("stopped", "cadence switched off").then(() => "cadence off");
    if (!lead || lead.deleted_at || lead.merged_into_id || c.stageById.get(lead.stage_id)?.kind !== "open") return end("stopped", "lead closed").then(() => "lead closed");
    const steps = await stepsOf(cad.id);
    const st = steps[enr.step_index];
    if (!st) return end("done", "all steps done").then(() => "done");

    const { activity } = require("./leads");
    const wh = await workingHours();
    let did = "";
    if (st.action === "call" || st.action === "whatsapp") {
        const soon = new Date(stepTime(enr, st).getTime() + 24 * 3600000);
        const planned = await CrmTaskV2.findOne({ where: { lead_id: lead.id, status: "open", type: st.action, due_at: { [Op.lte]: soon } } });
        if (planned) did = `${st.action === "call" ? "a call" : "a WhatsApp task"} was already planned`;
        else {
            await sequelize.transaction(async (t) => {
                await addTask({ leadId: lead.id, ownerId: lead.owner_id, type: st.action, dueAt: addWorkingMinutes(wh, now, 0), note: st.note || `${cad.name}: step ${enr.step_index + 1}`, origin: "cadence" }, t);
                await syncNext(lead.id, t);
                await activity(lead.id, "system", null, `Cadence "${cad.name}": ${st.action === "call" ? "call task" : "WhatsApp task"} added`, { cadence: cad.id, step: st.id }, t);
            });
            did = `${st.action} task added`;
        }
    } else {
        const tpl = st.template_id ? await CrmWaTemplate.findByPk(st.template_id) : null;
        if (!tpl || !tpl.active) did = "skipped: no active template chosen for this step";
        else if (!lead.phone_valid) did = "skipped: no valid number";
        else {
            const chat = await wa.chatFor(lead.phone);
            if (chat.kind === "lead" && !chat.lead_id) await chat.update({ lead_id: lead.id });
            const owner = lead.owner_id ? await AdmUser.findByPk(lead.owner_id, { attributes: ["id", "name", "mobile"] }) : null;
            const r = await wa.sendTemplate(chat, tpl, await wa.paramValues(tpl, { lead, owner }), { sender: "cadence", enrollmentId: enr.id, now });
            if (r.skipped && r.retryAt) {
                await enr.update({ next_run_at: r.retryAt });
                return `waiting: ${r.reason}`;
            }
            did = r.skipped ? `skipped: ${r.reason}` : `sent ${tpl.name}${r.message.status === "failed" ? ` (failed: ${r.message.error})` : ""}`;
            if (!r.skipped) await activity(lead.id, "system", null, `Cadence "${cad.name}": WhatsApp template ${tpl.name} ${r.message.status === "failed" ? "failed" : "sent"}`, { cadence: cad.id, step: st.id }, null);
        }
    }
    const next = steps[enr.step_index + 1];
    if (!next) await enr.update({ step_index: enr.step_index + 1, status: "done", stop_reason: "all steps done", ended_at: now, next_run_at: null });
    else {
        const at = stepTime(enr, next);
        await enr.update({ step_index: enr.step_index + 1, next_run_at: at < now ? now : at });
    }
    return did;
}

/** Job crm.cadence (every minute): due steps. */
async function runDue({ limit = 200, now = new Date(), only = null } = {}) {
    const where = { status: "running", next_run_at: { [Op.lte]: now }, ...(only ? { lead_id: only } : {}) };
    const due = await CrmCadenceEnrollment.findAll({ where, order: [["next_run_at", "ASC"]], limit });
    const out = [];
    for (const enr of due) {
        try {
            out.push(await runStep(enr, now));
        } catch (e) {
            out.push(`failed: ${e.message}`);
            await enr.update({ next_run_at: new Date(now.getTime() + 15 * 60000) });
        }
    }
    return out;
}

/* ------------------------------ events ------------------------------ */

async function onEvent(ev, data) {
    const leadId = ev.entity === "crm_lead" ? Number(ev.entity_id) : data && data.leadId ? Number(data.leadId) : null;
    if (!leadId) return;
    if (ev.type === "wa.received") {
        if (data.kind !== "lead") return;
        if (data.optout) {
            await stopForLead(leadId, "opted out", null);
            return;
        }
        const stopped = await stopForLead(leadId, "replied on WhatsApp", "reply");
        if (stopped.length) {
            const lead = await CrmLeadV2.findByPk(leadId);
            const c = await config.load();
            if (lead && c.stageById.get(lead.stage_id)?.kind === "open") {
                await sequelize.transaction(async (t) => {
                    const due = await firstContactDue(new Date());
                    await addTask({ leadId, ownerId: lead.owner_id, type: "call", dueAt: due, note: `Replied to "${stopped[0].cad.name}": call them`, origin: "cadence" }, t);
                    await syncNext(leadId, t);
                });
                if (lead.owner_id) await notify(lead.owner_id, { type: "cadence.reply", title: `${lead.name || lead.phone} replied`, body: `To the cadence "${stopped[0].cad.name}". Call them.`, link: `/leads/${leadId}`, ref: `cadreply:${stopped[0].enr.id}` });
            }
        }
        return;
    }
    if (ev.type === "lead.won" || ev.type === "lead.lost") return void (await stopForLead(leadId, ev.type === "lead.won" ? "won" : "lost", "closed"));
    if (ev.type === "lead.stage") return void (await stopForLead(leadId, "stage changed", "stage"));
    if (ev.type === "lead.outcome") {
        if (data.outcome === "demo_booked") await stopForLead(leadId, "demo booked", "demo");
        else if (data.stage) await stopForLead(leadId, "stage changed", "stage");
        await autoEnroll(leadId, `outcome:${data.outcome}`);
        return;
    }
    if (ev.type === "lead.created") await autoEnroll(leadId, "lead.created");
}

/** Cadences whose enroll_on matches (outcome:no_answer,switched_off matches outcome:no_answer). */
async function autoEnroll(leadId, what) {
    const [kind, key] = what.split(":");
    const all = await CrmCadence.findAll({ where: { active: true, enroll_on: { [Op.like]: `${kind}%` } } });
    for (const cad of all) {
        const [k, list] = cad.enroll_on.split(":");
        if (k !== kind) continue;
        if (key && !(list || "").split(",").map((x) => x.trim()).includes(key)) continue;
        const lead = await CrmLeadV2.findByPk(leadId);
        const c = await config.load();
        const stageKey = lead ? c.stageById.get(lead.stage_id)?.stage_key : null;
        if (cad.cadence_key === "new_lead" && !["new", "contacted"].includes(stageKey)) continue;
        await sequelize.transaction((t) => enroll(leadId, cad.id, { origin: "auto", once: true }, t));
    }
}

/* ------------------------------ panel ------------------------------ */

function viewStep(st) {
    return { id: st.id, day: st.day_offset, at: st.at_time, action: st.action, templateId: st.template_id, note: st.note };
}

async function list(s) {
    need(s, "leads.edit");
    const cads = await CrmCadence.findAll({ order: [["id", "ASC"]] });
    const out = [];
    for (const c of cads) {
        const steps = await stepsOf(c.id);
        const counts = Object.fromEntries((await CrmCadenceEnrollment.findAll({ where: { cadence_id: c.id }, attributes: ["status", [sequelize.fn("COUNT", sequelize.col("id")), "n"]], group: ["status"], raw: true })).map((r) => [r.status, Number(r.n)]));
        const replied = await CrmCadenceEnrollment.count({ where: { cadence_id: c.id, replied_at: { [Op.ne]: null } } });
        const total = Object.values(counts).reduce((a, b) => a + b, 0);
        out.push({
            id: c.id, key: c.cadence_key, name: c.name, description: c.description, enrollOn: c.enroll_on, stopOn: parse(c.stop_on) || {}, active: c.active,
            steps: steps.map(viewStep), running: counts.running || 0, done: counts.done || 0, stopped: counts.stopped || 0, total, replied, repliedPct: total ? Math.round((replied * 100) / total) : null,
        });
    }
    const templates = await CrmWaTemplate.findAll({ where: { active: true }, attributes: ["id", "name"], order: [["name", "ASC"]], raw: true });
    return { cadences: out, templates, enrollOptions: enrollOptions(await config.load()) };
}

function enrollOptions(c) {
    return [{ value: "manual", label: "Only when someone starts it" }, { value: "lead.created", label: "Every new lead" }, ...c.outcomes.filter((o) => o.active).map((o) => ({ value: `outcome:${o.outcome_key}`, label: `After the outcome "${o.name}"` }))];
}

async function save(s, input = {}) {
    need(s, "automation.manage");
    const name = txt(input.name, 80);
    if (!name) throw new RuleError("Give the cadence a name.");
    const c = await config.load();
    const enrollOn = txt(input.enrollOn, 40) || "manual";
    const okEnroll = enrollOn === "manual" || enrollOn === "lead.created" || (/^outcome:[\w,]+$/.test(enrollOn) && enrollOn.slice(8).split(",").every((k) => c.outcomeByKey.has(k)));
    if (!okEnroll) throw new RuleError("Choose when leads join this cadence.");
    const stopOn = Object.fromEntries(STOP_FLAGS.map((f) => [f, !!(input.stopOn || {})[f]]));
    const steps = (Array.isArray(input.steps) ? input.steps : []).map((st, i) => {
        const day = Number(st.day);
        if (!Number.isInteger(day) || day < 0 || day > 120) throw new RuleError(`Step ${i + 1}: the day must be 0 to 120.`);
        if (st.at && !HHMM.test(st.at)) throw new RuleError(`Step ${i + 1}: write the time as HH:MM.`);
        if (!ACTIONS.includes(st.action)) throw new RuleError(`Step ${i + 1}: choose call, WhatsApp task or template.`);
        if (st.action === "template" && !st.templateId) throw new RuleError(`Step ${i + 1}: choose a template.`);
        return { day_offset: day, at_time: st.at || null, action: st.action, template_id: st.action === "template" ? Number(st.templateId) : null, note: txt(st.note, 200), sort: i };
    });
    if (!steps.length) throw new RuleError("Add at least one step.");
    if (steps.length > 20) throw new RuleError("Keep a cadence to 20 steps or fewer.");
    for (let i = 1; i < steps.length; i++) if (steps[i].day_offset < steps[i - 1].day_offset) throw new RuleError("Put the steps in day order.");
    for (const st of steps.filter((x) => x.template_id)) if (!(await CrmWaTemplate.findByPk(st.template_id))) throw new RuleError("A chosen template no longer exists.");
    return sequelize.transaction(async (t) => {
        let cad = input.id ? await CrmCadence.findByPk(Number(input.id), { transaction: t }) : null;
        if (input.id && !cad) throw new RuleError("This cadence no longer exists.");
        const before = cad ? { name: cad.name, enrollOn: cad.enroll_on, active: cad.active } : null;
        const fields = { name, description: txt(input.description, 300), enroll_on: enrollOn, stop_on: JSON.stringify(stopOn), active: input.active !== false };
        if (cad) await cad.update(fields, { transaction: t });
        else cad = await CrmCadence.create({ ...fields, created_by: s.user.id }, { transaction: t });
        // Running enrolments keep their place: steps are matched by position.
        await CrmCadenceStep.destroy({ where: { cadence_id: cad.id }, transaction: t });
        for (const st of steps) await CrmCadenceStep.create({ ...st, cadence_id: cad.id }, { transaction: t });
        await audit.write(s, { action: input.id ? "cadence.update" : "cadence.create", entity: "crm_cadence", entityId: cad.id, summary: `${input.id ? "Changed" : "Added"} the cadence "${name}" (${steps.length} steps)`, before, after: { name, enrollOn, active: fields.active, steps: steps.length } }, { transaction: t });
        return { id: cad.id };
    });
}

/** Start a cadence for a lead from the lead page. */
async function start(s, leadId, cadenceId) {
    need(s, "leads.edit");
    const lead = await CrmLeadV2.findByPk(Number(leadId));
    if (!lead || lead.deleted_at || !(await scope.canSee(s, lead))) throw new RuleError("This lead is not visible to you.");
    const c = await config.load();
    if (c.stageById.get(lead.stage_id)?.kind !== "open") throw new RuleError("The lead is closed. Reopen it first.");
    const enr = await sequelize.transaction((t) => enroll(lead.id, Number(cadenceId), { byId: s.user.id, origin: "manual" }, t));
    if (!enr) throw new RuleError("This cadence is off, has no steps, or is already running for this lead.");
    return { id: enr.id };
}

async function stop(s, enrollmentId) {
    need(s, "leads.edit");
    const enr = await CrmCadenceEnrollment.findByPk(Number(enrollmentId));
    if (!enr || enr.status !== "running") throw new RuleError("This cadence is not running.");
    const lead = await CrmLeadV2.findByPk(enr.lead_id);
    if (!lead || !(await scope.canSee(s, lead))) throw new RuleError("This lead is not visible to you.");
    const cad = await CrmCadence.findByPk(enr.cadence_id);
    await sequelize.transaction(async (t) => {
        await enr.update({ status: "stopped", stop_reason: `stopped by ${s.user.name}`.slice(0, 80), ended_at: new Date(), next_run_at: null }, { transaction: t });
        const { activity } = require("./leads");
        await activity(lead.id, "system", s.user.id, `Stopped the cadence "${cad ? cad.name : ""}"`, { cadence: enr.cadence_id }, t);
    });
    return { ok: true };
}

/** The cadences of one lead (lead page). */
async function forLead(leadId) {
    const rows = await CrmCadenceEnrollment.findAll({ where: { lead_id: leadId }, order: [["id", "DESC"]], limit: 10 });
    const out = [];
    for (const r of rows) {
        const cad = await CrmCadence.findByPk(r.cadence_id);
        const steps = cad ? await stepsOf(cad.id) : [];
        out.push({ id: r.id, cadenceId: r.cadence_id, name: cad ? cad.name : "", status: r.status, step: r.step_index, steps: steps.length, nextAt: r.next_run_at, stopReason: r.stop_reason, startedAt: r.started_at });
    }
    return out;
}

worker.registerJob("crm.cadence", () => runDue().then((r) => `${r.length} steps`));
worker.registerSchedule("crm.cadence", 60);
// A failure here must not make the event retry (the rules subscriber would act twice).
worker.subscribe("*", (ev, data) => onEvent(ev, data).catch((e) => console.error("[crm cadences] event", ev.id, e && e.message)));

module.exports = { DEFAULTS, ensureDefaults, linkDefaultTemplates, enroll, stopForLead, runStep, runDue, onEvent, autoEnroll, list, save, start, stop, forLead, stepTime };
