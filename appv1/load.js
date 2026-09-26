const { Op, fn, col, literal } = require("sequelize");
const moment = require("moment-timezone");
const CryptoJS = require("crypto-js");
const M = require("../model");
const { parseJson, r2, isOff, resolveRole, outletClock, businessDate, loadPermissions } = require("./core");
const { ROLE_PERMISSION_DEFAULTS, ROLE_SPECIAL_DEFAULTS } = require("../constant/rolePermissionDefaults");
const { asArray, normaliseOrderType } = require("./engine/billEngine");
const { toIdList } = require("./engine/routing");
const { iso, dietaryOf, orderView } = require("./views");
const { modeIdFromName } = require("./modes");

// GET /app/v1/load - everything the POS App holds for the signed-in outlet
// (OutletData, BillerPe POS App src/lib/pos/backend/types.ts), read from the
// real tables. Every query is scoped to c.hotelId.

const ORDER_DAYS = 35;
const ROLES = ["Owner", "Manager", "Cashier", "Captain", "Kitchen Staff", "Inventory Manager", "Accountant"];
const str = (v) => (v == null ? undefined : String(v));
const ids = (list) => asArray(list).map(String);
const orderTypes = (list) => [...new Set(asArray(list).map(normaliseOrderType).filter((t) => t === "dinin" || t === "pickup"))];
const byId = (rows) => new Map(rows.map((r) => [r.id, r]));

/* ------------------------------ orders ------------------------------ */

/** Orders matching `where` (already hotel-scoped here) as the app's Order shape. */
async function loadOrderViews(hotelId, where, t) {
    const orders = await M.Order.findAll({ where: { ...where, hotel_id: hotelId }, order: [["id", "ASC"]], raw: true, transaction: t });
    if (!orders.length) return [];
    const orderIds = orders.map((o) => o.id);
    const [lines, taxes, taxTypes, users, timeline, staff, kitchens, modes] = await Promise.all([
        M.OrderDetails.findAll({ where: { orderId: orderIds, hotel_id: hotelId }, order: [["id", "ASC"]], raw: true, transaction: t }),
        M.OrderTax.findAll({ where: { hmsOrderMstId: orderIds, hotel_id: hotelId }, raw: true, transaction: t }),
        M.TaxType.findAll({ where: { hotel_id: hotelId }, attributes: ["id", "tax_name"], raw: true, transaction: t }),
        M.User.findAll({ where: { id: [...new Set(orders.map((o) => o.UserId).filter(Boolean))], hotel_id: hotelId }, raw: true, transaction: t }),
        M.TimeLine.findAll({
            where: { order_id: orderIds, hotel_id: hotelId },
            attributes: ["order_id", "created_Date", "createdAt", "event_name", "action", "creator"],
            raw: true, transaction: t,
        }),
        M.HotelUser.findAll({ where: { hotel_id: hotelId }, attributes: ["id", "name"], raw: true, transaction: t }),
        M.KitchenSetting.findAll({ where: { hotel_id: hotelId }, raw: true, transaction: t }),
        M.PaymentMode.findAll({ where: { hotel_id: hotelId }, raw: true, transaction: t }),
    ]);
    const menuIds = [...new Set(lines.map((l) => l.MenuId).filter(Boolean))];
    const menus = menuIds.length
        ? await M.Menu.findAll({ where: { id: menuIds, hotel_id: hotelId }, attributes: ["id", "item_name", "sub_categories", "menu_categ_id", "shortCode", "active"], raw: true, transaction: t })
        : [];
    const group = (rows, key) => {
        const m = new Map();
        for (const r of rows) {
            if (!m.has(r[key])) m.set(r[key], []);
            m.get(r[key]).push(r);
        }
        return m;
    };
    const linesBy = group(lines, "orderId");
    const taxesBy = group(taxes, "hmsOrderMstId");
    const timelineBy = group(timeline, "order_id");
    const shared = {
        menus: byId(menus),
        taxNames: new Map(taxTypes.map((x) => [x.id, x.tax_name])),
        staffNames: new Map(staff.map((s) => [s.id, s.name])),
        kitchens,
        modesByName: new Map(modes.map((m) => [String(m.name).trim().toLowerCase(), m])),
    };
    const usersById = byId(users);
    return orders.map((o) => orderView(o, {
        ...shared,
        lines: linesBy.get(o.id) || [],
        taxes: taxesBy.get(o.id) || [],
        timeline: timelineBy.get(o.id) || [],
        user: usersById.get(o.UserId),
    }));
}

async function loadOrderView(hotelId, orderId, t) {
    const [view] = await loadOrderViews(hotelId, { id: Number(orderId) || 0 }, t);
    return view;
}

/* ------------------------------ settings ------------------------------ */

const TOKEN_SCOPE = { 0: "pickup", 1: "dinin", 2: "both", 3: "off" };
const tokenScope = (code) => TOKEN_SCOPE[String(code ?? "3")] || "off";

// Invoice/KOT format slots (hms_invoice_formate_mst / hms_kot_formate_mst):
// headerLine1..10 hold a keyword or literal text - the same vocabulary the
// Web POS, the exe's KOT printer and the cloud e-bill read.
const FORMAT_KEYWORD = {
    logo: "hotel_logo", "outlet-name": "hotel_name", address: "address", phone: "restaurant_number",
    gstin: "gst_no", fssai: "fssai_no", "upi-qr": "upiId", "order-type": "order_type",
    "customer-details": "customer_details", "bill-no": "bill_no", "token-number": "token_number", "kot-number": "kot_number",
};
const KEYWORD_CONTENT = Object.fromEntries(Object.entries(FORMAT_KEYWORD).map(([k, v]) => [v, k]));

function formatLines(row, slot) {
    const out = [];
    if (!row) return out;
    const prefix = slot === "header" ? "headerLine" : "footerLine";
    const font = slot === "header" ? "fontH" : "fontF";
    for (let i = 1; i <= 10; i++) {
        const value = String(row[`${prefix}${i}`] ?? "").trim();
        if (!value) continue;
        const fontSize = parseInt(String(row[`${font}${i}`] ?? ""), 10) || 12;
        const content = KEYWORD_CONTENT[value];
        out.push(content ? { id: `${slot}-${i}`, content, fontSize } : { id: `${slot}-${i}`, content: "text", text: value, fontSize });
    }
    return out;
}

