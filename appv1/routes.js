const express = require("express");
const cors = require("cors");
const M = require("../model");
const { RuleError, mutate } = require("./core");
const auth = require("./auth");
const orders = require("./orders");
const { load } = require("./load");

// BillerPe POS App API (Plan 2): /app/v1. One POST per PosBackend method
// (BillerPe POS App src/lib/pos/backend/types.ts) - body { args: [...] },
// answer { ok: true, result } or { ok: false, error }. A business-rule
// refusal is a normal answer (200), never an HTTP error, so the app shows
// the message; 401 { code: "session-ended" } sends it back to login.
//
// Every write runs in mutate(): one transaction holding the outlet lock,
// and a clientKey (Send KOT, settle...) makes a retried tap apply once.

const router = express.Router();

// The app is a native WebView (https://localhost / capacitor://localhost)
// and authenticates with a bearer token only - never a cookie - so any
// origin may call it.
router.use(cors({ origin: true, credentials: false }));
router.options("*", cors({ origin: true, credentials: false }));

const GENERIC = "Something went wrong. Please try again.";

function send(res, promise) {
    promise.then(
        (result) => res.json({ ok: true, result: result ?? {} }),
        (err) => {
            if (err instanceof RuleError) return res.json({ ok: false, error: err.message });
            console.error("[appv1]", err);
            return res.json({ ok: false, error: GENERIC });
        },
    );
}

/* ------------------------------ session (no token) ------------------------------ */

router.post("/login/password", (req, res) => {
    const { mobile, password, device } = req.body || {};
    auth.loginWithPassword({ mobile, password, device }).then((r) => res.json(r), (e) => {
        console.error("[appv1] login:", e);
        res.json({ ok: false, error: "network", message: GENERIC });
    });
});

router.post("/login/pin", (req, res) => {
    const { staffId, pin, device } = req.body || {};
    auth.loginWithPin({ staffId, pin, device }).then((r) => res.json(r), (e) => {
        console.error("[appv1] pin:", e);
        res.json({ ok: false, error: "network", message: GENERIC });
    });
});

router.post("/resume", (req, res) => {
    const { token, device } = req.body || {};
    auth.resume({ token, device }).then((r) => res.json(r), (e) => {
        console.error("[appv1] resume:", e);
        res.json({ ok: false, error: "network", message: GENERIC });
    });
});

/* ------------------------------ everything else ------------------------------ */

router.use(auth.requireApp);

/**
 * name -> { write, fn(c, ...args), key(args) }.
 * write: runs inside mutate(); key: where the one-time clientKey is.
 */
