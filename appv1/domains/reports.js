const { Op } = require("sequelize");
const moment = require("moment-timezone");
const M = require("../../model");
const { need, r2, outletClock, businessDate } = require("../core");
const L = require("../load");
const { ledgerSummary } = require("../engine/stockLedger");

// Dashboard and reports for POS App outlets, by business day (the outlet's
// day start time, in its own time zone). Same figures as the app's spec
// (BillerPe POS App src/lib/pos/backend/mock/reports.ts), computed from the
// real tables; the stock ledger comes from the exe's own ledger
// (engine/stockLedger.js#ledgerSummary).

const TITLES = {
    "day-wise": "Day-wise sales", "item-wise": "Item-wise sales", "category-wise": "Category-wise sales", tax: "Tax (GST)",
    discount: "Discounts", kot: "KOT report", cancelled: "Cancelled orders", staff: "Staff performance", table: "Table performance",
    "payment-mode": "Payment modes", "due-collected": "Due collected", "cash-session": "Cash sessions", expense: "Expenses",
    purchase: "Purchases", "closing-stock": "Closing stock", "stock-ledger": "Stock ledger", wastage: "Wastage",
};
const STOCK_REPORTS = ["purchase", "closing-stock", "stock-ledger", "wastage"];

const sum = (rows, f) => r2(rows.reduce((a, x) => a + (Number(f(x)) || 0), 0));
const inRange = (d, r) => d >= r.from && d <= r.to;

function rangeDays(clock, range) {
    const today = businessDate(clock);
    const shift = (n) => moment.tz(today, "YYYY-MM-DD", clock.timeZone).subtract(n, "days").format("YYYY-MM-DD");
    switch (range?.key) {
        case "yesterday": return { from: shift(1), to: shift(1) };
        case "7d": return { from: shift(6), to: today };
        case "30d": return { from: shift(29), to: today };
        case "custom": return { from: range.from || today, to: range.to || today };
        default: return { from: today, to: today };
    }
}

const orderLines = (o) => [...o.kots.flatMap((k) => k.lines), ...o.heldLines];
const lineAmount = (l) => l.price * l.qty + l.addons.reduce((a, x) => a + x.price * x.qty, 0);

/** Everything a report reads, for the range (orders from `ordersFrom`). */
async function data(c, r, ordersFrom, opts = {}) {
    const hotelId = c.hotelId;
    const clock = await outletClock(hotelId);
    const since = moment.tz(r.from, "YYYY-MM-DD", clock.timeZone).subtract(1, "day").toDate();
    const [orders, staff, tables, categories, modeRows] = await Promise.all([
        L.loadOrderViews(hotelId, {
            [Op.or]: [
                { business_date: { [Op.between]: [ordersFrom, r.to] } },
                ...(opts.withOpen ? [{ deleted: false, payment: "pending" }] : []),
            ],
        }),
        M.HotelUser.findAll({ where: { hotel_id: hotelId }, attributes: ["id", "name"], raw: true }),
        M.Table.findAll({ where: { hotel_id: hotelId }, attributes: ["id", "table_name"], raw: true }),
        M.Menu_categ.findAll({ where: { hotel_id: hotelId }, attributes: ["id", "menu_categ_nm"], raw: true }),
        M.PaymentMode.findAll({ where: { hotel_id: hotelId }, raw: true }),
    ]);
    const names = new Map(staff.map((s) => [s.id, s.name]));
    const modes = L.paymentModesView(modeRows);
    const day = (at) => businessDate(clock, at);
    return {
        clock, orders, names, day,
        fmtDay: (d) => moment(d, "YYYY-MM-DD").format("D MMM YYYY"),
        modeName: (id) => modes.find((m) => m.id === id)?.name ?? id,
        tableName: (id) => tables.find((t) => String(t.id) === String(id))?.table_name ?? "—",
        categoryName: (id) => categories.find((x) => String(x.id) === String(id))?.menu_categ_nm ?? "Custom",
        staffName: (id) => names.get(Number(id)),
        since,
    };
}

function settledIn(d, r, filters = {}) {
    const staffName = filters.staffId ? d.staffName(filters.staffId) : undefined;
    return d.orders.filter((o) =>
        o.status === "settled" && inRange(o.businessDate, r) &&
        (!staffName || o.captainName === staffName || o.settledBy === staffName) &&
        (!filters.modeId || o.payments.some((p) => p.modeId === filters.modeId)));
}

