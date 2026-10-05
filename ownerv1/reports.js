const { Op } = require("sequelize");
const moment = require("moment-timezone");
const M = require("../model");
const { fail, r2, outletClock, buildContext } = require("../appv1/core");
const L = require("../appv1/load");
const base = require("../appv1/domains/reports");
const { ownOutlet, rangeOf } = require("./watch");

// Owner App phase 2 "Reports" (design v1): every report for any date range,
// for one outlet or all of the owner's outlets together. Sales and finance
// reports are the POS App's own (appv1/domains/reports.js) computed per
// outlet on the bills its PC uploaded, so the figures match every BillerPe
// app; the owner-only ones (hourly, outlet comparison, cancelled & edited,
// dues, stock) are worked out here. The app turns `table` into PDF / Excel.

const CATALOG = [
    { id: "day-wise", group: "Sales", name: "Day wise sales", desc: "Sales and bills per business day" },
    { id: "item-wise", group: "Sales", name: "Item wise sales", desc: "Quantity and revenue per item", views: [["item", "By item"], ["category", "By category"], ["outlet", "By outlet"]] },
    { id: "category-wise", group: "Sales", name: "Category wise sales", desc: "Revenue by menu category" },
    { id: "payment-mode", group: "Sales", name: "Payment mode", desc: "Cash, UPI, card, due and custom modes" },
    { id: "hourly", group: "Sales", name: "Hourly sales", desc: "Busy hours across the day" },
    { id: "outlets", group: "Sales", name: "Outlet comparison", desc: "All outlets side by side" },
    { id: "cancelled-edited", group: "Control & finance", name: "Cancelled & edited bills", desc: "With who did it and the reason", views: [["cancelled", "Cancelled"], ["edited", "Edited after settle"]] },
    { id: "discount", group: "Control & finance", name: "Discount report", desc: "Every discount and promo code" },
    { id: "tax", group: "Control & finance", name: "Tax report", desc: "CGST and SGST per business day" },
    { id: "cash-session", group: "Control & finance", name: "Cash sessions", desc: "Opening, closing and difference" },
    { id: "due", group: "Control & finance", name: "Due & due received", desc: "Who owes what and what came back", views: [["outstanding", "Due now"], ["received", "Received"]] },
    { id: "expense", group: "Control & finance", name: "Expenses", desc: "By expense head" },
    { id: "stock", group: "Stock", name: "Stock in hand & ledger", desc: "Every movement with its reason", views: [["in-hand", "In hand"], ["ledger", "Ledger"]] },
    { id: "purchases-wastage", group: "Stock", name: "Purchases & wastage", desc: "Purchase orders, payments, wastage", views: [["purchases", "Purchases"], ["wastage", "Wastage"]] },
];
const byId = new Map(CATALOG.map((r) => [r.id, r]));

const sum = (rows, f) => r2(rows.reduce((a, x) => a + (Number(f(x)) || 0), 0));
const lineAmount = (l) => l.price * l.qty + l.addons.reduce((a, x) => a + x.price * x.qty, 0);
const fmtDay = (d) => moment(d, "YYYY-MM-DD").format("D MMM YYYY");
const hourName = (h) => moment({ hour: h }).format("h A");

function catalog() {
    return { reports: CATALOG.map(({ views, ...r }) => ({ ...r, views: (views || []).map(([key, label]) => ({ key, label })) })) };
}

/** The owner's context at one outlet, for the POS App's report engine (owner = every permission). */
async function contextAt(owned) {
    const cx = await buildContext(owned.hotel.id, owned.user.id, "owner-app");
    if (!cx) fail("Your owner login at this outlet is switched off");
    return cx;
}

/** Settled / cancelled orders of the range at one outlet, through the POS App's order view. */
async function ordersIn(hotelId, r) {
    return L.loadOrderViews(hotelId, { business_date: { [Op.between]: [r.from, r.to] } });
}

const editedEvent = (o) => [...o.timeline].reverse().find((t) => t.label === "Edited after settle" || t.label === "Order updated");
const cancelEvent = (o) => [...o.timeline].reverse().find((t) => t.label.startsWith("Cancelled"));

/* ------------------------------ one outlet ------------------------------ */

