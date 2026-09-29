const { Op } = require("sequelize");
const M = require("../model");
const { parseJson, resolveRole } = require("./core");

// Push notifications for the POS App (owner list 2026-09-29 #9): every app
// alert (food ready, bill requested, QR order, reservation due, owner alerts)
// also goes to the phones that should see it, so it arrives when the app is
// closed. Firebase Cloud Messaging via firebase-admin.
//
// Off until the server has the Firebase service-account key, in one of:
//   FIREBASE_SERVICE_ACCOUNT_FILE=/path/to/service-account.json
//   FIREBASE_SERVICE_ACCOUNT_B64=<the JSON file, base64>
// Without it alerts still work in the app; they just aren't pushed.

let messaging; // undefined = not tried yet, null = off
function fcm() {
    if (messaging !== undefined) return messaging;
    messaging = null;
    try {
        let json = null;
        if (process.env.FIREBASE_SERVICE_ACCOUNT_FILE) json = require("fs").readFileSync(process.env.FIREBASE_SERVICE_ACCOUNT_FILE, "utf8");
        else if (process.env.FIREBASE_SERVICE_ACCOUNT_B64) json = Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_B64, "base64").toString("utf8");
        if (!json) {
            console.log("[push] off: no FIREBASE_SERVICE_ACCOUNT_FILE / _B64");
            return null;
        }
        const admin = require("firebase-admin");
        const app = admin.apps.length ? admin.app() : admin.initializeApp({ credential: admin.credential.cert(JSON.parse(json)) });
        messaging = admin.messaging(app);
    } catch (e) {
        console.error("[push] could not start Firebase:", e.message);
    }
    return messaging;
}

/** The same rule the app uses to show an alert (load.js): named user, else roles; the owner sees all. */
function sees(alert, userId, role) {
    if (alert.for_user_id != null && Number(alert.for_user_id) !== Number(userId)) return false;
    const roles = alert.for_roles ? parseJson(alert.for_roles, []) || [] : [];
    return !roles.length || roles.includes(role) || role === "Owner";
}

/** Tokens of the outlet's active phones whose signed-in person should see this alert. */
async function targetsFor(alert) {
    const devices = await M.AppDevice.findAll({
        where: { hotel_id: alert.hotel_id, status: "active", push_token: { [Op.ne]: null } },
        attributes: ["id", "push_token", "hotel_user_id"],
        raw: true,
    });
    if (!devices.length) return [];
    const users = await M.HotelUser.findAll({
        where: { id: [...new Set(devices.map((d) => d.hotel_user_id).filter(Boolean))], hotel_id: alert.hotel_id },
        include: M.Role,
    });
    const byId = new Map(users.map((u) => [u.id, u]));
    return devices.filter((d) => {
        const u = byId.get(d.hotel_user_id);
        return u && u.active !== false && sees(alert, u.id, resolveRole(u.role_mst?.role_name));
    });
}

async function pushAlert(alert) {
    const m = fcm();
    if (!m) return { sent: 0, off: true };
    const devices = await targetsFor(alert);
    if (!devices.length) return { sent: 0 };
    const res = await m.sendEachForMulticast({
        tokens: devices.map((d) => d.push_token),
        notification: { title: alert.title, body: alert.body || "" },
        data: { link: alert.link || "/alerts", alertId: String(alert.id), kind: alert.kind },
        android: { priority: "high", notification: { channelId: "alerts", sound: "default", tag: `alert-${alert.id}` } },
    });
    // A token Firebase no longer knows (app uninstalled / data cleared) is forgotten.
    const dead = res.responses
        .map((r, i) => (!r.success && /registration-token-not-registered|invalid-registration-token|invalid-argument/.test(r.error?.code || "") ? devices[i].id : null))
        .filter(Boolean);
    if (dead.length) await M.AppDevice.update({ push_token: null }, { where: { id: dead } });
    return { sent: res.successCount, failed: res.failureCount };
}

module.exports = { pushAlert, targetsFor, sees };
