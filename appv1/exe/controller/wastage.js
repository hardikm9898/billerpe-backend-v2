// COPY of billerpe-local-exe/controller/wastage.js for the POS App (Plan 2) -
// written by scripts/vendor-exe-for-appv1.py. Do not edit here: change the
// exe's file and re-run the script, so both plans keep the same rules.

const { Op } = require("sequelize");
const { sequelize, RawMaterial, StockInHand, Westage, Unit, HotelUser, RestaurantSetting } = require("../model");
const { MESSAGE, STATUSCODE } = require("../../../constant/const");
const { success, error } = require("../../../responce/res");
const { getBusinessDate, getShiftedDateRange } = require("../utils/dateUtils");
const { applyStockMovement } = require("../../engine/stockLedger");

// Ported from uat-backend-v2/controller/stock_Mangement/westage.js. Three
// fixes applied vs. the source, per explicit sign-off (architecture memo,
// Phase F):
//   1. Every early-return-on-error inside the per-item loop now rolls back
//      the transaction first. The source's `return res.json(error(...))`
//      calls bypass the catch block entirely, leaving the transaction open
//      and uncommitted - a real connection/lock leak, not just a style
//      issue.
//   2. getWastageRecords no longer includes the full HotelUser row (which
//      carries a bcrypt password hash and refresh token) - scoped to
//      {id, name} like every other HotelUser include in this codebase.
//   3. Reads RestaurantSetting.timeZone (correct casing, matches the
//      column everywhere else in this codebase) instead of the source's
//      `.timezone` (lowercase), which reads undefined and silently
//      defaults the timezone - a real correctness bug, not a deliberate
//      per-hotel override.

