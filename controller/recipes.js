const sequelize = require("../connection/connect")
const { STATUSCODE, MESSAGE, } = require("../constant/const")
const { error, success } = require("../responce/res")
const Menu = require("../model/menu")
const Recipes = require("../model/recipes")
const RawMaterial = require("../model/rawItem")
const Hotel = require("../model/hotel")
const Unit = require("../model/unit")
const StockInHand = require("../model/stockInHand")
const OrderDetails = require("../model/order_details")
const RawMaterialConsumption = require("../model/Inventory/RawMaterialcon")
const SemiFinishedItem = require("../model/semiFinishedItem")
const SemiFinishedStock = require("../model/semiFinishedStock")
const { updateMenuToRadis } = require("./redis/redisCrud")
const { Variants, Addons, MenuVariants } = require("../model")
const { Op } = require("sequelize")
const { all } = require("axios")


const convertMenuWise = async (hotel_id) => {

    let data = await Recipes.findAll({
        where: { hotel_id },
        include: { model: Menu, as: "menu", attributes: ["item_name"], raw: true },
        attributes: ["menu_id", "createdAt", "updatedAt"],
    })
    data = JSON.stringify(data);
    data = JSON.parse(data);

    function getUnique(arr) {
        let mapObj = new Map()
        arr.forEach(v => {
            let prevValue = mapObj.get(v.menu_id)
            if (!prevValue) {
                mapObj.set(v.menu_id, v)
            }
        })
        return [...mapObj.values()]
    }
    return getUnique(data);
};
const addRecipes = async (req, res) => {
    const transaction = await sequelize.transaction();

    try {
        const hotel_id = req.user;
        const { menu_id, variant_id = null, addon_id = null, raw_material_data } = req.body;

        // ✅ Input validation
        if (!menu_id || !Array.isArray(raw_material_data) || raw_material_data.length === 0) {
            await transaction.rollback();
            return res.status(400).json(
                error("Invalid input: menu_id and raw_material_data are required", 400)
            );
        }

        // Each ingredient must have EITHER raw_material_id OR semi_finished_item_id (not both, not neither)
        for (const item of raw_material_data) {
            const hasRaw = item.raw_material_id && Number(item.raw_material_id) > 0;
            const hasSFI = item.semi_finished_item_id && Number(item.semi_finished_item_id) > 0;

            if (!hasRaw && !hasSFI) {
                await transaction.rollback();
                return res.status(400).json(
                    error("Each ingredient needs raw_material_id or semi_finished_item_id", 400)
                );
            }
            if (hasRaw && hasSFI) {
                await transaction.rollback();
                return res.status(400).json(
                    error("Ingredient cannot have both raw_material_id and semi_finished_item_id", 400)
                );
            }
            if (!item.consumption_qty || Number(item.consumption_qty) <= 0) {
                await transaction.rollback();
                return res.status(400).json(error("consumption_qty must be greater than 0", 400));
            }
        }

        // 1️⃣ Hotel check
        const hotel = await Hotel.findByPk(hotel_id);
        if (!hotel) {
            await transaction.rollback();
            return res.status(404).json(error("Hotel not found", 404));
        }

        // 2️⃣ Menu check
        const menu = await Menu.findOne({ where: { id: menu_id, hotel_id }, transaction });
        if (!menu) {
            await transaction.rollback();
            return res.status(404).json(error("Menu item not found", 404));
        }

        // 3️⃣ Validate variant if provided
        if (variant_id) {
            const variant = await MenuVariants.findOne({ where: { variant_id, menu_id }, transaction });
            if (!variant) {
                await transaction.rollback();
                return res.status(404).json(error("Variant not found", 404));
            }
        }

        // 4️⃣ Validate addon if provided
        if (addon_id) {
            const addon = await Addons.findOne({ where: { id: addon_id }, transaction });
            if (!addon) {
                await transaction.rollback();
                return res.status(404).json(error("Addon not found", 404));
            }
        }

        // 5️⃣ Check if recipe already exists for this combination
        const existingRecipe = await Recipes.findOne({ where: { hotel_id, menu_id, variant_id, addon_id }, transaction });
        if (existingRecipe) {
            await transaction.rollback();
            return res.status(409).json(error("Recipe already exists for this combination. Use edit instead.", 409));
        }

        // 6️⃣ Validate raw materials
        const rawMaterialIds = raw_material_data.filter(i => i.raw_material_id).map(i => i.raw_material_id);
        if (rawMaterialIds.length > 0) {
            const rawMaterials = await RawMaterial.findAll({ where: { id: { [Op.in]: rawMaterialIds }, hotel_id }, transaction });
            if (rawMaterials.length !== rawMaterialIds.length) {
                await transaction.rollback();
                return res.status(404).json(error("One or more raw materials not found", 404));
            }
        }

        // 6b️⃣ Validate semi-finished items
        const sfiIds = raw_material_data.filter(i => i.semi_finished_item_id).map(i => i.semi_finished_item_id);
        if (sfiIds.length > 0) {
            const sfis = await SemiFinishedItem.findAll({ where: { id: { [Op.in]: sfiIds }, hotel_id }, transaction });
            if (sfis.length !== sfiIds.length) {
                await transaction.rollback();
                return res.status(404).json(error("One or more semi-finished items not found", 404));
            }
        }

        // 7️⃣ Bulk insert recipes
        const recipesToCreate = raw_material_data.map(item => ({
            hotel_id,
            menu_id,
            variant_id,
            addon_id,
            raw_material_id: item.raw_material_id || null,
            semi_finished_item_id: item.semi_finished_item_id || null,
            consumption_qty: item.consumption_qty
        }));

        await Recipes.bulkCreate(recipesToCreate, { transaction, validate: true });

        // 8️⃣ Enable stock tracking
        if (!menu.stockTrack) {
            await Menu.update({ stockTrack: true }, { where: { id: menu_id, hotel_id }, transaction });
        }

        await transaction.commit();
        await updateMenuToRadis(menu_id, hotel_id);

        return res.status(201).json(success("Recipe added successfully", { menu_id, variant_id, addon_id, items_added: raw_material_data.length }, 201));

    } catch (err) {
        await transaction.rollback();
        if (err.name === "SequelizeUniqueConstraintError") {
            return res.status(409).json(error("Duplicate recipe entry detected", 409));
        }
        console.error("Error in addRecipes:", err);
        return res.status(500).json(error("Internal server error", 500));
    }
};

