const { Op } = require("sequelize");
const { sequelize, CrmRule, CrmRuleRun, CrmLeadV2, CrmTaskV2, CrmEvent, CrmWaTemplate, CrmCadence, AdmUser, CrmActivity } = require("../../model");
const { RuleError } = require("../../appv1/core");
const worker = require("../../services/admin/worker");
const queue = require("../../services/admin/queue");
const audit = require("../audit");
const { need } = require("../auth");
const settings = require("../settings");
const config = require("./config");
const wa = require("./wa");
const { addTask, syncNext } = require("./tasks");
const { notify, peopleWith } = require("./notify");
const { band } = require("./score");
const { workingHours, isWorkingTime, addWorkingMinutes, workingMinutesBetween, moment, TZ, txt, parse } = require("./util");

// Automation rules: When (an event or a timer) - If (conditions on the lead)
// - Then (actions). Built-in rules ship on day one (design doc: "Built-in
// rules"); their behaviour is fixed, their numbers and templates are
// editable and they can be switched off. People add their own event rules.
// Every run is written to crm_rule_runs and shown on the Automation screen.

const BUILTIN = [
    { key: "first_contact", name: "First-contact timer", trigger: "timer", sort: 1, description: "A new lead not called within the first-contact time goes to the salesperson's manager; if the manager does not act in time, to the admins. Times are in Settings > Timers.", params: {} },
    { key: "overdue_escalation", name: "Overdue follow-up escalation", trigger: "timer", sort: 2, description: "A next action overdue by the set working time goes to the manager, then to the admins. Times are in Settings > Timers.", params: {} },
    { key: "no_answer_ladder", name: "No-answer retry ladder", trigger: "lead.outcome", sort: 3, description: "No answer, busy or switched off several times in a row: on the 3rd try a WhatsApp template goes out (if chosen) and the next call moves to tomorrow 11:00; on the 6th the lead joins the revival cadence and the owner is asked to close it.", params: { templateTry: 3, templateId: null, nextDayAt: "11:00", revivalTry: 6 } },
    { key: "wa_reply_task", name: "WhatsApp reply task", trigger: "wa.received", sort: 4, description: "A lead writes on WhatsApp and the AI is not answering (a person took over, AI off, a photo or voice note): a \"Reply on WhatsApp\" task for the owner, due now.", params: {} },
    { key: "demo_reminder", name: "Demo reminder", trigger: "timer", sort: 5, description: "Before a demo: a reminder to the salesperson and, if a template is chosen, a WhatsApp to the lead.", params: { minutesBefore: 60, templateId: null } },
    { key: "proposal_followup", name: "Proposal follow-up", trigger: "timer", sort: 6, description: "A lead in Proposal with no activity for the set days gets a call task for its owner.", params: { days: 2 } },
    { key: "revisit", name: "Not now comes back", trigger: "timer", sort: 7, description: "On the revisit date a Not now lead reopens for its last owner (checked every 5 minutes).", params: {} },
    { key: "welcome_template", name: "Welcome message for new leads", trigger: "lead.created", sort: 8, description: "A new lead from the chosen sources gets a WhatsApp template at once (also at night), so the chat opens and the AI can answer. Choose a template to switch it on.", params: { templateId: null, sources: ["meta"] }, active: false },
];
const BUILTIN_BY_KEY = new Map(BUILTIN.map((b) => [b.key, b]));

const TRIGGERS = [
    { value: "lead.created", label: "A new lead arrives" },
    { value: "lead.outcome", label: "An outcome is logged" },
    { value: "lead.stage", label: "The stage changes" },
    { value: "lead.won", label: "A lead is won" },
    { value: "lead.lost", label: "A lead is lost" },
    { value: "lead.reopened", label: "A lead is reopened" },
    { value: "lead.assigned", label: "A lead gets an owner" },
    { value: "wa.received", label: "A lead writes on WhatsApp" },
];
const ACTION_TYPES = ["task", "template", "cadence", "notify", "assign", "stop_cadences"];

async function ensureDefaults() {
    for (const b of BUILTIN) {
        if (await CrmRule.findOne({ where: { rule_key: b.key } })) continue;
        await CrmRule.create({ rule_key: b.key, name: b.name, description: b.description, trigger: b.trigger, params: JSON.stringify(b.params), active: b.active !== false, sort: b.sort });
    }
}

/* ------------------------------ cache ------------------------------ */

