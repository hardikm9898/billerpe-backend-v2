// Moves the old SuperAdmin CRM (live_backup1) and the v2 website leads
// (local_billerpe crm_lead_msts) into the new sales CRM (crm_leads ...).
//
//   node scripts/migrate-old-crm.js [--source-env .env.production] [--source-db live_backup1]
//        [--v2-db local_billerpe | --v2-db none] [--start YYYY-MM-DD (default: next working day)] [--create-staff] [--commit]
//
// Reads the source READ-ONLY (its own connection, SET SESSION TRANSACTION
// READ ONLY). Writes to the database of the current .env (DATABASE_NAME).
// Without --commit it writes nothing and prints what it would do.
// Safe to run again: every copied row carries legacy_id and is skipped the
// second time.
//
// Rules (design doc: Migration of the old CRM data):
// - One lead per phone number: duplicates are joined; the most advanced
//   one (won > furthest open stage > lost; then newest) keeps the lead, the
//   others become inquiries and their timelines are added to it.
// - Old status -> new stage + lost reason (table below); revisit dates that
//   are already past are spread over the next 30 days.
// - Staff: old employees are matched to SuperAdmin logins by mobile.
//   --create-staff adds the missing ones (temporary passwords printed once).
// - Next actions: open leads touched by a person in the last 30 days get a
//   call, spread over the coming working days (30 per person per day, most
//   advanced first); older or never-touched ones join the "Revival of old
//   leads" cadence (60 per person per day start) with a call task to decide
//   after it ends. An open migrated task in the future is kept.
// - WhatsApp (phase 3): the inbox (wa_agent_conversations / messages), the
//   approved templates and the campaigns with their recipients. Old drips
//   are not moved (they stopped on 8 Sep 2026; cadences replace them).

const path = require("path");
const args = process.argv.slice(2);
const opt = (n, d) => {
    const i = args.indexOf(`--${n}`);
    return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : d;
};
const COMMIT = args.includes("--commit");
const CREATE_STAFF = args.includes("--create-staff");
const SOURCE_ENV = path.resolve(opt("source-env", ".env.production"));
const SOURCE_DB = opt("source-db", "live_backup1");
const V2_DB = opt("v2-db", "local_billerpe");

require("dotenv").config();
const fs = require("fs");
const mysql = require("mysql2/promise");
const bcrypt = require("bcrypt");
const { Op } = require("sequelize");
const dotenv = require("dotenv");
const M = require("../model");
const config = require("../adminv1/crm/config");
const { ensureDefaultRoles } = require("../adminv1/permissions");
const { tempPassword } = require("../adminv1/auth");
const { normalizePhone, moment, TZ } = require("../adminv1/crm/util");
const settings = require("../adminv1/settings");
const { syncNext } = require("../adminv1/crm/tasks");
const { recalc } = require("../adminv1/crm/leads");
const cadences = require("../adminv1/crm/cadences");
const wa = require("../adminv1/crm/wa");

const STATUS = {
    NEW: ["new"], ASSIGNED: ["new"],
    CALL_NOT_RECEIVED_WH_SENT: ["new", "no_answer"], CALL_SWITCHED_OFF_WH_SHARED: ["new", "switched_off"],
    CHAT_ONGOING_WHATSAPP: ["contacted", "whatsapp"], POSITIVE_DETAILS_NOT_SHARED: ["contacted", "interested"], SEMI_INTERESTED: ["contacted", "interested"],
    BUSINESS_DETAILS_PENDING: ["contacted", "interested"], CALLBACK_REQUESTED: ["contacted", "callback"],
    POSITIVE_DETAILS_SHARED: ["qualified", "interested"], INTERESTED_DETAILS_SHARED: ["qualified", "interested"], INTERESTED_DEMO_PENDING: ["qualified", "interested"],
    DEMO_SCHEDULED: ["demo", "demo_booked"], DEMO_COMPLETED: ["demo", "demo_done"],
    PAYMENT_PENDING: ["proposal"], BUDGET_ISSUE_OFFER_SHARED: ["proposal"], NEED_FULL_COD: ["proposal"],
    PURCHASED_BILLERPE: ["won"],
    BUDGET_ISSUE: ["lost", null, "budget"], EXISTING_SOFTWARE_CONTINUE: ["lost", null, "staying"], PURCHASED_FROM_COMPETITOR: ["lost", null, "competitor"],
    NOT_INTERESTED: ["lost", null, "not_interested"], NOT_INTO_FNB: ["lost", null, "not_restaurant"], WRONG_INVALID_NUMBER: ["lost", null, "wrong_number"],
};
const STATUS_LABEL = (s) => String(s || "").toLowerCase().replace(/_/g, " ").replace(/\bwh\b/, "WhatsApp");
const TASK_TYPE = { new_lead_followup: "call", callback_followup: "call", provide_demo: "demo", payment_followup: "payment" };
const ROLE_FOR = { manager: "Sales manager", calling_executive: "Sales executive", demo_executive: "Sales executive", followup_executive: "Sales executive", onboarding_executive: "Customer success", support_executive: "Support" };
const mobile10 = (v) => String(v ?? "").replace(/\D/g, "").slice(-10);