const editRecipes = async (req, res) => {
    const transaction = await sequelize.transaction();

    try {
        const hotel_id = req.user;
        const {
            menu_id,
            variant_id = null,
            addon_id = null,
            raw_material_data
        } = req.body;

        // ✅ Input validation
        if (!menu_id || !Array.isArray(raw_material_data) || raw_material_data.length === 0) {
            await transaction.rollback();
            return res.status(400).json(error("Invalid input: menu_id and raw_material_data are required", 400));
        }

        for (const item of raw_material_data) {
            const hasRaw = item.raw_material_id && Number(item.raw_material_id) > 0;
            const hasSFI = item.semi_finished_item_id && Number(item.semi_finished_item_id) > 0;
            if (!hasRaw && !hasSFI) {
                await transaction.rollback();
                return res.status(400).json(error("Each ingredient needs raw_material_id or semi_finished_item_id", 400));
            }
            if (hasRaw && hasSFI) {
                await transaction.rollback();
                return res.status(400).json(error("Ingredient cannot have both raw_material_id and semi_finished_item_id", 400));
            }
            if (!item.consumption_qty || Number(item.consumption_qty) <= 0) {
                await transaction.rollback();
                return res.status(400).json(error("consumption_qty must be greater than 0", 400));
            }
        }

        // 1️⃣ Hotel check
        const hotel = await Hotel.findByPk(hotel_id);
        if (!hotel) {
            await transaction.rollback();
            return res.status(404).json(error("Hotel not found", 404));
        }

        // 2️⃣ Menu check
        const menu = await Menu.findOne({ where: { id: menu_id, hotel_id }, transaction });
        if (!menu) {
            await transaction.rollback();
            return res.status(404).json(error("Menu not found", 404));
        }

        // 3️⃣ Check if recipe exists for this combination
        const existingRecipe = await Recipes.findOne({ where: { hotel_id, menu_id, variant_id, addon_id }, transaction });
        if (!existingRecipe) {
            await transaction.rollback();
            return res.status(404).json(error("Recipe not found for this combination. Use add instead.", 404));
        }

        // 4️⃣ Validate raw materials
        const rawMaterialIds = raw_material_data.filter(i => i.raw_material_id).map(i => i.raw_material_id);
        if (rawMaterialIds.length > 0) {
            const rawMaterials = await RawMaterial.findAll({ where: { id: { [Op.in]: rawMaterialIds }, hotel_id }, transaction });
            if (rawMaterials.length !== rawMaterialIds.length) {
                await transaction.rollback();
                return res.status(404).json(error("One or more raw materials not found", 404));
            }
        }

        // 4b️⃣ Validate semi-finished items
        const sfiIds = raw_material_data.filter(i => i.semi_finished_item_id).map(i => i.semi_finished_item_id);
        if (sfiIds.length > 0) {
            const sfis = await SemiFinishedItem.findAll({ where: { id: { [Op.in]: sfiIds }, hotel_id }, transaction });
            if (sfis.length !== sfiIds.length) {
                await transaction.rollback();
                return res.status(404).json(error("One or more semi-finished items not found", 404));
            }
        }

        // 5️⃣ Delete existing recipes for this combination
        const deletedCount = await Recipes.destroy({ where: { hotel_id, menu_id, variant_id, addon_id }, transaction });

        // 6️⃣ Bulk insert new recipes
        const recipesToCreate = raw_material_data.map(item => ({
            hotel_id,
            menu_id,
            variant_id,
            addon_id,
            raw_material_id: item.raw_material_id || null,
            semi_finished_item_id: item.semi_finished_item_id || null,
            consumption_qty: item.consumption_qty
        }));

        await Recipes.bulkCreate(recipesToCreate, { transaction, validate: true });

        await transaction.commit();

        // 7️⃣ Update Redis cache
        await updateMenuToRadis(menu_id, hotel_id);

        return res.status(200).json(
            success("Recipe updated successfully", {
                menu_id,
                variant_id,
                addon_id,
                deleted_items: deletedCount,
                added_items: raw_material_data.length
            }, 200)
        );

    } catch (err) {
        await transaction.rollback();

        if (err.name === "SequelizeUniqueConstraintError") {
            return res.status(409).json(
                error("Duplicate recipe detected", 409)
            );
        }

        console.error("Error in editRecipes:", err);
        return res.status(500).json(
            error("Internal server error", 500)
        );
    }
};

