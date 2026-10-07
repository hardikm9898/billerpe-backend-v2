const { Op } = require("sequelize");
const { sequelize, CrmCampaign, CrmCampaignRcpt, CrmWaTemplate, CrmWaOptout, CrmWaChat, CrmLeadV2, AdmUser } = require("../../model");
const { RuleError } = require("../../appv1/core");
const worker = require("../../services/admin/worker");
const audit = require("../audit");
const { need } = require("../auth");
const config = require("./config");
const wa = require("./wa");
const { txt, parse, moment, TZ } = require("./util");

// Campaigns: one approved template to a filtered list of leads, sent by the
// worker at a steady rate inside the template sending hours. Opt-outs are
// skipped; delivery, read and reply are counted from the WhatsApp webhook.

const BANDS = { hot: { [Op.gte]: 60 }, warm: { [Op.gte]: 30, [Op.lt]: 60 }, cold: { [Op.lt]: 30 } };

function cleanAudience(a = {}, c) {
    const arr = (v) => (Array.isArray(v) ? [...new Set(v.map(String))] : []);
    const date = (v) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "");
    return {
        stages: arr(a.stages).filter((k) => c.stageByKey.has(k)),
        sources: arr(a.sources).filter((x) => /^[a-z]{2,20}$/.test(x)),
        bands: arr(a.bands).filter((x) => BANDS[x]),
        owners: arr(a.owners).filter((x) => /^\d+$/.test(x) || x === "none"),
        cities: arr(a.cities).map((x) => x.trim().slice(0, 60)).filter(Boolean),
        quietDays: Math.max(0, Math.min(3650, Number(a.quietDays) || 0)),
        createdFrom: date(a.createdFrom),
        createdTo: date(a.createdTo),
    };
}

function audienceWhere(a, c) {
    const where = { deleted_at: null, merged_into_id: null, phone_valid: true };
    where.stage_id = a.stages.length ? a.stages.map((k) => c.stageByKey.get(k).id) : c.openStageIds;
    if (a.sources.length) where.source = a.sources;
    if (a.bands.length) where[Op.and] = [{ [Op.or]: a.bands.map((b) => ({ score: BANDS[b] })) }];
    if (a.owners.length) {
        const ids = a.owners.filter((x) => x !== "none").map(Number);
        where[Op.and] = [...(where[Op.and] || []), { [Op.or]: [...(ids.length ? [{ owner_id: ids }] : []), ...(a.owners.includes("none") ? [{ owner_id: null }] : [])] }];
    }
    if (a.cities.length) where.city = a.cities;
    if (a.quietDays) where[Op.and] = [...(where[Op.and] || []), { [Op.or]: [{ last_activity_at: { [Op.lt]: new Date(Date.now() - a.quietDays * 86400000) } }, { last_activity_at: null }] }];
    if (a.createdFrom || a.createdTo) {
        where.createdAt = {};
        if (a.createdFrom) where.createdAt[Op.gte] = moment.tz(a.createdFrom, TZ).startOf("day").toDate();
        if (a.createdTo) where.createdAt[Op.lt] = moment.tz(a.createdTo, TZ).add(1, "day").startOf("day").toDate();
    }
    return where;
}

async function audienceLeads(a, c, limit = null) {
    return CrmLeadV2.findAll({ where: audienceWhere(a, c), attributes: ["id", "name", "phone", "phone_key", "restaurant_name", "city", "owner_id"], order: [["id", "ASC"]], ...(limit ? { limit } : {}), raw: true });
}

/** How many leads the filter reaches, minus opt-outs, with a sample. */
async function preview(s, input = {}) {
    need(s, "campaigns.send");
    const c = await config.load();
    const a = cleanAudience(input.audience, c);
    const leads = await audienceLeads(a, c);
    const keys = [...new Set(leads.map((l) => l.phone_key))];
    const out = new Set((await CrmWaOptout.findAll({ where: { phone_key: keys.slice(0, 20000) }, attributes: ["phone_key"], raw: true })).map((o) => o.phone_key));
    const reach = keys.filter((k) => !out.has(k)).length;
    const perMinute = Math.max(1, Math.min(120, Number(input.perMinute) || 30));
    return { leads: leads.length, numbers: keys.length, optedOut: out.size, reach, minutes: Math.ceil(reach / perMinute), sample: leads.slice(0, 8).map((l) => ({ id: l.id, name: l.name || l.phone, restaurant: l.restaurant_name, city: l.city })) };
}

