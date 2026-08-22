const createCookieJwtAuth = require("./cookieJwtAuthFactory");

// Captain sessions are validated by JWT alone - no DB lookup, matching the
// original behavior (this middleware never queried a captain's User row).
const CaptainAuth = createCookieJwtAuth({
    tokenCookie: "token",
    refreshCookie: "refreshToken",
    secretEnvVar: "JWT_SECRET_KEY_CAPTAIN",
});

module.exports = CaptainAuth;
