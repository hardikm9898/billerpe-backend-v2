const jwt = require("jsonwebtoken");
require("dotenv").config();
const { STATUSCODE, MESSAGE } = require("../constant/const");
const { error } = require("../responce/res");
const Merchant = require("../model/merchant");
const Hotel = require("../model/hotel");

/**
 * merchantReportAuth
 *
 * Bridge middleware for /merchant/report/* endpoints.
 *
 * Flow:
 *   1. Authenticate using the merchant session token (merchantToken cookie).
 *      Same logic as merchantAuth — merchant security is NOT bypassed.
 *   2. Read hotel_id from req.query.hotel_id (sent explicitly by the frontend).
 *   3. Verify the authenticated merchant actually owns that hotel
 *      (Hotel.merchant_id === authenticated merchant id).
 *   4. Set req.user = hotel_id  ← same value adminAuth sets for POS routes.
 *
 * After step 4 every existing POS report controller function works unchanged
 * because they all use `hotel_id: req.user` and `getShiftedDateRange(..., req.user)`.
 *
 * This means:
 *   - No POS session token is ever used or required.
 *   - No existing report controller is modified.
 *   - A merchant can only query hotels they own.
 */
const merchantReportAuth = async (req, res, next) => {
    try {
        const { merchantToken, merchantRefreshToken } = req.cookies;

        if (!merchantToken && !merchantRefreshToken) {
            return res.json(error(MESSAGE.NOT_AUTHORIZE, STATUSCODE.FORBIDDEN));
        }

        const hotel_id = Number(req.query.hotel_id || req.body.hotel_id);
        if (!hotel_id) {
            return res.json(error("hotel_id is required", STATUSCODE.BAD_REQUEST));
        }

        const verifyAndAuthorize = async (merchantId) => {
            const merchant = await Merchant.findOne({ where: { id: merchantId } });
            if (!merchant) {
                return res.json(error(MESSAGE.FAIL, STATUSCODE.BAD_REQUEST));
            }

            // Verify the merchant owns this hotel — same check used across merchant controllers
            const hotel = await Hotel.findOne({ where: { id: hotel_id, merchant_id: merchant.id } });
            if (!hotel) {
                return res.json(error("Access denied: hotel does not belong to this merchant", STATUSCODE.FORBIDDEN));
            }

            // Bridge: set req.user = hotel_id so every POS report controller works unchanged
            req.user = hotel_id;
            next();
        };

        if (!merchantToken && merchantRefreshToken) {
            jwt.verify(merchantRefreshToken, process.env.JWT_SECRET_KEY_MARCHANT, { expiresIn: "15m" }, async (err, data) => {
                if (err) return res.json(error(MESSAGE.NOT_AUTHORIZE, STATUSCODE.FORBIDDEN));
                const jwtToken = jwt.sign({ id: data.id }, process.env.JWT_SECRET_KEY_MARCHANT, { expiresIn: "15s" });
                const refreshToken = jwt.sign({ id: data.id }, process.env.JWT_SECRET_KEY_MARCHANT, { expiresIn: "7d" });
                res.cookie("merchantToken", jwtToken, { httpOnly: true, maxAge: 1000 * 60 * 14, sameSite: "lax" });
                res.cookie("merchantRefreshToken", refreshToken, { httpOnly: true, maxAge: 604800000, sameSite: "lax" });
                await verifyAndAuthorize(data.id);
            });
            return;
        }

        if (merchantToken) {
            jwt.verify(merchantRefreshToken, process.env.JWT_SECRET_KEY_MARCHANT, { expiresIn: "15m" }, async (err, data) => {
                if (err) return res.json(error(MESSAGE.NOT_AUTHORIZE, STATUSCODE.FORBIDDEN));
                await verifyAndAuthorize(data.id);
            });
        }

    } catch (err) {
        console.log("merchantReportAuth error:", err);
        return res.json(error(MESSAGE.INVALID_TOKEN, STATUSCODE.FORBIDDEN));
    }
};

module.exports = { merchantReportAuth };
