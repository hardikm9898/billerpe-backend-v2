const { Op } = require("sequelize");
const models = require("../../model");

// Sync engine v2 - the ONE description of what flows between a restaurant's
// local exe and this server, used by all three endpoints:
//
//   GET  /sync/heartbeat  one call per minute per outlet: per-entity version
//                         (MAX(updatedAt) + row count) in a single UNION
//                         query, plus pending QR orders and reservations.
//   GET  /sync/pull       one entity at a time, only rows changed since the
//                         exe's own high-water mark, in id-stable chunks.
//   POST /sync/push       one entity at a time, a chunk of exe-created or
//                         exe-edited rows, matched by (hotel_id, local_id).
//
// This replaces the previous arrangement, where the exe called ~10 full
// /offline* endpoints every 15s and re-downloaded entire tables whenever a
// manifest timestamp moved, and pushed every pending row of an entity in
// one request (confirmed live as "request entity too large" once a hotel
// had ~13,500 cash sessions).
//
// `direction`:
//   "pull"  cloud owns it; the exe only ever reads it.
//   "both"  editable in both places; last write wins by updatedAt, and the
//           cloud wins an exact tie (it is the shared, multi-device copy).
//   "push"  exe owns it; the cloud only ever receives it (append-only logs).
//
// `dependsOn` lists foreign keys whose values arrive as the exe's OWN local
// ids and must be translated to this database's ids before writing. The
// order of ENTITIES matters for that reason: a parent must appear before
// anything that references it, because the exe pushes in this order and
// each parent's cloud id is what the child's translation looks up.

