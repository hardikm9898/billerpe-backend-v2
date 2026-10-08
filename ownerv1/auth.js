const crypto = require("crypto");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { Op } = require("sequelize");
const { Hotel, HotelUser, OwnerDevice, OwnerOutletLink } = require("../model");
const { RuleError } = require("../appv1/core");

// Sessions for the BillerPe Owner App (Plan 1 owners, owner decision
// 2026-10-05: owner only, LOCAL_SUITE outlets only, no paid gate).
//
// Who is "the owner": the staff login whose mobile is the outlet's
// owner_number - the same rule as the exe (helpers/ownerAccount.js). Never
// the role: every outlet's owner account carries the legacy role code "A",
// which managers can carry too.
//
// One login covers every Plan 1 outlet that has this mobile as its owner
// number, plus the franchise outlets linked to this mobile (owner
// 2026-10-07, OwnerOutletLink): a franchise outlet is shown to its franchise
// owner only, never to the owner in its own owner_number. The token never expires (no surprise re-logins); it ends when the
// owner logs out (device revoked), the login's password changes, the owner
// account is switched off, or no Plan 1 outlet is left.

const SECRET = () => process.env.OWNER_JWT_SECRET || process.env.JWT_SECRET_KEY_ADMIN;
const TYP = "owner-app";

const digits = (v) => String(v ?? "").replace(/\D/g, "");
/** The 10-digit mobile, or "" when the input cannot be one. */
const mobile10 = (v) => {
    const d = digits(v);
    return d.length >= 10 ? d.slice(-10) : "";
};
/** The spellings a mobile is stored under in the outlet tables. */
const spellings = (m) => [m, `91${m}`, `+91${m}`, `0${m}`, `+91 ${m}`];

const passwordFp = (hash) => crypto.createHash("sha256").update(String(hash || "")).digest("hex").slice(0, 16);

const sign = (deviceRowId, mobile) => jwt.sign({ typ: TYP, did: deviceRowId, m: mobile }, SECRET());

function verify(token) {
    try {
        const p = jwt.verify(String(token || ""), SECRET());
        return p && p.typ === TYP ? p : null;
    } catch {
        return null;
    }
}

const HOTEL_ATTRS = ["id", "hotel_name", "owner_name", "owner_number", "plan_end_date", "hotel_logo"];
const USER_ATTRS = ["id", "hotel_id", "name", "number", "password", "active"];
const isActive = (u) => u.active !== false && u.active !== 0;

/**
 * Franchise links touching this owner: outlets linked to them, and their own
 * outlets linked to someone else. A cloud without the table yet (code
 * deployed before `npm run migrate`) has no links, never an error.
 */
async function franchiseLinks(mobile, ownHotelIds) {
    try {
        return await OwnerOutletLink.findAll({
            where: { [Op.or]: [{ owner_mobile: mobile }, ...(ownHotelIds.length ? [{ hotel_id: ownHotelIds }] : [])] },
            attributes: ["owner_mobile", "hotel_id"],
            raw: true,
        });
    } catch (e) {
        if (!/owner_outlet_links/.test(String(e && e.message))) throw e;
        return [];
    }
}

/**
 * Every outlet this person may see in the Owner App: the Plan 1 outlets with
 * this mobile as owner number (with the owner's own staff row there), minus
 * those linked to a franchise owner, plus the franchise outlets linked to
 * this mobile (`franchise: true`, acting through that outlet's own owner
 * account, which always has every permission). Plan 2 outlets, switched-off
 * outlets and outlets whose owner login is switched off are left out.
 */
async function ownedOutlets(mobile) {
    if (!mobile) return [];
    const hotels = await Hotel.findAll({
        where: { owner_number: [mobile, `91${mobile}`], product_plan: "LOCAL_SUITE", active: { [Op.not]: false } },
        attributes: HOTEL_ATTRS,
        raw: true,
    });
    const links = await franchiseLinks(mobile, hotels.map((h) => h.id));
    const linkedAway = new Set(links.filter((l) => l.owner_mobile !== mobile).map((l) => l.hotel_id));
    const own = hotels.filter((h) => !linkedAway.has(h.id));
    const out = [];
    if (own.length) {
        const users = await HotelUser.findAll({ where: { hotel_id: own.map((h) => h.id), number: spellings(mobile) }, attributes: USER_ATTRS, raw: true });
        for (const h of own) {
            const u = users.find((x) => x.hotel_id === h.id && isActive(x));
            if (u) out.push({ hotel: h, user: u });
        }
    }
    const franchiseIds = links.filter((l) => l.owner_mobile === mobile && !own.some((h) => h.id === l.hotel_id)).map((l) => l.hotel_id);
    if (franchiseIds.length) {
        const fHotels = await Hotel.findAll({ where: { id: franchiseIds, product_plan: "LOCAL_SUITE", active: { [Op.not]: false } }, attributes: HOTEL_ATTRS, raw: true });
        const fUsers = fHotels.length ? await HotelUser.findAll({ where: { hotel_id: fHotels.map((h) => h.id) }, attributes: USER_ATTRS, raw: true }) : [];
        for (const h of fHotels) {
            const om = mobile10(h.owner_number);
            const u = fUsers.find((x) => x.hotel_id === h.id && om && mobile10(x.number) === om && isActive(x));
            if (u) out.push({ hotel: h, user: u, franchise: true });
        }
    }
    return out.sort((a, b) => a.hotel.id - b.hotel.id);
}

