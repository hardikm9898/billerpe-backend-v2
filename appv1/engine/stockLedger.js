// COPY of billerpe-local-exe/services/stockLedger.js for POS App (Plan 2)
// outlets, whose stock lives on the cloud. Keep the two identical.

const { Op, fn, col } = require("sequelize");
const {
    StockInHand, StockMovement, RawMaterial, RestaurantSetting, SemiFinishedStock, SemiFinishedItem, HotelUser,
} = require("../../model");
const { getBusinessDate } = require("../../utils/dateUtils");

// The ONE place stock in hand changes (2026-09-25 stock overhaul).
//
// Before this, eight separate copies of "change stock" logic (stock in,
// stock out, stock-history edit/delete, manual set, wastage, requisition,
// purchase orders, semi-finished production, sale deduction) each did it
// slightly differently - a first stock-in recorded 1 usable unit whatever
// the quantity, reaching exactly 0 DELETED the stock row so later sales
// skipped that material entirely, sales never reached the history at all.
// Now every path calls applyStockMovement, which updates StockInHand and
// writes a StockMovement journal row in the same transaction.
//
// Rules (owner, 2026-09-25):
// - stock may go negative (a sale is never blocked or shortened); the row
//   is never deleted at 0
// - weighted average cost: goods coming in at a price re-average it,
//   anything going out leaves at the current average

const r4 = (n) => Math.round((Number(n) || 0) * 10000) / 10000;
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Movement types that bring goods in AT A PRICE (re-average the cost).
const PRICED_IN = new Set(["opening", "purchase", "purchase_edit", "stock_in", "requisition", "adjustment"]);

async function businessDateFor(hotel_id, t) {
    const setting = await RestaurantSetting.findOne({ where: { hotel_id }, ...(t ? { transaction: t } : {}) });
    return getBusinessDate(setting?.timeZone || "Asia/Kolkata", setting?.business_day_start_time || "00:01:00");
}

async function stockRowFor(hotel_id, raw_material_id, material, t) {
    const opt = t ? { transaction: t } : {};
    const rows = await StockInHand.findAll({ where: { hotel_id, raw_material_id, deleted: false }, order: [["id", "ASC"]], ...opt });
    if (rows.length > 1) {
        // Older code could leave duplicates; fold them into the first.
        const [keep, ...extra] = rows;
        const qty = rows.reduce((s, r) => s + Number(r.qty), 0);
        const value = rows.reduce((s, r) => s + Number(r.qty) * Number(r.average_price || 0), 0);
        await keep.update({ qty, average_price: String(qty > 0 ? value / qty : keep.average_price) }, opt);
        for (const e of extra) await e.update({ deleted: true }, opt);
        return keep;
    }
    if (rows[0]) return rows[0];
    return StockInHand.create({
        hotel_id, raw_material_id, qty: 0, available_stock_Consiompsion_qty: 0, total_amount: 0,
        price: String(material.purchase_price || 0), average_price: String(material.purchase_price || 0),
    }, opt);
}

/**
 * Change one raw material's stock and journal it.
 * @param {object} m
 * @param {number} m.hotel_id
 * @param {number} m.raw_material_id
 * @param {number} m.qty        signed, in the PURCHASE unit (+ in, - out)
 * @param {string} m.type       see model/stockMovement.js
 * @param {number} [m.unit_cost] per purchase unit; priced inbound types re-average with it,
 *                               a reversal passes the cost it originally left at
 * @param {string} [m.ref_type] @param {number} [m.ref_id] @param {string} [m.note]
 * @param {number} [m.user_id]  @param {object} [m.t] transaction
 * @param {string} [m.business_date] defaults to today's business date
 */
async function applyStockMovement(m) {
    const { hotel_id, raw_material_id, type, t } = m;
    const qty = r4(m.qty);
    const opt = t ? { transaction: t } : {};
    const material = await RawMaterial.findOne({ where: { id: raw_material_id, hotel_id }, ...opt });
    if (!material) throw Object.assign(new Error("Raw material not found"), { status: 400 });
    const conversion = Number(material.conversion_qty) || 1;
    const stock = await stockRowFor(hotel_id, raw_material_id, material, t);

    const oldQty = Number(stock.qty) || 0;
    const oldAvg = Number(stock.average_price) || Number(material.purchase_price) || 0;
    let avg = oldAvg;
    let unitCost = oldAvg;
    if (qty > 0 && m.unit_cost != null && Number.isFinite(Number(m.unit_cost))) {
        unitCost = Number(m.unit_cost);
        if (PRICED_IN.has(type)) {
            // Re-average over what is actually on hand; stock below zero has
            // no cost to average with.
            const base = Math.max(0, oldQty);
            avg = base + qty > 0 ? (base * oldAvg + qty * unitCost) / (base + qty) : unitCost;
        }
    }
    const newQty = r4(oldQty + qty);
    await stock.update({
        qty: newQty,
        available_stock_Consiompsion_qty: r4(newQty * conversion),
        average_price: String(r4(avg)),
        total_amount: r2(newQty * avg),
        ...(qty > 0 && PRICED_IN.has(type) && m.unit_cost != null ? { price: String(m.unit_cost) } : {}),
    }, opt);

    const movement = await StockMovement.create({
        hotel_id, raw_material_id, type, qty,
        business_date: m.business_date || await businessDateFor(hotel_id, t),
        unit_cost: r4(unitCost), value: r2(qty * unitCost), balance_qty: newQty,
        ref_type: m.ref_type || null, ref_id: m.ref_id ?? null, note: m.note || "", user_id: m.user_id ?? null,
    }, opt);
    return { movement, stock, material, unitCost };
}