const ENTITIES = [
    // ---- menu domain -------------------------------------------------------
    { name: "menuCatalogs", Model: models.MenuCatalog, direction: "both" },
    { name: "menuCategs", Model: models.Menu_categ, direction: "both", dependsOn: [{ field: "menu_catalog_id", parent: "menuCatalogs" }] },
    { name: "variants", Model: models.Variants, direction: "both", dependsOn: [{ field: "menu_catalog_id", parent: "menuCatalogs" }] },
    { name: "addonDepartments", Model: models.AddonDepartment, direction: "both", dependsOn: [{ field: "menu_catalog_id", parent: "menuCatalogs" }] },
    { name: "menuItems", Model: models.Menu, direction: "both", dependsOn: [{ field: "menu_categ_id", parent: "menuCategs" }] },
    { name: "addons", Model: models.Addons, direction: "both", dependsOn: [{ field: "department_id", parent: "addonDepartments" }] },
    { name: "menuVariants", Model: models.MenuVariants, direction: "both", dependsOn: [{ field: "menu_id", parent: "menuItems" }, { field: "variant_id", parent: "variants" }] },
    { name: "menuAddons", Model: models.MenuAddon, direction: "both", dependsOn: [{ field: "menu_id", parent: "menuItems" }, { field: "addon_department_id", parent: "addonDepartments" }] },

    // ---- floor -------------------------------------------------------------
    // table_status is deliberately NOT synced in either direction here: it is
    // real-time operational state the exe owns outright (which table is
    // occupied right now), and applying a stale cloud snapshot to it was a
    // confirmed live bug. Structure (name/capacity/category/active) is shared.
    { name: "tableCategs", Model: models.TableCatagories, direction: "both" },
    { name: "tables", Model: models.Table, direction: "both", dependsOn: [{ field: "table_catag_id", parent: "tableCategs" }], skipFields: ["table_status"] },

    // ---- bill configuration ------------------------------------------------
    // These four had NO pull path at all before this engine (flagged in the
    // exe's own services/cloudPull.js), which is why a centrally-configured
    // tax or service charge never reached an outlet. They are exactly what
    // the single bill engine reads, so they matter most of all.
    { name: "taxTypes", Model: models.TaxType, direction: "both" },
    { name: "serviceCharge", Model: models.ServiceCharge, direction: "pull" },
    { name: "billChargeRules", Model: models.BillChargeRule, direction: "both" },
    { name: "restaurantSetting", Model: models.RestaurantSetting, direction: "pull" },
    { name: "paymentModes", Model: models.PaymentMode, direction: "both" },
    { name: "notificationSettings", Model: models.NotificationSetting, direction: "both" },
    { name: "rolePermissionDefaults", Model: models.RolePermissionDefault, direction: "both" },
    { name: "invoiceFormate", Model: models.InvoiceFormate, direction: "pull" },
    { name: "kotFormate", Model: models.KotFormate, direction: "pull" },
    // Hardware bound to one specific PC. The exe is where a technician
    // configures it, so it is pulled during first-run bootstrap (a new
    // machine picks up whatever was pre-configured centrally) and never
    // overwritten by a periodic tick afterwards - see the exe's own
    // services/sync/registry.js `bootstrapOnly`.
    { name: "printerSettings", Model: models.PrinterSetting, direction: "pull" },
    { name: "kitchens", Model: models.KitchenSetting, direction: "both" },
    { name: "ebillCredit", Model: models.EBillCredit, direction: "pull" },

    // ---- staff -------------------------------------------------------------
    // Two-way since 2026-09-18: staff can be added on the exe with no
    // internet. `naturalKey` makes push match by identity instead of by id
    // (see push). Session columns never travel in either direction.
    { name: "roles", Model: models.Role, direction: "both", idField: "role_cd", naturalKey: ["role_name"], skipFields: ["role_cd"] },
    {
        name: "hotelUsers", Model: models.HotelUser, direction: "both", naturalKey: ["number"],
        dependsOn: [{ field: "role_cd", parent: "roles" }],
        skipFields: ["refresh_token", "device_id"], pullExclude: ["refresh_token", "device_id"],
    },
    {
        name: "userAccess", Model: models.UserAccess, direction: "both", naturalKey: ["hotelUser_id", "access_name"],
        dependsOn: [{ field: "hotelUser_id", parent: "hotelUsers" }],
    },

    // ---- stock master ------------------------------------------------------
    { name: "units", Model: models.Unit, direction: "both" },
    { name: "rawMaterials", Model: models.RawMaterial, direction: "both", dependsOn: [{ field: "unit_id", parent: "units" }] },
    { name: "suppliers", Model: models.Supplier, direction: "both" },
    { name: "semiFinishedItems", Model: models.SemiFinishedItem, direction: "both", dependsOn: [{ field: "unit_id", parent: "units" }] },
    { name: "semiFinishedRecipes", Model: models.SemiFinishedRecipe, direction: "both", dependsOn: [{ field: "semi_finished_item_id", parent: "semiFinishedItems" }, { field: "raw_material_id", parent: "rawMaterials" }] },
    { name: "recipes", Model: models.Recipes, direction: "both", dependsOn: [
        { field: "semi_finished_item_id", parent: "semiFinishedItems" },
        { field: "raw_material_id", parent: "rawMaterials" },
        { field: "menu_id", parent: "menuItems" },
        { field: "variant_id", parent: "variants" },
        { field: "addon_id", parent: "addons" },
    ] },

    // ---- operations --------------------------------------------------------
    { name: "expenseHeads", Model: models.ExpenseHead, direction: "both" },
    { name: "expenseEntries", Model: models.ExpenseEntry, direction: "both", dependsOn: [{ field: "expense_head_id", parent: "expenseHeads" }] },
    { name: "cashSessions", Model: models.CashSession, direction: "both" },
    // The one table with no hotel_id of its own - scoped through its session.
    { name: "cashMovements", Model: models.CashMovement, direction: "both", scope: "cashSession", dependsOn: [{ field: "cashSessionId", parent: "cashSessions" }] },
    { name: "promoCodes", Model: models.PromoCode, direction: "both" },
    { name: "wastage", Model: models.Westage, direction: "both", dependsOn: [{ field: "raw_material_id", parent: "rawMaterials" }, { field: "unit_id", parent: "units" }] },
    { name: "purchaseOrders", Model: models.PurchaseOrder, direction: "both", dependsOn: [{ field: "supplier_id", parent: "suppliers" }] },
    { name: "purchaseOrderPayments", Model: models.PurchaseOrderPayment, direction: "both", dependsOn: [{ field: "purchaseOrderId", parent: "purchaseOrders" }] },

    // ---- exe-owned, append-only -------------------------------------------
    { name: "customers", Model: models.User, direction: "push" },
    { name: "auditLogs", Model: models.AuditLog, direction: "push" },
];

