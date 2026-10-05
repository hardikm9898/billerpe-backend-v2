const { Op } = require("sequelize");
const moment = require("moment-timezone");
const M = require("../model");
const { r2, outletClock, businessDate, resolveRole, fail } = require("../appv1/core");
const L = require("../appv1/load");
const { ownOutlet, rangeOf, outlet: outletView } = require("./watch");
const { stockLevels } = require("./reports");
const { pushToOwner } = require("./push");
const { ownedOutlets } = require("./auth");
const { ONLINE_WINDOW_MS } = require("./outlets");

// Owner App phase 4 "Alerts" (owner decision 2026-10-05): the outlet PC
// going offline and coming back, risky actions (cancelled after KOT, a big
// discount, a settled bill edited, cash short or over at closing), low
// stock, and the nightly day summary - each in the Alerts screen and pushed
// to the owner's phones.
//
// Everything comes from what the outlet PCs upload, so a job looks every
// minute (server.js) instead of hooks in the sync path: the sync stays as
// fast as it was, and a late upload (a PC back after a day offline) still
// alerts. Each alert has a `ref` unique per owner, so looking twice never
// alerts twice. Only outlets whose owner is logged in on a phone are looked
// at.

const RULE_DEFAULTS = {
    pcOffline: { on: true, minutes: 10 },
    discount: { on: true, pct: 20 },
    cancelAfterKot: { on: true },
    edited: { on: true },
    cashDiff: { on: true },
    lowStock: { on: true },
    summary: { on: true, time: "23:30" },
};
const SUMMARY_WINDOW_H = 3; // a server down at summary time still sends it within 3 hours
const LOOKBACK_DAYS = 1; // risky actions older than yesterday's business day are history, not news

const money = (n) => `₹${Math.round(Number(n) || 0).toLocaleString("en-IN")}`;
const shortName = (name) => (String(name).includes(" · ") ? String(name).split(" · ").pop() : String(name));

/* ------------------------------ rules ------------------------------ */

function mergeRules(saved) {
    const out = {};
    for (const [k, d] of Object.entries(RULE_DEFAULTS)) out[k] = { ...d, ...((saved && saved[k]) || {}) };
    return out;
}

async function rulesFor(mobile) {
    const row = await M.OwnerSetting.findOne({ where: { owner_mobile: mobile }, raw: true });
    let saved = null;
    try {
        saved = row?.rules ? JSON.parse(row.rules) : null;
    } catch {
        saved = null;
    }
    return mergeRules(saved);
}

const rules = async (o) => ({ rules: await rulesFor(o.mobile) });

async function saveRules(o, input = {}) {
    const cur = await rulesFor(o.mobile);
    const next = mergeRules(cur);
    for (const k of Object.keys(RULE_DEFAULTS)) if (input[k] && typeof input[k].on === "boolean") next[k].on = input[k].on;
    if (input.pcOffline?.minutes !== undefined) {
        const m = Number(input.pcOffline.minutes);
        if (![5, 10, 15, 30, 60].includes(m)) fail("Pick 5, 10, 15, 30 or 60 minutes");
        next.pcOffline.minutes = m;
    }
    if (input.discount?.pct !== undefined) {
        const p = Number(input.discount.pct);
        if (!(p >= 1 && p <= 100)) fail("Pick a discount between 1% and 100%");
        next.discount.pct = Math.round(p);
    }
    if (input.summary?.time !== undefined) {
        if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(input.summary.time))) fail("Pick a time like 23:30");
        next.summary.time = String(input.summary.time);
    }
    const [row] = await M.OwnerSetting.findOrCreate({ where: { owner_mobile: o.mobile }, defaults: { owner_mobile: o.mobile } });
    await row.update({ rules: JSON.stringify(next) });
    return { rules: next };
}

/* ------------------------------ who to look at ------------------------------ */

