const { CsActivity, AdmUser } = require("../../model");
const settings = require("../settings");
const { moment, TZ, json, parse, txt } = require("../crm/util");

// Small shared pieces of the customers area (phase 5).

const digits = (v) => String(v ?? "").replace(/\D/g, "");
/** The 10-digit mobile of an outlet's owner_number (BIGINT, sometimes with 91 in front), or "". */
const mobile10 = (v) => {
    const d = digits(v);
    return d.length >= 10 ? d.slice(-10) : "";
};
/** The spellings a mobile is stored under in the outlet tables. */
const spellings = (m) => [m, `91${m}`, `+91${m}`, `0${m}`, `+91 ${m}`];

const LEVELS = ["grey", "green", "amber", "red"];
/** The worse of two health levels (grey = nothing to judge). */
const worse = (a, b) => (LEVELS.indexOf(a) >= LEVELS.indexOf(b) ? a : b);

/** "1.10.2" > "1.9.0"; missing parts count as 0; junk compares as 0.0.0. */
function cmpVersion(a, b) {
    const pa = String(a || "").split(/[.+-]/).slice(0, 3).map((x) => Number(x) || 0);
    const pb = String(b || "").split(/[.+-]/).slice(0, 3).map((x) => Number(x) || 0);
    for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
    return 0;
}

const PLAN_LABEL = { LOCAL_SUITE: "Local Suite", CLOUD_APP: "POS App" };

/** Plans as sold (the website price list), with the POS App's device limit. */
const PLAN_NAMES = [
    { name: "Free trial", product: "any", devices: 3 },
    { name: "Suite Starter", product: "LOCAL_SUITE" },
    { name: "Suite Pro", product: "LOCAL_SUITE" },
    { name: "Suite Enterprise", product: "LOCAL_SUITE" },
    { name: "App Lite", product: "CLOUD_APP", devices: 3 },
    { name: "App Standard", product: "CLOUD_APP", devices: 6 },
    { name: "App Pro", product: "CLOUD_APP", devices: 12 },
];

async function customerSettings() {
    return settings.read("customers");
}

async function addActivity(accountId, hotelId, type, actorId, body, data, t) {
    return CsActivity.create({ account_id: accountId, hotel_id: hotelId || null, type, actor_id: actorId || null, body: txt(body, 1000), data: data == null ? null : json(data), at: new Date() }, { transaction: t });
}

async function names(ids) {
    const list = [...new Set(ids.filter(Boolean))];
    if (!list.length) return new Map();
    return new Map((await AdmUser.findAll({ where: { id: list }, attributes: ["id", "name"], raw: true })).map((u) => [u.id, u.name]));
}

/** Start of `day` (India) + n days, moved past days off, at the end of the working day. */
function dueOnDay(wh, from, days) {
    let m = moment(from).tz(TZ).startOf("day").add(Math.max(0, days), "days");
    for (let i = 0; i < 14 && !wh.days.includes(m.day()); i++) m = m.add(1, "day");
    const [h, mi] = String(wh.end || "19:00").split(":").map(Number);
    return m.hour(h).minute(mi).second(0).millisecond(0).toDate();
}

const todayStr = (now = new Date()) => moment(now).tz(TZ).format("YYYY-MM-DD");
const dayStr = (date) => moment(date).tz(TZ).format("YYYY-MM-DD");
const daysBetween = (a, b) => moment.tz(b, TZ).startOf("day").diff(moment.tz(a, TZ).startOf("day"), "days");

module.exports = { digits, mobile10, spellings, LEVELS, worse, cmpVersion, PLAN_LABEL, PLAN_NAMES, customerSettings, addActivity, names, dueOnDay, todayStr, dayStr, daysBetween, moment, TZ, json, parse, txt };