let cache = null;
let cachedAt = 0;
async function rules(force = false) {
    if (!force && cache && Date.now() - cachedAt < 30000) return cache;
    await ensureDefaults();
    cache = (await CrmRule.findAll({ order: [["sort", "ASC"], ["id", "ASC"]], raw: true })).map((r) => ({ ...r, conditions: parse(r.conditions) || {}, actions: parse(r.actions) || [], guards: parse(r.guards) || {}, params: { ...(BUILTIN_BY_KEY.get(r.rule_key)?.params || {}), ...(parse(r.params) || {}) } }));
    cachedAt = Date.now();
    return cache;
}
const invalidate = () => {
    cache = null;
};
async function ruleOn(key) {
    const r = (await rules()).find((x) => x.rule_key === key);
    return !!(r && r.active);
}
async function builtin(key) {
    return (await rules()).find((x) => x.rule_key === key) || null;
}

async function log(rule, leadId, result, details, eventId = null, t) {
    await CrmRuleRun.create({ rule_id: rule.id, lead_id: leadId || null, event_id: eventId, result, details: txt(details, 500), at: new Date() }, { transaction: t });
}

/* ------------------------------ conditions ------------------------------ */

async function matches(rule, lead, ev, data) {
    const cnd = rule.conditions || {};
    const c = await config.load();
    const stageKey = c.stageById.get(lead.stage_id)?.stage_key;
    if (cnd.sources && cnd.sources.length && !cnd.sources.includes(lead.source)) return false;
    if (cnd.stages && cnd.stages.length && !cnd.stages.includes(stageKey)) return false;
    if (cnd.bands && cnd.bands.length && !cnd.bands.includes(band(lead.score))) return false;
    if (cnd.owners && cnd.owners.length && !cnd.owners.map(Number).includes(lead.owner_id)) return false;
    if (cnd.outcomes && cnd.outcomes.length && !(ev.type === "lead.outcome" || ev.type === "lead.lost") ) return false;
    if (cnd.outcomes && cnd.outcomes.length && !cnd.outcomes.includes(data && data.outcome)) return false;
    if (cnd.cities && cnd.cities.length && !cnd.cities.map((x) => String(x).toLowerCase()).includes(String(lead.city || "").toLowerCase())) return false;
    if (cnd.hours) {
        const inside = isWorkingTime(await workingHours(), new Date());
        if ((cnd.hours === "in" && !inside) || (cnd.hours === "out" && inside)) return false;
    }
    return true;
}

/** oncePerDays guard: did this rule already act on this lead within N days? */
async function ranRecently(rule, leadId, days) {
    if (!days) return false;
    return !!(await CrmRuleRun.findOne({ where: { rule_id: rule.id, lead_id: leadId, result: "done", at: { [Op.gte]: new Date(Date.now() - days * 86400000) } } }));
}

/* ------------------------------ actions ------------------------------ */

async function managersOf(userId) {
    if (!userId) return [];
    const u = await AdmUser.findByPk(userId, { attributes: ["id", "manager_id", "team_id"] });
    if (!u) return [];
    const ids = new Set();
    if (u.manager_id) ids.add(u.manager_id);
    if (u.team_id) {
        const { AdmTeam } = require("../../model");
        const team = await AdmTeam.findByPk(u.team_id, { attributes: ["manager_id"] });
        if (team && team.manager_id && team.manager_id !== userId) ids.add(team.manager_id);
    }
    const active = await AdmUser.findAll({ where: { id: [...ids], status: "active" }, attributes: ["id"], raw: true });
    return active.map((x) => x.id);
}

/** The admins: active people whose role has every permission. */
async function admins() {
    const { AdmRole } = require("../../model");
    const roles = (await AdmRole.findAll({ raw: true })).filter((r) => (parse(r.permissions) || []).includes("*")).map((r) => r.id);
    if (!roles.length) return [];
    return (await AdmUser.findAll({ where: { role_id: roles, status: "active" }, attributes: ["id"], raw: true })).map((x) => x.id);
}

