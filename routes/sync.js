const express = require("express");
const router = express.Router();

const { deviceAuth } = require("../middleware/deviceAuth");
const { heartbeat, pull, push, pushOrders, rebaseLocalIds } = require("../controller/sync/syncController");
const { getManifest, getFile } = require("../controller/sync/webBundleController");
const { createTicket, listTickets } = require("../controller/sync/supportController");
const { downloadHistory, linkHistory } = require("../controller/sync/historyController");
const { getFile: getExeReleaseFile } = require("../controller/sync/exeReleaseController");
const { listDownloads, getFile: getAppDownloadFile } = require("../controller/sync/appDownloadController");
const { pushStock } = require("../controller/sync/stockController");

// Sync engine v2 - the complete surface a restaurant's local exe uses for
// background sync, and the only routes that accept a device token
// (middleware/deviceAuth.js) rather than a person's session.
//
// An outlet's whole steady-state cloud traffic is now: one heartbeat a
// minute, a pull only for entities that heartbeat reported as changed, and
// one push cycle every few minutes. Everything else the exe used to call on
// a timer - ten /offline* endpoints, the manifest, a QR-order poll, a
// reservations poll and a session-refresh ping - is either folded into the
// heartbeat or driven by it.
router.get("/heartbeat", deviceAuth, heartbeat);
router.get("/pull", deviceAuth, pull);
router.post("/push", deviceAuth, push);
router.post("/push/orders", deviceAuth, pushOrders);
// Stock levels + daily ledger totals for the Owner App (upload only).
router.post("/push/stock", deviceAuth, pushStock);
router.post("/rebase", deviceAuth, rebaseLocalIds);
// Past orders + customers for a PC that has just registered, and the link
// back to the local ids it stored them under (controller/sync/historyController.js).
router.get("/history", deviceAuth, downloadHistory);
router.post("/history/link", deviceAuth, linkHistory);

// The Web POS frontend an outlet's exe serves off its own disk. Requested
// only when the heartbeat above reports a version the exe does not already
// have, so these cost nothing in steady state - see
// WEB-BUNDLE-DELIVERY-PLAN.md and controller/sync/webBundleController.js.
router.get("/web-bundle/manifest", deviceAuth, getManifest);
router.get("/web-bundle/file", deviceAuth, getFile);
// A new exe kept on this server's disk (when it is not in S3) - see
// controller/sync/exeReleaseController.js.
router.get("/exe-release/file", deviceAuth, getExeReleaseFile);
// Installer + Captain App APK offered on the outlet's Web POS (Operations ->
// Apps & Downloads) - controller/sync/appDownloadController.js.
router.get("/app-downloads", deviceAuth, listDownloads);
router.get("/app-downloads/file", deviceAuth, getAppDownloadFile);

// Support tickets raised from the outlet's Web POS, forwarded by the exe
// (controller/sync/supportController.js). Only when staff raise one.
router.post("/support/ticket", deviceAuth, createTicket);
router.get("/support/tickets", deviceAuth, listTickets);

module.exports = router;