function chargeRule(row, kind) {
    const service = kind === "service";
    return {
        active: !!row?.active,
        type: (service ? row?.service_charge_type : row?.charge_type) === "fixed" ? "fixed" : "percentage",
        value: Number(service ? row?.service_charge_value : row?.charge_value) || 0,
        calculationOn: row?.calculation_on === "total" ? "total" : "core",
        orderTypes: orderTypes(service ? row?.service_charge_automatic : row?.charge_automatic),
        taxOnCharge: !!row?.calculation_on_tax,
        condition: ["1", "2", "3"].includes(String(row?.greater_less)) ? String(row.greater_less) : "3",
        threshold: Number(row?.greater_less_amount) || 0,
    };
}

const BUILT_IN_MODES = [
    { id: "cash", name: "Cash", locked: true },
    { id: "upi", name: "UPI", locked: false },
    { id: "card", name: "Card", locked: false },
    { id: "due", name: "Due", locked: true },
];

function paymentModesView(rows) {
    const byName = new Map(rows.map((r) => [String(r.name).trim().toLowerCase(), r]));
    const builtIn = BUILT_IN_MODES.map((b) => {
        const row = byName.get(b.id);
        // Cash and Due are always on (owner rule); UPI/Card follow the outlet's row.
        return { id: b.id, name: b.name, locked: b.locked, active: b.locked ? true : row ? !isOff(row.active) : true, custom: false };
    });
    const custom = rows
        .filter((r) => !BUILT_IN_MODES.some((b) => b.id === String(r.name).trim().toLowerCase()))
        .map((r) => ({ id: `pm-${r.id}`, name: r.name, locked: false, active: !isOff(r.active), custom: true }));
    return [...builtIn, ...custom];
}

/** Table ids stored on a kitchen -> the sections they belong to (the app edits kitchens by section). */
function sectionsOfTables(tableIds, tables) {
    const set = new Set(toIdList(tableIds));
    if (!set.size) return [];
    return [...new Set(tables.filter((t) => set.has(String(t.id))).map((t) => String(t.table_catag_id)))];
}

async function settingsView(hotelId, hotel, setting, tables) {
    const [taxes, service, packaging, modes, promos, kitchens, invoice, kot] = await Promise.all([
        M.TaxType.findAll({ where: { hotel_id: hotelId }, raw: true }),
        M.ServiceCharge.findOne({ where: { hotel_id: hotelId }, raw: true }),
        M.BillChargeRule.findOne({ where: { hotel_id: hotelId, rule_for: "packaging" }, raw: true }),
        M.PaymentMode.findAll({ where: { hotel_id: hotelId }, order: [["id", "ASC"]], raw: true }),
        M.PromoCode.findAll({ where: { hotel_id: hotelId }, raw: true }),
        M.KitchenSetting.findAll({ where: { hotel_id: hotelId }, order: [["id", "ASC"]], raw: true }),
        M.InvoiceFormate.findOne({ where: { hotel_id: hotelId }, raw: true }),
        M.KotFormate.findOne({ where: { hotel_id: hotelId }, raw: true }),
    ]);
    return {
        gstOn: !isOff(hotel.invoiceFormateIncGst),
        taxes: taxes.map((x) => ({
            id: String(x.id), name: x.tax_name, type: x.tax_value === "fix" ? "fix" : "pr", rate: Number(x.amount) || 0,
            active: !isOff(x.active), orderTypes: orderTypes(x.order_type), sectionIds: ids(x.table_categ_ids), itemIds: ids(x.menu_ids),
        })),
        serviceCharge: chargeRule(service, "service"),
        packagingCharge: chargeRule(packaging, "packaging"),
        paymentModes: paymentModesView(modes),
        promoCodes: promos.map((p) => ({
            id: String(p.id), name: p.promo_code_name || p.promo_code, code: p.promo_code,
            type: p.discount_type === "pr" || /percent/i.test(p.discount_type || "") ? "pr" : "fix",
            value: Number(p.discount_value) || 0, active: !isOff(p.status),
        })),
        kitchens: kitchens.map((k) => ({
            id: String(k.id), name: k.kitchen_name, categoryIds: toIdList(k.menu_categ_ids),
            sectionIds: sectionsOfTables(k.table_ids, tables), orderTypes: orderTypes(k.order_type),
        })),
        invoiceFormat: { header: formatLines(invoice, "header"), footer: formatLines(invoice, "footer") },
        kotFormat: { header: formatLines(kot, "header"), footer: formatLines(kot, "footer"), showPrices: false },
        tokens: { tokenFor: tokenScope(hotel.is_token_on), billWithKot: tokenScope(hotel.bill_with_kot), billWithToken: tokenScope(hotel.bill_with_token) },
        saveBehave: hotel.saveBehave === "pdf" ? "pdf" : "save",
        businessDayStart: String(setting?.business_day_start_time || "00:00:00").slice(0, 5),
        billReset: ["daily", "financial_year"].includes(setting?.bill_reset_type) ? setting.bill_reset_type : "never",
        financialYearStartMonth: Number(setting?.financial_year_start_month) || 4,
        cashSessionOn: !!setting?.opening_closing_show,
        qrOrdering: setting ? !isOff(setting.qr_ordering) : true,
        tableGridView: setting?.table_grid_view === "sections" ? "sections" : "tabs",
        supplierPaymentsAsExpense: setting ? !isOff(setting.supplier_payment_expense) : true,
    };
}

/* ------------------------------ staff & permissions ------------------------------ */

