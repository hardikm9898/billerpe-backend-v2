// COPY of billerpe-local-exe/controller/addon.js for the POS App (Plan 2) -
// written by scripts/vendor-exe-for-appv1.py. Do not edit here: change the
// exe's file and re-run the script, so both plans keep the same rules.

const { sequelize, Hotel, AddonDepartment, Addons } = require("../model");
const { MESSAGE, STATUSCODE } = require("../../../constant/const");
const { success, error } = require("../../../responce/res");

// Ported from uat-backend-v2/controller/Variant/addon.js's getAllAddons
// (GET /addon). See controller/menu.js's getMenuItemsWithVariants comment
// for why this was needed.
const getAllAddons = async (req, res) => {
    try {
        const hotel = await Hotel.findByPk(req.user, { attributes: ["id"] });
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST));

        const addons = await AddonDepartment.findAll({
            where: { hotel_id: req.user },
            attributes: ["id", "department_name", "maximum_allowed_addon", "singleSelection", "minimum_allowed_addon", "menu_catalog_id"],
            include: { model: Addons, attributes: ["id", "addon_name", "price", "attributes"] },
        });
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { addons }, STATUSCODE.SUCCESS));
    } catch (err) {
        console.error("[addon] getAllAddons error:", err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

const addonInclude = { model: Addons, attributes: ["id", "addon_name", "price", "attributes"] };
const addonAttrs = ["id", "department_name", "maximum_allowed_addon", "singleSelection", "minimum_allowed_addon", "menu_catalog_id"];

const createAddonDepartment = async (req, res) => {
    const t = await sequelize.transaction();
    try {
        const { department_name, maximum_allowed_addon, minimum_allowed_addon, singleSelection, addons, menu_catalog_id } = req.body;
        const existing = await AddonDepartment.findOne({ where: { department_name, hotel_id: req.user }, transaction: t });
        if (existing) {
            await t.rollback();
            return res.json(error("Department Name Already Available", STATUSCODE.BAD_REQUEST));
        }
        if (addons.length < maximum_allowed_addon) {
            await t.rollback();
            return res.json(error("Maximum Allowed Addon Less Or Equal to Number Of Addon item", STATUSCODE.BAD_REQUEST));
        }
        if (maximum_allowed_addon < minimum_allowed_addon) {
            await t.rollback();
            return res.json(error("Minimum value should not be greater than Maximum value", STATUSCODE.BAD_REQUEST));
        }
        const department = await AddonDepartment.create({ department_name, maximum_allowed_addon, minimum_allowed_addon, singleSelection, hotel_id: req.user, ...(menu_catalog_id ? { menu_catalog_id } : {}) }, { transaction: t });
        const addonData = addons.map((cur) => ({ addon_name: cur.addon_name, price: cur.price, attributes: cur.attributes || "veg", department_id: department.id, hotel_id: req.user }));
        if (!addonData.length) {
            await t.rollback();
            return res.json(error("Please Add Some Addons Items", STATUSCODE.BAD_REQUEST));
        }
        await Addons.bulkCreate(addonData, { transaction: t });
        const result = await AddonDepartment.findAll({ where: { hotel_id: req.user }, attributes: addonAttrs, include: addonInclude, transaction: t });
        await t.commit();
        return res.status(STATUSCODE.CREATED).json(success(MESSAGE.SUCCESS, { message: "Addon Created Successfully", addons: result }, STATUSCODE.CREATED));
    } catch (err) {
        await t.rollback();
        console.error("[addon] createAddonDepartment error:", err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

const updatedAddons = async (req, res) => {
    const t = await sequelize.transaction();
    try {
        const { department_name, maximum_allowed_addon, minimum_allowed_addon, singleSelection, addons, id, menu_catalog_id } = req.body;
        const existing = await AddonDepartment.findByPk(id, { transaction: t });
        if (!existing) {
            await t.rollback();
            return res.json(error("Addon Department Not Found", STATUSCODE.BAD_REQUEST));
        }
        await AddonDepartment.update({ department_name, maximum_allowed_addon, minimum_allowed_addon, singleSelection, ...(menu_catalog_id ? { menu_catalog_id } : {}) }, { where: { id, hotel_id: req.user }, transaction: t });
        await Addons.destroy({ where: { department_id: id, hotel_id: req.user }, transaction: t });
        if (addons.length < maximum_allowed_addon) {
            await t.rollback();
            return res.json(error("Maximum Allowed Addon Less Or Equal to Number Of Addon item", STATUSCODE.BAD_REQUEST));
        }
        if (maximum_allowed_addon < minimum_allowed_addon) {
            await t.rollback();
            return res.json(error("Minimum value should not be greater than Maximum value", STATUSCODE.BAD_REQUEST));
        }
        const addonData = addons.map((cur) => ({ addon_name: cur.addon_name, price: cur.price, attributes: cur.attributes || "veg", department_id: id, hotel_id: req.user }));
        if (!addonData.length) {
            await t.rollback();
            return res.json(error("Please Add Some Addons Items", STATUSCODE.BAD_REQUEST));
        }
        await Addons.bulkCreate(addonData, { transaction: t });
        const result = await AddonDepartment.findAll({ where: { hotel_id: req.user }, attributes: addonAttrs, include: addonInclude, transaction: t });
        await t.commit();
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { message: "Addons Updated Successfully", addons: result }, STATUSCODE.SUCCESS));
    } catch (err) {
        await t.rollback();
        console.error("[addon] updatedAddons error:", err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

module.exports = { getAllAddons, createAddonDepartment, updatedAddons };