/** Owners logged in on at least one phone, each with their Plan 1 outlets and rules. */
async function scope() {
    const mobiles = (await M.OwnerDevice.findAll({ where: { status: "active" }, attributes: ["owner_mobile"], group: ["owner_mobile"], raw: true })).map((d) => d.owner_mobile);
    const out = [];
    for (const mobile of mobiles) {
        const owned = await ownedOutlets(mobile);
        if (!owned.length) continue;
        out.push({ mobile, hotels: owned.map((x) => x.hotel), rules: await rulesFor(mobile) });
    }
    return out;
}

/** Creates the alert once (ref unique per owner) and pushes it. Returns true when it is new. */
async function raise(mobile, a, { push = true } = {}) {
    const [row, created] = await M.OwnerAlert.findOrCreate({
        where: { owner_mobile: mobile, ref: a.ref.slice(0, 120) },
        defaults: {
            owner_mobile: mobile, ref: a.ref.slice(0, 120), hotel_id: a.hotelId ?? null, kind: a.kind,
            title: a.title.slice(0, 160), body: (a.body || "").slice(0, 400), link: a.link || "/alerts", event_at: a.at || new Date(),
        },
    });
    if (!created) return false;
    if (!push) return row;
    try {
        const r = await pushToOwner(mobile, { title: row.title, body: row.body, link: row.link, kind: row.kind });
        if (r.sent) await row.update({ pushed: true });
    } catch (err) {
        console.error("[owner-alerts] push failed:", err.message);
    }
    return true;
}

/* ------------------------------ outlet PC offline / back ------------------------------ */

async function watchPcs(now, owners) {
    const hotelIds = [...new Set(owners.flatMap((x) => x.hotels.map((h) => h.id)))];
    if (!hotelIds.length) return 0;
    const [regs, open] = await Promise.all([
        M.LocalServerRegistration.findAll({ where: { hotel_id: hotelIds, status: "active" }, attributes: ["hotel_id", "last_seen_at"], raw: true }),
        M.OwnerOfflinePeriod.findAll({ where: { hotel_id: hotelIds, ended_at: null }, raw: true }),
    ]);
    let raised = 0;
    for (const reg of regs) {
        if (!reg.last_seen_at) continue;
        const seen = new Date(reg.last_seen_at);
        const offline = now - seen > ONLINE_WINDOW_MS;
        let period = open.find((p) => p.hotel_id === reg.hotel_id);
        if (offline && !period) period = (await M.OwnerOfflinePeriod.create({ hotel_id: reg.hotel_id, started_at: seen })).get({ plain: true });
        if (!offline && period) await M.OwnerOfflinePeriod.update({ ended_at: seen }, { where: { id: period.id } });
        if (!period) continue;
        for (const owner of owners) {
            const hotel = owner.hotels.find((h) => h.id === reg.hotel_id);
            if (!hotel || !owner.rules.pcOffline.on) continue;
            const mins = Math.round((now - new Date(period.started_at)) / 60000);
            // A spell already over a day old when first seen is old news (it shows on Home), not a fresh alert.
            const stale = now - new Date(period.started_at) > 24 * 3600000;
            if (offline && !stale && now - new Date(period.started_at) >= owner.rules.pcOffline.minutes * 60000) {
                const backlog = await pendingBills(reg.hotel_id);
                if (await raise(owner.mobile, {
                    ref: `offline:${period.id}`, kind: "pc-offline", hotelId: hotel.id, at: now,
                    title: `${shortName(hotel.hotel_name)} PC is offline`,
                    body: `No contact for ${mins} min${backlog ? ` · ${backlog} bill${backlog === 1 ? "" : "s"} waiting to upload` : ""} · billing keeps working at the outlet`,
                    link: `/pc/${hotel.id}`,
                })) raised++;
            }
            if (!offline) {
                // "Back online" only after an offline alert was sent for this spell.
                const told = await M.OwnerAlert.count({ where: { owner_mobile: owner.mobile, ref: `offline:${period.id}` } });
                if (told && await raise(owner.mobile, {
                    ref: `online:${period.id}`, kind: "pc-online", hotelId: hotel.id, at: seen,
                    title: `${shortName(hotel.hotel_name)} PC is back online`,
                    body: `Was offline ${Math.max(1, Math.round((seen - new Date(period.started_at)) / 60000))} min · its bills are uploading now`,
                    link: `/pc/${hotel.id}`,
                })) raised++;
            }
        }
    }
    return raised;
}

