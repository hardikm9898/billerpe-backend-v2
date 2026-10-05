const { Op } = require("sequelize");
const M = require("../model");
const { fail, buildContext, isOff } = require("../appv1/core");
const { callController } = require("../appv1/legacy");
const L = require("../appv1/load");
const catalog = require("../appv1/domains/catalog");
const admin = require("../appv1/domains/admin");
const money = require("../appv1/domains/money");
const stock = require("../appv1/domains/stock");
const menuCtl = require("../appv1/exe/controller/menu");
const { ownOutlet } = require("./watch");
const { stockLevels } = require("./reports");

// Owner App phase 3 "Manage" (design v1): menu, staff & access, tables &
// sections, settings and stock masters of a Plan 1 outlet, changed in the
// cloud and pulled by the outlet PC within about a minute (its heartbeat).
//
// Every change goes through the POS App's own write code (appv1/domains),
// which calls the exe's OWN controllers (appv1/exe): a row the owner saves
// here is stored exactly as the Web POS would store it, so the PC can pull
// it like any other row. Ids are this server's; the PC translates them.
//
// Sync never carries a deletion (a hard delete here would never reach the
// PC), so nothing here deletes: items are flagged is_deleted, everything
// else is switched off. Recipes are view only (owner 2026-10-05) because
// saving one deletes and re-creates its lines. Stock levels belong to the
// PC: no opening stock or stock entries from here.
//
// Each change is noted in owner_changes; the sync pull marks it delivered
// when the PC downloads that row (controller/sync/syncController.js).

/** The owner's POS App-style context at one outlet (every permission). */
async function ctxAt(o, outletId) {
    const owned = ownOutlet(o, outletId);
    const c = await buildContext(owned.hotel.id, owned.user.id, "owner-app");
    if (!c) fail("Your owner login at this outlet is switched off");
    return c;
}

/** Notes rows the PC still has to download (sync entity name + this server's id). */
async function noteChanges(hotelId, entity, ids, label) {
    const list = [...new Set((Array.isArray(ids) ? ids : [ids]).map(Number).filter((x) => x > 0))];
    if (!list.length) return;
    await M.OwnerChange.bulkCreate(list.map((item_id) => ({ hotel_id: hotelId, entity, item_id, label: String(label || "").slice(0, 120) }))).catch((err) =>
        console.error("[ownerv1] change not noted:", err.message),
    );
}

/**
 * One write, then noted for the PC. `track(result)` -> [entity, ids, label].
 * Like the POS App's own master-data writes, NOT inside mutate(): the exe
 * controllers write outside its transaction, and an insert's foreign-key
 * check on the outlet row would wait on mutate's lock until it times out.
 */
async function write(o, outletId, fn, track) {
    const c = await ctxAt(o, outletId);
    const result = await fn(c);
    const t = track ? await track(result, c) : null;
    if (t) await noteChanges(c.hotelId, t[0], t[1], t[2]);
    return result || {};
}

/** Changes not yet on the outlet PC: entity -> Set of ids. */
async function pendingOf(hotelId) {
    const rows = await M.OwnerChange.findAll({ where: { hotel_id: hotelId, synced_at: null }, attributes: ["entity", "item_id", "label", "createdAt"], raw: true }).catch(() => []);
    const map = new Map();
    for (const r of rows) {
        if (!map.has(r.entity)) map.set(r.entity, new Set());
        map.get(r.entity).add(String(r.item_id));
    }
    return { map, count: rows.length, oldest: rows.reduce((m, r) => (!m || r.createdAt < m ? r.createdAt : m), null) };
}
const isPending = (p, entity, id) => !!p.map.get(entity)?.has(String(id));

/* ------------------------------ reads ------------------------------ */

