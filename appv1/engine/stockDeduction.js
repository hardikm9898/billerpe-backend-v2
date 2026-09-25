// COPY of billerpe-local-exe/helpers/localStockDeduction.js for POS App
// (Plan 2) outlets. One change: the 'already deducted' guard is per LINE,
// so items added to a pickup order after it was created (and deducted) are
// still deducted when it is settled.

const { OrderDetails, Recipes, RawMaterial, RawMaterialConsumption } = require("../../model");
const { applyStockMovement, applySemiFinishedMovement, r4, r2 } = require("./stockLedger");

// Sale -> stock deduction. Runs when a dine-in bill is settled and when a
// pickup order is created (controller/settle.js, controller/order.js), for
// every line on the bill - owner rule 2026-09-25: deduct at
// settle, not at KOT.
//
// It used to read LocalRecipeMap, a placeholder table nothing ever wrote,
// while the Recipes screen saves to hms_recipes_msts - so no sale ever
// deducted any stock (owner report, 2026-09-25). It now reads the real
// recipes:
// - a line with a variant uses that variant's own recipe when there is one,
//   otherwise the dish's base recipe - never both (that double counted)
// - every addon selected on the line deducts its own recipe x addon qty
//   (an addon is priced once per line by its own qty - same rule here)
// - raw materials and semi-finished items alike
// - stock may go negative, never blocks or shortens a sale (owner rule)
// Every deduction is a StockMovement ("consumption", ref order) plus a
// RawMaterialConsumption row per (line, ingredient) so any later change to
// the bill can put exactly that back.

function parseAddons(raw) {
    let a = raw;
    for (let i = 0; i < 2 && typeof a === "string"; i++) {
        try { a = JSON.parse(a || "[]"); } catch { a = []; }
    }
    if (!Array.isArray(a)) return [];
    // [{ hms_addon_msts: [{ id, qty }] }] or a flat [{ id, qty }]
    return a.flatMap((g) => (Array.isArray(g?.hms_addon_msts) ? g.hms_addon_msts : [g]))
        .filter((x) => x && x.id != null)
        .map((x) => ({ id: Number(x.id), qty: Number(x.qty) || 1 }));
}

/** What one order line consumes: [{ raw_material_id | semi_finished_item_id, qty (consumption unit) }] */
function consumptionForLine(line, recipesByMenu, addonRecipes) {
    const rows = recipesByMenu.get(line.MenuId) || [];
    const lineQty = Number(line.qty) || 0;
    const variantRows = line.variant_id ? rows.filter((r) => !r.addon_id && Number(r.variant_id) === Number(line.variant_id)) : [];
    const baseRows = rows.filter((r) => !r.addon_id && !r.variant_id);
    const out = [];
    for (const r of variantRows.length ? variantRows : baseRows) {
        out.push({ recipe: r, qty: Number(r.consumption_qty) * lineQty });
    }
    for (const addon of parseAddons(line.addons)) {
        for (const r of addonRecipes.get(addon.id) || []) {
            if (r.variant_id && Number(r.variant_id) !== Number(line.variant_id)) continue;
            out.push({ recipe: r, qty: Number(r.consumption_qty) * addon.qty, addon_id: addon.id });
        }
    }
    return out.filter((c) => c.qty > 0);
}