async function pendingBills(hotelId) {
    const [row] = await M.sequelize.query("SELECT pending_orders FROM local_server_registrations WHERE hotel_id = ? AND status = 'active'", { replacements: [hotelId], type: "SELECT" }).catch(() => [null]);
    return Number(row?.pending_orders) || 0;
}

/* ------------------------------ risky actions ------------------------------ */

const editedEvent = (o) => [...o.timeline].reverse().find((t) => t.label === "Edited after settle" || t.label === "Order updated");
const cancelEvent = (o) => [...o.timeline].reverse().find((t) => t.label.startsWith("Cancelled"));
const discountPct = (o) => (o.totals.subtotal > 0 ? Math.round((o.totals.discount / o.totals.subtotal) * 100) : 0);

/** Bills and cash sessions uploaded since `since` at the owners' outlets. */
async function scanRisky(now, since, owners) {
    const hotels = new Map();
    for (const owner of owners) for (const h of owner.hotels) hotels.set(h.id, h);
    let raised = 0;
    for (const hotel of hotels.values()) {
        const clock = await outletClock(hotel.id);
        const from = moment(businessDate(clock, now)).subtract(LOOKBACK_DAYS, "days").format("YYYY-MM-DD");
        const changed = await M.Order.findAll({ where: { hotel_id: hotel.id, updatedAt: { [Op.gte]: since }, business_date: { [Op.gte]: from } }, attributes: ["id"], raw: true });
        const orders = changed.length ? await L.loadOrderViews(hotel.id, { id: changed.map((x) => x.id) }) : [];
        const staff = await M.HotelUser.findAll({ where: { hotel_id: hotel.id }, attributes: ["name"], include: M.Role });
        const roleOf = (name) => {
            const u = staff.find((s) => s.name === name);
            return u ? resolveRole(u.role_mst?.role_name) : "";
        };
        const who = (name) => (name ? `${name}${roleOf(name) ? ` (${roleOf(name)})` : ""}` : "");
        const where = shortName(hotel.hotel_name);
        const alerts = [];
        for (const o of orders) {
            const link = `/bill/${hotel.id}/${o.id}`;
            if (o.status === "cancelled" && o.kots.length) {
                const ev = cancelEvent(o);
                alerts.push({ rule: "cancelAfterKot", ref: `cancel:${hotel.id}:${o.id}`, kind: "cancel-after-kot", at: ev?.at || o.createdAt, link,
                    title: `Bill #${o.billNo} cancelled after KOT`,
                    body: [money(o.totals.grand), where, who(ev?.by), o.cancelReason ? `“${o.cancelReason}”` : null].filter(Boolean).join(" · ") });
            }
            if (o.status === "settled") {
                const pct = discountPct(o);
                alerts.push({ rule: "discount", min: pct, ref: `discount:${hotel.id}:${o.id}`, kind: "discount", at: o.settledAt || o.createdAt, link,
                    title: `${pct}% discount on bill #${o.billNo}`,
                    body: [`${money(o.totals.discount)} off`, "above your limit", where, who(o.settledBy)].filter(Boolean).join(" · ") });
                const ev = editedEvent(o);
                if (ev) alerts.push({ rule: "edited", ref: `edited:${hotel.id}:${o.id}:${ev.at}`, kind: "edited", at: ev.at, link,
                    title: `Settled bill #${o.billNo} edited`,
                    body: [`now ${money(o.totals.grand)}`, where, who(ev.by)].filter(Boolean).join(" · ") });
            }
        }
        const sessions = await M.CashSession.findAll({ where: { hotel_id: hotel.id, status: { [Op.ne]: "Open" }, deleted: false, updatedAt: { [Op.gte]: since }, closed_at: { [Op.ne]: null } }, raw: true });
        for (const s of sessions) {
            const diff = r2(Number(s.variance) || 0);
            if (Math.abs(diff) < 1 || businessDate(clock, s.closed_at) < from) continue;
            const by = s.hotelUserId ? (await M.HotelUser.findOne({ where: { id: s.hotelUserId }, attributes: ["name"], raw: true }))?.name : "";
            alerts.push({ rule: "cashDiff", ref: `cash:${hotel.id}:${s.id}`, kind: "cash-diff", at: s.closed_at, link: `/report/cash-session?outlet=${hotel.id}`,
                title: `Cash ${diff < 0 ? "short" : "over"} by ${money(Math.abs(diff))} at closing`,
                body: [where, by ? `closed by ${by}` : null, s.variance_reason ? `“${s.variance_reason}”` : null].filter(Boolean).join(" · ") });
        }
        for (const owner of owners.filter((x) => x.hotels.some((h) => h.id === hotel.id))) {
            for (const a of alerts) {
                const rule = owner.rules[a.rule];
                if (!rule?.on) continue;
                if (a.rule === "discount" && !(a.min >= rule.pct)) continue;
                if (await raise(owner.mobile, { ...a, hotelId: hotel.id })) raised++;
            }
        }
    }
    return raised;
}

