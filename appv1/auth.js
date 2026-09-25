const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { Hotel, HotelUser, Role, AppDevice } = require("../model");
const { buildContext, resolveRole } = require("./core");

// Sessions for the BillerPe POS App. A device token never expires (owner
// goal: no surprise re-logins mid-service); it stops working when the owner
// logs the device out (AppDevice.status = revoked), the staff member is
// switched off, or the outlet leaves the CLOUD_APP plan.

const SECRET = () => process.env.APP_JWT_SECRET || process.env.JWT_SECRET_KEY_ADMIN;

const sign = (hotelId, userId, deviceId) => jwt.sign({ typ: "pos-app", hid: hotelId, uid: userId, did: deviceId }, SECRET());

function staffView(u) {
    return {
        id: String(u.id),
        name: u.name,
        mobile: u.number,
        role: resolveRole(u.role_mst?.role_name),
        active: u.active !== false,
        isOwner: resolveRole(u.role_mst?.role_name) === "Owner",
    };
}

/** Plan + subscription gate, shared by every login path. */
function outletGate(hotel) {
    if (!hotel || hotel.active === false) return { ok: false, error: "inactive", message: "This outlet is switched off." };
    if (hotel.product_plan !== "CLOUD_APP") return { ok: false, error: "plan-mismatch" };
    if (hotel.plan_end_date && new Date(hotel.plan_end_date) < new Date()) return { ok: false, error: "subscription-expired" };
    return null;
}

const cleanDevice = (d = {}) => ({
    device_id: String(d.deviceId || "").slice(0, 64),
    name: String(d.name || "Phone").slice(0, 80),
    make: String(d.make || "").slice(0, 60),
    model: String(d.model || "").slice(0, 60),
    android: String(d.android || "").slice(0, 20),
    app_version: String(d.appVersion || "").slice(0, 20),
});

/** Registers (or re-uses) this device for the outlet, within the per-outlet limit. */
async function registerDevice(hotel, user, device) {
    const d = cleanDevice(device);
    if (!d.device_id) return { ok: false, error: "network", message: "This device has no id. Reinstall the app." };
    const existing = await AppDevice.findOne({ where: { hotel_id: hotel.id, device_id: d.device_id } });
    if (existing && existing.status === "active") {
        await existing.update({ ...d, hotel_user_id: user.id, last_active: new Date() });
        return null;
    }
    const inUse = await AppDevice.count({ where: { hotel_id: hotel.id, status: "active" } });
    if (inUse >= (hotel.app_device_limit || 0)) {
        return { ok: false, error: "device-limit", message: `This outlet allows ${hotel.app_device_limit} devices.` };
    }
    if (existing) await existing.update({ ...d, status: "active", hotel_user_id: user.id, last_active: new Date() });
    else await AppDevice.create({ ...d, hotel_id: hotel.id, hotel_user_id: user.id, last_active: new Date(), printers: "[]" });
    return null;
}

async function session(hotel, user, device) {
    return { ok: true, session: { token: sign(hotel.id, user.id, String(device.deviceId)), user: staffView(user), deviceId: String(device.deviceId) } };
}

async function loginWithPassword({ mobile, password, device }) {
    const user = await HotelUser.findOne({ where: { number: String(mobile || "").trim() }, include: Role });
    if (!user || !user.password || !(await bcrypt.compare(String(password || ""), user.password))) return { ok: false, error: "wrong-password" };
    if (user.active === false) return { ok: false, error: "inactive" };
    const hotel = await Hotel.findOne({ where: { id: user.hotel_id } });
    const gate = outletGate(hotel);
    if (gate) return gate;
    const blocked = await registerDevice(hotel, user, device);
    if (blocked) return blocked;
    return session(hotel, user, device);
}

/** PIN works only on a device this outlet already registered with a password login. */
async function loginWithPin({ staffId, pin, device }) {
    const user = await HotelUser.findOne({ where: { id: Number(staffId) || 0 }, include: Role });
    if (!user) return { ok: false, error: "wrong-pin" };
    const known = await AppDevice.findOne({ where: { hotel_id: user.hotel_id, device_id: String(device?.deviceId || ""), status: "active" } });
    if (!known) return { ok: false, error: "wrong-pin", message: "Log in with your password once on this device first." };
    if (!user.pin || !(await bcrypt.compare(String(pin || ""), user.pin))) return { ok: false, error: "wrong-pin" };
    if (user.active === false) return { ok: false, error: "inactive" };
    const hotel = await Hotel.findOne({ where: { id: user.hotel_id } });
    const gate = outletGate(hotel);
    if (gate) return gate;
    await known.update({ hotel_user_id: user.id, last_active: new Date() });
    return session(hotel, user, device);
}

