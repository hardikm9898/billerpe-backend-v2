const crypto = require("crypto");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { Op } = require("sequelize");
const { AdmUser, AdmRole, AdmSession, AdmTeam } = require("../model");
const { RuleError } = require("../appv1/core");
const perms = require("./permissions");
const audit = require("./audit");

// Logins for BillerPe's own staff (SuperAdmin panel + sales app). The login
// is the person's 10-digit mobile + password (bcrypt). Each browser or phone
// gets an adm_sessions row; the bearer token only names that row, so a
// session ends when it is logged out (here or from another device), when
// the password changes, when the person is switched off, or after 30 days
// without use.

const SECRET = () => process.env.ADMIN_JWT_SECRET || process.env.JWT_SECRET_KEY_SUPER_ADMIN || process.env.JWT_SECRET_KEY_ADMIN;
const TYP = "billerpe-admin";
const IDLE_DAYS = 30;

const digits = (v) => String(v ?? "").replace(/\D/g, "");
const mobile10 = (v) => {
    const d = digits(v);
    return d.length >= 10 ? d.slice(-10) : "";
};
const passwordFp = (hash) => crypto.createHash("sha256").update(String(hash || "")).digest("hex").slice(0, 16);
const passwordMatches = async (password, hash) => !!hash && bcrypt.compare(String(password || ""), hash).catch(() => false);

const sign = (session) => jwt.sign({ typ: TYP, sid: session.id, uid: session.user_id }, SECRET());
function verify(token) {
    try {
        const p = jwt.verify(String(token || ""), SECRET());
        return p && p.typ === TYP ? p : null;
    } catch {
        return null;
    }
}

/** A readable temporary password: no 0/O/1/l. */
function tempPassword(len = 10) {
    const abc = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const bytes = crypto.randomBytes(len);
    return Array.from(bytes, (b) => abc[b % abc.length]).join("");
}

function checkNewPassword(pw) {
    const p = String(pw || "");
    if (p.length < 8) throw new RuleError("Use at least 8 characters for the password.");
    if (p.length > 72) throw new RuleError("The password is too long (72 characters at most).");
    if (!/[A-Za-z]/.test(p) || !/\d/.test(p)) throw new RuleError("Use letters and numbers in the password.");
}

/* ------------------------------ login throttle ------------------------------ */
// 5 wrong passwords per mobile lock it for 15 minutes (per API process).
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

/* ------------------------------ views ------------------------------ */

async function roleOf(user) {
    const role = await AdmRole.findOne({ where: { id: user.role_id }, raw: true });
    return { role, permissions: role ? perms.parse(role.permissions) : [] };
}

async function userView(user, role, permissions) {
    const team = user.team_id ? await AdmTeam.findOne({ where: { id: user.team_id }, attributes: ["id", "name"], raw: true }) : null;
    return {
        id: user.id,
        name: user.name,
        mobile: user.mobile,
        email: user.email,
        role: role ? { id: role.id, name: role.name } : null,
        team: team ? { id: team.id, name: team.name } : null,
        permissions,
        mustChangePassword: !!user.must_change_password,
    };
}

const cleanDevice = (d = {}) => ({
    kind: d.kind === "app" ? "app" : "web",
    device_id: String(d.deviceId || "").slice(0, 64),
    device_name: String(d.name || "").slice(0, 80),
    app_version: String(d.appVersion || "").slice(0, 20),
});

/* ------------------------------ login / session ------------------------------ */

const WRONG = { ok: false, error: "wrong-password", message: "Wrong mobile number or password." };

async function login({ mobile, password, device, ip }) {
    const m = mobile10(mobile);
    if (!m || !password) return WRONG;
    const wait = lockedFor(m);
    if (wait) return { ok: false, error: "locked", message: `Too many wrong passwords. Try again in ${wait} min.` };

    const user = await AdmUser.findOne({ where: { mobile: m } });
    if (!user || !(await passwordMatches(password, user.password_hash))) {
        noteFail(m);
        return WRONG;
    }
    if (user.status !== "active") return { ok: false, error: "disabled", message: "This login is switched off. Ask your admin." };
    FAILS.delete(m);

    const d = cleanDevice(device);
    const session = await AdmSession.create({ ...d, user_id: user.id, ip: String(ip || "").slice(0, 64), password_fp: passwordFp(user.password_hash), last_active: new Date() });
    await user.update({ last_login_at: new Date() });
    const { role, permissions } = await roleOf(user);
    await audit.write({ user, ip }, { action: "auth.login", entity: "adm_user", entityId: user.id, summary: `${user.name} logged in (${d.kind}${d.device_name ? `, ${d.device_name}` : ""})` });
    return { ok: true, session: { token: sign(session), user: await userView(user, role, permissions) } };
}