/* ------------------------------ low stock ------------------------------ */

/** Items that went low in a stock upload since `since` - once per item per business day. */
async function scanLowStock(now, since, owners) {
    let raised = 0;
    const hotels = new Map();
    for (const owner of owners) for (const h of owner.hotels) hotels.set(h.id, h);
    for (const hotel of hotels.values()) {
        const fresh = await M.OwnerStockLevel.count({ where: { hotel_id: hotel.id, updatedAt: { [Op.gte]: since } } });
        if (!fresh) continue;
        const clock = await outletClock(hotel.id);
        const day = businessDate(clock, now);
        const low = ((await stockLevels(hotel.id)) || []).filter((l) => l.status !== "OK" && l.reorder > 0);
        for (const owner of owners.filter((x) => x.rules.lowStock.on && x.hotels.some((h) => h.id === hotel.id))) {
            // One row per item in the Alerts screen, but one notification for
            // several items going low in the same upload (no buzz per item).
            const fresh = [];
            for (const l of low) {
                const row = await raise(owner.mobile, {
                    ref: `low:${hotel.id}:${l.kind}:${l.id}:${day}`, kind: "low-stock", hotelId: hotel.id, at: now,
                    title: l.status === "Negative" ? `${l.name} has gone below zero` : `${l.name} is running low`,
                    body: `${Number(l.qty).toLocaleString("en-IN")} ${l.unit} left · minimum ${Number(l.reorder).toLocaleString("en-IN")} ${l.unit} · ${shortName(hotel.hotel_name)}`,
                    link: `/manage/stock/${hotel.id}`,
                }, { push: false });
                if (row) fresh.push(row);
            }
            raised += fresh.length;
            if (!fresh.length) continue;
            const one = fresh.length === 1;
            try {
                const r = await pushToOwner(owner.mobile, {
                    title: one ? fresh[0].title : `${fresh.length} items running low at ${shortName(hotel.hotel_name)}`,
                    body: one ? fresh[0].body : fresh.map((x) => x.title.replace(/ is running low| has gone below zero/, "")).join(", "),
                    link: `/manage/stock/${hotel.id}`, kind: "low-stock",
                });
                if (r.sent) await M.OwnerAlert.update({ pushed: true }, { where: { id: fresh.map((x) => x.id) } });
            } catch (err) {
                console.error("[owner-alerts] push failed:", err.message);
            }
        }
    }
    return raised;
}

/* ------------------------------ day summary ------------------------------ */