function roleDefaultsView(saved) {
    const out = {};
    for (const role of ROLES) {
        const row = saved.find((r) => r.role === role);
        const mods = parseJson(row?.permissions, {});
        const modules = {};
        for (const [m, grant] of Object.entries(ROLE_PERMISSION_DEFAULTS[role])) modules[m] = role === "Owner" ? { ...grant } : { ...grant, ...(mods[m] || {}) };
        out[role] = { modules, special: role === "Owner" ? { ...ROLE_SPECIAL_DEFAULTS.Owner } : { ...ROLE_SPECIAL_DEFAULTS[role], ...parseJson(row?.special_permissions, {}) } };
    }
    return out;
}

const digits = (v) => String(v ?? "").replace(/\D/g, "");

async function staffView(hotelId) {
    const [users, hotel] = await Promise.all([
        M.HotelUser.findAll({ where: { hotel_id: hotelId }, include: M.Role, order: [["id", "ASC"]] }),
        M.Hotel.findOne({ where: { id: hotelId }, attributes: ["owner_number"], raw: true }),
    ]);
    // The owner is the login with the outlet's owner number (exe helpers/ownerAccount.js), not a role.
    const ownerNumber = digits(hotel?.owner_number);
    const out = [];
    for (const u of users) {
        const role = resolveRole(u.role_mst?.role_name);
        const hasOverrides = Object.keys(parseJson(u.permission_overrides, {})).length > 0;
        let overrides;
        if (hasOverrides && role !== "Owner") {
            const p = await loadPermissions(hotelId, u);
            overrides = { modules: p.modules, special: p.special };
        }
        out.push({ id: String(u.id), name: u.name, mobile: u.number || "", role, active: !isOff(u.active), isOwner: !!ownerNumber && digits(u.number) === ownerNumber, overrides });
    }
    return out;
}

/* ------------------------------ tables & reservations ------------------------------ */

const HOLD_BEFORE = 30 * 60 * 1000;
const NO_SHOW_AFTER = 30 * 60 * 1000;

/** Booking time as an absolute moment in the outlet's own time zone (exe bookingMoment). */
function bookingMoment(bookingDate, value, tz) {
    const text = String(value ?? "").trim();
    const dated = /^(\d{4}-\d{2}-\d{2})[T ](\d{1,2}):(\d{2})/.exec(text);
    let day;
    let h;
    let m;
    if (dated) [, day, h, m] = dated;
    else {
        const t = /^(\d{1,2}):(\d{2})/.exec(text);
        if (!t) return null;
        [, h, m] = t;
        day = moment(bookingDate).format("YYYY-MM-DD");
    }
    return moment.tz(`${day} ${String(h).padStart(2, "0")}:${m}`, "YYYY-MM-DD HH:mm", tz).valueOf();
}

/**
 * Reservations grouped by booking_id (one row per table), with the exe's
 * clock rules: a booking holds its tables from 30 min before; an order
 * started on one of them in that window = the guest arrived (seated); no
 * order 30 min after the time = no-show.
 */
async function reservationsView(hotelId, clock, openOrders) {
    const since = moment.tz(clock.timeZone).subtract(2, "days").format("YYYY-MM-DD");
    const rows = await M.TableBooking.findAll({ where: { hotel_id: hotelId, booking_date: { [Op.gte]: since } }, order: [["id", "ASC"]], raw: true });
    if (!rows.length) return [];
    const users = byId(await M.User.findAll({ where: { id: [...new Set(rows.map((r) => r.UserId).filter(Boolean))], hotel_id: hotelId }, raw: true }));
    const groups = new Map();
    for (const r of rows) {
        const key = r.booking_id ?? r.id;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(r);
    }
    const tableIds = [...new Set(rows.map((r) => r.TableId).filter(Boolean))];
    const recentOrders = tableIds.length
        ? await M.Order.findAll({ where: { hotel_id: hotelId, TableId: tableIds, deleted: false, createdAt: { [Op.gte]: moment().subtract(3, "days").toDate() } }, attributes: ["TableId", "createdAt"], raw: true })
        : [];
    const now = Date.now();
    const out = [];
    for (const [bookingId, list] of groups) {
        const r = list[0];
        const start = bookingMoment(r.booking_date, r.start_time, clock.timeZone);
        let end = bookingMoment(r.booking_date, r.end_time, clock.timeZone);
        if (start == null || end == null) continue;
        if (end <= start) end += 24 * 60 * 60 * 1000;
        const tIds = list.map((x) => String(x.TableId)).filter((x) => x !== "null");
        const arrived = recentOrders.some((o) => tIds.includes(String(o.TableId)) && new Date(o.createdAt).getTime() >= start - HOLD_BEFORE && new Date(o.createdAt).getTime() < end);
        let status = "booked";
        if (r.deleted) status = "cancelled";
        else if (r.app_status === "seated" || r.app_status === "noshow") status = r.app_status;
        else if (arrived) status = "seated";
        else if (now >= start + NO_SHOW_AFTER) status = "noshow";
        const user = users.get(r.UserId);
        out.push({
            id: String(bookingId),
            name: user?.name || "",
            mobile: user?.number || "",
            email: user?.email || undefined,
            guests: Number(r.no_of_person) || 1,
            at: new Date(start).toISOString(),
            endAt: new Date(end).toISOString(),
            tableIds: tIds,
            advance: Number(r.advance) || 0,
            status,
            _holding: status === "booked" && now >= start - HOLD_BEFORE && now < end,
        });
    }
    return out;
}

// Customer ordering link for a table's QR sticker: AES({hotelId, tableId,
// qrVersion}) with the Web POS's fixed salt, so the same table always gets
// the same link until its QR is renewed (billerpe-pos-pro-v2 lib/publicMenu.ts).
const QR_SALT = CryptoJS.enc.Hex.parse("42696c6c657250655177".padEnd(16, "0").slice(0, 16));
function tableQrUrl(hotelId, table) {
    const base = process.env.QR_MENU_BASE_URL || process.env.SOCKET_URL;
    if (!base || !process.env.DESECRET_KEY) return undefined;
    const payload = JSON.stringify({ hotelId: Number(hotelId), tableId: Number(table.id), qrVersion: Number(table.qr_version) || 1 });
    const cipher = CryptoJS.AES.encrypt(payload, process.env.DESECRET_KEY, { salt: QR_SALT }).toString();
    return `${String(base).replace(/\/$/, "")}/qr-menu?${encodeURIComponent(cipher)}`;
}

