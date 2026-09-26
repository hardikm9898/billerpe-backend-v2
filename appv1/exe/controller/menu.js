// COPY of billerpe-local-exe/controller/menu.js for the POS App (Plan 2) -
// written by scripts/vendor-exe-for-appv1.py. Do not edit here: change the
// exe's file and re-run the script, so both plans keep the same rules.

const { Op } = require("sequelize");
const { sequelize, Hotel, Menu, Menu_categ, Variants, AddonDepartment, Addons, MenuVariants, MenuAddon } = require("../model");
const { MESSAGE, STATUSCODE } = require("../../../constant/const");
const { success, error } = require("../../../responce/res");
const moment = require("moment");

// Ported from uat-backend-v2/controller/menu.js's showMenu/showCatagories
// (Phase 3, read-only), with one real bug from the source NOT reproduced:
// the original showMenu calls `Menu.findAll({ hotel_id: user.hotel_id })`
// with no `where:` wrapper, which Sequelize silently ignores - it returns
// every hotel's menu, a cross-tenant leak in the cloud backend. Written
// correctly here (`where: { hotel_id }`) since this is new code, not a
// byte-for-byte port of the controller file the way model/index.js's
// associations were - unlike those two flagged association bugs, this one
// has no ambiguity about intent and no reason to reproduce it locally.
// Worth reporting back to fix in uat-backend-v2 itself, separately.
const showMenu = async (req, res) => {
    try {
        const hotel = await Hotel.findOne({ where: { id: req.user } });
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST));

        const menu = await Menu.findAll({ where: { hotel_id: req.user, active: true } });
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { menu }, STATUSCODE.SUCCESS));
    } catch (err) {
        console.error("[menu] showMenu error:", err);
        return res.status(STATUSCODE.INTERNAL_SERVER_ERROR).json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

const showCatagories = async (req, res) => {
    try {
        const { key } = req.params;
        const hotel = await Hotel.findOne({ where: { id: req.user } });
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST));

        let catagories;
        if (key === "all") {
            catagories = await Menu_categ.findAll({
                where: { hotel_id: req.user, active: true },
                include: { model: Menu, where: { active: true } },
            });
        } else {
            catagories = await Menu_categ.findAll({
                where: {
                    hotel_id: req.user,
                    menu_categ_nm: { [Op.like]: `%${key.toLowerCase()}%` },
                    active: true,
                },
            });
        }

        for (const iterator of catagories) {
            iterator.dataValues.createdAt = moment(iterator.createdAt).format("DD/MM/YYYY");
            iterator.dataValues.updatedAt = moment(iterator.updatedAt).format("DD/MM/YYYY");
        }

        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { catagories }, STATUSCODE.SUCCESS));
    } catch (err) {
        console.error("[menu] showCatagories error:", err);
        return res.status(STATUSCODE.INTERNAL_SERVER_ERROR).json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

// Ported from uat-backend-v2/controller/menu.js's getMenuItemsWithVariants
// (GET /menuShowWithVariants). Real, load-bearing endpoint - confirmed live
// during Phase 8 browser verification: billerpe-pos-pro-v2's
// loadMenuFromServer (mock/store.tsx) Promise.all's this alongside
// getCategories/getAllVariant/getAllAddons, so it (and the other two below)
// being unported took the whole menu/order screen down to stale mock data,
// same Promise.all failure pattern as getPickupOrder did for the table grid.
const getMenuItemsWithVariants = async (req, res) => {
    try {
        const hotel = await Hotel.findOne({ where: { id: req.user } });
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST));

        const menu = await Menu.findAll({
            where: { hotel_id: req.user, active: true },
            include: [
                { model: Menu_categ },
                { model: Variants, as: "variantData", where: { active: true }, required: false },
                { model: AddonDepartment, as: "addonDepartmentData", include: { model: Addons } },
            ],
        });
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { menu }, STATUSCODE.SUCCESS));
    } catch (err) {
        console.error("[menu] getMenuItemsWithVariants error:", err);
        return res.status(STATUSCODE.INTERNAL_SERVER_ERROR).json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

// Ported from uat-backend-v2/controller/menu.js's MenuShow (GET
// /menuShow/:key) - only the "all" branch, since billerpe-pos-pro-v2's
// menuApi.getItems always calls GET /menuShow/all, never with a real search
// key. Not the same handler as showMenu above (GET /menu, unused by the
// frontend) - MenuShow additionally includes Menu_categ on each row, which
// showMenu's cloud counterpart never did.
const menuShowAll = async (req, res) => {
    try {
        const hotel = await Hotel.findOne({ where: { id: req.user } });
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST));

        const menu = await Menu.findAll({
            where: { hotel_id: req.user, active: true },
            include: [{ model: Menu_categ }],
        });
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { menu }, STATUSCODE.SUCCESS));
    } catch (err) {
        console.error("[menu] menuShowAll error:", err);
        return res.status(STATUSCODE.INTERNAL_SERVER_ERROR).json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

// Ported from uat-backend-v2/controller/menu.js's createCatagories (POST
// /catagories). Redis cache calls (newMenuCategoryCreatedToRadis) dropped -
// no Redis on this EXE, same as every other ported write here.
const createCatagories = async (req, res) => {
    try {
        const hotel = await Hotel.findOne({ where: { id: req.user } });
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST));

        const categoryName = req?.body?.catagoriesFrom?.catagories_name || "";
        if (!categoryName) {
            return res.json(error("Please Enter  Valid Category Name", STATUSCODE.BAD_REQUEST));
        }

        const availableCatagories = await Menu_categ.findOne({
            where: { menu_categ_nm: categoryName, hotel_id: hotel.id, active: true },
        });
        if (availableCatagories) return res.json(error(MESSAGE.CATAGORIES_AVAILABLE, STATUSCODE.BAD_REQUEST));

        const findMaxRank = await Menu_categ.max("rank", { where: { hotel_id: req.user, active: true } });
        const catagories = {
            menu_categ_nm: categoryName,
            hotel_id: req.user,
            enter_by: hotel.hotel_name,
            rank: (findMaxRank || 0) + 1,
            ...(req.body.catagoriesFrom.menu_catalog_id ? { menu_catalog_id: req.body.catagoriesFrom.menu_catalog_id } : {}),
        };

        await Menu_categ.create(catagories);
        return res.status(STATUSCODE.CREATED).json(success(MESSAGE.SUCCESS, { message: MESSAGE.CATAGORIES_ADDED }, STATUSCODE.CREATED));
    } catch (err) {
        console.error("[menu] createCatagories error:", err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

// Ported from uat-backend-v2/controller/menu.js's editCatagories (POST
// /catagoriesEdit). No ownership lookup before the update, matching the
// cloud version exactly - harmless here since hotel_id is always req.user
// on a single-tenant local DB.
const editCatagories = async (req, res) => {
    try {
        const hotel = await Hotel.findOne({ where: { id: req.user } });
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST));

        const categoryName = req?.body?.editCatagoriesFrom?.menu_categ_nm || "";
        if (!categoryName) {
            return res.json(error("Please Enter  Valid Category Name", STATUSCODE.BAD_REQUEST));
        }

        await Menu_categ.update(
            {
                menu_categ_nm: categoryName,
                rank: +req?.body?.editCatagoriesFrom?.rank || 0,
                ...(req.body.editCatagoriesFrom.menu_catalog_id
                    ? { menu_catalog_id: req.body.editCatagoriesFrom.menu_catalog_id }
                    : {}),
            },
            { where: { id: req.body.editCatagoriesFrom.id, hotel_id: req.user } },
        );

        return res.status(STATUSCODE.CREATED).json(success(MESSAGE.SUCCESS, { message: MESSAGE.MENU_UPDATED }, STATUSCODE.SUCCESS));
    } catch (err) {
        console.error("[menu] editCatagories error:", err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

// Ported from uat-backend-v2/controller/menu.js's removeCatagories (POST
// /catagoriesRemove). Soft-delete only, and cascades to every item in the
// category (Menu.update active:false where menu_categ_id) - matches cloud
// exactly, including that this has no "category has items" guard here
// server-side (billerpe-pos-pro-v2's own removeMenuCategory already blocks
// that client-side before ever calling this).
const removeCatagories = async (req, res) => {
    try {
        const hotel = await Hotel.findOne({ where: { id: req.user } });
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST));

        const { allId } = req.body;
        if (allId) {
            for (const id of allId) {
                const availableCatagories = await Menu_categ.findOne({ where: { id, hotel_id: req.user } });
                if (!availableCatagories) return res.json(error(MESSAGE.MENU_NOT_FOUND, STATUSCODE.NOT_FOUND));
                await Menu_categ.update({ active: false }, { where: { id, hotel_id: req.user } });
                await Menu.update({ active: false }, { where: { menu_categ_id: id, hotel_id: req.user } });
            }
            return res.status(STATUSCODE.CREATED).json(success(MESSAGE.SUCCESS, { message: MESSAGE.CATAGORIES_DELETED }, STATUSCODE.SUCCESS));
        }

        const availableCatagories = await Menu_categ.findOne({ where: { id: req.body.id, hotel_id: req.user, active: true } });
        if (!availableCatagories) return res.json(error(MESSAGE.CATAGORIES_NOT_FOUND, STATUSCODE.NOT_FOUND));

        await Menu_categ.update({ active: false }, { where: { id: req.body.id, hotel_id: req.user } });
        await Menu.update({ active: false }, { where: { menu_categ_id: req.body.id, hotel_id: req.user } });

        return res.status(STATUSCODE.CREATED).json(success(MESSAGE.SUCCESS, { message: MESSAGE.CATAGORIES_DELETED }, STATUSCODE.SUCCESS));
    } catch (err) {
        console.error("[menu] removeCatagories error:", err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

// Ported from uat-backend-v2/controller/menu.js's createMenu (POST /menu).
// Redis cache calls dropped, same as every other write here. addons.length
// is read with no optional-chaining, deliberately matching the cloud
// exactly - billerpe-pos-pro-v2's MenuItemPayload always sends addons as an
// array (its own comment documents this contract), so this never actually
// throws in practice.
const createMenu = async (req, res) => {
    const t = await sequelize.transaction();
    try {
        const hotel = await Hotel.findOne({ where: { id: req.user } });
        if (!hotel) {
            await t.rollback();
            return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST));
        }

        const reqData = req.body;
        if (!reqData.item_name || !String(reqData.item_name).trim()) {
            await t.rollback();
            return res.json(error("Item name is required.", STATUSCODE.BAD_REQUEST));
        }
        if (!reqData.menu_categ_id) {
            await t.rollback();
            return res.json(error("Menu category ID is required.", STATUSCODE.BAD_REQUEST));
        }
        if (!(Number(reqData.price) > 0)) {
            await t.rollback();
            return res.json(error("Price must be greater than 0.", STATUSCODE.BAD_REQUEST));
        }
        if (!reqData.shortCode) {
            await t.rollback();
            return res.json(error("Short code is required.", STATUSCODE.BAD_REQUEST));
        }

        const availableSortCode = await Menu.findOne({ where: { shortCode: reqData.shortCode, hotel_id: req.user, active: true } });
        if (availableSortCode) {
            await t.rollback();
            return res.json(error(MESSAGE.SHORT_CODE_MUST_BE_UNIQUE, STATUSCODE.BAD_REQUEST));
        }
        const checkByName = await Menu.findOne({
            where: { item_name: reqData.item_name, menu_categ_id: reqData.menu_categ_id, hotel_id: req.user, active: true },
        });
        if (checkByName) {
            await t.rollback();
            return res.json(error("Item Name Already Available", STATUSCODE.BAD_REQUEST));
        }
        if (reqData.barcode_value) {
            const barcode = await Menu.findOne({ where: { barcode_value: reqData.barcode_value, hotel_id: req.user, active: true } });
            if (barcode) {
                await t.rollback();
                return res.json(error("Barcode already Available", STATUSCODE.BAD_REQUEST));
            }
        }
        const availableCatagories = await Menu_categ.findOne({ where: { id: reqData.menu_categ_id, hotel_id: req.user, active: true } });
        if (!availableCatagories) {
            await t.rollback();
            return res.json(error(MESSAGE.CATAGORIES_NOT_FOUND, STATUSCODE.NOT_FOUND));
        }

        const { variants, addons } = reqData;
        const menuData = {
            item_name: reqData.item_name,
            favorite: reqData.favorite,
            foodImage: reqData.imageUrl,
            menu_categ_id: availableCatagories.id,
            price: reqData.price,
            shortCode: reqData.shortCode,
            description: reqData.description,
            hotel_id: req.user,
            enter_by: hotel.hotel_name,
            sub_categories: reqData.sub_categories,
            gst_type: reqData.gst_type,
            barcode_value: reqData.barcode_value,
        };
        const menu = await Menu.create(menuData, { transaction: t });

        if (variants && variants.length) {
            for (const data of variants) {
                const { id, variant_price } = data;
                const variant = await Variants.findByPk(id, { transaction: t });
                const availableVariant = await MenuVariants.findOne({ where: { menu_id: menu.id, variant_id: id }, transaction: t });
                if (availableVariant) {
                    await t.rollback();
                    return res.json(error("Please Add Different Variant", STATUSCODE.BAD_REQUEST));
                }
                if (!variant) {
                    await t.rollback();
                    return res.json(error("Variant Not Found", STATUSCODE.BAD_REQUEST));
                }
                await MenuVariants.create(
                    { menu_id: menu.id, variant_id: id, variant_price, hotel_id: req.user },
                    { transaction: t },
                );
            }
        }
        if (addons.length) {
            for (const addon_department_id of addons) {
                const addonDepartMent = await AddonDepartment.findByPk(addon_department_id, { transaction: t });
                if (!addonDepartMent) {
                    await t.rollback();
                    return res.json(error("Addon Department Not Found", STATUSCODE.BAD_REQUEST));
                }
                await MenuAddon.create(
                    { menu_id: menu.id, addon_department_id, hotel_id: req.user, active: true },
                    { transaction: t },
                );
            }
        }

        await t.commit();
        return res.status(STATUSCODE.CREATED).json(success(MESSAGE.SUCCESS, { message: MESSAGE.MENU_ADDED }, STATUSCODE.CREATED));
    } catch (err) {
        await t.rollback();
        console.error("[menu] createMenu error:", err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

// Ported from uat-backend-v2/controller/menu.js's editMenu (POST /menuEdit).
// Fully replaces variant/addon links every save (destroy + recreate, never
// diffed) - matching the cloud exactly, and matching
// billerpe-pos-pro-v2's own documented expectation that it always sends the
// complete current list, not just newly-added entries.
const editMenu = async (req, res) => {
    const t = await sequelize.transaction();
    try {
        const hotel = await Hotel.findOne({ where: { id: req.user } });
        if (!hotel) {
            await t.rollback();
            return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST));
        }

        const reqData = req.body;
        if (!reqData.menu_categ_id) {
            await t.rollback();
            return res.json(error("Please Select Menu Category", STATUSCODE.BAD_REQUEST));
        }
        const availableCatagories = await Menu_categ.findOne({ where: { id: reqData.menu_categ_id, hotel_id: req.user, active: true } });
        if (!availableCatagories) {
            await t.rollback();
            return res.json(error("Menu Category Not FOund", STATUSCODE.BAD_REQUEST));
        }

        // A SKU names one item: editing another item onto it made the
        // billing search bring up two items for one code.
        // Only when the SKU changes: items saved without one got a code made
        // from their name, so older data can already share one.
        const current = await Menu.findOne({ where: { id: reqData.id, hotel_id: req.user }, attributes: ["shortCode"], transaction: t });
        if (reqData.shortCode && reqData.shortCode !== current?.shortCode) {
            const clash = await Menu.findOne({
                where: { shortCode: reqData.shortCode, hotel_id: req.user, active: true, id: { [Op.ne]: reqData.id } },
                attributes: ["id", "item_name"], transaction: t,
            });
            if (clash) {
                await t.rollback();
                return res.json(error(`SKU "${reqData.shortCode}" is already used by ${clash.item_name}.`, STATUSCODE.BAD_REQUEST));
            }
        }

        const { imageUrl, variants, addons } = reqData;
        const menuData = {
            sub_categories: reqData.sub_categories,
            foodImage: imageUrl,
            item_name: reqData.item_name,
            favorite: reqData.favorite,
            menu_categ_id: availableCatagories.id,
            price: reqData.price,
            description: reqData.description,
            hotel_id: req.user,
            shortCode: reqData.shortCode,
            gst_type: reqData.gst_type,
            barcode_value: reqData.barcode_value,
        };
        await Menu.update(menuData, { where: { id: reqData.id, hotel_id: req.user }, transaction: t });

        await MenuVariants.destroy({ where: { menu_id: reqData.id, hotel_id: req.user }, transaction: t });
        if (variants && variants.length) {
            for (const data of variants) {
                const { id, variant_price } = data;
                const variant = await Variants.findByPk(id, { transaction: t });
                const availableVariant = await MenuVariants.findOne({ where: { menu_id: reqData.id, variant_id: id }, transaction: t });
                if (availableVariant) {
                    await t.rollback();
                    return res.json(error("Please Add Different Variant", STATUSCODE.BAD_REQUEST));
                }
                if (!variant) {
                    await t.rollback();
                    return res.json(error("Variant Not Found", STATUSCODE.BAD_REQUEST));
                }
                await MenuVariants.create(
                    { menu_id: reqData.id, variant_id: id, variant_price, hotel_id: req.user },
                    { transaction: t },
                );
            }
        }

        await MenuAddon.destroy({ where: { menu_id: reqData.id, hotel_id: req.user }, transaction: t });
        if (addons.length) {
            for (const addon_department_id of addons) {
                const addonDepartMent = await AddonDepartment.findByPk(addon_department_id, { transaction: t });
                if (!addonDepartMent) {
                    await t.rollback();
                    return res.json(error("Addon Department Not Found", STATUSCODE.BAD_REQUEST));
                }
                await MenuAddon.create(
                    { menu_id: reqData.id, addon_department_id, hotel_id: req.user, active: true },
                    { transaction: t },
                );
            }
        }

        await t.commit();
        return res.status(STATUSCODE.CREATED).json(success(MESSAGE.SUCCESS, { message: MESSAGE.MENU_UPDATED }, STATUSCODE.SUCCESS));
    } catch (err) {
        await t.rollback();
        console.error("[menu] editMenu error:", err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

// Ported from uat-backend-v2/controller/menu.js's removeMenu (POST
// /menuRemove). Soft-delete only, single id or bulk allId - matches cloud
// exactly, including its CREATED-status-on-bulk/SUCCESS-status-on-single
// asymmetry.
const removeMenu = async (req, res) => {
    try {
        const hotel = await Hotel.findOne({ where: { id: req.user } });
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST));

        const { allId } = req.body;
        if (allId) {
            for (const id of allId) {
                const availableMenu = await Menu.findOne({ where: { id, hotel_id: req.user } });
                if (!availableMenu) return res.json(error(MESSAGE.MENU_NOT_FOUND, STATUSCODE.NOT_FOUND));
                await Menu.update({ active: false }, { where: { id, hotel_id: req.user } });
            }
            return res.status(STATUSCODE.CREATED).json(success(MESSAGE.SUCCESS, { message: MESSAGE.MENU_DELETED }, STATUSCODE.SUCCESS));
        }

        const availableMenu = await Menu.findOne({ where: { id: req.body.id, hotel_id: req.user } });
        if (!availableMenu) return res.json(error(MESSAGE.MENU_NOT_FOUND, STATUSCODE.NOT_FOUND));
        await Menu.update({ active: false }, { where: { id: req.body.id, hotel_id: req.user } });

        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { message: MESSAGE.MENU_DELETED }, STATUSCODE.SUCCESS));
    } catch (err) {
        console.error("[menu] removeMenu error:", err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

module.exports = {
    showMenu,
    showCatagories,
    getMenuItemsWithVariants,
    menuShowAll,
    createCatagories,
    editCatagories,
    removeCatagories,
    createMenu,
    editMenu,
    removeMenu,
};