function log(...a) {
    console.log(...a);
}

async function readSource() {
    const env = dotenv.parse(fs.readFileSync(SOURCE_ENV));
    const c = await mysql.createConnection({ host: env.DATABASE_HOST, user: env.DATABASE_ID, password: env.DATABASE_PASSWORD, connectTimeout: 20000, dateStrings: false });
    await c.query("SET SESSION TRANSACTION READ ONLY");
    const q = async (sql) => (await c.query(sql))[0];
    const db = SOURCE_DB;
    const src = {
        leads: await q(`SELECT * FROM \`${db}\`.crm_lead_msts WHERE deleted = 0 ORDER BY id`),
        activities: await q(`SELECT * FROM \`${db}\`.crm_lead_activity_msts ORDER BY id`),
        tasks: await q(`SELECT * FROM \`${db}\`.crm_task_msts WHERE lead_id IS NOT NULL ORDER BY id`),
        calls: await q(`SELECT * FROM \`${db}\`.crm_call_log_msts ORDER BY id`),
        demos: await q(`SELECT * FROM \`${db}\`.crm_demo_schedule_msts ORDER BY id`),
        assignments: await q(`SELECT * FROM \`${db}\`.crm_lead_assignment_history_msts ORDER BY id`),
        employees: await q(`SELECT e.*, u.name AS user_name, u.number AS user_number FROM \`${db}\`.crm_employee_profile_msts e LEFT JOIN \`${db}\`.hms_superAdmin_users u ON u.id = e.superAdmin_user_id`),
        v2: V2_DB === "none" ? [] : await q(`SELECT * FROM \`${V2_DB}\`.crm_lead_msts WHERE deleted = 0 ORDER BY id`),
        waChats: await q(`SELECT * FROM \`${db}\`.wa_agent_conversations ORDER BY id`),
        waMessages: await q(`SELECT * FROM \`${db}\`.wa_agent_messages ORDER BY id`),
        waTemplates: await q(`SELECT * FROM \`${db}\`.hms_whatsapp_template_msts ORDER BY id`),
        campaigns: await q(`SELECT * FROM \`${db}\`.crm_whatsapp_campaign_msts ORDER BY id`),
        recipients: await q(`SELECT * FROM \`${db}\`.crm_campaign_recipient_msts ORDER BY id`),
    };
    await c.end();
    return src;
}

/* ---------- WhatsApp (phase 3) ---------- */

const msgKind = (t) => (["text", "image", "document", "audio", "video", "template", "reaction", "sticker", "location"].includes(t) ? t : "text");
const tsDate = (v) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? new Date(n < 1e12 ? n * 1000 : n) : null;
};
const jsonArr = (v) => {
    if (Array.isArray(v)) return v;
    try {
        const j = JSON.parse(v || "[]");
        return Array.isArray(j) ? j : [];
    } catch {
        return [];
    }
};

function planWhatsApp(src) {
    const lastBy = new Map();
    for (const m of src.waMessages) lastBy.set(normalizePhone(m.phone).key, m);
    const lastWeek = Date.now() - 7 * 86400000;
    let waiting = 0;
    for (const m of lastBy.values()) if (m.direction === "inbound" && (tsDate(m.ts) || 0) > lastWeek) waiting += 1;
    log(`  WhatsApp: ${src.waChats.length} chats (${waiting} waiting for a reply from the last 7 days), ${src.waMessages.length} messages, templates ${src.waTemplates.map((t) => t.name).join(", ")}, ${src.campaigns.length} campaigns`);
}

async function writeTemplates(src) {
    const map = new Map();
    for (const t of src.waTemplates) {
        const legacy = `lb1tp:${t.id}`;
        let row = (await M.CrmWaTemplate.findOne({ where: { legacy_id: legacy } })) || (await M.CrmWaTemplate.findOne({ where: { name: t.name, language: "en" } }));
        const params = jsonArr(t.params).map((p) => ({ label: p.label || p.name || "Value", source: p.name === "name" ? "lead.name" : "custom", value: "" }));
        if (!row) row = await M.CrmWaTemplate.create({ name: t.name, language: "en", category: "marketing", body: null, params: JSON.stringify(params), header_image: t.default_image ? String(t.default_image).replace(/ /g, "%20") : null, active: !!t.active && t.name !== "apitest", legacy_id: legacy });
        else if (!row.legacy_id) await row.update({ legacy_id: legacy, header_image: row.header_image || t.default_image || null });
        map.set(t.id, row.id);
    }
    log(`templates: ${map.size} (paste each approved text into Inbox > Templates so the panel can show it)`);
    return map;
}

