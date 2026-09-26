const { Op } = require("sequelize");
const sequelize = require("../../connection/connect");
const M = require("../../model");
const { fail, need, r2, audit } = require("../core");
const { callController } = require("../legacy");
const { modeName } = require("../modes");
const { applyStockMovement } = require("../engine/stockLedger");
const stockCtl = require("../exe/controller/stock");
const poCtl = require("../exe/controller/purchaseOrder");
const wastageCtl = require("../exe/controller/wastage");
const recipeCtl = require("../exe/controller/recipes");
const semiCtl = require("../exe/controller/semiFinishedItems");
const movementSvc = require("../exe/services/stockMovements");

// Stock for POS App outlets through the exe's own controllers (appv1/exe):
// purchases with supplier payments (and their expenses / drawer cash), stock
// in / out / count, wastage, recipes, semi-finished production - all on the
// stock ledger. The exe runs on one outlet's own PC, so some of its lookups
// are by id alone; on the shared cloud every id is checked against this
// outlet FIRST, here.
//
// Units: the app counts stock in the material's consumption unit (grams);
// stock in hand and the ledger are in the purchase unit (kg). Converted here.

const idOf = (v) => Number(v) || 0;

async function ownRaw(c, id) {
    const raw = await M.RawMaterial.findOne({ where: { id: idOf(id), hotel_id: c.hotelId } });
    if (!raw) fail("Pick an item");
    return raw;
}

async function ownUnit(c, id) {
    const unit = await M.Unit.findOne({ where: { id: idOf(id), hotel_id: c.hotelId } });
    if (!unit) fail("Pick a unit");
    return unit;
}

/* ------------------------------ masters ------------------------------ */

async function saveUnit(c, u) {
    need(c, "stock-masters", u.id ? "edit" : "create");
    if (!String(u.name || "").trim() || !String(u.short || "").trim()) fail("Name and short name are required");
    const body = { unitName: String(u.name).trim(), shortName: String(u.short).trim() };
    if (u.id) {
        await ownUnit(c, u.id);
        await callController(stockCtl.editUnit, c, { body: { ...body, id: idOf(u.id) } });
    } else await callController(stockCtl.addUnit, c, { body });
}

async function saveRaw(c, r) {
    need(c, "stock-masters", r.id ? "edit" : "create");
    const name = String(r.name || "").trim();
    if (!name) fail("Name is required");
    await ownUnit(c, r.unitId);
    await ownUnit(c, r.purchaseUnitId);
    const conversion = Number(r.conversion);
    if (!(conversion > 0)) fail("Conversion must be more than 0");
    if (Number(r.reorderLevel) < 0) fail("Reorder level cannot be negative");
    const existing = r.id ? await ownRaw(c, r.id) : null;
    const clash = await M.RawMaterial.findOne({ where: { hotel_id: c.hotelId, raw_material_name: name, ...(existing ? { id: { [Op.ne]: existing.id } } : {}) } });
    if (clash) fail("RawMaterial Name Has Already Taken");
    // The app's rate is per consumption unit; purchase_price is per purchase unit.
    const purchasePrice = r.openingRate !== undefined ? r2(Number(r.openingRate) * conversion) : Number(existing?.purchase_price) || 0;
    const body = {
        raw_material_name: name, purchase_price: purchasePrice, unit: idOf(r.purchaseUnitId), consumption_unit: idOf(r.unitId),
        conversion_qty: conversion, mini_stock_level: Number(r.reorderLevel) > 0, mini_stock_level_qty: Number(r.reorderLevel) || 0,
    };
    let id = existing?.id;
    if (existing) await callController(stockCtl.editRawMaterial, c, { body: { ...body, id } });
    else {
        await callController(stockCtl.addRawMaterial, c, { body });
        id = (await M.RawMaterial.findOne({ where: { hotel_id: c.hotelId, raw_material_name: name }, order: [["id", "DESC"]] })).id;
    }
    if (!existing && Number(r.openingStock) > 0) {
        await applyStockMovement({
            hotel_id: c.hotelId, raw_material_id: id, qty: Number(r.openingStock) / conversion, type: "opening",
            unit_cost: purchasePrice, note: "Opening stock", user_id: c.userId,
        });
    }
    await audit(c, "Stock", `Saved raw material ${name}`);
    return { id: String(id) };
}

