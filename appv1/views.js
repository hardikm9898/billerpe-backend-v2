const { parseJson, r2, isOff } = require("./core");
const { routeItemsToKitchens } = require("./engine/routing");

// DB rows -> the POS App's shapes (BillerPe POS App src/lib/pos/types.ts).
// Pure functions: every caller loads the rows (batched) and passes them in.

const iso = (d) => (d ? new Date(d).toISOString() : undefined);

/** Menu.sub_categories is free text ("regular", "Regular Veg", "Non-Veg"...). */
function dietaryOf(text) {
    const t = String(text || "").toLowerCase().replace(/[\s_-]/g, "");
    if (t.includes("nonveg")) return "nonveg";
    if (t.includes("jain")) return "jain";
    if (t.includes("vegan")) return "vegan";
    if (t.includes("swaminarayan")) return "swaminarayan";
    if (t.includes("egg")) return "egg";
    return "veg";
}

/** Department-grouped addons JSON -> LineAddon[]. */
function lineAddons(raw) {
    const groups = parseJson(parseJson(raw, []), []);
    if (!Array.isArray(groups)) return [];
    return groups.flatMap((g) =>
        (Array.isArray(g?.hms_addon_msts) ? g.hms_addon_msts : []).map((a) => ({
            id: String(a.id),
            groupId: String(g.id ?? ""),
            name: a.addon_name ?? "",
            price: Number(a.price) || 0,
            qty: Number(a.qty) || 1,
        })),
    );
}

function lineStatus(row) {
    if (row.status === "delivered") return "served";
    if (row.kds_state === "preparing") return "preparing";
    if (row.kds_state === "ready" || row.ready) return "ready";
    return "sent";
}

/** OrderDetails row (+ its Menu row) -> OrderLine. A hidden menu row with shortCode CUSTOM is a custom item. */
function lineView(row, menu) {
    const custom = !!menu && menu.shortCode === "CUSTOM" && isOff(menu.active);
    return {
        id: String(row.id),
        itemId: custom || !row.MenuId ? undefined : String(row.MenuId),
        name: menu?.item_name ?? "Item",
        categoryId: menu?.menu_categ_id != null ? String(menu.menu_categ_id) : undefined,
        dietary: dietaryOf(menu?.sub_categories),
        variantId: row.variant_id != null ? String(row.variant_id) : undefined,
        variantName: row.variant_name || undefined,
        addons: lineAddons(row.addons),
        note: row.comment || undefined,
        price: Number(row.price) || 0,
        qty: Number(row.qty) || 0,
        custom,
        routeKitchenId: row.route_kitchen_id != null ? String(row.route_kitchen_id) : undefined,
        routePrinterId: row.route_printer_ref || undefined,
        status: lineStatus(row),
        firedById: row.firedBy != null ? String(row.firedBy) : undefined,
    };
}

/**
 * Fired lines -> KOT rounds. The KOT number is the round within the order
 * (OrderDetails.kotNumber), as on the exe and every printed KOT.
 */
function kotsOf(rows, menus, { staffNames, kitchens, orderType, tableId }) {
    const byKot = new Map();
    for (const r of rows) {
        if (r.status === "in-progress" || r.kotNumber == null) continue;
        if (!byKot.has(r.kotNumber)) byKot.set(r.kotNumber, []);
        byKot.get(r.kotNumber).push(r);
    }
    return [...byKot.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([kotNo, list]) => {
            const first = list.reduce((a, b) => (new Date(a.createdAt) <= new Date(b.createdAt) ? a : b));
            const visible = list.filter((r) => !r.kds_hidden).map((r) => ({ ...r, menu_categ_id: menus.get(r.MenuId)?.menu_categ_id }));
            const routed = visible.length ? routeItemsToKitchens(kitchens, visible, orderType, tableId) : [];
            return {
                kotNo,
                round: kotNo,
                firedAt: iso(first.createdAt),
                firedById: first.firedBy != null ? String(first.firedBy) : "",
                firedByName: staffNames.get(first.firedBy) ?? "",
                lines: list.map((r) => lineView(r, menus.get(r.MenuId))),
                kitchenIds: routed.map((k) => String(k.kitchen.id)),
            };
        });
}

const ACTION_LABEL = {
    place_order: "Order created",
    kot: "KOT sent",
    hold: "Held",
    settle: "Settled",
    delete_order: "Cancelled",
    remove_kot: "Item removed",
    decrease_kot_qty: "Item quantity reduced",
    free_table: "Table freed",
    update_order: "Order updated",
    update_order_item: "Item updated",
};

function timelineView(rows) {
    return rows
        .slice()
        .sort((a, b) => new Date(a.created_Date || a.createdAt) - new Date(b.created_Date || b.createdAt))
        .map((t) => ({
            at: iso(t.created_Date || t.createdAt),
            label: t.event_name && t.event_name !== t.action ? t.event_name : ACTION_LABEL[t.action] || t.event_name || "Updated",
            by: t.creator || "",
        }));
}