async function deductStockForOrder(orderId, hotel_id, t = null, user_id = null) {
    const opt = t ? { transaction: t } : {};
    try {
        // Once per line: a retried settle (or a second call) must not deduct
        // a line again; a line added since the last deduction still is.
        const done = await RawMaterialConsumption.findAll({ where: { order_id: orderId, hotel_id, status: "CONSUMED" }, attributes: ["order_item_id"], raw: true, ...opt });
        const doneIds = new Set(done.map((d) => Number(d.order_item_id)));
        const lines = (await OrderDetails.findAll({ where: { orderId, hotel_id }, ...opt })).filter((l) => !doneIds.has(Number(l.id)));
        if (!lines.length) return { error: false, message: "No items to process" };

        const menuIds = [...new Set(lines.map((l) => l.MenuId).filter(Boolean))];
        const addonIds = [...new Set(lines.flatMap((l) => parseAddons(l.addons).map((a) => a.id)))];
        const recipes = await Recipes.findAll({ where: { hotel_id, menu_id: menuIds }, ...opt });
        const addonRows = addonIds.length ? await Recipes.findAll({ where: { hotel_id, addon_id: addonIds }, ...opt }) : [];
        if (!recipes.length && !addonRows.length) return { error: false, message: "No recipes for these items" };

        const recipesByMenu = new Map();
        for (const r of recipes) {
            if (!recipesByMenu.has(r.menu_id)) recipesByMenu.set(r.menu_id, []);
            recipesByMenu.get(r.menu_id).push(r);
        }
        const addonRecipes = new Map();
        for (const r of addonRows) {
            if (!addonRecipes.has(Number(r.addon_id))) addonRecipes.set(Number(r.addon_id), []);
            addonRecipes.get(Number(r.addon_id)).push(r);
        }

        const conversions = new Map();
        const conversionOf = async (rawId) => {
            if (!conversions.has(rawId)) {
                const m = await RawMaterial.findOne({ where: { id: rawId, hotel_id }, attributes: ["conversion_qty"], ...opt });
                conversions.set(rawId, m ? Number(m.conversion_qty) || 1 : null);
            }
            return conversions.get(rawId);
        };

        for (const line of lines) {
            for (const c of consumptionForLine(line, recipesByMenu, addonRecipes)) {
                const r = c.recipe;
                const qty = r4(c.qty);
                if (r.raw_material_id) {
                    const conversion = await conversionOf(r.raw_material_id);
                    if (conversion == null) continue; // material deleted since
                    const { unitCost } = await applyStockMovement({
                        hotel_id, raw_material_id: r.raw_material_id, qty: -(qty / conversion), type: "consumption",
                        ref_type: "order", ref_id: orderId, user_id, t,
                    });
                    await RawMaterialConsumption.create({
                        hotel_id, raw_material_id: r.raw_material_id, order_id: orderId, order_item_id: line.id,
                        menu_id: line.MenuId, variant_id: line.variant_id || null, required_qty: qty, consumed_qty: qty,
                        cost: r2((qty / conversion) * unitCost), purpose: "RECIPE", status: "CONSUMED", user_id,
                        ...(c.addon_id ? { notes: `addon:${c.addon_id}` } : {}),
                    }, opt);
                } else if (r.semi_finished_item_id) {
                    const { unitCost } = await applySemiFinishedMovement({
                        hotel_id, semi_finished_item_id: r.semi_finished_item_id, qty: -qty, type: "consumption",
                        ref_type: "order", ref_id: orderId, user_id, t,
                    });
                    await RawMaterialConsumption.create({
                        hotel_id, raw_material_id: null, semi_finished_item_id: r.semi_finished_item_id, order_id: orderId,
                        order_item_id: line.id, menu_id: line.MenuId, variant_id: line.variant_id || null,
                        required_qty: qty, consumed_qty: qty, cost: r2(qty * unitCost), purpose: "RECIPE", status: "CONSUMED", user_id,
                    }, opt);
                }
            }
        }
        return { error: false, message: "Stock deducted" };
    } catch (err) {
        console.error("[localStockDeduction] error:", err);
        return { error: true, message: err.message };
    }
}

