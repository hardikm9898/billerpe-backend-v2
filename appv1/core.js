const moment = require("moment-timezone");
const sequelize = require("../connection/connect");
const { Hotel, HotelUser, Role, RolePermissionDefault, RestaurantSetting, AppClientKey, AuditLog } = require("../model");
const { ROLE_PERMISSION_DEFAULTS, ROLE_SPECIAL_DEFAULTS } = require("../constant/rolePermissionDefaults");

// Shared plumbing for the BillerPe POS App API (/app/v1). Every rule error
// is a RuleError with a staff-facing message; routes turn it into
// { ok: false, error }. The rules themselves mirror billerpe-local-exe
// (the Plan 1 authority) so both plans behave the same.

class RuleError extends Error {}
const fail = (msg) => {
    throw new RuleError(msg);
};

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

function parseJson(value, fallback) {
    if (value == null || value === "") return fallback;
    if (typeof value === "object") return value;
    try {
        return JSON.parse(value);
    } catch {
        return fallback;
    }
}

/* ------------------------------ permissions ------------------------------ */

// Same resolution as the exe (helpers/permissions.js) and the Web POS:
// legacy codes map to named roles, unknown -> Cashier, Owner unrestricted,
// others = role default <- this outlet's saved role settings <- user overrides.
const LEGACY_ROLE_MAP = { A: "Owner", C: "Captain", B: "Cashier" };
const resolveRole = (name) => (name && ROLE_PERMISSION_DEFAULTS[name] ? name : LEGACY_ROLE_MAP[name] || "Cashier");

async function loadPermissions(hotelId, user) {
    const role = resolveRole(user.role_mst?.role_name);
    const saved = role === "Owner" ? null : await RolePermissionDefault.findOne({ where: { hotel_id: hotelId, role }, raw: true });
    const savedModules = parseJson(saved?.permissions, {});
    const overrides = parseJson(user.permission_overrides, {});
    const modules = {};
    for (const [module, grant] of Object.entries(ROLE_PERMISSION_DEFAULTS[role])) {
        modules[module] = role === "Owner" ? { ...grant } : { ...grant, ...(savedModules[module] || {}), ...(overrides.modules?.[module] || {}) };
    }
    const special = role === "Owner" ? { ...ROLE_SPECIAL_DEFAULTS.Owner } : { ...ROLE_SPECIAL_DEFAULTS[role], ...parseJson(saved?.special_permissions, {}), ...(overrides.special || {}) };
    return { role, owner: role === "Owner", modules, special };
}

// Billing can come from the table grid (biller) or counter (keyboard-billing).
const EQUIVALENT = { biller: ["biller", "keyboard-billing"] };

// Same wording as the exe (helpers/permissions.js#deniedMessage): which
// permission is missing, so the owner knows what to switch on.
const MODULE_LABELS = {
    dashboard: "Dashboard", biller: "Billing", "keyboard-billing": "Keyboard Billing", kds: "Kitchen Display",
    orders: "Orders", menu: "Menu", tables: "Table Management", reservations: "Reservations",
    queue: "Waitlist Queue", users: "Manage Users", permissions: "Roles & Permissions", reports: "Reports",
    expense: "Expense", "stock-masters": "Stock Masters", "stock-transactions": "Stock Transactions",
    "stock-recipes": "Recipes & Production", "stock-reports": "Stock Reports", "cash-session": "Opening & Closing",
    "ops-billing": "Billing Settings", "ops-hardware": "Printers & Devices", "ops-experience": "Customer Experience",
    "ops-ledger": "Ledger", system: "System", "audit-log": "Audit Log",
};
const SPECIAL_LABELS = {
    "orders.editAfterKot": "edit items after the KOT is sent",
    "orders.reopenSettled": "reopen a settled bill",
    "orders.deleteOrder": "delete orders",
    "tables.mergeTransfer": "move or merge tables",
    "system.remakeOrderSequence": "renumber bills",
    "users.editPermissions": "change a user's permissions",
};

const hasModule = (c, module, action) => c.perms.owner || (EQUIVALENT[module] || [module]).some((m) => c.perms.modules[m]?.[action]);

function need(c, module, action = "view") {
    if (!hasModule(c, module, action)) {
        fail(`You don't have permission to ${action} in ${MODULE_LABELS[module] || module}. Ask the owner to allow it in Manage Users.`);
    }
}

function needSpecial(c, key) {
    if (c.perms.owner) return;
    if (c.perms.special[key] !== true) fail(`You don't have permission to ${SPECIAL_LABELS[key] || key}. Ask the owner to allow it in Manage Users.`);
}

/* ------------------------------ business day ------------------------------ */

async function outletClock(hotelId, transaction) {
    const s = await RestaurantSetting.findOne({ where: { hotel_id: hotelId }, raw: true, transaction });
    return {
        timeZone: s?.timeZone || "Asia/Kolkata",
        dayStart: (s?.business_day_start_time || "00:00:00").slice(0, 5),
        settings: s,
    };
}

/** Business date (YYYY-MM-DD): before the day start time it is still the previous day. */
function businessDate(clock, at = new Date()) {
    const now = moment.tz(at, clock.timeZone);
    const [h, m] = clock.dayStart.split(":").map(Number);
    const start = now.clone().hour(h).minute(m).second(0);
    return (now.isBefore(start) ? now.clone().subtract(1, "day") : now).format("YYYY-MM-DD");
}

/* ------------------------------ context ------------------------------ */

/**
 * Request context: who is acting, for which outlet. Built by the auth
 * middleware from the device token; `t` is set inside mutate().
 */
async function buildContext(hotelId, userId, deviceId) {
    const user = await HotelUser.findOne({ where: { id: userId, hotel_id: hotelId }, include: Role });
    if (!user || user.active === false) return null;
    const perms = await loadPermissions(hotelId, user);
    return { hotelId, userId, deviceId, user, userName: user.name, role: perms.role, perms, t: undefined };
}

/**
 * Every write runs in one transaction that first locks the outlet's hotel
 * row: two phones acting on the same outlet are applied one after the
 * other (bill numbers, tokens, "table already has an order" can never race
 * - the exe gets the same effect from its per-hotel mutex). A clientKey
 * makes a retried request return the first result instead of acting twice.
 */
async function mutate(c, fn, clientKey) {
    return sequelize.transaction(async (t) => {
        await Hotel.findOne({ where: { id: c.hotelId }, attributes: ["id"], lock: t.LOCK.UPDATE, transaction: t });
        if (clientKey) {
            const seen = await AppClientKey.findOne({ where: { hotel_id: c.hotelId, client_key: String(clientKey).slice(0, 80) }, transaction: t });
            if (seen) return parseJson(seen.result, {});
        }
        const ctx = { ...c, t };
        const out = (await fn(ctx)) || {};
        if (clientKey) {
            await AppClientKey.create({ hotel_id: c.hotelId, client_key: String(clientKey).slice(0, 80), result: JSON.stringify(out) }, { transaction: t });
        }
        return out;
    });
}

async function audit(c, module, action) {
    await AuditLog.create(
        { hotel_id: c.hotelId, user_id: c.userId, user_name: c.userName, action, entity: module, device: `app:${c.deviceId || ""}`.slice(0, 250) },
        { transaction: c.t },
    ).catch(() => {});
}

module.exports = { RuleError, fail, r2, parseJson, resolveRole, loadPermissions, need, needSpecial, hasModule, outletClock, businessDate, buildContext, mutate, audit };
