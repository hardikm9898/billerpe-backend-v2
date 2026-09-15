const { MESSAGE, STATUSCODE } = require("../../constant/const");
const { error, success } = require("../../responce/res");
const {
    Hotel, Recipes, SemiFinishedItem, SemiFinishedRecipe, ExpenseHead, ExpenseEntry,
    CashSession, CashMovement, PromoCode, Westage, PurchaseOrder, PurchaseOrderPayment, Supplier,
} = require("../../model");

// New for the pull-efficiency pass' Task 2: these 8 "operations" entities
// (13 tables) were only ever ported to the exe as WRITE paths (Phase F) -
// nothing pushed exe-side changes up, and nothing pulled cloud-side changes
// down, so a hotel with 2 devices, or the cloud dashboard, could never see
// them. This is the pull half - flat hotel-scoped row lists, mirroring the
// exact same shape/pattern as offline.js's existing offlineMenuCateg/
// offlinePrinterSetting/etc (not the human-facing getAllRecipes/etc routes,
// which return derived/nested shapes like convertMenuWise's menu-grouped
// tree - wrong shape for a flat upsertAll on the other end). Push (exe ->
// cloud) is a separate, harder problem (the exe's local ids and this
// database's auto-increment ids share no id space) and isn't solved by this
// file.
//
// Each handler is a plain, unconditional Model.findAll({where: {hotel_id}})
// - no redis caching (these change far less often than menu/orders, and
// caching here would just reintroduce the same "how do I know when to
// invalidate" problem the pull-efficiency manifest already solves properly
// via real MAX(updatedAt) checks).

function makeOfflineListHandler(Model, resultKey) {
    return async (req, res) => {
        try {
            const hotel = await Hotel.findOne({ where: { id: req.user } });
            if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.NOT_FOUND));
            const rows = await Model.findAll({ where: { hotel_id: req.user } });
            return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { [resultKey]: rows }, STATUSCODE.SUCCESS));
        } catch (err) {
            console.error(`[offlineOperations] ${resultKey} error:`, err);
            return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
        }
    };
}

// CashMovement has no hotel_id of its own (only cashSessionId ->
// CashSession -> hotel_id, confirmed live - the generic handler above
// throws "Unknown column hotel_id in where clause" for it) - scope via the
// session ids for this hotel instead of a direct where clause, same fix
// as the manifest endpoint's maxUpdatedAtViaCashSession needed.
const offlineCashMovements = async (req, res) => {
    try {
        const hotel = await Hotel.findOne({ where: { id: req.user } });
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.NOT_FOUND));
        const sessionIds = (await CashSession.findAll({ where: { hotel_id: req.user }, attributes: ["id"], raw: true })).map((s) => s.id);
        const cashMovements = sessionIds.length ? await CashMovement.findAll({ where: { cashSessionId: sessionIds } }) : [];
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { cashMovements }, STATUSCODE.SUCCESS));
    } catch (err) {
        console.error("[offlineOperations] cashMovements error:", err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

module.exports = {
    offlineRecipes: makeOfflineListHandler(Recipes, "recipes"),
    offlineSemiFinishedItems: makeOfflineListHandler(SemiFinishedItem, "semiFinishedItems"),
    offlineSemiFinishedRecipes: makeOfflineListHandler(SemiFinishedRecipe, "semiFinishedRecipes"),
    offlineExpenseHeads: makeOfflineListHandler(ExpenseHead, "expenseHeads"),
    offlineExpenseEntries: makeOfflineListHandler(ExpenseEntry, "expenseEntries"),
    offlineCashSessions: makeOfflineListHandler(CashSession, "cashSessions"),
    offlineCashMovements,
    offlinePromoCodesFull: makeOfflineListHandler(PromoCode, "promoCodes"),
    offlineWastage: makeOfflineListHandler(Westage, "wastage"),
    offlinePurchaseOrders: makeOfflineListHandler(PurchaseOrder, "purchaseOrders"),
    offlinePurchaseOrderPayments: makeOfflineListHandler(PurchaseOrderPayment, "purchaseOrderPayments"),
    offlineSuppliers: makeOfflineListHandler(Supplier, "suppliers"),
};