/** Sends a template to a lead as an automatic message; outside the sending hours it waits. */
async function sendLeadTemplate(lead, templateId, { sender = "rule", ruleId = null } = {}) {
    const tpl = templateId ? await CrmWaTemplate.findByPk(Number(templateId)) : null;
    if (!tpl || !tpl.active) return { skipped: true, reason: "no active template chosen" };
    if (!lead.phone_valid) return { skipped: true, reason: "no valid number" };
    const chat = await wa.chatFor(lead.phone);
    if (chat.kind === "lead" && chat.lead_id !== lead.id) await chat.update({ lead_id: lead.id });
    const owner = lead.owner_id ? await AdmUser.findByPk(lead.owner_id, { attributes: ["id", "name", "mobile"] }) : null;
    const r = await wa.sendTemplate(chat, tpl, await wa.paramValues(tpl, { lead, owner }), { sender });
    if (r.skipped && r.retryAt && ruleId) {
        await queue.enqueue({ kind: "crm.rule_template", payload: { ruleId, leadId: lead.id, templateId: tpl.id }, runAt: r.retryAt, dedupeKey: `rtpl:${ruleId}:${lead.id}:${moment(r.retryAt).tz(TZ).format("YYYYMMDD")}` });
        return { skipped: true, reason: `${r.reason}; will send at ${moment(r.retryAt).tz(TZ).format("D MMM h:mm A")}` };
    }
    if (r.skipped) return r;
    return { sent: tpl.name, status: r.message.status };
}

async function runActions(rule, lead, { dry = false } = {}) {
    const done = [];
    const { activity } = require("./leads");
    const wh = await workingHours();
    for (const a of rule.actions || []) {
        if (dry) {
            done.push(`would ${a.type}`);
            continue;
        }
        if (a.type === "task") {
            await sequelize.transaction(async (t) => {
                await addTask({ leadId: lead.id, ownerId: lead.owner_id, type: config.NEXT_TYPES.includes(a.taskType) ? a.taskType : "call", dueAt: addWorkingMinutes(wh, new Date(), Number(a.minutes) || 0), note: txt(a.note, 300) || rule.name, origin: "rule" }, t);
                await syncNext(lead.id, t);
                await activity(lead.id, "system", null, `Rule "${rule.name}": task added`, { rule: rule.id }, t);
            });
            done.push("task");
        } else if (a.type === "template") {
            const r = await sendLeadTemplate(lead, a.templateId, { ruleId: rule.id });
            done.push(r.skipped ? `template skipped (${r.reason})` : `template ${r.sent}`);
        } else if (a.type === "cadence") {
            const cad = require("./cadences");
            const enr = await sequelize.transaction((t) => cad.enroll(lead.id, Number(a.cadenceId), { origin: "rule" }, t));
            done.push(enr ? "cadence started" : "cadence not started (off or already running)");
        } else if (a.type === "notify") {
            const to = a.to === "admins" ? await admins() : a.to === "manager" ? await managersOf(lead.owner_id) : [lead.owner_id].filter(Boolean);
            for (const id of to) await notify(id, { type: "rule", title: txt(a.text, 160) || `${rule.name}: ${lead.name || lead.phone}`, body: `${lead.name || lead.phone}${lead.restaurant_name ? ` · ${lead.restaurant_name}` : ""}`, link: `/leads/${lead.id}`, ref: `rule:${rule.id}:${lead.id}:${Date.now()}` });
            done.push(`told ${to.length}`);
        } else if (a.type === "assign") {
            const { pickOwner, assign } = require("./assign");
            let to = null;
            let reason = `Rule "${rule.name}"`;
            if (a.to === "round_robin") {
                const pick = await pickOwner({ phoneKey: "", excludeLeadId: lead.id }, new Date());
                to = pick ? pick.id : null;
                if (pick) reason += `: ${pick.reason}`;
            } else to = Number(a.to) || null;
            if (to && to !== lead.owner_id) {
                await sequelize.transaction((t) => assign(lead, to, { byId: null, reason }, t));
                done.push("assigned");
            } else done.push("not assigned (nobody free)");
        } else if (a.type === "stop_cadences") {
            const cad = require("./cadences");
            const n = await sequelize.transaction((t) => cad.stopForLead(lead.id, `rule "${rule.name}"`, null, t));
            done.push(`${n.length} cadences stopped`);
        }
    }
    return done;
}

/* ------------------------------ event rules ------------------------------ */

