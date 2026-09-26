const { Op } = require("sequelize");
const moment = require("moment-timezone");
const M = require("../../model");
const { need, outletClock, businessDate } = require("../core");
const { loadOrderViews, loadOrderView } = require("../load");

// The POS App's Orders screen (owner bug list 2026-09-26): every order ever,
// newest first, 20 a page as the list is scrolled, by status tab and
// business-day range, with a search that runs here - bill no, token,
// customer name or mobile, table name.

const PAGE = 20;
const OPEN = { deleted: false, payment: "pending" };

function statusWhere(status) {
    switch (status) {
        case "running": return { ...OPEN };
        case "settled": return { deleted: false, payment: "success" };
        case "cancelled": return { deleted: true };
        case "due": return { deleted: false, due: { [Op.gt]: 0 } };
        default: return {};
    }
}

function rangeWhere(clock, status, range = {}) {
    if (status === "running" || !range.key || range.key === "all") return {};
    const today = businessDate(clock);
    const day = (n) => moment.tz(today, "YYYY-MM-DD", clock.timeZone).subtract(n, "days").format("YYYY-MM-DD");
    const [from, to] =
        range.key === "today" ? [today, today]
            : range.key === "yesterday" ? [day(1), day(1)]
                : range.key === "7d" ? [day(6), today]
                    : range.key === "month" ? [`${today.slice(0, 8)}01`, today]
                        : [String(range.from || today).slice(0, 10), String(range.to || today).slice(0, 10)];
    return { business_date: { [Op.between]: [from, to] } };
}

async function searchWhere(hotelId, raw) {
    const s = String(raw || "").trim();
    if (!s) return null;
    const like = { [Op.like]: `%${s}%` };
    const [users, tables] = await Promise.all([
        M.User.findAll({ where: { hotel_id: hotelId, [Op.or]: [{ number: like }, { name: like }] }, attributes: ["id"], limit: 500, raw: true }),
        M.Table.findAll({ where: { hotel_id: hotelId, table_name: s }, attributes: ["id"], raw: true }),
    ]);
    const or = [{ bill_no: s }, { bill_no: { [Op.like]: `${s}%` } }];
    if (/^\d{1,4}$/.test(s)) or.push({ token: Number(s) });
    if (users.length) or.push({ UserId: users.map((u) => u.id) });
    if (tables.length) or.push({ TableId: tables.map((t) => t.id) });
    return { [Op.or]: or };
}

async function listOrders(c, q = {}) {
    need(c, "orders", "view");
    const clock = await outletClock(c.hotelId);
    const where = {
        hotel_id: c.hotelId,
        ...statusWhere(q.status),
        ...rangeWhere(clock, q.status, q.range),
    };
    const search = await searchWhere(c.hotelId, q.search);
    // (Operator keys are symbols: Object.keys would not see them.)
    const full = search ? { [Op.and]: [where, search] } : where;
    const page = Math.max(0, Number(q.page) || 0);
    const [total, rows, running, due] = await Promise.all([
        M.Order.count({ where: full }),
        M.Order.findAll({ where: full, attributes: ["id"], order: [["createdAt", "DESC"], ["id", "DESC"]], limit: PAGE, offset: page * PAGE, raw: true }),
        M.Order.count({ where: { hotel_id: c.hotelId, ...OPEN } }),
        M.Order.count({ where: { hotel_id: c.hotelId, deleted: false, due: { [Op.gt]: 0 } } }),
    ]);
    const ids = rows.map((r) => r.id);
    const views = ids.length ? await loadOrderViews(c.hotelId, { id: ids }) : [];
    const byId = new Map(views.map((o) => [o.id, o]));
    return {
        orders: ids.map((id) => byId.get(String(id))).filter(Boolean),
        total,
        hasMore: (page + 1) * PAGE < total,
        counts: { running, due },
    };
}

async function getOrder(c, orderId) {
    need(c, "orders", "view");
    const view = await loadOrderView(c.hotelId, orderId);
    return view ?? null;
}

module.exports = {
    listOrders: { fn: listOrders },
    getOrder: { fn: getOrder },
};
