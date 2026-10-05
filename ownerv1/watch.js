const { Op } = require("sequelize");
const moment = require("moment-timezone");
const M = require("../model");
const { fail, r2, outletClock, businessDate, resolveRole } = require("../appv1/core");
const L = require("../appv1/load");
const { ownOutlet: guardOutlet } = require("./outlets");

// Owner App phase 1 "Watch" (design v1: Home, Outlet live, Running tables,
// Bills, Bill detail). Read-only, from what the outlet PCs have synced: bills
// arrive every 3 min, so every answer carries serverTime for "updated X ago".
// Orders are read through the POS App's own order view (appv1/load.js), so
// the same bill shows the same figures in every BillerPe app.

const MODE_NAMES = { cash: "Cash", upi: "UPI", card: "Card", due: "Due" };
const OVERDUE_MIN = 90;
/** How far back an unsettled bill still counts as running (older = abandoned legacy rows). */
const RUNNING_DAYS = 2;

/** { hotel, user } of an outlet this owner has. Every per-outlet call starts here (multi-tenant guard). */
function ownOutlet(o, outletId) {
    const id = guardOutlet(o, outletId);
    return o.owned.find((x) => x.hotel.id === id);
}

const shiftDay = (day, n) => moment(day, "YYYY-MM-DD").add(n, "days").format("YYYY-MM-DD");

/** { key: today|yesterday|7d|30d|custom, from, to } -> business-date range + the period before it. */
function rangeOf(clock, range = {}) {
    const today = businessDate(clock);
    let from = today;
    let to = today;
    switch (range.key) {
        case "yesterday": from = to = shiftDay(today, -1); break;
        case "7d": from = shiftDay(today, -6); break;
        case "30d": from = shiftDay(today, -29); break;
        case "custom":
            if (/^\d{4}-\d{2}-\d{2}$/.test(range.from || "") && /^\d{4}-\d{2}-\d{2}$/.test(range.to || "")) {
                from = range.from <= range.to ? range.from : range.to;
                to = range.from <= range.to ? range.to : range.from;
            }
            if (moment(to).diff(moment(from), "days") > 92) fail("Pick at most 3 months at a time");
            break;
        default: break;
    }
    const days = moment(to).diff(moment(from), "days") + 1;
    return { key: range.key || "today", from, to, today, days, isToday: from === today && to === today };
}

const paymentName = (modeId, modes) => MODE_NAMES[modeId] || modes.find((m) => m.id === modeId)?.name || String(modeId).replace(/^name:/, "");
const sum = (rows, f) => r2(rows.reduce((a, x) => a + (Number(f(x)) || 0), 0));
const linesOf = (o) => [...o.kots.flatMap((k) => k.lines), ...o.heldLines];
const lineAmount = (l) => l.price * l.qty + l.addons.reduce((a, x) => a + x.price * x.qty, 0);
const firedAny = (o) => o.kots.length > 0;
const editedAfterSettle = (o) => o.timeline.some((t) => t.label === "Edited after settle" || t.label === "Order updated");
const discountPct = (o) => (o.totals.subtotal > 0 ? Math.round((o.totals.discount / o.totals.subtotal) * 100) : 0);

/** Settled bills of the range, running bills now, cancelled bills of the range - one outlet. */
async function outletOrders(hotelId, clock, r) {
    const runningFrom = shiftDay(r.today, -RUNNING_DAYS);
    const orders = await L.loadOrderViews(hotelId, {
        [Op.or]: [
            { business_date: { [Op.between]: [r.from, r.to] } },
            { deleted: false, payment: "pending", business_date: { [Op.gte]: runningFrom } },
        ],
    });
    const inRange = (o) => o.businessDate >= r.from && o.businessDate <= r.to;
    return {
        all: orders,
        settled: orders.filter((o) => o.status === "settled" && inRange(o)),
        cancelled: orders.filter((o) => o.status === "cancelled" && inRange(o)),
        running: orders.filter((o) => ["running", "hold", "billed"].includes(o.status) && o.businessDate >= runningFrom),
    };
}