async function onEvent(ev, data) {
    const leadId = ev.entity === "crm_lead" ? Number(ev.entity_id) : data && data.leadId ? Number(data.leadId) : null;
    if (!leadId) return;
    if (ev.type === "wa.received" && data.kind !== "lead") return;
    const all = await rules();
    for (const rule of all.filter((r) => r.active && r.trigger === ev.type)) {
        const lead = await CrmLeadV2.findByPk(leadId);
        if (!lead || lead.deleted_at || lead.merged_into_id) return;
        try {
            if (rule.rule_key === "no_answer_ladder") await noAnswerLadder(rule, lead, data, ev);
            else if (rule.rule_key === "welcome_template") await welcome(rule, lead, ev);
            else if (rule.rule_key) continue;
            else {
                if (!(await matches(rule, lead, ev, data))) continue;
                if (await ranRecently(rule, lead.id, Number(rule.guards.oncePerDays) || 0)) {
                    await log(rule, lead.id, "skipped", `Already ran in the last ${rule.guards.oncePerDays} days`, ev.id);
                    continue;
                }
                const dry = !!rule.guards.dryRun;
                const done = await runActions(rule, lead, { dry });
                await log(rule, lead.id, dry ? "dry" : "done", done.join(", "), ev.id);
            }
        } catch (e) {
            await log(rule, lead.id, "failed", e.message, ev.id);
        }
    }
}

const UNREACHED = new Set(["no_answer", "busy", "switched_off"]);

/** No-answer ladder: counts the unanswered outcomes in a row on this lead. */
async function noAnswerLadder(rule, lead, data, ev) {
    if (!UNREACHED.has(data.outcome)) return;
    const c = await config.load();
    if (!["new", "contacted"].includes(c.stageById.get(lead.stage_id)?.stage_key)) return;
    const outs = await CrmActivity.findAll({ where: { lead_id: lead.id, type: "outcome" }, order: [["id", "DESC"]], limit: 20, attributes: ["data", "at"], raw: true });
    let tries = 0;
    for (const o of outs) {
        const d = parse(o.data) || {};
        if (!UNREACHED.has(d.outcome)) break;
        tries += 1;
    }
    const p = rule.params;
    if (tries === Number(p.templateTry)) {
        const parts = [];
        if (p.templateId) {
            const r = await sendLeadTemplate(lead, p.templateId, { ruleId: rule.id });
            parts.push(r.skipped ? `template skipped (${r.reason})` : `template ${r.sent}`);
        }
        // The next call (made by the outcome) moves to tomorrow at nextDayAt.
        const wh = await workingHours();
        const [h, m] = String(p.nextDayAt || "11:00").split(":").map(Number);
        const tomorrow = addWorkingMinutes(wh, moment().tz(TZ).add(1, "day").hour(h).minute(m).second(0).toDate(), 0);
        const task = await CrmTaskV2.findOne({ where: { lead_id: lead.id, status: "open", type: "call" }, order: [["due_at", "ASC"]] });
        if (task && new Date(task.due_at) < tomorrow) {
            await sequelize.transaction(async (t) => {
                await task.update({ due_at: tomorrow, note: `${task.note || "Call"} (moved to tomorrow after ${tries} tries)`.slice(0, 300) }, { transaction: t });
                await syncNext(lead.id, t);
            });
            parts.push(`next call moved to ${moment(tomorrow).tz(TZ).format("D MMM h:mm A")}`);
        }
        await log(rule, lead.id, "done", `Try ${tries}: ${parts.join(", ") || "nothing to do"}`, ev.id);
    } else if (tries === Number(p.revivalTry)) {
        const cad = require("./cadences");
        const revival = await CrmCadence.findOne({ where: { cadence_key: "revival" } });
        const enr = revival ? await sequelize.transaction((t) => cad.enroll(lead.id, revival.id, { origin: "rule" }, t)) : null;
        if (lead.owner_id) await notify(lead.owner_id, { type: "rule", title: `${lead.name || lead.phone}: ${tries} calls without an answer`, body: "Moved to the revival cadence. Close the lead as Lost (unreachable) if it stays silent.", link: `/leads/${lead.id}`, ref: `ladder:${lead.id}:${tries}` });
        await log(rule, lead.id, "done", `Try ${tries}: ${enr ? "revival cadence started" : "revival cadence not started"}, owner told`, ev.id);
    }
}

async function welcome(rule, lead, ev) {
    const p = rule.params;
    if (Array.isArray(p.sources) && p.sources.length && !p.sources.includes(lead.source)) return;
    const r = await sendLeadTemplate(lead, p.templateId, { ruleId: rule.id });
    await log(rule, lead.id, r.skipped ? "skipped" : "done", r.skipped ? r.reason : `sent ${r.sent}`, ev.id);
}

/* ------------------------------ timer rules ------------------------------ */

