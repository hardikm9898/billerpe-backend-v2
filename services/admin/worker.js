const os = require("os");
const crypto = require("crypto");
const { QueryTypes } = require("sequelize");
const { sequelize, CrmEvent, CrmJob, AdmSetting } = require("../../model");

// The SuperAdmin worker: hands new events to their subscribers and runs due
// jobs. Runs as its own process (admin-worker.js), never inside the POS API,
// so a slow job can never slow down outlet billing or sync.
//
// Claiming is one atomic UPDATE per batch (no Redis needed): rows get this
// tick's claim token and a claim deadline, then only rows carrying that
// token are processed. A worker that dies mid-batch loses its claim when the
// deadline passes and another tick picks the rows up again.

const EVENT_CLAIM_SECONDS = 120;
const JOB_CLAIM_SECONDS = 300;
const EVENT_MAX_ATTEMPTS = 5;
// Wait before retry n (1-based) of a failed job / event.
const BACKOFF_SECONDS = [60, 300, 900, 3600];
const backoff = (attempt) => BACKOFF_SECONDS[Math.min(attempt, BACKOFF_SECONDS.length) - 1];

const jobHandlers = new Map();
const eventSubscribers = new Map();

/** handler(payload, job) -> optional short result text. Throw to fail (retried). */
function registerJob(kind, handler) {
    jobHandlers.set(kind, handler);
}

/** subscriber(event, data). "*" receives every event. Throw to retry the event. */
function subscribe(type, subscriber) {
    if (!eventSubscribers.has(type)) eventSubscribers.set(type, []);
    eventSubscribers.get(type).push(subscriber);
}

// Built-in job used by the panel's "Test the worker" button and the tests.
registerJob("system.ping", async (payload) => `pong${payload && payload.note ? `: ${String(payload.note).slice(0, 80)}` : ""}`);

const WORKER = `${os.hostname()}:${process.pid}`.slice(0, 30);
let tick = 0;
const claimToken = () => `${WORKER}:${(tick += 1)}:${crypto.randomBytes(2).toString("hex")}`.slice(0, 40);
const errText = (e) => String((e && (e.message || e)) || "error").slice(0, 500);
const parse = (txt) => {
    if (txt == null) return null;
    try {
        return JSON.parse(txt);
    } catch {
        return null;
    }
};

async function processEvents(limit = 50) {
    const token = claimToken();
    await sequelize.query(
        `UPDATE crm_events SET claimed_by = :token, claimed_until = UTC_TIMESTAMP() + INTERVAL ${EVENT_CLAIM_SECONDS} SECOND, attempts = attempts + 1
         WHERE handled_at IS NULL AND attempts < :max AND (claimed_until IS NULL OR claimed_until < UTC_TIMESTAMP())
         ORDER BY id LIMIT ${Number(limit) | 0}`,
        { replacements: { token, max: EVENT_MAX_ATTEMPTS }, type: QueryTypes.UPDATE },
    );
    const rows = await CrmEvent.findAll({ where: { claimed_by: token, handled_at: null }, order: [["id", "ASC"]] });
    let handled = 0;
    let failed = 0;
    for (const ev of rows) {
        const subs = [...(eventSubscribers.get(ev.type) || []), ...(eventSubscribers.get("*") || [])];
        try {
            for (const sub of subs) await sub(ev, parse(ev.data));
            await ev.update({ handled_at: new Date(), claimed_by: null, claimed_until: null, last_error: null });
            handled += 1;
        } catch (e) {
            failed += 1;
            // Leave it unhandled; the claim deadline doubles as the retry time.
            await ev.update({ last_error: errText(e), claimed_by: null, claimed_until: new Date(Date.now() + backoff(ev.attempts) * 1000) });
        }
    }
    return { handled, failed };
}