async function saveSupplier(c, s) {
    need(c, "stock-masters", s.id ? "edit" : "create");
    const name = String(s.name || "").trim();
    if (!name) fail("Name is required");
    if (s.id) {
        const row = await M.Supplier.findOne({ where: { id: idOf(s.id), hotel_id: c.hotelId } });
        if (!row) fail("Supplier not found");
        await callController(poCtl.editSupplier, c, { body: { id: row.id, name } });
    } else await callController(poCtl.createSupplier, c, { body: { name } });
}

/* ------------------------------ purchases ------------------------------ */

/** App PO -> the exe's purchase body (line amount before tax; CGST/SGST in rupees, halves). */
async function purchaseBody(c, p) {
    const supplier = await M.Supplier.findOne({ where: { id: idOf(p.supplierId), hotel_id: c.hotelId } });
    if (!supplier) fail("Pick a supplier");
    if (!(p.lines || []).length) fail("Add at least one item");
    const lines = [];
    for (const l of p.lines) {
        const raw = await ownRaw(c, l.rawId);
        if (!(Number(l.qty) > 0)) fail("Quantity must be more than 0");
        if (!(Number(l.rate) >= 0)) fail("Enter a rate");
        const amount = r2(Number(l.qty) * Number(l.rate));
        const tax = r2((amount * (Number(l.taxPct) || 0)) / 100);
        lines.push({ ...(l.lineId ? { id: idOf(l.lineId) } : {}), raw_material_id: raw.id, qty: Number(l.qty), price: Number(l.rate), amount, cgst: r2(tax / 2), sgst: r2(tax / 2), igst: 0, unit_id: raw.unit_id });
    }
    const gross = r2(lines.reduce((s, l) => s + l.amount + l.cgst + l.sgst, 0));
    const subTotal = r2(lines.reduce((s, l) => s + l.amount, 0));
    const dv = Number(p.discountValue) || 0;
    const discount = !dv ? 0 : p.discountType === "percent" ? r2((gross * dv) / 100) : dv;
    return {
        supplier_id: supplier.id, GSTNo: "", grandAmount: r2(Math.max(0, gross - discount)), discount, delivery_charge: 0,
        invoice_number: p.invoiceNo || "", discount_type: p.discountType === "percent" ? "pr" : "fix", discount_value: dv,
        sub_total: subTotal, rawMaterialData: lines, invoice_date: p.date || undefined,
    };
}

async function payMode(c, modeId) {
    if (modeId === "cheque") return "Cheque";
    if (modeId === "bank") return "Bank transfer";
    return modeName(c, modeId);
}

/** Stock that has already been used and would go below zero - warn (owner rule: allowed). */
async function negativeWarning(c, lines) {
    const names = [];
    for (const l of lines) {
        const s = await M.StockInHand.findOne({ where: { hotel_id: c.hotelId, raw_material_id: l.raw_material_id, deleted: false } });
        if (s && Number(s.qty) < 0) names.push((await M.RawMaterial.findByPk(l.raw_material_id)).raw_material_name);
    }
    return names.length ? `Stock is now below zero for ${names.join(", ")} - it was already used.` : undefined;
}

async function savePurchase(c, p) {
    need(c, "stock-transactions", p.id ? "edit" : "create");
    const body = await purchaseBody(c, p);
    let id = idOf(p.id);
    if (id) {
        const po = await M.PurchaseOrder.findOne({ where: { id, hotel_id: c.hotelId, deleted_status: false } });
        if (!po) fail("Purchase not found");
        // Keep line ids so an edit adjusts stock by the difference (exe editPurchaseOrder).
        const existing = await M.PurchaseRawMaterial.findAll({ where: { purchaseOrderId: id, deleted_status: false }, raw: true });
        const unused = [...existing];
        for (const l of body.rawMaterialData) {
            const i = unused.findIndex((e) => e.raw_material_id === l.raw_material_id);
            if (i >= 0) l.id = unused.splice(i, 1)[0].id;
        }
        await callController(poCtl.editPurchaseOrder, c, { body: { ...body, id } });
    } else {
        const nextNo = ((await M.PurchaseOrder.max("Po_no", { where: { hotel_id: c.hotelId } })) || 0) + 1;
        const first = p.firstPayment && Number(p.firstPayment.amount) > 0 ? p.firstPayment : null;
        const res = await callController(poCtl.createPurchaseOrder, c, {
            body: {
                ...body, Po_no: nextNo, update_inventory: true,
                ...(first ? { paidAmount: Number(first.amount), payment_mode: await payMode(c, first.modeId), payment_ref_no: first.ref || "", from_drawer: first.modeId === "cash" ? first.fromDrawer !== false : false } : {}),
            },
        });
        id = res?.id;
    }
    await audit(c, "Stock", `${p.id ? "Edited" : "Received"} purchase · ₹${body.grandAmount}`);
    return { id: String(id), warning: await negativeWarning(c, body.rawMaterialData) };
}