async function demoReminders(now = new Date()) {
    const rule = await builtin("demo_reminder");
    if (!rule || !rule.active) return 0;
    const before = Number(rule.params.minutesBefore) || 60;
    const tasks = await CrmTaskV2.findAll({ where: { type: "demo", status: "open", due_at: { [Op.gt]: now, [Op.lte]: new Date(now.getTime() + before * 60000) } }, limit: 200 });
    let n = 0;
    for (const task of tasks) {
        const job = await queue.enqueue({ kind: "crm.demo_reminder", payload: { taskId: task.id }, dedupeKey: `demo_reminder:${task.id}:${new Date(task.due_at).getTime()}` });
        if (job && job.status === "queued") n += 1;
    }
    return n;
}

async function demoReminderJob({ taskId }) {
    const rule = await builtin("demo_reminder");
    const task = await CrmTaskV2.findByPk(taskId);
    if (!rule || !rule.active || !task || task.status !== "open") return "nothing to do";
    const lead = await CrmLeadV2.findByPk(task.lead_id);
    if (!lead) return "lead gone";
    const when = moment(task.due_at).tz(TZ).format("h:mm A");
    if (task.owner_id || lead.owner_id) await notify(task.owner_id || lead.owner_id, { type: "rule", title: `Demo at ${when}: ${lead.name || lead.phone}`, body: task.note || "", link: `/leads/${lead.id}`, ref: `demo:${task.id}:${new Date(task.due_at).getTime()}` });
    const parts = ["salesperson told"];
    if (rule.params.templateId) {
        const r = await sendLeadTemplate(lead, rule.params.templateId, { ruleId: rule.id });
        parts.push(r.skipped ? `template skipped (${r.reason})` : `template ${r.sent}`);
    }
    await log(rule, lead.id, "done", `Demo at ${when}: ${parts.join(", ")}`);
    return parts.join(", ");
}

async function proposalFollowups(now = new Date()) {
    const rule = await builtin("proposal_followup");
    if (!rule || !rule.active) return 0;
    const c = await config.load();
    const stage = c.stageByKey.get("proposal");
    if (!stage) return 0;
    const days = Number(rule.params.days) || 2;
    const quiet = new Date(now.getTime() - days * 86400000);
    const leads = await CrmLeadV2.findAll({ where: { stage_id: stage.id, deleted_at: null, merged_into_id: null, [Op.or]: [{ last_activity_at: { [Op.lt]: quiet } }, { last_activity_at: null }] }, limit: 200 });
    const wh = await workingHours();
    let n = 0;
    for (const lead of leads) {
        if (await ranRecently(rule, lead.id, days)) continue;
        const soon = await CrmTaskV2.findOne({ where: { lead_id: lead.id, status: "open", due_at: { [Op.lte]: new Date(now.getTime() + 86400000) } } });
        if (soon) continue;
        await sequelize.transaction(async (t) => {
            await addTask({ leadId: lead.id, ownerId: lead.owner_id, type: "call", dueAt: addWorkingMinutes(wh, now, 0), note: "Follow up on the price shared", origin: "rule" }, t);
            await syncNext(lead.id, t);
            await log(rule, lead.id, "done", `No activity for ${days} days in Proposal: call task added`, null, t);
        });
        n += 1;
    }
    return n;
}

async function timerJob() {
    const a = await demoReminders();
    const b = await proposalFollowups();
    return `demo reminders ${a}, proposal follow-ups ${b}`;
}

/* ------------------------------ panel ------------------------------ */

function view(r, runs) {
    const b = BUILTIN_BY_KEY.get(r.rule_key);
    return {
        id: r.id, key: r.rule_key, builtin: !!b, name: r.name, description: r.description, trigger: r.trigger, conditions: r.conditions, actions: r.actions, guards: r.guards, params: r.params, active: !!r.active,
        runs7d: runs ? runs.get(r.id) || 0 : 0,
    };
}

async function list(s) {
    need(s, "automation.manage");
    const all = await rules(true);
    const since = new Date(Date.now() - 7 * 86400000);
    const runs = new Map((await CrmRuleRun.findAll({ where: { at: { [Op.gte]: since }, result: { [Op.ne]: "skipped" } }, attributes: ["rule_id", [sequelize.fn("COUNT", sequelize.col("id")), "n"]], group: ["rule_id"], raw: true })).map((r) => [r.rule_id, Number(r.n)]));
    const c = await config.load();
    const templates = await CrmWaTemplate.findAll({ where: { active: true }, attributes: ["id", "name"], order: [["name", "ASC"]], raw: true });
    const cadences = await CrmCadence.findAll({ where: { active: true }, attributes: ["id", "name"], raw: true });
    const { status } = require("../../services/admin/worker");
    return {
        rules: all.map((r) => view(r, runs)),
        triggers: TRIGGERS,
        templates,
        cadences,
        stages: c.stages.map((x) => ({ key: x.stage_key, name: x.name })),
        outcomes: c.outcomes.map((x) => ({ key: x.outcome_key, name: x.name })),
        worker: await status(),
    };
}