/** One report at one outlet: { columns, rows, totals?, summary, merge? } (POS App shape). */
async function atOutlet(owned, id, view, r, clock) {
    const hotelId = owned.hotel.id;
    const range = { key: "custom", from: r.from, to: r.to };
    const engine = async (baseId) => base.report.fn(await contextAt(owned), baseId, range, {});
    switch (id) {
        case "day-wise": {
            const x = await engine("day-wise");
            return dropGuests(x, "day");
        }
        case "item-wise":
            if (view === "outlet") {
                const orders = (await ordersIn(hotelId, r)).filter((o) => o.status === "settled");
                const lines = orders.flatMap((o) => [...o.kots.flatMap((k) => k.lines), ...o.heldLines]);
                return { columns: [], rows: [{ outlet: owned.hotel.hotel_name, qty: sum(lines, (l) => l.qty), amount: sum(lines, lineAmount) }], summary: [] };
            }
            return { ...(await engine(view === "category" ? "category-wise" : "item-wise")), merge: "name" };
        case "category-wise":
            return { ...(await engine("category-wise")), merge: "name" };
        case "payment-mode":
            return { ...(await engine("payment-mode")), merge: "mode" };
        case "tax":
            return { ...(await engine("tax")), merge: "tax" };
        case "cash-session":
        case "expense":
            return engine(id);
        case "purchases-wastage":
            return engine(view === "wastage" ? "wastage" : "purchase");
        case "hourly": {
            const settled = (await ordersIn(hotelId, r)).filter((o) => o.status === "settled");
            const map = new Map();
            for (const o of settled) {
                const h = moment(o.settledAt || o.createdAt).tz(clock.timeZone).hour();
                const cur = map.get(h) || { hourNo: h, hour: hourName(h), bills: 0, sales: 0 };
                cur.bills += 1;
                cur.sales = r2(cur.sales + o.totals.grand);
                map.set(h, cur);
            }
            return {
                columns: [{ key: "hour", label: "Hour" }, { key: "bills", label: "Bills", num: true }, { key: "sales", label: "Sales", money: true }],
                rows: [...map.values()],
                totals: { hour: "Total", bills: settled.length, sales: sum(settled, (o) => o.totals.grand) },
                summary: [{ label: "Sales", value: sum(settled, (o) => o.totals.grand), money: true }, { label: "Bills", value: settled.length }],
                merge: "hour",
            };
        }
        case "outlets": {
            const orders = await ordersIn(hotelId, r);
            const settled = orders.filter((o) => o.status === "settled");
            const exp = await M.ExpenseEntry.sum("amount", { where: { hotel_id: hotelId, deleted: { [Op.not]: true }, business_date: { [Op.between]: [r.from, r.to] } } });
            const net = sum(settled, (o) => o.totals.grand);
            return {
                columns: [],
                rows: [{
                    outlet: owned.hotel.hotel_name, bills: settled.length, sales: net, avg: settled.length ? r2(net / settled.length) : 0,
                    discount: sum(settled, (o) => o.totals.discount), cancelled: orders.filter((o) => o.status === "cancelled").length, expenses: r2(exp || 0),
                }],
                summary: [],
            };
        }
        case "cancelled-edited": {
            const orders = await ordersIn(hotelId, r);
            if (view === "edited") {
                const rows = orders.filter((o) => o.status === "settled" && editedEvent(o)).map((o) => {
                    const ev = editedEvent(o);
                    return { bill: o.billNo, day: fmtDay(o.businessDate), by: ev.by || "", time: moment(ev.at).tz(clock.timeZone).format("h:mm A"), amount: o.totals.grand };
                });
                return {
                    columns: [{ key: "bill", label: "Bill" }, { key: "day", label: "Day" }, { key: "by", label: "Edited by" }, { key: "time", label: "Time" }, { key: "amount", label: "Now", money: true }],
                    rows,
                    totals: { bill: "Total", day: "", by: "", time: "", amount: sum(rows, (x) => x.amount) },
                    summary: [{ label: "Edited bills", value: rows.length }, { label: "Value now", value: sum(rows, (x) => x.amount), money: true }],
                };
            }
            const rows = orders.filter((o) => o.status === "cancelled").map((o) => {
                const ev = cancelEvent(o);
                return {
                    bill: o.billNo, day: fmtDay(o.businessDate), by: ev?.by || "", after: o.kots.length ? "After KOT" : "Before KOT",
                    reason: o.cancelReason || "", amount: o.totals.grand,
                };
            });
            return {
                columns: [{ key: "bill", label: "Bill" }, { key: "day", label: "Day" }, { key: "by", label: "Cancelled by" }, { key: "after", label: "When" }, { key: "reason", label: "Reason" }, { key: "amount", label: "Amount", money: true }],
                rows,
                totals: { bill: "Total", day: "", by: "", after: "", reason: "", amount: sum(rows, (x) => x.amount) },
                summary: [{ label: "Cancelled", value: rows.length }, { label: "After KOT", value: rows.filter((x) => x.after === "After KOT").length }, { label: "Value", value: sum(rows, (x) => x.amount), money: true }],
            };
        }
        case "discount": {
            const orders = (await ordersIn(hotelId, r)).filter((o) => o.status === "settled" && o.totals.discount > 0);
            const rows = orders.map((o) => ({
                bill: o.billNo, day: fmtDay(o.businessDate), reason: o.promoCode ? `Promo ${o.promoCode}` : o.discount?.reason || "", by: o.settledBy || "",
                pct: o.totals.subtotal > 0 ? Math.round((o.totals.discount / o.totals.subtotal) * 100) : 0, amount: o.totals.discount,
            }));
            return {
                columns: [{ key: "bill", label: "Bill" }, { key: "day", label: "Day" }, { key: "reason", label: "Reason" }, { key: "by", label: "By" }, { key: "pct", label: "%", num: true }, { key: "amount", label: "Discount", money: true }],
                rows,
                totals: { bill: "Total", day: "", reason: "", by: "", pct: "", amount: sum(rows, (x) => x.amount) },
                summary: [{ label: "Discounts", value: sum(rows, (x) => x.amount), money: true }, { label: "Bills", value: rows.length }],
            };
        }
        case "due": {
            if (view === "received") return engine("due-collected");
            const orders = await L.loadOrderViews(hotelId, { deleted: false, due: { [Op.gt]: 0 } });
            const rows = orders.filter((o) => o.dueOutstanding > 0).map((o) => ({ customer: o.customerName || "", mobile: o.customerMobile || "", bill: o.billNo, day: fmtDay(o.businessDate), amount: o.dueOutstanding }))
                .sort((a, b) => b.amount - a.amount);
            return {
                columns: [{ key: "customer", label: "Customer" }, { key: "mobile", label: "Mobile" }, { key: "bill", label: "Bill" }, { key: "day", label: "Day" }, { key: "amount", label: "Due", money: true }],
                rows,
                totals: { customer: "Total", mobile: "", bill: "", day: "", amount: sum(rows, (x) => x.amount) },
                summary: [{ label: "Due now", value: sum(rows, (x) => x.amount), money: true }, { label: "Bills", value: rows.length }],
            };
        }
        case "stock":
            return view === "ledger" ? stockLedger(hotelId, r) : stockInHand(hotelId);
        default:
            fail("Unknown report");
    }
    return null;
}