async function save(s, input = {}) {
    need(s, "campaigns.send");
    const c = await config.load();
    const name = txt(input.name, 120);
    if (!name) throw new RuleError("Give the campaign a name.");
    const tpl = input.templateId ? await CrmWaTemplate.findByPk(Number(input.templateId)) : null;
    if (!tpl || !tpl.active) throw new RuleError("Choose an active template.");
    const defs = parse(tpl.params) || [];
    const values = (Array.isArray(input.values) ? input.values : []).slice(0, defs.length).map((v) => txt(v, 200));
    const perMinute = Math.max(1, Math.min(120, Number(input.perMinute) || 30));
    const audience = cleanAudience(input.audience, c);
    return sequelize.transaction(async (t) => {
        let row = input.id ? await CrmCampaign.findByPk(Number(input.id), { transaction: t }) : null;
        if (input.id && !row) throw new RuleError("This campaign no longer exists.");
        if (row && row.status !== "draft") throw new RuleError("Only a draft can be changed.");
        const fields = { name, template_id: tpl.id, params: JSON.stringify(values), audience: JSON.stringify(audience), per_minute: perMinute };
        if (row) await row.update(fields, { transaction: t });
        else row = await CrmCampaign.create({ ...fields, status: "draft", created_by: s.user.id }, { transaction: t });
        return { id: row.id };
    });
}

/** Freezes the list of numbers and starts (now or at a time). */
async function start(s, id, input = {}) {
    need(s, "campaigns.send");
    const row = await CrmCampaign.findByPk(Number(id));
    if (!row) throw new RuleError("This campaign no longer exists.");
    if (row.status !== "draft") throw new RuleError("This campaign has already started.");
    const at = input.at ? new Date(input.at) : new Date();
    if (Number.isNaN(at.getTime())) throw new RuleError("Choose when to send.");
    const c = await config.load();
    const a = cleanAudience(parse(row.audience) || {}, c);
    const leads = await audienceLeads(a, c);
    if (!leads.length) throw new RuleError("No lead matches this audience.");
    if (leads.length > 20000) throw new RuleError("Over 20,000 leads match: narrow the audience.");
    const out = new Set((await CrmWaOptout.findAll({ where: { phone_key: [...new Set(leads.map((l) => l.phone_key))] }, attributes: ["phone_key"], raw: true })).map((o) => o.phone_key));
    const tpl = await CrmWaTemplate.findByPk(row.template_id);
    return sequelize.transaction(async (t) => {
        const seen = new Set();
        const rows = [];
        for (const l of leads) {
            if (seen.has(l.phone_key)) continue;
            seen.add(l.phone_key);
            const n = wa.waNumber(l.phone);
            rows.push({ campaign_id: row.id, lead_id: l.id, phone_key: l.phone_key, phone: n ? n.digits : String(l.phone).replace(/\D/g, ""), status: out.has(l.phone_key) ? "skipped" : "queued", error: out.has(l.phone_key) ? "opted out" : null });
        }
        for (let i = 0; i < rows.length; i += 500) await CrmCampaignRcpt.bulkCreate(rows.slice(i, i + 500), { transaction: t, ignoreDuplicates: true });
        await row.update({ status: "scheduled", scheduled_at: at, total: rows.length }, { transaction: t });
        await audit.write(s, { action: "campaign.start", entity: "crm_campaign", entityId: row.id, summary: `Started the campaign "${row.name}": template ${tpl ? tpl.name : ""} to ${rows.length} numbers${at > new Date(Date.now() + 60000) ? ` at ${moment(at).tz(TZ).format("D MMM h:mm A")}` : ""}` }, { transaction: t });
        return { id: row.id, total: rows.length, skipped: rows.filter((r) => r.status === "skipped").length };
    });
}

