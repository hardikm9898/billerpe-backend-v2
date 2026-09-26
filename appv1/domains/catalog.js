const { Op } = require("sequelize");
const M = require("../../model");
const { fail, need, audit } = require("../core");
const { callController } = require("../legacy");
const { dietaryText } = require("../orders");
const menuCtl = require("../exe/controller/menu");
const catalogCtl = require("../exe/controller/menuCatalog");
const variantCtl = require("../exe/controller/variant");
const addonCtl = require("../exe/controller/addon");

// Menu and tables for POS App outlets. Menus, categories, items, variants
// and addon groups go through the exe's own controllers (appv1/exe), so an
// item saved from the app is stored exactly like one saved in the Web POS.
// Tables follow the exe's controller/table.js rules (not copied: that file
// also carries the exe's LAN/sync plumbing).

const idOf = (v) => Number(v) || 0;

/* ------------------------------ menus ------------------------------ */

async function saveMenu(c, m) {
    need(c, "menu", m.id ? "edit" : "create");
    const name = String(m.name || "").trim();
    if (!name) fail("Name is required");
    const body = { name, table_category_ids: (m.sectionIds || []).map(Number), order_types: m.orderTypes || [] };
    if (m.id) {
        const row = await M.MenuCatalog.findOne({ where: { id: idOf(m.id), hotel_id: c.hotelId } });
        if (!row) fail("Menu not found");
        if (row.is_default && m.isDefault === false) fail("One menu must stay the default. Make another menu the default instead.");
        const clash = await M.MenuCatalog.findOne({ where: { hotel_id: c.hotelId, name, active: true, id: { [Op.ne]: row.id } } });
        if (clash) fail("A menu with this name already exists");
        await callController(catalogCtl.editMenuCatalog, c, { body: { ...body, id: row.id, is_default: !!m.isDefault } });
        if (m.active !== undefined) await row.update({ active: row.is_default ? true : m.active !== false });
    } else {
        await callController(catalogCtl.createMenuCatalog, c, { body });
        if (m.isDefault) {
            const created = await M.MenuCatalog.findOne({ where: { hotel_id: c.hotelId, name, active: true }, order: [["id", "DESC"]] });
            await callController(catalogCtl.editMenuCatalog, c, { body: { id: created.id, is_default: true } });
        }
    }
    await audit(c, "Menu", `Saved menu ${name}`);
}

/* ------------------------------ categories ------------------------------ */

async function saveCategory(c, cat) {
    need(c, "menu", cat.id ? "edit" : "create");
    const name = String(cat.name || "").trim();
    if (!name) fail("Name is required");
    const menuCatalogId = idOf(cat.menuId) || undefined;
    if (cat.id) {
        const row = await M.Menu_categ.findOne({ where: { id: idOf(cat.id), hotel_id: c.hotelId } });
        if (!row) fail("Category not found");
        const clash = await M.Menu_categ.findOne({ where: { hotel_id: c.hotelId, menu_categ_nm: name, active: true, id: { [Op.ne]: row.id }, ...(menuCatalogId ? { menu_catalog_id: menuCatalogId } : {}) } });
        if (clash) fail("This category already exists in the menu");
        await callController(menuCtl.editCatagories, c, { body: { editCatagoriesFrom: { id: row.id, menu_categ_nm: name, rank: cat.rank ?? row.rank, menu_catalog_id: menuCatalogId } } });
        if (cat.active !== undefined && cat.active !== row.active) await row.update({ active: cat.active !== false });
    } else {
        await callController(menuCtl.createCatagories, c, { body: { catagoriesFrom: { catagories_name: name, menu_catalog_id: menuCatalogId } } });
    }
    await audit(c, "Menu", `Saved category ${name}`);
}

async function deleteCategory(c, id) {
    need(c, "menu", "delete");
    const items = await M.Menu.count({ where: { hotel_id: c.hotelId, menu_categ_id: idOf(id), active: true, is_deleted: { [Op.not]: true } } });
    if (items) fail("Move or delete its items first");
    await callController(menuCtl.removeCatagories, c, { body: { id: idOf(id) } });
}

/* ------------------------------ items ------------------------------ */