/** Plan 1 PCs never record guests (owner 2026-10-05): leave that column out. */
function dropGuests(x, key) {
    return {
        ...x,
        columns: x.columns.filter((c) => c.key !== "guests"),
        rows: x.rows.map(({ guests, ...row }) => row),
        totals: x.totals ? (({ guests, ...t }) => t)(x.totals) : undefined,
        merge: key,
    };
}

/* ------------------------------ stock (uploaded by the PC) ------------------------------ */

async function stockMasters(hotelId) {
    const [raws, semis, units] = await Promise.all([
        M.RawMaterial.findAll({ where: { hotel_id: hotelId }, attributes: ["id", "raw_material_name", "consumption_unit", "unit_id", "conversion_qty", "mini_stock_level_qty"], raw: true }),
        M.SemiFinishedItem.findAll({ where: { hotel_id: hotelId }, attributes: ["id", "name", "unit_id", "min_stock_qty"], raw: true }),
        M.Unit.findAll({ where: { hotel_id: hotelId }, attributes: ["id", "unit_name", "shortName"], raw: true }),
    ]);
    const unit = (id) => {
        const u = units.find((x) => x.id === id);
        return u ? u.shortName || u.unit_name : "";
    };
    return { raws, semis, unit };
}

/** Every item's level as the PC last uploaded it (consumption unit), with its reorder level. */
async function stockLevels(hotelId) {
    const [levels, { raws, semis, unit }] = await Promise.all([M.OwnerStockLevel.findAll({ where: { hotel_id: hotelId }, raw: true }).catch(() => null), stockMasters(hotelId)]);
    if (levels === null) return null;
    return levels
        .map((l) => {
            const raw = l.kind === "raw" ? raws.find((x) => x.id === l.item_id) : null;
            const semi = l.kind === "semi" ? semis.find((x) => x.id === l.item_id) : null;
            if (!raw && !semi) return null;
            const reorder = Number(raw ? raw.mini_stock_level_qty : semi.min_stock_qty) || 0;
            const qty = r2(l.qty);
            return {
                kind: l.kind, id: l.item_id, name: raw ? raw.raw_material_name : semi.name, unit: unit(raw ? raw.consumption_unit ?? raw.unit_id : semi.unit_id),
                qty, reorder, value: r2(l.value), status: qty < 0 ? "Negative" : reorder > 0 && qty <= reorder ? "Low" : "OK",
                updatedAt: l.updatedAt,
            };
        })
        .filter(Boolean)
        .sort((a, b) => a.name.localeCompare(b.name));
}

