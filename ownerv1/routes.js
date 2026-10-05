const express = require("express");
const cors = require("cors");
const { RuleError } = require("../appv1/core");
const auth = require("./auth");
const { outlets } = require("./outlets");
const watch = require("./watch");
const reports = require("./reports");
const manage = require("./manage");

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

    /* phase 3 - manage (changes reach the outlet PC through its sync pull) */
    manage: (o, outletId) => manage.manage(o, outletId),
    manageMenu: (o, outletId) => manage.menu(o, outletId),
    manageStaff: (o, outletId) => manage.staff(o, outletId),
    manageTables: (o, outletId) => manage.tables(o, outletId),
    manageSettings: (o, outletId) => manage.settings(o, outletId),
    manageStock: (o, outletId) => manage.stockMasters(o, outletId),
    setItemActive: (o, outletId, itemId, active) => manage.setItemActive(o, outletId, itemId, active),
    saveItem: (o, outletId, item) => manage.saveItem(o, outletId, item || {}),
    deleteItem: (o, outletId, itemId) => manage.deleteItem(o, outletId, itemId),
    saveCategory: (o, outletId, cat) => manage.saveCategory(o, outletId, cat || {}),
    saveStaff: (o, outletId, s) => manage.saveStaff(o, outletId, s || {}),
    setStaffActive: (o, outletId, staffId, active) => manage.setStaffActive(o, outletId, staffId, active),
    setStaffPermissions: (o, outletId, staffId, perms) => manage.setStaffPermissions(o, outletId, staffId, perms ?? null),
    saveSection: (o, outletId, s) => manage.saveSection(o, outletId, s || {}),
    deleteSection: (o, outletId, sectionId) => manage.deleteSection(o, outletId, sectionId),
    addTables: (o, outletId, sectionId, spec, seats) => manage.addTables(o, outletId, sectionId, spec, seats),
    editTable: (o, outletId, tableId, patch) => manage.editTable(o, outletId, tableId, patch || {}),
    removeTable: (o, outletId, tableId) => manage.removeTable(o, outletId, tableId),
    saveTax: (o, outletId, t) => manage.saveTax(o, outletId, t || {}),
    saveCharge: (o, outletId, which, rule) => manage.saveCharge(o, outletId, which, rule || {}),
    savePaymentMode: (o, outletId, m) => manage.savePaymentMode(o, outletId, m || {}),
    savePromo: (o, outletId, p) => manage.savePromo(o, outletId, p || {}),
    saveExpenseHead: (o, outletId, h) => manage.saveExpenseHead(o, outletId, h || {}),
    saveRaw: (o, outletId, r) => manage.saveRaw(o, outletId, r || {}),
    saveSupplier: (o, outletId, s) => manage.saveSupplier(o, outletId, s || {}),
    saveUnit: (o, outletId, u) => manage.saveUnit(o, outletId, u || {}),

    /* phase 2 - reports */
    reportCatalog: () => reports.catalog(),
    report: (o, query) => reports.report(o, query || {}),
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