/** Net sales of the same weekday a week before, up to this time of day (today) or the whole period before (other ranges). */
async function compareNet(hotelId, clock, r) {
    const where = { hotel_id: hotelId, deleted: false, payment: "success" };
    if (r.isToday) {
        const day = shiftDay(r.today, -7);
        const rows = await M.Order.findAll({ where: { ...where, business_date: day }, attributes: ["grandAmount", "createdAt"], raw: true });
        const now = moment.tz(clock.timeZone);
        // Up to this moment of that day: business day start + the time elapsed today.
        const [h, m] = clock.dayStart.split(":").map(Number);
        const todayStart = moment.tz(r.today, "YYYY-MM-DD", clock.timeZone).hour(h).minute(m);
        const cutoff = moment.tz(day, "YYYY-MM-DD", clock.timeZone).hour(h).minute(m).add(now.diff(todayStart), "ms");
        return { label: `vs last ${moment(day).format("ddd")}`, net: sum(rows.filter((x) => moment(x.createdAt).isSameOrBefore(cutoff)), (x) => x.grandAmount) };
    }
    const from = shiftDay(r.from, -r.days);
    const to = shiftDay(r.from, -1);
    const rows = await M.Order.findAll({ where: { ...where, business_date: { [Op.between]: [from, to] } }, attributes: ["grandAmount"], raw: true });
    return { label: r.days === 1 ? `vs ${moment(from).format("ddd")} before` : `vs previous ${r.days} days`, net: sum(rows, (x) => x.grandAmount) };
}

const deltaPct = (now, before) => (before > 0 ? Math.round(((now - before) / before) * 100) : null);

/** Sales per hour of the business day (24 buckets starting at the day start hour). */
function hourly(settled, clock) {
    const startHour = Number(clock.dayStart.split(":")[0]) || 0;
    const buckets = Array.from({ length: 24 }, (_, i) => ({ hour: (startHour + i) % 24, amount: 0 }));
    for (const o of settled) {
        const h = moment(o.settledAt || o.createdAt).tz(clock.timeZone).hour();
        const b = buckets[(h - startHour + 24) % 24];
        b.amount = r2(b.amount + o.totals.grand);
    }
    return buckets;
}

const nowIndex = (clock) => (moment.tz(clock.timeZone).hour() - (Number(clock.dayStart.split(":")[0]) || 0) + 24) % 24;

/** The outlet's tables; a switched-off table that still has a running bill (ids in `inUse`) is kept - its bill is real. */
async function tablesOf(hotelId, inUse = []) {
    const [tables, sections] = await Promise.all([
        M.Table.findAll({
            where: { hotel_id: hotelId, [Op.or]: [{ active: { [Op.not]: false } }, ...(inUse.length ? [{ id: inUse.map(Number) }] : [])] },
            attributes: ["id", "table_name", "table_catag_id", "table_status"], order: [["id", "ASC"]], raw: true,
        }),
        M.TableCatagories.findAll({ where: { hotel_id: hotelId }, attributes: ["id", "table_catag_nm", "active"], order: [["id", "ASC"]], raw: true }),
    ]);
    return { tables, sections };
}

/* ------------------------------ home ------------------------------ */

async function home(o) {
    const out = [];
    for (const { hotel } of o.owned) {
        const clock = await outletClock(hotel.id);
        const r = rangeOf(clock, { key: "today" });
        const [orders, cmp, { tables }] = await Promise.all([outletOrders(hotel.id, clock, r), compareNet(hotel.id, clock, r), tablesOf(hotel.id)]);
        const net = sum(orders.settled, (x) => x.totals.grand);
        const runningTables = new Set(orders.running.filter((x) => x.tableId).map((x) => x.tableId));
        out.push({
            id: hotel.id,
            net,
            compareNet: cmp.net,
            compareLabel: cmp.label,
            bills: orders.settled.length,
            items: r2(orders.settled.reduce((a, x) => a + x.totals.items, 0)),
            runningTables: runningTables.size,
            totalTables: tables.length,
            openAmount: sum(orders.running, (x) => x.totals.grand),
            cancelled: orders.cancelled.length,
            hourly: hourly(orders.settled, clock),
            nowIndex: nowIndex(clock),
            dayStart: clock.dayStart,
            attention: attentionOf(orders, hotel.id),
        });
    }
    const latest = out.map((x) => x.attention).filter(Boolean).sort((a, b) => (a.at < b.at ? 1 : -1))[0] || null;
    return { serverTime: new Date().toISOString(), outlets: out.map(({ attention, ...rest }) => rest), attention: latest };
}