async function stockInHand(hotelId) {
    const items = (await stockLevels(hotelId)) || [];
    const rows = items.map((x) => ({ item: x.name, kind: x.kind === "semi" ? "Semi-finished" : "Raw", stock: x.qty, unit: x.unit, reorder: x.reorder, value: x.value, status: x.status }));
    return {
        columns: [{ key: "item", label: "Item" }, { key: "kind", label: "Type" }, { key: "stock", label: "Stock", num: true }, { key: "unit", label: "Unit" }, { key: "reorder", label: "Minimum", num: true }, { key: "value", label: "Value", money: true }, { key: "status", label: "Status" }],
        rows,
        totals: { item: "Total", kind: "", stock: "", unit: "", reorder: "", value: sum(rows, (x) => x.value), status: "" },
        summary: [{ label: "Stock value", value: sum(rows, (x) => x.value), money: true }, { label: "Low", value: rows.filter((x) => x.status === "Low").length }, { label: "Negative", value: rows.filter((x) => x.status === "Negative").length }],
        noStock: !items.length,
    };
}

const LEDGER_COLS = ["purchased", "used", "wastage", "manual", "opening_entry"];

/** The PC's own stock ledger (services/stockLedger.js#ledgerSummary) rebuilt from its daily totals. */
async function stockLedger(hotelId, r) {
    const [days, { raws, unit }] = await Promise.all([
        M.OwnerStockDay.findAll({ where: { hotel_id: hotelId, kind: "raw", business_date: { [Op.lte]: r.to } }, raw: true }).catch(() => []),
        stockMasters(hotelId),
    ]);
    const rows = [];
    let closingValue = 0;
    for (const m of raws) {
        const mine = days.filter((d) => d.item_id === m.id);
        if (!mine.length) continue;
        const k = Number(m.conversion_qty) || 1;
        const tot = (list, c) => list.reduce((a, d) => a + (Number(d[`${c}_qty`]) || 0), 0);
        const val = (list, c) => list.reduce((a, d) => a + (Number(d[`${c}_value`]) || 0), 0);
        const before = mine.filter((d) => String(d.business_date) < r.from);
        const within = mine.filter((d) => String(d.business_date) >= r.from);
        const opening = LEDGER_COLS.reduce((a, c) => a + tot(before, c), 0) + tot(within, "opening_entry");
        const openingValue = LEDGER_COLS.reduce((a, c) => a + val(before, c), 0) + val(within, "opening_entry");
        const row = { item: m.raw_material_name, unit: unit(m.consumption_unit ?? m.unit_id), opening: r2(opening * k), purchased: r2(tot(within, "purchased") * k), used: r2(-tot(within, "used") * k), wastage: r2(-tot(within, "wastage") * k), manual: r2(tot(within, "manual") * k) };
        row.closing = r2(row.opening + row.purchased - row.used - row.wastage + row.manual);
        closingValue += openingValue + ["purchased", "used", "wastage", "manual"].reduce((a, c) => a + val(within, c), 0);
        rows.push(row);
    }
    rows.sort((a, b) => a.item.localeCompare(b.item));
    return {
        columns: [{ key: "item", label: "Item" }, { key: "unit", label: "Unit" }, { key: "opening", label: "Opening", num: true }, { key: "purchased", label: "+ Purchased", num: true }, { key: "used", label: "− Used", num: true }, { key: "wastage", label: "− Wastage", num: true }, { key: "manual", label: "± Manual", num: true }, { key: "closing", label: "= Closing", num: true }],
        rows,
        summary: [{ label: "Items", value: rows.length }, { label: "Closing value", value: r2(closingValue), money: true }],
        noStock: !days.length,
    };
}