/** Manage hub: what is there, and what is still on its way to the PC. */
async function manage(o, outletId) {
    const { hotel } = ownOutlet(o, outletId);
    const h = hotel.id;
    const [items, itemsOff, staff, staffOff, tables, sections, taxes, modes, promos, heads, levels, pending, charge] = await Promise.all([
        M.Menu.count({ where: { hotel_id: h, is_deleted: { [Op.not]: true }, shortCode: { [Op.ne]: "CUSTOM" } } }),
        M.Menu.count({ where: { hotel_id: h, is_deleted: { [Op.not]: true }, shortCode: { [Op.ne]: "CUSTOM" }, active: false } }),
        M.HotelUser.count({ where: { hotel_id: h } }),
        M.HotelUser.count({ where: { hotel_id: h, active: false } }),
        M.Table.count({ where: { hotel_id: h, active: true } }),
        M.TableCatagories.count({ where: { hotel_id: h, active: { [Op.not]: false } } }),
        M.TaxType.findAll({ where: { hotel_id: h }, raw: true }),
        M.PaymentMode.findAll({ where: { hotel_id: h }, raw: true }),
        M.PromoCode.count({ where: { hotel_id: h, status: true } }),
        M.ExpenseHead.count({ where: { hotel_id: h, deleted: { [Op.not]: true } } }),
        stockLevels(h),
        pendingOf(h),
        M.ServiceCharge.findOne({ where: { hotel_id: h }, raw: true }),
    ]);
    const onTaxes = taxes.filter((t) => !isOff(t.active));
    const modeNames = L.paymentModesView(modes).filter((m) => m.active).map((m) => m.name);
    return {
        serverTime: new Date().toISOString(),
        items, itemsOff, staff, staffOff, tables, sections,
        lowStock: levels ? levels.filter((l) => l.status !== "OK").length : null,
        stockItems: levels ? levels.length : 0,
        taxSummary: onTaxes.length ? onTaxes.map((t) => `${t.tax_name} ${Number(t.amount)}${t.tax_value === "fix" ? "" : "%"}`).join(" · ") : "No tax",
        serviceCharge: charge && !isOff(charge.active) ? `${charge.service_charge_type === "fixed" ? "₹" : ""}${Number(charge.service_charge_value) || 0}${charge.service_charge_type === "fixed" ? "" : "%"}` : null,
        paymentModes: modeNames,
        promos,
        expenseHeads: heads,
        pending: pending.count,
        pendingSince: pending.oldest ? new Date(pending.oldest).toISOString() : null,
    };
}

async function menu(o, outletId) {
    const { hotel } = ownOutlet(o, outletId);
    const [view, pending, recipeCounts] = await Promise.all([
        L.menuView(hotel.id),
        pendingOf(hotel.id),
        M.Recipes.findAll({ where: { hotel_id: hotel.id }, attributes: ["menu_id"], raw: true }),
    ]);
    const withRecipe = new Set(recipeCounts.map((r) => String(r.menu_id)));
    return {
        serverTime: new Date().toISOString(),
        menus: view.menus,
        categories: view.categories.map((c) => ({ ...c, syncing: isPending(pending, "menuCategs", c.id) })),
        variants: view.variants,
        addonGroups: view.addonGroups.map((g) => ({ id: g.id, menuId: g.menuId, name: g.name, active: g.active })),
        items: view.items.map((i) => ({ ...i, syncing: isPending(pending, "menuItems", i.id), hasRecipe: withRecipe.has(i.id) })),
    };
}

async function staff(o, outletId) {
    const { hotel } = ownOutlet(o, outletId);
    const [list, saved, pending] = await Promise.all([
        L.staffView(hotel.id),
        M.RolePermissionDefault.findAll({ where: { hotel_id: hotel.id }, raw: true }),
        pendingOf(hotel.id),
    ]);
    return {
        serverTime: new Date().toISOString(),
        staff: list.map((s) => ({ ...s, syncing: isPending(pending, "hotelUsers", s.id) })),
        roleDefaults: L.roleDefaultsView(saved),
    };
}

async function tables(o, outletId) {
    const { hotel } = ownOutlet(o, outletId);
    const [sections, rows, running, pending] = await Promise.all([
        M.TableCatagories.findAll({ where: { hotel_id: hotel.id, active: { [Op.not]: false } }, order: [["rank", "ASC"], ["id", "ASC"]], raw: true }),
        M.Table.findAll({ where: { hotel_id: hotel.id, active: true }, order: [["id", "ASC"]], raw: true }),
        M.Order.findAll({ where: { hotel_id: hotel.id, deleted: false, payment: "pending", TableId: { [Op.ne]: null } }, attributes: ["TableId"], raw: true }),
        pendingOf(hotel.id),
    ]);
    const busy = new Set(running.map((r) => r.TableId));
    return {
        serverTime: new Date().toISOString(),
        sections: sections.map((s) => ({
            id: String(s.id), name: s.table_catag_nm, rank: Number(s.rank) || 0, syncing: isPending(pending, "tableCategs", s.id),
            tables: rows.filter((t) => t.table_catag_id === s.id).map((t) => ({ id: String(t.id), name: t.table_name, seats: Number(t.capacity) || 0, running: busy.has(t.id), syncing: isPending(pending, "tables", t.id) })),
        })),
    };
}