/** The newest thing worth the owner's look today (phase 4 turns these into push alerts). */
function attentionOf(orders, outletId) {
    const items = [];
    for (const x of orders.cancelled) {
        const ev = [...x.timeline].reverse().find((t) => t.label.startsWith("Cancelled"));
        items.push({ kind: firedAny(x) ? "cancel-after-kot" : "cancel", outletId, billId: x.id, billNo: x.billNo, amount: x.totals.grand, by: ev?.by || "", at: ev?.at || x.createdAt, reason: x.cancelReason || "" });
    }
    for (const x of orders.settled) {
        if (editedAfterSettle(x)) {
            const ev = [...x.timeline].reverse().find((t) => t.label === "Edited after settle" || t.label === "Order updated");
            items.push({ kind: "edited", outletId, billId: x.id, billNo: x.billNo, amount: x.totals.grand, by: ev?.by || "", at: ev?.at || x.createdAt });
        }
        if (discountPct(x) >= 20) items.push({ kind: "discount", outletId, billId: x.id, billNo: x.billNo, amount: x.totals.discount, pct: discountPct(x), by: x.settledBy || "", at: x.settledAt || x.createdAt });
    }
    return items.sort((a, b) => (a.at < b.at ? 1 : -1))[0] || null;
}

/* ------------------------------ outlet ------------------------------ */

async function outlet(o, outletId, range) {
    const { hotel } = ownOutlet(o, outletId);
    const clock = await outletClock(hotel.id);
    const r = rangeOf(clock, range);
    const [orders, cmp, { tables }, modeRows, expenses, cash] = await Promise.all([
        outletOrders(hotel.id, clock, r),
        compareNet(hotel.id, clock, r),
        tablesOf(hotel.id),
        M.PaymentMode.findAll({ where: { hotel_id: hotel.id }, raw: true }),
        M.ExpenseEntry.findAll({ where: { hotel_id: hotel.id, deleted: { [Op.not]: true }, business_date: { [Op.between]: [r.from, r.to] } }, attributes: ["amount"], raw: true }),
        openCash(hotel.id),
    ]);
    const modes = L.paymentModesView(modeRows);
    const s = orders.settled;
    const net = sum(s, (x) => x.totals.grand);
    const byMode = new Map();
    for (const x of s) for (const p of x.payments) byMode.set(p.modeId, r2((byMode.get(p.modeId) || 0) + p.amount));
    const items = new Map();
    for (const x of s) {
        for (const l of linesOf(x)) {
            const cur = items.get(l.name) || { name: l.name, qty: 0, amount: 0 };
            cur.qty = r2(cur.qty + l.qty);
            cur.amount = r2(cur.amount + lineAmount(l));
            items.set(l.name, cur);
        }
    }
    const runningTables = new Set(orders.running.filter((x) => x.tableId).map((x) => x.tableId));
    const hours = r.days === 1 ? hourly(s, clock) : null;
    const days = r.days > 1 ? perDay(s, r) : null;
    return {
        serverTime: new Date().toISOString(),
        id: hotel.id,
        name: hotel.hotel_name,
        range: { key: r.key, from: r.from, to: r.to, days: r.days, isToday: r.isToday },
        net,
        compareNet: cmp.net,
        compareLabel: cmp.label,
        bills: s.length,
        avgBill: s.length ? r2(net / s.length) : 0,
        items: r2(s.reduce((a, x) => a + x.totals.items, 0)),
        discount: sum(s, (x) => x.totals.discount),
        tax: sum(s, (x) => x.totals.tax),
        expenses: sum(expenses, (e) => e.amount),
        cancelled: orders.cancelled.length,
        hourly: hours,
        nowIndex: r.isToday ? nowIndex(clock) : null,
        daily: days,
        runningTables: runningTables.size,
        totalTables: tables.length,
        openAmount: sum(orders.running, (x) => x.totals.grand),
        cash,
        payments: [...byMode.entries()].map(([modeId, amount]) => ({ name: paymentName(modeId, modes), amount })).sort((a, b) => b.amount - a.amount),
        topItems: [...items.values()].sort((a, b) => b.amount - a.amount).slice(0, 5),
    };
}