/* ------------------------------ combine ------------------------------ */

const NOT_ADDED = new Set(["Days", "Modes", "Tables used", "Staff", "Top", "Items"]);

/** Several outlets into one report: same-name rows merged where the report allows, else each row tagged with its outlet. */
function combine(parts, multi) {
    const first = parts[0]?.result || { columns: [], rows: [], summary: [] };
    const adds = first.columns.filter((c) => c.money || c.num).map((c) => c.key);
    let rows;
    let columns = first.columns;
    if (!multi) rows = first.rows;
    else if (first.merge) {
        const map = new Map();
        for (const p of parts) {
            for (const row of p.result.rows) {
                const k = row[first.merge];
                const cur = map.get(k);
                if (!cur) map.set(k, { ...row });
                else for (const a of adds) cur[a] = r2((Number(cur[a]) || 0) + (Number(row[a]) || 0));
            }
        }
        rows = [...map.values()];
        // Merged rows ranked again by their first amount (days and hours keep their own order).
        const rankBy = first.columns.find((c) => c.money)?.key;
        if (rankBy && first.merge !== "day" && first.merge !== "hour") rows.sort((a, b) => (Number(b[rankBy]) || 0) - (Number(a[rankBy]) || 0));
        if (first.merge === "day") rows.sort((a, b) => moment(b.day, "D MMM YYYY").valueOf() - moment(a.day, "D MMM YYYY").valueOf());
    } else {
        columns = [{ key: "outlet", label: "Outlet" }, ...first.columns];
        rows = parts.flatMap((p) => p.result.rows.map((row) => ({ outlet: p.outlet.hotel_name, ...row })));
    }
    const totals = first.totals
        ? { ...Object.fromEntries(columns.map((c) => [c.key, adds.includes(c.key) ? sum(rows, (x) => x[c.key]) : ""])), [columns[0]?.key]: "Total" }
        : undefined;
    const summary = multi
        ? first.summary.filter((s) => typeof s.value === "number" && !NOT_ADDED.has(s.label)).map((s) => ({ ...s, value: sum(parts, (p) => p.result.summary.find((x) => x.label === s.label)?.value) }))
        : first.summary;
    return { columns, rows, totals, summary };
}

/* ------------------------------ the call ------------------------------ */

/**
 * { id, view?, outletId?: number|"all", range } -> one report ready to show
 * and to download: summary tiles, a visual (bars), and the full table.
 */
async function report(o, q = {}) {
    const def = byId.get(q.id);
    if (!def) fail("Unknown report");
    const view = def.views?.some(([k]) => k === q.view) ? q.view : def.views?.[0]?.[0] || null;
    const outlets = q.outletId && q.outletId !== "all" ? [ownOutlet(o, q.outletId)] : o.owned;
    const multi = outlets.length > 1;
    const parts = [];
    let r = null;
    let noStock = 0;
    for (const owned of outlets) {
        const clock = await outletClock(owned.hotel.id);
        const rr = rangeOf(clock, q.range);
        r = r || rr;
        const result = await atOutlet(owned, def.id, view, rr, clock);
        if (result.noStock) noStock += 1;
        parts.push({ outlet: owned.hotel, result });
    }
    let out;
    if (def.id === "outlets" || (def.id === "item-wise" && view === "outlet")) {
        const rows = parts.map((p) => p.result.rows[0]).sort((a, b) => (b.sales ?? b.amount) - (a.sales ?? a.amount));
        out = def.id === "outlets"
            ? {
                columns: [{ key: "outlet", label: "Outlet" }, { key: "bills", label: "Bills", num: true }, { key: "sales", label: "Sales", money: true }, { key: "avg", label: "Avg bill", money: true }, { key: "discount", label: "Discount", money: true }, { key: "cancelled", label: "Cancelled", num: true }, { key: "expenses", label: "Expenses", money: true }],
                rows,
                totals: { outlet: "Total", bills: sum(rows, (x) => x.bills), sales: sum(rows, (x) => x.sales), avg: "", discount: sum(rows, (x) => x.discount), cancelled: sum(rows, (x) => x.cancelled), expenses: sum(rows, (x) => x.expenses) },
                summary: [{ label: "Sales", value: sum(rows, (x) => x.sales), money: true }, { label: "Outlets", value: rows.length }],
            }
            : {
                columns: [{ key: "outlet", label: "Outlet" }, { key: "qty", label: "Items sold", num: true }, { key: "amount", label: "Revenue", money: true }],
                rows,
                totals: { outlet: "Total", qty: sum(rows, (x) => x.qty), amount: sum(rows, (x) => x.amount) },
                summary: [{ label: "Items sold", value: sum(rows, (x) => x.qty) }, { label: "Revenue", value: sum(rows, (x) => x.amount), money: true }],
            };
    } else {
        out = combine(parts, multi);
    }
    if (def.id === "hourly") out.rows.sort((a, b) => a.hourNo - b.hourNo);
    out.rows = out.rows.map(({ hourNo, ...row }) => row);
    return {
        serverTime: new Date().toISOString(),
        id: def.id,
        title: def.name,
        view,
        views: (def.views || []).map(([key, label]) => ({ key, label })),
        outlets: outlets.map((x) => x.hotel.hotel_name),
        range: { from: r.from, to: r.to },
        ...out,
        visual: visualOf(def.id, view, out),
        note: noStock ? (noStock === outlets.length ? "No stock has been uploaded yet. Stock appears once the outlet PC runs BillerPe 1.1.7 or newer." : `${noStock} outlet${noStock === 1 ? " has" : "s have"} not uploaded stock yet (BillerPe 1.1.7 or newer needed).`) : null,
    };
}

