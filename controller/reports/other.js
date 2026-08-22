const { where, Op } = require("sequelize")
const { MESSAGE, STATUSCODE, STATUS } = require("../../constant/const")
const DuePaymentReceive = require("../../model/duePayment")
const User = require("../../model/user")
const { error, success } = require("../../responce/res")
const { getShiftedDateRange } = require("../../utils/dateUtils");
const Hotel = require("../../model/hotel")
const HotelUser = require("../../model/hotelUser")
const Order = require("../../model/order")

const duePaymentReceiveReports = async (req, res) => {
    try {
        const { startDate, endDate, number } = req.query
        const { startD, endD, businessStartDate, businessEndDate } = await getShiftedDateRange(startDate, endDate, req.user);
        const hotel = await Hotel.findByPk(req.user)

        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST))
        const userInclude = number
            ? {
                model: User,
                where: { number },
                attributes: ["name", "number"],
                required: true
            }
            : {
                model: User,
                attributes: ["name", "number"],
                required: true
            };

        const report = await DuePaymentReceive.findAll({
            where: {
                hotel_id: req.user,
                business_date: { [Op.between]: [businessStartDate, businessEndDate] }
            },
            include: [
                userInclude,
                {
                    model: HotelUser,
                    attributes: ["name"],
                    required: true
                }
            ],
            attributes: ['id', 'amount', 'payment_mode', "bill_no", "createdAt",],
            order: [['createdAt', 'DESC']],
        });
        const TotalAmount = await DuePaymentReceive.sum("amount", {
            where: {
                hotel_id: req.user,
                business_date: { [Op.between]: [businessStartDate, businessEndDate] }
            },
        });
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { report, TotalAmount }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err)
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}


module.exports = { duePaymentReceiveReports }