const jwt = require("jsonwebtoken");
require("dotenv").config();
const { STATUSCODE, MESSAGE } = require("../constant/const");
const { error, mobileError } = require("../responce/res");
const HotelUser = require("../model/hotelUser");
const { UserSession } = require("../model");

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN AUTH  (web dashboard — Bearer token or cookie)
// ─────────────────────────────────────────────────────────────────────────────

const adminAuth = async (req, res, next) => {
    try {
        const token =
            req.cookies?.token ||
            (req.headers.authorization?.startsWith("Bearer") &&
                req.headers.authorization.split(" ")[1]);

        if (!token) {
            return res
                .status(STATUSCODE.UNAUTHORIZED)
                .json(error(MESSAGE.NOT_AUTHORIZE, STATUSCODE.UNAUTHORIZED));
        }

        let decoded;
        try {
            decoded = jwt.verify(token, process.env.JWT_SECRET_KEY_ADMIN);
        } catch {
            return res
                .status(STATUSCODE.UNAUTHORIZED)
                .json(error("Not Authorized", STATUSCODE.UNAUTHORIZED));
        }

        // Run both DB lookups in parallel — saves one sequential round-trip
        const [session, user] = await Promise.all([
            UserSession.findOne({ where: { user_id: decoded.id, token } }),
            HotelUser.findOne({ where: { id: decoded.id, active: true } })
        ]);

        if (!session) {
            return res
                .status(STATUSCODE.UNAUTHORIZED)
                .json(error("Session expired or logged out from another device", STATUSCODE.SESSION_EXPIRED));
        }
        if (!user) {
            return res
                .status(STATUSCODE.UNAUTHORIZED)
                .json(error(MESSAGE.NOT_AUTHORIZE, STATUSCODE.UNAUTHORIZED));
        }

        req.user = user.hotel_id;
        req.userId = user.id;
        return next();
    } catch (err) {
        console.error(err, "adminAuth error:");
        return res
            .status(STATUSCODE.UNAUTHORIZED)
            .json(error("Invalid Token", STATUSCODE.UNAUTHORIZED));
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// MOBILE AUTH  (mobile app — token from cookies header string)
// ─────────────────────────────────────────────────────────────────────────────

const mobileAuth = async (req, res, next) => {
    try {
        const token = req.headers?.cookies?.split("=")[1];

        if (!token) {
            return res.json(mobileError(MESSAGE.NOT_AUTHORIZE, STATUSCODE.VALIDATION_ERROR));
        }

        jwt.verify(token, process.env.JWT_SECRET_KEY_ADMIN, async (err, data) => {
            if (err) {
                console.error(err);
                return res.json(mobileError(MESSAGE.NOT_AUTHORIZE, STATUSCODE.VALIDATION_ERROR));
            }
            const user = await HotelUser.findOne({ where: { id: data.id } });
            if (!user) return res.json(mobileError(MESSAGE.USER_NOT_FOUND, STATUSCODE.BAD_REQUEST));
            req.user = user.hotel_id;
            req.userId = user.id;
            next();
        });
    } catch (err) {
        console.error(err);
        return res.json(mobileError(MESSAGE.INVALID_TOKEN, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// MOBILE SUPER-ADMIN AUTH
// ─────────────────────────────────────────────────────────────────────────────

const mobileSuperAdminAuth = async (req, res, next) => {
    try {
        const token = req.headers?.cookies?.split("=")[1];

        if (!token) {
            return res.json(mobileError(MESSAGE.NOT_AUTHORIZE, STATUSCODE.VALIDATION_ERROR));
        }

        jwt.verify(token, process.env.JWT_SECRET_KEY_SUPER_ADMIN, async (err, data) => {
            if (err) {
                console.error(err);
                return res.json(mobileError(MESSAGE.NOT_AUTHORIZE, STATUSCODE.VALIDATION_ERROR));
            }
            const user = await HotelUser.findOne({ where: { id: data.id } });
            if (!user) return res.json(mobileError(MESSAGE.USER_NOT_FOUND, STATUSCODE.BAD_REQUEST));
            req.user = user.hotel_id;
            req.userId = user.id;
            next();
        });
    } catch (err) {
        console.error(err);
        return res.json(mobileError(MESSAGE.INVALID_TOKEN, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

module.exports = { mobileSuperAdminAuth, adminAuth, mobileAuth };
