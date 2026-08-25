const { Op } = require("sequelize")
const { STATUSCODE, MESSAGE } = require("../constant/const")
const { createLogFile } = require("../logs/log")
const PromoCode = require("../model/promoCode")
const { success, error } = require("../responce/res")

const createPromoCode = async (req, res) => {
    try {
        const { promo_code_name, promo_code, discount_type, discount_value } = req.body

        const checkAvailablePromoCode = await PromoCode.findOne({ where: { promo_code, status: true, hotel_id: req.user } })
        if (checkAvailablePromoCode) return res.json(error("Promo Code Already Available", STATUSCODE.BAD_REQUEST))
        await PromoCode.create({ promo_code_name, promo_code, discount_type, discount_value, hotel_id: req.user })
        const promoCodes = await PromoCode.findAll({ where: { hotel_id: req.user, status: true } })
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { message: "Promo Code Created Successfully", promoCodes }, STATUSCODE.SUCCESS))
    } catch (err) {
        // createLogFile(req.user, "PromoCOde create Error", JSON.stringify(err))
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const updatePromoCode = async (req, res) => {
    try {
        const { promo_code_name, promo_code, discount_type, discount_value, id, status } = req.body

        const checkAvailablePromoCode = await PromoCode.findOne({ where: { promo_code, status: true, hotel_id: req.user, id: { [Op.ne]: id } } })
        if (checkAvailablePromoCode) return res.json(error("Promo Code Already Available", STATUSCODE.BAD_REQUEST))
        await PromoCode.update({ promo_code_name, status, promo_code, discount_type, discount_value }, { where: { id, hotel_id: req.user } })
        const promoCodes = await PromoCode.findAll({ where: { hotel_id: req.user, status: true } })

        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { message: "Promo Code Created Successfully", promoCodes }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err)
        // createLogFile(req.user, "PromoCOde create Error", JSON.stringify(err.message))
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const getAllPromoCode = async (req, res) => {
    try {

        const promoCodes = await PromoCode.findAll({ where: { hotel_id: req.user, status: true } })
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { message: "Promo Code Fetch Successfully", promoCodes }, STATUSCODE.SUCCESS))
    } catch (err) {
        // createLogFile(req.user, "PromoCOde create Error", JSON.stringify(err))
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

module.exports = { getAllPromoCode, createPromoCode, updatePromoCode }
