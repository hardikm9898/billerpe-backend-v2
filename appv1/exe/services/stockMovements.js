// COPY of billerpe-local-exe/services/stockMovements.js for the POS App (Plan 2) -
// written by scripts/vendor-exe-for-appv1.py. Do not edit here: change the
// exe's file and re-run the script, so both plans keep the same rules.

const { Op } = require("sequelize");
const { MESSAGE, STATUSCODE } = require("../../../constant/const");
const { success, error } = require("../../../responce/res");
const { StockInHand, StockHistory, RawMaterial, Unit, RestaurantSetting } = require("../model");
const { getBusinessDate } = require("../utils/dateUtils");
const { applyStockMovement } = require("../../engine/stockLedger");

// Ported from uat-backend-v2/controller/stock_Mangement/stockInOut.js - the
// stock-movement half of the stock write-path port (split from
// controller/stock.js's simple-CRUD addUnit/editUnit/addRawMaterial/
// editRawMaterial because these touch running stock averages/history, not
// because the logic differs in kind). Business logic (running average
// price on stock-in, qty reconciliation on edit/delete, manual stock
// adjustment) reproduced as-is - real stock movements touching money/
// inventory correctness deserve fidelity to the original, not a
// reinterpretation of it.
//
// One real bug found and fixed while porting, not reproduced: the cloud's
// stockOut computes `const available_stock_Consiompsion_qty = 1` and then,
// inside an `if`, tries to REASSIGN that const - a guaranteed
// `TypeError: Assignment to constant variable` for any raw material whose
// purchase and consumption units differ (checked live: RawMaterial has no
// `unit` field at all, only `unit_id` - so `.unit` is always undefined,
// making that comparison against a real `consumption_unit` true almost
// always). The computed value is provably dead code either way - nothing
// below that block ever reads it, the real available_stock_Consiompsion_qty
// used in the actual update is computed fresh, inline, further down. Removed
// entirely rather than fixed-in-place, since keeping unreachable-or-crashing
// dead code around would just be porting the bug forward under a different
// shape.

// Manual stock in / out go through the one stock service
// (services/stockLedger.js). The old copies here recorded a first stock-in
// as 1 usable unit whatever the quantity, and deleted the stock row when a
// stock-out reached exactly 0.
async function stockInFunction({ qty, raw_material_id, price, hotel_id, userId, note, type = "stock_in" }) {
    if (!(Number(qty) > 0)) throw Object.assign(new Error("Enter a quantity more than 0"), { isBadRequest: true });
    try {
        await applyStockMovement({
            hotel_id, raw_material_id, qty: Number(qty), unit_cost: price === undefined || price === "" ? undefined : Number(price),
            type, user_id: userId, note,
        });
    } catch (err) {
        if (err.status === 400) err.isBadRequest = true;
        throw err;
    }
}

