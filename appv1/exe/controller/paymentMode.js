// COPY of billerpe-local-exe/controller/paymentMode.js for the POS App (Plan 2) -
// written by scripts/vendor-exe-for-appv1.py. Do not edit here: change the
// exe's file and re-run the script, so both plans keep the same rules.

const { Hotel, PaymentMode } = require("../model");
const { MESSAGE, STATUSCODE } = require("../../../constant/const");
const { error, success } = require("../../../responce/res");

// Cash and Due are MANDATORY payment modes (owner rule, 2026-09-22): always
// active, never renamed, never removed. They are the rows seeded with
// deletable:false; the name check covers any row that lost its flag.
const MANDATORY_NAMES = ["cash", "due"];
const MANDATORY_MESSAGE = "Cash and Due are mandatory payment modes - they can't be turned off, renamed or removed.";
const normName = (name) => String(name || "").trim().toLowerCase();
const isMandatory = (mode) => !mode.deletable || MANDATORY_NAMES.includes(normName(mode.name));

// Same name, ignoring capitals and spaces ("cash " = "Cash") - SQLite's "="
// is case-sensitive, so this compares in JS on both servers alike.
async function nameTaken(hotelId, name, exceptId) {
    const modes = await PaymentMode.findAll({ where: { hotel_id: hotelId }, attributes: ["id", "name"] });
    return modes.some((m) => m.id !== exceptId && normName(m.name) === normName(name));
}

// Ported from uat-backend-v2/controller/paymentMode.js - full CRUD, same
// as menuCatalog.js, since Web POS's Operations -> Billing screen needs
// this to work through the EXE, not the cloud directly.
const createPaymentMode = async (req, res) => {
    try {
        const hotel = await Hotel.findOne({ where: { id: req.user } });
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST));
        const name = req?.body?.name?.trim() || "";
        if (!name) return res.json(error("Please Enter Valid Mode Name", STATUSCODE.BAD_REQUEST));

        if (await nameTaken(req.user, name)) return res.json(error("A payment mode with this name already exists", STATUSCODE.BAD_REQUEST));

        const mode = await PaymentMode.create({
            name,
            hotel_id: req.user,
            enter_by: hotel.hotel_name,
            active: true,
            deletable: true,
        });
        return res.status(STATUSCODE.CREATED).json(success(MESSAGE.SUCCESS, { message: "Payment Mode Created Successfully", paymentMode: mode }, STATUSCODE.CREATED));
    } catch (err) {
        console.error("[paymentMode] createPaymentMode error:", err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

const editPaymentMode = async (req, res) => {
    try {
        const { id, name, active } = req.body;
        if (!id) return res.json(error("Payment mode id required", STATUSCODE.BAD_REQUEST));
        const mode = await PaymentMode.findOne({ where: { id, hotel_id: req.user } });
        if (!mode) return res.json(error("Payment Mode Not Found", STATUSCODE.NOT_FOUND));

        if (isMandatory(mode)) {
            if (name && name.trim() !== mode.name) return res.json(error(MANDATORY_MESSAGE, STATUSCODE.BAD_REQUEST));
            if (active === false || active === "false" || active === 0) {
                return res.json(error(MANDATORY_MESSAGE, STATUSCODE.BAD_REQUEST));
            }
        } else if (name && name.trim() && await nameTaken(req.user, name, mode.id)) {
            return res.json(error("A payment mode with this name already exists", STATUSCODE.BAD_REQUEST));
        }

        await PaymentMode.update({
            ...(name && name.trim() && !isMandatory(mode) ? { name: name.trim() } : {}),
            ...(active !== undefined ? { active } : {}),
        }, { where: { id, hotel_id: req.user } });

        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { message: "Payment Mode Updated Successfully" }, STATUSCODE.SUCCESS));
    } catch (err) {
        console.error("[paymentMode] editPaymentMode error:", err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

const getPaymentMode = async (req, res) => {
    try {
        const hotel = await Hotel.findOne({ where: { id: req.user } });
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST));
        const paymentModes = await PaymentMode.findAll({ where: { hotel_id: req.user }, order: [["id", "ASC"]] });
        // A mandatory mode switched off before it was locked comes back on.
        const offMandatory = paymentModes.filter((m) => isMandatory(m) && !m.active);
        for (const m of offMandatory) await m.update({ active: true });
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { paymentModes }, STATUSCODE.SUCCESS));
    } catch (err) {
        console.error("[paymentMode] getPaymentMode error:", err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

const removePaymentMode = async (req, res) => {
    try {
        const { id } = req.body;
        const mode = await PaymentMode.findOne({ where: { id, hotel_id: req.user } });
        if (!mode) return res.json(error("Payment Mode Not Found", STATUSCODE.NOT_FOUND));
        if (isMandatory(mode)) return res.json(error(MANDATORY_MESSAGE, STATUSCODE.BAD_REQUEST));
        await PaymentMode.destroy({ where: { id, hotel_id: req.user } });
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { message: "Payment Mode Removed Successfully" }, STATUSCODE.SUCCESS));
    } catch (err) {
        console.error("[paymentMode] removePaymentMode error:", err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

module.exports = { createPaymentMode, editPaymentMode, getPaymentMode, removePaymentMode };