async function setStatus(s, id, action) {
    need(s, "campaigns.send");
    const row = await CrmCampaign.findByPk(Number(id));
    if (!row) throw new RuleError("This campaign no longer exists.");
    const next = { pause: ["sending", "scheduled"].includes(row.status) ? "paused" : null, resume: row.status === "paused" ? "sending" : null, cancel: ["draft", "scheduled", "sending", "paused"].includes(row.status) ? "cancelled" : null }[action];
    if (!next) throw new RuleError("That cannot be done now.");
    await sequelize.transaction(async (t) => {
        await row.update({ status: next, ...(next === "cancelled" ? { finished_at: new Date() } : {}) }, { transaction: t });
        if (next === "cancelled") await CrmCampaignRcpt.update({ status: "skipped", error: "campaign cancelled" }, { where: { campaign_id: row.id, status: "queued" }, transaction: t });
        await audit.write(s, { action: `campaign.${action}`, entity: "crm_campaign", entityId: row.id, summary: `${action === "pause" ? "Paused" : action === "resume" ? "Resumed" : "Cancelled"} the campaign "${row.name}"` }, { transaction: t });
    });
    return { status: next };
}

async function counts(campaignId) {
    const rows = await CrmCampaignRcpt.findAll({ where: { campaign_id: campaignId }, attributes: ["status", [sequelize.fn("COUNT", sequelize.col("id")), "n"]], group: ["status"], raw: true });
    const by = Object.fromEntries(rows.map((r) => [r.status, Number(r.n)]));
    const replied = await CrmCampaignRcpt.count({ where: { campaign_id: campaignId, replied_at: { [Op.ne]: null } } });
    const sent = (by.sent || 0) + (by.delivered || 0) + (by.read || 0);
    return { queued: by.queued || 0, sent, delivered: (by.delivered || 0) + (by.read || 0), read: by.read || 0, failed: by.failed || 0, skipped: by.skipped || 0, replied };
}

function view(row, tplName, n, who) {
    return { id: row.id, name: row.name, templateId: row.template_id, template: tplName || "", values: parse(row.params) || [], audience: parse(row.audience) || {}, status: row.status, scheduledAt: row.scheduled_at, startedAt: row.started_at, finishedAt: row.finished_at, perMinute: row.per_minute, total: row.total, counts: n, createdBy: who || "", createdAt: row.createdAt, legacy: !!row.legacy_id };
}

async function list(s) {
    need(s, "campaigns.send");
    const rows = await CrmCampaign.findAll({ order: [["id", "DESC"]], limit: 100 });
    const tpls = new Map((await CrmWaTemplate.findAll({ attributes: ["id", "name"], raw: true })).map((t) => [t.id, t.name]));
    const who = new Map((await AdmUser.findAll({ where: { id: [...new Set(rows.map((r) => r.created_by).filter(Boolean))] }, attributes: ["id", "name"], raw: true })).map((u) => [u.id, u.name]));
    const out = [];
    for (const r of rows) out.push(view(r, tpls.get(r.template_id), await counts(r.id), who.get(r.created_by)));
    return { campaigns: out, live: wa.live() };
}

