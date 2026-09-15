const Hotel = require("../model/hotel")

const { MESSAGE, STATUSCODE, } = require("../constant/const")
const { success, error } = require("../responce/res")
const KotFormate = require("../model/kotFormate")

// Mirrors controller/incoiceFormate.js's invoiceSetting/headerFooterContent
// exactly, against the separate hms_kot_formate_mst table (Task 1).
const kotFormatSetting = async (req, res) => {
    try {
        const hotel = await Hotel.findOne({ where: { id: req.user } })
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST))
        const kotFormatAvailable = await KotFormate.findOne({ where: { hotel_id: req.user } })
        if (kotFormatAvailable) {
            await KotFormate.update(req.body, { where: { id: kotFormatAvailable.id, hotel_id: hotel.id } })
        } else {
            req.body.hotel_id = hotel.id
            await KotFormate.create(req.body)
        }

        return res.json(success(MESSAGE.SUCCESS, { message: MESSAGE.SET_HEADER_FOOTER_LINES }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err)
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const kotHeaderFooterContent = async (req, res) => {
    try {
        const hotel = await Hotel.findOne({ where: { id: req.user } })
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST))
        const headerFooterData = await KotFormate.findOne({ where: { hotel_id: req.user } })
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { headerFooterData }, STATUSCODE.SUCCESS))
    } catch (err) {
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
module.exports = { kotFormatSetting, kotHeaderFooterContent }