async function writeWhatsApp(src, tplMap) {
    const byPhone = new Map();
    for (const m of src.waMessages) {
        const key = normalizePhone(m.phone).key;
        if (!byPhone.has(key)) byPhone.set(key, []);
        byPhone.get(key).push(m);
    }
    const convByKey = new Map(src.waChats.map((x) => [normalizePhone(x.phone).key, x]));
    const keys = [...new Set([...convByKey.keys(), ...byPhone.keys()])].filter((k) => k && k.length === 10);
    const lastWeek = Date.now() - 7 * 86400000;
    let chats = 0;
    let msgs = 0;
    for (const key of keys) {
        const conv = convByKey.get(key);
        const list = (byPhone.get(key) || []).slice().sort((a, b) => (tsDate(a.ts) || 0) - (tsDate(b.ts) || 0) || a.id - b.id);
        const n = wa.waNumber(conv ? conv.phone : list[0].phone);
        if (!n) continue;
        const legacy = conv ? `lb1w:${conv.id}` : null;
        let chat = await M.CrmWaChat.findOne({ where: { phone_key: key } });
        if (!chat) {
            const lead = await M.CrmLeadV2.findOne({ where: { phone_key: key, merged_into_id: null, deleted_at: null }, order: [["id", "DESC"]] });
            const who = lead ? { kind: "lead", leadId: lead.id } : (await wa.classify(key)) || { kind: "other" };
            const name = conv && conv.name && String(conv.name).replace(/\D/g, "") !== String(conv.phone).replace(/\D/g, "") ? String(conv.name).slice(0, 120) : "";
            chat = await M.CrmWaChat.create({ phone: n.digits, phone_key: key, name, kind: who.kind, label: who.label || "", lead_id: who.leadId || null, hotel_id: who.hotelId || null, legacy_id: legacy });
            chats += 1;
        } else if (legacy && !chat.legacy_id) await chat.update({ legacy_id: legacy });
        const rows = list.map((m) => {
            const out = m.direction !== "inbound";
            const kind = msgKind(m.type);
            const text = String(m.text || "");
            return {
                chat_id: chat.id,
                wa_id: /^wamid\./.test(m.messageId || "") ? String(m.messageId).slice(0, 120) : null,
                direction: out ? "out" : "in",
                kind,
                body: String(m.caption || text || "").slice(0, 4000) || null,
                template_name: kind === "template" ? (text.match(/\[Template: ([^\]]+)\]/) || [])[1] || null : null,
                media_url: m.media_url || null,
                mime_type: m.mime_type || null,
                file_name: m.file_name ? String(m.file_name).slice(0, 200) : null,
                sender: !out ? "customer" : m.is_ai ? "ai" : kind === "template" ? "rule" : "user",
                status: out ? String(m.status || "sent").slice(0, 10) : "received",
                at: tsDate(m.ts) || m.createdAt,
                legacy_id: `lb1m:${m.id}`,
                createdAt: m.createdAt || new Date(),
            };
        });
        for (let i = 0; i < rows.length; i += 500) {
            const before = await M.CrmWaMessage.count({ where: { chat_id: chat.id } });
            await M.CrmWaMessage.bulkCreate(rows.slice(i, i + 500), { ignoreDuplicates: true });
            msgs += (await M.CrmWaMessage.count({ where: { chat_id: chat.id } })) - before;
        }
        // The chat's summary from everything it now holds.
        const last = await M.CrmWaMessage.findOne({ where: { chat_id: chat.id, kind: { [Op.ne]: "note" } }, order: [["at", "DESC"], ["id", "DESC"]] });
        const lastIn = await M.CrmWaMessage.max("at", { where: { chat_id: chat.id, direction: "in" } });
        const lastOut = await M.CrmWaMessage.max("at", { where: { chat_id: chat.id, direction: "out" } });
        const waiting = !!last && last.direction === "in" && new Date(last.at).getTime() > lastWeek;
        await chat.update({
            last_in_at: lastIn || null,
            last_out_at: lastOut || null,
            last_message_at: last ? last.at : chat.last_message_at,
            preview: String((last && (last.body || `[${last.kind}]`)) || "").replace(/\s+/g, " ").slice(0, 200),
            needs_reply: waiting,
            unread: waiting ? Math.max(1, Number(conv && conv.unread) || 1) : 0,
        });
    }

    // Campaigns and who got them.
    const leadOfOld = async (oldLeadId) => {
        const inq = oldLeadId ? await M.CrmInquiry.findOne({ where: { legacy_id: `lb1:${oldLeadId}` }, attributes: ["lead_id"], raw: true }) : null;
        if (!inq) return null;
        const l = await M.CrmLeadV2.findByPk(inq.lead_id, { attributes: ["id", "merged_into_id"], raw: true });
        return l ? l.merged_into_id || l.id : null;
    };
    let camps = 0;
    for (const cp of src.campaigns) {
        const legacy = `lb1cp:${cp.id}`;
        let row = await M.CrmCampaign.findOne({ where: { legacy_id: legacy } });
        if (!row) {
            row = await M.CrmCampaign.create({
                name: String(cp.name || `Old campaign ${cp.id}`).slice(0, 120), template_id: cp.template_id ? tplMap.get(cp.template_id) || null : null, params: JSON.stringify(jsonArr(cp.param_values)),
                audience: JSON.stringify({ old: cp.lead_filter || null, message: cp.message || null }), status: "done", scheduled_at: cp.scheduled_at || cp.createdAt, started_at: cp.createdAt, finished_at: cp.updatedAt,
                total: cp.total_recipients || 0, legacy_id: legacy, createdAt: cp.createdAt,
            });
            camps += 1;
        }
        const rcpts = [];
        for (const r of src.recipients.filter((x) => x.campaign_id === cp.id)) {
            const p = normalizePhone(r.phone_number);
            const nn = wa.waNumber(r.phone_number);
            rcpts.push({
                campaign_id: row.id, lead_id: await leadOfOld(r.lead_id), phone_key: p.key || `x${r.id}`, phone: nn ? nn.digits : String(r.phone_number || "").replace(/\D/g, "").slice(0, 20),
                status: ["sent", "delivered", "read", "failed"].includes(r.status) ? r.status : r.status === "pending" ? "skipped" : "sent", error: r.error_message ? String(r.error_message).slice(0, 300) : null,
                sent_at: r.sent_at, delivered_at: r.delivered_at, read_at: r.read_at, legacy_id: `lb1cr:${r.id}`,
            });
        }
        for (let i = 0; i < rcpts.length; i += 500) await M.CrmCampaignRcpt.bulkCreate(rcpts.slice(i, i + 500), { ignoreDuplicates: true });
    }
    log(`WhatsApp: ${chats} new chats, ${msgs} messages written (a re-run writes 0), ${camps} campaigns`);
}