/** The owner's business day summary, every outlet (also the Day summary screen). */
async function summaryFor(o, date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ""))) fail("Pick a day");
    const r = await rules(o);
    const outlets = [];
    const look = { cancelled: 0, cancelledAfterKot: 0, cancelledValue: 0, discounts: 0, discountOver: 0, edited: [], cashDiff: [], expenses: 0 };
    for (const { hotel } of o.owned) {
        const v = await outletView(o, hotel.id, { key: "custom", from: date, to: date });
        outlets.push({ id: hotel.id, name: hotel.hotel_name, net: v.net, bills: v.bills, items: v.items, compareNet: v.compareNet });
        look.expenses = r2(look.expenses + v.expenses);
        const orders = await L.loadOrderViews(hotel.id, { business_date: date });
        for (const x of orders) {
            if (x.status === "cancelled") {
                look.cancelled++;
                look.cancelledValue = r2(look.cancelledValue + x.totals.grand);
                if (x.kots.length) look.cancelledAfterKot++;
            }
            if (x.status === "settled") {
                look.discounts = r2(look.discounts + x.totals.discount);
                if (discountPct(x) >= r.rules.discount.pct && x.totals.discount > 0) look.discountOver++;
                const ev = editedEvent(x);
                if (ev) look.edited.push({ outlet: shortName(hotel.hotel_name), by: ev.by, billNo: x.billNo });
            }
        }
        const clock = await outletClock(hotel.id);
        const sessions = await M.CashSession.findAll({ where: { hotel_id: hotel.id, deleted: false, closed_at: { [Op.ne]: null } }, order: [["closed_at", "DESC"]], limit: 20, raw: true });
        for (const s of sessions) {
            if (businessDate(clock, s.closed_at) !== date || Math.abs(Number(s.variance) || 0) < 1) continue;
            const by = s.hotelUserId ? (await M.HotelUser.findOne({ where: { id: s.hotelUserId }, attributes: ["name"], raw: true }))?.name : "";
            look.cashDiff.push({ outlet: shortName(hotel.hotel_name), amount: r2(s.variance), by: by || "" });
        }
    }
    const net = r2(outlets.reduce((a, x) => a + x.net, 0));
    const bills = outlets.reduce((a, x) => a + x.bills, 0);
    return {
        serverTime: new Date().toISOString(),
        date,
        net, bills,
        avgBill: bills ? r2(net / bills) : 0,
        items: r2(outlets.reduce((a, x) => a + x.items, 0)),
        compareNet: r2(outlets.reduce((a, x) => a + x.compareNet, 0)),
        compareLabel: `vs last ${moment(date).subtract(7, "days").format("ddd")}`,
        outlets: outlets.sort((a, b) => b.net - a.net),
        look,
        discountLimit: r.rules.discount.pct,
    };
}

const daySummary = (o, date) => summaryFor(o, date || businessDate({ timeZone: "Asia/Kolkata", dayStart: "00:00" }, new Date(Date.now() - 86400000)));

async function sendSummaries(now, owners) {
    let raised = 0;
    for (const owner of owners) {
        if (!owner.rules.summary.on) continue;
        const clock = await outletClock(owner.hotels[0].id);
        const local = moment(now).tz(clock.timeZone);
        const [h, m] = owner.rules.summary.time.split(":").map(Number);
        const due = local.clone().hour(h).minute(m).second(0);
        if (local.isBefore(due) || local.diff(due, "hours", true) >= SUMMARY_WINDOW_H) continue;
        const date = businessDate(clock, due.toDate());
        const ref = `summary:${date}`;
        if (await M.OwnerAlert.count({ where: { owner_mobile: owner.mobile, ref } })) continue;
        const owned = await ownedOutlets(owner.mobile);
        const o = { mobile: owner.mobile, owned, outletIds: new Set(owned.map((x) => x.hotel.id)) };
        const s = await summaryFor(o, date);
        const worth = [s.look.cancelled ? `${s.look.cancelled} cancelled` : null, s.look.discountOver ? `${s.look.discountOver} big discount${s.look.discountOver === 1 ? "" : "s"}` : null, s.look.edited.length ? `${s.look.edited.length} edited` : null, s.look.cashDiff.length ? "cash difference" : null].filter(Boolean);
        if (await raise(owner.mobile, {
            ref, kind: "summary", at: now,
            title: `Day summary · ${moment(date).format("ddd, D MMM")}`,
            body: `${money(s.net)} across ${s.outlets.length} outlet${s.outlets.length === 1 ? "" : "s"} · ${s.bills} bills${worth.length ? ` · ${worth.join(", ")}` : ""}`,
            link: `/summary/${date}`,
        })) raised++;
    }
    return raised;
}