const getSingleRecipes = async (req, res) => {
    try {
        const hotel_id = req.user;
        const { menu_id } = req.query;

        if (!menu_id) {
            return res.status(400).json(
                error("menu_id is required", 400)
            );
        }

        const recipes = await Recipes.findAll({
            where: { menu_id, hotel_id },
            include: [
                {
                    model: RawMaterial,
                    as: "rawMaterial",
                    attributes: ['id', 'raw_material_name', 'purchase_price', 'conversion_qty'],
                    required: false,
                    include: [{ model: Unit, as: "consumptionUnit", attributes: ['unit_name'] }]
                },
                {
                    model: SemiFinishedItem,
                    as: "semiFinishedItem",
                    attributes: ['id', 'name'],
                    required: false,
                    include: [{ model: Unit, as: "unit", attributes: ['unit_name'] }]
                },
                {
                    model: Menu,
                    as: "menu",
                    attributes: ['id', 'item_name']
                },
                {
                    model: Variants,
                    as: "variant",
                    attributes: ['id', 'variants_name'],
                    required: false
                },
                {
                    model: Addons,
                    as: "addon",
                    attributes: ['id', 'addon_name'],
                    required: false
                }
            ],
            order: [['id', 'ASC']]
        });

        if (!recipes.length) {
            return res.status(404).json(
                error("No recipes found", 404)
            );
        }

        // ===============================
        // 🔁 GROUPING LOGIC
        // ===============================
        const variantMap = {};
        console.log("recipes", recipes);
        recipes.forEach(r => {
            const variantKey = r.variant_id || 'NO_VARIANT';

            if (!variantMap[variantKey]) {
                variantMap[variantKey] = {
                    variant_id: r.variant_id,
                    variant_name: r.variant?.variants_name || null,
                    estimatedCost: 0,
                    raw_materials: [],
                    addons: {}
                };
            }

            let unitCost = 0;
            let ingredientObj;

            if (r.rawMaterial) {
                unitCost = r.rawMaterial.purchase_price
                    ? (parseFloat(r.consumption_qty) / parseFloat(r.rawMaterial.conversion_qty)) * parseFloat(r.rawMaterial.purchase_price)
                    : 0;
                ingredientObj = {
                    ingredient_type: "raw_material",
                    raw_material_id: r.rawMaterial.id,
                    raw_material_name: r.rawMaterial.raw_material_name,
                    consumption_qty: parseFloat(r.consumption_qty),
                    consumption_unit: r.rawMaterial?.consumptionUnit?.unit_name,
                    unit_cost: parseFloat(unitCost.toFixed(2))
                };
            } else if (r.semiFinishedItem) {
                ingredientObj = {
                    ingredient_type: "semi_finished",
                    semi_finished_item_id: r.semiFinishedItem.id,
                    name: r.semiFinishedItem.name,
                    consumption_qty: parseFloat(r.consumption_qty),
                    consumption_unit: r.semiFinishedItem?.unit?.unit_name,
                    unit_cost: 0
                };
            } else {
                return; // skip malformed rows
            }

            const rawMaterialObj = ingredientObj;

            // 👉 ADDON LEVEL
            if (r.addon_id) {
                if (!variantMap[variantKey].addons[r.addon_id]) {
                    variantMap[variantKey].addons[r.addon_id] = {
                        addon_id: r.addon_id,
                        addon_name: r.addon?.addon_name,
                        estimatedCost: 0,
                        raw_materials: []
                    };
                }

                variantMap[variantKey].addons[r.addon_id].raw_materials.push(rawMaterialObj);
                variantMap[variantKey].addons[r.addon_id].estimatedCost += unitCost;
            }
            // 👉 BASE VARIANT / MENU
            else {
                variantMap[variantKey].raw_materials.push(rawMaterialObj);
                variantMap[variantKey].estimatedCost += unitCost;
            }
        });

        // ===============================
        // 🧹 FINAL CLEANUP
        // ===============================
        const variants = Object.values(variantMap).map(v => ({
            ...v,
            estimatedCost: parseFloat(v.estimatedCost.toFixed(2)),
            addons: Object.values(v.addons).map(a => ({
                ...a,
                estimatedCost: parseFloat(a.estimatedCost.toFixed(2))
            }))
        }));

        const responseData = {
            menu_id: recipes[0].menu.id,
            item_name: recipes[0].menu.item_name,
            has_variants: variants.some(v => v.variant_id !== null),
            variants
        };
        console.log("responseData", responseData);
        return res.status(200).json(
            success("Recipe fetched successfully", responseData, 200)
        );

    } catch (err) {
        console.error("getSingleRecipes error:", err);
        return res.status(500).json(
            error("Internal server error", 500)
        );
    }
};


