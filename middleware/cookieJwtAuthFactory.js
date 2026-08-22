const jwt = require("jsonwebtoken");
const { STATUSCODE, MESSAGE } = require("../constant/const");
const { error } = require("../responce/res");

// Consolidates the token/refreshToken-cookie pattern that captainAuth.js,
// merchantauth.js, and superAdminAuth.js each independently copy-pasted:
// verify the short-lived access-token cookie if it's present AND valid,
// otherwise fall back to the refresh-token cookie and reissue both.
//
// Fixes a bug all 3 originals shared: in the "access token cookie is
// present" branch, each one called `jwt.verify(refreshToken, ...)` instead
// of `jwt.verify(token, ...)` - verifying the wrong cookie's value, so an
// invalid/tampered access token was never actually rejected as long as the
// refresh token was still valid. Also drops the `{ expiresIn: "15m" }`
// third argument every original passed to `jwt.verify` - that option only
// applies to `jwt.sign`, so it was a no-op there.
//
// The access token's own `exp` claim (15s, per how these are signed) is far
// shorter than its cookie's browser-side maxAge (14m), so on every real
// request past the first 15 seconds of a session the access-token cookie is
// present but already expired. Falling back to the refresh token only when
// the access token cookie is *absent* (rather than also on expired/invalid)
// would reject nearly every request past login - so the fallback triggers
// on any access-token verification failure, not just its absence, matching
// what these short expiries were clearly relying on in practice.
//
// `lookupUser` and `buildReqUser` are per-role so this doesn't change what
// `req.user` means for any existing route: captainAuth never looked its
// user up in the DB (trusts the JWT payload as-is), merchantAuth/
// superAdminAuth both reject if the looked-up row is missing.
function createCookieJwtAuth({
    tokenCookie,
    refreshCookie,
    secretEnvVar,
    lookupUser = null, // async (id) => user | null
    buildReqUser = (_user, decoded) => decoded.id,
}) {
    const verify = (value, secret) =>
        new Promise((resolve) => {
            jwt.verify(value, secret, (err, data) => resolve(err ? null : data));
        });

    return async (req, res, next) => {
        try {
            const secret = process.env[secretEnvVar];
            const token = req.cookies?.[tokenCookie];
            const refreshToken = req.cookies?.[refreshCookie];

            if (!token && !refreshToken) {
                return res.json(error(MESSAGE.NOT_AUTHORIZE, STATUSCODE.FORBIDDEN));
            }

            let decoded = token ? await verify(token, secret) : null;
            let reissue = false;

            if (!decoded) {
                if (!refreshToken) {
                    return res.json(error(MESSAGE.NOT_AUTHORIZE, STATUSCODE.FORBIDDEN));
                }
                decoded = await verify(refreshToken, secret);
                if (!decoded) {
                    return res.json(error(MESSAGE.NOT_AUTHORIZE, STATUSCODE.FORBIDDEN));
                }
                reissue = true;
            }

            let user = null;
            if (lookupUser) {
                user = await lookupUser(decoded.id);
                if (!user) return res.json(error(MESSAGE.FAIL, STATUSCODE.BAD_REQUEST));
            }

            if (reissue) {
                const newToken = jwt.sign({ id: decoded.id }, secret, { expiresIn: "15s" });
                const newRefresh = jwt.sign({ id: decoded.id }, secret, { expiresIn: "7d" });
                res.cookie(tokenCookie, newToken, { httpOnly: true, maxAge: 1000 * 60 * 14, sameSite: "lax" });
                res.cookie(refreshCookie, newRefresh, { httpOnly: true, maxAge: 604800000, sameSite: "lax" });
            }

            req.user = buildReqUser(user, decoded);
            next();
        } catch (err) {
            console.log(err);
            return res.json(error(MESSAGE.INVALID_TOKEN, STATUSCODE.INTERNAL_SERVER_ERROR));
        }
    };
}

module.exports = createCookieJwtAuth;