function tablesView(hotelId, tables, openOrders, reservations, pendingQrTables) {
    const orderByTable = new Map(openOrders.filter((o) => o.tableId).map((o) => [o.tableId, o]));
    return tables.map((t) => {
        const id = String(t.id);
        const o = orderByTable.get(id);
        const res = !o ? reservations.find((r) => r._holding && r.tableIds.includes(id)) : undefined;
        const status = o ? (o.status === "hold" ? "hold" : o.status === "billed" ? "billed" : "running") : res ? "reserved" : "free";
        return {
            id,
            name: t.table_name,
            sectionId: str(t.table_catag_id) ?? "",
            seats: Number(t.capacity) || 0,
            status,
            orderId: o?.id,
            qrWaiting: pendingQrTables.has(t.id) || undefined,
            reservation: res ? { id: res.id, name: res.name, at: res.at } : undefined,
            qrUrl: tableQrUrl(hotelId, t),
            qrVersion: Number(t.qr_version) || 1,
        };
    });
}

/* ------------------------------ menu ------------------------------ */

async function menuView(hotelId) {
    const [catalogs, categories, variants, depts, addons, items, menuVariants, menuAddons] = await Promise.all([
        M.MenuCatalog.findAll({ where: { hotel_id: hotelId }, order: [["id", "ASC"]], raw: true }),
        M.Menu_categ.findAll({ where: { hotel_id: hotelId }, order: [["rank", "ASC"], ["id", "ASC"]], raw: true }),
        M.Variants.findAll({ where: { hotel_id: hotelId }, raw: true }),
        M.AddonDepartment.findAll({ where: { hotel_id: hotelId }, raw: true }),
        M.Addons.findAll({ where: { hotel_id: hotelId }, raw: true }),
        // A custom item is a hidden menu row (shortCode CUSTOM) - never on the menu.
        M.Menu.findAll({ where: { hotel_id: hotelId, is_deleted: { [Op.not]: true } }, raw: true }),
        M.MenuVariants.findAll({ where: { hotel_id: hotelId }, raw: true }),
        M.MenuAddon.findAll({ where: { hotel_id: hotelId }, raw: true }),
    ]);
    const categById = byId(categories);
    // Rows from before menus existed carry no menu_catalog_id: they belong to the default menu.
    const defaultMenu = catalogs.find((m) => m.is_default) || catalogs[0];
    const menuOf = (row) => str(row?.menu_catalog_id ?? defaultMenu?.id) ?? "";
    const variantName = new Map(variants.map((v) => [v.id, v.variants_name]));
    const menus = catalogs.length
        ? catalogs.map((m) => ({
            id: String(m.id), name: m.name, isDefault: !!m.is_default || m.id === defaultMenu.id, active: !isOff(m.active),
            sectionIds: ids(m.table_category_ids), orderTypes: orderTypes(m.order_types),
        }))
        : [];
    return {
        menus,
        categories: categories.map((c) => ({ id: String(c.id), menuId: menuOf(c), name: c.menu_categ_nm, rank: Number(c.rank) || 0, active: !isOff(c.active) })),
        variants: variants.filter((v) => !isOff(v.active)).map((v) => ({ id: String(v.id), menuId: menuOf(v), name: v.variants_name })),
        addonGroups: depts.map((d) => ({
            id: String(d.id), menuId: menuOf(d), name: d.department_name,
            min: Number(d.minimum_allowed_addon) || 0, max: Number(d.maximum_allowed_addon) || 0,
            single: !!d.singleSelection, active: !isOff(d.active),
            options: addons.filter((a) => a.department_id === d.id).map((a) => ({ id: String(a.id), name: a.addon_name, price: Number(a.price) || 0, dietary: dietaryOf(a.attributes) })),
        })),
        items: items.filter((i) => !(i.shortCode === "CUSTOM" && isOff(i.active))).map((i) => ({
            id: String(i.id),
            menuId: menuOf(categById.get(i.menu_categ_id)),
            categoryId: str(i.menu_categ_id) ?? "",
            name: i.item_name,
            shortCode: i.shortCode || "",
            price: Number(i.price) || 0,
            dietary: dietaryOf(i.sub_categories),
            gstType: i.gst_type === "S" ? "S" : "G",
            description: i.description || "",
            imageUrl: i.foodImage || undefined,
            barcode: i.barcode_value || undefined,
            favorite: !!i.favorite,
            active: !isOff(i.active),
            outOfStock: !!i.out_of_stock,
            variants: menuVariants.filter((v) => v.menu_id === i.id).map((v) => ({ variantId: String(v.variant_id), name: variantName.get(v.variant_id) ?? "", price: Number(v.variant_price) || 0 })),
            addonGroupIds: menuAddons.filter((a) => a.menu_id === i.id && !isOff(a.active)).map((a) => String(a.addon_department_id)),
        })),
    };
}

/* ------------------------------ QR, queue, customers ------------------------------ */

function qrItemsView(items, menus) {
    return (parseJson(items, []) || []).map((it, i) => ({
        key: String(i),
        itemId: String(it.menuId ?? it.id ?? ""),
        name: it.itemName || menus.get(Number(it.menuId))?.item_name || "Item",
        dietary: dietaryOf(menus.get(Number(it.menuId))?.sub_categories),
        variantName: it.variantName || undefined,
        addons: (it.addons || []).map((a) => ({ id: String(a.id), groupId: String(a.groupId ?? ""), name: a.name ?? "", price: Number(a.price) || 0, qty: 1 })),
        note: it.comment || undefined,
        price: Number(it.price) || 0,
        qty: Number(it.qty) || 1,
        decision: it.decision || "pending",
        rejectReason: it.rejectReason || undefined,
    }));
}