async function verify(token) {
    try {
        const p = jwt.verify(String(token || ""), SECRET());
        if (p.typ !== "pos-app") return null;
        return p;
    } catch {
        return null;
    }
}

/** App start: confirm the saved token. */
async function resume({ token, device }) {
    const p = await verify(token);
    if (!p || String(p.did) !== String(device?.deviceId || "")) return { ok: false, error: "inactive" };
    const [hotel, user, dev] = await Promise.all([
        Hotel.findOne({ where: { id: p.hid } }),
        HotelUser.findOne({ where: { id: p.uid, hotel_id: p.hid }, include: Role }),
        AppDevice.findOne({ where: { hotel_id: p.hid, device_id: String(p.did), status: "active" } }),
    ]);
    if (!user || user.active === false || !dev) return { ok: false, error: "inactive" };
    const gate = outletGate(hotel);
    if (gate) return gate;
    await dev.update({ last_active: new Date() });
    return { ok: true, session: { token, user: staffView(user), deviceId: String(p.did) } };
}

/**
 * Express middleware for every /app/v1 call except login: bearer token ->
 * req.ctx. Anything wrong = 401 { error: "session-ended" } so the app goes
 * back to the login screen (never a half-logged-in state).
 */
async function requireApp(req, res, next) {
    const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    const p = await verify(token);
    const ended = () => res.status(401).json({ ok: false, error: "Your session has ended. Please log in again.", code: "session-ended" });
    if (!p) return ended();
    try {
        const [hotel, dev] = await Promise.all([
            Hotel.findOne({ where: { id: p.hid }, attributes: ["id", "active", "product_plan", "plan_end_date"] }),
            AppDevice.findOne({ where: { hotel_id: p.hid, device_id: String(p.did), status: "active" }, attributes: ["id", "last_active"] }),
        ]);
        if (!dev || outletGate(hotel)) return ended();
        const ctx = await buildContext(p.hid, p.uid, String(p.did));
        if (!ctx) return ended();
        req.ctx = ctx;
        // last_active is shown on the Devices screen; touch at most once a minute.
        if (!dev.last_active || Date.now() - new Date(dev.last_active).getTime() > 60000) {
            void AppDevice.update({ last_active: new Date() }, { where: { id: dev.id } }).catch(() => {});
        }
        return next();
    } catch (err) {
        console.error("[appv1] auth:", err);
        return res.status(500).json({ ok: false, error: "Something went wrong. Please try again." });
    }
}

/**
 * Switch outlet: the same person (same mobile) working at another CLOUD_APP
 * outlet. This device registers there too (that outlet's own limit), and
 * gets a token for it.
 */
async function selectOutlet(c, outletId) {
    const { fail } = require("./core");
    if (String(outletId) === String(c.hotelId)) return { token: null };
    const user = await HotelUser.findOne({ where: { hotel_id: Number(outletId) || 0, number: c.user.number, active: true }, include: Role });
    if (!user || !c.user.number) fail("You are not staff at that outlet");
    const hotel = await Hotel.findOne({ where: { id: user.hotel_id } });
    const gate = outletGate(hotel);
    if (gate) fail(gate.message || "That outlet cannot use the POS App right now");
    const device = await AppDevice.findOne({ where: { hotel_id: c.hotelId, device_id: c.deviceId } });
    const info = { deviceId: c.deviceId, name: device?.name, make: device?.make, model: device?.model, android: device?.android, appVersion: device?.app_version };
    const blocked = await registerDevice(hotel, user, info);
    if (blocked) fail(blocked.message);
    const s = await session(hotel, user, info);
    return s.session;
}

/** Staff who may use the PIN pad on this device. */
async function shiftStaff(ctx) {
    const users = await HotelUser.findAll({ where: { hotel_id: ctx.hotelId, active: true }, include: Role });
    return users.map((u) => ({ id: String(u.id), name: u.name, role: resolveRole(u.role_mst?.role_name) }));
}

module.exports = { loginWithPassword, loginWithPin, resume, requireApp, shiftStaff, selectOutlet, staffView, outletGate };