function perDay(settled, r) {
    const out = [];
    for (let d = r.from; d <= r.to; d = shiftDay(d, 1)) out.push({ day: d, amount: sum(settled.filter((x) => x.businessDate === d), (x) => x.totals.grand) });
    return out;
}

/** The open cash drawer: what should be in it (every movement of the session), since when, whose. */
async function openCash(hotelId) {
    const s = await M.CashSession.findOne({ where: { hotel_id: hotelId, status: "Open", deleted: false }, order: [["opened_at", "DESC"], ["id", "DESC"]], raw: true });
    if (!s) return null;
    const [expected, user] = await Promise.all([
        M.CashMovement.sum("amount", { where: { cashSessionId: s.id } }),
        s.hotelUserId ? M.HotelUser.findOne({ where: { id: s.hotelUserId, hotel_id: hotelId }, attributes: ["name"], raw: true }) : null,
    ]);
    return { expected: r2(expected || 0), openedAt: s.opened_at ? new Date(s.opened_at).toISOString() : null, by: user?.name || "" };
}

/* ------------------------------ running tables ------------------------------ */

async function tables(o, outletId) {
    const { hotel } = ownOutlet(o, outletId);
    const clock = await outletClock(hotel.id);
    const r = rangeOf(clock, { key: "today" });
    const runningFrom = shiftDay(r.today, -RUNNING_DAYS);
    const running = await L.loadOrderViews(hotel.id, { deleted: false, payment: "pending", business_date: { [Op.gte]: runningFrom } });
    const { tables: rows, sections } = await tablesOf(hotel.id, running.map((x) => x.tableId).filter(Boolean));
    const byTable = new Map();
    for (const x of running) if (x.tableId && x.status !== "settled") byTable.set(x.tableId, x);
    const now = Date.now();
    const view = (t) => {
        const x = byTable.get(String(t.id));
        if (!x) return { id: String(t.id), name: t.table_name, state: "free" };
        const opened = x.timeline[0]?.at || x.createdAt;
        const minutes = Math.max(0, Math.round((now - new Date(opened).getTime()) / 60000));
        return {
            id: String(t.id),
            name: t.table_name,
            state: x.status === "billed" || x.billPrintedAt ? "billed" : "running",
            billId: x.id,
            billNo: x.billNo,
            amount: x.totals.grand,
            minutes,
            overdue: minutes >= OVERDUE_MIN,
            captain: x.captainName || x.kots[0]?.firedByName || x.timeline[0]?.by || "",
        };
    };
    const used = new Set();
    const out = [];
    for (const sec of sections) {
        const list = rows.filter((t) => String(t.table_catag_id) === String(sec.id));
        if (!list.length) continue;
        list.forEach((t) => used.add(t.id));
        out.push({ id: String(sec.id), name: sec.table_catag_nm, tables: list.map(view) });
    }
    const loose = rows.filter((t) => !used.has(t.id));
    if (loose.length) out.push({ id: "none", name: "Other tables", tables: loose.map(view) });
    const pickup = running.filter((x) => !x.tableId && x.status !== "settled");
    return {
        serverTime: new Date().toISOString(),
        sections: out,
        running: out.reduce((a, s) => a + s.tables.filter((t) => t.state !== "free").length, 0),
        total: rows.length,
        pickup: pickup.map((x) => ({ billId: x.id, billNo: x.billNo, amount: x.totals.grand, createdAt: x.createdAt })),
    };
}

/* ------------------------------ bills ------------------------------ */

const FILTERS = ["all", "running", "settled", "cancelled", "edited", "due", "discount"];