/* ------------------------------ login throttle ------------------------------ */
// Owner logins see every outlet's money: 5 wrong passwords per mobile lock
// it for 15 minutes (per server process; enough to stop guessing).
const FAILS = new Map();
const LOCK_AFTER = 5;
const LOCK_MS = 15 * 60 * 1000;
function lockedFor(m) {
    const f = FAILS.get(m);
    if (!f) return 0;
    if (Date.now() - f.first > LOCK_MS) {
        FAILS.delete(m);
        return 0;
    }
    return f.count >= LOCK_AFTER ? Math.ceil((LOCK_MS - (Date.now() - f.first)) / 60000) : 0;
}
function noteFail(m) {
    const f = FAILS.get(m);
    if (!f || Date.now() - f.first > LOCK_MS) FAILS.set(m, { first: Date.now(), count: 1 });
    else f.count += 1;
}

/* ------------------------------ login ------------------------------ */

const cleanDevice = (d = {}) => ({
    device_id: String(d.deviceId || "").slice(0, 64),
    name: String(d.name || "Phone").slice(0, 80),
    make: String(d.make || "").slice(0, 60),
    model: String(d.model || "").slice(0, 60),
    android: String(d.android || "").slice(0, 20),
    app_version: String(d.appVersion || "").slice(0, 20),
});

const passwordMatches = async (password, hash) => !!hash && bcrypt.compare(String(password || ""), hash).catch(() => false);

/**
 * Why a correct staff password still cannot open the app: staff (not the
 * owner) at a Plan 1 outlet, the owner of a Plan 2 outlet, or the owner of
 * a franchise outlet (its franchise owner has it in the Owner App).
 */
async function refusalFor(mobile, password) {
    const users = await HotelUser.findAll({ where: { number: spellings(mobile) }, attributes: ["id", "hotel_id", "password"], raw: true });
    for (const u of users) {
        if (!(await passwordMatches(password, u.password))) continue;
        const hotel = await Hotel.findOne({ where: { id: u.hotel_id }, attributes: ["product_plan", "owner_number", "active"], raw: true });
        if (!hotel) continue;
        const isOwner = mobile10(hotel.owner_number) === mobile;
        if (hotel.product_plan === "CLOUD_APP" && isOwner) {
            return { ok: false, error: "plan-2", message: "Your outlet uses the BillerPe POS App. All owner features are inside the POS App." };
        }
        if (!isOwner) return { ok: false, error: "not-owner", message: "Only the restaurant owner can use this app. Staff use the Web POS or Captain App." };
        const links = await franchiseLinks(mobile, [u.hotel_id]);
        if (links.some((l) => l.hotel_id === u.hotel_id && l.owner_mobile !== mobile)) {
            return { ok: false, error: "franchise", message: "This outlet is a franchise outlet. Its franchise owner sees it in the Owner App." };
        }
    }
    return null;
}

async function login({ mobile, password, device }) {
    const m = mobile10(mobile);
    if (!m || !password) return { ok: false, error: "wrong-password", message: "Wrong mobile number or password." };
    const wait = lockedFor(m);
    if (wait) return { ok: false, error: "locked", message: `Too many wrong passwords. Try again in ${wait} min.` };

    const owned = await ownedOutlets(m);
    let match = null;
    for (const o of owned) {
        // A franchise outlet acts through its own owner's account: that
        // person's password never opens the franchise owner's login.
        if (o.franchise) continue;
        if (await passwordMatches(password, o.user.password)) {
            match = o;
            break;
        }
    }
    if (!match) {
        const refusal = await refusalFor(m, password);
        if (refusal) return refusal;
        noteFail(m);
        return { ok: false, error: "wrong-password", message: "Wrong mobile number or password." };
    }
    FAILS.delete(m);

    const d = cleanDevice(device);
    if (!d.device_id) return { ok: false, error: "device", message: "This phone has no id. Reinstall the app." };
    const fields = { ...d, owner_mobile: m, hotel_user_id: match.user.id, password_fp: passwordFp(match.user.password), status: "active", last_active: new Date() };
    let row = await OwnerDevice.findOne({ where: { owner_mobile: m, device_id: d.device_id } });
    if (row) await row.update(fields);
    else row = await OwnerDevice.create(fields);

    return { ok: true, session: { token: sign(row.id, m), owner: ownerView(match), deviceId: d.device_id } };
}

const ownerView = (o) => ({ name: o.user.name || o.hotel.owner_name || "", mobile: mobile10(o.user.number) });

