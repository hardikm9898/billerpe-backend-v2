const { Op } = require("sequelize");
const { AdmUser, AdmRole, AdmLeave, AdmBreak, SupTicket } = require("../../model");
const perms = require("../permissions");
const settings = require("../settings");
const { workingHours, isWorkingTime, addWorkingMinutes, workingMinutesBetween, moment, TZ, txt } = require("../crm/util");

// Shared pieces of the support queue (phase 7, owner 2026-10-08): timers by
// priority in working hours, round-robin among support staff, labels.

const STATES = ["new", "open", "waiting", "closed"];
const PRIORITIES = ["high", "medium", "low"];
const CHANNELS = { webpos: "Web POS", pos_app: "POS App", owner_app: "Owner App", whatsapp: "WhatsApp", phone: "Phone", email: "Email", staff: "Staff", old_app: "Older app" };
const STAFF_CHANNELS = ["phone", "email", "whatsapp", "staff"];
const RATING = { 5: "Good", 3: "Okay", 1: "Poor" };

/** The old table's status for a state (older screens and the outlet health check read it). */
const legacyStatus = (state) => (state === "closed" ? "close" : state === "new" ? "new" : "open");
const ticketNo = (ticketId) => `T-${ticketId}`;

async function supportSettings() {
    return settings.read("support");
}

/**
 * When the first reply and the fix are due: working minutes from when the
 * ticket was opened, the fix timer moved on by the time it waited on the
 * customer. A ticket that comes at night counts from the next opening.
 */
async function dueTimes(sup, cfg) {
    const c = cfg || (await supportSettings());
    const wh = await workingHours();
    const t = (c.timers && c.timers[sup.priority]) || settings.DEFAULTS.support.timers.medium;
    return {
        first_reply_due: addWorkingMinutes(wh, sup.opened_at, t.firstReplyMinutes),
        resolve_due: addWorkingMinutes(wh, sup.opened_at, t.fixMinutes + (sup.paused_minutes || 0)),
    };
}

/** Working minutes a ticket waited on the customer, from waiting_since to now. */
async function pausedSince(since, now = new Date()) {
    if (!since) return 0;
    return workingMinutesBetween(await workingHours(), since, now);
}

/** Active people whose role names support.use itself ("*" roles only as a last resort). */
async function supportPeople() {
    const roles = await AdmRole.findAll({ raw: true });
    const own = roles.filter((r) => perms.parse(r.permissions).includes("support.use")).map((r) => r.id);
    const any = roles.filter((r) => perms.can(perms.parse(r.permissions), "support.use")).map((r) => r.id);
    const pick = async (ids) => (ids.length ? AdmUser.findAll({ where: { role_id: ids, status: "active" }, raw: true }) : []);
    const first = await pick(own);
    return first.length ? first : pick(any);
}

const inShift = (wh, u, now) => {
    const m = moment(now).tz(TZ);
    if (!wh.days.includes(m.day())) return false;
    const hhmm = m.format("HH:mm");
    return hhmm >= (u.shift_start || wh.start) && hhmm < (u.shift_end || wh.end);
};

/**
 * Who gets a new ticket (owner 2026-10-08: round-robin among support
 * staff). Not on leave; in working hours also on shift and not on a break.
 * The one with the fewest unclosed tickets wins; ties: the one who got a
 * ticket longest ago. Nobody: left unassigned (support leads are told).
 */
async function pickAssignee(now = new Date()) {
    const people = await supportPeople();
    if (!people.length) return null;
    const ids = people.map((p) => p.id);
    const today = moment(now).tz(TZ).format("YYYY-MM-DD");
    const onLeave = new Set((await AdmLeave.findAll({ where: { user_id: ids, from_date: { [Op.lte]: today }, to_date: { [Op.gte]: today } }, attributes: ["user_id"], raw: true })).map((l) => l.user_id));
    const onBreak = new Set((await AdmBreak.findAll({ where: { user_id: ids, ended_at: null, started_at: { [Op.lte]: now }, ends_at: { [Op.gt]: now } }, attributes: ["user_id"], raw: true })).map((b) => b.user_id));
    const wh = await workingHours();
    let pool = people.filter((p) => !onLeave.has(p.id));
    if (isWorkingTime(wh, now)) {
        const live = pool.filter((p) => !onBreak.has(p.id) && inShift(wh, p, now));
        if (live.length) pool = live;
    }
    if (!pool.length) return null;
    const poolIds = pool.map((p) => p.id);
    const fn = SupTicket.sequelize.fn;
    const col = SupTicket.sequelize.col;
    const open = new Map((await SupTicket.findAll({ where: { assignee_id: poolIds, state: { [Op.ne]: "closed" } }, attributes: ["assignee_id", [fn("COUNT", col("id")), "n"]], group: ["assignee_id"], raw: true })).map((r) => [r.assignee_id, Number(r.n) || 0]));
    const last = new Map((await SupTicket.findAll({ where: { assignee_id: poolIds }, attributes: ["assignee_id", [fn("MAX", col("assigned_at")), "last"]], group: ["assignee_id"], raw: true })).map((r) => [r.assignee_id, r.last ? new Date(r.last).getTime() : 0]));
    const ranked = pool.map((p) => ({ p, n: open.get(p.id) || 0, last: last.get(p.id) || 0 })).sort((a, b) => a.n - b.n || a.last - b.last || a.p.id - b.p.id);
    const best = ranked[0];
    return { id: best.p.id, name: best.p.name, reason: `Round-robin: ${best.n} open ticket${best.n === 1 ? "" : "s"} before this one` };
}

/**
 * The old issue column -> parts. The apps wrote it as "Subject\n\nDetails\n\n
 * Raised by: ..." (Web POS) or "Subject\nDetails\n\n— Name (Role), POS App"
 * (POS App before the support queue): the first line is the subject.
 */
function splitIssue(issue) {
    const s = String(issue || "").replace(/\r/g, "").trim();
    const by = s.match(/\n\n(?:Raised by: |— )([^\n]*)$/);
    const body = by ? s.slice(0, by.index) : s;
    const lines = body.split("\n");
    const subject = lines[0].trim();
    const details = lines.slice(1).join("\n").trim();
    return { subject: txt(subject || "Support request", 160), details, raisedBy: by ? by[1].trim() : "" };
}

/** A 10-digit Indian mobile inside some text ("Asha · 9876543210 · Manager"), or "". */
function mobileIn(text) {
    const m = String(text || "").replace(/[\s-]/g, "").match(/(?:\+?91)?([6-9]\d{9})(?!\d)/);
    return m ? m[1] : "";
}

module.exports = { STATES, PRIORITIES, CHANNELS, STAFF_CHANNELS, RATING, legacyStatus, ticketNo, supportSettings, dueTimes, pausedSince, supportPeople, pickAssignee, splitIssue, mobileIn };
