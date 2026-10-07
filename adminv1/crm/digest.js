const { Op } = require("sequelize");
const { CrmTaskV2, CrmLeadV2, CrmEscalation, CrmWaTemplate, AdmUser, AdmRole } = require("../../model");
const worker = require("../../services/admin/worker");
const settings = require("../settings");
const perms = require("../permissions");
const config = require("./config");
const wa = require("./wa");
const { notify } = require("./notify");
const { workingHours, todayRange, moment, TZ } = require("./util");

// The morning digest (design doc: "a 9:30 am daily digest per person"): on
// working days, each salesperson gets overdue / due today / new waiting /
// escalations in the panel and, once Meta approves the staff template, on
// WhatsApp (owner chose both, 7 Oct 2026).

/** The WhatsApp template the owner submits to Meta (Settings > Digest shows it). */
const TEMPLATE_TEXT = "Good morning {{1}}! Your BillerPe sales day: {{2}} overdue, {{3}} due today, {{4}} new leads waiting. Open My Day: https://admin.billerpe.in";

async function numbersFor(userId, now = new Date()) {
    const c = await config.load();
    const { end } = todayRange(now);
    const overdue = await CrmTaskV2.count({ where: { owner_id: userId, status: "open", due_at: { [Op.lt]: now } } });
    const today = await CrmTaskV2.count({ where: { owner_id: userId, status: "open", due_at: { [Op.gte]: now, [Op.lt]: end } } });
    const fresh = await CrmLeadV2.count({ where: { owner_id: userId, stage_id: c.stageByKey.get("new")?.id || 0, first_contact_at: null, deleted_at: null, merged_into_id: null } });
    const esc = await CrmEscalation.count({ where: { status: "open", to_ids: { [Op.like]: `%,${userId},%` } } });
    return { overdue, today, fresh, esc };
}

/** Job crm.digest (every 5 minutes): sends today's digest once, after the set time on working days. */
async function run(now = new Date(), { force = false } = {}) {
    const d = await settings.read("digest");
    if (!d.enabled && !force) return "off";
    const wh = await workingHours();
    const m = moment(now).tz(TZ);
    if (!force && (!wh.days.includes(m.day()) || m.format("HH:mm") < d.time)) return "not yet";
    const roles = (await AdmRole.findAll({ raw: true })).filter((r) => perms.can(perms.parse(r.permissions), "leads.edit")).map((r) => r.id);
    const people = await AdmUser.findAll({ where: { status: "active", role_id: roles }, raw: true });
    const tpl = d.whatsapp ? await CrmWaTemplate.findOne({ where: { name: d.templateName, active: true } }) : null;
    const date = m.format("YYYY-MM-DD");
    let sent = 0;
    for (const p of people) {
        const n = await numbersFor(p.id, now);
        if (!n.overdue && !n.today && !n.fresh && !n.esc) continue;
        const parts = [`${n.overdue} overdue`, `${n.today} due today`, `${n.fresh} new waiting`, ...(n.esc ? [`${n.esc} escalation${n.esc === 1 ? "" : "s"}`] : [])];
        const row = await notify(p.id, { type: "digest", title: `Your day: ${parts.join(", ")}`, body: "Open My Day to start with the oldest overdue.", link: "/", ref: `digest:${date}` });
        if (!row) continue;
        sent += 1;
        if (tpl && p.mobile) {
            try {
                const chat = await wa.chatFor(p.mobile, { name: p.name });
                await wa.sendTemplate(chat, tpl, [p.name.split(/\s+/)[0], String(n.overdue), String(n.today), String(n.fresh)], { sender: "system" });
            } catch (e) {
                console.error("[crm digest] whatsapp:", e && e.message);
            }
        }
    }
    return `${sent} digests`;
}

worker.registerJob("crm.digest", () => run());
worker.registerSchedule("crm.digest", 300);

module.exports = { run, numbersFor, TEMPLATE_TEXT };