/** Same for a semi-finished item (qty in the item's own unit). */
async function applySemiFinishedMovement(m) {
    const { hotel_id, semi_finished_item_id, type, t } = m;
    const qty = r4(m.qty);
    const opt = t ? { transaction: t } : {};
    let stock = await SemiFinishedStock.findOne({ where: { hotel_id, semi_finished_item_id }, ...opt });
    if (!stock) stock = await SemiFinishedStock.create({ hotel_id, semi_finished_item_id, available_qty: 0, cost_per_unit: 0, total_amount: 0 }, opt);
    const oldQty = Number(stock.available_qty) || 0;
    const oldCost = Number(stock.cost_per_unit) || 0;
    let cost = oldCost;
    let unitCost = oldCost;
    if (qty > 0 && m.unit_cost != null) {
        unitCost = Number(m.unit_cost);
        if (type === "production") {
            const base = Math.max(0, oldQty);
            cost = base + qty > 0 ? (base * oldCost + qty * unitCost) / (base + qty) : unitCost;
        }
    }
    const newQty = r4(oldQty + qty);
    await stock.update({ available_qty: newQty, cost_per_unit: r4(cost), total_amount: r2(newQty * cost) }, opt);
    const movement = await StockMovement.create({
        hotel_id, semi_finished_item_id, type, qty,
        business_date: m.business_date || await businessDateFor(hotel_id, t),
        unit_cost: r4(unitCost), value: r2(qty * unitCost), balance_qty: newQty,
        ref_type: m.ref_type || null, ref_id: m.ref_id ?? null, note: m.note || "", user_id: m.user_id ?? null,
    }, opt);
    return { movement, stock, unitCost };
}

// Stock that existed before the journal did gets one "opening" movement
// (today, at its current quantity and average price), so the ledger's
// balances start from what is really on hand. Idempotent: a material that
// already has any movement is left alone.
async function backfillOpeningBalances() {
    const rows = await StockInHand.findAll({ where: { deleted: false } });
    let created = 0;
    for (const s of rows) {
        const has = await StockMovement.count({ where: { hotel_id: s.hotel_id, raw_material_id: s.raw_material_id } });
        if (has) continue;
        await StockMovement.create({
            hotel_id: s.hotel_id, raw_material_id: s.raw_material_id, type: "opening",
            business_date: await businessDateFor(s.hotel_id), qty: r4(s.qty), unit_cost: r4(s.average_price),
            value: r2(Number(s.qty) * Number(s.average_price || 0)), balance_qty: r4(s.qty),
            note: "Stock on hand when the stock ledger started",
        });
        created++;
    }
    if (created) console.log(`[stockLedger] opening balances recorded for ${created} material(s)`);
    return created;
}

// Which ledger column each movement type belongs to.
const COLUMN_OF = {
    opening: "opening_entry",
    purchase: "purchased", purchase_edit: "purchased", purchase_delete: "purchased", requisition: "purchased",
    consumption: "used", consumption_reversal: "used", production_use: "used",
    wastage: "wastage", wastage_reversal: "wastage",
    stock_in: "manual", stock_out: "manual", adjustment: "manual",
};

/**
 * Stock Ledger for [startDate, endDate] (business dates, inclusive):
 * per raw material - opening, purchased, used, wastage, manual, closing
 * (qty and value). Opening = every movement before the period.
 */
