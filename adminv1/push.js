const { Op } = require("sequelize");
const { AdmSession } = require("../model");

// Push notifications to the sales app on the company phones: every panel
// notification (new lead, escalation, call back, digest...) also goes to the
// signed-in person's phones, so it arrives when the app is closed.
//
// Firebase Cloud Messaging. The sales app (com.billerpe.sales) can live in
// its own Firebase project (SALES_FIREBASE_SERVICE_ACCOUNT_FILE / _B64) or be
// added to the POS App's project, whose key the server already has
// (FIREBASE_SERVICE_ACCOUNT_FILE / _B64). No key = no push; the app still
// shows everything when it is opened.

let messaging; // undefined = not tried yet, null = off
function fcm() {
    if (messaging !== undefined) return messaging;
    messaging = null;
    try {
        const env = process.env;
        let json = null;
        if (env.SALES_FIREBASE_SERVICE_ACCOUNT_FILE) json = require("fs").readFileSync(env.SALES_FIREBASE_SERVICE_ACCOUNT_FILE, "utf8");
        else if (env.SALES_FIREBASE_SERVICE_ACCOUNT_B64) json = Buffer.from(env.SALES_FIREBASE_SERVICE_ACCOUNT_B64, "base64").toString("utf8");
        else if (env.FIREBASE_SERVICE_ACCOUNT_FILE) json = require("fs").readFileSync(env.FIREBASE_SERVICE_ACCOUNT_FILE, "utf8");
        else if (env.FIREBASE_SERVICE_ACCOUNT_B64) json = Buffer.from(env.FIREBASE_SERVICE_ACCOUNT_B64, "base64").toString("utf8");
        if (!json) return null;
        const admin = require("firebase-admin");
        const name = "sales-app";
        const app = admin.apps.find((a) => a && a.name === name) || admin.initializeApp({ credential: admin.credential.cert(JSON.parse(json)) }, name);
        messaging = admin.messaging(app);
    } catch (e) {
        console.error("[adminv1 push] could not start Firebase:", e.message);
    }
    return messaging;
}

/** Tests replace this to see what would be pushed. */
const sender = {
    async send(tokens, message) {
        const m = fcm();
        if (!m) return null;
        return m.sendEachForMulticast({ tokens, ...message });
    },
};

/** Pushes one notification to every phone the person is signed in on. Never throws. */
async function toUser(userId, { title, body = "", link = "", type = "", id = "" }) {
    try {
        const sessions = await AdmSession.findAll({ where: { user_id: userId, kind: "app", revoked_at: null, push_token: { [Op.ne]: null } }, attributes: ["id", "push_token"], raw: true });
        if (!sessions.length) return { sent: 0 };
        const res = await sender.send(sessions.map((x) => x.push_token), {
            notification: { title: String(title).slice(0, 120), body: String(body).slice(0, 300) },
            data: { link: String(link || "/"), type: String(type), id: String(id) },
            android: { priority: "high", notification: { channelId: "alerts", sound: "default", tag: id ? `n-${id}` : undefined } },
        });
        if (!res) return { sent: 0, off: true };
        const dead = (res.responses || []).map((r, i) => (!r.success && /registration-token-not-registered|invalid-registration-token|invalid-argument/.test(r.error?.code || "") ? sessions[i].id : null)).filter(Boolean);
        if (dead.length) await AdmSession.update({ push_token: null }, { where: { id: dead } });
        return { sent: res.successCount || 0 };
    } catch (e) {
        console.error("[adminv1 push]", e.message);
        return { sent: 0, error: e.message };
    }
}

module.exports = { toUser, sender, fcm };