const n = (v) => Number(v || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });

/** What the phone draws: up to 50 bars with a label, a line under it and the value. */
function visualOf(id, view, out) {
    const pick = {
        "day-wise": ["day", "sales", (x) => `${x.bills} bills`],
        "item-wise": view === "outlet" ? ["outlet", "amount", (x) => `${x.qty} sold`] : ["name", "amount", (x) => `${x.qty} sold`],
        "category-wise": ["name", "amount", (x) => `${x.qty} sold`],
        "payment-mode": ["mode", "amount", (x) => `${x.bills} bills`],
        hourly: ["hour", "sales", (x) => `${x.bills} bills`],
        outlets: ["outlet", "sales", (x) => `${x.bills} bills · avg ₹${n(Math.round(x.avg))}`],
        tax: ["tax", "amount", () => ""],
        expense: ["head", "amount", (x) => [x.day, x.note].filter(Boolean).join(" · ")],
        "cancelled-edited": view === "edited" ? ["bill", "amount", (x) => `${x.day} · ${x.by}`] : ["bill", "amount", (x) => [x.after, x.by, x.reason].filter(Boolean).join(" · ")],
        discount: ["bill", "amount", (x) => [`${x.pct}%`, x.reason, x.by].filter(Boolean).join(" · ")],
        "cash-session": ["opened", "diff", (x) => `${x.by} · ${x.status} · expected ₹${n(Math.round(x.expected))}`],
        due: view === "received" ? ["customer", "amount", (x) => [x.mobile, x.mode].filter(Boolean).join(" · ")] : ["customer", "amount", (x) => [x.mobile, `Bill #${x.bill}`, x.day].filter(Boolean).join(" · ")],
        stock: view === "ledger" ? ["item", "closing", (x) => `used ${n(x.used)} · purchased ${n(x.purchased)} ${x.unit}`] : ["item", "stock", (x) => `${x.status}${x.reorder ? ` · minimum ${n(x.reorder)}` : ""} · ₹${n(Math.round(x.value))}`],
        "purchases-wastage": view === "wastage" ? ["item", "cost", (x) => `${x.day} · ${n(x.qty)} · ${x.reason || ""}`] : ["supplier", "total", (x) => `PO ${x.po} · ${x.day} · balance ₹${n(Math.round(x.balance))}`],
    }[id];
    if (!pick) return null;
    const [labelKey, valueKey, subOf] = pick;
    const money = out.columns.find((c) => c.key === valueKey)?.money ?? false;
    const unitOf = id === "stock" ? (x) => x.unit : () => "";
    const items = out.rows.map((x) => ({
        label: String(x[labelKey] ?? ""), outlet: x.outlet, sub: subOf(x), value: Number(x[valueKey]) || 0, unit: unitOf(x),
        // Stock in hand: the bar is the level against the item's own minimum.
        ...(id === "stock" && view !== "ledger" ? { min: Number(x.reorder) || 0, low: x.status !== "OK" } : {}),
    }));
    const ranked = ["day-wise", "hourly", "cash-session", "stock"].includes(id) ? items : [...items].sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
    return { money, items: ranked.slice(0, 50), more: Math.max(0, ranked.length - 50) };
}

module.exports = { catalog, report, stockLevels, CATALOG };