/* ------------------------------ the job ------------------------------ */

let lastScan = null;

/** Runs every minute (server.js). `now` can be given for tests. */
async function runOwnerAlerts(now = new Date()) {
    const since = lastScan || new Date(now.getTime() - 15 * 60000);
    const owners = await scope();
    if (!owners.length) {
        lastScan = now;
        return { owners: 0 };
    }
    // A minute of overlap: rows written while the previous run was going are looked at again (refs stop repeats).
    const from = new Date(since.getTime() - 60000);
    const out = {
        owners: owners.length,
        pc: await watchPcs(now, owners),
        risky: await scanRisky(now, from, owners),
        lowStock: await scanLowStock(now, from, owners),
        summary: await sendSummaries(now, owners),
    };
    lastScan = now;
    return out;
}

/* ------------------------------ the app's calls ------------------------------ */

const FILTER_KINDS = {
    risky: ["cancel-after-kot", "discount", "edited", "cash-diff"],
    pc: ["pc-offline", "pc-online"],
    stock: ["low-stock"],
    summary: ["summary"],
};

async function alerts(o, q = {}) {
    const where = { owner_mobile: o.mobile, ...(FILTER_KINDS[q.filter] ? { kind: FILTER_KINDS[q.filter] } : {}), ...(Number(q.before) > 0 ? { id: { [Op.lt]: Number(q.before) } } : {}) };
    // Only the owner's current outlets (an outlet sold or moved to Plan 2 drops out).
    where[Op.or] = [{ hotel_id: null }, { hotel_id: [...o.outletIds] }];
    const rows = await M.OwnerAlert.findAll({ where, order: [["event_at", "DESC"], ["id", "DESC"]], limit: 50, raw: true });
    const unread = await alertCount(o);
    return {
        serverTime: new Date().toISOString(),
        unread: unread.unread,
        more: rows.length === 50,
        alerts: rows.map((a) => ({ id: a.id, kind: a.kind, title: a.title, body: a.body, link: a.link, at: new Date(a.event_at).toISOString(), read: !!a.read_at, outletId: a.hotel_id })),
    };
}

async function alertCount(o) {
    const unread = await M.OwnerAlert.count({ where: { owner_mobile: o.mobile, read_at: null, [Op.or]: [{ hotel_id: null }, { hotel_id: [...o.outletIds] }] } });
    return { unread };
}

async function markAlertsRead(o, ids) {
    const where = { owner_mobile: o.mobile, read_at: null };
    if (ids !== "all") where.id = (Array.isArray(ids) ? ids : [ids]).map(Number).filter((x) => x > 0);
    await M.OwnerAlert.update({ read_at: new Date() }, { where });
    return alertCount(o);
}

/** The outlet PC's offline spells in the last 7 days (PC screen). */
async function pcHistory(o, outletId) {
    const { hotel } = ownOutlet(o, outletId);
    const rows = await M.OwnerOfflinePeriod.findAll({ where: { hotel_id: hotel.id, started_at: { [Op.gte]: new Date(Date.now() - 7 * 86400000) } }, order: [["started_at", "DESC"]], limit: 30, raw: true });
    return {
        serverTime: new Date().toISOString(),
        periods: rows.map((p) => ({ from: new Date(p.started_at).toISOString(), to: p.ended_at ? new Date(p.ended_at).toISOString() : null, minutes: Math.max(1, Math.round(((p.ended_at ? new Date(p.ended_at) : new Date()) - new Date(p.started_at)) / 60000)) })),
        tracking: true,
    };
}

module.exports = {
    RULE_DEFAULTS, rules, saveRules, alerts, alertCount, markAlertsRead, daySummary, pcHistory,
    runOwnerAlerts, watchPcs, scanRisky, scanLowStock, sendSummaries, scope, summaryFor,
    _resetForTests: () => { lastScan = null; },
};