const stockIn = async (req, res) => {
    try {
        const { qty, raw_material_id, price, note, count } = req.body;
        await stockInFunction({ qty, raw_material_id, price, note: count ? "Stock count" : note, type: count ? "adjustment" : "stock_in", hotel_id: req.user, userId: req.userId });
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { message: "Stock Added Successfully" }, STATUSCODE.SUCCESS));
    } catch (err) {
        console.error("[stockMovements] stockIn error:", err);
        if (err.isBadRequest) return res.json(error(err.message, STATUSCODE.BAD_REQUEST));
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

// A person taking stock out by hand can't take more than there is (a sale
// can - owner rule - but that is the order's deduction, not this).
const stockOut = async (req, res) => {
    try {
        const { raw_material_id, count } = req.body;
        const note = count ? "Stock count" : req.body.note;
        const qty = Number(req.body.qty);
        if (!(qty > 0)) return res.json(error("Enter a quantity more than 0", STATUSCODE.BAD_REQUEST));
        const stock = await StockInHand.findOne({ where: { raw_material_id, hotel_id: req.user, deleted: false } });
        const onHand = Number(stock?.qty) || 0;
        if (qty > onHand + 1e-9) {
            return res.json(error(`Only ${Math.max(0, Math.round(onHand * 100) / 100)} in stock - you can't take out more than that`, STATUSCODE.BAD_REQUEST));
        }
        await applyStockMovement({ hotel_id: req.user, raw_material_id, qty: -qty, type: count ? "adjustment" : "stock_out", user_id: req.userId, note });
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { message: "Stock Out Successfully" }, STATUSCODE.SUCCESS));
    } catch (err) {
        console.error("[stockMovements] stockOut error:", err);
        if (err.status === 400) return res.json(error(err.message, STATUSCODE.BAD_REQUEST));
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

const stockInOutHistory = async (req, res) => {
    try {
        const { startDate, endDate } = req.query;
        const startD = new Date(startDate);
        const endD = new Date(endDate);
        const stockInOutHistory = await StockHistory.findAll({
            where: { hotel_id: req.user, deleted: false, createdAt: { [Op.between]: [startD, endD] } },
            include: { model: RawMaterial, include: [{ model: Unit, as: "purchaseUnit" }, { model: Unit, as: "consumptionUnit" }] },
        });
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { stockInOutHistory }, STATUSCODE.SUCCESS));
    } catch (err) {
        console.error("[stockMovements] stockInOutHistory error:", err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

// Editing or deleting an old stock-history entry corrects stock by the
// difference, through the stock service (the old copies here deleted the
// stock row at 0 and refused when stock was short).
const editStockHistory = async (req, res) => {
    try {
        const { qty, id } = req.body;
        const entry = await StockHistory.findOne({ where: { id, hotel_id: req.user, deleted: false } });
        if (!entry) return res.json(error("Stock History Not Found", STATUSCODE.BAD_REQUEST));
        const difference = Number(qty) - Number(entry.qty);
        if (difference) {
            await applyStockMovement({
                hotel_id: req.user, raw_material_id: entry.raw_material_id, qty: entry.stock_in ? difference : -difference,
                type: entry.stock_in ? "stock_in" : "stock_out", unit_cost: Number(entry.price) || undefined,
                ref_type: "stock_history", ref_id: entry.id, note: "History entry edited", user_id: req.userId,
            });
        }
        await entry.update({ qty, total_amount: String(Number(qty) * Number(entry.price || 0)) });
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { message: "Stock Updated" }, STATUSCODE.SUCCESS));
    } catch (err) {
        console.error("[stockMovements] editStockHistory error:", err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

const deleteStockHistory = async (req, res) => {
    try {
        const { id } = req.query;
        const entry = await StockHistory.findOne({ where: { id, hotel_id: req.user, deleted: false } });
        if (!entry) return res.json(error("Stock History Not Found", STATUSCODE.BAD_REQUEST));
        await applyStockMovement({
            hotel_id: req.user, raw_material_id: entry.raw_material_id, qty: entry.stock_in ? -Number(entry.qty) : Number(entry.qty),
            type: entry.stock_in ? "stock_out" : "stock_in", unit_cost: Number(entry.price) || undefined,
            ref_type: "stock_history", ref_id: entry.id, note: "History entry deleted", user_id: req.userId,
        });
        await entry.update({ deleted: true });
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { message: "Stock Deleted Successfully" }, STATUSCODE.SUCCESS));
    } catch (err) {
        console.error("[stockMovements] deleteStockHistory error:", err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

// "Set stock to" (a physical count): the difference is one "adjustment"
// movement, so the ledger shows why stock changed.
const updateManualStock = async (req, res) => {
    try {
        const { manualStockData } = req.body;
        for (const cur of manualStockData || []) {
            const current = await StockInHand.findOne({ where: { id: cur.id, hotel_id: req.user } });
            if (!current) continue;
            const conversion = Number(cur.conversion_qty) || 1;
            const target = (Number(cur.purchase_stock) || 0) + (Number(cur.consumption_stock) || 0) / conversion;
            const difference = target - Number(current.qty);
            if (Math.abs(difference) < 1e-9) continue;
            await applyStockMovement({
                hotel_id: req.user, raw_material_id: current.raw_material_id, qty: difference, type: "adjustment",
                user_id: req.userId, note: "Stock count",
            });
        }
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { message: "Stock Updated" }, STATUSCODE.SUCCESS));
    } catch (err) {
        console.error("[stockMovements] updateManualStock error:", err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

const adjustManualAveragePrice = async (req, res) => {
    try {
        const { manualStockData } = req.body;
        for (const cur of manualStockData) {
            const stock = await StockInHand.findOne({ where: { id: cur.id, hotel_id: req.user } });
            if (!stock) continue;
            const newAvg = Number(cur.average_price) || 0;
            const valueChange = Math.round((newAvg - Number(stock.average_price || 0)) * Number(stock.qty) * 100) / 100;
            await stock.update({ average_price: String(newAvg), total_amount: Math.round(Number(stock.qty) * newAvg * 100) / 100 });
            // Stock value changes without any goods moving: journaled as a
            // zero-quantity adjustment so the ledger's values still add up.
            if (valueChange) {
                const { StockMovement } = require("../model");
                const { businessDateFor } = require("../../engine/stockLedger");
                await StockMovement.create({
                    hotel_id: req.user, raw_material_id: stock.raw_material_id, type: "adjustment", qty: 0,
                    unit_cost: newAvg, value: valueChange, balance_qty: Number(stock.qty),
                    business_date: await businessDateFor(req.user), note: "Average price corrected", user_id: req.userId,
                });
            }
        }
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { message: "Average Price Updated" }, STATUSCODE.SUCCESS));
    } catch (err) {
        console.error("[stockMovements] adjustManualAveragePrice error:", err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

module.exports = { stockIn, stockOut, stockInOutHistory, editStockHistory, deleteStockHistory, updateManualStock, adjustManualAveragePrice };
