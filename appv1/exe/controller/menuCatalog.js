// COPY of billerpe-local-exe/controller/menuCatalog.js for the POS App (Plan 2) -
// written by scripts/vendor-exe-for-appv1.py. Do not edit here: change the
// exe's file and re-run the script, so both plans keep the same rules.

const { Op } = require("sequelize");
const { Hotel, MenuCatalog, Menu_categ, Variants, AddonDepartment } = require("../model");
const { MESSAGE, STATUSCODE } = require("../../../constant/const");
const { success, error } = require("../../../responce/res");

// Ported from uat-backend-v2/controller/menu.js's createMenuCatalog/
// editMenuCatalog/getMenuCatalog/removeMenuCatalog. Full CRUD (not
// read-only like this file's own showCatagories) to match how variant.js/
// addon.js already have full CRUD ported here - Multi Menu creation needs
// to work through Web POS, which talks to this EXE, not the cloud
// directly, for every menu-domain call.
const createMenuCatalog = async (req, res) => {
    try {
        const hotel = await Hotel.findOne({ where: { id: req.user } });
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST));
        const name = req?.body?.name?.trim() || "";
        if (!name) return res.json(error("Please Enter Valid Menu Name", STATUSCODE.BAD_REQUEST));

        const existing = await MenuCatalog.findOne({ where: { name, hotel_id: req.user, active: true } });
        if (existing) return res.json(error("A menu with this name already exists", STATUSCODE.BAD_REQUEST));

        const anyExisting = await MenuCatalog.count({ where: { hotel_id: req.user, active: true } });
        const catalog = await MenuCatalog.create({
            name,
            hotel_id: req.user,
            enter_by: hotel.hotel_name,
            is_default: anyExisting === 0,
            table_category_ids: req?.body?.table_category_ids ?? [],
            order_types: req?.body?.order_types ?? [],
        });
        return res.status(STATUSCODE.CREATED).json(success(MESSAGE.SUCCESS, { message: "Menu Created Successfully", menuCatalog: catalog }, STATUSCODE.CREATED));
    } catch (err) {
        console.error("[menuCatalog] createMenuCatalog error:", err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

const editMenuCatalog = async (req, res) => {
    try {
        const { id, name, is_default, table_category_ids, order_types } = req.body;
        if (!id) return res.json(error("Menu id required", STATUSCODE.BAD_REQUEST));
        const catalog = await MenuCatalog.findOne({ where: { id, hotel_id: req.user } });
        if (!catalog) return res.json(error("Menu Not Found", STATUSCODE.NOT_FOUND));

        if (is_default) {
            await MenuCatalog.update({ is_default: false }, { where: { hotel_id: req.user, id: { [Op.ne]: id } } });
        }

        await MenuCatalog.update({
            ...(name ? { name: name.trim() } : {}),
            ...(is_default !== undefined ? { is_default } : {}),
            ...(table_category_ids !== undefined ? { table_category_ids } : {}),
            ...(order_types !== undefined ? { order_types } : {}),
        }, { where: { id, hotel_id: req.user } });

        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { message: "Menu Updated Successfully" }, STATUSCODE.SUCCESS));
    } catch (err) {
        console.error("[menuCatalog] editMenuCatalog error:", err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

const getMenuCatalog = async (req, res) => {
    try {
        const hotel = await Hotel.findOne({ where: { id: req.user } });
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST));
        const menuCatalogs = await MenuCatalog.findAll({ where: { hotel_id: req.user, active: true }, order: [["id", "ASC"]] });
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { menuCatalogs }, STATUSCODE.SUCCESS));
    } catch (err) {
        console.error("[menuCatalog] getMenuCatalog error:", err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

const removeMenuCatalog = async (req, res) => {
    try {
        const { id } = req.body;
        const catalog = await MenuCatalog.findOne({ where: { id, hotel_id: req.user } });
        if (!catalog) return res.json(error("Menu Not Found", STATUSCODE.NOT_FOUND));
        if (catalog.is_default) {
            return res.json(error("Set another menu as default before deleting this one", STATUSCODE.BAD_REQUEST));
        }

        const [categoryCount, variantCount, addonCount] = await Promise.all([
            Menu_categ.count({ where: { menu_catalog_id: id, hotel_id: req.user, active: true } }),
            Variants.count({ where: { menu_catalog_id: id, hotel_id: req.user } }),
            AddonDepartment.count({ where: { menu_catalog_id: id, hotel_id: req.user } }),
        ]);
        if (categoryCount || variantCount || addonCount) {
            return res.json(error("Move or delete this menu's categories, variants and addon groups first", STATUSCODE.BAD_REQUEST));
        }

        await MenuCatalog.update({ active: false }, { where: { id, hotel_id: req.user } });
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { message: "Menu Removed Successfully" }, STATUSCODE.SUCCESS));
    } catch (err) {
        console.error("[menuCatalog] removeMenuCatalog error:", err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

module.exports = { createMenuCatalog, editMenuCatalog, getMenuCatalog, removeMenuCatalog };