async function deletePurchase(c, id) {
    need(c, "stock-transactions", "delete");
    const po = await M.PurchaseOrder.findOne({ where: { id: idOf(id), hotel_id: c.hotelId, deleted_status: false } });
    if (!po) fail("Purchase not found");
    const lines = await M.PurchaseRawMaterial.findAll({ where: { purchaseOrderId: po.id, deleted_status: false }, raw: true });
    await callController(poCtl.deletePurchaseorder, c, { body: { id: po.id } });
    await audit(c, "Stock", `Deleted purchase ${po.Po_no}`);
    return { warning: await negativeWarning(c, lines) };
}

async function addPurchasePayment(c, poId, p) {
    need(c, "stock-transactions", "edit");
    const po = await M.PurchaseOrder.findOne({ where: { id: idOf(poId), hotel_id: c.hotelId, deleted_status: false } });
    if (!po) fail("Purchase not found");
    await callController(poCtl.paymentDone, c, {
        body: { id: po.id, paidAmount: Number(p.amount), payment_mode: await payMode(c, p.modeId), payment_ref_no: p.ref || "", payment_date: p.date, from_drawer: p.modeId === "cash" ? p.fromDrawer !== false : false },
    });
}

async function deletePurchasePayment(c, poId, paymentId) {
    need(c, "stock-transactions", "delete");
    const pay = await M.PurchaseOrderPayment.findOne({ where: { id: idOf(paymentId), purchaseOrderId: idOf(poId), hotel_id: c.hotelId } });
    if (!pay) fail("Payment not found");
    await callController(poCtl.deletePayment, c, { body: { id: pay.id } });
}

/* ------------------------------ stock in / out / count ------------------------------ */

async function stockEntry(c, e) {
    need(c, "stock-transactions", "create");
    const qty = Number(e.qty);
    if (!(qty >= 0) || (e.kind !== "count" && !(qty > 0))) fail("Enter a quantity");
    const note = String(e.note || "").trim();
    if (!note && e.kind !== "in") fail("Add a note");
    if (e.refKind === "semi") {
        // Semi-finished stock is in its own unit, straight on the ledger.
        const item = await M.SemiFinishedItem.findOne({ where: { id: idOf(e.refId), hotel_id: c.hotelId } });
        if (!item) fail("Pick an item");
        const s = await M.SemiFinishedStock.findOne({ where: { hotel_id: c.hotelId, semi_finished_item_id: item.id } });
        const onHand = Number(s?.available_qty) || 0;
        const change = e.kind === "count" ? qty - onHand : e.kind === "in" ? qty : -qty;
        if (e.kind === "out" && qty > onHand + 1e-9) fail(`Only ${r2(onHand)} in stock - you can't take out more than that`);
        const { applySemiFinishedMovement } = require("../engine/stockLedger");
        if (change) await sequelize.transaction((t) => applySemiFinishedMovement({ hotel_id: c.hotelId, semi_finished_item_id: item.id, qty: change, type: e.kind === "count" ? "adjustment" : e.kind === "in" ? "stock_in" : "stock_out", note: note || "Stock count", user_id: c.userId, t }));
        return;
    }
    const raw = await ownRaw(c, e.refId);
    const conv = Number(raw.conversion_qty) || 1;
    const purchaseQty = qty / conv;
    if (e.kind === "count") {
        const s = await M.StockInHand.findOne({ where: { hotel_id: c.hotelId, raw_material_id: raw.id, deleted: false } });
        const diff = purchaseQty - (Number(s?.qty) || 0);
        if (Math.abs(diff) < 1e-9) return;
        await callController(diff > 0 ? movementSvc.stockIn : movementSvc.stockOut, c, { body: { raw_material_id: raw.id, qty: Math.abs(diff), count: true } });
    } else if (e.kind === "in") {
        await callController(movementSvc.stockIn, c, { body: { raw_material_id: raw.id, qty: purchaseQty, price: e.rate !== undefined ? Number(e.rate) * conv : undefined, note } });
    } else {
        await callController(movementSvc.stockOut, c, { body: { raw_material_id: raw.id, qty: purchaseQty, note } });
    }
    await audit(c, "Stock", `Stock ${e.kind} · ${raw.raw_material_name} · ${qty}`);
}