function tagOf(x) {
    if (x.status === "cancelled") return { tone: "brand", text: firedAny(x) ? "Cancelled after KOT" : "Cancelled" };
    if (x.status === "settled" && editedAfterSettle(x)) return { tone: "warn", text: "Edited after settle" };
    if (x.status === "settled" && x.dueOutstanding) return { tone: "warn", text: "Due" };
    if (x.status === "settled" && discountPct(x) >= 20) return { tone: "warn", text: `${discountPct(x)}% discount` };
    if (x.status === "settled") return { tone: "ok", text: "Settled" };
    if (x.status === "billed") return { tone: "warn", text: "Bill printed" };
    if (x.status === "hold") return { tone: "muted", text: "On hold" };
    return { tone: "info", text: "Running" };
}

const matches = (x, f) => {
    switch (f) {
        case "running": return ["running", "hold", "billed"].includes(x.status);
        case "settled": return x.status === "settled";
        case "cancelled": return x.status === "cancelled";
        case "edited": return x.status === "settled" && editedAfterSettle(x);
        case "due": return x.status === "settled" && !!x.dueOutstanding;
        case "discount": return x.status !== "cancelled" && x.totals.discount > 0;
        default: return true;
    }
};

const PAGE = 40;

/**
 * Every bill of the range, newest first, across the owner's outlets (or one).
 * { outletId?: number|"all", range, filter, search, offset }
 */
async function bills(o, q = {}) {
    const filter = FILTERS.includes(q.filter) ? q.filter : "all";
    const outlets = q.outletId && q.outletId !== "all" ? [ownOutlet(o, q.outletId)] : o.owned;
    const search = String(q.search || "").trim().toLowerCase();
    const rows = [];
    for (const { hotel } of outlets) {
        const clock = await outletClock(hotel.id);
        const r = rangeOf(clock, q.range);
        const [orders, { tables: tbl, sections }, modeRows] = await Promise.all([
            outletOrders(hotel.id, clock, r),
            tablesOf(hotel.id),
            M.PaymentMode.findAll({ where: { hotel_id: hotel.id }, raw: true }),
        ]);
        const modes = L.paymentModesView(modeRows);
        const tableName = (id) => {
            const t = tbl.find((x) => String(x.id) === String(id));
            if (!t) return "";
            const sec = sections.find((s) => String(s.id) === String(t.table_catag_id));
            return sec ? `${t.table_name} ${sec.table_catag_nm}` : t.table_name;
        };
        const seen = new Set();
        for (const x of [...orders.settled, ...orders.cancelled, ...orders.running]) {
            if (seen.has(x.id)) continue;
            seen.add(x.id);
            rows.push({ x, hotel, tableName: x.tableId ? tableName(x.tableId) : "", modes });
        }
    }
    const searched = search
        ? rows.filter(({ x, tableName }) => [x.billNo, tableName, x.customerName, x.customerMobile].some((v) => v && String(v).toLowerCase().includes(search)))
        : rows;
    const counts = Object.fromEntries(FILTERS.map((f) => [f, searched.filter(({ x }) => matches(x, f)).length]));
    const list = searched
        .filter(({ x }) => matches(x, filter))
        .sort((a, b) => (a.x.createdAt < b.x.createdAt ? 1 : a.x.createdAt > b.x.createdAt ? -1 : Number(b.x.id) - Number(a.x.id)));
    const offset = Math.max(0, Number(q.offset) || 0);
    return {
        serverTime: new Date().toISOString(),
        counts,
        more: list.length > offset + PAGE,
        bills: list.slice(offset, offset + PAGE).map(({ x, hotel, tableName, modes }) => ({
            id: x.id,
            outletId: hotel.id,
            outletName: hotel.hotel_name,
            billNo: x.billNo,
            place: x.type === "pickup" ? "Pickup" : tableName || "Dine-in",
            status: x.status,
            amount: x.totals.grand,
            at: x.status === "settled" ? x.settledAt || x.createdAt : x.createdAt,
            sub: subLine(x, modes),
            tag: tagOf(x),
        })),
    };
}

function subLine(x, modes) {
    if (x.status === "cancelled") return [...x.timeline].reverse().find((t) => t.label.startsWith("Cancelled"))?.by || "";
    if (x.status === "settled" && editedAfterSettle(x)) return `edited by ${[...x.timeline].reverse().find((t) => t.label === "Edited after settle" || t.label === "Order updated")?.by || "staff"}`;
    if (x.status === "settled") {
        if (x.dueOutstanding && x.customerName) return x.customerName;
        return [...new Set(x.payments.map((p) => paymentName(p.modeId, modes)))].join(" + ");
    }
    return x.captainName || x.kots[0]?.firedByName || "";
}

