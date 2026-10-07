const moment = require("moment-timezone");
const settings = require("../settings");

// Small shared pieces of the sales CRM: phone numbers and working time.

const TZ = "Asia/Kolkata";

/**
 * Phone as people type it -> { phone, key, valid }. India first: 10 digits
 * (or 0 / 91 / +91 in front) = +91XXXXXXXXXX. Anything else with 11-15
 * digits is kept as an international number. key = the last 10 digits,
 * used to find the same person again.
 */
function normalizePhone(raw) {
    const s = String(raw ?? "").trim();
    const d = s.replace(/\D/g, "");
    if (d.length === 10 && /^[6-9]/.test(d)) return { phone: `+91${d}`, key: d, valid: true };
    if (d.length === 11 && d.startsWith("0") && /^[6-9]/.test(d.slice(1))) return { phone: `+91${d.slice(1)}`, key: d.slice(1), valid: true };
    if (d.length === 12 && d.startsWith("91") && /^[6-9]/.test(d.slice(2))) return { phone: `+91${d.slice(2)}`, key: d.slice(2), valid: true };
    if (d.length >= 11 && d.length <= 15 && !d.startsWith("91")) return { phone: `+${d}`, key: d.slice(-10), valid: true };
    return { phone: s.slice(0, 24), key: d.slice(-10), valid: false };
}

/** Company hours (adm_settings working_hours), cached for a minute. */
let hoursCache = null;
let hoursAt = 0;
async function workingHours() {
    if (!hoursCache || Date.now() - hoursAt > 60000) {
        hoursCache = await settings.read("working_hours");
        hoursAt = Date.now();
    }
    return hoursCache;
}
const resetHoursCache = () => {
    hoursCache = null;
};

const atTime = (m, hhmm) => {
    const [h, mi] = hhmm.split(":").map(Number);
    return m.clone().hour(h).minute(mi).second(0).millisecond(0);
};

/** Is `date` inside working hours (company days and start-end, India time)? */
function isWorkingTime(wh, date = new Date()) {
    const m = moment(date).tz(TZ);
    if (!wh.days.includes(m.day())) return false;
    return m.isSameOrAfter(atTime(m, wh.start)) && m.isBefore(atTime(m, wh.end));
}

/**
 * `minutes` of working time after `from` (company hours, India time). A
 * lead arriving at night or on Sunday counts from the next opening.
 */
function addWorkingMinutes(wh, from, minutes) {
    let m = moment(from).tz(TZ);
    let left = Math.max(0, Number(minutes) || 0);
    for (let guard = 0; guard < 400; guard++) {
        const open = atTime(m, wh.start);
        const close = atTime(m, wh.end);
        if (!wh.days.includes(m.day()) || !m.isBefore(close)) {
            m = atTime(m.clone().add(1, "day"), wh.start);
            continue;
        }
        if (m.isBefore(open)) m = open;
        const avail = close.diff(m, "minutes", true);
        if (left <= avail) return m.add(left, "minutes").toDate();
        left -= avail;
        m = atTime(m.clone().add(1, "day"), wh.start);
    }
    return m.toDate();
}

/** Working minutes between two times (for "first contact in N min"). */
function workingMinutesBetween(wh, from, to) {
    const a = moment(from).tz(TZ);
    const b = moment(to).tz(TZ);
    let total = 0;
    let day = a.clone().startOf("day");
    for (let guard = 0; guard < 400 && day.isSameOrBefore(b, "day"); guard++, day = day.clone().add(1, "day")) {
        if (!wh.days.includes(day.day())) continue;
        const s = moment.max(atTime(day, wh.start), a);
        const e = moment.min(atTime(day, wh.end), b);
        if (e.isAfter(s)) total += e.diff(s, "minutes", true);
    }
    return Math.round(total);
}

/** Start of today and tomorrow in India time, as Dates. */
function todayRange(now = new Date()) {
    const start = moment(now).tz(TZ).startOf("day");
    return { start: start.toDate(), end: start.clone().add(1, "day").toDate() };
}

const txt = (v, n) => String(v ?? "").trim().slice(0, n);
const intOrNull = (v) => (v === null || v === undefined || v === "" ? null : Number.isInteger(Number(v)) ? Number(v) : NaN);
const json = (v) => (v == null ? null : JSON.stringify(v));
const parse = (t) => {
    if (!t) return null;
    try {
        return JSON.parse(t);
    } catch {
        return null;
    }
};

module.exports = { TZ, normalizePhone, workingHours, resetHoursCache, isWorkingTime, addWorkingMinutes, workingMinutesBetween, todayRange, txt, intOrNull, json, parse, moment };