/* ------------------------------ dashboard ------------------------------ */

async function dashboard(c, range) {
    need(c, "dashboard", "view");
    const clock = await outletClock(c.hotelId);
    const r = rangeDays(clock, range);
    const trendFrom = moment(r.to, "YYYY-MM-DD").subtract(6, "days").format("YYYY-MM-DD");
    const d = await data(c, r, trendFrom < r.from ? trendFrom : r.from, { withOpen: true });
    const settled = settledIn(d, r);
    const cancelled = d.orders.filter((o) => o.status === "cancelled" && inRange(o.businessDate, r));
    const running = d.orders.filter((o) => ["running", "hold", "billed"].includes(o.status));
    const net = sum(settled, (o) => o.totals.grand);
    const byMode = new Map();
    for (const o of settled) for (const p of o.payments) byMode.set(p.modeId, r2((byMode.get(p.modeId) ?? 0) + p.amount));
    const hourly = Array.from({ length: 24 }, (_, hour) => ({ hour, amount: 0 }));
    for (const o of settled) {
        const h = moment(o.settledAt || o.createdAt).tz(clock.timeZone).hour();
        hourly[h].amount = r2(hourly[h].amount + o.totals.grand);
    }
    const trend = [];
    for (let i = 6; i >= 0; i--) {
        const day = moment(r.to, "YYYY-MM-DD").subtract(i, "days").format("YYYY-MM-DD");
        trend.push({ day: moment(day, "YYYY-MM-DD").format("D MMM"), amount: sum(d.orders.filter((o) => o.status === "settled" && o.businessDate === day), (o) => o.totals.grand) });
    }
    const items = new Map();
    for (const o of settled) {
        for (const l of orderLines(o)) {
            const cur = items.get(l.name) ?? { name: l.name, qty: 0, amount: 0 };
            cur.qty = r2(cur.qty + l.qty);
            cur.amount = r2(cur.amount + lineAmount(l));
            items.set(l.name, cur);
        }
    }
    const expenses = await M.ExpenseEntry.findAll({ where: { hotel_id: c.hotelId, deleted: { [Op.not]: true }, business_date: { [Op.between]: [r.from, r.to] } }, attributes: ["amount"], raw: true });
    return {
        net,
        bills: settled.length,
        avgBill: settled.length ? r2(net / settled.length) : 0,
        guests: settled.reduce((a, o) => a + o.guests, 0),
        runningCount: running.length,
        runningAmount: sum(running, (o) => o.totals.grand),
        cancelledCount: cancelled.length,
        cancelledAmount: sum(cancelled, (o) => o.totals.grand),
        discounts: sum(settled, (o) => o.totals.discount),
        expenses: sum(expenses, (e) => e.amount),
        byMode: [...byMode.entries()].map(([modeId, amount]) => ({ modeId, name: d.modeName(modeId), amount })).sort((a, b) => b.amount - a.amount),
        hourly,
        trend,
        topItems: [...items.values()].sort((a, b) => b.amount - a.amount).slice(0, 5),
        byType: [
            { label: "Dine-in", amount: sum(settled.filter((o) => o.type === "dinin" && !o.fromQr), (o) => o.totals.grand) },
            { label: "Pickup", amount: sum(settled.filter((o) => o.type === "pickup"), (o) => o.totals.grand) },
            { label: "QR", amount: sum(settled.filter((o) => o.fromQr), (o) => o.totals.grand) },
        ],
    };
}

/* ------------------------------ reports ------------------------------ */

const perGroup = (rows, keyOf, init) => {
    const map = new Map();
    for (const o of rows) {
        const k = keyOf(o);
        const cur = map.get(k) ?? init(o);
        cur.bills += 1;
        cur.guests += o.guests;
        cur.sales = r2(cur.sales + o.totals.grand);
        map.set(k, cur);
    }
    return [...map.values()];
};