async function main() {
    log(`${COMMIT ? "COMMIT" : "DRY RUN (nothing is written)"} - source ${SOURCE_DB}${V2_DB !== "none" ? ` + ${V2_DB}` : ""} -> target ${process.env.DATABASE_NAME}`);
    await ensureDefaultRoles(M.AdmRole);
    await config.ensureDefaults();
    const c = await config.load(true);
    const src = await readSource();
    log(`read: ${src.leads.length} old leads, ${src.v2.length} v2 leads, ${src.activities.length} activities, ${src.tasks.length} tasks, ${src.demos.length} demos, ${src.calls.length} calls, ${src.assignments.length} assignments, ${src.employees.length} staff`);
    log(`      WhatsApp: ${src.waChats.length} chats, ${src.waMessages.length} messages, ${src.waTemplates.length} templates, ${src.campaigns.length} campaigns with ${src.recipients.length} recipients`);

    /* ---------- staff ---------- */
    const roles = Object.fromEntries((await M.AdmRole.findAll({ raw: true })).map((r) => [r.name, r.id]));
    const staff = new Map(); // old employee id -> adm_users.id
    const missing = [];
    for (const e of src.employees) {
        const m = mobile10(e.user_number);
        const u = m.length === 10 ? await M.AdmUser.findOne({ where: { mobile: m }, raw: true }) : null;
        if (u) staff.set(e.id, u.id);
        else missing.push(e);
    }
    const passwords = [];
    if (missing.length) {
        log(`staff without a SuperAdmin login: ${missing.map((e) => `${e.user_name} (${e.employee_type}${e.is_active ? "" : ", left"})`).join(", ")}`);
        if (CREATE_STAFF && COMMIT) {
            for (const e of missing) {
                const m = mobile10(e.user_number);
                if (m.length !== 10) continue;
                const pw = tempPassword();
                const u = await M.AdmUser.create({ name: e.user_name || `Staff ${e.id}`, mobile: m, role_id: roles[ROLE_FOR[e.employee_type] || "Sales executive"], password_hash: await bcrypt.hash(pw, 10), must_change_password: true, status: e.is_active ? "active" : "disabled", daily_lead_cap: e.is_active && /executive/.test(e.employee_type) ? 50 : null });
                staff.set(e.id, u.id);
                if (e.is_active) passwords.push(`${u.name} (${m}): ${pw}`);
            }
            const mgrEmp = src.employees.find((e) => e.employee_type === "manager" && e.is_active);
            if (mgrEmp && staff.get(mgrEmp.id)) {
                for (const e of src.employees) if (e.manager_id === mgrEmp.id && staff.get(e.id) && e.id !== mgrEmp.id) await M.AdmUser.update({ manager_id: staff.get(mgrEmp.id) }, { where: { id: staff.get(e.id), manager_id: null } });
            }
        } else if (!CREATE_STAFF) log("  their leads stay unassigned (the sweep gives them out). Add --create-staff to create these logins.");
        else for (const e of missing) staff.set(e.id, -e.id); // dry run: show the plan as if created
    }
    const staffName = new Map(src.employees.map((e) => [-e.id, `${e.user_name} (new login)`]));
    const nameOf = async (id) => (!id ? "(unassigned)" : id < 0 ? staffName.get(id) : (await M.AdmUser.findOne({ where: { id }, attributes: ["name"], raw: true }))?.name || `#${id}`);
    const who = (oldEmpId) => (oldEmpId ? staff.get(oldEmpId) || null : null);

    /* ---------- group by phone ---------- */
    const items = [];
    for (const l of src.leads) items.push({ kind: "lb1", legacy: `lb1:${l.id}`, row: l, phone: normalizePhone(l.phone_number), map: STATUS[l.status] || ["new"] });
    for (const l of src.v2) items.push({ kind: "v2", legacy: `v2:${l.id}`, row: l, phone: normalizePhone(l.phone_number), map: STATUS[l.status] || ["new"] });
    const rank = (it) => {
        const st = c.stageByKey.get(it.map[0]);
        return st.kind === "won" ? 1000 : st.kind === "open" ? 100 + st.sort : 10;
    };
    const groups = new Map();
    for (const it of items) {
        const key = it.phone.valid ? it.phone.key : `invalid:${it.legacy}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(it);
    }
    const actsBy = new Map();
    for (const a of src.activities) {
        if (!actsBy.has(a.lead_id)) actsBy.set(a.lead_id, []);
        actsBy.get(a.lead_id).push(a);
    }
    const tasksBy = new Map();
    for (const t of src.tasks) {
        if (!tasksBy.has(t.lead_id)) tasksBy.set(t.lead_id, []);
        tasksBy.get(t.lead_id).push(t);
    }

    const wh = await settings.read("working_hours");
    // Default: the next working day, so nothing planned is already overdue when
    // the script runs (overdue tasks would escalate to managers at once).
    const nextWorkDay = () => {
        const d = moment().tz(TZ).startOf("day").add(1, "day");
        while (!wh.days.includes(d.day())) d.add(1, "day");
        return d;
    };
    const start = opt("start") ? moment.tz(opt("start"), "YYYY-MM-DD", TZ) : nextWorkDay();
    log(`plan starts ${start.format("ddd D MMM YYYY")}${opt("start") ? "" : " (the next working day; --start YYYY-MM-DD to change)"}`);
    const report = { leads: 0, joinedDuplicates: 0, v2Joined: 0, invalidPhones: 0, stages: {}, owners: {}, already: 0, plan: { call: 0, revival: 0, kept: 0 }, revisitSpread: 0 };
    const planned = [];

    for (const [, group] of groups) {
        group.sort((a, b) => rank(b) - rank(a) || new Date(b.row.updatedAt) - new Date(a.row.updatedAt));
        const primary = group[0];
        const others = group.slice(1);
        report.leads += 1;
        report.joinedDuplicates += others.length;
        report.v2Joined += others.filter((o) => o.kind === "v2").length + (primary.kind === "v2" && others.some((o) => o.kind === "lb1") ? 1 : 0);
        if (!primary.phone.valid) report.invalidPhones += 1;
        const [stageKey, outcomeKey, reasonKey] = primary.map;
        report.stages[stageKey] = (report.stages[stageKey] || 0) + 1;
        const ownerId = primary.kind === "lb1" ? who(primary.row.assigned_to) : null;
        const ownerName = await nameOf(ownerId);
        report.owners[ownerName] = (report.owners[ownerName] || 0) + 1;

        const allActs = group.flatMap((g) => (g.kind === "lb1" ? actsBy.get(g.row.id) || [] : []));
        const human = allActs.filter((a) => a.actor_id && ["call", "note", "status_change", "demo"].includes(a.activity_type));
        const lastTouch = human.length ? new Date(Math.max(...human.map((a) => new Date(a.createdAt)))) : null;
        const firstTouch = human.length ? new Date(Math.min(...human.map((a) => new Date(a.createdAt)))) : null;
        const stage = c.stageByKey.get(stageKey);
        planned.push({ group, primary, others, stage, outcomeKey, reasonKey, ownerId, lastTouch, firstTouch });
    }

    // Next-action plan for open leads, per owner: calls 30/day, revivals 60/day, most advanced first.
    const openPlans = planned.filter((p) => p.stage.kind === "open");
    const fresh = (p) => p.lastTouch && start.diff(moment(p.lastTouch), "days") <= 30;
    const byOwner = new Map();
    for (const p of openPlans) {
        const k = `${p.ownerId || 0}`;
        if (!byOwner.has(k)) byOwner.set(k, []);
        byOwner.get(k).push(p);
    }
    const workdays = (() => {
        const out = [];
        let d = start.clone();
        while (out.length < 120) {
            if (wh.days.includes(d.day())) out.push(d.clone());
            d.add(1, "day");
        }
        return out;
    })();
    const slotTime = (dayIdx, i, perDay) => {
        const d = workdays[dayIdx];
        const [sh, sm] = wh.start.split(":").map(Number);
        const [eh, em] = wh.end.split(":").map(Number);
        const span = eh * 60 + em - (sh * 60 + sm);
        return d.clone().hour(sh).minute(sm).add(Math.floor((span * i) / perDay), "minutes").toDate();
    };
    for (const [, list] of byOwner) {
        list.sort((a, b) => b.stage.sort - a.stage.sort || (b.lastTouch || 0) - (a.lastTouch || 0));
        let ci = 0;
        let ri = 0;
        for (const p of list) {
            const futureOld = (tasksBy.get(p.primary.row.id) || []).find((t) => ["pending", "in_progress"].includes(t.status) && t.due_at && new Date(t.due_at) > start.toDate());
            if (p.primary.kind === "lb1" && futureOld) {
                p.next = null;
                report.plan.kept += 1;
            } else if (fresh(p)) {
                p.next = { type: "call", dueAt: slotTime(Math.floor(ci / 30), ci % 30, 30), note: "Follow up (moved from the old CRM)" };
                ci += 1;
                report.plan.call += 1;
            } else {
                // The revival cadence sends three WhatsApp messages over 14 days; a reply
                // becomes a call task. The lead's own next action is the decision after it.
                const day = Math.floor(ri / 60);
                p.next = { type: "call", dueAt: slotTime(Math.min(day + 13, workdays.length - 1), ri % 60, 60), note: "Revival cadence ended: call once, or close the lead", revivalStart: slotTime(day, ri % 60, 60) };
                ri += 1;
                report.plan.revival += 1;
            }
        }
    }
    const lastDay = (n, per) => (n ? workdays[Math.floor((n - 1) / per)].format("ddd D MMM") : "-");

    log("\nPlan");
    log(`  leads after joining duplicates: ${report.leads} (${report.joinedDuplicates} duplicate rows joined; ${report.v2Joined} v2 website leads matched old ones; ${report.invalidPhones} with a number that cannot be called)`);
    log(`  stages: ${Object.entries(report.stages).map(([k, v]) => `${k} ${v}`).join(", ")}`);
    log(`  owners: ${Object.entries(report.owners).map(([k, v]) => `${k} ${v}`).join(", ")}`);
    log(`  next actions: ${report.plan.call} calls, ${report.plan.revival} into the revival cadence, ${report.plan.kept} kept from the old CRM`);
    for (const [k, list] of byOwner) {
        const calls = list.filter((p) => p.next && p.next.type === "call" && !p.next.revivalStart).length;
        const rev = list.filter((p) => p.next && p.next.revivalStart).length;
        const name = await nameOf(Number(k));
        log(`    ${name}: ${calls} calls until ${lastDay(calls, 30)}, ${rev} revival starts until ${lastDay(rev, 60)}`);
    }
    planWhatsApp(src);
    if (!COMMIT) {
        log("\nDry run only. Add --commit to write.");
        return;
    }

    /* ---------- WhatsApp templates first (the revival cadence needs them) ---------- */
    const tplMap = await writeTemplates(src);
    await cadences.ensureDefaults();
    await cadences.linkDefaultTemplates();
    const revival = await M.CrmCadence.findOne({ where: { cadence_key: "revival" } });

    /* ---------- write ---------- */
    const reasonBy = c.reasonByKey;
    const outcomeBy = c.outcomeByKey;
    let n = 0;
    let revisitIdx = 0;
    for (const p of planned) {
        if (await M.CrmLeadV2.findOne({ where: { legacy_id: p.primary.legacy }, attributes: ["id"], raw: true })) {
            report.already += 1;
            continue;
        }
        await M.sequelize.transaction(async (t) => {
            const pr = p.primary.row;
            const det = {
                platform: /instagram/.test(pr.source) ? "instagram" : /facebook/.test(pr.source) ? "facebook" : undefined,
                campaign: pr.campaign_name || undefined,
                adset: pr.adset_name || undefined,
                ad: pr.ad_name || undefined,
                form: pr.lead_form_name || undefined,
                oldStatus: pr.status,
                oldPriority: pr.priority,
                from: p.primary.kind === "lb1" ? "old SuperAdmin CRM" : "v2 website form",
            };
            const reason = p.reasonKey ? reasonBy.get(p.reasonKey) : null;
            let revisit = null;
            if (reason && reason.revisit_days) {
                const base = moment(p.lastTouch || pr.updatedAt).add(reason.revisit_days, "days");
                if (base.isBefore(start)) {
                    revisit = start.clone().add(7 + (revisitIdx % 30), "days").hour(11).toDate();
                    revisitIdx += 1;
                    report.revisitSpread += 1;
                } else revisit = base.toDate();
            }
            const lead = await M.CrmLeadV2.create({
                name: String(pr.name || "").slice(0, 120),
                phone: p.primary.phone.phone,
                phone_key: p.primary.phone.key,
                phone_valid: p.primary.phone.valid,
                email: String(pr.email || "").slice(0, 120),
                source: /meta/.test(pr.source) ? "meta" : pr.source === "website" ? "website" : "manual",
                source_detail: JSON.stringify(det),
                stage_id: p.stage.id,
                owner_id: p.ownerId,
                lost_reason_id: reason ? reason.id : null,
                revisit_at: revisit,
                won_at: p.stage.kind === "won" ? pr.updatedAt : null,
                closed_at: p.stage.kind === "open" ? null : pr.updatedAt,
                first_contact_at: p.firstTouch,
                last_activity_at: p.lastTouch,
                legacy_id: p.primary.legacy,
            }, { transaction: t });
            await M.sequelize.query("UPDATE crm_leads SET createdAt = ?, updatedAt = ? WHERE id = ?", { replacements: [pr.createdAt, pr.updatedAt, lead.id], transaction: t });

            for (const g of p.group) {
                const r = g.row;
                if (!(await M.CrmInquiry.findOne({ where: { legacy_id: g.legacy }, transaction: t }))) {
                    await M.CrmInquiry.create({ lead_id: lead.id, source: /meta/.test(r.source) ? "meta" : r.source === "website" ? "website" : "manual", name: String(r.name || "").slice(0, 120), phone: String(r.phone_number || "").slice(0, 40), email: String(r.email || "").slice(0, 120), message: String(r.message || "").slice(0, 1000), received_at: r.createdAt, legacy_id: g.legacy, source_detail: JSON.stringify({ campaign: r.campaign_name || undefined, ad: r.ad_name || undefined }) }, { transaction: t });
                }
                if (g.kind !== "lb1") continue;
                const note = g === p.primary ? "" : ` (from duplicate lead lb1:${r.id})`;
                for (const a of actsBy.get(r.id) || []) {
                    const type = { call: "call", note: "note", status_change: "stage", assignment: "owner", demo: "system", task: "task", payment: "system", system: "system" }[a.activity_type] || "system";
                    const body =
                        a.activity_type === "status_change" ? `Old CRM status: ${STATUS_LABEL(a.old_value) || "-"} → ${STATUS_LABEL(a.new_value)}${a.description ? ` · ${a.description}` : ""}` :
                        a.activity_type === "assignment" ? `Old CRM: ${a.description || "assigned"}` :
                        a.description || STATUS_LABEL(a.new_value) || a.activity_type;
                    await M.CrmActivity.create({ lead_id: lead.id, type, actor_id: who(a.actor_id), body: `${body}${note}`.slice(0, 1000), data: JSON.stringify({ legacyType: a.activity_type, old: a.old_value, new: a.new_value }), at: a.createdAt, legacy_id: `lb1a:${a.id}` }, { transaction: t });
                }
                for (const ot of tasksBy.get(r.id) || []) {
                    const open = ["pending", "in_progress"].includes(ot.status) && p.stage.kind === "open" && ot.due_at && new Date(ot.due_at) > start.toDate();
                    await M.CrmTaskV2.create({ lead_id: lead.id, owner_id: who(ot.assigned_to) || p.ownerId, type: TASK_TYPE[ot.task_type] || "other", note: String(ot.notes || ot.task_type.replace(/_/g, " ")).slice(0, 300), due_at: ot.due_at || ot.createdAt, status: open ? "open" : ot.status === "completed" ? "done" : "cancelled", done_at: open ? null : ot.completed_at || ot.updatedAt, origin: "migration", legacy_id: `lb1t:${ot.id}` }, { transaction: t });
                }
                for (const d of src.demos.filter((x) => x.lead_id === r.id)) {
                    await M.CrmActivity.create({ lead_id: lead.id, type: "system", actor_id: who(d.executive_id), body: `Old CRM demo ${d.outcome || "scheduled"} for ${moment(d.scheduled_at).tz(TZ).format("D MMM YYYY, h:mm A")}${d.notes ? ` · ${d.notes}` : ""}`, at: d.createdAt, legacy_id: `lb1d:${d.id}` }, { transaction: t });
                }
                for (const cl of src.calls.filter((x) => x.lead_id === r.id)) {
                    await M.CrmCall.create({ lead_id: lead.id, user_id: who(cl.caller_id), source: "typed", direction: cl.direction === "inbound" ? "in" : "out", phone: p.primary.phone.phone, started_at: cl.called_at || cl.createdAt, duration_seconds: cl.duration_seconds || 0, answered: cl.outcome === "connected" || cl.outcome === "call_back_requested", recording_url: cl.recording_url || null, legacy_id: `lb1c:${cl.id}` }, { transaction: t });
                }
                for (const as of src.assignments.filter((x) => x.lead_id === r.id)) {
                    await M.CrmAssignment.create({ lead_id: lead.id, from_id: who(as.from_employee_id), to_id: who(as.to_employee_id), by_id: null, reason: `Old CRM: ${as.reason || ""}`.slice(0, 200), at: as.assigned_at || as.createdAt }, { transaction: t });
                }
            }
            const outcome = p.outcomeKey ? outcomeBy.get(p.outcomeKey) : null;
            await M.CrmActivity.create({ lead_id: lead.id, type: "system", body: `Moved from the ${det.from}. Old status: ${STATUS_LABEL(pr.status)}${outcome ? ` (last outcome: ${outcome.name})` : ""}${p.others.length ? `. Joined ${p.others.length} duplicate${p.others.length === 1 ? "" : "s"} with the same number.` : ""}`, at: new Date(), legacy_id: `mig:${p.primary.legacy}` }, { transaction: t });
            if (p.stage.kind === "open" && p.next) {
                await M.CrmTaskV2.create({ lead_id: lead.id, owner_id: p.ownerId, type: p.next.type, note: p.next.note, due_at: p.next.dueAt, status: "open", origin: "migration" }, { transaction: t });
                if (p.next.revivalStart && revival) {
                    await cadences.enroll(lead.id, revival.id, { origin: "migration", startAt: p.next.revivalStart }, t);
                    report.revivalEnrolled = (report.revivalEnrolled || 0) + 1;
                }
            }
            // Leads the new CRM already made for this number (website / Meta
            // after the deploy, before this run) join the migrated lead.
            if (p.primary.phone.valid) {
                const later = await M.CrmLeadV2.findAll({ where: { phone_key: p.primary.phone.key, legacy_id: null, merged_into_id: null, deleted_at: null, id: { [Op.ne]: lead.id } }, transaction: t });
                for (const L of later) {
                    const lStage = L.stage_id;
                    const lOpen = c.stageById.get(lStage)?.kind === "open";
                    await M.CrmInquiry.update({ lead_id: lead.id }, { where: { lead_id: L.id }, transaction: t });
                    await M.CrmCall.update({ lead_id: lead.id }, { where: { lead_id: L.id }, transaction: t });
                    await M.CrmTaskV2.update({ lead_id: lead.id, owner_id: lead.owner_id || L.owner_id }, { where: { lead_id: L.id, status: "open" }, transaction: t });
                    await L.update({ merged_into_id: lead.id, stage_id: c.stages.find((x) => x.kind === "lost").id, lost_reason_id: reasonBy.get("duplicate")?.id || null, closed_at: new Date(), revisit_at: null, next_action_at: null, next_action_type: null, next_action_note: null }, { transaction: t });
                    await M.CrmActivity.create({ lead_id: L.id, type: "merge", body: `Merged into lead #${lead.id} (moved from the old CRM)`, at: new Date() }, { transaction: t });
                    await M.CrmActivity.create({ lead_id: lead.id, type: "merge", body: `Joined lead #${L.id}, made for the same number after the switch to the new CRM`, at: new Date() }, { transaction: t });
                    if (lOpen && p.stage.kind === "lost") {
                        // They enquired again: the lead is open, as the newer one was.
                        await lead.update({ stage_id: lStage, owner_id: lead.owner_id || L.owner_id, lost_reason_id: null, revisit_at: null, closed_at: null, last_activity_at: L.last_activity_at || lead.last_activity_at, response_due_at: L.response_due_at }, { transaction: t });
                    } else if (lOpen && p.stage.kind === "won") {
                        await M.CrmTaskV2.update({ status: "cancelled", done_at: new Date() }, { where: { lead_id: lead.id, status: "open" }, transaction: t });
                    }
                    report.joinedNew = (report.joinedNew || 0) + 1;
                }
            }
            await syncNext(lead.id, t);
            await recalc(lead, t);
        });
        n += 1;
        if (n % 250 === 0) log(`  ${n} leads written...`);
    }
    log(`\nWrote ${n} leads (${report.already} were already there from an earlier run). ${report.revisitSpread} past revisit dates spread over the next 30 days. ${report.joinedNew || 0} leads the new CRM made for the same numbers were joined into them. ${report.revivalEnrolled || 0} started the revival cadence.`);
    await writeWhatsApp(src, tplMap);
    if (passwords.length) log(`\nNew logins (temporary passwords, shown once):\n  ${passwords.join("\n  ")}`);
}

main()
    .then(() => M.sequelize.close())
    .catch(async (e) => {
        console.error(e);
        await M.sequelize.close().catch(() => {});
        process.exit(1);
    });