/**
 * Checks a token and returns { device, mobile, owned } or null. Shared by
 * resume and the middleware so both end a session for the same reasons.
 */
async function check(token) {
    // BillerPe support's 30-minute "open as outlet" session (ownerv1/support.js).
    const support = require("./support");
    if (support.verify(token)) return support.check(token);
    const p = verify(token);
    if (!p) return null;
    const device = await OwnerDevice.findOne({ where: { id: Number(p.did) || 0, owner_mobile: String(p.m), status: "active" } });
    if (!device) return null;
    const loginRow = await HotelUser.findOne({ where: { id: device.hotel_user_id }, attributes: ["id", "password", "active"], raw: true });
    if (!loginRow || loginRow.active === false || loginRow.active === 0) return null;
    if (passwordFp(loginRow.password) !== device.password_fp) return null;
    const owned = await ownedOutlets(device.owner_mobile);
    if (!owned.length) return null;
    return { device, mobile: device.owner_mobile, owned };
}

/** App start: confirm the saved token. */
async function resume({ token, device }) {
    const s = await check(token);
    if (s && s.support) {
        const o = s.owned[0];
        return { ok: true, session: { token, owner: ownerView(o), deviceId: String(device?.deviceId || ""), support: { staff: s.support.staffName, outlet: s.support.outlet, expiresAt: s.support.expiresAt } } };
    }
    if (!s || s.device.device_id !== String(device?.deviceId || "")) return { ok: false, error: "session-ended" };
    const d = cleanDevice(device);
    await s.device.update({ app_version: d.app_version || s.device.app_version, last_active: new Date() });
    const self = s.owned.find((o) => o.user.id === s.device.hotel_user_id) || s.owned.find((o) => !o.franchise) || s.owned[0];
    return { ok: true, session: { token, owner: { ...ownerView(self), mobile: s.mobile }, deviceId: s.device.device_id } };
}

/**
 * Middleware for every /owner/v1 call except login/resume: bearer token ->
 * req.owner = { device, mobile, owned, outletIds }. Anything wrong = 401
 * { code: "session-ended" } so the app returns to the login screen.
 */
async function requireOwner(req, res, next) {
    const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    try {
        const s = await check(token);
        if (!s) return res.status(401).json({ ok: false, error: "Your session has ended. Please log in again.", code: "session-ended" });
        req.owner = { ...s, outletIds: new Set(s.owned.map((o) => o.hotel.id)) };
        if (!s.support && (!s.device.last_active || Date.now() - new Date(s.device.last_active).getTime() > 60000)) {
            void OwnerDevice.update({ last_active: new Date() }, { where: { id: s.device.id } }).catch(() => {});
        }
        return next();
    } catch (err) {
        console.error("[ownerv1] auth:", err);
        return res.status(500).json({ ok: false, error: "Something went wrong. Please try again." });
    }
}

async function logout(o) {
    await OwnerDevice.update({ status: "revoked", push_token: null }, { where: { id: o.device.id } });
    return {};
}

/**
 * Every phone and browser this owner is logged in on (Owner Dashboard
 * Profile). Browsers carry a "web-" device id. Scoped to the owner's mobile.
 */
async function devices(o) {
    const rows = await OwnerDevice.findAll({
        where: { owner_mobile: o.mobile, status: "active" },
        attributes: ["id", "device_id", "name", "make", "model", "android", "app_version", "last_active", "createdAt"],
        order: [["last_active", "DESC"]],
        raw: true,
    });
    return {
        devices: rows.map((d) => ({
            id: d.id,
            name: d.name || d.model || "Device",
            web: String(d.device_id).startsWith("web-"),
            os: d.android || "",
            appVersion: d.app_version || "",
            lastActive: d.last_active,
            since: d.createdAt,
            current: d.id === o.device.id,
        })),
    };
}

/** Logs one of the owner's other phones or browsers out (its next call gets 401). */
async function logoutDevice(o, id) {
    const n = Number(id) || 0;
    if (n === o.device.id) throw new RuleError("Use Log out to end this session.");
    await OwnerDevice.update({ status: "revoked", push_token: null }, { where: { id: n, owner_mobile: o.mobile, status: "active" } });
    return devices(o);
}

async function setPushToken(o, token) {
    const t = token ? String(token).slice(0, 255) : null;
    // A phone's token belongs to one login at a time.
    if (t) await OwnerDevice.update({ push_token: null }, { where: { push_token: t, id: { [Op.ne]: o.device.id } } });
    await OwnerDevice.update({ push_token: t }, { where: { id: o.device.id } });
    return {};
}

async function setLanguage(o, lang) {
    const l = ["en", "hi", "gu"].includes(lang) ? lang : "en";
    await OwnerDevice.update({ language: l }, { where: { id: o.device.id } });
    return { language: l };
}

module.exports = { login, resume, requireOwner, logout, devices, logoutDevice, setPushToken, setLanguage, ownedOutlets, mobile10, verify };
