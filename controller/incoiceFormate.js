const Hotel = require("../model/hotel")

const { MESSAGE, STATUSCODE, } = require("../constant/const")
const { success, error } = require("../responce/res")
const InvoiceFormate = require("../model/invoiceFormate")
const { createLogFile } = require("../logs/log")

const invoiceSetting = async (req, res) => {
    try {

        const { headerLine1, headerLine2, headerLine3, headerLine4, headerLine5, headerLine6, headerLine7, headerLine8, headerLine9, headerLine10, headerLine11, footerLine1, footerLine2, footerLine3, footerLine4, footerLine5, footerLine6, footerLine7, footerLine8, footerLine9, footerLine10, footerLine11 } = req.body

        const hotel = await Hotel.findOne({ where: { id: req.user } })
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST))
        const invoiceFormateAvailable = await InvoiceFormate.findOne({ where: { hotel_id: req.user } })
        if (invoiceFormateAvailable) {
            await InvoiceFormate.update(req.body, { where: { id: invoiceFormateAvailable.id, hotel_id: hotel.id } })
        } else {
            req.body.hotel_id = hotel.id
            await InvoiceFormate.create(req.body)
        }

        return res.json(success(MESSAGE.SUCCESS, { message: MESSAGE.SET_HEADER_FOOTER_LINES }, STATUSCODE.SUCCESS))
    } catch (err) {
        //createLogFile(req.user, ` invoiceSetting/err Error`, err);
        console.log(err)
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const headerFooterContent = async (req, res) => {
    try {

        const hotel = await Hotel.findOne({ where: { id: req.user } })
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST))
        const headerFooterData = await InvoiceFormate.findOne({ where: { hotel_id: req.user } })
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { headerFooterData }, STATUSCODE.SUCCESS))

    } catch (err) {
        //createLogFile(req.user, ` headerFooterContent/err Error`, err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const getFontSizeArray = async (req, res) => {
    const array = [12, 14, 16, 17, 19, 21]
    return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { array }, STATUSCODE.SUCCESS))
}
module.exports = { getFontSizeArray, invoiceSetting, headerFooterContent }