async function report(c, id, range, filters = {}) {
    need(c, STOCK_REPORTS.includes(id) ? "stock-reports" : "reports", "view");
    const clock = await outletClock(c.hotelId);
    const r = rangeDays(clock, range);
    const title = TITLES[id] ?? "Report";
    const d = await data(c, r, r.from);
    const settled = settledIn(d, r, filters);

    switch (id) {
        case "day-wise": {
            const rows = perGroup(settled, (o) => o.businessDate, (o) => ({ day: o.businessDate, bills: 0, guests: 0, sales: 0 }))
                .sort((a, b) => b.day.localeCompare(a.day))
                .map((x) => ({ ...x, day: d.fmtDay(x.day) }));
            return {
                title,
                columns: [{ key: "day", label: "Day" }, { key: "bills", label: "Bills", num: true }, { key: "guests", label: "Guests", num: true }, { key: "sales", label: "Net sales", money: true }],
                rows,
                totals: { day: "Total", bills: sum(rows, (x) => x.bills), guests: sum(rows, (x) => x.guests), sales: sum(rows, (x) => x.sales) },
                summary: [{ label: "Net sales", value: sum(rows, (x) => x.sales), money: true }, { label: "Bills", value: sum(rows, (x) => x.bills) }, { label: "Days", value: rows.length }],
            };
        }
        case "item-wise":
        case "category-wise": {
            const map = new Map();
            for (const o of settled) {
                for (const l of orderLines(o)) {
                    const cat = l.categoryId ? d.categoryName(l.categoryId) : "Custom";
                    const key = id === "item-wise" ? `${l.name}|${l.variantName ?? ""}` : cat;
                    const cur = map.get(key) ?? { name: id === "item-wise" ? `${l.name}${l.variantName ? ` (${l.variantName})` : ""}` : cat, category: cat, qty: 0, amount: 0 };
                    cur.qty = r2(cur.qty + l.qty);
                    cur.amount = r2(cur.amount + lineAmount(l));
                    map.set(key, cur);
                }
            }
            const rows = [...map.values()].sort((a, b) => b.amount - a.amount);
            return {
                title,
                columns: id === "item-wise"
                    ? [{ key: "name", label: "Item" }, { key: "category", label: "Category" }, { key: "qty", label: "Qty", num: true }, { key: "amount", label: "Amount", money: true }]
                    : [{ key: "name", label: "Category" }, { key: "qty", label: "Qty", num: true }, { key: "amount", label: "Amount", money: true }],
                rows,
                totals: { name: "Total", category: "", qty: sum(rows, (x) => x.qty), amount: sum(rows, (x) => x.amount) },
                summary: [{ label: "Qty sold", value: sum(rows, (x) => x.qty) }, { label: "Gross", value: sum(rows, (x) => x.amount), money: true }, { label: "Top", value: rows[0]?.name ?? "—" }],
            };
        }
        case "tax": {
            const map = new Map();
            for (const o of settled) {
                for (const t of o.totals.taxLines) {
                    const key = `${t.name} ${t.type === "pr" ? `${t.rate}%` : ""}`.trim();
                    map.set(key, r2((map.get(key) ?? 0) + t.amount));
                }
            }
            const rows = [...map.entries()].map(([tax, amount]) => ({ tax, amount }));
            return {
                title,
                columns: [{ key: "tax", label: "Tax" }, { key: "amount", label: "Amount", money: true }],
                rows,
                totals: { tax: "Total tax", amount: sum(rows, (x) => x.amount) },
                summary: [{ label: "Taxable value", value: sum(settled, (o) => o.totals.subtotal - o.totals.discount), money: true }, { label: "Tax", value: sum(rows, (x) => x.amount), money: true }, { label: "Bills", value: settled.length }],
            };
        }
        case "discount": {
            const rows = settled.filter((o) => o.totals.discount > 0).map((o) => ({ bill: o.billNo, day: d.fmtDay(o.businessDate), reason: o.discount?.reason ?? "", by: o.settledBy ?? "", amount: o.totals.discount }));
            return {
                title,
                columns: [{ key: "bill", label: "Bill" }, { key: "day", label: "Day" }, { key: "reason", label: "Reason" }, { key: "amount", label: "Discount", money: true }],
                rows,
                totals: { bill: "Total", day: "", reason: "", amount: sum(rows, (x) => x.amount) },
                summary: [{ label: "Discounts", value: sum(rows, (x) => x.amount), money: true }, { label: "Bills", value: rows.length }],
            };
        }
        case "kot": {
            const rows = d.orders
                .filter((o) => inRange(o.businessDate, r))
                .flatMap((o) => o.kots.map((k) => ({
                    kot: k.kotNo, bill: o.billNo, table: o.tableId ? d.tableName(o.tableId) : `Token ${o.token}`, by: k.firedByName,
                    items: k.lines.reduce((a, l) => a + l.qty, 0), time: moment(k.firedAt).tz(d.clock.timeZone).format("D MMM, h:mm a"), _at: k.firedAt,
                })))
                .sort((a, b) => String(b._at).localeCompare(String(a._at)))
                .map(({ _at, ...x }) => x);
            return {
                title,
                columns: [{ key: "kot", label: "KOT", num: true }, { key: "bill", label: "Bill" }, { key: "table", label: "Table" }, { key: "by", label: "By" }, { key: "items", label: "Items", num: true }, { key: "time", label: "Time" }],
                rows,
                summary: [{ label: "KOTs", value: rows.length }, { label: "Items", value: sum(rows, (x) => x.items) }],
            };
        }
        case "cancelled": {
            const rows = d.orders.filter((o) => o.status === "cancelled" && inRange(o.businessDate, r)).map((o) => ({ bill: o.billNo, day: d.fmtDay(o.businessDate), reason: o.cancelReason ?? "", amount: o.totals.grand }));
            return {
                title,
                columns: [{ key: "bill", label: "Bill" }, { key: "day", label: "Day" }, { key: "reason", label: "Reason" }, { key: "amount", label: "Amount", money: true }],
                rows,
                totals: { bill: "Total", day: "", reason: "", amount: sum(rows, (x) => x.amount) },
                summary: [{ label: "Cancelled", value: rows.length }, { label: "Value", value: sum(rows, (x) => x.amount), money: true }],
            };
        }
        case "staff": {
            const rows = perGroup(settled, (o) => o.captainName, (o) => ({ staff: o.captainName, bills: 0, guests: 0, sales: 0 })).sort((a, b) => b.sales - a.sales);
            return {
                title,
                columns: [{ key: "staff", label: "Staff" }, { key: "bills", label: "Bills", num: true }, { key: "guests", label: "Guests", num: true }, { key: "sales", label: "Sales", money: true }],
                rows,
                totals: { staff: "Total", bills: sum(rows, (x) => x.bills), guests: sum(rows, (x) => x.guests), sales: sum(rows, (x) => x.sales) },
                summary: [{ label: "Sales", value: sum(rows, (x) => x.sales), money: true }, { label: "Staff", value: rows.length }],
            };
        }
        case "table": {
            const rows = perGroup(settled.filter((o) => o.tableId), (o) => d.tableName(o.tableId), (o) => ({ table: d.tableName(o.tableId), bills: 0, guests: 0, sales: 0 })).sort((a, b) => b.sales - a.sales);
            return {
                title,
                columns: [{ key: "table", label: "Table" }, { key: "bills", label: "Bills", num: true }, { key: "guests", label: "Guests", num: true }, { key: "sales", label: "Sales", money: true }],
                rows,
                totals: { table: "Total", bills: sum(rows, (x) => x.bills), guests: sum(rows, (x) => x.guests), sales: sum(rows, (x) => x.sales) },
                summary: [{ label: "Sales", value: sum(rows, (x) => x.sales), money: true }, { label: "Tables used", value: rows.length }],
            };
        }
        case "payment-mode": {
            const map = new Map();
            for (const o of settled) {
                for (const p of o.payments) {
                    const cur = map.get(p.modeId) ?? { mode: d.modeName(p.modeId), bills: 0, amount: 0 };
                    cur.bills += 1;
                    cur.amount = r2(cur.amount + p.amount);
                    map.set(p.modeId, cur);
                }
            }
            const rows = [...map.values()].sort((a, b) => b.amount - a.amount);
            return {
                title,
                columns: [{ key: "mode", label: "Mode" }, { key: "bills", label: "Bills", num: true }, { key: "amount", label: "Amount", money: true }],
                rows,
                totals: { mode: "Total", bills: sum(rows, (x) => x.bills), amount: sum(rows, (x) => x.amount) },
                summary: [{ label: "Collected", value: sum(rows, (x) => x.amount), money: true }, { label: "Modes", value: rows.length }],
            };
        }
        case "due-collected": {
            const [rowsDb, outstanding] = await Promise.all([
                M.DuePaymentReceive.findAll({ where: { hotel_id: c.hotelId, deleted: { [Op.not]: true }, business_date: { [Op.between]: [r.from, r.to] } }, include: [{ model: M.User, attributes: ["name", "number"] }], order: [["id", "DESC"]] }),
                M.Order.sum("due", { where: { hotel_id: c.hotelId, deleted: false, due: { [Op.gt]: 0 } } }),
            ]);
            const rows = rowsDb.map((x) => ({ customer: x.hms_user_master?.name || "", mobile: x.hms_user_master?.number || "", mode: x.payment_mode, by: d.names.get(x.settle_by) ?? "", amount: r2(x.amount) }));
            return {
                title,
                columns: [{ key: "customer", label: "Customer" }, { key: "mobile", label: "Mobile" }, { key: "mode", label: "Mode" }, { key: "amount", label: "Amount", money: true }],
                rows,
                totals: { customer: "Total", mobile: "", mode: "", amount: sum(rows, (x) => x.amount) },
                summary: [{ label: "Collected", value: sum(rows, (x) => x.amount), money: true }, { label: "Outstanding now", value: r2(outstanding), money: true }],
            };
        }
        case "cash-session": {
            const { cashSession, cashHistory } = await L.cashView(c.hotelId, d.names);
            const all = [...(cashSession ? [cashSession] : []), ...cashHistory].filter((s) => inRange(d.day(new Date(s.openedAt)), r));
            const rows = all.map((s) => ({
                opened: moment(s.openedAt).tz(d.clock.timeZone).format("D MMM, h:mm a"), by: s.openedBy, float: s.openingFloat,
                expected: s.expected ?? 0, counted: s.counted ?? 0, diff: s.closedAt ? r2((s.counted ?? 0) - (s.expected ?? 0)) : 0, status: s.closedAt ? "Closed" : "Open",
            }));
            return {
                title,
                columns: [{ key: "opened", label: "Opened" }, { key: "by", label: "By" }, { key: "float", label: "Float", money: true }, { key: "expected", label: "Expected", money: true }, { key: "counted", label: "Counted", money: true }, { key: "diff", label: "Difference", money: true }, { key: "status", label: "Status" }],
                rows,
                summary: [{ label: "Sessions", value: rows.length }, { label: "Total difference", value: sum(rows, (x) => x.diff), money: true }],
            };
        }
        case "expense": {
            const { expenseHeads, expenses } = await L.expensesView(c.hotelId, d.names, d.since);
            const rows = expenses.filter((e) => inRange(d.day(new Date(e.at)), r)).map((e) => ({
                day: d.fmtDay(d.day(new Date(e.at))), head: expenseHeads.find((h) => h.id === e.headId)?.name ?? "", note: e.note, mode: d.modeName(e.modeId), amount: e.amount,
            }));
            return {
                title,
                columns: [{ key: "day", label: "Day" }, { key: "head", label: "Head" }, { key: "note", label: "Note" }, { key: "mode", label: "Mode" }, { key: "amount", label: "Amount", money: true }],
                rows,
                totals: { day: "Total", head: "", note: "", mode: "", amount: sum(rows, (x) => x.amount) },
                summary: [{ label: "Expenses", value: sum(rows, (x) => x.amount), money: true }, { label: "Entries", value: rows.length }],
            };
        }
        case "purchase": {
            const st = await L.stockView(c.hotelId, d.names, d.since);
            const rows = st.purchases.filter((p) => inRange(p.date, r)).map((p) => {
                const paid = sum(p.payments, (x) => x.amount);
                return { po: p.poNo, day: d.fmtDay(p.date), supplier: st.suppliers.find((s) => s.id === p.supplierId)?.name ?? "", total: p.total, paid, balance: r2(p.total - paid) };
            });
            return {
                title,
                columns: [{ key: "po", label: "PO" }, { key: "day", label: "Day" }, { key: "supplier", label: "Supplier" }, { key: "total", label: "Total", money: true }, { key: "paid", label: "Paid", money: true }, { key: "balance", label: "Balance", money: true }],
                rows,
                totals: { po: "Total", day: "", supplier: "", total: sum(rows, (x) => x.total), paid: sum(rows, (x) => x.paid), balance: sum(rows, (x) => x.balance) },
                summary: [{ label: "Purchased", value: sum(rows, (x) => x.total), money: true }, { label: "Unpaid", value: sum(rows, (x) => x.balance), money: true }],
            };
        }
        case "closing-stock": {
            const st = await L.stockView(c.hotelId, d.names, d.since);
            const unit = (uid) => st.units.find((u) => u.id === uid)?.short ?? "";
            const rows = st.raw.map((m) => ({
                item: m.name, category: m.category, stock: m.stock, unit: unit(m.unitId), value: r2(Math.max(0, m.stock) * m.rate),
                status: m.stock < 0 ? "Negative" : m.stock <= m.reorderLevel ? "Low" : "OK",
            }));
            return {
                title,
                columns: [{ key: "item", label: "Item" }, { key: "stock", label: "Stock", num: true }, { key: "unit", label: "Unit" }, { key: "value", label: "Value", money: true }, { key: "status", label: "Status" }],
                rows,
                totals: { item: "Total", stock: "", unit: "", value: sum(rows, (x) => x.value), status: "" },
                summary: [{ label: "Stock value", value: sum(rows, (x) => x.value), money: true }, { label: "Low", value: rows.filter((x) => x.status === "Low").length }, { label: "Negative", value: rows.filter((x) => x.status === "Negative").length }],
            };
        }
        case "stock-ledger": {
            // The exe's own ledger (purchase units), shown in the consumption unit like the rest of the app.
            const [ledger, raws] = await Promise.all([ledgerSummary(c.hotelId, r.from, r.to), M.RawMaterial.findAll({ where: { hotel_id: c.hotelId }, attributes: ["id", "conversion_qty"], raw: true })]);
            const conv = new Map(raws.map((x) => [x.id, Number(x.conversion_qty) || 1]));
            const rows = ledger.rows.map((x) => {
                const k = conv.get(x.raw_material_id) || 1;
                return {
                    item: x.raw_material_name, opening: r2(x.opening_qty * k), purchased: r2(x.purchased_qty * k), used: r2(-x.used_qty * k),
                    wastage: r2(-x.wastage_qty * k), manual: r2(x.manual_qty * k), closing: r2(x.closing_qty * k),
                };
            });
            return {
                title,
                columns: [{ key: "item", label: "Item" }, { key: "opening", label: "Opening", num: true }, { key: "purchased", label: "+ Purchased", num: true }, { key: "used", label: "− Used", num: true }, { key: "wastage", label: "− Wastage", num: true }, { key: "manual", label: "± Manual", num: true }, { key: "closing", label: "= Closing", num: true }],
                rows,
                summary: [{ label: "Items", value: rows.length }, { label: "Closing value", value: ledger.totals.closing_value, money: true }],
            };
        }
        case "wastage": {
            const st = await L.stockView(c.hotelId, d.names, d.since);
            const rows = st.wastage.filter((w) => inRange(d.day(new Date(w.at)), r)).map((w) => ({
                day: d.fmtDay(d.day(new Date(w.at))), item: (w.refKind === "raw" ? st.raw : st.semi).find((x) => x.id === w.refId)?.name ?? "", qty: w.qty, reason: w.reason, cost: w.cost,
            }));
            return {
                title,
                columns: [{ key: "day", label: "Day" }, { key: "item", label: "Item" }, { key: "qty", label: "Qty", num: true }, { key: "reason", label: "Reason" }, { key: "cost", label: "Cost", money: true }],
                rows,
                totals: { day: "Total", item: "", qty: "", reason: "", cost: sum(rows, (x) => x.cost) },
                summary: [{ label: "Wastage cost", value: sum(rows, (x) => x.cost), money: true }, { label: "Entries", value: rows.length }],
            };
        }
        default:
            return { title, columns: [], rows: [], summary: [] };
    }
}

module.exports = {
    dashboard: { fn: dashboard },
    report: { fn: report },
};
