const express = require("express");
const router = express.Router();

const { deviceAuth } = require("../middleware/deviceAuth");
const { heartbeat, pull, push, pushOrders } = require("../controller/sync/syncController");
const { getManifest, getFile } = require("../controller/sync/webBundleController");

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

// The Web POS frontend an outlet's exe serves off its own disk. Requested
// only when the heartbeat above reports a version the exe does not already
// have, so these cost nothing in steady state - see
// WEB-BUNDLE-DELIVERY-PLAN.md and controller/sync/webBundleController.js.
router.get("/web-bundle/manifest", deviceAuth, getManifest);
router.get("/web-bundle/file", deviceAuth, getFile);

module.exports = router;
