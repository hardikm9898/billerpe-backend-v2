const createCookieJwtAuth = require("./cookieJwtAuthFactory");
const SuperAdminUser = require("../model/superAdminModel");

// Cookie names are "demo"/"demo2" (not "token"/"refreshToken") - kept as-is,
// every route already expects these exact cookie names to be set on login.
const superAdminAuth = createCookieJwtAuth({
    tokenCookie: "demo",
    refreshCookie: "demo2",
    secretEnvVar: "JWT_SECRET_KEY_SUPER_ADMIN",
    lookupUser: (id) => SuperAdminUser.findOne({ where: { id } }),
    buildReqUser: (user) => user.id,
});

module.exports = superAdminAuth;
