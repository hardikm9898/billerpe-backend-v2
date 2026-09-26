const { Hotel, LocalServerRegistration, AppDevice } = require("../model");
const { success, error } = require("../responce/res");
const { MESSAGE, STATUSCODE } = require("../constant/const");

// A customer has exactly ONE plan (owner decision):
//   LOCAL_SUITE - Web POS + Captain App through the local exe (Plan 1)
//   CLOUD_APP   - the BillerPe POS App only, online (Plan 2)
// Only superadmin changes it (customer care does the switch and the setup).
// The plan decides who may bill: the exe for Plan 1, /app/v1 for Plan 2 -
// never both, or two systems would give the same bill numbers.

const PLAN_2_MESSAGE = "This outlet uses the BillerPe POS App (Plan 2). The Web POS and the local server are not available on this plan - contact BillerPe support to change the plan.";

async function isCloudApp(hotelId) {
    const hotel = await Hotel.findOne({ where: { id: hotelId }, attributes: ["product_plan"], raw: true });
    return hotel?.product_plan === "CLOUD_APP";
}

/**
 * POST /superAdmin/appPlan { hotel_id, product_plan?, app_device_limit? }
 * Moving to CLOUD_APP releases the outlet's local server (its sync stops);
 * moving back to LOCAL_SUITE logs every POS App phone out.
 */
const setAppPlan = async (req, res) => {
    try {
        const { hotel_id, product_plan, app_device_limit } = req.body || {};
        const hotel = await Hotel.findOne({ where: { id: Number(hotel_id) || 0 } });
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.NOT_FOUND));
        const fields = {};
        if (product_plan !== undefined) {
            if (!["LOCAL_SUITE", "CLOUD_APP"].includes(product_plan)) return res.json(error("product_plan must be LOCAL_SUITE or CLOUD_APP", STATUSCODE.BAD_REQUEST));
            fields.product_plan = product_plan;
        }
        if (app_device_limit !== undefined) {
            const n = Number(app_device_limit);
            if (!Number.isInteger(n) || n < 1 || n > 100) return res.json(error("app_device_limit must be a whole number from 1 to 100", STATUSCODE.BAD_REQUEST));
            fields.app_device_limit = n;
        }
        if (!Object.keys(fields).length) return res.json(error("Nothing to change", STATUSCODE.BAD_REQUEST));
        const changedPlan = fields.product_plan && fields.product_plan !== hotel.product_plan;
        await hotel.update(fields);
        if (changedPlan && fields.product_plan === "CLOUD_APP") {
            await LocalServerRegistration.update({ status: "released", released_at: new Date(), released_by: req.user }, { where: { hotel_id: hotel.id, status: "active" } });
        }
        if (changedPlan && fields.product_plan === "LOCAL_SUITE") {
            await AppDevice.update({ status: "revoked" }, { where: { hotel_id: hotel.id, status: "active" } });
        }
        return res.json(success(MESSAGE.SUCCESS, { hotel_id: hotel.id, product_plan: hotel.product_plan, app_device_limit: hotel.app_device_limit }, STATUSCODE.SUCCESS));
    } catch (err) {
        console.error("[appv1] setAppPlan:", err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

module.exports = { PLAN_2_MESSAGE, isCloudApp, setAppPlan };