const getAllRecipes = async (req, res) => {
    try {
        const hotel = await Hotel.findOne({ where: { id: req.user } })
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST))
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { recipes: await convertMenuWise(req.user) }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err)
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const getAllRecipesForMenu = async (req, res) => {
    try {
        const hotel_id = req.user;
        const { menu_id } = req.query;

        if (!menu_id) {
            return res.status(400).json(
                error("menu_id is required", 400)
            );
        }

        // Fetch all recipes for this menu
        const recipes = await Recipes.findAll({
            where: { menu_id, hotel_id },
            include: [
                {
                    model: RawMaterial,
                    as: "rawMaterial",
                    attributes: ['id', 'raw_material_name', 'purchase_price', 'conversion_qty'],
                    required: false,
                    include: [{ model: Unit, as: "consumptionUnit", attributes: ['unit_name'] }]
                },
                {
                    model: SemiFinishedItem,
                    as: "semiFinishedItem",
                    attributes: ['id', 'name'],
                    required: false,
                    include: [{ model: Unit, as: "unit", attributes: ['unit_name'] }]
                },
                {
                    model: Menu,
                    as: "menu",
                    attributes: ['id', 'item_name']
                }
            ],
            order: [['variant_id', 'ASC'], ['addon_id', 'ASC'], ['id', 'ASC']]
        });

        if (!recipes || recipes.length === 0) {
            return res.status(404).json(
                error("No recipes found for this menu", 404)
            );
        }

        // Group by variant_id and addon_id
        const groupedRecipes = {};

        recipes.forEach(recipe => {
            const key = `v${recipe.variant_id || 'null'}_a${recipe.addon_id || 'null'}`;

            if (!groupedRecipes[key]) {
                groupedRecipes[key] = {
                    variant_id: recipe.variant_id,
                    addon_id: recipe.addon_id,
                    raw_materials: []
                };
            }

            const ingredient = recipe.rawMaterial
                ? {
                    id: recipe.id,
                    ingredient_type: "raw_material",
                    raw_material_id: recipe.rawMaterial.id,
                    raw_material_name: recipe.rawMaterial.raw_material_name,
                    consumption_qty: parseFloat(recipe.consumption_qty),
                    consumption_unit: recipe.rawMaterial?.consumptionUnit?.unit_name
                }
                : {
                    id: recipe.id,
                    ingredient_type: "semi_finished",
                    semi_finished_item_id: recipe.semiFinishedItem?.id,
                    name: recipe.semiFinishedItem?.name,
                    consumption_qty: parseFloat(recipe.consumption_qty),
                    consumption_unit: recipe.semiFinishedItem?.unit?.unit_name
                };

            groupedRecipes[key].raw_materials.push(ingredient);
        });

        const responseData = {
            menu_id: recipes[0].menu?.id,
            item_name: recipes[0].menu?.item_name,
            recipes: Object.values(groupedRecipes)
        };

        return res.status(200).json(
            success("Recipes fetched successfully", responseData, 200)
        );

    } catch (err) {
        console.error("Error in getAllRecipesForMenu:", err);
        return res.status(500).json(
            error("Internal server error", 500)
        );
    }
};
const deleteRecipe = async (req, res) => {
    const transaction = await sequelize.transaction();

    try {
        const hotel_id = req.user;
        const { menu_id } = req.body;
        console.log()
        console.log("menu_id", menu_id);
        if (!menu_id) {
            await transaction.rollback();
            return res.status(400).json(
                error("menu_id is required", 400)
            );
        }

        // Check if recipes exist
        const existingRecipes = await Recipes.findAll({
            where: {
                hotel_id,
                menu_id,

            },
            transaction
        });

        if (!existingRecipes || existingRecipes.length === 0) {
            await transaction.rollback();
            return res.status(404).json(
                error("No recipes found for this combination", 404)
            );
        }

        // Delete recipes
        const deletedCount = await Recipes.destroy({
            where: {
                hotel_id,
                menu_id,

            },
            transaction
        });

        // Check if this was the last recipe for this menu
        const remainingRecipes = await Recipes.count({
            where: { menu_id, hotel_id },
            transaction
        });

        // If no recipes left, disable stock tracking
        if (remainingRecipes === 0) {
            await Menu.update(
                { stockTrack: false },
                { where: { id: menu_id, hotel_id }, transaction }
            );
        }

        await transaction.commit();

        // Update Redis cache
        await updateMenuToRadis(menu_id, hotel_id);

        return res.status(200).json(
            success("Recipe deleted successfully", {
                deleted_items: deletedCount,
                remaining_recipes: remainingRecipes
            }, 200)
        );

    } catch (err) {
        await transaction.rollback();
        console.error("Error in deleteRecipes:", err);
        return res.status(500).json(
            error("Internal server error", 500)
        );
    }
};


