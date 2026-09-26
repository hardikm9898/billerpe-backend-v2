// COPY of billerpe-local-exe/controller/recipes.js for the POS App (Plan 2) -
// written by scripts/vendor-exe-for-appv1.py. Do not edit here: change the
// exe's file and re-run the script, so both plans keep the same rules.

const { sequelize, Hotel, Menu, MenuVariants, Variants, Addons, RawMaterial, SemiFinishedItem, Recipes, Unit } = require("../model");
const { MESSAGE, STATUSCODE } = require("../../../constant/const");
const { success, error } = require("../../../responce/res");

// Ported from uat-backend-v2/controller/recipes.js - CRUD only (the 6
// /recipes/* HTTP routes). The order-time stock deduction engine that also
// lives in that file (checkRawMaterialAvailableOrNot/cancelOrderStock/
// editOrderItemStock) is NOT part of this port - those are internal
// functions, never exposed as routes, and this EXE already has its own
// simplified equivalent (helpers/localStockDeduction.js +
// model/localRecipeMap.js). Changing that deduction path wasn't part of
// this task and isn't touched here.

function validateIngredients(raw_material_data) {
    if (!Array.isArray(raw_material_data) || raw_material_data.length === 0) {
        return "raw_material_data must be a non-empty array";
    }
    for (const item of raw_material_data) {
        const hasRaw = Number(item.raw_material_id) > 0;
        const hasSfi = Number(item.semi_finished_item_id) > 0;
        if (hasRaw === hasSfi) {
            return "Each ingredient needs exactly one of raw_material_id or semi_finished_item_id";
        }
        if (!(Number(item.consumption_qty) > 0)) {
            return "consumption_qty must be greater than 0 for every ingredient";
        }
    }
    return null;
}

