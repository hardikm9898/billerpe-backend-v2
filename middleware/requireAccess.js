const UserAccess = require("../model/userAccess");
const { STATUSCODE, MESSAGE } = require("../constant/const");
const { error } = require("../responce/res");
const logger = require("../utils/logger");

// The permission matrix (hms_user_access: 10 modules x read/create/edit/
// delete per staff member) has always been computed and returned to the
// client, but never checked server-side on any endpoint - the single
// biggest authorization gap flagged in this system's audit. This is that
// check, added incrementally per route rather than globally, and starting
// in log-only mode.
//
// Log-only by default (set PERMISSION_ENFORCEMENT_MODE=enforce to actually
// block) because turning this on cold, hard-blocking, would break any
// existing caller - old frontend, mobile app, anyone testing locally -
// that isn't already scoped exactly the way the (never-before-enforced)
// UserAccess rows say it should be. Log-only surfaces what WOULD be
// blocked so real mismatches can be found and fixed before enforcement is
// switched on.
const ENFORCE = process.env.PERMISSION_ENFORCEMENT_MODE === "enforce";

// moduleName must match an hms_user_access.access_name value, e.g. "Menu",
// "Table", "User" (see the seed list in controller/hotel.js's hotel-signup
// flow for the full set). action is one of read/create/edit/delete.
function requireAccess(moduleName, action) {
    return async (req, res, next) => {
        try {
            // Only meaningful on adminAuth/mobileAuth-gated routes, which are
            // the only ones that set req.userId (a hms_hotelUser_masters.id).
            // Routes gated by isAuth/captainAuth/merchantAuth/superAdminAuth
            // don't have an equivalent per-module UserAccess concept, so there
            // is nothing to check - let them through unaffected.
            const hotelUserId = req.userId;
            if (!hotelUserId) return next();

            const access = await UserAccess.findOne({
                where: { hotelUser_id: hotelUserId, access_name: moduleName },
            });
            const allowed = access ? !!access[action] : false;

            if (!allowed) {
                logger.warn(
                    `Permission ${ENFORCE ? "denied" : "would be denied (log-only)"}: hotelUser ${hotelUserId} lacks ${moduleName}.${action}`,
                    { hotelUserId, moduleName, action, path: req.originalUrl, hadAccessRow: !!access },
                );
                if (ENFORCE) {
                    return res.json(error(MESSAGE.NOT_ACCESS, STATUSCODE.FORBIDDEN));
                }
            }

            next();
        } catch (err) {
            // Fail open: a bug in the permission check itself should not take
            // down a route that worked fine before this was added.
            logger.error("requireAccess check failed, allowing request through", { err: err.message });
            next();
        }
    };
}

module.exports = requireAccess;