/** Next free numeric short code - the Web POS gives one when none is typed. */
async function nextShortCode(hotelId) {
    const rows = await M.Menu.findAll({ where: { hotel_id: hotelId }, attributes: ["shortCode"], raw: true });
    return String(rows.reduce((m, r) => Math.max(m, /^\d+$/.test(r.shortCode || "") ? Number(r.shortCode) : 0), 100) + 1);
}

async function saveItem(c, i) {
    need(c, "menu", i.id ? "edit" : "create");
    const name = String(i.name || "").trim();
    if (!name) fail("Name is required");
    if (!(Number(i.price) > 0) && !(i.variants || []).length) fail("Price must be more than 0");
    if ((i.variants || []).some((v) => !(Number(v.price) > 0))) fail("Every variant needs a price");
    const shortCode = String(i.shortCode || "").trim().toUpperCase() || (await nextShortCode(c.hotelId));
    const price = Number(i.price) > 0 ? Number(i.price) : Math.min(...i.variants.map((v) => Number(v.price)));
    const body = {
        item_name: name, menu_categ_id: idOf(i.categoryId), price, shortCode, description: i.description || "",
        favorite: !!i.favorite, imageUrl: i.imageUrl || null, sub_categories: dietaryText(i.dietary), gst_type: i.gstType === "S" ? "S" : "G",
        barcode_value: i.barcode || null,
        variants: (i.variants || []).map((v) => ({ id: idOf(v.variantId), variant_price: Number(v.price) })),
        addons: (i.addonGroupIds || []).map(idOf),
    };
    let id = idOf(i.id);
    if (id) {
        const row = await M.Menu.findOne({ where: { id, hotel_id: c.hotelId } });
        if (!row) fail("Item not found");
        await callController(menuCtl.editMenu, c, { body: { ...body, id } });
    } else {
        await callController(menuCtl.createMenu, c, { body });
        id = (await M.Menu.findOne({ where: { hotel_id: c.hotelId, shortCode, active: true }, order: [["id", "DESC"]] })).id;
    }
    await M.Menu.update({ active: i.active !== false, out_of_stock: !!i.outOfStock }, { where: { id, hotel_id: c.hotelId } });
    await audit(c, "Menu", `Saved item ${name}`);
    return { id: String(id) };
}

/** Removed like the exe (active: false) and hidden from the editor (is_deleted). */
async function deleteItem(c, id) {
    need(c, "menu", "delete");
    const row = await M.Menu.findOne({ where: { id: idOf(id), hotel_id: c.hotelId } });
    if (!row) fail("Item not found");
    await callController(menuCtl.removeMenu, c, { body: { id: row.id } });
    await row.update({ is_deleted: true });
    await M.Recipes.destroy({ where: { hotel_id: c.hotelId, menu_id: row.id } });
    await audit(c, "Menu", `Deleted item ${row.item_name}`);
}

async function setOutOfStock(c, id, out) {
    need(c, "menu", "edit");
    const row = await M.Menu.findOne({ where: { id: idOf(id), hotel_id: c.hotelId } });
    if (!row) fail("Item not found");
    await row.update({ out_of_stock: !!out });
    await audit(c, "Menu", `${row.item_name}: ${out ? "out of stock" : "back in stock"}`);
}

/* ------------------------------ variants & addons ------------------------------ */

async function saveVariant(c, v) {
    need(c, "menu", v.id ? "edit" : "create");
    const name = String(v.name || "").trim();
    if (!name) fail("Name is required");
    const body = { variants_name: name, active: true, menu_catalog_id: idOf(v.menuId) || undefined };
    if (v.id) {
        const row = await M.Variants.findOne({ where: { id: idOf(v.id), hotel_id: c.hotelId } });
        if (!row) fail("Variant not found");
        await callController(variantCtl.updatedVariant, c, { body: { ...body, id: row.id } });
    } else await callController(variantCtl.createVariant, c, { body });
}

