const jwt = require("jsonwebtoken");
require("dotenv").config();
const { STATUSCODE, MESSAGE } = require("../constant/const");
const { error, mobileError } = require("../responce/res");
const HotelUser = require("../model/hotelUser");
const { UserSession } = require("../model");

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN AUTH  (web dashboard — Bearer token or cookie)
// ─────────────────────────────────────────────────────────────────────────────

// `Secure` only in production - see controller/auth.js's own SECURE_COOKIES
// for why (a `Secure` cookie is silently dropped over plain HTTP on any
// origin but localhost, breaking every LAN address this POS is actually
// used from). Duplicated here rather than imported so this middleware file
// stays self-contained, matching its existing style.
const SECURE_COOKIES = process.env.NODE_ENV === "production";

const adminAuth = async (req, res, next) => {
    try {
        const token =
            req.cookies?.token ||
            (req.headers.authorization?.startsWith("Bearer") &&
                req.headers.authorization.split(" ")[1]);
        const refreshToken = req.cookies?.refreshToken;

        if (!token && !refreshToken) {
            return res
                .status(STATUSCODE.UNAUTHORIZED)
                .json(error(MESSAGE.NOT_AUTHORIZE, STATUSCODE.UNAUTHORIZED));
        }

        let decoded = null;
        if (token) {
            try {
                decoded = jwt.verify(token, process.env.JWT_SECRET_KEY_ADMIN);
            } catch {
                decoded = null;
            }
        }

        let session = null, user = null;
        if (decoded) {
            // Run both DB lookups in parallel — saves one sequential round-trip
            [session, user] = await Promise.all([
                UserSession.findOne({ where: { user_id: decoded.id, token } }),
                HotelUser.findOne({ where: { id: decoded.id, active: true } })
            ]);
        }

        // Real fix for a real gap: restaurantLogin has minted and stored a
        // refresh token (HotelUser.refresh_token, "refreshToken" cookie, 7d
        // expiry) on every login since that code existed, but nothing ever
        // consumed it here - a session silently died at the access token's
        // 24h expiry with no way back short of a full re-login. Falls back
        // whenever the access token is missing OR failed verification OR
        // has no matching session OR its user isn't active - not just when
        // it's absent - same reasoning cookieJwtAuthFactory.js documents
        // for the other login paths' much shorter-lived access tokens.
        if ((!decoded || !session || !user) && refreshToken) {
            let refreshDecoded;
            try {
                refreshDecoded = jwt.verify(refreshToken, process.env.JWT_SECRET_KEY_ADMIN);
            } catch {
                return res
                    .status(STATUSCODE.UNAUTHORIZED)
                    .json(error(MESSAGE.NOT_AUTHORIZE, STATUSCODE.UNAUTHORIZED));
            }

            const refreshUser = await HotelUser.findOne({ where: { id: refreshDecoded.id, active: true } });
            // Only the CURRENT refresh token is honored - restaurantLogin
            // overwrites HotelUser.refresh_token on every new login, so a
            // device superseded by a newer login elsewhere (the existing
            // single-session-per-user intent) can't use its now-stale
            // refresh token to silently keep itself logged in forever.
            if (!refreshUser || refreshUser.refresh_token !== refreshToken) {
                return res
                    .status(STATUSCODE.UNAUTHORIZED)
                    .json(error("Session expired or logged out from another device", STATUSCODE.SESSION_EXPIRED));
            }

            const newAccessToken = jwt.sign({ id: refreshUser.id }, process.env.JWT_SECRET_KEY_ADMIN, { expiresIn: "24h" });
            const newRefreshToken = jwt.sign({ id: refreshUser.id }, process.env.JWT_SECRET_KEY_ADMIN, { expiresIn: "7d" });
            await refreshUser.update({ refresh_token: newRefreshToken });

            // Preserve the existing session row (and its device_id) by
            // updating it in place rather than creating a duplicate - only
            // `token` actually changes on a refresh. Falls back to creating
            // one if none matched (e.g. the access token cookie was already
            // gone entirely, not just expired).
            const existingSession = token
                ? await UserSession.findOne({ where: { user_id: refreshUser.id, token } })
                : await UserSession.findOne({ where: { user_id: refreshUser.id }, order: [["created_at", "DESC"]] });
            if (existingSession) {
                await existingSession.update({ token: newAccessToken });
            } else {
                await UserSession.create({ user_id: refreshUser.id, device_id: "unknown-refresh", token: newAccessToken });
            }

            res.cookie("token", newAccessToken, {
                httpOnly: true, secure: SECURE_COOKIES, sameSite: "strict", maxAge: 24 * 60 * 60 * 1000
            });
            res.cookie("refreshToken", newRefreshToken, {
                httpOnly: true, secure: SECURE_COOKIES, sameSite: "strict", maxAge: 7 * 24 * 60 * 60 * 1000
            });

            req.user = refreshUser.hotel_id;
            req.userId = refreshUser.id;
            return next();
        }

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