async function qrOrdersView(hotelId) {
    const rows = await M.QrOrder.findAll({ where: { hotel_id: hotelId, createdAt: { [Op.gte]: moment().subtract(1, "day").toDate() } }, order: [["id", "ASC"]], raw: true });
    const menuIds = rows.flatMap((r) => (parseJson(r.items, []) || []).map((i) => Number(i.menuId))).filter(Boolean);
    const menus = byId(menuIds.length ? await M.Menu.findAll({ where: { id: [...new Set(menuIds)], hotel_id: hotelId }, attributes: ["id", "item_name", "sub_categories"], raw: true }) : []);
    const roundOf = new Map();
    return rows
        .filter((r) => r.status !== "expired")
        .map((r) => {
            const items = qrItemsView(r.items, menus);
            const round = (roundOf.get(r.session_id ?? `t${r.table_id}`) || 0) + 1;
            roundOf.set(r.session_id ?? `t${r.table_id}`, round);
            const accepted = items.filter((i) => i.decision === "accepted").length;
            const status = r.status === "pending" ? "pending" : r.status === "rejected" ? "rejected" : accepted === items.length ? "accepted" : "partial";
            return { id: String(r.id), tableId: String(r.table_id), customerName: r.customer_name || "", customerMobile: r.customer_mobile || "", round, items, status, createdAt: iso(r.createdAt) };
        });
}

async function customersView(hotelId) {
    const [users, stats] = await Promise.all([
        M.User.findAll({ where: { hotel_id: hotelId, isPlaceholder: { [Op.not]: true }, number: { [Op.ne]: "" } }, raw: true }),
        M.Order.findAll({
            where: { hotel_id: hotelId, deleted: false, payment: "success" },
            attributes: ["UserId", [fn("COUNT", col("id")), "visits"], [fn("SUM", col("grandAmount")), "spent"], [fn("MAX", col("createdAt")), "last"], [fn("SUM", literal("CASE WHEN due > 0 THEN due ELSE 0 END")), "due"]],
            group: ["UserId"], raw: true,
        }),
    ]);
    const statBy = new Map(stats.map((s) => [s.UserId, s]));
    // Older data can hold one customer on several rows: one entry per mobile.
    const byMobile = new Map();
    for (const u of users) {
        const s = statBy.get(u.id);
        const prev = byMobile.get(u.number);
        const entry = prev || { id: String(u.id), name: u.name || "", mobile: u.number, email: u.email || undefined, gstin: u.gstin || undefined, address: u.address || undefined, visits: 0, totalSpent: 0, lastVisit: undefined, dueOutstanding: 0 };
        if (s) {
            entry.visits += Number(s.visits) || 0;
            entry.totalSpent = r2(entry.totalSpent + (Number(s.spent) || 0));
            entry.dueOutstanding = r2(entry.dueOutstanding + (Number(s.due) || 0));
            const last = iso(s.last);
            if (!entry.lastVisit || last > entry.lastVisit) entry.lastVisit = last;
        }
        if (!prev && u.name) entry.name = u.name;
        byMobile.set(u.number, entry);
    }
    return [...byMobile.values()];
}

/* ------------------------------ money ------------------------------ */

const CASH_KIND = { Add: "in", Withdraw: "out", Expense: "expense", Settlement: "settlement", Supplier: "supplier" };

function cashSessionView(s, movements, names) {
    const mine = movements.filter((m) => m.cashSessionId === s.id);
    const opening = mine.find((m) => m.type === "Opening");
    const expected = r2(mine.reduce((sum, m) => sum + (Number(m.amount) || 0), 0));
    return {
        id: String(s.id),
        openedAt: iso(s.opened_at || s.createdAt),
        openedBy: names.get(s.hotelUserId) ?? "",
        openingFloat: r2(opening ? opening.amount : s.opening_float),
        movements: mine
            .filter((m) => m.type !== "Opening")
            .map((m) => ({ id: String(m.id), kind: CASH_KIND[m.type] || (Number(m.amount) < 0 ? "out" : "in"), amount: r2(Math.abs(Number(m.amount) || 0)), reason: m.reason || "", at: iso(m.at || m.createdAt), by: names.get(m.hotelUserId) ?? "" })),
        closedAt: s.status === "Open" ? undefined : iso(s.closed_at),
        closedBy: undefined,
        expected: s.status === "Open" ? undefined : expected,
        counted: s.status === "Open" ? undefined : r2(s.counted_cash),
        varianceReason: s.variance_reason || undefined,
    };
}

async function cashView(hotelId, names) {
    const sessions = await M.CashSession.findAll({ where: { hotel_id: hotelId, deleted: false }, order: [["opened_at", "DESC"], ["id", "DESC"]], limit: 30, raw: true });
    const movements = sessions.length ? await M.CashMovement.findAll({ where: { cashSessionId: sessions.map((s) => s.id) }, order: [["id", "ASC"]], raw: true }) : [];
    const open = sessions.find((s) => s.status === "Open");
    return {
        cashSession: open ? cashSessionView(open, movements, names) : null,
        cashHistory: sessions.filter((s) => s.status !== "Open").map((s) => cashSessionView(s, movements, names)),
    };
}

async function expensesView(hotelId, names, since) {
    const modes = await M.PaymentMode.findAll({ where: { hotel_id: hotelId }, raw: true });
    const [heads, entries] = await Promise.all([
        M.ExpenseHead.findAll({ where: { hotel_id: hotelId, deleted: { [Op.not]: true } }, raw: true }),
        M.ExpenseEntry.findAll({ where: { hotel_id: hotelId, deleted: { [Op.not]: true }, createdAt: { [Op.gte]: since } }, order: [["id", "DESC"]], raw: true }),
    ]);
    return {
        expenseHeads: heads.map((h) => ({ id: String(h.id), name: h.expense_head_name, type: "Variable", active: true, system: h.expense_head_name === "Supplier payment" || undefined })),
        expenses: entries.map((e) => ({
            id: String(e.id), headId: str(e.expense_head_id) ?? "", amount: r2(e.amount), modeId: modeIdFromName(e.paymentMode, modes),
            note: e.reason || "", at: iso(e.createdAt), by: names.get(e.user_id) ?? "",
            fromPurchase: e.purchase_payment_id != null || undefined,
            fromDrawer: (!!e.addExpense && String(e.paymentMode).toLowerCase() === "cash") || undefined,
        })),
    };
}