async function saveAddonGroup(c, g) {
    need(c, "menu", g.id ? "edit" : "create");
    const name = String(g.name || "").trim();
    if (!name) fail("Name is required");
    const options = g.options || [];
    if (!options.length) fail("Add at least one option");
    if (options.some((o) => !String(o.name || "").trim())) fail("Every option needs a name");
    if (options.some((o) => Number(o.price) < 0)) fail("Option price cannot be negative");
    if (Number(g.min) < 0 || Number(g.max) < 1) fail("Max must be at least 1");
    const body = {
        department_name: name, maximum_allowed_addon: Number(g.max), minimum_allowed_addon: Number(g.min), singleSelection: Number(g.max) === 1,
        addons: options.map((o) => ({ addon_name: String(o.name).trim(), price: Number(o.price) || 0, attributes: o.dietary === "nonveg" ? "nonveg" : o.dietary || "veg" })),
        menu_catalog_id: idOf(g.menuId) || undefined,
    };
    if (g.id) {
        const row = await M.AddonDepartment.findOne({ where: { id: idOf(g.id), hotel_id: c.hotelId } });
        if (!row) fail("Addon group not found");
        await callController(addonCtl.updatedAddons, c, { body: { ...body, id: row.id } });
        if (g.active !== undefined) await row.update({ active: g.active !== false });
    } else await callController(addonCtl.createAddonDepartment, c, { body });
}

/** The exe has no delete for addon groups: switched off and unlinked from items. */
async function deleteAddonGroup(c, id) {
    need(c, "menu", "delete");
    const row = await M.AddonDepartment.findOne({ where: { id: idOf(id), hotel_id: c.hotelId } });
    if (!row) fail("Addon group not found");
    await row.update({ active: false });
    await M.MenuAddon.destroy({ where: { hotel_id: c.hotelId, addon_department_id: row.id } });
}

/* ------------------------------ sections & tables ------------------------------ */

async function saveSection(c, s) {
    need(c, "tables", s.id ? "edit" : "create");
    const name = String(s.name || "").trim();
    if (!name) fail("Table Category name is required");
    const clash = await M.TableCatagories.findOne({ where: { hotel_id: c.hotelId, table_catag_nm: name, active: true, type: "T", ...(s.id ? { id: { [Op.ne]: idOf(s.id) } } : {}) } });
    if (clash) fail("Table Category Already Available");
    if (s.id) {
        const row = await M.TableCatagories.findOne({ where: { id: idOf(s.id), hotel_id: c.hotelId, active: true } });
        if (!row) fail("Table Category Not Found");
        await row.update({ table_catag_nm: name, ...(s.rank !== undefined ? { rank: Number(s.rank) || 0 } : {}) });
    } else {
        const maxRank = await M.TableCatagories.max("rank", { where: { hotel_id: c.hotelId, active: true } });
        await M.TableCatagories.create({ type: "T", table_catag_nm: name, hotel_id: c.hotelId, rank: (maxRank || 0) + 1 });
    }
}

async function deleteSection(c, id) {
    need(c, "tables", "delete");
    const row = await M.TableCatagories.findOne({ where: { id: idOf(id), hotel_id: c.hotelId, active: true } });
    if (!row) fail("Category Not Found");
    const tables = await M.Table.count({ where: { hotel_id: c.hotelId, table_catag_id: row.id, active: true } });
    if (tables) fail("Move or delete its tables first");
    await row.update({ active: false });
}