const HANDLERS = {
    /* session & data */
    load: { fn: (c) => load(c) },
    shiftStaff: { fn: (c) => auth.shiftStaff(c) },
    selectOutlet: { fn: (c, outletId) => auth.selectOutlet(c, outletId) },
    logout: { fn: async () => ({}) },

    /* orders */
    sendKot: { write: true, fn: (c, cart) => orders.sendKot(c, cart), key: ([cart]) => cart?.clientKey },
    holdOrder: { write: true, fn: (c, cart) => orders.holdOrder(c, cart), key: ([cart]) => cart?.clientKey },
    setGuests: { write: true, fn: (c, id, guests) => orders.setGuests(c, id, guests) },
    setCustomer: { write: true, fn: (c, id, name, mobile) => orders.setCustomer(c, id, name, mobile) },
    removeLine: { write: true, fn: (c, id, lineId, reason) => orders.removeLine(c, id, lineId, reason) },
    markServed: { write: true, fn: (c, id, kotNo) => orders.markServed(c, id, kotNo) },
    requestBill: { write: true, fn: (c, id) => orders.requestBill(c, id) },
    printBill: { write: true, fn: (c, id) => orders.printBill(c, id) },
    cancelOrder: { write: true, fn: (c, id, reason) => orders.cancelOrder(c, id, reason) },
    transferTable: { write: true, fn: (c, id, to) => orders.transferTable(c, id, to) },
    mergeTables: { write: true, fn: (c, from, to) => orders.mergeTables(c, from, to) },
    moveKot: { write: true, fn: (c, id, kotNo, to) => orders.moveKot(c, id, kotNo, to) },
    setDiscount: { write: true, fn: (c, id, d) => orders.setDiscount(c, id, d) },
    applyPromo: { write: true, fn: (c, id, code) => orders.applyPromo(c, id, code) },
    setServiceCharge: { write: true, fn: (c, id, amount) => orders.setServiceCharge(c, id, amount) },
    settle: { write: true, fn: (c, id, input) => orders.settle(c, id, input), key: ([, input]) => input?.clientKey },
    counterOrder: { write: true, fn: (c, input) => orders.counterOrder(c, input), key: ([input]) => input?.clientKey },
    reopenSettled: { write: true, fn: (c, id) => orders.reopenSettled(c, id) },
    // Calls WhatsApp: never inside the outlet lock.
    sendEbill: { fn: (c, id, mobile) => orders.sendEbill(c, id, mobile) },
    markPickupReady: { write: true, fn: (c, id, ready) => orders.markPickupReady(c, id, ready) },
    logReprint: { write: true, fn: (c, id, what) => orders.logReprint(c, id, what) },
    kdsAdvance: { write: true, fn: (c, id, kotNo, kitchenId, lineId) => orders.kdsAdvance(c, id, kotNo, kitchenId, lineId) },
    kdsRecall: { write: true, fn: (c, id, kotNo, kitchenId) => orders.kdsRecall(c, id, kotNo, kitchenId) },
    decideQr: { write: true, fn: (c, qrId, decisions) => orders.decideQr(c, qrId, decisions) },
};

/** Domains (front of house, money, menu, tables, staff, settings, stock, reports) add theirs. */
function register(handlers) {
    for (const [name, h] of Object.entries(handlers)) {
        if (HANDLERS[name]) throw new Error(`appv1: handler ${name} registered twice`);
        HANDLERS[name] = h;
    }
}
// Domain modules, each { name: handler }:
for (const mod of ["./domains/frontOfHouse", "./domains/money", "./domains/catalog", "./domains/admin", "./domains/stock", "./domains/reports"]) register(require(mod));

/**
 * GET /app/v1/version - a cheap fingerprint of the outlet's live state. The
 * app polls it every few seconds and reloads only when it changes (other
 * phones' KOTs, the kitchen marking food ready, a QR round arriving...).
 */
router.get("/version", (req, res) => {
    const h = req.ctx.hotelId;
    const max = (Model, where = {}) => Model.max("updatedAt", { where: { hotel_id: h, ...where } }).then((d) => (d ? new Date(d).getTime() : 0));
    send(res, Promise.all([
        max(M.Order), max(M.OrderDetails), max(M.Table), max(M.QrOrder), max(M.AppAlert), max(M.TableBooking), max(M.AppQueueEntry),
        max(M.Menu), max(M.CashSession), max(M.HotelUser), max(M.AppDevice),
        M.Hotel.findOne({ where: { id: h }, attributes: ["updatedAt"], raw: true }).then((x) => (x?.updatedAt ? new Date(x.updatedAt).getTime() : 0)),
        M.OrderDetails.count({ where: { hotel_id: h } }),
    ]).then((parts) => ({ v: parts.join(".") })));
});

router.post("/:name", (req, res) => {
    const h = HANDLERS[req.params.name];
    if (!h) return res.status(404).json({ ok: false, error: "Unknown call" });
    const args = Array.isArray(req.body?.args) ? req.body.args : [];
    const c = req.ctx;
    const run = h.write ? mutate(c, (tc) => h.fn(tc, ...args), h.key ? h.key(args) : undefined) : h.fn(c, ...args);
    send(res, Promise.resolve(run));
});

module.exports = router;
module.exports.HANDLERS = HANDLERS;
module.exports.register = register;
