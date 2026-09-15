

const { regexp } = require("sequelize/lib/operators")
const { MESSAGE, STATUSCODE } = require("../../constant/const")
const Hotel = require("../../model/hotel")
const Variants = require("../../model/variants")
const { error, success } = require("../../responce/res")


const createVariant = async (req, res) => {
    try {
        const { variants_name, active, menu_catalog_id } = req.body
        if (!/^[A-Za-z0-9\s&.,'()\-\[\]]+$/.test(variants_name)) {
            return res.json(error("Please enter a valid variant name", STATUSCODE.BAD_REQUEST));
        }
        const findVariantAvailable = await Variants.findOne({ where: { variants_name, hotel_id: req.user } })
        if (!variants_name) return res.json(error("Variant Name Required", STATUSCODE.BAD_REQUEST))
        if (!findVariantAvailable) {
            await Variants.create({ variants_name, active, hotel_id: req.user, ...(menu_catalog_id ? { menu_catalog_id } : {}) })
            const findVariantAvailable = await Variants.findAll({ where: { hotel_id: req.user }, attributes: ['id', 'variants_name', "active", "menu_catalog_id"] })
            return res.status(STATUSCODE.CREATED).json(success(MESSAGE.SUCCESS, { message: "Variant Created Succssefully", variants: findVariantAvailable }, STATUSCODE.CREATED))
        }
        return res.json(error("Variant Name Already Available", STATUSCODE.BAD_REQUEST))
    } catch (err) {

        console.log(err)
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const updatedVariant = async (req, res) => {
    try {
        const { variants_name, active, id, menu_catalog_id } = req.body
        console.log(variants_name.length)
        // if (!/^[A-Za-z0-9\s&.,'()\-\[\]]+$/.test(variants_name) || (variants_name.split('').length >= 2 && variants_name.split('').length <= 100)) {
        //     return res.json(error("Please enter a valid variant name", STATUSCODE.BAD_REQUEST));
        // }
        console.log(req.body, "Body--->")
        if (!variants_name) return res.json(error("Variant Name Required", STATUSCODE.BAD_REQUEST))
        const findVariantAvailable = await Variants.findByPk(id)
        if (!findVariantAvailable) {
            return res.json(error("Variant Not Found", STATUSCODE.BAD_REQUEST))
        }
        await Variants.update({ variants_name, active, ...(menu_catalog_id ? { menu_catalog_id } : {}) }, { where: { id, hotel_id: req.user } })
        const findVariantAvailable1 = await Variants.findAll({ where: { hotel_id: req.user }, attributes: ['id', 'variants_name', "active", "menu_catalog_id"] })
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { message: "Variant Updated Succssefully", variants: findVariantAvailable1 }, STATUSCODE.SUCCESS))

    } catch (err) {

        console.log(err)
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const getAllVariant = async (req, res) => {
    try {
        const hotel = await Hotel.findByPk(req.user, { attributes: ['id'] })
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST))
        const findVariantAvailable = await Variants.findAll({ where: { hotel_id: req.user }, attributes: ['id', 'variants_name', "active", "menu_catalog_id"] })
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { variants: findVariantAvailable }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err)
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

module.exports = { getAllVariant, updatedVariant, createVariant }