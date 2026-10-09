const { Hotel, MenuCatalog } = require("../../model");
const { RuleError, buildContext } = require("../../appv1/core");
const { need } = require("../auth");
const audit = require("../audit");
const onboarding = require("./onboarding");
const { ownerUser } = require("./outletEdit");
const { txt } = require("./common");

// Menu upload from Excel for an outlet (old panel: "upload menu from Excel",
// owner 2026-10-08: nothing the team used may go missing). The rows go in
// through the POS App's own menu import (appv1/domains/catalog.js
// importMenu) run as the outlet's owner, so today's menu rules apply: one
// menu (catalog) at a time, missing categories made, an item with the same
// name updated instead of doubled, bad rows reported and the rest saved.

const COLS = {
    category: ["category", "category_name", "category name"],
    name: ["item", "item_name", "item name", "name"],
    price: ["price", "rate", "mrp"],
    shortCode: ["shortcode", "short code", "short_code", "code"],
    veg: ["veg", "veg/non-veg", "veg or non-veg", "type"],
    active: ["active", "available"],
};

function readRows(fileBase64) {
    const XLSX = require("xlsx");
    const buf = Buffer.from(String(fileBase64 || ""), "base64");
    if (!buf.length) throw new RuleError("Choose the Excel or CSV file.");
    if (buf.length > 5 * 1024 * 1024) throw new RuleError("The file is over 5 MB.");
    let wb;
    try {
        wb = XLSX.read(buf, { type: "buffer" });
    } catch {
        throw new RuleError("This file could not be read. Use .xlsx, .xls or .csv.");
    }
    const sheet = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: "" });
    if (sheet.length < 2) throw new RuleError("The file has no items under its heading row.");
    const head = sheet[0].map((h) => String(h).trim().toLowerCase());
    const at = Object.fromEntries(Object.entries(COLS).map(([k, names]) => [k, head.findIndex((h) => names.includes(h))]));
    if (at.category < 0 || at.name < 0 || at.price < 0) throw new RuleError("The heading row needs Category, Item name and Price columns (download the sample file).");
    const yes = (v) => !/^(no|n|false|0|non[- ]?veg|nonveg|egg)$/i.test(String(v).trim());
    return sheet
        .slice(1)
        .filter((r) => r.some((v) => String(v).trim()))
        .map((r) => ({
            category: String(r[at.category] ?? "").trim(),
            name: String(r[at.name] ?? "").trim(),
            price: Number(String(r[at.price] ?? "").replace(/[,₹\s]/g, "")),
            shortCode: at.shortCode >= 0 ? String(r[at.shortCode] ?? "").trim() : "",
            veg: at.veg >= 0 && String(r[at.veg]).trim() ? yes(r[at.veg]) : true,
            active: at.active >= 0 && String(r[at.active]).trim() ? yes(r[at.active]) : true,
        }));
}

/** The outlet's menus (an outlet can have several, e.g. dine-in and delivery). */
async function menus(s, hotelId) {
    need(s, "customers.view");
    const rows = await MenuCatalog.findAll({ where: { hotel_id: Number(hotelId) || 0, active: true }, attributes: ["id", "name", "is_default"], order: [["is_default", "DESC"], ["id", "ASC"]], raw: true });
    return { menus: rows.map((m) => ({ id: m.id, name: m.name, isDefault: !!m.is_default })) };
}

async function importFile(s, hotelId, input = {}) {
    need(s, "customers.manage");
    const hotel = await Hotel.findOne({ where: { id: Number(hotelId) || 0 } });
    if (!hotel) throw new RuleError("Outlet not found.");
    const menu = await MenuCatalog.findOne({ where: { id: Number(input.menuId) || 0, hotel_id: hotel.id } });
    if (!menu) throw new RuleError("Choose which menu the items go into.");
    const rows = readRows(input.fileBase64);
    const owner = await ownerUser(hotel);
    const c = owner ? await buildContext(hotel.id, owner.id, "superadmin") : null;
    if (!c) throw new RuleError("This outlet has no active owner login to import with. Fix the owner's login first.");
    const catalog = require("../../appv1/domains/catalog");
    const out = await catalog.importMenu.fn(c, String(menu.id), rows);
    if (out.created + out.updated > 0) {
        // Items without a photo get one when the library has a clear match by name (owner 2026-10-09).
        const photos = require("../photos/outlet");
        const m = await photos.menuFor(hotel.id, { missingOnly: true });
        const sure = m.items.filter((x) => x.sure && x.best).map((x) => ({ menuId: x.menuId, photoId: x.best.id }));
        out.photosSet = sure.length ? (await photos.setOn(hotel.id, sure)).set : 0;
        await Hotel.update({ menu_uploaded: true }, { where: { id: hotel.id } }).catch(() => {});
        await onboarding.autoCheck({ only: [hotel.id] }).catch(() => {});
    }
    await audit.write(s, { action: "outlet.menu_import", entity: "hotel", entityId: hotel.id, summary: `Imported a menu file into ${hotel.hotel_name} (${menu.name}): ${out.created} added, ${out.updated} updated, ${out.failed.length} not saved`, reason: txt(input.fileName, 120) });
    return out;
}

/** The sample file to fill in. */
async function sampleFile(s) {
    need(s, "customers.view");
    const XLSX = require("xlsx");
    const ws = XLSX.utils.aoa_to_sheet([
        ["Category", "Item name", "Price", "Short code", "Veg", "Active"],
        ["Starters", "Paneer Tikka", 220, "PT", "Yes", "Yes"],
        ["Starters", "Chicken 65", 260, "C65", "No", "Yes"],
        ["Beverages", "Masala Chai", 30, "MC", "Yes", "Yes"],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Menu");
    return { fileName: "BillerPe menu sample.xlsx", base64: XLSX.write(wb, { type: "base64", bookType: "xlsx" }) };
}

module.exports = { menus, importFile, sampleFile, readRows };
