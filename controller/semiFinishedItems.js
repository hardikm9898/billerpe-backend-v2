const sequelize = require("../connection/connect")
const { error, success } = require("../responce/res")
const SemiFinishedItem = require("../model/semiFinishedItem")
const SemiFinishedRecipe = require("../model/semiFinishedRecipe")
const SemiFinishedStock = require("../model/semiFinishedStock")
const RawMaterial = require("../model/rawItem")
const StockInHand = require("../model/stockInHand")
const RawMaterialConsumption = require("../model/Inventory/RawMaterialcon")
const Unit = require("../model/unit")
const { Op } = require("sequelize")

// ─────────────────────────────────────────────
// GET ALL semi-finished items with stock levels
// ─────────────────────────────────────────────
const getAllSemiFinishedItems = async (req, res) => {
    try {
        const hotel_id = req.user

        const items = await SemiFinishedItem.findAll({
            where: { hotel_id },
            include: [
                { model: Unit, as: "unit", attributes: ["unit_name"], required: false },
                { model: SemiFinishedStock, as: "stock", required: false }
            ],
            order: [["createdAt", "DESC"]]
        })

        return res.status(200).json(success("Semi-finished items fetched", items, 200))
    } catch (err) {
        console.error("getAllSemiFinishedItems error:", err)
        return res.status(500).json(error("Internal server error", 500))
    }
}

// ─────────────────────────────────────────────
// GET SINGLE semi-finished item with recipe + stock
// ─────────────────────────────────────────────
const getSingleSemiFinishedItem = async (req, res) => {
    try {
        const hotel_id = req.user
        const { id } = req.query

        if (!id) return res.status(400).json(error("id is required", 400))

        const item = await SemiFinishedItem.findOne({
            where: { id, hotel_id },
            include: [
                { model: Unit, as: "unit", attributes: ["unit_name"], required: false },
                { model: SemiFinishedStock, as: "stock", required: false }
            ]
        })

        if (!item) return res.status(404).json(error("Semi-finished item not found", 404))

        const recipes = await SemiFinishedRecipe.findAll({
            where: { semi_finished_item_id: id, hotel_id },
            include: [
                {
                    model: RawMaterial,
                    as: "rawMaterial",
                    attributes: ["id", "raw_material_name", "purchase_price", "conversion_qty"],
                    include: [{ model: Unit, as: "consumptionUnit", attributes: ["unit_name"] }]
                }
            ]
        })

        const itemJson = JSON.parse(JSON.stringify(item))
        itemJson.recipes = JSON.parse(JSON.stringify(recipes))

        return res.status(200).json(success("Fetched successfully", itemJson, 200))
    } catch (err) {
        console.error("getSingleSemiFinishedItem error:", err)
        return res.status(500).json(error("Internal server error", 500))
    }
}

// ─────────────────────────────────────────────
// ADD semi-finished item with its recipe
// ─────────────────────────────────────────────
const addSemiFinishedItem = async (req, res) => {
    const t = await sequelize.transaction()
    try {
        const hotel_id = req.user
        const { name, unit_id, min_stock_level = false, min_stock_qty = 0, recipes } = req.body

        if (!name || !name.trim()) {
            await t.rollback()
            return res.status(400).json(error("Name is required", 400))
        }
        if (!Array.isArray(recipes) || recipes.length === 0) {
            await t.rollback()
            return res.status(400).json(error("At least one recipe ingredient is required", 400))
        }

        for (const r of recipes) {
            if (!r.raw_material_id || !r.consumption_qty || Number(r.consumption_qty) <= 0) {
                await t.rollback()
                return res.status(400).json(error("Each ingredient needs raw_material_id and consumption_qty > 0", 400))
            }
        }

        // Validate all raw materials exist for this hotel
        const rawIds = recipes.map(r => r.raw_material_id)
        const rawMaterials = await RawMaterial.findAll({ where: { id: rawIds, hotel_id }, transaction: t })
        if (rawMaterials.length !== rawIds.length) {
            await t.rollback()
            return res.status(404).json(error("One or more raw materials not found", 404))
        }

        const item = await SemiFinishedItem.create(
            { hotel_id, name: name.trim(), unit_id: unit_id || null, min_stock_level, min_stock_qty },
            { transaction: t }
        )

        const recipeRows = recipes.map(r => ({
            hotel_id,
            semi_finished_item_id: item.id,
            raw_material_id: r.raw_material_id,
            consumption_qty: r.consumption_qty
        }))
        await SemiFinishedRecipe.bulkCreate(recipeRows, { transaction: t, validate: true })

        // Initialize stock record at zero
        await SemiFinishedStock.create(
            { hotel_id, semi_finished_item_id: item.id, available_qty: 0, cost_per_unit: 0, total_amount: 0 },
            { transaction: t }
        )

        await t.commit()
        return res.status(201).json(success("Semi-finished item created", { id: item.id }, 201))
    } catch (err) {
        await t.rollback()
        if (err.name === "SequelizeUniqueConstraintError") {
            return res.status(409).json(error("Duplicate ingredient in recipe", 409))
        }
        console.error("addSemiFinishedItem error:", err)
        return res.status(500).json(error("Internal server error", 500))
    }
}

