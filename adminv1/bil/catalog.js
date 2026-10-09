const { BilItem, InvItem } = require("../../model");
const { RuleError } = require("../../appv1/core");
const { need } = require("../auth");
const audit = require("../audit");
const { txt, parse } = require("./common");

// What BillerPe sells, with prices before GST (design doc "Plans, prices and
// invoices", approved and on the website 2026-10-07). Editable in Billing >
// Catalog; a price change never touches invoices already made. Printers and
// rolls are office-stock items (Inventory), priced there.

const DEFAULT_ITEMS = [
    ["SUITE_STARTER_Y", "Suite Starter - 1 year", "plan", "LOCAL_SUITE", "Suite Starter", 7999, 365, null, null],
    ["SUITE_PRO_Y", "Suite Pro - 1 year", "plan", "LOCAL_SUITE", "Suite Pro", 11999, 365, null, null],
    ["SUITE_ENT_Y", "Suite Enterprise - 1 year", "plan", "LOCAL_SUITE", "Suite Enterprise", 17999, 365, null, null],
    ["APP_LITE_Y", "App Lite - 1 year (3 devices)", "plan", "CLOUD_APP", "App Lite", 5999, 365, 3, null],
    ["APP_STD_Y", "App Standard - 1 year (6 devices)", "plan", "CLOUD_APP", "App Standard", 9999, 365, 6, null],
    ["APP_PRO_Y", "App Pro - 1 year (12 devices)", "plan", "CLOUD_APP", "App Pro", 14999, 365, 12, null],
    ["SUITE_STARTER_M", "Suite Starter - 1 month", "plan", "LOCAL_SUITE", "Suite Starter", 799, 30, null, null],
    ["SUITE_PRO_M", "Suite Pro - 1 month", "plan", "LOCAL_SUITE", "Suite Pro", 1199, 30, null, null],
    ["SUITE_ENT_M", "Suite Enterprise - 1 month", "plan", "LOCAL_SUITE", "Suite Enterprise", 1799, 30, null, null],
    ["APP_LITE_M", "App Lite - 1 month (3 devices)", "plan", "CLOUD_APP", "App Lite", 599, 30, 3, null],
    ["APP_STD_M", "App Standard - 1 month (6 devices)", "plan", "CLOUD_APP", "App Standard", 999, 30, 6, null],
    ["APP_PRO_M", "App Pro - 1 month (12 devices)", "plan", "CLOUD_APP", "App Pro", 1499, 30, 12, null],
    ["APP_DEVICE_Y", "Extra POS App device - 1 year", "addon", "CLOUD_APP", null, 1200, null, 1, null],
    ["EBILL_1000", "E-bill credits - pack of 1,000", "ebill", null, null, 250, null, null, 1000],
    ["INSTALL_VISIT", "On-site installation (within the city)", "service", null, null, 1500, null, null, null],
];

/** Adds the default items that are missing (never changes an edited one). */
async function ensureCatalog() {
    let sort = 0;
    for (const [code, name, kind, product, planName, price, days, devices, credits] of DEFAULT_ITEMS) {
        sort += 10;
        await BilItem.findOrCreate({ where: { code }, defaults: { name, kind, product, plan_name: planName, price, days, devices, credits, sort, sac: "997331", gst_rate: 18 } });
    }
}

const view = (i) => ({
    id: i.id,
    code: i.code,
    name: i.name,
    kind: i.kind,
    product: i.product,
    planName: i.plan_name,
    price: Number(i.price),
    days: i.days,
    devices: i.devices,
    credits: i.credits,
    sac: i.sac,
    gstRate: Number(i.gst_rate),
    active: !!i.active,
    includes: includesOf(i),
});

/** What a plan gives free from the office stock: [{ itemId, qty }]. */
function includesOf(i) {
    const v = parse(i.includes);
    return Array.isArray(v) ? v.filter((x) => x && Number(x.itemId) > 0 && Number(x.qty) > 0).map((x) => ({ itemId: Number(x.itemId), qty: Number(x.qty) })) : [];
}