function cleanRule(input, c) {
    const name = txt(input.name, 80);
    if (!name) throw new RuleError("Give the rule a name.");
    if (!TRIGGERS.some((x) => x.value === input.trigger)) throw new RuleError("Choose when the rule runs.");
    const arr = (v, ok) => (Array.isArray(v) ? [...new Set(v.map(String))].filter(ok) : []);
    const cnd = input.conditions || {};
    const conditions = {
        sources: arr(cnd.sources, (x) => /^[a-z]{2,20}$/.test(x)),
        stages: arr(cnd.stages, (x) => c.stageByKey.has(x)),
        bands: arr(cnd.bands, (x) => ["hot", "warm", "cold"].includes(x)),
        outcomes: arr(cnd.outcomes, (x) => c.outcomeByKey.has(x)),
        owners: arr(cnd.owners, (x) => /^\d+$/.test(x)).map(Number),
        cities: arr(cnd.cities, (x) => x.trim()).map((x) => x.trim().slice(0, 60)),
        hours: ["in", "out"].includes(cnd.hours) ? cnd.hours : "",
    };
    const actions = (Array.isArray(input.actions) ? input.actions : []).map((a, i) => {
        if (!ACTION_TYPES.includes(a.type)) throw new RuleError(`Action ${i + 1}: choose what to do.`);
        if (a.type === "task") {
            const minutes = Number(a.minutes) || 0;
            if (minutes < 0 || minutes > 10080) throw new RuleError(`Action ${i + 1}: due in 0 to 10080 working minutes.`);
            return { type: "task", taskType: config.NEXT_TYPES.includes(a.taskType) ? a.taskType : "call", minutes, note: txt(a.note, 200) };
        }
        if (a.type === "template") {
            if (!a.templateId) throw new RuleError(`Action ${i + 1}: choose a template.`);
            return { type: "template", templateId: Number(a.templateId) };
        }
        if (a.type === "cadence") {
            if (!a.cadenceId) throw new RuleError(`Action ${i + 1}: choose a cadence.`);
            return { type: "cadence", cadenceId: Number(a.cadenceId) };
        }
        if (a.type === "notify") return { type: "notify", to: ["owner", "manager", "admins"].includes(a.to) ? a.to : "owner", text: txt(a.text, 160) };
        if (a.type === "assign") return { type: "assign", to: a.to === "round_robin" ? "round_robin" : Number(a.to) || "round_robin" };
        return { type: "stop_cadences" };
    });
    if (!actions.length) throw new RuleError("Add at least one action.");
    if (actions.length > 8) throw new RuleError("Keep a rule to 8 actions or fewer.");
    const oncePerDays = Number((input.guards || {}).oncePerDays) || 0;
    if (oncePerDays < 0 || oncePerDays > 365) throw new RuleError("Once per lead: 0 to 365 days.");
    return { name, description: txt(input.description, 300), trigger: input.trigger, conditions, actions, guards: { oncePerDays, dryRun: !!(input.guards || {}).dryRun } };
}

function cleanParams(key, p = {}) {
    const n = (v, min, max, label) => {
        const x = Number(v);
        if (!Number.isInteger(x) || x < min || x > max) throw new RuleError(`${label} must be ${min} to ${max}.`);
        return x;
    };
    if (key === "no_answer_ladder") {
        const templateTry = n(p.templateTry, 1, 20, "Template on try");
        const revivalTry = n(p.revivalTry, 2, 30, "Revival on try");
        if (revivalTry <= templateTry) throw new RuleError("The revival try must come after the template try.");
        if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(p.nextDayAt || ""))) throw new RuleError("Write the next-day call time as HH:MM.");
        return { templateTry, revivalTry, nextDayAt: p.nextDayAt, templateId: p.templateId ? Number(p.templateId) : null };
    }
    if (key === "demo_reminder") return { minutesBefore: n(p.minutesBefore, 10, 1440, "Minutes before"), templateId: p.templateId ? Number(p.templateId) : null };
    if (key === "proposal_followup") return { days: n(p.days, 1, 30, "Days") };
    if (key === "welcome_template") return { templateId: p.templateId ? Number(p.templateId) : null, sources: (Array.isArray(p.sources) ? p.sources : []).map(String).filter((x) => /^[a-z]{2,20}$/.test(x)) };
    return {};
}

