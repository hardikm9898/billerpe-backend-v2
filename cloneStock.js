
const { Op } = require("sequelize");
const {
    Unit,
    RawMaterial,
    Recipes,
    Menu,
    Variants,
    Addons,
    sequelize
} = require("./model");


/**
 * Clone STOCK setup from one restaurant to another.
 *
 * Clones ONLY:  Units  ➜  Raw Materials  ➜  Recipes
 *
 * ⚠️ IMPORTANT about recipes:
 *   A recipe row references menu_id / variant_id / addon_id / raw_material_id.
 *   Those ids belong to the OLD hotel and are useless in the NEW hotel.
 *   So before inserting a recipe we re-map every reference to the NEW hotel:
 *     - menu_id        -> matched by (item_name + shortCode) in NEW hotel
 *     - variant_id     -> matched by variants_name in NEW hotel
 *     - addon_id       -> matched by addon_name in NEW hotel
 *     - raw_material_id-> taken from the raw materials we just cloned
 *
 *   ➜ Run cloneMenu() FIRST so the NEW hotel already has its menu / variants / addons.
 *
 * NOTE: Semi-finished-item recipes are skipped (semi-finished items are out of
 *       scope for this stock clone). A count of skipped rows is logged.
 */
async function cloneStock() {

    const OLD_HOTEL = 0;   // 👈 source restaurant id
    const NEW_HOTEL = 0;   // 👈 target restaurant id
//  const OLD_HOTEL = 362
    // const NEW_HOTEL = 401
    if (OLD_HOTEL === NEW_HOTEL) {
        console.log("⛔ OLD_HOTEL and NEW_HOTEL are the same. Set different hotel ids before running.");
        return;
    }

    const transaction = await sequelize.transaction();

    try {
        // 🗑️ 0️⃣ Delete existing stock data of NEW_HOTEL (clean target first)
        await Recipes.destroy({ where: { hotel_id: NEW_HOTEL }, transaction });
        await RawMaterial.destroy({ where: { hotel_id: NEW_HOTEL }, transaction });
        await Unit.destroy({ where: { hotel_id: NEW_HOTEL }, transaction });

        const unitMap = {};          // oldUnitId        -> newUnitId
        const rawMaterialMap = {};   // oldRawMaterialId -> newRawMaterialId


        // 1️⃣ Clone Units
        const units = await Unit.findAll({
            where: { hotel_id: OLD_HOTEL },
            transaction
        });

        for (const u of units) {
            const newU = await Unit.create({
                hotel_id: NEW_HOTEL,
                unit_name: u.unit_name,
                shortName: u.shortName
            }, { transaction });

            unitMap[u.id] = newU.id;
        }


        // 2️⃣ Clone Raw Materials (re-map the three unit foreign keys)
        const rawMaterials = await RawMaterial.findAll({
            where: { hotel_id: OLD_HOTEL },
            transaction
        });

        for (const r of rawMaterials) {
            const newR = await RawMaterial.create({
                hotel_id: NEW_HOTEL,
                raw_material_name: r.raw_material_name,
                purchase_price: r.purchase_price,
                conversion_qty: r.conversion_qty,
                mini_stock_level: r.mini_stock_level,
                mini_stock_level_qty: r.mini_stock_level_qty,
                minimum_stock_level: r.minimum_stock_level,

                // unit foreign keys -> remap to the new hotel's units
                unit_id: unitMap[r.unit_id] || null,
                consumption_unit: unitMap[r.consumption_unit] || null,
                minimum_stock_level_unit: unitMap[r.minimum_stock_level_unit] || null
            }, { transaction });

            rawMaterialMap[r.id] = newR.id;
        }


        // 3️⃣ Build OLD ➜ NEW maps for menu / variant / addon (needed by recipes)

        // ---- Menu map (key = item_name + shortCode) ----
        const oldMenus = await Menu.findAll({ where: { hotel_id: OLD_HOTEL }, transaction });
        const newMenus = await Menu.findAll({ where: { hotel_id: NEW_HOTEL }, transaction });

        const menuKey = (m) => `${(m.item_name || "").trim().toLowerCase()}||${(m.shortCode || "").trim().toLowerCase()}`;

        const newMenuByKey = {};
        for (const m of newMenus) newMenuByKey[menuKey(m)] = m.id;

        const menuMap = {}; // oldMenuId -> newMenuId
        for (const m of oldMenus) {
            const matched = newMenuByKey[menuKey(m)];
            if (matched) menuMap[m.id] = matched;
        }

        // ---- Variant map (key = variants_name) ----
        // Variants have hotel_id via association (FK column on hms_variant_mst).

        const oldVariants = await Variants.findAll({ where: { hotel_id: OLD_HOTEL }, transaction });
        const newVariants = await Variants.findAll({ where: { hotel_id: NEW_HOTEL }, transaction });

        const newVariantByName = {};
        for (const v of newVariants) newVariantByName[(v.variants_name || "").trim().toLowerCase()] = v.id;

        const variantMap = {}; // oldVariantId -> newVariantId
        for (const v of oldVariants) {
            const matched = newVariantByName[(v.variants_name || "").trim().toLowerCase()];
            if (matched) variantMap[v.id] = matched;
        }

        // ---- Addon map (key = addon_name) ----
        const oldAddons = await Addons.findAll({ where: { hotel_id: OLD_HOTEL }, transaction });
        const newAddons = await Addons.findAll({ where: { hotel_id: NEW_HOTEL }, transaction });

        const newAddonByName = {};
        for (const a of newAddons) newAddonByName[(a.addon_name || "").trim().toLowerCase()] = a.id;

        const addonMap = {}; // oldAddonId -> newAddonId
        for (const a of oldAddons) {
            const matched = newAddonByName[(a.addon_name || "").trim().toLowerCase()];
            if (matched) addonMap[a.id] = matched;
        }


        // 4️⃣ Clone Recipes (with full re-mapping to NEW hotel)
        const recipes = await Recipes.findAll({
            where: { hotel_id: OLD_HOTEL },
            transaction
        });

        let cloned = 0;
        let skippedNoMenu = 0;
        let skippedSemiFinished = 0;
        let skippedNoRawMaterial = 0;

        for (const rec of recipes) {

            // Semi-finished recipes are out of scope for stock clone
            if (rec.semi_finished_item_id && !rec.raw_material_id) {
                skippedSemiFinished++;
                continue;
            }

            // menu_id MUST resolve to the NEW hotel's menu
            const newMenuId = menuMap[rec.menu_id];
            if (!newMenuId) {
                skippedNoMenu++;
                continue;
            }

            // raw_material_id MUST resolve to a just-cloned raw material
            const newRawMaterialId = rawMaterialMap[rec.raw_material_id];
            if (!newRawMaterialId) {
                skippedNoRawMaterial++;
                continue;
            }

            await Recipes.create({
                hotel_id: NEW_HOTEL,
                menu_id: newMenuId,
                variant_id: rec.variant_id ? (variantMap[rec.variant_id] || null) : null,
                addon_id: rec.addon_id ? (addonMap[rec.addon_id] || null) : null,
                raw_material_id: newRawMaterialId,
                semi_finished_item_id: null,
                consumption_qty: rec.consumption_qty
            }, { transaction });

            cloned++;
        }


        await transaction.commit();

        console.log("✅ Stock Clone Completed Successfully");
        console.log(`   Units cloned         : ${units.length}`);
        console.log(`   Raw materials cloned : ${rawMaterials.length}`);
        console.log(`   Recipes cloned       : ${cloned}`);
        console.log(`   Recipes skipped      : noMenuMatch=${skippedNoMenu}, noRawMaterial=${skippedNoRawMaterial}, semiFinished=${skippedSemiFinished}`);

    } catch (err) {
        await transaction.rollback();
        console.log("❌ Stock Clone Failed:", err);
    }
}


cloneStock();
