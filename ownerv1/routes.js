const express = require("express");
const cors = require("cors");
const { RuleError } = require("../appv1/core");
const auth = require("./auth");
const { outlets } = require("./outlets");
const watch = require("./watch");

// BillerPe Owner App API (Plan 1 owners): /owner/v1. Same shape as /app/v1:
// POST /owner/v1/<method> with { args: [...] }, answer { ok: true, result }
// or { ok: false, error }. 401 { code: "session-ended" } sends the app back
// to login. Everything here reads cloud data the outlet PCs have synced; the
// app never bills.

const router = express.Router();

// A native WebView (https://localhost) with a bearer token, never a cookie.
router.use(cors({ origin: true, credentials: false }));
router.options("*", cors({ origin: true, credentials: false }));

const GENERIC = "Something went wrong. Please try again.";

/* ------------------------------ session (no token) ------------------------------ */

router.post("/login", (req, res) => {
    const { mobile, password, device } = req.body || {};
    auth.login({ mobile, password, device }).then((r) => res.json(r), (e) => {
        console.error("[ownerv1] login:", e);
        res.json({ ok: false, error: "network", message: GENERIC });
    });
});

router.post("/resume", (req, res) => {
    const { token, device } = req.body || {};
    auth.resume({ token, device }).then((r) => res.json(r), (e) => {
        console.error("[ownerv1] resume:", e);
        res.json({ ok: false, error: "network", message: GENERIC });
    });
});

/* ------------------------------ everything else ------------------------------ */

router.use(auth.requireOwner);

/** name -> fn(owner, ...args). Every per-outlet handler must call ownOutlet() first. */
const HANDLERS = {
    outlets: (o) => outlets(o),
    logout: (o) => auth.logout(o),
    setPushToken: (o, token) => auth.setPushToken(o, token),
    setLanguage: (o, lang) => auth.setLanguage(o, lang),

    /* phase 1 - watch (view only) */
    home: (o) => watch.home(o),
    outlet: (o, outletId, range) => watch.outlet(o, outletId, range),
    tables: (o, outletId) => watch.tables(o, outletId),
    bills: (o, query) => watch.bills(o, query || {}),
    bill: (o, outletId, billId) => watch.bill(o, outletId, billId),
};

router.post("/:name", (req, res) => {
    const fn = HANDLERS[req.params.name];
    if (!fn) return res.status(404).json({ ok: false, error: "Unknown call" });
    const args = Array.isArray(req.body?.args) ? req.body.args : [];
    Promise.resolve()
        .then(() => fn(req.owner, ...args))
        .then(
            (result) => res.json({ ok: true, result: result ?? {} }),
            (err) => {
                if (err instanceof RuleError) return res.json({ ok: false, error: err.message });
                console.error(`[ownerv1] ${req.params.name}:`, err);
                return res.json({ ok: false, error: GENERIC });
            },
        );
});

module.exports = router;