// ─────────────────────────────────────────────
// EDIT semi-finished item details and/or recipe
// ─────────────────────────────────────────────
const editSemiFinishedItem = async (req, res) => {
    const t = await sequelize.transaction()
    try {
        const hotel_id = req.user
        const { id, name, unit_id, min_stock_level, min_stock_qty, recipes } = req.body

        if (!id) { await t.rollback(); return res.status(400).json(error("id is required", 400)) }

        const item = await SemiFinishedItem.findOne({ where: { id, hotel_id }, transaction: t })
        if (!item) { await t.rollback(); return res.status(404).json(error("Semi-finished item not found", 404)) }

        await item.update(
            {
                name: name ? name.trim() : item.name,
                unit_id: unit_id !== undefined ? (unit_id || null) : item.unit_id,
                min_stock_level: min_stock_level !== undefined ? min_stock_level : item.min_stock_level,
                min_stock_qty: min_stock_qty !== undefined ? min_stock_qty : item.min_stock_qty
            },
            { transaction: t }
        )

        if (Array.isArray(recipes) && recipes.length > 0) {
            for (const r of recipes) {
                if (!r.raw_material_id || !r.consumption_qty || Number(r.consumption_qty) <= 0) {
                    await t.rollback()
                    return res.status(400).json(error("Each ingredient needs raw_material_id and consumption_qty > 0", 400))
                }
            }

            const rawIds = recipes.map(r => r.raw_material_id)
            const rawMaterials = await RawMaterial.findAll({ where: { id: rawIds, hotel_id }, transaction: t })
            if (rawMaterials.length !== rawIds.length) {
                await t.rollback()
                return res.status(404).json(error("One or more raw materials not found", 404))
            }

            await SemiFinishedRecipe.destroy({ where: { semi_finished_item_id: id, hotel_id }, transaction: t })

            const recipeRows = recipes.map(r => ({
                hotel_id,
                semi_finished_item_id: id,
                raw_material_id: r.raw_material_id,
                consumption_qty: r.consumption_qty
            }))
            await SemiFinishedRecipe.bulkCreate(recipeRows, { transaction: t, validate: true })
        }

        await t.commit()
        return res.status(200).json(success("Updated successfully", {}, 200))
    } catch (err) {
        await t.rollback()
        if (err.name === "SequelizeUniqueConstraintError") {
            return res.status(409).json(error("Duplicate ingredient in recipe", 409))
        }
        console.error("editSemiFinishedItem error:", err)
        return res.status(500).json(error("Internal server error", 500))
    }
}

// ─────────────────────────────────────────────
// DELETE semi-finished item
// ─────────────────────────────────────────────
const deleteSemiFinishedItem = async (req, res) => {
    const t = await sequelize.transaction()
    try {
        const hotel_id = req.user
        const { id } = req.query

        if (!id) { await t.rollback(); return res.status(400).json(error("id is required", 400)) }

        const item = await SemiFinishedItem.findOne({ where: { id, hotel_id }, transaction: t })
        if (!item) { await t.rollback(); return res.status(404).json(error("Semi-finished item not found", 404)) }

        await SemiFinishedRecipe.destroy({ where: { semi_finished_item_id: id, hotel_id }, transaction: t })
        await SemiFinishedStock.destroy({ where: { semi_finished_item_id: id, hotel_id }, transaction: t })
        await SemiFinishedItem.destroy({ where: { id, hotel_id }, transaction: t })

        await t.commit()
        return res.status(200).json(success("Deleted successfully", {}, 200))
    } catch (err) {
        await t.rollback()
        console.error("deleteSemiFinishedItem error:", err)
        return res.status(500).json(error("Internal server error", 500))
    }
}