const BY_NAME = new Map(ENTITIES.map((e) => [e.name, e]));

function getEntity(name) {
    return BY_NAME.get(name) || null;
}

function pullableNames() {
    return ENTITIES.filter((e) => e.direction !== "push").map((e) => e.name);
}

function pushableNames() {
    return ENTITIES.filter((e) => e.direction !== "pull").map((e) => e.name);
}

function primaryKeyOf(entity) {
    return entity.idField || "id";
}

// Orders are pushed through their own endpoint (they carry nested details
// and taxes and need per-order atomicity), so they are not in ENTITIES -
// but the heartbeat still has to report their version so the exe can tell
// whether the cloud has order changes of its own (an e-bill send, a
// centrally-edited bill).
const ORDER_ENTITY = { name: "orders", Model: models.Order };

// One UNION ALL query instead of one MAX(updatedAt) per table. The previous
// manifest fired ~24 separate queries per outlet per tick; at a thousand
// outlets on a 60s timer that is a real, avoidable load on the database.
function buildVersionQuery(entities) {
    const parts = entities.map((e) => {
        const table = e.Model.getTableName();
        if (e.scope === "cashSession") {
            const sessionTable = models.CashSession.getTableName();
            return `SELECT '${e.name}' AS entity, MAX(m.updatedAt) AS maxUpdatedAt, COUNT(*) AS row_count
                    FROM \`${table}\` m
                    WHERE m.cashSessionId IN (SELECT s.id FROM \`${sessionTable}\` s WHERE s.hotel_id = :hotelId)`;
        }
        return `SELECT '${e.name}' AS entity, MAX(updatedAt) AS maxUpdatedAt, COUNT(*) AS row_count
                FROM \`${table}\` WHERE hotel_id = :hotelId`;
    });
    return parts.join("\nUNION ALL\n");
}

// Rows the exe is allowed to see/write for this entity, scoped to one hotel.
function scopeWhere(entity, hotelId) {
    if (entity.scope === "cashSession") {
        return {
            cashSessionId: {
                [Op.in]: require("sequelize").literal(
                    `(SELECT id FROM \`${models.CashSession.getTableName()}\` WHERE hotel_id = ${Number(hotelId)})`,
                ),
            },
        };
    }
    return { hotel_id: hotelId };
}

// Only columns this model really has, minus anything the entity declares
// off-limits and minus the bookkeeping columns that mean different things
// on each side.
const NEVER_ACCEPT = new Set(["id", "local_id", "createdAt", "updatedAt", "synced_at", "cloud_id", "sync_error", "sync_attempts", "packaging_override"]);

function pickWritableFields(entity, row) {
    const allowed = new Set(Object.keys(entity.Model.rawAttributes));
    const skip = new Set(entity.skipFields || []);
    const picked = {};
    for (const key of Object.keys(row)) {
        if (!allowed.has(key)) continue;
        if (NEVER_ACCEPT.has(key)) continue;
        if (skip.has(key)) continue;
        picked[key] = row[key];
    }
    return picked;
}

module.exports = {
    ENTITIES, ORDER_ENTITY, getEntity, pullableNames, pushableNames,
    primaryKeyOf, buildVersionQuery, scopeWhere, pickWritableFields,
};
