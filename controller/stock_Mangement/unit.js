const { MESSAGE, STATUSCODE } = require("../../constant/const")
const Hotel = require("../../model/hotel")
const Unit = require("../../model/unit")
const { error, success } = require("../../responce/res")

const addUnit = async (req, res) => {
    try {
        const hotel = await Hotel.findOne({ where: { id: req.user } })
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST))
        const { unitName: unit_name, shortName } = req.body
        console.log(req.body)
        console.log(unit_name, shortName, "dattat-->")
        const unit = await Unit.findOne({ where: { unit_name, hotel_id: req.user } })
        console.log(unit, "Unit--->")
        if (unit) return res.json(error("Unit Name Has Already Taken", STATUSCODE.BAD_REQUEST))
        await Unit.create({ unit_name, shortName, hotel_id: req.user })
        const units = await Unit.findAll({ where: { hotel_id: req.user } })
        return res.status(STATUSCODE.CREATED).json(success("Unit Created", { units }, STATUSCODE.CREATED))
    } catch (err) {
        console.log(err)
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const getAllUnit = async (req, res) => {
    try {
        const hotel = await Hotel.findOne({ where: { id: req.user } })
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST))
        const units = await Unit.findAll({ where: { hotel_id: req.user } })
        return res.status(STATUSCODE.SUCCESS).json(success("Unit Fetch Successfully", { units }, STATUSCODE.SUCCESS))
    } catch (err) {
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const editUnit = async (req, res) => {
    try {


        const hotel = await Hotel.findOne({ where: { id: req.user } })
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST))
        const { unitName: unit_name, shortName, id } = req.body
        const unit = await Unit.findOne({ where: { id } })
        if (!unit) return res.json(error("Unit Not Found", STATUSCODE.BAD_REQUEST))
        await Unit.update({ unit_name, shortName, hotel_id: req.user }, { where: { id } })
        const units = await Unit.findAll({ where: { hotel_id: req.user } })
        return res.status(STATUSCODE.SUCCESS).json(success("Unit Updated Successfully", { units }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err)
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
module.exports = { addUnit, getAllUnit, editUnit }