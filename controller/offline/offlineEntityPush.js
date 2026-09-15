const { MESSAGE, STATUSCODE } = require("../../constant/const");
const { error, success } = require("../../responce/res");
const {
    Hotel, Recipes, SemiFinishedItem, SemiFinishedRecipe, ExpenseHead, ExpenseEntry,
    CashSession, CashMovement, PromoCode, Westage, PurchaseOrder, PurchaseOrderPayment, Supplier,
    AuditLog,
    MenuCatalog, Menu_categ, Menu, Variants, AddonDepartment, Addons, MenuVariants, MenuAddon,
} = require("../../model");

// Task 2 (operations local-only entities), push half. The exe's local
// SQLite ids and this database's own auto-increment ids share no id space
// at all (unlike Orders, which match on bill_no+hotel_id) - a recipe
// created on the exe has no relationship to any MySQL id here. `local_id`
// (added by migration 20260901074800, paired with a unique index on
// hotel_id+local_id - or cashSessionId+local_id for cashMovements, the one
// table with no hotel_id of its own) gives this a real upsert key: find by
// (hotel_id, local_id) first, update if found, create if not - so a retry
// or a later edit of the same local row lands on the same cloud row
// instead of creating a duplicate every time.
//
// One generic endpoint for all 12 entities rather than 12 near-identical
// ones - every model here has a flat, matching field shape between the
// exe's SQLite table and this MySQL one (confirmed while building the pull
// half of this same task), so there's no per-entity mapping logic that
// would justify the repetition.
const ENTITY_MODELS = {
    // Task 10 (menu catalogue push) - same generic shape as the 12
    // operations entities below, added later once Menu/Menu_categ/
    // MenuCatalog/Variants/AddonDepartment/Addons and their two join
    // tables gained their own local_id column (migration 20260911140000).
    // Fixes a real incident: an order referencing an exe-created,
    // never-synced menu item failed to push at all (FK constraint error on
    // MenuId) - see services/cloudPushOperations.js (exe) for the push
    // side and services/cloudSync.js's MenuId translation.
    menuCatalogs: { Model: MenuCatalog, scopeField: "hotel_id" },
    menuCategs: { Model: Menu_categ, scopeField: "hotel_id" },
    variants: { Model: Variants, scopeField: "hotel_id" },
    addonDepartments: { Model: AddonDepartment, scopeField: "hotel_id" },
    menuItems: { Model: Menu, scopeField: "hotel_id" },
    addons: { Model: Addons, scopeField: "hotel_id" },
    menuVariants: { Model: MenuVariants, scopeField: "hotel_id" },
    menuAddons: { Model: MenuAddon, scopeField: "hotel_id" },

    suppliers: { Model: Supplier, scopeField: "hotel_id" },
    semiFinishedItems: { Model: SemiFinishedItem, scopeField: "hotel_id" },
    semiFinishedRecipes: { Model: SemiFinishedRecipe, scopeField: "hotel_id" },
    recipes: { Model: Recipes, scopeField: "hotel_id" },
    expenseHeads: { Model: ExpenseHead, scopeField: "hotel_id" },
    expenseEntries: { Model: ExpenseEntry, scopeField: "hotel_id" },
    cashSessions: { Model: CashSession, scopeField: "hotel_id" },
    // No hotel_id of its own - scoped by cashSessionId instead (see the
    // migration's own comment on why that's still a safe uniqueness scope).
    cashMovements: { Model: CashMovement, scopeField: "cashSessionId" },
    promoCodesFull: { Model: PromoCode, scopeField: "hotel_id" },
    wastage: { Model: Westage, scopeField: "hotel_id" },
    purchaseOrders: { Model: PurchaseOrder, scopeField: "hotel_id" },
    purchaseOrderPayments: { Model: PurchaseOrderPayment, scopeField: "hotel_id" },
    auditLogs: { Model: AuditLog, scopeField: "hotel_id" },
};

// POST /offlineEntityPush - body: { entity, rows: [{ id, ...fields }] }.
// `id` is the LOCAL row's own id (renamed to local_id here, never trusted
// as this table's own primary key); everything else is spread straight
// through - each model's rawAttributes gates what actually gets written,
// same safety net cloudPull.js's pickOwnColumns already uses on the pull
// side, so an unexpected/extra field in the payload can't write to a
// column that doesn't exist.
const offlineEntityPush = async (req, res) => {
    try {
        const hotel = await Hotel.findOne({ where: { id: req.user } });
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.NOT_FOUND));

        const { entity, rows } = req.body;
        const config = ENTITY_MODELS[entity];
        if (!config) return res.json(error(`Unknown entity: ${entity}`, STATUSCODE.BAD_REQUEST));
        const { Model, scopeField } = config;
        const allowedFields = new Set(Object.keys(Model.rawAttributes));

        const results = [];
        for (const row of rows || []) {
            const { id: local_id, ...rest } = row;
            const picked = {};
            for (const key of Object.keys(rest)) {
                if (allowedFields.has(key)) picked[key] = rest[key];
            }
            picked.local_id = local_id;
            // cashMovements' scope (cashSessionId) already comes through in
            // `rest` from the exe's own payload - every other entity needs
            // hotel_id added explicitly since the exe's local row doesn't
            // carry the CLOUD hotel_id under that name (it's implicit/local
            // there, from the device's own registration).
            if (scopeField === "hotel_id") picked.hotel_id = req.user;

            let existing = await Model.findOne({ where: { [scopeField]: picked[scopeField], local_id } });

            // First push of a row that reached the exe via PULL, not
            // create: cloudPull.js's upsertAll writes pulled rows locally
            // using the CLOUD's own id as the local id (pickOwnColumns
            // includes `id` - it's a real column on every one of these
            // models), so a never-yet-pushed pulled row's local id is
            // numerically the SAME as its real cloud row's id, which
            // itself has local_id still NULL (pull never sets it - only
            // push does). Without this check that row looks brand new to
            // the (scopeField, local_id) lookup above and gets created a
            // second time - confirmed live as a genuine duplicate on the
            // very first push of any hotel's pre-existing pulled data.
            // Claiming the existing untagged row by id instead is the fix:
            // any local id that happens to collide with an UNRELATED
            // cloud id from a true local-only create would only match here
            // if that unrelated row also had local_id NULL - itself only
            // possible for old pre-local_id-migration data, which is
            // exactly the "originally came from this same table before
            // this feature existed" case this is meant to catch, not a
            // new false positive.
            if (!existing) {
                existing = await Model.findOne({ where: { [scopeField]: picked[scopeField], id: local_id, local_id: null } });
            }

            let cloudId;
            if (existing) {
                await existing.update(picked);
                cloudId = existing.id;
            } else {
                const created = await Model.create(picked);
                cloudId = created.id;
            }
            results.push({ local_id, cloud_id: cloudId });
        }

        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { results }, STATUSCODE.SUCCESS));
    } catch (err) {
        console.error("[offlineEntityPush] error:", err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

module.exports = { offlineEntityPush };
