const jwt = require("jsonwebtoken");
require("dotenv").config();
const { STATUSCODE, MESSAGE } = require("../constant/const");
const { error } = require("../responce/res");
const { LocalServerRegistration } = require("../model");

// Auth for a restaurant's local exe doing background sync - NOT for a
// person. This exists because the exe used to authenticate every sync call
// as the outlet OWNER, using the cookie pair from restaurantLogin. That
// session is inherently unstable for a machine: restaurantLogin overwrites
// HotelUser.refresh_token on every login and caps sessions per user, so the
// owner simply logging into the cloud on their phone silently killed the
// exe's ability to sync, surfacing to staff as "device may need
// re-registration" in the middle of service. No timer or refresh loop can
// fix that; the credential itself had to stop being a human's session.
//
// The token is a JWT with no expiry, carrying the hotel, the device and the
// installation it was issued for. It is not a bearer secret that lives
// forever regardless: every request re-checks it against the registration
// row, so it stops working the moment that registration is released by a
// SuperAdmin or superseded by another PC taking over the outlet (both mint
// a fresh installation_id - see controller/localServerRegistration.js).
const DEVICE_TOKEN_TYPE = "local-server";

function signDeviceToken({ hotel_id, device_id, installation_id }) {
    return jwt.sign(
        { typ: DEVICE_TOKEN_TYPE, hotel_id, device_id, installation_id },
        process.env.JWT_SECRET_KEY_ADMIN,
        // Deliberately no expiresIn: an unattended on-premise server has no
        // one to re-authenticate it, and revocation is handled by the
        // registration check below, which is strictly stronger than an
        // expiry window would be.
    );
}

function readToken(req) {
    const header = req.headers.authorization;
    if (typeof header === "string" && header.startsWith("Bearer ")) return header.slice(7);
    if (typeof req.headers["x-device-token"] === "string") return req.headers["x-device-token"];
    return null;
}

const deviceAuth = async (req, res, next) => {
    try {
        const token = readToken(req);
        if (!token) {
            return res.status(STATUSCODE.UNAUTHORIZED).json(error("Device token required", STATUSCODE.UNAUTHORIZED));
        }

        let decoded;
        try {
            decoded = jwt.verify(token, process.env.JWT_SECRET_KEY_ADMIN);
        } catch {
            return res.status(STATUSCODE.UNAUTHORIZED).json(error("Invalid device token", STATUSCODE.UNAUTHORIZED));
        }
        if (decoded?.typ !== DEVICE_TOKEN_TYPE) {
            // A staff/owner access token must not be usable here: these
            // endpoints write on behalf of a whole outlet.
            return res.status(STATUSCODE.UNAUTHORIZED).json(error("Not a device token", STATUSCODE.UNAUTHORIZED));
        }

        const registration = await LocalServerRegistration.findOne({
            where: { hotel_id: decoded.hotel_id, device_id: decoded.device_id, status: "active" },
        });
        if (!registration) {
            return res.status(STATUSCODE.UNAUTHORIZED).json(error(
                "This device is no longer the registered local server for this restaurant - register it again.",
                STATUSCODE.UNAUTHORIZED,
            ));
        }
        if (registration.installation_id !== decoded.installation_id) {
            return res.status(STATUSCODE.UNAUTHORIZED).json(error(
                "This device's registration was replaced - register it again to resume syncing.",
                STATUSCODE.UNAUTHORIZED,
            ));
        }

        // Same convention as adminAuth so controllers read identically.
        req.user = decoded.hotel_id;
        req.deviceId = decoded.device_id;
        req.registration = registration;
        return next();
    } catch (err) {
        console.error("deviceAuth error:", err);
        return res.status(STATUSCODE.UNAUTHORIZED).json(error(MESSAGE.NOT_AUTHORIZE, STATUSCODE.UNAUTHORIZED));
    }
};

module.exports = { deviceAuth, signDeviceToken, DEVICE_TOKEN_TYPE };
