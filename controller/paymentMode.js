const Hotel = require("../model/hotel");
const PaymentMode = require("../model/paymentMode");
const { STATUSCODE, MESSAGE } = require("../constant/const");
const { error, success } = require("../responce/res");

const createPaymentMode = async (req, res) => {
    try {
        const hotel = await Hotel.findOne({ where: { id: req.user } });
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST));
        const name = req?.body?.name?.trim() || "";
        if (!name) return res.json(error("Please Enter Valid Mode Name", STATUSCODE.BAD_REQUEST));

        const existing = await PaymentMode.findOne({ where: { name, hotel_id: req.user } });
        if (existing) return res.json(error("A payment mode with this name already exists", STATUSCODE.BAD_REQUEST));

        // New modes are always removable - the two protected defaults
        // (Cash/Due) only exist via addHotelDetails' onboarding seed or
        // the backfill migration, never via this endpoint.
        const mode = await PaymentMode.create({
            name,
            hotel_id: req.user,
            enter_by: hotel.hotel_name,
            active: true,
            deletable: true,
        });
        return res.status(STATUSCODE.CREATED).json(success(MESSAGE.SUCCESS, { message: "Payment Mode Created Successfully", paymentMode: mode }, STATUSCODE.CREATED));
    } catch (err) {
        console.error(err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

const editPaymentMode = async (req, res) => {
    try {
        const { id, name, active } = req.body;
        if (!id) return res.json(error("Payment mode id required", STATUSCODE.BAD_REQUEST));
        const mode = await PaymentMode.findOne({ where: { id, hotel_id: req.user } });
        if (!mode) return res.json(error("Payment Mode Not Found", STATUSCODE.NOT_FOUND));

        // Protected defaults can't be renamed (matches the frontend's own
        // disabled name field for !deletable rows) - enforced here too
        // rather than trusting the client.
        if (!mode.deletable && name && name.trim() !== mode.name) {
            return res.json(error("Protected default modes can't be renamed", STATUSCODE.BAD_REQUEST));
        }

        await PaymentMode.update({
            ...(name && mode.deletable ? { name: name.trim() } : {}),
            ...(active !== undefined ? { active } : {}),
        }, { where: { id, hotel_id: req.user } });

        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { message: "Payment Mode Updated Successfully" }, STATUSCODE.SUCCESS));
    } catch (err) {
        console.error(err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

const getPaymentMode = async (req, res) => {
    try {
        const hotel = await Hotel.findOne({ where: { id: req.user } });
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST));
        const paymentModes = await PaymentMode.findAll({ where: { hotel_id: req.user }, order: [["id", "ASC"]] });
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { paymentModes }, STATUSCODE.SUCCESS));
    } catch (err) {
        console.error(err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

const removePaymentMode = async (req, res) => {
    try {
        const { id } = req.body;
        const mode = await PaymentMode.findOne({ where: { id, hotel_id: req.user } });
        if (!mode) return res.json(error("Payment Mode Not Found", STATUSCODE.NOT_FOUND));
        if (!mode.deletable) {
            return res.json(error("This is a protected default mode and can't be removed", STATUSCODE.BAD_REQUEST));
        }
        await PaymentMode.destroy({ where: { id, hotel_id: req.user } });
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { message: "Payment Mode Removed Successfully" }, STATUSCODE.SUCCESS));
    } catch (err) {
        console.error(err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

module.exports = { createPaymentMode, editPaymentMode, getPaymentMode, removePaymentMode };