/* ------------------------------ bill detail ------------------------------ */

async function bill(o, outletId, billId) {
    const { hotel } = ownOutlet(o, outletId);
    const x = await L.loadOrderView(hotel.id, billId);
    if (!x) fail("This bill is not on the outlet any more");
    const [{ tables: tbl, sections }, modeRows, events, staff] = await Promise.all([
        tablesOf(hotel.id),
        M.PaymentMode.findAll({ where: { hotel_id: hotel.id }, raw: true }),
        M.TimeLine.findAll({ where: { order_id: Number(billId), hotel_id: hotel.id }, attributes: ["action", "event_name", "creator", "created_Date", "createdAt", "hotelUserId"], raw: true }),
        M.HotelUser.findAll({ where: { hotel_id: hotel.id }, attributes: ["id", "name"], include: M.Role }),
    ]);
    const modes = L.paymentModesView(modeRows);
    const roleOf = new Map(staff.map((u) => [u.id, resolveRole(u.role_mst?.role_name)]));
    const t = x.tableId ? tbl.find((r) => String(r.id) === x.tableId) : null;
    const sec = t ? sections.find((s) => String(s.id) === String(t.table_catag_id)) : null;
    const settleEv = [...events].reverse().find((e) => e.action === "settle");
    return {
        serverTime: new Date().toISOString(),
        id: x.id,
        outletId: hotel.id,
        outletName: hotel.hotel_name,
        billNo: x.billNo,
        status: x.status,
        tag: tagOf(x),
        type: x.type,
        table: t ? t.table_name : null,
        section: sec ? sec.table_catag_nm : null,
        createdAt: x.createdAt,
        businessDate: x.businessDate,
        captain: x.captainName || x.kots[0]?.firedByName || "",
        cashier: x.settledBy || settleEv?.creator || "",
        customer: x.customerName || x.customerMobile ? { name: x.customerName || "", mobile: x.customerMobile || "" } : null,
        kots: x.kots.map((k) => ({
            no: k.kotNo,
            at: k.firedAt,
            by: k.firedByName,
            lines: k.lines.map((l) => ({ name: l.name, variant: l.variantName || "", addons: l.addons.map((a) => (a.qty > 1 ? `${a.name} ×${a.qty}` : a.name)).join(", "), note: l.note || "", qty: l.qty, amount: r2(lineAmount(l)) })),
        })),
        held: x.heldLines.map((l) => ({ name: l.name, qty: l.qty, amount: r2(lineAmount(l)) })),
        totals: {
            subtotal: x.totals.subtotal,
            discount: x.totals.discount,
            discountReason: x.discount?.reason || "",
            service: x.totals.service,
            packaging: x.totals.packaging,
            taxLines: x.totals.taxLines.map((tl) => ({ name: tl.type === "pr" ? `${tl.name} ${tl.rate}%` : tl.name, amount: tl.amount })),
            roundOff: x.totals.roundOff,
            grand: x.totals.grand,
        },
        payments: x.payments.map((p) => ({ name: paymentName(p.modeId, modes), amount: p.amount })),
        dueOutstanding: x.dueOutstanding || 0,
        cancelReason: x.cancelReason || "",
        activity: events
            .sort((a, b) => new Date(a.created_Date || a.createdAt) - new Date(b.created_Date || b.createdAt))
            .map((e) => ({
                at: new Date(e.created_Date || e.createdAt).toISOString(),
                action: e.action || "",
                label: e.event_name && e.event_name !== e.action ? e.event_name : x.timeline.find((v) => v.at === new Date(e.created_Date || e.createdAt).toISOString())?.label || e.action || "Updated",
                by: e.creator || "",
                role: e.hotelUserId ? roleOf.get(e.hotelUserId) || "" : "",
            })),
    };
}

module.exports = { home, outlet, tables, bills, bill, ownOutlet, rangeOf };
