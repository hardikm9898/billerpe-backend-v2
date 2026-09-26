// COPY of billerpe-local-exe/controller/semiFinishedItems.js for the POS App (Plan 2) -
// written by scripts/vendor-exe-for-appv1.py. Do not edit here: change the
// exe's file and re-run the script, so both plans keep the same rules.

const { sequelize, Hotel, Unit, RawMaterial, SemiFinishedItem, SemiFinishedRecipe, SemiFinishedStock } = require("../model");
const { MESSAGE, STATUSCODE } = require("../../../constant/const");
const { success, error } = require("../../../responce/res");

// Ported from uat-backend-v2/controller/semiFinishedItems.js - all 8 routes.

const getAllSemiFinishedItems = async (req, res) => {
    try {
        const items = await SemiFinishedItem.findAll({
            where: { hotel_id: req.user },
            include: [
                { model: Unit, as: "unit", attributes: ["unit_name"] },
                { model: SemiFinishedStock, as: "stock" },
            ],
            order: [["createdAt", "DESC"]],
        });
        return res.json(success(MESSAGE.SUCCESS, { items }, STATUSCODE.SUCCESS));
    } catch (err) {
        console.error("[semiFinished] getAllSemiFinishedItems error:", err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

const getSingleSemiFinishedItem = async (req, res) => {
    try {
        const { id } = req.query;
        const item = await SemiFinishedItem.findOne({
            where: { id, hotel_id: req.user },
            include: [
                { model: Unit, as: "unit", attributes: ["unit_name"] },
                { model: SemiFinishedStock, as: "stock" },
            ],
        });
        if (!item) return res.json(error("Semi-finished item not found", STATUSCODE.NOT_FOUND));

        const recipes = await SemiFinishedRecipe.findAll({
            where: { semi_finished_item_id: id, hotel_id: req.user },
            include: {
                model: RawMaterial, as: "rawMaterial",
                attributes: ["id", "raw_material_name", "purchase_price", "conversion_qty"],
                include: { model: Unit, as: "consumptionUnit", attributes: ["unit_name"] },
            },
        });
        const plain = item.toJSON();
        plain.recipes = recipes;
        return res.json(success(MESSAGE.SUCCESS, { item: plain }, STATUSCODE.SUCCESS));
    } catch (err) {
        console.error("[semiFinished] getSingleSemiFinishedItem error:", err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

const getAllSFINames = async (req, res) => {
    try {
        const items = await SemiFinishedItem.findAll({
            where: { hotel_id: req.user },
            attributes: ["id", "name"],
            include: [
                { model: Unit, as: "unit", attributes: ["unit_name"] },
                { model: SemiFinishedStock, as: "stock", attributes: ["available_qty"] },
            ],
            order: [["name", "ASC"]],
        });
        return res.json(success(MESSAGE.SUCCESS, { items }, STATUSCODE.SUCCESS));
    } catch (err) {
        console.error("[semiFinished] getAllSFINames error:", err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

const getSFIStockLevels = async (req, res) => {
    try {
        const rows = await SemiFinishedStock.findAll({
            where: { hotel_id: req.user },
            include: {
                model: SemiFinishedItem, as: "semiFinishedItem",
                attributes: ["id", "name", "min_stock_level", "min_stock_qty"],
                include: { model: Unit, as: "unit", attributes: ["unit_name"] },
            },
        });
        const levels = rows.map((r) => {
            const plain = r.toJSON();
            const sfi = plain.semiFinishedItem;
            plain.is_low_stock = sfi?.min_stock_level ? Number(plain.available_qty) < Number(sfi.min_stock_qty) : false;
            return plain;
        });
        return res.json(success(MESSAGE.SUCCESS, { levels }, STATUSCODE.SUCCESS));
    } catch (err) {
        console.error("[semiFinished] getSFIStockLevels error:", err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

function validateSfiRecipes(recipes) {
    if (!Array.isArray(recipes) || recipes.length === 0) return "recipes must be a non-empty array";
    for (const r of recipes) {
        if (!r.raw_material_id) return "raw_material_id is required for every recipe line";
        if (!(Number(r.consumption_qty) > 0)) return "consumption_qty must be greater than 0 for every recipe line";
    }
    return null;
}

const addSemiFinishedItem = async (req, res) => {
    const t = await sequelize.transaction();
    try {
        const { name, unit_id, min_stock_level = false, min_stock_qty = 0, recipes } = req.body;
        const hotel_id = req.user;

        if (!name || !String(name).trim()) {
            await t.rollback();
            return res.json(error("name is required", STATUSCODE.BAD_REQUEST));
        }
        const recipeError = validateSfiRecipes(recipes);
        if (recipeError) {
            await t.rollback();
            return res.json(error(recipeError, STATUSCODE.BAD_REQUEST));
        }

        const rawMaterialIds = recipes.map((r) => Number(r.raw_material_id));
        const count = await RawMaterial.count({ where: { id: rawMaterialIds, hotel_id }, transaction: t });
        if (count !== new Set(rawMaterialIds).size) {
            await t.rollback();
            return res.json(error("One or more raw materials not found", STATUSCODE.NOT_FOUND));
        }

        const item = await SemiFinishedItem.create(
            { hotel_id, name: String(name).trim(), unit_id: unit_id || null, min_stock_level, min_stock_qty },
            { transaction: t },
        );
        await SemiFinishedRecipe.bulkCreate(
            recipes.map((r) => ({ hotel_id, semi_finished_item_id: item.id, raw_material_id: r.raw_material_id, consumption_qty: r.consumption_qty })),
            { transaction: t },
        );
        await SemiFinishedStock.create(
            { hotel_id, semi_finished_item_id: item.id, available_qty: 0, cost_per_unit: 0, total_amount: 0 },
            { transaction: t },
        );

        await t.commit();
        return res.json(success(MESSAGE.SUCCESS, { id: item.id }, STATUSCODE.CREATED));
    } catch (err) {
        await t.rollback();
        if (err.name === "SequelizeUniqueConstraintError") {
            return res.json(error("Duplicate ingredient in recipe", STATUSCODE.CONFLICT));
        }
        console.error("[semiFinished] addSemiFinishedItem error:", err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

const editSemiFinishedItem = async (req, res) => {
    const t = await sequelize.transaction();
    try {
        const { id, name, unit_id, min_stock_level, min_stock_qty, recipes } = req.body;
        const hotel_id = req.user;
        if (!id) {
            await t.rollback();
            return res.json(error("id is required", STATUSCODE.BAD_REQUEST));
        }
        const item = await SemiFinishedItem.findOne({ where: { id, hotel_id }, transaction: t });
        if (!item) {
            await t.rollback();
            return res.json(error("Semi-finished item not found", STATUSCODE.NOT_FOUND));
        }

        await item.update({
            name: name ? String(name).trim() : item.name,
            unit_id: unit_id !== undefined ? unit_id : item.unit_id,
            min_stock_level: min_stock_level !== undefined ? min_stock_level : item.min_stock_level,
            min_stock_qty: min_stock_qty !== undefined ? min_stock_qty : item.min_stock_qty,
        }, { transaction: t });

        if (Array.isArray(recipes) && recipes.length) {
            const recipeError = validateSfiRecipes(recipes);
            if (recipeError) {
                await t.rollback();
                return res.json(error(recipeError, STATUSCODE.BAD_REQUEST));
            }
            const rawMaterialIds = recipes.map((r) => Number(r.raw_material_id));
            const count = await RawMaterial.count({ where: { id: rawMaterialIds, hotel_id }, transaction: t });
            if (count !== new Set(rawMaterialIds).size) {
                await t.rollback();
                return res.json(error("One or more raw materials not found", STATUSCODE.NOT_FOUND));
            }
            await SemiFinishedRecipe.destroy({ where: { semi_finished_item_id: id, hotel_id }, transaction: t });
            await SemiFinishedRecipe.bulkCreate(
                recipes.map((r) => ({ hotel_id, semi_finished_item_id: id, raw_material_id: r.raw_material_id, consumption_qty: r.consumption_qty })),
                { transaction: t },
            );
        }

        await t.commit();
        return res.json(success(MESSAGE.SUCCESS, { message: "Semi-finished item updated" }, STATUSCODE.SUCCESS));
    } catch (err) {
        await t.rollback();
        if (err.name === "SequelizeUniqueConstraintError") {
            return res.json(error("Duplicate ingredient in recipe", STATUSCODE.CONFLICT));
        }
        console.error("[semiFinished] editSemiFinishedItem error:", err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

const deleteSemiFinishedItem = async (req, res) => {
    const t = await sequelize.transaction();
    try {
        const { id } = req.query;
        const hotel_id = req.user;
        const item = await SemiFinishedItem.findOne({ where: { id, hotel_id }, transaction: t });
        if (!item) {
            await t.rollback();
            return res.json(error("Semi-finished item not found", STATUSCODE.NOT_FOUND));
        }
        await SemiFinishedRecipe.destroy({ where: { semi_finished_item_id: id, hotel_id }, transaction: t });
        await SemiFinishedStock.destroy({ where: { semi_finished_item_id: id, hotel_id }, transaction: t });
        await item.destroy({ transaction: t });
        await t.commit();
        return res.json(success(MESSAGE.SUCCESS, { message: "Semi-finished item deleted" }, STATUSCODE.SUCCESS));
    } catch (err) {
        await t.rollback();
        console.error("[semiFinished] deleteSemiFinishedItem error:", err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

// recordProduction: converts raw materials into finished stock of this SFI.
// Fixed (per explicit sign-off) vs. the source: the original silently skips
// a missing StockInHand row for a BOM line with no guard at all elsewhere
// in this flow; here every line requires a real stock row up front (400,
// named) before any writes happen, so a production run either fully
// succeeds or fully no-ops - never partially consumes some ingredients and
// not others.
const recordProduction = async (req, res) => {
    const t = await sequelize.transaction();
    try {
        const { semi_finished_item_id, produced_qty, notes } = req.body;
        const hotel_id = req.user;
        const userId = req.userId || null;

        if (!semi_finished_item_id || !(Number(produced_qty) > 0)) {
            await t.rollback();
            return res.json(error("semi_finished_item_id and produced_qty (> 0) are required", STATUSCODE.BAD_REQUEST));
        }
        const item = await SemiFinishedItem.findOne({ where: { id: semi_finished_item_id, hotel_id }, transaction: t });
        if (!item) {
            await t.rollback();
            return res.json(error("Semi-finished item not found", STATUSCODE.NOT_FOUND));
        }
        const bom = await SemiFinishedRecipe.findAll({
            where: { semi_finished_item_id, hotel_id },
            include: { model: RawMaterial, as: "rawMaterial" },
            transaction: t,
        });
        if (!bom.length) {
            await t.rollback();
            return res.json(error("No recipe defined for this item - add ingredients first", STATUSCODE.BAD_REQUEST));
        }

        const { StockInHand, RawMaterialConsumption } = require("../model");
        const { applyStockMovement, applySemiFinishedMovement } = require("../../engine/stockLedger");
        // Check every ingredient first, so nothing is used up for a batch
        // that can't be made.
        for (const line of bom) {
            const conversionQty = Number(line.rawMaterial?.conversion_qty) || 1;
            const needed = (Number(line.consumption_qty) * Number(produced_qty)) / conversionQty;
            const stock = await StockInHand.findOne({ where: { raw_material_id: line.raw_material_id, hotel_id, deleted: false }, transaction: t });
            if (needed > (Number(stock?.qty) || 0) + 1e-9) {
                await t.rollback();
                return res.json(error(`Not enough "${line.rawMaterial?.raw_material_name}" in stock for this batch`, STATUSCODE.BAD_REQUEST));
            }
        }
        let totalCost = 0;
        for (const line of bom) {
            const consumeQty = Number(line.consumption_qty) * Number(produced_qty);
            const conversionQty = Number(line.rawMaterial?.conversion_qty) || 1;
            const { unitCost } = await applyStockMovement({
                hotel_id, raw_material_id: line.raw_material_id, qty: -(consumeQty / conversionQty), type: "production_use",
                ref_type: "semi_finished", ref_id: Number(semi_finished_item_id), note: `Made ${produced_qty} ${item.name}`, user_id: userId, t,
            });
            const cost = (consumeQty / conversionQty) * unitCost;
            totalCost += cost;
            await RawMaterialConsumption.create({
                hotel_id, raw_material_id: line.raw_material_id,
                required_qty: consumeQty, consumed_qty: consumeQty,
                purpose: "RECIPE", status: "CONSUMED", cost,
                notes: `SFI Production: ${item.name}${notes ? " - " + notes : ""}`,
                user_id: userId,
            }, { transaction: t });
        }

        await applySemiFinishedMovement({
            hotel_id, semi_finished_item_id: Number(semi_finished_item_id), qty: Number(produced_qty), type: "production",
            unit_cost: Number(produced_qty) > 0 ? totalCost / Number(produced_qty) : 0,
            ref_type: "semi_finished", ref_id: Number(semi_finished_item_id), note: notes || "", user_id: userId, t,
        });

        await t.commit();
        return res.json(success(MESSAGE.SUCCESS, { produced_qty, raw_material_cost: totalCost.toFixed(2) }, STATUSCODE.SUCCESS));
    } catch (err) {
        await t.rollback();
        console.error("[semiFinished] recordProduction error:", err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

module.exports = {
    getAllSemiFinishedItems, getSingleSemiFinishedItem, getAllSFINames, getSFIStockLevels,
    addSemiFinishedItem, editSemiFinishedItem, deleteSemiFinishedItem, recordProduction,
};