/* ------------------------------ stock ------------------------------ */

const MOVE_KIND = {
    purchase: "purchase", purchase_edit: "purchase", purchase_delete: "purchase", requisition: "purchase", opening: "adjustment",
    consumption: "sale", consumption_reversal: "sale", wastage: "wastage", wastage_reversal: "wastage",
    stock_in: "manual-in", stock_out: "manual-out", adjustment: "adjustment", production: "production-in", production_use: "production-out",
};

async function stockView(hotelId, names, since) {
    const [units, raws, stocks, suppliers, pos, poLines, poPays, recipes, semis, semiRecipes, semiStocks, moves, wastage] = await Promise.all([
        M.Unit.findAll({ where: { hotel_id: hotelId }, raw: true }),
        M.RawMaterial.findAll({ where: { hotel_id: hotelId }, raw: true }),
        M.StockInHand.findAll({ where: { hotel_id: hotelId, deleted: { [Op.not]: true } }, raw: true }),
        M.Supplier.findAll({ where: { hotel_id: hotelId, deleted_status: { [Op.not]: true } }, raw: true }),
        M.PurchaseOrder.findAll({ where: { hotel_id: hotelId, deleted_status: { [Op.not]: true }, createdAt: { [Op.gte]: moment(since).subtract(60, "days").toDate() } }, order: [["id", "DESC"]], raw: true }),
        M.PurchaseRawMaterial.findAll({ where: { hotel_id: hotelId, deleted_status: { [Op.not]: true } }, raw: true }),
        M.PurchaseOrderPayment.findAll({ where: { hotel_id: hotelId, deleted_status: { [Op.not]: true } }, raw: true }),
        M.Recipes.findAll({ where: { hotel_id: hotelId }, raw: true }),
        M.SemiFinishedItem.findAll({ where: { hotel_id: hotelId }, raw: true }),
        M.SemiFinishedRecipe.findAll({ where: { hotel_id: hotelId }, raw: true }),
        M.SemiFinishedStock.findAll({ where: { hotel_id: hotelId }, raw: true }),
        M.StockMovement.findAll({ where: { hotel_id: hotelId, createdAt: { [Op.gte]: since } }, order: [["id", "DESC"]], limit: 3000, raw: true }),
        M.Westage.findAll({ where: { hotel_id: hotelId, deleted_status: { [Op.not]: true }, createdAt: { [Op.gte]: since } }, raw: true }),
    ]);
    const stockOf = new Map(stocks.map((s) => [s.raw_material_id, s]));
    const conv = new Map(raws.map((r) => [r.id, Number(r.conversion_qty) || 1]));
    const purchaseUnit = new Map(raws.map((r) => [r.id, Number(r.unit_id)]));
    const modes = await M.PaymentMode.findAll({ where: { hotel_id: hotelId }, raw: true });
    const poModeId = (name) => ({ cheque: "cheque", "bank transfer": "bank", online: "bank" })[String(name || "").trim().toLowerCase()] || modeIdFromName(name, modes);
    const drawerPaid = new Set(poPays.length ? (await M.CashMovement.findAll({ where: { purchase_payment_id: poPays.map((p) => p.id) }, attributes: ["purchase_payment_id", "amount"], raw: true })).filter((m) => Number(m.amount) !== 0).map((m) => m.purchase_payment_id) : []);
    const recipeLine = (r) => (r.raw_material_id ? { kind: "raw", refId: String(r.raw_material_id), qty: Number(r.consumption_qty) || 0 } : { kind: "semi", refId: String(r.semi_finished_item_id), qty: Number(r.consumption_qty) || 0 });
    const recipesByItem = new Map();
    for (const r of recipes) {
        if (!recipesByItem.has(r.menu_id)) recipesByItem.set(r.menu_id, { id: `r-${r.menu_id}`, itemId: String(r.menu_id), base: [], byVariant: {}, byAddon: {} });
        const rec = recipesByItem.get(r.menu_id);
        if (r.addon_id) (rec.byAddon[String(r.addon_id)] ||= []).push(recipeLine(r));
        else if (r.variant_id) (rec.byVariant[String(r.variant_id)] ||= []).push(recipeLine(r));
        else rec.base.push(recipeLine(r));
    }
    const paidBy = new Map();
    for (const p of poPays) paidBy.set(p.purchaseOrderId, r2((paidBy.get(p.purchaseOrderId) || 0) + (Number(p.amount) || 0)));
    return {
        units: units.map((u) => ({ id: String(u.id), name: u.unit_name, short: u.shortName || u.unit_name })),
        raw: raws.map((r) => {
            const s = stockOf.get(r.id);
            const c = Number(r.conversion_qty) || 1;
            return {
                id: String(r.id), name: r.raw_material_name, category: "", unitId: str(r.consumption_unit ?? r.unit_id) ?? "",
                purchaseUnitId: str(r.unit_id) ?? "", conversion: c,
                stock: r2(s ? Number(s.available_stock_Consiompsion_qty ?? Number(s.qty) * c) : 0),
                reorderLevel: Number(r.mini_stock_level_qty) || 0,
                rate: r2((Number(s?.average_price) || Number(r.purchase_price) || 0) / c), active: true,
            };
        }),
        suppliers: suppliers.map((s) => ({
            id: String(s.id), name: s.name, contact: "", phone: "", gstin: "",
            outstanding: r2(pos.filter((p) => p.supplier_id === s.id).reduce((sum, p) => sum + (Number(p.grandAmount) || 0) - (paidBy.get(p.id) || 0), 0)),
        })),
        purchases: pos.map((p) => ({
            id: String(p.id), poNo: String(p.Po_no ?? p.id), supplierId: str(p.supplier_id) ?? "", date: String(p.business_date || p.invoice_date || iso(p.createdAt)).slice(0, 10),
            invoiceNo: p.invoice_number || undefined,
            // cgst/sgst/igst are rupees on the pre-tax line amount (Web POS mapRawPurchaseOrder).
            lines: poLines.filter((l) => l.purchaseOrderId === p.id).map((l) => ({
                rawId: String(l.raw_material_id), qty: Number(l.qty) || 0, rate: Number(l.price) || 0,
                taxPct: Number(l.amount) > 0 ? r2((((Number(l.cgst) || 0) + (Number(l.sgst) || 0) + (Number(l.igst) || 0)) / Number(l.amount)) * 100) : 0,
            })),
            discountType: !Number(p.discount_value) ? undefined : p.discount_type === "pr" || p.discount_type === "percent" ? "percent" : "flat",
            discountValue: Number(p.discount_value) || undefined,
            total: r2(p.grandAmount),
            payments: poPays.filter((x) => x.purchaseOrderId === p.id).map((x) => ({
                id: String(x.id), amount: r2(x.amount), modeId: poModeId(x.payment_mode), date: String(iso(x.paymentDate || x.date || x.createdAt)).slice(0, 10),
                ref: x.payment_ref_no || undefined, by: names.get(x.userId) ?? "", asExpense: x.expense_entry_id != null, fromDrawer: drawerPaid.has(x.id),
            })),
            by: names.get(p.userId) ?? "",
        })),
        recipes: [...recipesByItem.values()],
        semi: semis.map((s) => ({
            id: String(s.id), name: s.name, unitId: str(s.unit_id) ?? "",
            stock: r2(semiStocks.find((x) => x.semi_finished_item_id === s.id)?.available_qty),
            minStock: Number(s.min_stock_qty) || 0,
            components: semiRecipes.filter((r) => r.semi_finished_item_id === s.id).map((r) => ({ kind: "raw", refId: String(r.raw_material_id), qty: Number(r.consumption_qty) || 0 })),
        })),
        // The ledger is in purchase units; the app shows consumption units.
        movements: moves.map((m) => ({
            id: String(m.id), kind: MOVE_KIND[m.type] || "adjustment", refKind: m.raw_material_id ? "raw" : "semi",
            refId: String(m.raw_material_id ?? m.semi_finished_item_id), qty: r2(Number(m.qty) * (m.raw_material_id ? conv.get(m.raw_material_id) || 1 : 1)),
            value: r2(m.value), reference: m.note || (m.ref_type ? `${m.ref_type} ${m.ref_id ?? ""}`.trim() : ""), at: iso(m.createdAt), by: names.get(m.user_id) ?? "",
        })),
        wastage: wastage.map((w) => ({
            // Entered in either unit; average_price holds the total cost (exe wastage.js).
            id: String(w.id), refKind: "raw", refId: String(w.raw_material_id),
            qty: r2((Number(w.qty) || 0) * (Number(w.unit_id) === purchaseUnit.get(w.raw_material_id) ? conv.get(w.raw_material_id) || 1 : 1)),
            reason: w.reason || w.notes || "", at: iso(w.createdAt), by: names.get(w.user_id) ?? "", cost: r2(w.average_price),
        })),
    };
}