async function settings(o, outletId) {
    const { hotel } = ownOutlet(o, outletId);
    const h = hotel.id;
    const [hotelRow, setting, heads, pending] = await Promise.all([
        M.Hotel.findOne({ where: { id: h }, raw: true }),
        M.RestaurantSetting.findOne({ where: { hotel_id: h }, raw: true }),
        M.ExpenseHead.findAll({ where: { hotel_id: h, deleted: { [Op.not]: true } }, order: [["id", "ASC"]], raw: true }),
        pendingOf(h),
    ]);
    const s = await L.settingsView(h, hotelRow, setting, []);
    return {
        serverTime: new Date().toISOString(),
        taxes: s.taxes.map((t) => ({ ...t, syncing: isPending(pending, "taxTypes", t.id) })),
        serviceCharge: s.serviceCharge,
        packagingCharge: s.packagingCharge,
        paymentModes: s.paymentModes,
        promoCodes: s.promoCodes.map((p) => ({ ...p, syncing: isPending(pending, "promoCodes", p.id) })),
        expenseHeads: heads.map((x) => ({ id: String(x.id), name: x.expense_head_name, system: x.expense_head_name === "Supplier payment", syncing: isPending(pending, "expenseHeads", x.id) })),
    };
}

async function stockMasters(o, outletId) {
    const { hotel } = ownOutlet(o, outletId);
    const h = hotel.id;
    const [view, levels, items, pending] = await Promise.all([
        L.stockView(h, new Map(), new Date()),
        stockLevels(h),
        M.Menu.findAll({ where: { hotel_id: h, is_deleted: { [Op.not]: true } }, attributes: ["id", "item_name"], raw: true }),
        pendingOf(h),
    ]);
    const itemName = new Map(items.map((i) => [String(i.id), i.item_name]));
    const level = new Map((levels || []).filter((l) => l.kind === "raw").map((l) => [String(l.id), l]));
    return {
        serverTime: new Date().toISOString(),
        stockUploaded: !!levels?.length,
        units: view.units,
        raw: view.raw.map((r) => ({
            id: r.id, name: r.name, unitId: r.unitId, purchaseUnitId: r.purchaseUnitId, conversion: r.conversion, reorderLevel: r.reorderLevel,
            stock: level.get(r.id)?.qty ?? null, low: level.has(r.id) ? level.get(r.id).status !== "OK" : null, syncing: isPending(pending, "rawMaterials", r.id),
        })),
        suppliers: view.suppliers.map((s) => ({ id: s.id, name: s.name, outstanding: s.outstanding, syncing: isPending(pending, "suppliers", s.id) })),
        semi: (view.semi || []).map((x) => ({ id: x.id, name: x.name })),
        recipes: (view.recipes || []).map((r) => ({ itemId: r.itemId, itemName: itemName.get(r.itemId) || "Item", base: r.base, variants: Object.keys(r.byVariant || {}).length, addons: Object.keys(r.byAddon || {}).length }))
            .sort((a, b) => a.itemName.localeCompare(b.itemName)),
    };
}

/* ------------------------------ writes ------------------------------ */

const id = (v) => Number(v) || 0;

/** The quick on/off of an item (Inactive = hidden from billing, Captain and QR; owner 2026-09-28). */
const setItemActive = (o, outletId, itemId, active) => write(o, outletId, async (c) => {
    const row = await M.Menu.findOne({ where: { id: id(itemId), hotel_id: c.hotelId, is_deleted: { [Op.not]: true } } });
    if (!row) fail("Item not found");
    await row.update({ active: !!active });
    return { id: String(row.id), name: row.item_name };
}, (r) => ["menuItems", r.id, `${r.name} ${active ? "on" : "off"}`]);

const saveItem = (o, outletId, item) => write(o, outletId, async (c) => {
    // The item's own availability is `active`; the cloud-only out_of_stock is never set from here.
    const r = await catalog.saveItem.fn(c, { ...item, outOfStock: false });
    return { id: r.id, name: item.name };
}, (r) => ["menuItems", r.id, `Item ${r.name}`]);