async function list(s) {
    need(s, "billing.view");
    await ensureCatalog();
    const items = await BilItem.findAll({ order: [["sort", "ASC"], ["id", "ASC"]], raw: true });
    const stock = await InvItem.findAll({ where: { active: true }, order: [["sort", "ASC"], ["name", "ASC"]], raw: true });
    return { items: items.map(view), hardware: [], stock: stock.map((i) => ({ id: i.id, name: i.name, unit: i.unit, price: Number(i.price), gstRate: Number(i.gst_rate) })) };
}

const KINDS = ["plan", "addon", "ebill", "service"];

async function save(s, input = {}) {
    need(s, "settings.manage");
    const name = txt(input.name, 80);
    if (!name) throw new RuleError("Write the item's name.");
    const price = Number(input.price);
    if (!(price >= 0 && price <= 10000000)) throw new RuleError("Write the price before GST.");
    const kind = KINDS.includes(input.kind) ? input.kind : "service";
    const intOrNull = (v, label, max) => {
        if (v === undefined || v === null || v === "") return null;
        const n = Number(v);
        if (!Number.isInteger(n) || n < 1 || n > max) throw new RuleError(`${label}: a whole number from 1 to ${max}.`);
        return n;
    };
    const fields = {
        name,
        kind,
        price: Math.round(price * 100) / 100,
        product: ["LOCAL_SUITE", "CLOUD_APP"].includes(input.product) ? input.product : null,
        plan_name: txt(input.planName, 40) || null,
        days: intOrNull(input.days, "Days", 3660),
        devices: intOrNull(input.devices, "Devices", 100),
        credits: intOrNull(input.credits, "Credits", 1000000),
        sac: txt(input.sac, 8) || "997331",
        gst_rate: [0, 5, 12, 18, 28].includes(Number(input.gstRate)) ? Number(input.gstRate) : 18,
        active: input.active !== false,
    };
    if (kind === "plan" && (!fields.product || !fields.days || !fields.plan_name)) throw new RuleError("A plan needs its product, plan name and days.");
    // A plan with a printer (owner 2026-10-09): the stock items it includes free.
    const inc = kind === "plan" && Array.isArray(input.includes) ? input.includes : [];
    if (inc.length > 10) throw new RuleError("A plan includes at most 10 kinds of items.");
    const includes = [];
    for (const x of inc) {
        const qty = Number(x && x.qty);
        if (!Number.isInteger(qty) || qty < 1 || qty > 100) throw new RuleError("Included items: a quantity from 1 to 100.");
        const it = await InvItem.findOne({ where: { id: Number(x.itemId) || 0 }, attributes: ["id"], raw: true });
        if (!it) throw new RuleError("An included item is not in the inventory.");
        if (includes.some((y) => y.itemId === it.id)) throw new RuleError("An included item is listed twice.");
        includes.push({ itemId: it.id, qty });
    }
    fields.includes = includes.length ? JSON.stringify(includes) : null;
    if (kind === "ebill" && !fields.credits) throw new RuleError("An e-bill pack needs its number of credits.");
    if (input.id) {
        const row = await BilItem.findByPk(Number(input.id));
        if (!row) throw new RuleError("This item does not exist.");
        const before = row.get({ plain: true });
        await row.update(fields);
        await audit.write(s, { action: "billing.item", entity: "bil_item", entityId: row.id, summary: `Changed ${row.name}`, before, after: row });
        return { item: view(row) };
    }
    const code = txt(input.code, 30).toUpperCase().replace(/[^A-Z0-9_]/g, "_") || `ITEM_${Date.now().toString(36).toUpperCase()}`;
    if (await BilItem.findOne({ where: { code } })) throw new RuleError("An item with this code exists.");
    const row = await BilItem.create({ ...fields, code, sort: 1000 });
    await audit.write(s, { action: "billing.item", entity: "bil_item", entityId: row.id, summary: `Added ${row.name}`, after: row });
    return { item: view(row) };
}

module.exports = { DEFAULT_ITEMS, ensureCatalog, list, save, view, includesOf };
