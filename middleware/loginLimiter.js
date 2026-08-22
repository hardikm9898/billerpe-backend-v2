const rateLimit = require("express-rate-limit");
const { ipKeyGenerator } = require("express-rate-limit");
const { error } = require("../responce/res")

const data = error("Too many login attempts. Please try again after 5 minutes.", 429)

// Shared across every login endpoint (admin, user, captain, mobile, merchant, super admin)
// so brute-forcing any one of them is throttled the same way. Previously only
// /restaurantLogin had this applied.
const loginLimiter = rateLimit({
    windowMs: 5 * 60 * 1000,
    max: 5,
    message: data,
    keyGenerator: (req, res) => {
        const userKey = req.body.mobile || req.body.email || req.body.phoneNumber || req.body.number;
        if (userKey) return `user:${userKey}`;
        return ipKeyGenerator(req);
    },
    standardHeaders: true,
    legacyHeaders: false
});

module.exports = loginLimiter
