const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { Op } = require("sequelize");
const { sequelize, CrmCall, CrmLeadV2, CrmActivity, CrmTaskV2, AdmUser, AdmSession } = require("../../model");
const { RuleError } = require("../../appv1/core");
const { need } = require("../auth");
const config = require("./config");
const scope = require("./scope");
const { addTask, syncNext } = require("./tasks");
const { notify } = require("./notify");
const { normalizePhone, workingHours, addWorkingMinutes, moment, TZ, txt } = require("./util");

// Calls from the sales app (design doc: Calling and recording). The app on
// each company phone reads the phone's call log and sends every new call:
// - a call with a lead goes on the lead (time, length, answered) and the app
//   asks the outcome; its recording is found in the phone's recorder folder
//   and uploaded;
// - a missed call from a lead becomes a call-back task in 15 working minutes;
// - a call with any other number is kept only as a count (lead_id 0, no
//   number), so personal calls never show in the CRM.

const KINDS = new Set(["in", "out", "missed", "rejected"]);

async function findLead(key, t) {
    if (!key || key.length < 10) return null;
    return CrmLeadV2.findOne({ where: { phone_key: key, deleted_at: null, merged_into_id: null }, order: [["id", "DESC"]], transaction: t });
}

function leadCard(l, c, owners) {
    const st = c.stageById.get(l.stage_id);
    return { id: l.id, name: l.name || l.phone, restaurant: l.restaurant_name, city: l.city, stage: st ? st.name : "", stageKind: st ? st.kind : "open", owner: l.owner_id ? owners.get(l.owner_id) || "" : "", nextAction: l.next_action_at ? { at: l.next_action_at, type: l.next_action_type, note: l.next_action_note } : null };
}

/**
 * New calls from the phone's call log. Each: { id (call log id on the phone),
 * number, type: in | out | missed | rejected, at (ms), seconds }.
 * Safe to send again: a call is stored once per phone (device_call_id).
 */
async function sync(s, input = {}) {
    need(s, "leads.edit");
    const device = txt(input.deviceId || s.session.device_id || `s${s.session.id}`, 48);
    const list = (Array.isArray(input.calls) ? input.calls : []).slice(0, 300);
    const c = await config.load();
    const wh = await workingHours();
    const results = [];
    for (const raw of list) {
        const kind = KINDS.has(raw.type) ? raw.type : "out";
        const at = new Date(Number(raw.at) || Date.now());
        const secs = Math.max(0, Math.min(36000, Math.round(Number(raw.seconds) || 0)));
        const deviceCallId = `${device}:${txt(raw.id, 30)}`;
        const done = await CrmCall.findOne({ where: { device_call_id: deviceCallId } });
        if (done) {
            results.push({ id: raw.id, callId: done.lead_id ? done.id : null, leadId: done.lead_id || null, needsOutcome: false, recording: done.recorded === "pending" ? "upload" : "none", repeat: true });
            continue;
        }
        const phone = normalizePhone(raw.number);
        const answered = (kind === "in" || kind === "out") && secs > 0;
        const r = await sequelize.transaction(async (t) => {
            const lead = await findLead(phone.key, t);
            if (!lead) {
                // Not a lead: a count only (no number kept).
                await CrmCall.create({ lead_id: 0, user_id: s.user.id, source: "app", device_call_id: deviceCallId, device_id: device, direction: kind === "out" ? "out" : "in", phone: "", started_at: at, duration_seconds: secs, answered, recorded: "none" }, { transaction: t });
                return { id: raw.id, callId: null, leadId: null, needsOutcome: false, recording: "none", unknown: kind === "in" && answered };
            }
            const call = await CrmCall.create({
                lead_id: lead.id, user_id: s.user.id, source: "app", device_call_id: deviceCallId, device_id: device, direction: kind === "out" ? "out" : "in", phone: lead.phone,
                started_at: at, duration_seconds: secs, answered, recorded: answered ? "pending" : "none",
            }, { transaction: t });
            const open = c.stageById.get(lead.stage_id)?.kind === "open";
            const { activity } = require("./leads");
            const label = kind === "missed" || kind === "rejected" ? "Missed call from them" : `${kind === "in" ? "Incoming" : "Outgoing"} call${answered ? `, ${Math.floor(secs / 60)} min ${secs % 60} s` : ", not answered"}`;
            await activity(lead.id, "call", s.user.id, `${label} (company phone)`, { callId: call.id, seconds: secs, kind }, t);
            const patch = {};
            if (answered) {
                patch.last_activity_at = at;
                if (!lead.first_contact_at) patch.first_contact_at = at;
            }
            if (Object.keys(patch).length) await lead.update(patch, { transaction: t });
            if ((kind === "missed" || kind === "rejected") && open) {
                // They tried to reach us: call back within 15 working minutes.
                const has = await CrmTaskV2.findOne({ where: { lead_id: lead.id, status: "open", type: "call", note: "Missed their call: call back" }, transaction: t });
                if (!has) {
                    await addTask({ leadId: lead.id, ownerId: lead.owner_id || s.user.id, type: "call", dueAt: addWorkingMinutes(wh, at, 15), note: "Missed their call: call back", origin: "app" }, t);
                    await syncNext(lead.id, t);
                }
                const to = lead.owner_id || s.user.id;
                await notify(to, { type: "call.missed", title: `Missed call from ${lead.name || lead.phone}`, body: "Call back within 15 minutes.", link: `/leads/${lead.id}`, ref: `missed:${deviceCallId}` }, { transaction: t });
            }
            return { id: raw.id, callId: call.id, leadId: lead.id, leadName: lead.name || lead.phone, needsOutcome: open && kind !== "missed" && kind !== "rejected", recording: answered ? "upload" : "none" };
        });
        results.push(r);
    }
    return { results };
}

