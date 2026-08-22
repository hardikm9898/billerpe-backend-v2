const createCookieJwtAuth = require("./cookieJwtAuthFactory");

// Same token/refreshToken cookie names as adminAuth.js/captainAuth.js, but a
// different secret (JWT_SECRET_KEY_USER) and no DB lookup - matches the
// original isAuth exactly (which also never looked its user up).
const isAuth = createCookieJwtAuth({
    tokenCookie: "token",
    refreshCookie: "refreshToken",
    secretEnvVar: "JWT_SECRET_KEY_USER",
});

module.exports = isAuth;
