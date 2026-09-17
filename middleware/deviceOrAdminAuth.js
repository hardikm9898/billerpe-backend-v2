const { deviceAuth, DEVICE_TOKEN_TYPE } = require("./deviceAuth");
const { adminAuth } = require("./adminAuth");
const jwt = require("jsonwebtoken");
require("dotenv").config();

// For the handful of hotel-scoped endpoints that BOTH a person and a
// restaurant's local exe legitimately call: sending an e-bill, reading and
// writing reservations, the shared stock-image catalogue, rotating a table's
// QR, and the invoice/KOT header-footer settings.
//
// The exe reaches these through its own relay (services/cloudRelay.js)
// because a browser logged into the exe has no session for this origin. It
// used to relay them with the OWNER's cookie, which is exactly the
// credential that dies when the owner logs in elsewhere - the same root
// cause that broke background sync. With this middleware the exe can use its
// device token for these too, and nothing about how a person's session works
// changes: an ordinary request with no device token falls through to
// adminAuth unchanged.
//
// A device token resolves a HOTEL, not a person, so req.userId is left
// undefined. The only fields that read it here are audit columns
// (TableBooking.enter_by/modified_by), which are nullable - recording "no
// individual staff member" for an automated call is accurate, whereas
// attributing it to whoever last logged in would not be.
const deviceOrAdminAuth = (req, res, next) => {
    const header = req.headers.authorization;
    const bearer = typeof header === "string" && header.startsWith("Bearer ") ? header.slice(7) : null;
    const candidate = bearer || (typeof req.headers["x-device-token"] === "string" ? req.headers["x-device-token"] : null);

    if (candidate) {
        // Only hand off to deviceAuth when the token really is a device
        // token; a staff access token arrives in the same header and must
        // still be handled by adminAuth (which also honours its refresh
        // cookie).
        let looksLikeDeviceToken = false;
        try {
            looksLikeDeviceToken = jwt.decode(candidate)?.typ === DEVICE_TOKEN_TYPE;
        } catch {
            looksLikeDeviceToken = false;
        }
        if (looksLikeDeviceToken) return deviceAuth(req, res, next);
    }
    return adminAuth(req, res, next);
};

module.exports = { deviceOrAdminAuth };