// Puts one consumption row's stock back, at the cost it left at.
async function restoreConsumption(c, hotel_id, t, note) {
    const opt = t ? { transaction: t } : {};
    const qty = Number(c.consumed_qty);
    if (c.raw_material_id) {
        const m = await RawMaterial.findOne({ where: { id: c.raw_material_id, hotel_id }, attributes: ["conversion_qty"], ...opt });
        if (m) {
            const conversion = Number(m.conversion_qty) || 1;
            const purchaseQty = qty / conversion;
            await applyStockMovement({
                hotel_id, raw_material_id: c.raw_material_id, qty: purchaseQty, type: "consumption_reversal",
                unit_cost: purchaseQty ? Number(c.cost) / purchaseQty : undefined,
                ref_type: "order", ref_id: c.order_id, note, t,
            });
        }
    } else if (c.semi_finished_item_id) {
        await applySemiFinishedMovement({
            hotel_id, semi_finished_item_id: c.semi_finished_item_id, qty, type: "consumption_reversal",
            unit_cost: qty ? Number(c.cost) / qty : undefined, ref_type: "order", ref_id: c.order_id, note, t,
        });
    }
    await c.update({ status: "REVERSED", notes: note }, opt);
}

// One order line's consumption, scaled from old_qty to new_qty (0 = removed).
async function editOrderItemStock({ order_id, order_item_id, hotel_id, old_qty, new_qty, t = null }) {
    if (Number(new_qty) === Number(old_qty)) return { error: false, message: "No change in quantity" };
    const opt = t ? { transaction: t } : {};
    const consumptions = await RawMaterialConsumption.findAll({ where: { order_id, order_item_id, hotel_id, status: "CONSUMED" }, ...opt });
    for (const c of consumptions) {
        await restoreConsumption(c, hotel_id, t, "Order line changed");
        if (Number(new_qty) > 0 && Number(old_qty) > 0) {
            const scale = Number(new_qty) / Number(old_qty);
            const qty = r4(Number(c.consumed_qty) * scale);
            if (c.raw_material_id) {
                const m = await RawMaterial.findOne({ where: { id: c.raw_material_id, hotel_id }, attributes: ["conversion_qty"], ...opt });
                const conversion = Number(m?.conversion_qty) || 1;
                const { unitCost } = await applyStockMovement({ hotel_id, raw_material_id: c.raw_material_id, qty: -(qty / conversion), type: "consumption", ref_type: "order", ref_id: order_id, t });
                await RawMaterialConsumption.create({ ...c.toJSON(), id: undefined, required_qty: qty, consumed_qty: qty, cost: r2((qty / conversion) * unitCost), status: "CONSUMED", notes: null }, opt);
            } else if (c.semi_finished_item_id) {
                const { unitCost } = await applySemiFinishedMovement({ hotel_id, semi_finished_item_id: c.semi_finished_item_id, qty: -qty, type: "consumption", ref_type: "order", ref_id: order_id, t });
                await RawMaterialConsumption.create({ ...c.toJSON(), id: undefined, required_qty: qty, consumed_qty: qty, cost: r2(qty * unitCost), status: "CONSUMED", notes: null }, opt);
            }
        }
    }
    return { error: false, message: "Order item stock updated" };
}

async function reverseOrderItemStock({ order_id, order_item_id, hotel_id, t = null }) {
    const opt = t ? { transaction: t } : {};
    const consumptions = await RawMaterialConsumption.findAll({ where: { order_id, order_item_id, hotel_id, status: "CONSUMED" }, ...opt });
    for (const c of consumptions) await restoreConsumption(c, hotel_id, t, "Item removed from settled order");
    return { error: false, message: consumptions.length ? "Item stock reversed" : "No consumption data found for item" };
}

// Every consumption of the order back into stock - a settled bill being
// edited (controller/editSettledOrder.js) or cancelled.
async function reverseAllOrderStock(order_id, hotel_id, t = null, note = "Settled order edited") {
    const opt = t ? { transaction: t } : {};
    const consumptions = await RawMaterialConsumption.findAll({ where: { order_id, hotel_id, status: "CONSUMED" }, ...opt });
    for (const c of consumptions) await restoreConsumption(c, hotel_id, t, note);
    return { error: false, message: consumptions.length ? "Order stock reversed" : "No consumption data found for order" };
}

module.exports = { deductStockForOrder, editOrderItemStock, reverseOrderItemStock, reverseAllOrderStock, consumptionForLine, parseAddons };