/** Deleted like the Web POS (switched off) and gone from lists (is_deleted). Recipes stay: a delete would never reach the PC. */
const deleteItem = (o, outletId, itemId) => write(o, outletId, async (c) => {
    const row = await M.Menu.findOne({ where: { id: id(itemId), hotel_id: c.hotelId } });
    if (!row) fail("Item not found");
    await callController(menuCtl.removeMenu, c, { body: { id: row.id } });
    await row.update({ is_deleted: true, active: false });
    return { id: String(row.id), name: row.item_name };
}, (r) => ["menuItems", r.id, `Deleted ${r.name}`]);

const saveCategory = (o, outletId, cat) => write(o, outletId, async (c) => {
    await catalog.saveCategory.fn(c, cat);
    const row = cat.id
        ? await M.Menu_categ.findOne({ where: { id: id(cat.id), hotel_id: c.hotelId }, raw: true })
        : await M.Menu_categ.findOne({ where: { hotel_id: c.hotelId, menu_categ_nm: String(cat.name).trim() }, order: [["id", "DESC"]], raw: true });
    return { id: row ? String(row.id) : null, name: cat.name };
}, (r) => ["menuCategs", r.id, `Category ${r.name}`]);

const saveStaff = (o, outletId, s) => write(o, outletId, async (c) => {
    await admin.saveStaff.fn(c, s);
    const row = await M.HotelUser.findOne({ where: { hotel_id: c.hotelId, number: String(s.mobile) }, raw: true });
    return { id: row ? String(row.id) : null, name: s.name };
}, (r) => ["hotelUsers", r.id, `Staff ${r.name}`]);

const setStaffActive = (o, outletId, staffId, active) => write(o, outletId, async (c) => {
    await admin.setStaffActive.fn(c, staffId, active);
    return { id: String(id(staffId)) };
}, (r) => ["hotelUsers", r.id, active ? "Staff on" : "Staff off"]);

/** Per-person permissions; null = back to the role's defaults. */
const setStaffPermissions = (o, outletId, staffId, perms) => write(o, outletId, async (c) => {
    const u = await M.HotelUser.findOne({ where: { id: id(staffId), hotel_id: c.hotelId } });
    if (!u) fail("Staff not found");
    const { isOwnerAccount, OWNER_LOCKED_MESSAGE } = require("../appv1/exe/helpers/ownerAccount");
    if (await isOwnerAccount(c.hotelId, u)) fail(OWNER_LOCKED_MESSAGE);
    await admin.setUserOverrides.fn(c, staffId, perms);
    return { id: String(u.id) };
}, (r) => ["hotelUsers", r.id, "Permissions"]);

const saveSection = (o, outletId, s) => write(o, outletId, async (c) => {
    await catalog.saveSection.fn(c, s);
    const row = s.id ? { id: id(s.id) } : await M.TableCatagories.findOne({ where: { hotel_id: c.hotelId, table_catag_nm: String(s.name).trim(), active: true }, order: [["id", "DESC"]], raw: true });
    return { id: row ? String(row.id) : null };
}, (r) => ["tableCategs", r.id, "Section"]);

const deleteSection = (o, outletId, sectionId) => write(o, outletId, async (c) => {
    await catalog.deleteSection.fn(c, sectionId);
    return { id: String(id(sectionId)) };
}, (r) => ["tableCategs", r.id, "Section off"]);

const addTables = (o, outletId, sectionId, spec, seats) => write(o, outletId, async (c) => {
    const before = await M.Table.max("updatedAt", { where: { hotel_id: c.hotelId } });
    const r = await catalog.addTables.fn(c, sectionId, spec, seats);
    const rows = await M.Table.findAll({ where: { hotel_id: c.hotelId, table_catag_id: id(sectionId), ...(before ? { updatedAt: { [Op.gte]: before } } : {}) }, attributes: ["id"], raw: true });
    return { ...r, ids: rows.map((x) => x.id) };
}, (r) => ["tables", r.ids, "Tables added"]);

const editTable = (o, outletId, tableId, patch) => write(o, outletId, async (c) => {
    await catalog.editTable.fn(c, tableId, patch);
    return { id: String(id(tableId)) };
}, (r) => ["tables", r.id, "Table"]);

/** Switched off (never deleted); refused while it has a running bill. */
const removeTable = (o, outletId, tableId) => write(o, outletId, async (c) => {
    await catalog.deleteTable.fn(c, tableId);
    return { id: String(id(tableId)) };
}, (r) => ["tables", r.id, "Table off"]);