async function ledgerSummary(hotel_id, startDate, endDate) {
    const materials = await RawMaterial.findAll({ where: { hotel_id }, order: [["raw_material_name", "ASC"]] });
    const before = await StockMovement.findAll({
        where: { hotel_id, raw_material_id: { [Op.ne]: null }, business_date: { [Op.lt]: startDate } },
        attributes: ["raw_material_id", [fn("SUM", col("qty")), "qty"], [fn("SUM", col("value")), "value"]],
        group: ["raw_material_id"], raw: true,
    });
    const within = await StockMovement.findAll({
        where: { hotel_id, raw_material_id: { [Op.ne]: null }, business_date: { [Op.between]: [startDate, endDate] } },
        attributes: ["raw_material_id", "type", [fn("SUM", col("qty")), "qty"], [fn("SUM", col("value")), "value"]],
        group: ["raw_material_id", "type"], raw: true,
    });
    const openingOf = new Map(before.map((b) => [b.raw_material_id, b]));
    const rows = materials.map((mat) => {
        const o = openingOf.get(mat.id);
        const row = {
            raw_material_id: mat.id, raw_material_name: mat.raw_material_name,
            unit_id: mat.unit_id, consumption_unit: mat.consumption_unit, conversion_qty: Number(mat.conversion_qty) || 1,
            opening_qty: r4(o?.qty), opening_value: r2(o?.value),
            purchased_qty: 0, purchased_value: 0, used_qty: 0, used_value: 0,
            wastage_qty: 0, wastage_value: 0, manual_qty: 0, manual_value: 0,
        };
        for (const w of within.filter((x) => x.raw_material_id === mat.id)) {
            const colName = COLUMN_OF[w.type] || "manual";
            // A material first stocked inside the period: its opening entry
            // IS its opening balance.
            const key = colName === "opening_entry" ? "opening" : colName;
            row[`${key}_qty`] = r4(row[`${key}_qty`] + Number(w.qty));
            row[`${key}_value`] = r2(row[`${key}_value`] + Number(w.value));
        }
        row.closing_qty = r4(row.opening_qty + row.purchased_qty + row.used_qty + row.wastage_qty + row.manual_qty);
        row.closing_value = r2(row.opening_value + row.purchased_value + row.used_value + row.wastage_value + row.manual_value);
        return row;
    });
    const totals = rows.reduce((t, r) => {
        for (const k of ["opening", "purchased", "used", "wastage", "manual", "closing"]) t[`${k}_value`] = r2(t[`${k}_value`] + r[`${k}_value`]);
        return t;
    }, { opening_value: 0, purchased_value: 0, used_value: 0, wastage_value: 0, manual_value: 0, closing_value: 0 });
    return { startDate, endDate, rows, totals };
}

/** Every movement of one material in the period, with a running balance. */
async function ledgerDetail(hotel_id, raw_material_id, startDate, endDate) {
    const material = await RawMaterial.findOne({ where: { id: raw_material_id, hotel_id } });
    if (!material) return null;
    const openingQty = r4(await StockMovement.sum("qty", { where: { hotel_id, raw_material_id, business_date: { [Op.lt]: startDate } } }));
    const movements = await StockMovement.findAll({
        where: { hotel_id, raw_material_id, business_date: { [Op.between]: [startDate, endDate] } },
        include: [{ model: HotelUser, attributes: ["id", "name"] }],
        order: [["id", "ASC"]],
    });
    // The numbers people know: bill no. for an order, PO no. for a purchase.
    const { Order, PurchaseOrder } = require("../../model");
    const idsOf = (type) => [...new Set(movements.filter((m) => m.ref_type === type && m.ref_id).map((m) => m.ref_id))];
    const billNo = new Map((await Order.findAll({ where: { id: idsOf("order") }, attributes: ["id", "bill_no"], raw: true })).map((o) => [o.id, o.bill_no]));
    const poNo = new Map((await PurchaseOrder.findAll({ where: { id: idsOf("purchase_order") }, attributes: ["id", "Po_no"], raw: true })).map((p) => [p.id, p.Po_no]));
    const refLabel = (mv) => (mv.ref_type === "order" && mv.ref_id ? `Bill #${billNo.get(mv.ref_id) ?? mv.ref_id}`
        : mv.ref_type === "purchase_order" && mv.ref_id ? `PO #${poNo.get(mv.ref_id) ?? mv.ref_id}`
        : mv.ref_type === "wastage" ? "Wastage entry" : null);
    let balance = openingQty;
    const rows = movements.map((mv) => {
        balance = r4(balance + Number(mv.qty));
        return {
            id: mv.id, business_date: mv.business_date, createdAt: mv.createdAt, type: mv.type, qty: mv.qty,
            unit_cost: mv.unit_cost, value: mv.value, balance, ref_type: mv.ref_type, ref_id: mv.ref_id,
            note: mv.note, user: mv.hms_hotelUser_master?.name ?? null, ref_label: refLabel(mv),
        };
    });
    return { raw_material_id: material.id, raw_material_name: material.raw_material_name, opening_qty: openingQty, closing_qty: balance, rows };
}

module.exports = {
    applyStockMovement, applySemiFinishedMovement, backfillOpeningBalances, ledgerSummary, ledgerDetail, businessDateFor, r2, r4,
};
