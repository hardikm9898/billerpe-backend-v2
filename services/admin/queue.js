const { UniqueConstraintError } = require("sequelize");
const { CrmEvent, CrmJob } = require("../../model");

// The SuperAdmin's event log and job queue (design doc: Follow-up and
// automation engine). Both are plain tables, so nothing is lost when the
// worker restarts, and every automatic action can be looked at later.
//
// emit():    record that something happened. Call it in the SAME transaction
//            as the change, so an event exists exactly when its change does.
// enqueue(): ask the worker to do something at a time (default now).

const str = (v, n) => String(v ?? "").slice(0, n);

async function emit({ type, entity = "", entityId = "", data = null, actorId = null }, opts = {}) {
    return CrmEvent.create({
        type: str(type, 60),
        entity: str(entity, 40),
        entity_id: str(entityId, 40),
        data: data == null ? null : JSON.stringify(data),
        actor_id: actorId,
    }, { transaction: opts.transaction });
}

/**
 * A job with a dedupeKey is created once: a second enqueue with the same key
 * returns the first job instead (any status), so a rule that fires twice
 * cannot send twice.
 */
async function enqueue({ kind, payload = null, runAt = new Date(), dedupeKey = null, maxAttempts = 3 }, opts = {}) {
    const fields = {
        kind: str(kind, 60),
        payload: payload == null ? null : JSON.stringify(payload),
        run_at: runAt,
        max_attempts: Math.max(1, Math.min(10, Number(maxAttempts) || 3)),
        dedupe_key: dedupeKey ? str(dedupeKey, 160) : null,
    };
    if (fields.dedupe_key) {
        const existing = await CrmJob.findOne({ where: { dedupe_key: fields.dedupe_key }, transaction: opts.transaction });
        if (existing) return existing;
    }
    try {
        return await CrmJob.create(fields, { transaction: opts.transaction });
    } catch (e) {
        if (e instanceof UniqueConstraintError && fields.dedupe_key) {
            return CrmJob.findOne({ where: { dedupe_key: fields.dedupe_key }, transaction: opts.transaction });
        }
        throw e;
    }
}

/** Cancels queued jobs (for example every reminder of a lead that was won). */
async function cancel(where, opts = {}) {
    const [n] = await CrmJob.update({ status: "cancelled", done_at: new Date() }, { where: { ...where, status: "queued" }, transaction: opts.transaction });
    return n;
}

module.exports = { emit, enqueue, cancel };