/** Checks a token: { session, user, role, permissions } or null. */
async function check(token) {
    const p = verify(token);
    if (!p) return null;
    const session = await AdmSession.findOne({ where: { id: Number(p.sid) || 0, user_id: Number(p.uid) || 0, revoked_at: null } });
    if (!session) return null;
    const last = session.last_active ? new Date(session.last_active).getTime() : new Date(session.createdAt).getTime();
    if (Date.now() - last > IDLE_DAYS * 86400000) {
        await session.update({ revoked_at: new Date() });
        return null;
    }
    const user = await AdmUser.findOne({ where: { id: session.user_id } });
    if (!user || user.status !== "active") return null;
    if (passwordFp(user.password_hash) !== session.password_fp) return null;
    const { role, permissions } = await roleOf(user);
    return { session, user, role, permissions };
}

async function resume({ token }) {
    const s = await check(token);
    if (!s) return { ok: false, error: "session-ended" };
    await s.session.update({ last_active: new Date() });
    return { ok: true, session: { token, user: await userView(s.user, s.role, s.permissions) } };
}

// Calls a person may make before replacing a temporary password.
const ALLOWED_BEFORE_PASSWORD_CHANGE = new Set(["me", "changePassword", "logout"]);

/**
 * Middleware for every /admin/v1 call except login/resume: bearer token ->
 * req.staff = { session, user, role, permissions, can(key), ip }. A bad
 * token = 401 { code: "session-ended" }.
 */
async function requireStaff(req, res, next) {
    const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    try {
        const s = await check(token);
        if (!s) return res.status(401).json({ ok: false, error: "Your session has ended. Please log in again.", code: "session-ended" });
        const ip = String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "").split(",")[0].trim().replace(/^::ffff:/, "");
        req.staff = { ...s, ip, can: (key) => perms.can(s.permissions, key) };
        if (s.user.must_change_password && !ALLOWED_BEFORE_PASSWORD_CHANGE.has(req.params.name || req.path.replace(/^\//, ""))) {
            return res.json({ ok: false, error: "Set a new password first.", code: "change-password" });
        }
        if (!s.session.last_active || Date.now() - new Date(s.session.last_active).getTime() > 60000) {
            void AdmSession.update({ last_active: new Date() }, { where: { id: s.session.id } }).catch(() => {});
        }
        return next();
    } catch (err) {
        console.error("[adminv1] auth:", err);
        return res.status(500).json({ ok: false, error: "Something went wrong. Please try again." });
    }
}

/** Throws unless the signed-in person has the permission. */
function need(s, key) {
    if (!s.can(key)) throw new RuleError("You do not have permission for this.");
}

async function me(s) {
    return { user: await userView(s.user, s.role, s.permissions) };
}

async function logout(s) {
    await s.session.update({ revoked_at: new Date(), push_token: null });
    return {};
}

async function sessions(s) {
    const rows = await AdmSession.findAll({ where: { user_id: s.user.id, revoked_at: null }, order: [["last_active", "DESC"]], raw: true });
    return {
        sessions: rows.map((r) => ({
            id: r.id,
            kind: r.kind,
            name: r.device_name || (r.kind === "app" ? "Phone" : "Browser"),
            appVersion: r.app_version,
            ip: r.ip,
            lastActive: r.last_active,
            since: r.createdAt,
            current: r.id === s.session.id,
        })),
    };
}

async function logoutSession(s, id) {
    const n = Number(id) || 0;
    if (n === s.session.id) throw new RuleError("Use Log out to end this session.");
    await AdmSession.update({ revoked_at: new Date(), push_token: null }, { where: { id: n, user_id: s.user.id, revoked_at: null } });
    return sessions(s);
}

/** New password: ends every other session of this person, keeps this one. */
async function changePassword(s, oldPassword, newPassword) {
    if (!(await passwordMatches(oldPassword, s.user.password_hash))) throw new RuleError("The current password is wrong.");
    checkNewPassword(newPassword);
    if (String(oldPassword) === String(newPassword)) throw new RuleError("Choose a password different from the current one.");
    const hash = await bcrypt.hash(String(newPassword), 10);
    await s.user.update({ password_hash: hash, must_change_password: false });
    await AdmSession.update({ revoked_at: new Date(), push_token: null }, { where: { user_id: s.user.id, revoked_at: null, id: { [Op.ne]: s.session.id } } });
    await s.session.update({ password_fp: passwordFp(hash) });
    await audit.write(s, { action: "auth.change_password", entity: "adm_user", entityId: s.user.id, summary: `${s.user.name} changed their password` });
    return me({ ...s, user: s.user });
}

module.exports = {
    login, resume, check, requireStaff, need, me, logout, sessions, logoutSession, changePassword,
    mobile10, passwordFp, tempPassword, checkNewPassword, roleOf, userView, verify,
};