async function recordWastage(c, w) {
    need(c, "stock-transactions", "create");
    if (w.refKind !== "raw") fail("Wastage is recorded for raw materials");
    const raw = await ownRaw(c, w.refId);
    if (!String(w.reason || "").trim()) fail("Pick a reason");
    // Entered in the consumption unit (the app's unit for stock).
    await callController(wastageCtl.createRawMaterialWastage, c, { body: [{ raw_material_id: raw.id, unit_id: raw.consumption_unit, qty: Number(w.qty), reason: String(w.reason).trim() }] });
}

async function deleteWastage(c, id) {
    need(c, "stock-transactions", "delete");
    const row = await M.Westage.findOne({ where: { id: idOf(id), hotel_id: c.hotelId } });
    if (!row) fail("Wastage record not found");
    await callController(wastageCtl.deleteWastageRecord, c, { params: { wastage_id: row.id } });
}

/* ------------------------------ recipes & semi-finished ------------------------------ */

const ingredient = (l) => (l.kind === "semi" ? { semi_finished_item_id: idOf(l.refId), consumption_qty: Number(l.qty) } : { raw_material_id: idOf(l.refId), consumption_qty: Number(l.qty) });

async function saveRecipe(c, r) {
    need(c, "stock-recipes", "edit");
    const item = await M.Menu.findOne({ where: { id: idOf(r.itemId), hotel_id: c.hotelId } });
    if (!item) fail("Menu item not found");
    const groups = [
        { raw_material_data: (r.base || []).map(ingredient) },
        ...Object.entries(r.byVariant || {}).map(([variant_id, lines]) => ({ variant_id: idOf(variant_id), raw_material_data: lines.map(ingredient) })),
        ...Object.entries(r.byAddon || {}).map(([addon_id, lines]) => ({ addon_id: idOf(addon_id), raw_material_data: lines.map(ingredient) })),
    ].filter((g) => g.raw_material_data.length);
    if (!groups.length) {
        await callController(recipeCtl.deleteRecipe, c, { body: { menu_id: item.id } });
        return;
    }
    await callController(recipeCtl.saveRecipe, c, { body: { menu_id: item.id, groups } });
    await audit(c, "Stock", `Saved recipe for ${item.item_name}`);
}

async function saveSemi(c, s) {
    need(c, "stock-recipes", s.id ? "edit" : "create");
    if (s.unitId) await ownUnit(c, s.unitId);
    for (const l of s.components || []) if (l.kind === "raw") await ownRaw(c, l.refId);
    const body = {
        name: s.name, unit_id: idOf(s.unitId) || null, min_stock_level: Number(s.minStock) > 0, min_stock_qty: Number(s.minStock) || 0,
        recipes: (s.components || []).filter((l) => l.kind === "raw").map((l) => ({ raw_material_id: idOf(l.refId), consumption_qty: Number(l.qty) })),
    };
    if (s.id) {
        const row = await M.SemiFinishedItem.findOne({ where: { id: idOf(s.id), hotel_id: c.hotelId } });
        if (!row) fail("Semi-finished item not found");
        await callController(semiCtl.editSemiFinishedItem, c, { body: { ...body, id: row.id } });
    } else await callController(semiCtl.addSemiFinishedItem, c, { body });
}

async function produceSemi(c, semiId, qty, note) {
    need(c, "stock-recipes", "create");
    const row = await M.SemiFinishedItem.findOne({ where: { id: idOf(semiId), hotel_id: c.hotelId } });
    if (!row) fail("Semi-finished item not found");
    await callController(semiCtl.recordProduction, c, { body: { semi_finished_item_id: row.id, produced_qty: Number(qty), notes: note || "" } });
    await audit(c, "Stock", `Produced ${qty} ${row.name}`);
}

module.exports = {
    saveUnit: { fn: saveUnit },
    saveRaw: { fn: saveRaw },
    saveSupplier: { fn: saveSupplier },
    savePurchase: { fn: savePurchase },
    deletePurchase: { fn: deletePurchase },
    addPurchasePayment: { fn: addPurchasePayment },
    deletePurchasePayment: { fn: deletePurchasePayment },
    stockEntry: { fn: stockEntry },
    recordWastage: { fn: recordWastage },
    deleteWastage: { fn: deleteWastage },
    saveRecipe: { fn: saveRecipe },
    saveSemi: { fn: saveSemi },
    produceSemi: { fn: produceSemi },
};