// ─────────────────────────────────────────────
// RECORD PRODUCTION — deducts raw material stock, adds to SFI stock
// ─────────────────────────────────────────────
const recordProduction = async (req, res) => {
    const t = await sequelize.transaction()
    try {
        const hotel_id = req.user
        const user_id = req.user_data?.id || null
        const { semi_finished_item_id, produced_qty, notes } = req.body

        if (!semi_finished_item_id || !produced_qty || Number(produced_qty) <= 0) {
            await t.rollback()
            return res.status(400).json(error("semi_finished_item_id and produced_qty > 0 are required", 400))
        }

        const item = await SemiFinishedItem.findOne({ where: { id: semi_finished_item_id, hotel_id }, transaction: t })
        if (!item) { await t.rollback(); return res.status(404).json(error("Semi-finished item not found", 404)) }

        const recipes = await SemiFinishedRecipe.findAll({
            where: { semi_finished_item_id, hotel_id },
            include: [{ model: RawMaterial, as: "rawMaterial" }],
            transaction: t
        })

        if (!recipes.length) {
            await t.rollback()
            return res.status(400).json(error("No recipe defined for this semi-finished item. Please add ingredients first.", 400))
        }

        let totalCost = 0

        for (const r of recipes) {
            const consumeQty = parseFloat(r.consumption_qty) * parseFloat(produced_qty)
            const rm = r.rawMaterial

            const stock = await StockInHand.findOne({
                where: { raw_material_id: r.raw_material_id, hotel_id },
                lock: t.LOCK.UPDATE,
                transaction: t
            })

            if (!stock) {
                await t.rollback()
                return res.status(400).json(error(`No stock record found for raw material: ${rm.raw_material_name}`, 400))
            }

            const newAvail = parseFloat(stock.available_stock_Consiompsion_qty) - consumeQty
            const newQty = newAvail / parseFloat(rm.conversion_qty)
            const newTotal = newQty * parseFloat(stock.average_price)
            const cost = (consumeQty / parseFloat(rm.conversion_qty)) * parseFloat(stock.average_price)
            totalCost += cost

            await stock.update(
                { available_stock_Consiompsion_qty: newAvail, qty: newQty, total_amount: newTotal },
                { transaction: t }
            )

            await RawMaterialConsumption.create({
                hotel_id,
                raw_material_id: r.raw_material_id,
                required_qty: consumeQty,
                consumed_qty: consumeQty,
                purpose: "RECIPE",
                status: "CONSUMED",
                cost,
                notes: `SFI Production: ${item.name}${notes ? " - " + notes : ""}`,
                user_id
            }, { transaction: t })
        }

        // Update SFI stock with weighted average cost
        const sfiStock = await SemiFinishedStock.findOne({
            where: { semi_finished_item_id, hotel_id },
            lock: t.LOCK.UPDATE,
            transaction: t
        })

        const newProducedQty = parseFloat(produced_qty)
        const costPerUnit = newProducedQty > 0 ? totalCost / newProducedQty : 0

        if (sfiStock) {
            const existingQty = parseFloat(sfiStock.available_qty)
            const existingTotal = existingQty * parseFloat(sfiStock.cost_per_unit)
            const combinedQty = existingQty + newProducedQty
            const combinedCostPerUnit = combinedQty > 0 ? (existingTotal + totalCost) / combinedQty : costPerUnit

            await sfiStock.update({
                available_qty: combinedQty,
                cost_per_unit: combinedCostPerUnit,
                total_amount: combinedQty * combinedCostPerUnit
            }, { transaction: t })
        } else {
            await SemiFinishedStock.create({
                hotel_id,
                semi_finished_item_id,
                available_qty: newProducedQty,
                cost_per_unit: costPerUnit,
                total_amount: totalCost
            }, { transaction: t })
        }

        await t.commit()
        return res.status(200).json(success("Production recorded. Stock updated.", {
            produced_qty: newProducedQty,
            raw_material_cost: parseFloat(totalCost.toFixed(2))
        }, 200))
    } catch (err) {
        await t.rollback()
        console.error("recordProduction error:", err)
        return res.status(500).json(error("Internal server error", 500))
    }
}

// ─────────────────────────────────────────────
// GET SFI stock levels — for stock alert dashboard
// ─────────────────────────────────────────────
const getSFIStockLevels = async (req, res) => {
    try {
        const hotel_id = req.user

        const stocks = await SemiFinishedStock.findAll({
            where: { hotel_id },
            include: [
                {
                    model: SemiFinishedItem,
                    as: "semiFinishedItem",
                    attributes: ["id", "name", "min_stock_level", "min_stock_qty"],
                    include: [{ model: Unit, as: "unit", attributes: ["unit_name"], required: false }]
                }
            ]
        })

        // Attach alert flag
        const result = JSON.parse(JSON.stringify(stocks)).map(s => ({
            ...s,
            is_low_stock: s.semiFinishedItem?.min_stock_level
                ? parseFloat(s.available_qty) < parseFloat(s.semiFinishedItem?.min_stock_qty || 0)
                : false
        }))

        return res.status(200).json(success("SFI stock levels fetched", result, 200))
    } catch (err) {
        console.error("getSFIStockLevels error:", err)
        return res.status(500).json(error("Internal server error", 500))
    }
}

// ─────────────────────────────────────────────
// GET SFI names list — for recipe ingredient dropdown
// ─────────────────────────────────────────────
const getAllSFINames = async (req, res) => {
    try {
        const hotel_id = req.user
        const items = await SemiFinishedItem.findAll({
            where: { hotel_id },
            attributes: ["id", "name"],
            include: [
                { model: Unit, as: "unit", attributes: ["unit_name"], required: false },
                { model: SemiFinishedStock, as: "stock", attributes: ["available_qty"], required: false }
            ],
            order: [["name", "ASC"]]
        })
        return res.status(200).json(success("SFI names fetched", items, 200))
    } catch (err) {
        console.error("getAllSFINames error:", err)
        return res.status(500).json(error("Internal server error", 500))
    }
}

module.exports = {
    getAllSemiFinishedItems,
    getSingleSemiFinishedItem,
    addSemiFinishedItem,
    editSemiFinishedItem,
    deleteSemiFinishedItem,
    recordProduction,
    getSFIStockLevels,
    getAllSFINames
}
