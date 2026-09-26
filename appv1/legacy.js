const { RuleError } = require("./core");

// Runs an existing cloud controller (written for the Web POS / dashboard,
// req.user = hotel_id, req.userId = staff id) on behalf of a POS App call,
// so features that already exist on the cloud (e-bill WhatsApp + credits,
// reports...) are reused, not re-implemented. Always scoped to the app
// session's own outlet - the caller never picks the hotel.
function callController(handler, c, { body = {}, query = {}, params = {} } = {}) {
    return new Promise((resolve, reject) => {
        const req = { user: c.hotelId, userId: c.userId, body, query, params, headers: {}, cookies: {} };
        let statusCode = 200;
        const res = {
            status(code) {
                statusCode = code;
                return res;
            },
            json(payload) {
                if (payload && payload.error) reject(new RuleError(payload.message || payload.results?.message || "Something went wrong. Please try again."));
                else resolve(payload?.results ?? payload);
                return res;
            },
            send(payload) {
                return res.json(payload);
            },
            cookie() {
                return res;
            },
            clearCookie() {
                return res;
            },
            get statusCode() {
                return statusCode;
            },
        };
        Promise.resolve(handler(req, res)).catch(reject);
    });
}

module.exports = { callController };