// const checkRawMaterialAvailableOrNot = async (id, hotel_id, user_id) => {
//     try {
//         // const raw_material_Data_need = []
//         const cart = await OrderDetails.findAll({ where: { orderId: id, hotel_id }, include: { model: Menu } })
//         for (const item of cart) {
//             if (item.status === "delivered") {

//                 if (item.hms_menu_mst.stockTrack) {
//                     let findRecipes = await Recipes.findAll({ where: { menu_id: item.MenuId }, include: { model: RawMaterial, as: "rawMaterial" } })
//                     findRecipes = JSON.stringify(findRecipes)
//                     findRecipes = JSON.parse(findRecipes)
//                     if (findRecipes.length) {
//                         for (const raw of findRecipes) {
//                             if (raw?.rawMaterial?.id) {
//                                 const stock = await StockInHand.findOne({ where: { raw_material_id: raw.rawMaterial.id, hotel_id } })
//                                 if (stock) {
//                                     const findRawMaterial = await RawMaterial.findOne({ where: { id: raw.rawMaterial.id, hotel_id } })
//                                     if (findRawMaterial) {

//                                         const available_stock_Consiompsion_qty = stock.available_stock_Consiompsion_qty - (+raw.consumption_qty * item.qty)
//                                         const qty = available_stock_Consiompsion_qty / raw.rawMaterial.conversion_qty
//                                         const total_amount = qty * stock.average_price
//                                         await StockInHand.update({ available_stock_Consiompsion_qty, qty: qty, total_amount }, { where: { raw_material_id: raw.rawMaterial.id, hotel_id, } })
//                                         await RawMaterialConsumption.create({ hotel_id: hotel_id, raw_material_id: raw.rawMaterial.id, order_id: id, unit_id: raw.rawMaterial.consumption_unit, user_id, qty: (+raw.consumption_qty * item.qty), purpose: "recipe", reference_type: "order", notes: "order taken", cost: (((+raw.consumption_qty * item.qty) / findRawMaterial.conversion_qty) * stock.average_price) })
//                                     }
//                                 } else {

//                                     const findRawMaterial = await RawMaterial.findOne({ where: { id: raw.rawMaterial.id, hotel_id } })
//                                     if (findRawMaterial) {
//                                         const available_stock_Consiompsion_qty = +raw.consumption_qty * item.qty
//                                         const qty = available_stock_Consiompsion_qty / raw.rawMaterial.conversion_qty
//                                         const total_amount = qty * findRawMaterial.purchase_price
//                                         await StockInHand.create({ average_price: findRawMaterial.purchase_price, price: findRawMaterial.purchase_price, available_stock_Consiompsion_qty: -available_stock_Consiompsion_qty, qty: -qty, total_amount: -total_amount, raw_material_id: raw.rawMaterial.id, hotel_id })
//                                         await RawMaterialConsumption.create({ hotel_id: hotel_id, raw_material_id: raw.rawMaterial.id, order_id: id, unit_id: raw.rawMaterial.consumption_unit, user_id, qty: (+raw.consumption_qty * item.qty), purpose: "recipe", reference_type: "order", notes: "order taken", cost: (((+raw.consumption_qty * item.qty) / findRawMaterial.conversion_qty) * findRawMaterial.purchase_price) })
//                                     }
//                                 }
//                             }
//                         }
//                     }

//                 }

//             }
//         }
//         return { error: false, message: "Stock Updated" }
//     } catch (err) {
//         console.log(err)
//         return { error: true, raw_material_Data_need: [], message: "Internal server error" }
//     }
// }

