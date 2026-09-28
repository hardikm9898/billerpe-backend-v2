// JSON columns crossing the sync boundary - the cloud half of
// billerpe-local-exe/services/sync/jsonColumns.js.
//
// An exe read its JSON columns as TEXT (SQLite, raw:true) and pushed that
// text; our JSON column stored it as a JSON *string*, pull sent the string
// back, and the exe encoded it again - one more layer every round trip
// ('"[]"' -> '"\"[]\""' ...). Per-user permissions, kitchen tables and menu
// scopes then stopped applying (owner report, 2026-09-28). Values are
// decoded to their real shape both on arrival and on the way out;
// migrations/20260928140000-repair-encoded-json.js fixes stored rows.

const MAX_LAYERS = 6;

function jsonColumnsOf(Model) {
    return Object.entries(Model.rawAttributes)
        .filter(([, attr]) => attr && attr.type && (attr.type.key === "JSON" || attr.type.constructor?.key === "JSON"))
        .map(([name]) => name);
}

// '"[1]"' -> [1]; '[1]' -> [1]; [1] -> [1]; 'plain text' stays as it is.
function decodeJsonValue(value) {
    let v = value;
    for (let i = 0; i < MAX_LAYERS && typeof v === "string"; i++) {
        try {
            v = JSON.parse(v);
        } catch {
            break;
        }
    }
    return v;
}

function decodeJsonColumns(Model, row) {
    if (!row) return row;
    const cols = jsonColumnsOf(Model);
    if (!cols.length) return row;
    const out = { ...row };
    for (const c of cols) {
        if (Object.prototype.hasOwnProperty.call(out, c)) out[c] = decodeJsonValue(out[c]);
    }
    return out;
}

module.exports = { jsonColumnsOf, decodeJsonValue, decodeJsonColumns };