async function save(s, input = {}) {
    need(s, "automation.manage");
    const c = await config.load();
    return sequelize.transaction(async (t) => {
        let row = input.id ? await CrmRule.findByPk(Number(input.id), { transaction: t }) : null;
        if (input.id && !row) throw new RuleError("This rule no longer exists.");
        let fields;
        if (row && row.rule_key) {
            const params = cleanParams(row.rule_key, input.params || {});
            if (row.rule_key === "welcome_template" && input.active !== false && !params.templateId) throw new RuleError("Choose a template before switching this rule on.");
            fields = { params: JSON.stringify(params), active: input.active !== false, updated_by: s.user.id };
        } else {
            const r = cleanRule(input, c);
            fields = { name: r.name, description: r.description, trigger: r.trigger, conditions: JSON.stringify(r.conditions), actions: JSON.stringify(r.actions), guards: JSON.stringify(r.guards), active: input.active !== false, updated_by: s.user.id };
        }
        const before = row ? { active: row.active, params: parse(row.params), conditions: parse(row.conditions), actions: parse(row.actions) } : null;
        if (row) await row.update(fields, { transaction: t });
        else row = await CrmRule.create({ ...fields, sort: 100, created_by: s.user.id }, { transaction: t });
        await audit.write(s, { action: input.id ? "rule.update" : "rule.create", entity: "crm_rule", entityId: row.id, summary: `${input.id ? "Changed" : "Added"} the rule "${row.name}"${fields.active ? "" : " (off)"}`, before, after: fields }, { transaction: t });
        invalidate();
        return { id: row.id };
    });
}

async function setActive(s, id, active) {
    need(s, "automation.manage");
    const row = await CrmRule.findByPk(Number(id));
    if (!row) throw new RuleError("This rule no longer exists.");
    if (active && row.rule_key === "welcome_template" && !(parse(row.params) || {}).templateId) throw new RuleError("Choose a template before switching this rule on.");
    await sequelize.transaction(async (t) => {
        await row.update({ active: !!active, updated_by: s.user.id }, { transaction: t });
        await audit.write(s, { action: "rule.toggle", entity: "crm_rule", entityId: row.id, summary: `Switched the rule "${row.name}" ${active ? "on" : "off"}` }, { transaction: t });
    });
    invalidate();
    return { id: row.id, active: !!active };
}

async function remove(s, id) {
    need(s, "automation.manage");
    const row = await CrmRule.findByPk(Number(id));
    if (!row) throw new RuleError("This rule no longer exists.");
    if (row.rule_key) throw new RuleError("Built-in rules cannot be deleted; switch them off instead.");
    await sequelize.transaction(async (t) => {
        await row.destroy({ transaction: t });
        await audit.write(s, { action: "rule.delete", entity: "crm_rule", entityId: row.id, summary: `Deleted the rule "${row.name}"` }, { transaction: t });
    });
    invalidate();
    return { ok: true };
}

