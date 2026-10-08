const jwt = require("jsonwebtoken");
const { Hotel, HotelUser, AdmUser, AdmSupportSession, AdmAuditLog } = require("../model");
const { RuleError } = require("../appv1/core");

// "Open as outlet" (BillerPe SuperAdmin, owner 2026-10-08): support staff
// open ONE Plan 1 outlet in the web Owner Dashboard as its owner, for 30
// minutes, with a reason. The token is not an owner login: it carries only
// the adm_support_sessions row id and expires; the row can be ended early.
// Every change made in it is written to the SuperAdmin audit log as
// "BillerPe support" with the staff member's name. The owner's own phones,
// alert rules and read marks are left alone.

const SECRET = () => process.env.OWNER_JWT_SECRET || process.env.JWT_SECRET_KEY_ADMIN;
const TYP = "owner-support";

const sign = (sessionId, minutes) => jwt.sign({ typ: TYP, sid: sessionId }, SECRET(), { expiresIn: `${Math.max(1, Number(minutes) || 30)}m` });

function verify(token) {
    try {
        const p = jwt.verify(String(token || ""), SECRET());
        return p && p.typ === TYP ? p : null;
    } catch {
        return null;
    }
}

const digits = (v) => String(v ?? "").replace(/\D/g, "");
const mobile10 = (v) => {
    const d = digits(v);
    return d.length >= 10 ? d.slice(-10) : "";
};

/**
 * A support token -> the same shape the owner middleware gives handlers
 * ({ device, mobile, owned }) plus `support`, or null when it is over.
 */
async function check(token) {
    const p = verify(token);
    if (!p) return null;
    const row = await AdmSupportSession.findOne({ where: { id: Number(p.sid) || 0, ended_at: null } });
    if (!row || new Date(row.expires_at) <= new Date()) return null;
    const hotel = await Hotel.findOne({ where: { id: row.hotel_id, product_plan: "LOCAL_SUITE" }, attributes: ["id", "hotel_name", "owner_name", "owner_number", "plan_end_date", "hotel_logo", "active"], raw: true });
    if (!hotel || hotel.active === false || hotel.active === 0) return null;
    const m = mobile10(hotel.owner_number);
    if (!m) return null;
    const user = await HotelUser.findOne({ where: { hotel_id: hotel.id, number: [m, `91${m}`, `+91${m}`, `0${m}`, `+91 ${m}`], active: true }, attributes: ["id", "hotel_id", "name", "number", "password", "active"], raw: true });
    if (!user) return null;
    const staff = await AdmUser.findOne({ where: { id: row.user_id }, attributes: ["id", "name", "status"], raw: true });
    if (!staff || staff.status !== "active") return null;
    const { password, ...hotelUser } = user; // eslint-disable-line no-unused-vars
    // A stand-in for the owner's device row: nothing is ever saved on it.
    const device = { id: 0, device_id: `support-${row.id}`, hotel_user_id: user.id, owner_mobile: m, last_active: new Date(), update: async () => {} };
    return {
        device,
        mobile: m,
        owned: [{ hotel, user: hotelUser }],
        support: { sessionId: row.id, staffId: staff.id, staffName: staff.name, expiresAt: row.expires_at, outlet: hotel.hotel_name, hotelId: hotel.id, row },
    };
}

// Calls that only read. Anything else from a support session is a change and is audited.
const READS = new Set(["outlets", "home", "outlet", "tables", "bills", "bill", "manage", "manageMenu", "manageStaff", "manageTables", "manageSettings", "manageStock", "alerts", "alertCount", "alertRules", "daySummary", "pcHistory", "reportCatalog", "report", "devices"]);
// The owner's own things: not for support.
const BLOCKED = new Set(["saveAlertRules", "logoutDevice"]);

/** Runs before a handler in a support session: answers some calls itself; returns undefined to go on. */
async function before(o, name) {
    if (BLOCKED.has(name)) throw new RuleError("Not in a BillerPe support session: this belongs to the owner.");
    if (name === "logout") {
        await AdmSupportSession.update({ ended_at: new Date() }, { where: { id: o.support.sessionId, ended_at: null } });
        return {};
    }
    if (name === "setPushToken") return {};
    if (name === "setLanguage") return { language: "en" };
    if (name === "markAlertsRead") return { unread: 0 };
    if (name === "devices") return { devices: [] };
    return undefined;
}

/** After a change succeeded: "BillerPe support (<name>)" in the SuperAdmin audit log. */
async function after(o, name, args) {
    if (READS.has(name)) {
        void AdmSupportSession.update({ last_used_at: new Date() }, { where: { id: o.support.sessionId } }).catch(() => {});
        return;
    }
    await AdmSupportSession.increment("writes", { by: 1, where: { id: o.support.sessionId } });
    await AdmSupportSession.update({ last_used_at: new Date() }, { where: { id: o.support.sessionId } });
    let detail = "";
    try {
        detail = JSON.stringify(args).slice(0, 4000);
    } catch {
        detail = "";
    }
    await AdmAuditLog.create({
        actor_id: o.support.staffId,
        action: `support.${name}`.slice(0, 60),
        entity: "hotel",
        entity_id: String(o.support.hotelId),
        summary: `BillerPe support (${o.support.staffName}) in ${o.support.outlet}: ${name}`.slice(0, 300),
        after_json: JSON.stringify({ call: name, args: detail && detail.length < 4000 ? args : "(too long to keep)" }),
        reason: String(o.support.row.reason || "").slice(0, 300),
        ip: "",
    });
}

module.exports = { sign, verify, check, before, after, TYP };
