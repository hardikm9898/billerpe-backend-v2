const { AdmAuditLog } = require("../model");

// Who changed what in the SuperAdmin. Called in the same transaction as the
// change it records, so a change without its audit row cannot exist.
// Secrets never reach the log.

const SECRET_FIELDS = new Set(["password", "password_hash", "token", "push_token"]);

function strip(obj) {
    if (!obj || typeof obj !== "object") return obj ?? null;
    const plain = typeof obj.get === "function" ? obj.get({ plain: true }) : obj;
    const out = {};
    for (const [k, v] of Object.entries(plain)) if (!SECRET_FIELDS.has(k)) out[k] = v;
    return out;
}

const json = (v) => (v == null ? null : JSON.stringify(strip(v)).slice(0, 60000));

/**
 * @param {object} s       the signed-in staff (req.staff) or null for the system
 * @param {object} entry   { action, entity, entityId, summary, before, after, reason }
 */
async function write(s, entry, opts = {}) {
    return AdmAuditLog.create({
        actor_id: s?.user?.id ?? null,
        action: String(entry.action).slice(0, 60),
        entity: String(entry.entity || "").slice(0, 40),
        entity_id: String(entry.entityId ?? "").slice(0, 40),
        summary: String(entry.summary || "").slice(0, 300),
        before_json: json(entry.before),
        after_json: json(entry.after),
        reason: String(entry.reason || "").slice(0, 300),
        ip: String(s?.ip || "").slice(0, 64),
    }, { transaction: opts.transaction });
}

module.exports = { write, strip };
