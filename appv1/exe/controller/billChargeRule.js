// COPY of billerpe-local-exe/controller/billChargeRule.js for the POS App (Plan 2) -
// written by scripts/vendor-exe-for-appv1.py. Do not edit here: change the
// exe's file and re-run the script, so both plans keep the same rules.

const { Hotel, BillChargeRule } = require("../model");
const { MESSAGE, STATUSCODE } = require("../../../constant/const");
const { error, success } = require("../../../responce/res");

// Ported from uat-backend-v2/controller/billChargeRule.js.
const getBillChargeRules = async (req, res) => {
    try {
        const hotel = await Hotel.findOne({ where: { id: req.user } });
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST));
        const rules = await BillChargeRule.findAll({ where: { hotel_id: req.user } });
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { rules }, STATUSCODE.SUCCESS));
    } catch (err) {
        console.error("[billChargeRule] getBillChargeRules error:", err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

const updateBillChargeRule = async (req, res) => {
    try {
        const {
            rule_for, active, charge_type, charge_value, calculation_on,
            charge_automatic, calculation_on_tax, greater_less, greater_less_amount,
        } = req.body;
        if (!["delivery", "packaging"].includes(rule_for)) {
            return res.json(error("rule_for must be delivery or packaging", STATUSCODE.BAD_REQUEST));
        }
        const hotel = await Hotel.findOne({ where: { id: req.user } });
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST));

        const fields = {
            active, charge_type, charge_value, calculation_on,
            charge_automatic, calculation_on_tax, greater_less, greater_less_amount,
        };
        const existing = await BillChargeRule.findOne({ where: { hotel_id: req.user, rule_for } });
        if (existing) {
            await BillChargeRule.update(fields, { where: { id: existing.id, hotel_id: req.user } });
        } else {
            await BillChargeRule.create({ ...fields, rule_for, hotel_id: req.user, enter_by: hotel.hotel_name });
        }
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { message: "Charge Rule Saved Successfully" }, STATUSCODE.SUCCESS));
    } catch (err) {
        console.error("[billChargeRule] updateBillChargeRule error:", err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

module.exports = { getBillChargeRules, updateBillChargeRule };