/** "T5" or a range "T1-T20" (the Web POS bulk add). Existing names are skipped; removed ones come back. */
async function addTables(c, sectionId, spec, seats) {
    need(c, "tables", "create");
    const section = await M.TableCatagories.findOne({ where: { id: idOf(sectionId), hotel_id: c.hotelId, active: true } });
    if (!section) fail("Pick a section");
    const m = String(spec || "").trim().toUpperCase().match(/^([A-Z]*)(\d+)(?:\s*[-–—]\s*([A-Z]*)(\d+))?$/);
    if (!m) fail("Use a name like T5 or a range like T1-T20");
    const prefix = m[1] || "";
    const from = Number(m[2]);
    const to = m[4] ? Number(m[4]) : from;
    if (to < from) fail("The range must end after it starts");
    if (to - from >= 200) fail("Enter a valid range of table numbers (up to 200 at a time)");
    if (!Number.isInteger(Number(seats)) || Number(seats) < 1) fail("Seats must be a whole number of at least 1");
    const skipped = [];
    let added = 0;
    for (let n = from; n <= to; n++) {
        const table_name = `${prefix}${n}`;
        const existing = await M.Table.findOne({ where: { hotel_id: c.hotelId, table_catag_id: section.id, table_name, type: "T" } });
        if (existing?.active) {
            skipped.push(table_name);
            continue;
        }
        if (existing) await existing.update({ active: true, capacity: Number(seats), table_status: "F" });
        else await M.Table.create({ table_name, type: "T", table_catag_id: section.id, hotel_id: c.hotelId, capacity: Number(seats), table_status: "F" });
        added += 1;
    }
    if (!added) fail(`${skipped.join(", ")} already exist`);
    await audit(c, "Tables", `Added ${added} table(s) in ${section.table_catag_nm}`);
    return { added, skipped };
}

async function openOrderOn(c, tableId) {
    return M.Order.findOne({ where: { hotel_id: c.hotelId, TableId: tableId, deleted: false, payment: "pending" } });
}

async function editTable(c, id, patch) {
    need(c, "tables", "edit");
    const t = await M.Table.findOne({ where: { id: idOf(id), hotel_id: c.hotelId, active: true } });
    if (!t) fail("Table not found");
    if (await openOrderOn(c, t.id)) fail("Table Can't Update It's Running");
    const fields = {};
    if (patch.name !== undefined) {
        const n = String(patch.name).trim().toUpperCase();
        if (!n) fail("Table name is required");
        fields.table_name = n;
    }
    if (patch.seats !== undefined) {
        if (!Number.isInteger(Number(patch.seats)) || Number(patch.seats) < 1) fail("Seats must be a whole number of at least 1");
        fields.capacity = Number(patch.seats);
    }
    if (patch.sectionId) {
        const section = await M.TableCatagories.findOne({ where: { id: idOf(patch.sectionId), hotel_id: c.hotelId, active: true } });
        if (!section) fail("Table Category Not Available");
        fields.table_catag_id = section.id;
    }
    const name = fields.table_name ?? t.table_name;
    const sec = fields.table_catag_id ?? t.table_catag_id;
    const clash = await M.Table.findOne({ where: { hotel_id: c.hotelId, table_catag_id: sec, table_name: name, active: true, id: { [Op.ne]: t.id } } });
    if (clash) fail(`Table "${name}" already exists in this section`);
    await t.update(fields);
}

async function deleteTable(c, id) {
    need(c, "tables", "delete");
    const t = await M.Table.findOne({ where: { id: idOf(id), hotel_id: c.hotelId, active: true } });
    if (!t) fail("Table not found");
    if (await openOrderOn(c, t.id)) fail("This table has an open order");
    await t.update({ active: false });
    await audit(c, "Tables", `Deleted table ${t.table_name}`);
}

/** New QR: old stickers stop working (the cloud's regenerateTableQr). */
async function newTableQr(c, id) {
    need(c, "ops-experience", "edit");
    const t = await M.Table.findOne({ where: { id: idOf(id), hotel_id: c.hotelId, active: true } });
    if (!t) fail("Table not found");
    await t.update({ qr_version: (Number(t.qr_version) || 1) + 1 });
    await audit(c, "Tables", `New QR for ${t.table_name} (old stickers stop working)`);
}

module.exports = {
    saveMenu: { fn: saveMenu },
    saveCategory: { fn: saveCategory },
    deleteCategory: { fn: deleteCategory },
    saveItem: { fn: saveItem },
    deleteItem: { fn: deleteItem },
    setOutOfStock: { fn: setOutOfStock },
    saveVariant: { fn: saveVariant },
    saveAddonGroup: { fn: saveAddonGroup },
    deleteAddonGroup: { fn: deleteAddonGroup },
    saveSection: { fn: saveSection },
    deleteSection: { fn: deleteSection },
    addTables: { fn: addTables },
    editTable: { fn: editTable },
    deleteTable: { fn: deleteTable },
    newTableQr: { fn: newTableQr },
};