function orderStatus(o) {
    if (o.deleted) return "cancelled";
    if (o.payment === "success") return "settled";
    if (o.status === "hold") return "hold";
    if (o.status === "success") return "billed";
    return "running";
}

/** Order columns -> Payment[] (built-in modes by id, the outlet's own by pm-<id>). */
function paymentsOf(o, modesByName) {
    const out = [];
    for (const k of ["cash", "upi", "card", "due"]) if (Number(o[k]) > 0) out.push({ modeId: k, amount: r2(o[k]) });
    for (const p of parseJson(o.other_payments, []) || []) {
        const m = modesByName.get(String(p.name || "").trim().toLowerCase());
        out.push({ modeId: m ? `pm-${m.id}` : `name:${p.name}`, amount: r2(p.amount) });
    }
    return out;
}

/**
 * One order. `x` carries the batched rows: lines, menus (Map id->Menu),
 * taxes (OrderTax rows), taxNames (Map taxTypeId->name), user (User row),
 * staffNames (Map), timeline rows, kitchens, modesByName, duePaid.
 */
function orderView(o, x) {
    const status = orderStatus(o);
    const lines = x.lines || [];
    const held = lines.filter((l) => l.status === "in-progress");
    const discountValue = Number(o.discount_value) || 0;
    const reason = o.discount_reason || "";
    const promo = /^Promo (\S+)/.exec(reason);
    const timeline = timelineView(x.timeline || []);
    const settleEvent = (x.timeline || []).filter((t) => t.action === "settle").pop();
    const cancelEvent = timeline.filter((t) => t.label.startsWith("Cancelled — ")).pop();
    const customerIsReal = x.user && !x.user.isPlaceholder;
    const due = Number(o.due) || 0;
    return {
        id: String(o.id),
        billNo: String(o.bill_no ?? ""),
        token: Number(o.token) || 0,
        type: o.order_type === "pickup" ? "pickup" : "dinin",
        tableId: o.TableId != null ? String(o.TableId) : undefined,
        guests: Number(o.guests) || (o.order_type === "dinin" ? 1 : 0),
        customerName: customerIsReal ? x.user.name || undefined : undefined,
        customerMobile: customerIsReal ? x.user.number || undefined : undefined,
        menuId: o.menu_catalog_id != null ? String(o.menu_catalog_id) : "",
        captainId: o.hotelUserId != null ? String(o.hotelUserId) : "",
        captainName: x.staffNames.get(o.hotelUserId) ?? "",
        status,
        createdAt: iso(o.createdAt),
        businessDate: o.business_date ? String(o.business_date).slice(0, 10) : iso(o.createdAt).slice(0, 10),
        kots: kotsOf(lines, x.menus, { staffNames: x.staffNames, kitchens: x.kitchens, orderType: o.order_type, tableId: o.TableId }),
        heldLines: held.map((r) => ({ ...lineView(r, x.menus.get(r.MenuId)), firedById: undefined })),
        discount: discountValue > 0 ? { type: o.discount_type === "pr" ? "pr" : "fix", value: discountValue, reason } : undefined,
        promoCode: promo ? promo[1] : undefined,
        serviceOverride: o.service_override ?? null,
        totals: {
            subtotal: r2(o.totalAmount),
            discount: r2(o.totalDiscount),
            service: r2(o.service_charge),
            packaging: r2(o.packaging_charge),
            taxLines: (x.taxes || []).map((t) => ({
                id: String(t.hmsTaxTypeMstId),
                name: x.taxNames.get(t.hmsTaxTypeMstId) ?? "Tax",
                type: t.tax_type === "fix" ? "fix" : "pr",
                // stored reversed (exe orderTotals.js): amount = rate, tax_value = rupees
                rate: Number(t.amount) || 0,
                amount: r2(t.tax_value),
            })),
            tax: r2(o.gst),
            roundOff: r2(o.roundOff),
            grand: r2(o.grandAmount),
            items: r2(lines.reduce((s, l) => s + (Number(l.qty) || 0), 0)),
        },
        payments: status === "settled" ? paymentsOf(o, x.modesByName) : [],
        dueOutstanding: due > 0 ? r2(Math.max(0, due - (x.duePaid || 0))) : undefined,
        billPrintedAt: iso(o.billed_at),
        settledAt: status === "settled" ? iso(settleEvent?.created_Date || o.updatedAt) : undefined,
        settledBy: status === "settled" ? settleEvent?.creator || undefined : undefined,
        cancelReason: status === "cancelled" && cancelEvent ? cancelEvent.label.slice("Cancelled — ".length) : undefined,
        fromQr: o.created_from === "qr" || undefined,
        readyAt: iso(o.token_ready_at),
        timeline,
    };
}

module.exports = { iso, dietaryOf, lineAddons, lineView, kotsOf, timelineView, orderStatus, paymentsOf, orderView };