/** Lead card for an incoming call or the after-call prompt (null = not a lead this person may see). */
async function lookup(s, number) {
    need(s, "leads.edit");
    const lead = await findLead(normalizePhone(number).key);
    if (!lead || !(await scope.canSee(s, lead))) return { lead: null };
    const c = await config.load();
    const owners = new Map(lead.owner_id ? [[lead.owner_id, (await AdmUser.findByPk(lead.owner_id, { attributes: ["name"] }))?.name || ""]] : []);
    const note = await CrmActivity.findOne({ where: { lead_id: lead.id, type: ["note", "outcome"] }, order: [["id", "DESC"]], attributes: ["body", "at"], raw: true });
    return { lead: { ...leadCard(lead, c, owners), lastNote: note ? note.body : "" } };
}

/** The open leads this person may see, as phone_key -> card, for the phone's offline caller cards. */
async function cache(s) {
    need(s, "leads.edit");
    const c = await config.load();
    const rows = await CrmLeadV2.findAll({ where: { ...(await scope.leadWhere(s)), stage_id: c.openStageIds, deleted_at: null, merged_into_id: null, phone_valid: true }, attributes: ["id", "name", "phone", "phone_key", "restaurant_name", "stage_id", "owner_id"], limit: 20000, raw: true });
    return { at: new Date().toISOString(), leads: rows.map((l) => [l.phone_key, l.id, l.name || l.phone, l.restaurant_name || "", c.stageById.get(l.stage_id)?.name || ""]) };
}

/* ------------------------------ recordings ------------------------------ */

const AUDIO = { "audio/mpeg": ".mp3", "audio/mp3": ".mp3", "audio/mp4": ".m4a", "audio/x-m4a": ".m4a", "audio/aac": ".aac", "audio/amr": ".amr", "audio/3gpp": ".3gp", "audio/ogg": ".ogg", "audio/opus": ".opus", "audio/wav": ".wav", "audio/x-wav": ".wav", "application/octet-stream": "" };

