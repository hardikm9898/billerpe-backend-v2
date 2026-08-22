const { MESSAGE, STATUSCODE } = require("../../constant/const")
const { success, error } = require("../../responce/res")

// ===================== MENU SYNC CALLBACK =====================

const menuSync = async (req, res) => {
    try {
        console.log("🔄 Zomato Menu Sync Payload:", req.body);

        return res
            .status(STATUSCODE.SUCCESS)
            .json(success(MESSAGE.SUCCESS, { message: MESSAGE.MENU_SYNC_RECEIVED }, STATUSCODE.SUCCESS));

    } catch (err) {
        console.log(err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};


// ===================== OUTLET STATUS CALLBACK =====================
const outletStatus = async (req, res) => {
    try {
        console.log("🏪 Zomato Outlet Status Payload:", req.body);

        return res
            .status(STATUSCODE.SUCCESS)
            .json(success(MESSAGE.SUCCESS, { message: MESSAGE.OUTLET_STATUS_RECEIVED }, STATUSCODE.SUCCESS));

    } catch (error) {
        console.log(error);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};


// ===================== PLACE ORDER (Zomato -> You) =====================
const zomatoPlaceOrder = async (req, res) => {
    try {
        console.log("🛒 Zomato New Order:", req.body);

        // Basic validation
        if (!req.body.order_id) {
            return res.json(error("order_id is required", STATUSCODE.BAD_REQUEST));
        }

        return res
            .status(STATUSCODE.SUCCESS)
            .json(success(MESSAGE.SUCCESS, { message: MESSAGE.ORDER_RECEIVED }, STATUSCODE.SUCCESS));

    } catch (error) {
        console.log(error);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};


// ===================== UPDATE ORDER STATUS (You -> Zomato) =====================
const zomatoUpdateOrderStatus = async (req, res) => {
    try {
        console.log("📦 Zomato Order Status Update:", req.body);

        if (!req.body.order_id || !req.body.status) {
            return res.json(error("order_id & status required", STATUSCODE.BAD_REQUEST));
        }

        return res
            .status(STATUSCODE.SUCCESS)
            .json(success(MESSAGE.SUCCESS, { message: MESSAGE.ORDER_STATUS_UPDATED }, STATUSCODE.SUCCESS));

    } catch (error) {
        console.log(error);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};


// ===================== RIDER STATUS =====================
const zomatoRiderStatus = async (req, res) => {
    try {
        console.log("🚴‍♂️ Zomato Rider Status:", req.body);

        if (!req.body.order_id) {
            return res.json(error("order_id required", STATUSCODE.BAD_REQUEST));
        }

        return res
            .status(STATUSCODE.SUCCESS)
            .json(success(MESSAGE.SUCCESS, { message: MESSAGE.RIDER_STATUS_RECEIVED }, STATUSCODE.SUCCESS));

    } catch (error) {
        console.log(error);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};


// ===================== LIVE OUTLETS =====================
const zomatoLiveOutlets = async (req, res) => {
    try {
        console.log("🏬 Zomato Live Outlets Payload:", req.body);

        return res
            .status(STATUSCODE.SUCCESS)
            .json(success(MESSAGE.SUCCESS, { message: MESSAGE.LIVE_OUTLETS_RECEIVED }, STATUSCODE.SUCCESS));

    } catch (error) {
        console.log(error);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};


module.exports = { zomatoRiderStatus, zomatoUpdateOrderStatus, zomatoPlaceOrder, outletStatus, menuSync, zomatoLiveOutlets }