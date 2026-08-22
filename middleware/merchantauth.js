const createCookieJwtAuth = require("./cookieJwtAuthFactory");
const Merchant = require("../model/merchant");

const merchantAuth = createCookieJwtAuth({
    tokenCookie: "merchantToken",
    refreshCookie: "merchantRefreshToken",
    secretEnvVar: "JWT_SECRET_KEY_MARCHANT",
    lookupUser: (id) => Merchant.findOne({ where: { id } }),
    buildReqUser: (user) => user.id,
});

module.exports = { merchantAuth };
