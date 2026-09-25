// The ONE bill-calculation rule set for the whole product - an EXACT copy of
// billerpe-local-exe/helpers/billEngine.js (Plan 2 bills on the cloud with the
// same arithmetic). Change every copy together. Original header:
// The ONE bill-calculation rule set for the whole product. The exe is the
// authority: every controller that changes an order's lines re-runs this
// (helpers/orderTotals.js) and persists the result, so Web POS, Captain App
// and the cloud all read identical figures for the same order. The two
// clients carry a literal TypeScript port of this file (billerpe-pos-pro-v2
// src/lib/billEngine.ts, Captain App src/lib/captain/billEngine.ts) only so
// they can preview a not-yet-fired draft round without a round trip - the
// persisted numbers always come from here.
//
// Rules (kept identical in the two ports - change all three together):
//   line     = price * qty + sum(addon.price * addon.qty)   (addons are
//              priced once per line by their own qty, NOT multiplied by the
//              line qty - this is what the printed bill template already
//              does, services/pdfGenerator.js)
//   subtotal = sum(line)
//   discount = pr: subtotal * value / 100 | fix: value      (clamped 0..subtotal)
//   charge   = service / packaging rules share one evaluator: active, order
//              type filter (charge_automatic list, empty = all), base = core
//              (subtotal) or total (subtotal - discount), greater/less/always
//              threshold, percentage or fixed
//   delivery = 0 (switched off product-wide by explicit sign-off)
//   taxBase  = max(0, subtotal - discount) + service (if calculation_on_tax)
//              + packaging (if calculation_on_tax)
//   tax_i    = active TaxType rows, filtered by order_type / table_categ_ids
//              (empty = all) and menu_ids (empty = all; non-empty scales the
//              base by the matching lines' share of the subtotal)
//   grand    = round(max(0, subtotal - discount) + service + packaging + tax)
//   roundOff = grand - raw grand

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// These columns are declared DataTypes.JSON, but the values in them are not
// consistently shaped, so this has to be forgiving:
//   * a real array                      -> ["pickup"]
//   * a JSON string                     -> '["pickup"]'
//   * a DOUBLE-encoded JSON string      -> '"[\"pickup\"]"'
// The last one is what the live outlet actually has in
// hms_bill_charge_msts.charge_automatic (the write path stringified an
// array into a JSON column, and a `raw: true` read hands back the stored
// text untouched). Parsing only once left a STRING where an array was
// expected, which read as "no order-type filter" and applied a
// pickup-only packaging charge to a dine-in bill - caught by
// scripts/verify-bill-then-settle.js against the real data shape, where a
// 500 rupee dine-in order came out at 515.
function asArray(v) {
    let value = v;
    for (let i = 0; i < 3; i++) {
        if (Array.isArray(value)) return value;
        if (typeof value !== "string") return [];
        try {
            value = JSON.parse(value);
        } catch {
            return [];
        }
    }
    return Array.isArray(value) ? value : [];
}

// Order types in config rows can be stored as "dinin"/"pickup"/"delivery" or
// legacy labels - normalise both sides to the exe's own ORDER_TYPE values.
function normaliseOrderType(v) {
    const s = String(v || "").toLowerCase().replace(/[\s_-]/g, "");
    if (s === "dinin" || s === "dinein") return "dinin";
    if (s === "pickup" || s === "takeaway") return "pickup";
    if (s === "delivery") return "delivery";
    return s;
}

function orderTypeAllowed(listValue, orderType) {
    const list = asArray(listValue).map(normaliseOrderType).filter(Boolean);
    if (!list.length) return true;
    return list.includes(normaliseOrderType(orderType));
}

// OrderDetails.addons is department-grouped JSON:
//   [{ id, department_name, hms_addon_msts: [{ id, addon_name, price, qty }] }]
// but older rows / QR rows may carry a flat [{ name, price, qty }] list.
function addonsTotal(addons) {
    let total = 0;
    for (const entry of asArray(addons)) {
        if (!entry || typeof entry !== "object") continue;
        if (Array.isArray(entry.hms_addon_msts)) {
            for (const a of entry.hms_addon_msts) {
                total += (Number(a?.price) || 0) * (Number(a?.qty) || 1);
            }
        } else if ("price" in entry) {
            total += (Number(entry.price) || 0) * (Number(entry.qty) || 1);
        }
    }
    return total;
}

function lineTotal(line) {
    return r2((Number(line.price) || 0) * (Number(line.qty) || 0) + addonsTotal(line.addons));
}

// The service charge is AUTOMATIC only for the order types ticked in
// service_charge_automatic - an EMPTY list means "none: the cashier adds it
// by hand" (the Settings screen says exactly that, and the old BillerPe
// worked that way). This used orderTypeAllowed's "empty = all", so an
// outlet that switched automatic off was still charged on every order
// (owner report, 2026-09-22 - confirmed live: 2% on every bill with the
// list empty). Packaging's list keeps "empty = all": its screen says so.
function serviceIsAutomatic(rule, orderType) {
    if (!rule || !rule.active) return false;
    const list = asArray(rule.service_charge_automatic).map(normaliseOrderType).filter(Boolean);
    return list.includes(normaliseOrderType(orderType));
}