const saveTax = (o, outletId, t) => write(o, outletId, async (c) => {
    await admin.saveTax.fn(c, t);
    const row = t.id ? { id: id(t.id) } : await M.TaxType.findOne({ where: { hotel_id: c.hotelId, tax_name: String(t.name).trim() }, order: [["id", "DESC"]], raw: true });
    return { id: row ? String(row.id) : null };
}, (r) => ["taxTypes", r.id, "Tax"]);

const saveCharge = (o, outletId, which, rule) => write(o, outletId, async (c) => {
    if (!["service", "packaging"].includes(which)) fail("Unknown charge");
    await admin.saveCharge.fn(c, which, rule);
    const row = which === "service"
        ? await M.ServiceCharge.findOne({ where: { hotel_id: c.hotelId }, raw: true })
        : await M.BillChargeRule.findOne({ where: { hotel_id: c.hotelId, rule_for: "packaging" }, raw: true });
    return { id: row ? String(row.id) : null, entity: which === "service" ? "serviceCharge" : "billChargeRules" };
}, (r) => [r.entity, r.id, "Charge"]);

/** Add / rename / switch on-off. Never removed from here (removal is a hard delete). */
const savePaymentMode = (o, outletId, m) => write(o, outletId, async (c) => {
    await admin.savePaymentMode.fn(c, m);
    const name = String(m.name || "").trim().toLowerCase();
    const row = (await M.PaymentMode.findAll({ where: { hotel_id: c.hotelId }, raw: true })).find((x) => String(x.name).trim().toLowerCase() === name);
    return { id: row ? String(row.id) : null };
}, (r) => ["paymentModes", r.id, "Payment mode"]);

/** Add / edit / switch on-off. Never deleted from here (a delete would never reach the PC). */
const savePromo = (o, outletId, p) => write(o, outletId, async (c) => {
    await admin.savePromo.fn(c, p);
    const row = await M.PromoCode.findOne({ where: { hotel_id: c.hotelId, promo_code: String(p.code || "").trim().toUpperCase() }, raw: true });
    return { id: row ? String(row.id) : null };
}, (r) => ["promoCodes", r.id, "Promo code"]);

const saveExpenseHead = (o, outletId, h) => write(o, outletId, async (c) => {
    await money.saveExpenseHead.fn(c, h);
    const row = h.id ? { id: id(h.id) } : await M.ExpenseHead.findOne({ where: { hotel_id: c.hotelId, expense_head_name: String(h.name).trim() }, order: [["id", "DESC"]], raw: true });
    return { id: row ? String(row.id) : null };
}, (r) => ["expenseHeads", r.id, "Expense head"]);

/** A raw material's details and reorder level - never its stock (the PC owns stock). */
const saveRaw = (o, outletId, r) => write(o, outletId, async (c) => {
    const { openingStock, openingRate, ...rest } = r;
    const out = await stock.saveRaw.fn(c, rest);
    return { id: out.id, name: r.name };
}, (r) => ["rawMaterials", r.id, `Raw material ${r.name}`]);

const saveSupplier = (o, outletId, s) => write(o, outletId, async (c) => {
    await stock.saveSupplier.fn(c, s);
    const row = s.id ? { id: id(s.id) } : await M.Supplier.findOne({ where: { hotel_id: c.hotelId, name: String(s.name).trim() }, order: [["id", "DESC"]], raw: true });
    return { id: row ? String(row.id) : null };
}, (r) => ["suppliers", r.id, "Supplier"]);

const saveUnit = (o, outletId, u) => write(o, outletId, async (c) => {
    await stock.saveUnit.fn(c, u);
    const row = u.id ? { id: id(u.id) } : await M.Unit.findOne({ where: { hotel_id: c.hotelId, unit_name: String(u.name).trim() }, order: [["id", "DESC"]], raw: true });
    return { id: row ? String(row.id) : null };
}, (r) => ["units", r.id, "Unit"]);

module.exports = {
    manage, menu, staff, tables, settings, stockMasters,
    setItemActive, saveItem, deleteItem, saveCategory,
    saveStaff, setStaffActive, setStaffPermissions,
    saveSection, deleteSection, addTables, editTable, removeTable,
    saveTax, saveCharge, savePaymentMode, savePromo, saveExpenseHead,
    saveRaw, saveSupplier, saveUnit,
};