// externalTransaction: when the caller (e.g. settleBills) already has its
// own open transaction that has written to the same Order row this
// function's RawMaterialConsumption insert has a real FK constraint
// against (model/index.js: RawMaterialConsumption.belongsTo(Order, ...)),
// opening a SECOND, independent transaction here deadlocks against the
// caller's - the caller's transaction holds an exclusive lock on the
// Order row (e.g. settleBills's own `Order.update(..., {transaction: t})`
// a few lines before calling this), and this function's own transaction
// then blocks trying to acquire a shared lock on that same row for the
// FK check, while the caller is meanwhile blocked awaiting this call to
// return - a guaranteed lock-wait timeout (50s, confirmed live), not a
// timing fluke. Reusing the caller's transaction when one is passed in
// keeps everything on one transaction, so there's nothing to contend
// with. Standalone callers that don't pass one keep the original
// behavior (this function owns and finalizes its own transaction).
const checkRawMaterialAvailableOrNot = async (orderId, hotel_id, user_id, externalTransaction = null) => {
    const transaction = externalTransaction || await sequelize.transaction();
    const ownsTransaction = !externalTransaction;
    try {
        // 1️⃣ Fetch order items
        const cart = await OrderDetails.findAll({
            where: { orderId, hotel_id, status: "delivered" },
            include: [{ model: Menu }],
            transaction
        });

        if (!cart.length) {
            if (ownsTransaction) await transaction.commit();
            return { error: false, message: "No items to process" };
        }
        // console.log(cart, "Order Items")
        // 2️⃣ Collect menu IDs
        const menuIds = [...new Set(cart.map(i => i.MenuId))];

        // 3️⃣ Fetch all recipes once (include both RawMaterial and SemiFinishedItem)
        const allRecipes = await Recipes.findAll({
            where: { menu_id: menuIds, hotel_id },
            include: [
                { model: RawMaterial, as: "rawMaterial", required: false },
                { model: SemiFinishedItem, as: "semiFinishedItem", required: false }
            ],
            transaction
        });
        // console.log(allRecipes, "All Recipes")
        // 4️⃣ Group recipes by menu
        const recipeMap = {};
        for (const r of allRecipes) {
            if (!recipeMap[r.menu_id]) recipeMap[r.menu_id] = [];
            recipeMap[r.menu_id].push(r);
        }
        // console.log(recipeMap, "Recipe Map")
        // Helper: extract selected addons (qty > 0)
        const extractSelectedAddons = (addonsJson) => {
            if (!Array.isArray(addonsJson)) return [];
            const out = [];
            for (const dept of addonsJson) {
                if (!Array.isArray(dept.hms_addon_msts)) continue;
                for (const a of dept.hms_addon_msts) {
                    if (Number(a.qty) > 0 && a.id) {
                        out.push({
                            addon_id: Number(a.id),
                            qty: Number(a.qty),
                            addon_name: a.addon_name || null
                        });
                    }
                }
            }
            return out;
        };

        // 5️⃣ Aggregate required stock per raw material and per SFI
        const requiredStock = {};   // raw_material_id → qty
        const requiredSFI = {};     // semi_finished_item_id → qty
        const consumptionRows = [];

        for (const item of cart) {
            if (!item.hms_menu_mst?.stockTrack) continue;

            const selectedAddons = extractSelectedAddons(item.addons);
            const recipes = recipeMap[item.MenuId] || [];

            for (const r of recipes) {
                if (r.variant_id && r.variant_id !== item.variant_id) continue;

                let addonMultiplier = 1;
                let addonName = null;
                if (r.addon_id) {
                    const addon = selectedAddons.find(a => a.addon_id === r.addon_id);
                    if (!addon) continue;
                    addonMultiplier = addon.qty;
                    addonName = addon.addon_name;
                }

                const consumeQty = Number(r.consumption_qty) * Number(item.qty) * Number(addonMultiplier);

                if (r.raw_material_id && r.rawMaterial) {
                    // Raw material ingredient
                    if (!requiredStock[r.raw_material_id]) requiredStock[r.raw_material_id] = 0;
                    requiredStock[r.raw_material_id] += consumeQty;

                    consumptionRows.push({
                        hotel_id,
                        raw_material_id: r.raw_material_id,
                        cost: ((consumeQty / Number(r.rawMaterial.conversion_qty)) * Number(r.rawMaterial.purchase_price)),
                        order_id: orderId,
                        menu_id: item.MenuId,
                        variant_id: item.variant_id || null,
                        addon_id: r.addon_id || null,
                        required_qty: consumeQty,
                        consumed_qty: consumeQty,
                        purpose: "RECIPE",
                        status: "CONSUMED",
                        user_id,
                        notes: addonName ? `Addon: ${addonName}` : "Base recipe"
                    });
                } else if (r.semi_finished_item_id) {
                    // Semi-finished item ingredient
                    if (!requiredSFI[r.semi_finished_item_id]) requiredSFI[r.semi_finished_item_id] = 0;
                    requiredSFI[r.semi_finished_item_id] += consumeQty;
                }
            }
        }

        const hasRawStock = Object.keys(requiredStock).length > 0;
        const hasSFIStock = Object.keys(requiredSFI).length > 0;

        if (!hasRawStock && !hasSFIStock) {
            if (ownsTransaction) await transaction.commit();
            return { error: false, message: "No stock deduction required" };
        }

        // 6️⃣ Lock & update raw material stock
        if (hasRawStock) {
            const stocks = await StockInHand.findAll({
                where: { hotel_id, raw_material_id: Object.keys(requiredStock) },
                include: [{ model: RawMaterial }],
                lock: transaction.LOCK.UPDATE,
                transaction
            });

            const stockMap = {};
            for (const s of stocks) stockMap[s.raw_material_id] = s;

            for (const [rawId, qtyNeeded] of Object.entries(requiredStock)) {
                const stock = stockMap[rawId];
                if (!stock) continue;
                const newAvail = stock.available_stock_Consiompsion_qty - qtyNeeded;
                const newQty = newAvail / +stock.hms_rawMaterial_mst.conversion_qty;
                const total_amount = newQty * +stock.average_price;
                await stock.update({ available_stock_Consiompsion_qty: newAvail, qty: newQty, total_amount }, { transaction });
            }

            await RawMaterialConsumption.bulkCreate(consumptionRows, { transaction });
        }

        // 6b️⃣ Lock & update SFI stock
        if (hasSFIStock) {
            const sfiStocks = await SemiFinishedStock.findAll({
                where: { hotel_id, semi_finished_item_id: Object.keys(requiredSFI) },
                lock: transaction.LOCK.UPDATE,
                transaction
            });

            const sfiStockMap = {};
            for (const s of sfiStocks) sfiStockMap[s.semi_finished_item_id] = s;

            for (const [sfiId, qtyNeeded] of Object.entries(requiredSFI)) {
                const stock = sfiStockMap[sfiId];
                if (stock) {
                    const newQty = parseFloat(stock.available_qty) - qtyNeeded;
                    const newTotal = newQty * parseFloat(stock.cost_per_unit);
                    await stock.update({ available_qty: newQty, total_amount: newTotal }, { transaction });
                } else {
                    // No prior stock record — create with negative to mark deficit
                    await SemiFinishedStock.create({
                        hotel_id,
                        semi_finished_item_id: parseInt(sfiId),
                        available_qty: -qtyNeeded,
                        cost_per_unit: 0,
                        total_amount: 0
                    }, { transaction });
                }
            }
        }

        if (ownsTransaction) await transaction.commit();
        return { error: false, message: "Stock deducted successfully" };

    } catch (err) {
        console.error("Error in stock deduction:", err);
        if (ownsTransaction) await transaction.rollback();
        console.error("Stock deduction error:", err.message);
        return { error: true, message: err.message };
    }
};
const cancelOrderStock = async (orderId, hotel_id, user_id) => {
    const t = await sequelize.transaction();
    try {
        // 1️⃣ Reverse raw material consumption
        const consumptions = await RawMaterialConsumption.findAll({
            where: { order_id: orderId, hotel_id, status: "CONSUMED" },
            lock: t.LOCK.UPDATE,
            transaction: t
        });

        for (const c of consumptions) {
            const stock = await StockInHand.findOne({
                where: { raw_material_id: c.raw_material_id, hotel_id },
                lock: t.LOCK.UPDATE,
                transaction: t
            });

            if (stock) {
                const restoredQty = parseFloat(c.consumed_qty);
                const newAvail = parseFloat(stock.available_stock_Consiompsion_qty) + restoredQty;
                const rmConversionQty = stock.conversion_qty || 1;
                const newQty = newAvail / rmConversionQty;

                await stock.update({ available_stock_Consiompsion_qty: newAvail, qty: newQty }, { transaction: t });
            }

            await c.update({ status: "REVERSED", notes: "Order cancelled" }, { transaction: t });
        }

        // 2️⃣ Reverse SFI consumption — recompute from order items + recipes
        const cart = await OrderDetails.findAll({
            where: { orderId, hotel_id, status: "delivered" },
            include: [{ model: Menu }],
            transaction: t
        });

        if (cart.length) {
            const menuIds = [...new Set(cart.map(i => i.MenuId))];
            const sfiRecipes = await Recipes.findAll({
                where: { menu_id: menuIds, hotel_id, semi_finished_item_id: { [Op.not]: null } },
                transaction: t
            });

            const sfiRecipeMap = {};
            for (const r of sfiRecipes) {
                if (!sfiRecipeMap[r.menu_id]) sfiRecipeMap[r.menu_id] = [];
                sfiRecipeMap[r.menu_id].push(r);
            }

            const requiredSFI = {};
            const extractAddons = (addonsJson) => {
                if (!Array.isArray(addonsJson)) return [];
                const out = [];
                for (const dept of addonsJson) {
                    if (!Array.isArray(dept.hms_addon_msts)) continue;
                    for (const a of dept.hms_addon_msts) {
                        if (Number(a.qty) > 0 && a.id) out.push({ addon_id: Number(a.id), qty: Number(a.qty) });
                    }
                }
                return out;
            };

            for (const item of cart) {
                if (!item.hms_menu_mst?.stockTrack) continue;
                const selectedAddons = extractAddons(item.addons);
                const recipes = sfiRecipeMap[item.MenuId] || [];

                for (const r of recipes) {
                    if (r.variant_id && r.variant_id !== item.variant_id) continue;
                    let addonMultiplier = 1;
                    if (r.addon_id) {
                        const addon = selectedAddons.find(a => a.addon_id === r.addon_id);
                        if (!addon) continue;
                        addonMultiplier = addon.qty;
                    }
                    const consumeQty = Number(r.consumption_qty) * Number(item.qty) * Number(addonMultiplier);
                    if (!requiredSFI[r.semi_finished_item_id]) requiredSFI[r.semi_finished_item_id] = 0;
                    requiredSFI[r.semi_finished_item_id] += consumeQty;
                }
            }

            for (const [sfiId, restoreQty] of Object.entries(requiredSFI)) {
                const sfiStock = await SemiFinishedStock.findOne({
                    where: { semi_finished_item_id: sfiId, hotel_id },
                    lock: t.LOCK.UPDATE,
                    transaction: t
                });
                if (sfiStock) {
                    const newQty = parseFloat(sfiStock.available_qty) + restoreQty;
                    await sfiStock.update({ available_qty: newQty, total_amount: newQty * parseFloat(sfiStock.cost_per_unit) }, { transaction: t });
                }
            }
        }

        await t.commit();
        return { error: false, message: "Stock reversed successfully" };

    } catch (err) {
        await t.rollback();
        return { error: true, message: err.message };
    }
};
const editOrderItemStock = async ({
    order_id,
    order_item_id,
    hotel_id,
    user_id,
    old_qty,
    new_qty
}) => {
    const t = await sequelize.transaction();
    try {
        const deltaQty = new_qty - old_qty;
        if (deltaQty === 0) {
            await t.commit();
            return { error: false, message: "No change in quantity" };
        }

        // 1️⃣ Fetch existing consumption rows
        const consumptions = await RawMaterialConsumption.findAll({
            where: {
                order_id,
                order_item_id,
                hotel_id,
                status: "CONSUMED"
            },
            lock: t.LOCK.UPDATE,
            transaction: t
        });

        if (!consumptions.length) {
            throw new Error("No consumption data found for item");
        }

        for (const c of consumptions) {
            const perItemQty = c.consumed_qty / old_qty;
            const qtyChange = perItemQty * deltaQty;

            const stock = await StockInHand.findOne({
                where: {
                    raw_material_id: c.raw_material_id,
                    hotel_id
                },
                lock: t.LOCK.UPDATE,
                transaction: t
            });

            // Increase qty → consume more
            if (qtyChange > 0) {
                if (stock.available_stock_Consiompsion_qty < qtyChange) {
                    throw new Error("Insufficient stock");
                }

                await stock.update({
                    available_stock_Consiompsion_qty:
                        stock.available_stock_Consiompsion_qty - qtyChange,
                    qty:
                        (stock.available_stock_Consiompsion_qty - qtyChange) /
                        stock.conversion_qty
                }, { transaction: t });

                await c.update({
                    consumed_qty: c.consumed_qty + qtyChange
                }, { transaction: t });
            }

            // Decrease qty → restore stock
            if (qtyChange < 0) {
                const restoreQty = Math.abs(qtyChange);

                await stock.update({
                    available_stock_Consiompsion_qty:
                        stock.available_stock_Consiompsion_qty + restoreQty,
                    qty:
                        (stock.available_stock_Consiompsion_qty + restoreQty) /
                        stock.conversion_qty
                }, { transaction: t });

                await c.update({
                    consumed_qty: c.consumed_qty - restoreQty
                }, { transaction: t });
            }
        }

        await t.commit();
        return { error: false, message: "Order item updated successfully" };

    } catch (err) {
        await t.rollback();
        return { error: true, message: err.message };
    }
};
const getRawMaterialUsage = async (hotel_id, startDate, endDate) => {
    return sequelize.query(`
        SELECT raw_material_id, SUM(consumed_qty) AS total_used
        FROM hms_raw_material_consumption
        WHERE hotel_id = :hotel_id
        AND status = 'CONSUMED'
        AND createdAt BETWEEN :start AND :end
        GROUP BY raw_material_id
    `, {
        replacements: { hotel_id, start: startDate, end: endDate },
        type: sequelize.QueryTypes.SELECT
    });
};
const getItemCost = async (hotel_id) => {
    return sequelize.query(`
        SELECT menu_id, variant_id, addon_id, SUM(cost) AS total_cost
        FROM hms_raw_material_consumption
        WHERE hotel_id = :hotel_id
        AND status = 'CONSUMED'
        GROUP BY menu_id, variant_id, addon_id
    `, {
        replacements: { hotel_id },
        type: sequelize.QueryTypes.SELECT
    });
};
const getAddonWiseConsumption = async (hotel_id) => {
    return sequelize.query(`
        SELECT addon_id, raw_material_id, SUM(consumed_qty) AS total_consumed
        FROM hms_raw_material_consumption
        WHERE hotel_id = :hotel_id
        AND addon_id IS NOT NULL
        AND status = 'CONSUMED'
        GROUP BY addon_id, raw_material_id
    `, {
        replacements: { hotel_id },
        type: sequelize.QueryTypes.SELECT
    });
};

const getAvailableOrNot = async (data) => {

}
const removeInHandStock = async (data, hotel_id) => {
    try {

        const no_available_raw_material = []

        for (const menuData of data) {

            for (const raw_material of menuData.raw_material_data) {

                const stockAvailable = await StockInHand.findOne({ where: { raw_material_id: raw_material.raw_material_id, hotel_id } })
                if (stockAvailable) {

                    await StockInHand.update({})
                }

            }
        }


    } catch (err) {
        console.log(err)
        return { error: true, message: "Internal Server Error From removeInHandStock" }
    }
}
const addInHandStock = async () => {
    try {



    } catch (err) {
        console.log(err, "From addInHandStock ")
        return { error: true, message: "Internal Server Error From addInHandStock" }
    }
}

module.exports = { convertMenuWise, getAllRecipesForMenu, checkRawMaterialAvailableOrNot, deleteRecipe, getSingleRecipes, addRecipes, editRecipes, getAllRecipes }