// Shared evaluator for hms_serviceCharge_mst and hms_bill_charge_mst rows -
// the two tables have the same shape under different column prefixes.
function evaluateChargeRule(rule, { subtotal, discount, orderType, kind }) {
    if (!rule || !rule.active || subtotal <= 0) return 0;
    const type = kind === "service" ? rule.service_charge_type : rule.charge_type;
    const value = Number(kind === "service" ? rule.service_charge_value : rule.charge_value) || 0;
    if (kind === "service") {
        if (!serviceIsAutomatic(rule, orderType)) return 0;
    } else if (!orderTypeAllowed(rule.charge_automatic, orderType)) {
        return 0;
    }
    const base = rule.calculation_on === "total" ? subtotal - discount : subtotal;
    const threshold = Number(rule.greater_less_amount) || 0;
    const cond = String(rule.greater_less ?? "3");
    const qualifies = cond === "1" ? base > threshold : cond === "2" ? base < threshold : true;
    if (!qualifies) return 0;
    return type === "percentage" || type === "percent" ? r2((base * value) / 100) : r2(value);
}

/**
 * @param {object} input
 * @param {Array} input.lines            [{ qty, price, addons, MenuId }]
 * @param {string} input.orderType       'dinin' | 'pickup' | 'delivery'
 * @param {number|null} input.tableCategId
 * @param {{type:'fix'|'pr', value:number}|null} input.discount
 * @param {number|null|undefined} input.packagingOverride  explicit per-order packaging amount, or null/undefined for the rule
 * @param {number|null|undefined} input.serviceOverride    the cashier's manual service charge, used when the
 *                                                         service charge is not automatic for this order type
 * @param {object} input.config
 * @param {boolean} input.config.gstOn                 Hotel.invoiceFormateIncGst
 * @param {Array}   input.config.taxTypes              hms_tax_type_mst rows
 * @param {object|null} input.config.serviceCharge     hms_serviceCharge_mst row
 * @param {object|null} input.config.packagingRule     hms_bill_charge_mst row (rule_for 'packaging')
 */
function computeBill(input) {
    const lines = input.lines || [];
    const orderType = normaliseOrderType(input.orderType || "dinin");
    const config = input.config || {};

    const lineTotals = lines.map(lineTotal);
    const subtotal = r2(lineTotals.reduce((s, v) => s + v, 0));

    let discount = 0;
    const d = input.discount;
    if (d && Number(d.value) > 0) {
        discount = d.type === "pr" || d.type === "percent"
            ? r2((subtotal * Number(d.value)) / 100)
            : r2(Number(d.value));
    }
    discount = Math.min(subtotal, Math.max(0, discount));

    // Automatic for this order type -> the rule; otherwise whatever the
    // cashier entered on the order (nothing entered = no service charge).
    const manualService = Number(input.serviceOverride);
    const service = serviceIsAutomatic(config.serviceCharge, orderType)
        ? evaluateChargeRule(config.serviceCharge, { subtotal, discount, orderType, kind: "service" })
        : (config.serviceCharge?.active && input.serviceOverride != null && Number.isFinite(manualService) && subtotal > 0
            ? r2(Math.max(0, manualService))
            : 0);

    let packaging;
    if (input.packagingOverride !== null && input.packagingOverride !== undefined && Number.isFinite(Number(input.packagingOverride))) {
        packaging = r2(Math.max(0, Number(input.packagingOverride)));
    } else {
        packaging = evaluateChargeRule(config.packagingRule, { subtotal, discount, orderType, kind: "packaging" });
    }
    const delivery = 0;

    const net = Math.max(0, subtotal - discount);
    const taxBase = net
        + (config.serviceCharge?.calculation_on_tax ? service : 0)
        + (config.packagingRule?.calculation_on_tax ? packaging : 0);

    const taxLines = [];
    if (config.gstOn !== false) {
        for (const t of config.taxTypes || []) {
            if (!t || t.active === false) continue;
            if (!orderTypeAllowed(t.order_type, orderType)) continue;
            const categIds = asArray(t.table_categ_ids).map(String);
            if (categIds.length && (input.tableCategId == null || !categIds.includes(String(input.tableCategId)))) continue;
            const menuIds = asArray(t.menu_ids).map(String);
            let base = taxBase;
            if (menuIds.length) {
                if (subtotal <= 0) continue;
                const matching = lines.reduce((s, l, i) => s + (menuIds.includes(String(l.MenuId)) ? lineTotals[i] : 0), 0);
                if (matching <= 0) continue;
                base = r2(taxBase * (matching / subtotal));
            }
            const isPercent = (t.tax_value ?? "pr") !== "fix";
            const rate = Number(t.amount) || 0;
            const amount = subtotal <= 0 ? 0 : isPercent ? r2((base * rate) / 100) : r2(rate);
            taxLines.push({
                id: t.id,
                name: t.tax_name,
                tax_type: isPercent ? "pr" : "fix",
                tax_value: rate,
                amount,
            });
        }
    }
    const tax = r2(taxLines.reduce((s, t) => s + t.amount, 0));

    const rawGrand = r2(net + service + packaging + delivery + tax);
    const grandAmount = Math.round(rawGrand);
    const roundOff = r2(grandAmount - rawGrand);

    return {
        subtotal, discount, service, packaging, delivery, taxLines, tax,
        rawGrand, grandAmount, roundOff,
        items: lines.reduce((s, l) => s + (Number(l.qty) || 0), 0),
    };
}

module.exports = { computeBill, lineTotal, addonsTotal, evaluateChargeRule, serviceIsAutomatic, normaliseOrderType, asArray, r2 };
