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
 * Checks and applies { product_plan?, app_device_limit? } to an outlet.
 * Moving to CLOUD_APP releases the outlet's local server (its sync stops);
 * moving back to LOCAL_SUITE logs every POS App phone out. Returns { error }
 * (null when applied) and what was released or logged out. Shared by the old superAdmin call below
 * and the SuperAdmin panel (adminv1/cs/outlets.js).
 */
async function applyPlan(hotel, input, releasedBy, opts = {}) {
    const { product_plan, app_device_limit } = input || {};
    const fields = {};
    if (product_plan !== undefined) {
        if (!["LOCAL_SUITE", "CLOUD_APP"].includes(product_plan)) return { error: "product_plan must be LOCAL_SUITE or CLOUD_APP" };
        fields.product_plan = product_plan;
    }
    if (app_device_limit !== undefined) {
        const n = Number(app_device_limit);
        if (!Number.isInteger(n) || n < 1 || n > 100) return { error: "app_device_limit must be a whole number from 1 to 100" };
        fields.app_device_limit = n;
    }
    if (!Object.keys(fields).length) return { error: "Nothing to change" };
    const t = opts.transaction ? { transaction: opts.transaction } : {};
    const changedPlan = fields.product_plan && fields.product_plan !== hotel.product_plan;
    await hotel.update(fields, t);
    let released = 0;
    let revoked = 0;
    if (changedPlan && fields.product_plan === "CLOUD_APP") {
        [released] = await LocalServerRegistration.update({ status: "released", released_at: new Date(), released_by: releasedBy }, { where: { hotel_id: hotel.id, status: "active" }, ...t });
    }
    if (changedPlan && fields.product_plan === "LOCAL_SUITE") {
        [revoked] = await AppDevice.update({ status: "revoked" }, { where: { hotel_id: hotel.id, status: "active" }, ...t });
    }
    return { error: null, changedPlan: !!changedPlan, released, revoked };
}

/**
 * POST /superAdmin/appPlan { hotel_id, product_plan?, app_device_limit? }
 */
const setAppPlan = async (req, res) => {
    try {
        const { hotel_id, product_plan, app_device_limit } = req.body || {};
        const hotel = await Hotel.findOne({ where: { id: Number(hotel_id) || 0 } });
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.NOT_FOUND));
        const r = await applyPlan(hotel, { product_plan, app_device_limit }, req.user);
        if (r.error) return res.json(error(r.error, STATUSCODE.BAD_REQUEST));
        return res.json(success(MESSAGE.SUCCESS, { hotel_id: hotel.id, product_plan: hotel.product_plan, app_device_limit: hotel.app_device_limit }, STATUSCODE.SUCCESS));
    } catch (err) {
        console.error("[appv1] setAppPlan:", err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

module.exports = { PLAN_2_MESSAGE, isCloudApp, setAppPlan, applyPlan };