const createRawMaterialWastage = async (req, res) => {
    const t = await sequelize.transaction();
    try {
        const hotel_id = req.user;
        const items = req.body;
        if (!Array.isArray(items) || items.length === 0) {
            await t.rollback();
            return res.json(error("Body must be a non-empty array of wastage items", STATUSCODE.BAD_REQUEST));
        }
        for (const item of items) {
            if (!(Number(item.qty) > 0) || !item.reason || item.raw_material_id === undefined || item.unit_id === undefined) {
                await t.rollback();
                return res.json(error("raw_material_id, unit_id, qty (> 0) and reason are required for every item", STATUSCODE.BAD_REQUEST));
            }
        }

        const setting = await RestaurantSetting.findOne({ where: { hotel_id }, transaction: t });
        const timeZone = setting?.timeZone || "Asia/Kolkata";
        const businessStartTime = setting?.business_day_start_time || "00:01:00";
        const business_date = getBusinessDate(timeZone, businessStartTime);

        for (const item of items) {
            const rawMaterial = await RawMaterial.findOne({ where: { id: item.raw_material_id, hotel_id }, transaction: t });
            if (!rawMaterial) {
                await t.rollback();
                return res.json(error("Raw material not found", STATUSCODE.BAD_REQUEST));
            }
            const unitId = Number(item.unit_id);
            const conversionQty = Number(rawMaterial.conversion_qty) || 1;
            // Wastage is entered in either unit; stock is kept in the purchase unit.
            let purchaseQty;
            if (unitId === Number(rawMaterial.unit_id)) purchaseQty = Number(item.qty);
            else if (unitId === Number(rawMaterial.consumption_unit)) purchaseQty = Number(item.qty) / conversionQty;
            else {
                await t.rollback();
                return res.json(error("Invalid unit selected", STATUSCODE.BAD_REQUEST));
            }
            const stock = await StockInHand.findOne({ where: { raw_material_id: item.raw_material_id, hotel_id, deleted: false }, transaction: t });
            const onHand = Number(stock?.qty) || 0;
            if (purchaseQty > onHand + 1e-9) {
                await t.rollback();
                return res.json(error(`Only ${Math.max(0, Math.round(onHand * 100) / 100)} of ${rawMaterial.raw_material_name} in stock - wastage can't be more than that`, STATUSCODE.BAD_REQUEST));
            }
            const record = await Westage.create({
                hotel_id, raw_material_id: item.raw_material_id, user_id: req.userId, unit_id: item.unit_id,
                average_price: 0, qty: item.qty, reason: item.reason, notes: item.notes || "", business_date,
            }, { transaction: t });
            const { unitCost } = await applyStockMovement({
                hotel_id, raw_material_id: item.raw_material_id, qty: -purchaseQty, type: "wastage",
                ref_type: "wastage", ref_id: record.id, note: item.reason, user_id: req.userId, t,
            });
            // average_price here has always held the wastage's total cost.
            await record.update({ average_price: Math.round(purchaseQty * unitCost * 100) / 100 }, { transaction: t });
        }

        await t.commit();
        return res.status(STATUSCODE.CREATED).json(success(MESSAGE.SUCCESS, { message: "Wastage recorded successfully" }, STATUSCODE.CREATED));
    } catch (err) {
        await t.rollback();
        console.error("[wastage] createRawMaterialWastage error:", err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

const getWastageRecords = async (req, res) => {
    try {
        const hotel_id = req.user;
        const page = Number(req.query.page) || 1;
        const limit = Number(req.query.limit) || 10;
        const { businessStartDate, businessEndDate } = await getShiftedDateRange(req.query.startDate, req.query.endDate, hotel_id);
        const range = { [Op.between]: [businessStartDate, businessEndDate] };

        const { rows, count } = await Westage.findAndCountAll({
            where: { deleted_status: false, hotel_id, business_date: range },
            include: [
                { model: RawMaterial, attributes: ["id", "raw_material_name"] },
                { model: Unit, attributes: ["id", "unit_name"] },
                // Fixed: attribute allowlist - the source included the full
                // HotelUser row here, leaking a bcrypt password hash and
                // refresh token into this response.
                { model: HotelUser, attributes: ["id", "name"] },
            ],
            limit, offset: (page - 1) * limit,
            order: [["createdAt", "DESC"]],
        });
        const totalCost = (await Westage.sum("average_price", { where: { deleted_status: false, hotel_id, business_date: range } })) || 0;

        return res.json(success(MESSAGE.SUCCESS, {
            totalCost, data: rows,
            pagination: { totalItems: count, totalPages: Math.ceil(count / limit), currentPage: page },
        }, STATUSCODE.SUCCESS));
    } catch (err) {
        console.error("[wastage] getWastageRecords error:", err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

const deleteWastageRecord = async (req, res) => {
    const t = await sequelize.transaction();
    try {
        const hotel_id = req.user;
        const { wastage_id } = req.params;
        // Not an already-deleted one: deleting twice put the stock back twice.
        const wastageRecord = await Westage.findOne({ where: { id: wastage_id, hotel_id, deleted_status: false }, transaction: t });
        if (!wastageRecord) {
            await t.rollback();
            return res.json(error("Wastage record not found", STATUSCODE.BAD_REQUEST));
        }
        const rawMaterial = await RawMaterial.findOne({ where: { id: wastageRecord.raw_material_id, hotel_id }, transaction: t });
        if (rawMaterial) {
            const conversionQty = Number(rawMaterial.conversion_qty) || 1;
            const purchaseQty = Number(wastageRecord.unit_id) === Number(rawMaterial.unit_id)
                ? Number(wastageRecord.qty)
                : Number(wastageRecord.qty) / conversionQty;
            await applyStockMovement({
                hotel_id, raw_material_id: wastageRecord.raw_material_id, qty: purchaseQty, type: "wastage_reversal",
                unit_cost: purchaseQty ? Number(wastageRecord.average_price) / purchaseQty : undefined,
                ref_type: "wastage", ref_id: wastageRecord.id, note: "Wastage entry deleted", user_id: req.userId, t,
            });
        }
        await wastageRecord.update({ deleted_status: true }, { transaction: t });

        await t.commit();
        return res.json(success(MESSAGE.SUCCESS, { message: "Wastage record deleted successfully" }, STATUSCODE.SUCCESS));
    } catch (err) {
        await t.rollback();
        console.error("[wastage] deleteWastageRecord error:", err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

module.exports = { createRawMaterialWastage, getWastageRecords, deleteWastageRecord };