/** Keeps a recording privately -> "s3:<key>" or a local path (test servers). */
const store = {
    async put(buffer, mime, name) {
        const ext = path.extname(String(name || "")).replace(/[^.\w]/g, "").slice(0, 6) || AUDIO[mime] || ".bin";
        const key = `crm-calls/${moment().tz(TZ).format("YYYY/MM")}/${Date.now()}-${crypto.randomBytes(6).toString("hex")}${ext}`;
        if (process.env.ADMIN_WA_LIVE === "1" || process.env.ADMIN_FILES_LIVE === "1") {
            const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
            const bucket = process.env.ADMIN_FILES_BUCKET || "bpe-upload-data";
            await new S3Client({ region: process.env.ADMIN_FILES_REGION || "ap-south-1" }).send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: buffer, ContentType: mime }));
            return `s3:${key}`;
        }
        const file = path.join(__dirname, "../../public", key);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, buffer);
        return `/${key}`;
    },
    async link(ref) {
        if (!ref) return null;
        if (!ref.startsWith("s3:")) return ref;
        const { S3Client, GetObjectCommand } = require("@aws-sdk/client-s3");
        const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
        const client = new S3Client({ region: process.env.ADMIN_FILES_REGION || "ap-south-1" });
        return getSignedUrl(client, new GetObjectCommand({ Bucket: process.env.ADMIN_FILES_BUCKET || "bpe-upload-data", Key: ref.slice(3) }), { expiresIn: 900 });
    },
};

/** The phone's recording of one of this person's calls (raw body). */
async function upload(s, callId, buffer, { mime = "application/octet-stream", name = "" } = {}) {
    need(s, "leads.edit");
    const call = await CrmCall.findByPk(Number(callId) || 0);
    if (!call || call.user_id !== s.user.id || !call.lead_id) throw new RuleError("This is not one of your calls.");
    if (call.recorded === "yes") return { ok: true, already: true };
    if (!buffer || !buffer.length) throw new RuleError("The recording is empty.");
    if (buffer.length > 60 * 1024 * 1024) throw new RuleError("The recording is larger than 60 MB.");
    const ref = await store.put(buffer, mime, name);
    await call.update({ recording_url: ref, recorded: "yes", recording_name: txt(name, 200) || null, recording_size: buffer.length });
    return { ok: true };
}

/** The app looked and found no recording for this call. */
async function noRecording(s, callId) {
    need(s, "leads.edit");
    const call = await CrmCall.findByPk(Number(callId) || 0);
    if (!call || call.user_id !== s.user.id) throw new RuleError("This is not one of your calls.");
    if (call.recorded === "pending") await call.update({ recorded: "no" });
    return { ok: true };
}

/** A short link to play a recording: the caller, their manager (calls.listen_team) and admins only. */
async function play(s, callId) {
    const call = await CrmCall.findByPk(Number(callId) || 0);
    if (!call || !call.recording_url) throw new RuleError("This call has no recording.");
    let ok = call.user_id === s.user.id || s.permissions.includes("*");
    if (!ok && s.can("calls.listen_team")) ok = (await scope.teamIds(s.user.id)).includes(call.user_id);
    if (!ok) throw new RuleError("Only the caller, their manager and admins can listen to this recording.");
    return { url: await store.link(call.recording_url) };
}

/* ------------------------------ phone ------------------------------ */

async function setPush(s, token) {
    await AdmSession.update({ push_token: token ? txt(token, 255) : null }, { where: { id: s.session.id } });
    return { ok: true };
}

/** Calls per person for a day (team today, reports): all company-phone calls, recorded share. */
async function stats(userIds, from, to) {
    const rows = await CrmCall.findAll({
        where: { user_id: userIds, started_at: { [Op.gte]: from, [Op.lt]: to } },
        attributes: ["user_id", "lead_id", "answered", "duration_seconds", "recorded", "source"],
        raw: true,
    });
    const out = new Map();
    for (const r of rows) {
        const x = out.get(r.user_id) || { calls: 0, leadCalls: 0, answered: 0, talkSeconds: 0, recorded: 0, toRecord: 0 };
        x.calls += 1;
        if (r.lead_id) x.leadCalls += 1;
        if (r.answered) {
            x.answered += 1;
            x.talkSeconds += r.duration_seconds || 0;
            if (r.source === "app" && r.lead_id) {
                x.toRecord += 1;
                if (r.recorded === "yes") x.recorded += 1;
            }
        }
        out.set(r.user_id, x);
    }
    return out;
}

module.exports = { sync, lookup, cache, upload, noRecording, play, setPush, stats, store };
