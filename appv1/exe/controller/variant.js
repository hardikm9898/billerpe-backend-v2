// COPY of billerpe-local-exe/controller/variant.js for the POS App (Plan 2) -
// written by scripts/vendor-exe-for-appv1.py. Do not edit here: change the
// exe's file and re-run the script, so both plans keep the same rules.

const { Hotel, Variants } = require("../model");
const { MESSAGE, STATUSCODE } = require("../../../constant/const");
const { success, error } = require("../../../responce/res");

// Ported from uat-backend-v2/controller/Variant/variant.js's getAllVariant
// (GET /variant). See controller/menu.js's getMenuItemsWithVariants comment
// for why this was needed - part of the same Promise.all the menu/order
// screen depends on.
const getAllVariant = async (req, res) => {
    try {
        const hotel = await Hotel.findByPk(req.user, { attributes: ["id"] });
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST));

        const variants = await Variants.findAll({ where: { hotel_id: req.user }, attributes: ["id", "variants_name", "active", "menu_catalog_id"] });
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { variants }, STATUSCODE.SUCCESS));
    } catch (err) {
        console.error("[variant] getAllVariant error:", err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

const createVariant = async (req, res) => {
    try {
        const { variants_name, active, menu_catalog_id } = req.body;
        if (!variants_name) return res.json(error("Variant Name Required", STATUSCODE.BAD_REQUEST));
        const existing = await Variants.findOne({ where: { variants_name, hotel_id: req.user } });
        if (existing) return res.json(error("Variant Name Already Available", STATUSCODE.BAD_REQUEST));
        await Variants.create({ variants_name, active, hotel_id: req.user, ...(menu_catalog_id ? { menu_catalog_id } : {}) });
        const variants = await Variants.findAll({ where: { hotel_id: req.user }, attributes: ["id", "variants_name", "active", "menu_catalog_id"] });
        return res.status(STATUSCODE.CREATED).json(success(MESSAGE.SUCCESS, { message: "Variant Created Successfully", variants }, STATUSCODE.CREATED));
    } catch (err) {
        console.error("[variant] createVariant error:", err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

const updatedVariant = async (req, res) => {
    try {
        const { variants_name, active, id, menu_catalog_id } = req.body;
        if (!variants_name) return res.json(error("Variant Name Required", STATUSCODE.BAD_REQUEST));
        const existing = await Variants.findByPk(id);
        if (!existing) return res.json(error("Variant Not Found", STATUSCODE.BAD_REQUEST));
        await Variants.update({ variants_name, active, ...(menu_catalog_id ? { menu_catalog_id } : {}) }, { where: { id, hotel_id: req.user } });
        const variants = await Variants.findAll({ where: { hotel_id: req.user }, attributes: ["id", "variants_name", "active", "menu_catalog_id"] });
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { message: "Variant Updated Successfully", variants }, STATUSCODE.SUCCESS));
    } catch (err) {
        console.error("[variant] updatedVariant error:", err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

module.exports = { getAllVariant, createVariant, updatedVariant };
