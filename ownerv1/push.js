const { Op } = require("sequelize");
const { OwnerDevice } = require("../model");

// Push notifications to owners' phones. The Owner App has its OWN Firebase
// project (billerpeowner), separate from the POS App's, so it runs as a
// named firebase-admin app ("owner-app") beside the POS App's default one.
//
// Off until the server has that project's service-account key, in one of:
//   OWNER_FIREBASE_SERVICE_ACCOUNT_FILE=/path/to/billerpeowner-service-account.json
//   OWNER_FIREBASE_SERVICE_ACCOUNT_B64=<the JSON file, base64>

const APP_NAME = "owner-app";
let messaging; // undefined = not tried yet, null = off

function fcm() {
    if (messaging !== undefined) return messaging;
    messaging = null;
    try {
        let json = null;
        if (process.env.OWNER_FIREBASE_SERVICE_ACCOUNT_FILE) json = require("fs").readFileSync(process.env.OWNER_FIREBASE_SERVICE_ACCOUNT_FILE, "utf8");
        else if (process.env.OWNER_FIREBASE_SERVICE_ACCOUNT_B64) json = Buffer.from(process.env.OWNER_FIREBASE_SERVICE_ACCOUNT_B64, "base64").toString("utf8");
        if (!json) {
            console.log("[owner-push] off: no OWNER_FIREBASE_SERVICE_ACCOUNT_FILE / _B64");
            return null;
        }
        const admin = require("firebase-admin");
        const existing = admin.apps.find((a) => a && a.name === APP_NAME);
        const app = existing || admin.initializeApp({ credential: admin.credential.cert(JSON.parse(json)) }, APP_NAME);
        messaging = admin.messaging(app);
    } catch (e) {
        console.error("[owner-push] could not start Firebase:", e.message);
    }
    return messaging;
}

const DEAD_TOKEN = /registration-token-not-registered|invalid-registration-token|invalid-argument/;

/**
 * Sends one notification to every phone this owner (10-digit mobile) is
 * logged in on. link = the app route to open when tapped.
 */
async function pushToOwner(mobile, { title, body, link, kind }) {
    const m = fcm();
    if (!m) return { sent: 0, off: true };
    const devices = await OwnerDevice.findAll({
        where: { owner_mobile: String(mobile), status: "active", push_token: { [Op.ne]: null } },
        attributes: ["id", "push_token"],
        raw: true,
    });
    if (!devices.length) return { sent: 0 };
    const res = await m.sendEachForMulticast({
        tokens: devices.map((d) => d.push_token),
        notification: { title, body: body || "" },
        data: { link: link || "/alerts", kind: kind || "" },
        android: { priority: "high", notification: { channelId: "alerts", sound: "default" } },
    });
    // A token Firebase no longer knows (app uninstalled / data cleared) is forgotten.
    const dead = res.responses.map((r, i) => (!r.success && DEAD_TOKEN.test(r.error?.code || "") ? devices[i].id : null)).filter(Boolean);
    if (dead.length) await OwnerDevice.update({ push_token: null }, { where: { id: dead } });
    return { sent: res.successCount, failed: res.failureCount };
}

module.exports = { pushToOwner, fcm };