/* ------------------------------ account ------------------------------ */

const PLAN_BY_LIMIT = (limit) => (limit >= 12 ? "App Pro" : limit >= 6 ? "App Standard" : "App Lite");

async function subscriptionView(hotelId, hotel) {
    const [credit, payments] = await Promise.all([
        M.EBillCredit.findOne({ where: { hotel_id: hotelId }, raw: true }),
        M.SubscriptionPayment.findAll({ where: { hotel_id: hotelId }, order: [["id", "DESC"]], limit: 24, raw: true }).catch(() => []),
    ]);
    return {
        plan: PLAN_BY_LIMIT(Number(hotel.app_device_limit) || 0),
        expiresAt: iso(hotel.plan_end_date) || "",
        // No credit row yet = the 50 free e-bills every outlet starts with (kto.js#sentEbill).
        ebillCredits: credit ? Number(credit.credit) || 0 : 50,
        invoices: payments.map((p) => ({ id: String(p.id), at: iso(p.payment_date || p.createdAt), amount: r2(p.amount_paid), plan: PLAN_BY_LIMIT(Number(hotel.app_device_limit) || 0) })),
    };
}

function alertsView(rows, c) {
    return rows
        .filter((a) => (a.for_user_id == null || a.for_user_id === c.userId) && (!a.for_roles || (parseJson(a.for_roles, []) || []).includes(c.role) || c.perms.owner))
        .map((a) => ({
            id: String(a.id), kind: a.kind, title: a.title, body: a.body || "", at: iso(a.createdAt),
            read: (parseJson(a.read_by, []) || []).map(Number).includes(Number(c.userId)),
            link: a.link || undefined,
            forUserId: a.for_user_id != null ? String(a.for_user_id) : undefined,
            forRoles: a.for_roles ? parseJson(a.for_roles, undefined) : undefined,
        }));
}

/* ------------------------------ load ------------------------------ */

