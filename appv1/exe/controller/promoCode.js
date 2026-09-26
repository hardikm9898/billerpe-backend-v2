// COPY of billerpe-local-exe/controller/promoCode.js for the POS App (Plan 2) -
// written by scripts/vendor-exe-for-appv1.py. Do not edit here: change the
// exe's file and re-run the script, so both plans keep the same rules.

const { Op } = require("sequelize");
const { PromoCode } = require("../model");
const { MESSAGE, STATUSCODE } = require("../../../constant/const");
const { success, error } = require("../../../responce/res");

// Ported verbatim from uat-backend-v2/controller/discountPromocode.js.

const createPromoCode = async (req, res) => {
    try {
        const hotel_id = req.user;
        const { promo_code_name, promo_code, discount_type, discount_value } = req.body;
        const dup = await PromoCode.findOne({ where: { promo_code, status: true, hotel_id } });
        if (dup) return res.json(error("Promo Code Already Available", STATUSCODE.BAD_REQUEST));

        await PromoCode.create({ promo_code_name, promo_code, discount_type, discount_value, hotel_id });
        const promoCodes = await PromoCode.findAll({ where: { hotel_id, status: true } });
        return res.json(success(MESSAGE.SUCCESS, { message: "Promo Code Created Successfully", promoCodes }, STATUSCODE.SUCCESS));
    } catch (err) {
        console.error("[promoCode] createPromoCode error:", err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

const updatePromoCode = async (req, res) => {
    try {
        const hotel_id = req.user;
        const { id, promo_code_name, promo_code, discount_type, discount_value, status } = req.body;
        const dup = await PromoCode.findOne({ where: { promo_code, status: true, hotel_id, id: { [Op.ne]: id } } });
        if (dup) return res.json(error("Promo Code Already Available", STATUSCODE.BAD_REQUEST));

        await PromoCode.update({ promo_code_name, status, promo_code, discount_type, discount_value }, { where: { id, hotel_id } });
        const promoCodes = await PromoCode.findAll({ where: { hotel_id, status: true } });
        return res.json(success(MESSAGE.SUCCESS, { message: "Promo Code Updated Successfully", promoCodes }, STATUSCODE.SUCCESS));
    } catch (err) {
        console.error("[promoCode] updatePromoCode error:", err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

const getAllPromoCode = async (req, res) => {
    try {
        const promoCodes = await PromoCode.findAll({ where: { hotel_id: req.user, status: true } });
        return res.json(success(MESSAGE.SUCCESS, { promoCodes }, STATUSCODE.SUCCESS));
    } catch (err) {
        console.error("[promoCode] getAllPromoCode error:", err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

module.exports = { createPromoCode, updatePromoCode, getAllPromoCode };
