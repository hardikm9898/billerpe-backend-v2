const Hotel = require("../model/hotel");
const PaymentModeDefault = require("../model/paymentModeDefault");
const PaymentMode = require("../model/paymentMode");
const { STATUSCODE, MESSAGE, ORDER_TYPE } = require("../constant/const");
const { error, success } = require("../responce/res");

const VALID_ORDER_TYPES = [ORDER_TYPE.DININ, ORDER_TYPE.PICKUP];

const getPaymentModeDefaults = async (req, res) => {
    try {
        const rows = await PaymentModeDefault.findAll({ where: { hotel_id: req.user }, order: [["id", "ASC"]] });
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { paymentModeDefaults: rows }, STATUSCODE.SUCCESS));
    } catch (err) {
        console.error(err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

// One row per (hotel, order_type, table_categ_id) - table_categ_id null is
// the order type's own base row, non-null is a per-category override.
// Upserts by that triple instead of relying on a DB unique constraint:
// MySQL treats every NULL in a unique index as distinct, so a unique index
// on (hotel_id, order_type, table_categ_id) would NOT actually stop two
// null-table_categ_id rows for the same (hotel, order_type) - this
// find-then-update/create does the job at the application layer instead,
// where null really does mean "no override, just the base default."
const savePaymentModeDefault = async (req, res) => {
    try {
        const hotel = await Hotel.findOne({ where: { id: req.user } });
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST));

        const { order_type, table_categ_id, payment_mode_id } = req.body;
        if (!order_type || !VALID_ORDER_TYPES.includes(order_type)) {
            return res.json(error(MESSAGE.PLEASE_SELECT_ORDER_TYPE, STATUSCODE.BAD_REQUEST));
        }
        if (!payment_mode_id) {
            return res.json(error("Please select a payment mode", STATUSCODE.BAD_REQUEST));
        }

        const mode = await PaymentMode.findOne({ where: { id: payment_mode_id, hotel_id: req.user } });
        if (!mode) return res.json(error("Payment Mode Not Found", STATUSCODE.NOT_FOUND));

        // Category overrides only ever apply to dine-in (pickup has no
        // table), so a table_categ_id sent alongside "pickup" is ignored
        // rather than trusted - keeps the (order_type, table_categ_id) pair
        // meaningful without needing a second validation error for it.
        const categId = order_type === ORDER_TYPE.DININ && table_categ_id ? table_categ_id : null;

        const existing = await PaymentModeDefault.findOne({ where: { hotel_id: req.user, order_type, table_categ_id: categId } });
        if (existing) {
            await existing.update({ payment_mode_id });
        } else {
            await PaymentModeDefault.create({ hotel_id: req.user, order_type, table_categ_id: categId, payment_mode_id });
        }
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { message: "Default Payment Mode Saved" }, STATUSCODE.SUCCESS));
    } catch (err) {
        console.error(err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

const removePaymentModeDefault = async (req, res) => {
    try {
        const { id } = req.body;
        const row = await PaymentModeDefault.findOne({ where: { id, hotel_id: req.user } });
        if (!row) return res.json(error("Default Not Found", STATUSCODE.NOT_FOUND));
        await PaymentModeDefault.destroy({ where: { id, hotel_id: req.user } });
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { message: "Default Removed" }, STATUSCODE.SUCCESS));
    } catch (err) {
        console.error(err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

module.exports = { getPaymentModeDefaults, savePaymentModeDefault, removePaymentModeDefault };