async function load(c) {
    const hotelId = c.hotelId;
    const clock = await outletClock(hotelId);
    const today = businessDate(clock);
    const since = moment.tz(today, "YYYY-MM-DD", clock.timeZone).subtract(ORDER_DAYS, "days");
    const sinceDate = since.toDate();
    const [hotel, sections, tables, staffRows, savedRoles, devices, alerts, audit, tickets, queue, dueRows, otherOutlets, payModes] = await Promise.all([
        M.Hotel.findOne({ where: { id: hotelId }, raw: true }),
        M.TableCatagories.findAll({ where: { hotel_id: hotelId, active: { [Op.not]: false } }, order: [["rank", "ASC"], ["id", "ASC"]], raw: true }),
        M.Table.findAll({ where: { hotel_id: hotelId, active: true }, order: [["id", "ASC"]], raw: true }),
        staffView(hotelId),
        M.RolePermissionDefault.findAll({ where: { hotel_id: hotelId }, raw: true }),
        M.AppDevice.findAll({ where: { hotel_id: hotelId, status: "active" }, order: [["last_active", "DESC"]], raw: true }),
        M.AppAlert.findAll({ where: { hotel_id: hotelId, createdAt: { [Op.gte]: moment().subtract(2, "days").toDate() } }, order: [["id", "DESC"]], limit: 200, raw: true }),
        M.AuditLog.findAll({ where: { hotel_id: hotelId }, order: [["id", "DESC"]], limit: 300, raw: true }),
        M.RaiseTicket.findAll({ where: { hotel_id: hotelId }, order: [["id", "DESC"]], limit: 50, raw: true }),
        M.AppQueueEntry.findAll({ where: { hotel_id: hotelId, createdAt: { [Op.gte]: moment().subtract(1, "day").toDate() } }, order: [["id", "ASC"]], raw: true }),
        M.DuePaymentReceive.findAll({ where: { hotel_id: hotelId, deleted: { [Op.not]: true }, createdAt: { [Op.gte]: sinceDate } }, include: [{ model: M.User, attributes: ["name", "number"] }], order: [["id", "DESC"]] }),
        c.user.number ? M.HotelUser.findAll({ where: { number: c.user.number, active: true }, attributes: ["hotel_id"], raw: true }) : [],
        M.PaymentMode.findAll({ where: { hotel_id: hotelId }, raw: true }),
    ]);
    const names = new Map(staffRows.map((s) => [Number(s.id), s.name]));
    const orders = await loadOrderViews(hotelId, {
        [Op.or]: [
            { deleted: false, payment: "pending" },
            { business_date: { [Op.gte]: since.format("YYYY-MM-DD") } },
            { business_date: null, createdAt: { [Op.gte]: sinceDate } },
            { deleted: false, due: { [Op.gt]: 0 } },
            // A refund owed stays listed however old it is.
            { deleted: false, due: { [Op.lt]: 0 } },
        ],
    });
    const openOrders = orders.filter((o) => ["running", "hold", "billed"].includes(o.status));
    const [settings, menu, reservations, qrOrders, customers, cash, money, stock, subscription, outletRows] = await Promise.all([
        settingsView(hotelId, hotel, clock.settings, tables),
        menuView(hotelId),
        reservationsView(hotelId, clock, openOrders),
        qrOrdersView(hotelId),
        customersView(hotelId),
        cashView(hotelId, names),
        expensesView(hotelId, names, sinceDate),
        stockView(hotelId, names, sinceDate),
        subscriptionView(hotelId, hotel),
        M.Hotel.findAll({ where: { id: [...new Set(otherOutlets.map((u) => u.hotel_id))], product_plan: "CLOUD_APP", active: { [Op.not]: false } }, attributes: ["id", "hotel_name"], raw: true }),
    ]);
    const pendingQrTables = new Set(qrOrders.filter((q) => q.status === "pending").map((q) => Number(q.tableId)));
    const roleOf = new Map(staffRows.map((s) => [s.name, s.role]));
    return {
        outlet: {
            id: String(hotel.id),
            name: hotel.hotel_name,
            address: [hotel.address1, hotel.address2].filter(Boolean).join(", "),
            phone: hotel.contact1 || hotel.owner_number || "",
            gstin: hotel.gst_no || "",
            fssai: hotel.fssai_no || "",
            upiId: hotel.upiId || "",
            logoUrl: hotel.hotel_logo || undefined,
            deviceLimit: Number(hotel.app_device_limit) || 0,
            devicesInUse: devices.length,
        },
        outlets: outletRows.map((h) => ({ id: String(h.id), name: h.hotel_name })),
        settings,
        staff: staffRows,
        roleDefaults: roleDefaultsView(savedRoles),
        sections: sections.map((s) => ({ id: String(s.id), name: s.table_catag_nm, rank: Number(s.rank) || 0 })),
        tables: tablesView(hotelId, tables, openOrders, reservations, pendingQrTables),
        ...menu,
        orders,
        reservations: reservations.map(({ _holding, ...r }) => r),
        queue: queue.map((q) => ({ id: String(q.id), name: q.name, mobile: q.mobile || "", guests: Number(q.guests) || 1, status: q.status, joinedAt: iso(q.joined_at), calledAt: iso(q.called_at), note: q.note || undefined })),
        qrOrders,
        customers,
        refundsOwed: orders.filter((o) => o.refundOwed > 0).map((o) => ({
            orderId: o.id, billNo: o.billNo, amount: o.refundOwed, customerName: o.customerName, customerMobile: o.customerMobile, at: o.settledAt || o.createdAt,
        })),
        dueCollections: dueRows.map((d) => ({
            id: String(d.id), customerMobile: d.hms_user_master?.number || "", customerName: d.hms_user_master?.name || "",
            amount: r2(d.amount), modeId: modeIdFromName(d.payment_mode, payModes), at: iso(d.createdAt), by: names.get(d.settle_by) ?? "",
        })),
        ...cash,
        ...money,
        devices: devices.map((d) => ({
            id: d.device_id, name: d.name, make: d.make, model: d.model, android: d.android, appVersion: d.app_version,
            userName: names.get(d.hotel_user_id) ?? "", lastActive: iso(d.last_active) || "", thisDevice: d.device_id === c.deviceId,
            printers: parseJson(d.printers, []) || [], printKots: !isOff(d.print_kots),
        })),
        alerts: alertsView(alerts, c),
        audit: audit.map((a) => ({ id: String(a.id), at: iso(a.createdAt), by: a.user_name || "", role: roleOf.get(a.user_name) || "Cashier", module: a.entity || "", action: a.action || "" })),
        tickets: tickets.map((x) => ({
            id: String(x.id), subject: String(x.issue || "").split("\n")[0].slice(0, 120), body: x.issue || "",
            kind: x.ticket_type === "plan-change" || x.ticket_type === "renewal" ? x.ticket_type : "support",
            at: iso(x.createdAt), status: /close|resolve/i.test(String(x.status)) ? "closed" : "open",
        })),
        subscription,
        stock,
        tokenResetAt: iso(hotel.token_reset_at) ?? null,
    };
}

module.exports = { load, loadOrderViews, loadOrderView, menuView, cashView, expensesView, stockView, tableQrUrl, bookingMoment, formatLines, FORMAT_KEYWORD, paymentModesView, BUILT_IN_MODES };