async function detail(s, id, query = {}) {
    need(s, "campaigns.send");
    const row = await CrmCampaign.findByPk(Number(id));
    if (!row) throw new RuleError("This campaign no longer exists.");
    const tpl = row.template_id ? await CrmWaTemplate.findByPk(row.template_id) : null;
    const where = { campaign_id: row.id, ...(query.status ? (query.status === "replied" ? { replied_at: { [Op.ne]: null } } : { status: query.status }) : {}) };
    const page = Math.max(1, Number(query.page) || 1);
    const rcpts = await CrmCampaignRcpt.findAll({ where, order: [["id", "ASC"]], limit: 50, offset: (page - 1) * 50, raw: true });
    const total = await CrmCampaignRcpt.count({ where });
    const leads = new Map((await CrmLeadV2.findAll({ where: { id: rcpts.map((r) => r.lead_id).filter(Boolean) }, attributes: ["id", "name", "restaurant_name"], raw: true })).map((l) => [l.id, l]));
    return {
        campaign: view(row, tpl ? tpl.name : "", await counts(row.id)),
        templateBody: tpl ? wa.fillBody(tpl.body, parse(row.params) || []) : "",
        recipients: rcpts.map((r) => ({ id: r.id, leadId: r.lead_id, name: leads.get(r.lead_id)?.name || `+${r.phone}`, restaurant: leads.get(r.lead_id)?.restaurant_name || "", status: r.status, error: r.error, sentAt: r.sent_at, readAt: r.read_at, repliedAt: r.replied_at })),
        total,
        page,
    };
}

/* ------------------------------ sending (worker) ------------------------------ */

async function sendDue(now = new Date()) {
    await CrmCampaign.update({ status: "sending", started_at: now }, { where: { status: "scheduled", scheduled_at: { [Op.lte]: now } } });
    const sending = await CrmCampaign.findAll({ where: { status: "sending" } });
    let sentNow = 0;
    for (const camp of sending) {
        const w = await wa.templateWindow(now);
        if (!w.open) continue;
        const tpl = await CrmWaTemplate.findByPk(camp.template_id);
        if (!tpl || !tpl.active) {
            await camp.update({ status: "paused" });
            continue;
        }
        const fixed = parse(camp.params) || [];
        const batch = await CrmCampaignRcpt.findAll({ where: { campaign_id: camp.id, status: "queued" }, order: [["id", "ASC"]], limit: camp.per_minute });
        for (const r of batch) {
            try {
                const lead = r.lead_id ? await CrmLeadV2.findByPk(r.lead_id) : null;
                const owner = lead && lead.owner_id ? await AdmUser.findByPk(lead.owner_id, { attributes: ["id", "name", "mobile"] }) : null;
                const chat = await wa.chatFor(r.phone);
                if (chat.kind === "lead" && lead && chat.lead_id !== lead.id) await chat.update({ lead_id: lead.id });
                const res = await wa.sendTemplate(chat, tpl, await wa.paramValues(tpl, { lead, owner, overrides: fixed }), { sender: "campaign", campaignId: camp.id, now });
                if (res.skipped) await r.update({ status: "skipped", error: txt(res.reason, 300) });
                else if (res.message.status === "failed") await r.update({ status: "failed", error: res.message.error, wa_id: res.message.wa_id });
                else {
                    await r.update({ status: "sent", wa_id: res.message.wa_id, sent_at: now });
                    sentNow += 1;
                }
            } catch (e) {
                await r.update({ status: "failed", error: txt(e.message, 300) });
            }
        }
        if (!(await CrmCampaignRcpt.count({ where: { campaign_id: camp.id, status: "queued" } }))) await camp.update({ status: "done", finished_at: now });
    }
    return sentNow;
}

/** A reply within 7 days of a campaign message counts for that campaign. */
async function onEvent(ev, data) {
    if (ev.type !== "wa.received" || !data || data.optout) return;
    const chat = await CrmWaChat.findByPk(Number(ev.entity_id), { attributes: ["phone_key"] });
    if (!chat) return;
    await CrmCampaignRcpt.update({ replied_at: new Date() }, { where: { phone_key: chat.phone_key, replied_at: null, sent_at: { [Op.gte]: new Date(Date.now() - 7 * 86400000) } } });
}

worker.registerJob("crm.campaigns", () => sendDue().then((n) => `${n} sent`));
worker.registerSchedule("crm.campaigns", 60);
worker.subscribe("wa.received", (ev, data) => onEvent(ev, data).catch((e) => console.error("[crm campaigns] event", ev.id, e && e.message)));

module.exports = { preview, save, start, setStatus, list, detail, sendDue, counts, cleanAudience, audienceWhere };