async function processJobs(limit = 20) {
    const token = claimToken();
    await sequelize.query(
        `UPDATE crm_jobs SET claimed_by = :token, claimed_until = UTC_TIMESTAMP() + INTERVAL ${JOB_CLAIM_SECONDS} SECOND, attempts = attempts + 1
         WHERE status = 'queued' AND run_at <= UTC_TIMESTAMP() AND (claimed_until IS NULL OR claimed_until < UTC_TIMESTAMP())
         ORDER BY run_at, id LIMIT ${Number(limit) | 0}`,
        { replacements: { token }, type: QueryTypes.UPDATE },
    );
    const rows = await CrmJob.findAll({ where: { claimed_by: token, status: "queued" }, order: [["run_at", "ASC"], ["id", "ASC"]] });
    let done = 0;
    let failed = 0;
    let retried = 0;
    for (const job of rows) {
        const handler = jobHandlers.get(job.kind);
        try {
            if (!handler) throw new Error(`No handler for job kind "${job.kind}"`);
            const result = await handler(parse(job.payload), job);
            await job.update({ status: "done", done_at: new Date(), result: result == null ? null : String(result).slice(0, 500), claimed_by: null, claimed_until: null, last_error: null });
            done += 1;
        } catch (e) {
            const last = !handler || job.attempts >= job.max_attempts;
            if (last) {
                await job.update({ status: "failed", done_at: new Date(), last_error: errText(e), claimed_by: null, claimed_until: null });
                failed += 1;
            } else {
                await job.update({ run_at: new Date(Date.now() + backoff(job.attempts) * 1000), last_error: errText(e), claimed_by: null, claimed_until: null });
                retried += 1;
            }
        }
    }
    return { done, failed, retried };
}

let lastBeat = 0;
async function heartbeat(force = false) {
    if (!force && Date.now() - lastBeat < 30000) return;
    lastBeat = Date.now();
    const value = JSON.stringify({ at: new Date().toISOString(), worker: WORKER, host: os.hostname(), pid: process.pid });
    const [row, created] = await AdmSetting.findOrCreate({ where: { setting_key: "worker_status" }, defaults: { value } });
    if (!created) await row.update({ value });
}

/** One pass: events first (they may enqueue jobs), then due jobs. */
async function runOnce() {
    const events = await processEvents();
    const jobs = await processJobs();
    await heartbeat();
    return { events, jobs };
}

let timer = null;
let busy = false;
function start(intervalMs = 2000, log = console) {
    if (timer) return;
    heartbeat(true).catch((e) => log.error("[admin-worker] heartbeat:", errText(e)));
    timer = setInterval(async () => {
        if (busy) return;
        busy = true;
        try {
            const r = await runOnce();
            const n = r.events.handled + r.events.failed + r.jobs.done + r.jobs.failed + r.jobs.retried;
            if (n) log.info("[admin-worker]", JSON.stringify(r));
        } catch (e) {
            log.error("[admin-worker] tick failed:", errText(e));
        } finally {
            busy = false;
        }
    }, intervalMs);
}

function stop() {
    if (timer) clearInterval(timer);
    timer = null;
}

/** For the panel: worker heartbeat + queue counts. */
async function status() {
    const beat = await AdmSetting.findOne({ where: { setting_key: "worker_status" }, raw: true });
    const [counts] = await sequelize.query(
        `SELECT
            (SELECT COUNT(*) FROM crm_jobs WHERE status = 'queued' AND run_at <= UTC_TIMESTAMP()) AS jobs_due,
            (SELECT COUNT(*) FROM crm_jobs WHERE status = 'queued' AND run_at > UTC_TIMESTAMP()) AS jobs_later,
            (SELECT COUNT(*) FROM crm_jobs WHERE status = 'failed') AS jobs_failed,
            (SELECT COUNT(*) FROM crm_events WHERE handled_at IS NULL AND attempts < ${EVENT_MAX_ATTEMPTS}) AS events_waiting,
            (SELECT COUNT(*) FROM crm_events WHERE handled_at IS NULL AND attempts >= ${EVENT_MAX_ATTEMPTS}) AS events_failed`,
        { type: QueryTypes.SELECT },
    );
    const b = parse(beat && beat.value) || null;
    const ageSeconds = b && b.at ? Math.round((Date.now() - Date.parse(b.at)) / 1000) : null;
    return {
        running: ageSeconds != null && ageSeconds < 120,
        lastSeen: b ? b.at : null,
        ageSeconds,
        worker: b ? b.worker : null,
        queue: Object.fromEntries(Object.entries(counts || {}).map(([k, v]) => [k, Number(v) || 0])),
    };
}

module.exports = { registerJob, subscribe, processEvents, processJobs, runOnce, start, stop, status, heartbeat, WORKER };