/** "Dry run": how many leads the rule would act on right now (timers) or did in the last 7 days (events). */
async function preview(s, input = {}) {
    need(s, "automation.manage");
    const c = await config.load();
    const now = new Date();
    const wh = await workingHours();
    const key = input.key || null;
    const timers = await settings.read("timers");
    const sample = (rows) => rows.slice(0, 10).map((l) => ({ id: l.id, name: l.name || l.phone, restaurant: l.restaurant_name || "" }));
    if (key === "first_contact") {
        const rows = await CrmLeadV2.findAll({ where: { stage_id: c.stageByKey.get("new").id, first_contact_at: null, deleted_at: null, merged_into_id: null, response_due_at: { [Op.lt]: now } }, attributes: ["id", "name", "phone", "restaurant_name"], limit: 500, raw: true });
        return { count: rows.length, text: `${rows.length} new leads are past their first-contact time right now`, leads: sample(rows) };
    }
    if (key === "overdue_escalation") {
        const tasks = await CrmTaskV2.findAll({ where: { status: "open", due_at: { [Op.lt]: now } }, attributes: ["lead_id", "due_at"], limit: 5000, raw: true });
        const late = tasks.filter((x) => workingMinutesBetween(wh, x.due_at, now) >= timers.overdueToManagerMinutes);
        const ids = [...new Set(late.map((x) => x.lead_id))];
        const rows = await CrmLeadV2.findAll({ where: { id: ids.slice(0, 500), stage_id: c.openStageIds }, attributes: ["id", "name", "phone", "restaurant_name"], raw: true });
        return { count: rows.length, text: `${rows.length} open leads have a next action overdue by ${timers.overdueToManagerMinutes}+ working minutes`, leads: sample(rows) };
    }
    if (key === "proposal_followup") {
        const days = Number((input.params || {}).days) || 2;
        const rows = await CrmLeadV2.findAll({ where: { stage_id: c.stageByKey.get("proposal")?.id || 0, deleted_at: null, merged_into_id: null, [Op.or]: [{ last_activity_at: { [Op.lt]: new Date(now - days * 86400000) } }, { last_activity_at: null }] }, attributes: ["id", "name", "phone", "restaurant_name"], limit: 500, raw: true });
        return { count: rows.length, text: `${rows.length} leads in Proposal have had no activity for ${days} days`, leads: sample(rows) };
    }
    if (key === "demo_reminder") {
        const n = await CrmTaskV2.count({ where: { type: "demo", status: "open", due_at: { [Op.gt]: now } } });
        return { count: n, text: `${n} demos are booked ahead`, leads: [] };
    }
    if (key) return { count: null, text: "This rule acts when its event happens.", leads: [] };
    // A custom event rule: the last 7 days of its trigger against today's leads.
    const r = cleanRule(input, c);
    const evs = await CrmEvent.findAll({ where: { type: r.trigger, createdAt: { [Op.gte]: new Date(now - 7 * 86400000) } }, order: [["id", "DESC"]], limit: 2000 });
    const seen = new Map();
    for (const ev of evs) {
        const data = parse(ev.data) || {};
        const leadId = ev.entity === "crm_lead" ? Number(ev.entity_id) : Number(data.leadId) || null;
        if (!leadId || seen.has(leadId)) continue;
        const lead = await CrmLeadV2.findByPk(leadId);
        if (lead && !lead.deleted_at && (await matches({ conditions: r.conditions }, lead, ev, data))) seen.set(leadId, lead);
    }
    const rows = [...seen.values()];
    return { count: rows.length, text: `In the last 7 days this rule would have run for ${rows.length} lead${rows.length === 1 ? "" : "s"}`, leads: sample(rows) };
}

async function runLog(s, query = {}) {
    need(s, "automation.manage");
    const where = {};
    if (query.ruleId) where.rule_id = Number(query.ruleId);
    if (query.before) where.id = { [Op.lt]: Number(query.before) };
    const rows = await CrmRuleRun.findAll({ where, order: [["id", "DESC"]], limit: 100, raw: true });
    const leads = new Map((await CrmLeadV2.findAll({ where: { id: [...new Set(rows.map((r) => r.lead_id).filter(Boolean))] }, attributes: ["id", "name", "phone"], raw: true })).map((l) => [l.id, l.name || l.phone]));
    const names = new Map((await rules()).map((r) => [r.id, r.name]));
    return { runs: rows.map((r) => ({ id: r.id, ruleId: r.rule_id, rule: names.get(r.rule_id) || "", leadId: r.lead_id, lead: leads.get(r.lead_id) || "", result: r.result, details: r.details, at: r.at })) };
}

worker.subscribe("*", (ev, data) => onEvent(ev, data).catch((e) => console.error("[crm rules] event", ev.id, e && e.message)));
worker.registerJob("crm.automation", timerJob);
worker.registerSchedule("crm.automation", 60);
worker.registerJob("crm.demo_reminder", demoReminderJob);
worker.registerJob("crm.rule_template", async ({ ruleId, leadId, templateId }) => {
    const rule = (await rules()).find((r) => r.id === ruleId);
    const lead = await CrmLeadV2.findByPk(leadId);
    if (!rule || !rule.active || !lead) return "rule off or lead gone";
    const c = await config.load();
    if (c.stageById.get(lead.stage_id)?.kind !== "open") return "lead closed";
    const r = await sendLeadTemplate(lead, templateId, { ruleId: rule.id });
    await log(rule, lead.id, r.skipped ? "skipped" : "done", r.skipped ? r.reason : `sent ${r.sent} (waited for sending hours)`);
    return r.skipped ? r.reason : "sent";
});

module.exports = { BUILTIN, TRIGGERS, ensureDefaults, rules, ruleOn, builtin, invalidate, onEvent, list, save, setActive, remove, preview, runLog, managersOf, admins, sendLeadTemplate, demoReminders, proposalFollowups, matches };