const addRecipes = async (req, res) => {
    const t = await sequelize.transaction();
    try {
        const { menu_id, variant_id = null, addon_id = null, raw_material_data } = req.body;
        const hotel_id = req.user;

        if (!menu_id) {
            await t.rollback();
            return res.json(error("menu_id is required", STATUSCODE.BAD_REQUEST));
        }
        const ingredientError = validateIngredients(raw_material_data);
        if (ingredientError) {
            await t.rollback();
            return res.json(error(ingredientError, STATUSCODE.BAD_REQUEST));
        }

        const hotel = await Hotel.findByPk(hotel_id, { transaction: t });
        if (!hotel) {
            await t.rollback();
            return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.NOT_FOUND));
        }
        const menu = await Menu.findOne({ where: { id: menu_id, hotel_id }, transaction: t });
        if (!menu) {
            await t.rollback();
            return res.json(error("Menu item not found", STATUSCODE.BAD_REQUEST));
        }
        if (variant_id) {
            const variant = await MenuVariants.findOne({ where: { variant_id, menu_id }, transaction: t });
            if (!variant) {
                await t.rollback();
                return res.json(error("Variant not found for this menu item", STATUSCODE.BAD_REQUEST));
            }
        }
        if (addon_id) {
            const addon = await Addons.findOne({ where: { id: addon_id }, transaction: t });
            if (!addon) {
                await t.rollback();
                return res.json(error("Addon not found", STATUSCODE.BAD_REQUEST));
            }
        }

        const existing = await Recipes.findOne({ where: { hotel_id, menu_id, variant_id, addon_id }, transaction: t });
        if (existing) {
            await t.rollback();
            return res.json(error("Recipe already exists for this menu/variant/addon combination - use edit instead", STATUSCODE.CONFLICT));
        }

        const rawMaterialIds = raw_material_data.filter((i) => i.raw_material_id).map((i) => Number(i.raw_material_id));
        const sfiIds = raw_material_data.filter((i) => i.semi_finished_item_id).map((i) => Number(i.semi_finished_item_id));
        if (rawMaterialIds.length) {
            const count = await RawMaterial.count({ where: { id: rawMaterialIds, hotel_id }, transaction: t });
            if (count !== new Set(rawMaterialIds).size) {
                await t.rollback();
                return res.json(error("One or more raw materials not found", STATUSCODE.BAD_REQUEST));
            }
        }
        if (sfiIds.length) {
            const count = await SemiFinishedItem.count({ where: { id: sfiIds, hotel_id }, transaction: t });
            if (count !== new Set(sfiIds).size) {
                await t.rollback();
                return res.json(error("One or more semi-finished items not found", STATUSCODE.BAD_REQUEST));
            }
        }

        await Recipes.bulkCreate(
            raw_material_data.map((item) => ({
                hotel_id, menu_id, variant_id, addon_id,
                raw_material_id: item.raw_material_id || null,
                semi_finished_item_id: item.semi_finished_item_id || null,
                consumption_qty: item.consumption_qty,
            })),
            { transaction: t },
        );

        if (!menu.stockTrack) {
            await Menu.update({ stockTrack: true }, { where: { id: menu_id, hotel_id }, transaction: t });
        }

        await t.commit();
        return res.json(success(MESSAGE.SUCCESS, { message: "Recipe added" }, STATUSCODE.CREATED));
    } catch (err) {
        await t.rollback();
        if (err.name === "SequelizeUniqueConstraintError") {
            return res.json(error("Duplicate recipe entry detected", STATUSCODE.CONFLICT));
        }
        console.error("[recipes] addRecipes error:", err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

const editRecipes = async (req, res) => {
    const t = await sequelize.transaction();
    try {
        const { menu_id, variant_id = null, addon_id = null, raw_material_data } = req.body;
        const hotel_id = req.user;

        if (!menu_id) {
            await t.rollback();
            return res.json(error("menu_id is required", STATUSCODE.BAD_REQUEST));
        }
        const ingredientError = validateIngredients(raw_material_data);
        if (ingredientError) {
            await t.rollback();
            return res.json(error(ingredientError, STATUSCODE.BAD_REQUEST));
        }

        const existing = await Recipes.findOne({ where: { hotel_id, menu_id, variant_id, addon_id }, transaction: t });
        if (!existing) {
            await t.rollback();
            return res.json(error("Recipe not found for this menu/variant/addon combination - use add instead", STATUSCODE.NOT_FOUND));
        }

        const rawMaterialIds = raw_material_data.filter((i) => i.raw_material_id).map((i) => Number(i.raw_material_id));
        const sfiIds = raw_material_data.filter((i) => i.semi_finished_item_id).map((i) => Number(i.semi_finished_item_id));
        if (rawMaterialIds.length) {
            const count = await RawMaterial.count({ where: { id: rawMaterialIds, hotel_id }, transaction: t });
            if (count !== new Set(rawMaterialIds).size) {
                await t.rollback();
                return res.json(error("One or more raw materials not found", STATUSCODE.BAD_REQUEST));
            }
        }
        if (sfiIds.length) {
            const count = await SemiFinishedItem.count({ where: { id: sfiIds, hotel_id }, transaction: t });
            if (count !== new Set(sfiIds).size) {
                await t.rollback();
                return res.json(error("One or more semi-finished items not found", STATUSCODE.BAD_REQUEST));
            }
        }

        await Recipes.destroy({ where: { hotel_id, menu_id, variant_id, addon_id }, transaction: t });
        await Recipes.bulkCreate(
            raw_material_data.map((item) => ({
                hotel_id, menu_id, variant_id, addon_id,
                raw_material_id: item.raw_material_id || null,
                semi_finished_item_id: item.semi_finished_item_id || null,
                consumption_qty: item.consumption_qty,
            })),
            { transaction: t },
        );

        await t.commit();
        return res.json(success(MESSAGE.SUCCESS, { message: "Recipe updated" }, STATUSCODE.SUCCESS));
    } catch (err) {
        await t.rollback();
        if (err.name === "SequelizeUniqueConstraintError") {
            return res.json(error("Duplicate recipe entry detected", STATUSCODE.CONFLICT));
        }
        console.error("[recipes] editRecipes error:", err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

const deleteRecipe = async (req, res) => {
    try {
        const { menu_id } = req.body;
        const hotel_id = req.user;
        if (!menu_id) return res.json(error("menu_id is required", STATUSCODE.BAD_REQUEST));

        await Recipes.destroy({ where: { hotel_id, menu_id } });
        const remaining = await Recipes.count({ where: { hotel_id, menu_id } });
        if (remaining === 0) {
            await Menu.update({ stockTrack: false }, { where: { id: menu_id, hotel_id } });
        }
        return res.json(success(MESSAGE.SUCCESS, { message: "Recipe deleted" }, STATUSCODE.SUCCESS));
    } catch (err) {
        console.error("[recipes] deleteRecipe error:", err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

const getAllRecipes = async (req, res) => {
    try {
        const hotel_id = req.user;
        const hotel = await Hotel.findByPk(hotel_id);
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.NOT_FOUND));

        const rows = await Recipes.findAll({
            where: { hotel_id },
            include: { model: Menu, as: "menu", attributes: ["item_name"] },
            order: [["menu_id", "ASC"]],
        });
        const seen = new Set();
        const recipes = [];
        for (const r of rows) {
            if (seen.has(r.menu_id)) continue;
            seen.add(r.menu_id);
            recipes.push({ menu_id: r.menu_id, createdAt: r.createdAt, updatedAt: r.updatedAt, menu: r.menu });
        }
        return res.json(success(MESSAGE.SUCCESS, { recipes }, STATUSCODE.SUCCESS));
    } catch (err) {
        console.error("[recipes] getAllRecipes error:", err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

const getAllRecipesForMenu = async (req, res) => {
    try {
        const hotel_id = req.user;
        const { menu_id } = req.query;
        if (!menu_id) return res.json(error("menu_id is required", STATUSCODE.BAD_REQUEST));
        const rows = await Recipes.findAll({
            where: { hotel_id, menu_id },
            include: [
                { model: RawMaterial, as: "rawMaterial", include: [{ model: Unit, as: "consumptionUnit" }] },
                { model: SemiFinishedItem, as: "semiFinishedItem", include: [{ model: Unit, as: "unit" }] },
                { model: Menu, as: "menu" },
            ],
            order: [["variant_id", "ASC"], ["addon_id", "ASC"], ["id", "ASC"]],
        });
        if (!rows.length) return res.json(error("No recipe found for this menu item", STATUSCODE.NOT_FOUND));

        const groups = new Map();
        for (const r of rows) {
            const key = `v${r.variant_id || "null"}_a${r.addon_id || "null"}`;
            if (!groups.has(key)) groups.set(key, { variant_id: r.variant_id, addon_id: r.addon_id, raw_materials: [] });
            groups.get(key).raw_materials.push({
                id: r.id,
                ingredient_type: r.raw_material_id ? "raw_material" : "semi_finished",
                raw_material_id: r.raw_material_id,
                semi_finished_item_id: r.semi_finished_item_id,
                raw_material_name: r.rawMaterial?.raw_material_name,
                name: r.semiFinishedItem?.name,
                consumption_qty: Number(r.consumption_qty),
                consumption_unit: r.rawMaterial?.consumptionUnit?.unit_name || r.semiFinishedItem?.unit?.unit_name,
            });
        }
        return res.json(success(MESSAGE.SUCCESS, { groups: [...groups.values()] }, STATUSCODE.SUCCESS));
    } catch (err) {
        console.error("[recipes] getAllRecipesForMenu error:", err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

const getSingleRecipes = async (req, res) => {
    try {
        const hotel_id = req.user;
        const { menu_id } = req.query;
        const rows = await Recipes.findAll({
            where: { hotel_id, menu_id },
            include: [
                { model: RawMaterial, as: "rawMaterial", include: [{ model: Unit, as: "consumptionUnit" }] },
                { model: SemiFinishedItem, as: "semiFinishedItem", include: [{ model: Unit, as: "unit" }] },
                { model: Menu, as: "menu" },
                { model: Variants, as: "variant" },
                { model: Addons, as: "addon" },
            ],
            order: [["id", "ASC"]],
        });
        if (!rows.length) return res.json(error("No recipe found for this menu item", STATUSCODE.NOT_FOUND));

        const variantMap = new Map();
        for (const r of rows) {
            const key = r.variant_id ?? "NO_VARIANT";
            if (!variantMap.has(key)) {
                variantMap.set(key, {
                    variant_id: r.variant_id,
                    variant_name: r.variant?.variants_name,
                    estimatedCost: 0,
                    raw_materials: [],
                    addons: {},
                });
            }
            const group = variantMap.get(key);

            const unitCost = r.raw_material_id && r.rawMaterial?.purchase_price
                ? (Number(r.consumption_qty) / (r.rawMaterial.conversion_qty || 1)) * Number(r.rawMaterial.purchase_price)
                : 0;

            const ingredient = {
                id: r.id,
                ingredient_type: r.raw_material_id ? "raw_material" : "semi_finished",
                raw_material_id: r.raw_material_id,
                semi_finished_item_id: r.semi_finished_item_id,
                name: r.rawMaterial?.raw_material_name || r.semiFinishedItem?.name,
                consumption_qty: Number(r.consumption_qty),
                unit_cost: unitCost,
            };

            if (r.addon_id) {
                if (!group.addons[r.addon_id]) {
                    group.addons[r.addon_id] = { addon_id: r.addon_id, addon_name: r.addon?.addon_name, estimatedCost: 0, raw_materials: [] };
                }
                group.addons[r.addon_id].raw_materials.push(ingredient);
                group.addons[r.addon_id].estimatedCost += unitCost;
            } else {
                group.raw_materials.push(ingredient);
                group.estimatedCost += unitCost;
            }
        }

        const variants = [...variantMap.values()].map((v) => ({
            ...v,
            estimatedCost: Math.round(v.estimatedCost * 100) / 100,
            addons: Object.values(v.addons).map((a) => ({ ...a, estimatedCost: Math.round(a.estimatedCost * 100) / 100 })),
        }));

        return res.json(success(MESSAGE.SUCCESS, {
            menu_id: Number(menu_id),
            item_name: rows[0].menu?.item_name,
            has_variants: variants.some((v) => v.variant_id !== null),
            variants,
        }, STATUSCODE.SUCCESS));
    } catch (err) {
        console.error("[recipes] getSingleRecipes error:", err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

// PUT /recipes/saveRecipe - a dish's WHOLE recipe in one save: the base
// ingredients plus one group per variant ("Full") and per addon ("Extra
// cheese"). Replaces everything saved for the dish, so a group removed in
// the editor is removed here too. The Web POS recipe editor let you build
// variant and addon groups but saved only the base, silently dropping the
// rest - so a Full plate deducted the half-plate recipe and addons nothing.
// body: { menu_id, groups: [{ variant_id?, addon_id?, raw_material_data: [...] }] }
const saveRecipe = async (req, res) => {
    const t = await sequelize.transaction();
    try {
        const hotel_id = req.user;
        const menu_id = Number(req.body.menu_id);
        const groups = Array.isArray(req.body.groups) ? req.body.groups.filter((g) => Array.isArray(g.raw_material_data) && g.raw_material_data.length) : [];
        const fail = async (msg, code = STATUSCODE.BAD_REQUEST) => { await t.rollback(); return res.json(error(msg, code)); };
        if (!menu_id) return fail("menu_id is required");
        if (!groups.length) return fail("Add at least one ingredient to the recipe");
        const menu = await Menu.findOne({ where: { id: menu_id, hotel_id }, transaction: t });
        if (!menu) return fail("Menu item not found");

        const seen = new Set();
        for (const g of groups) {
            const variant_id = g.variant_id ? Number(g.variant_id) : null;
            const addon_id = g.addon_id ? Number(g.addon_id) : null;
            const key = `${variant_id}|${addon_id}`;
            if (seen.has(key)) return fail("The same variant/addon appears twice in this recipe");
            seen.add(key);
            const ingredientError = validateIngredients(g.raw_material_data);
            if (ingredientError) return fail(ingredientError);
            if (variant_id && !(await MenuVariants.findOne({ where: { variant_id, menu_id }, transaction: t }))) {
                return fail("That variant is not on this menu item");
            }
            if (addon_id && !(await Addons.findOne({ where: { id: addon_id }, transaction: t }))) return fail("Addon not found");
            const rawIds = g.raw_material_data.filter((i) => i.raw_material_id).map((i) => Number(i.raw_material_id));
            const sfiIds = g.raw_material_data.filter((i) => i.semi_finished_item_id).map((i) => Number(i.semi_finished_item_id));
            if (rawIds.length && (await RawMaterial.count({ where: { id: rawIds, hotel_id }, transaction: t })) !== new Set(rawIds).size) {
                return fail("One or more raw materials not found");
            }
            if (sfiIds.length && (await SemiFinishedItem.count({ where: { id: sfiIds, hotel_id }, transaction: t })) !== new Set(sfiIds).size) {
                return fail("One or more semi-finished items not found");
            }
        }

        await Recipes.destroy({ where: { hotel_id, menu_id }, transaction: t });
        await Recipes.bulkCreate(groups.flatMap((g) => g.raw_material_data.map((item) => ({
            hotel_id, menu_id,
            variant_id: g.variant_id ? Number(g.variant_id) : null,
            addon_id: g.addon_id ? Number(g.addon_id) : null,
            raw_material_id: item.raw_material_id || null,
            semi_finished_item_id: item.semi_finished_item_id || null,
            consumption_qty: item.consumption_qty,
        }))), { transaction: t });
        if (!menu.stockTrack) await Menu.update({ stockTrack: true }, { where: { id: menu_id, hotel_id }, transaction: t });

        await t.commit();
        return res.json(success(MESSAGE.SUCCESS, { message: "Recipe saved" }, STATUSCODE.SUCCESS));
    } catch (err) {
        await t.rollback().catch(() => {});
        console.error("[recipes] saveRecipe error:", err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

module.exports = { addRecipes, editRecipes, saveRecipe, deleteRecipe, getAllRecipes, getAllRecipesForMenu, getSingleRecipes };
