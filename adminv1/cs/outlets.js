const { Op } = require("sequelize");
const { sequelize, Hotel, HotelUser, Menu, Order, LocalServerRegistration, AppDevice, ExeRelease, CsAccount, CsAccountOutlet, CsTask, CsActivity, AdmSupportSession } = require("../../model");
const { RuleError } = require("../../appv1/core");
const { need } = require("../auth");
const audit = require("../audit");
const plan = require("../../appv1/plan");
const support = require("../../ownerv1/support");
const onboarding = require("./onboarding");
const { outletRow, ONLINE_MS } = require("./view");
const { cmpVersion, customerSettings, addActivity, names, mobile10, spellings, todayStr, txt, moment } = require("./common");

// Outlet operations (replaces the old device-admin page): every outlet with
// its live PC state, versions, backlog, bills and health; plan switch, PC
// release, POS App device limit, and "Open as outlet" - a 30-minute Owner
// Dashboard session for support (owner 2026-10-08). The sensitive actions
// need a typed reason and go to the audit log and the account's timeline.

const FILTERS = ["all", "red", "amber", "pc_offline", "behind", "not_billing", "backlog", "app", "onboarding"];

async function latestExe() {
    const rows = (await ExeRelease.findAll({ where: { active: true }, attributes: ["version"], raw: true })).map((r) => r.version);
    return rows.reduce((a, v) => (!a || cmpVersion(v, a) > 0 ? v : a), null);
}

function matches(row, f, now) {
    switch (f) {
        case "red":
        case "amber":
            return row.health === f;
        case "pc_offline":
            return row.plan !== "CLOUD_APP" && row.active && (row.pc.state === "offline" || row.pc.state === "none");
        case "behind":
            return row.pc.state !== "app" && ((row.behind || 0) > 0 || /fail/i.test(row.pc.updateStatus || ""));
        case "not_billing":
            return row.active && row.reasons.some((r) => r.key === "billing");
        case "backlog":
            return !!row.backlog && row.backlog.pending > 0 && !!row.backlog.since && now - new Date(row.backlog.since).getTime() >= 3600000;
        case "app":
            return row.plan === "CLOUD_APP";
        case "onboarding":
            return row.onboarding === "active";
        default:
            return true;
    }
}

async function list(s, query = {}) {
    need(s, "customers.view");
    const filter = FILTERS.includes(query.filter) ? query.filter : "all";
    const q = txt(query.q, 60);
    const links = await CsAccountOutlet.findAll({ raw: true });
    const hotels = new Map((links.length ? await Hotel.findAll({ where: { id: links.map((l) => l.hotel_id) }, attributes: ["id", "hotel_name", "address2", "owner_number", "product_plan", "plan_end_date", "active", "createdAt", "app_device_limit"], raw: true }) : []).map((h) => [h.id, h]));
    const regs = new Map((await LocalServerRegistration.findAll({ where: { status: "active" }, raw: true })).map((r) => [r.hotel_id, r]));
    const accs = new Map((await CsAccount.findAll({ attributes: ["id", "name", "owner_mobile"], raw: true })).map((a) => [a.id, a]));
    const now = Date.now();
    let rows = links.filter((l) => hotels.has(l.hotel_id)).map((l) => outletRow(l, hotels.get(l.hotel_id), regs.get(l.hotel_id), now, accs.get(l.account_id)));
    const counts = {};
    for (const f of FILTERS) counts[f] = rows.filter((r) => matches(r, f, now)).length;
    rows = rows.filter((r) => matches(r, filter, now));
    if (q) {
        const low = q.toLowerCase();
        const d = q.replace(/\D/g, "");
        rows = rows.filter((r) => r.name.toLowerCase().includes(low) || String(r.hotelId) === q || (r.account && (r.account.name.toLowerCase().includes(low) || (d.length >= 4 && r.account.mobile.includes(d)))) || (r.pc.hostname || "").toLowerCase().includes(low));
    }
    const rank = { red: 0, amber: 1, green: 2, grey: 3 };
    rows.sort((a, b) => rank[a.health] - rank[b.health] || a.name.localeCompare(b.name));
    const limit = 50;
    const page = Math.max(1, Number(query.page) || 1);
    return { serverTime: new Date().toISOString(), filter, counts, total: rows.length, page, limit, latestExe: await latestExe(), outlets: rows.slice((page - 1) * limit, page * limit) };
}

async function getLink(hotelId) {
    const link = await CsAccountOutlet.findOne({ where: { hotel_id: Number(hotelId) || 0 }, raw: true });
    if (!link) throw new RuleError("This outlet is not in an account yet. It is added within 15 minutes of being created.");
    return link;
}

async function detail(s, hotelId) {
    need(s, "customers.view");
    const link = await getLink(hotelId);
    const hotel = await Hotel.findOne({ where: { id: link.hotel_id }, attributes: ["id", "hotel_name", "address1", "address2", "pinCode", "owner_name", "owner_number", "contact1", "gst_no", "product_plan", "plan_start_date", "plan_end_date", "active", "createdAt", "hotel_reg_date", "app_device_limit"], raw: true });
    const account = await CsAccount.findOne({ where: { id: link.account_id }, attributes: ["id", "name", "owner_mobile", "success_owner_id"], raw: true });
    const reg = await LocalServerRegistration.findOne({ where: { hotel_id: hotel.id, status: "active" }, raw: true });
    const released = await LocalServerRegistration.findAll({ where: { hotel_id: hotel.id, status: "released" }, order: [["released_at", "DESC"]], limit: 3, raw: true });
    const devices = await AppDevice.findAll({ where: { hotel_id: hotel.id, status: "active" }, attributes: ["id", "name", "make", "model", "app_version", "last_active", "createdAt"], order: [["last_active", "DESC"]], limit: 50, raw: true });
    const items = await onboarding.itemsFor([hotel.id]);
    const tasks = await CsTask.findAll({ where: { hotel_id: hotel.id, status: "open" }, order: [["due_at", "ASC"]], raw: true });
    const acts = await CsActivity.findAll({ where: { hotel_id: hotel.id }, order: [["at", "DESC"], ["id", "DESC"]], limit: 30, raw: true });
    const sessions = await AdmSupportSession.findAll({ where: { hotel_id: hotel.id }, order: [["id", "DESC"]], limit: 5, raw: true });
    // Read-only look inside (both plans): today's bills, the latest bills, menu and staff.
    const today = todayStr();
    const recent = await Order.findAll({ where: { hotel_id: hotel.id, deleted: false, payment: "success" }, attributes: ["id", "bill_no", "grandAmount", "payment_type", "order_type", "business_date", "billed_at", "createdAt"], order: [["id", "DESC"]], limit: 10, raw: true });
    const running = await Order.count({ where: { hotel_id: hotel.id, deleted: false, payment: "pending", business_date: { [Op.gte]: moment().subtract(2, "days").format("YYYY-MM-DD") } } });
    const menuItems = await Menu.count({ where: { hotel_id: hotel.id, is_deleted: { [Op.not]: true } } });
    const staff = await HotelUser.count({ where: { hotel_id: hotel.id, active: true } });
    const m = mobile10(hotel.owner_number);
    const ownerLogin = m ? await HotelUser.findOne({ where: { hotel_id: hotel.id, number: spellings(m), active: true }, attributes: ["id"], raw: true }) : null;
    const cfg = await customerSettings();
    const who = await names([account && account.success_owner_id, ...released.map((r) => r.released_by), ...items.flatMap((i) => [i.owner_id, i.done_by]), ...tasks.map((x) => x.owner_id), ...acts.map((a) => a.actor_id), ...sessions.map((x) => x.user_id)]);
    const row = outletRow(link, hotel, reg, Date.now(), account);
    return {
        serverTime: new Date().toISOString(),
        outlet: {
            ...row,
            address: [hotel.address1, hotel.address2, hotel.pinCode].filter(Boolean).join(", "),
            ownerName: hotel.owner_name,
            ownerMobile: m,
            contact: hotel.contact1 || "",
            gstin: hotel.gst_no || "",
            planStart: hotel.plan_start_date,
            deviceLimit: hotel.app_device_limit,
            ownerLogin: !!ownerLogin,
            successOwner: account && account.success_owner_id ? { id: account.success_owner_id, name: who.get(account.success_owner_id) || `#${account.success_owner_id}` } : null,
            pcHistory: released.map((r) => ({ hostname: r.hostname || "", registeredAt: r.registered_at, releasedAt: r.released_at, version: r.app_version || "" })),
            devices: devices.map((d) => ({ id: d.id, name: d.name || d.model || "Phone", model: [d.make, d.model].filter(Boolean).join(" "), version: d.app_version, lastActive: d.last_active, since: d.createdAt })),
        },
        look: {
            today,
            billsToday: row.billsToday,
            salesToday: row.salesToday,
            running,
            menuItems,
            staff,
            recentBills: recent.map((o) => ({ id: o.id, billNo: o.bill_no, amount: o.grandAmount, pay: o.payment_type || "", type: o.order_type || "", day: o.business_date, at: o.billed_at || o.createdAt })),
        },
        onboarding: items.map((i) => onboarding.view(i, who)),
        tasks: tasks.map((x) => ({ id: x.id, type: x.type, note: x.note, dueAt: x.due_at, owner: x.owner_id ? who.get(x.owner_id) || `#${x.owner_id}` : null, origin: x.origin })),
        activity: acts.map((a) => ({ id: a.id, type: a.type, actor: a.actor_id ? who.get(a.actor_id) || `#${a.actor_id}` : null, body: a.body, at: a.at })),
        supportSessions: sessions.map((x) => ({ id: x.id, by: who.get(x.user_id) || `#${x.user_id}`, reason: x.reason, at: x.createdAt, expiresAt: x.expires_at, endedAt: x.ended_at, writes: x.writes, open: !x.ended_at && new Date(x.expires_at) > new Date() })),
        canOpenAs: { dashboard: !!cfg.ownerDashboardUrl, plan: hotel.product_plan !== "CLOUD_APP", ownerLogin: !!ownerLogin, active: hotel.active !== false && hotel.active !== 0 },
    };
}

const reasonOf = (reason) => {
    const why = txt(reason, 300);
    if (why.length < 5) throw new RuleError("Write the reason (at least a few words). It goes to the audit log.");
    return why;
};

/** Local Suite <-> POS App, and the POS App's device limit. */
async function switchPlan(s, hotelId, input = {}) {
    need(s, "outlets.manage");
    const why = reasonOf(input.reason);
    const link = await getLink(hotelId);
    return sequelize.transaction(async (t) => {
        const hotel = await Hotel.findOne({ where: { id: link.hotel_id }, transaction: t, lock: t.LOCK.UPDATE });
        const before = { product_plan: hotel.product_plan, app_device_limit: hotel.app_device_limit };
        const wanted = {};
        if (input.productPlan !== undefined && input.productPlan !== hotel.product_plan) wanted.product_plan = input.productPlan;
        if (input.deviceLimit !== undefined && Number(input.deviceLimit) !== hotel.app_device_limit) wanted.app_device_limit = input.deviceLimit;
        const r = await plan.applyPlan(hotel, wanted, null, { transaction: t });
        if (r.error) throw new RuleError(r.error === "Nothing to change" ? "Nothing changed." : r.error);
        if (input.planName !== undefined) await CsAccountOutlet.update({ plan_name: txt(input.planName, 40) }, { where: { id: link.id }, transaction: t });
        const after = { product_plan: hotel.product_plan, app_device_limit: hotel.app_device_limit };
        const parts = [];
        if (before.product_plan !== after.product_plan) parts.push(`plan ${before.product_plan === "CLOUD_APP" ? "POS App" : "Local Suite"} -> ${after.product_plan === "CLOUD_APP" ? "POS App" : "Local Suite"}${r.released ? " (outlet PC released)" : ""}${r.revoked ? ` (${r.revoked} POS App phone${r.revoked === 1 ? "" : "s"} logged out)` : ""}`);
        if (before.app_device_limit !== after.app_device_limit) parts.push(`POS App devices ${before.app_device_limit} -> ${after.app_device_limit}`);
        await addActivity(link.account_id, link.hotel_id, "plan", s.user.id, `${hotel.hotel_name}: ${parts.join(", ")} (${why})`, { before, after }, t);
        await audit.write(s, { action: "outlet.plan", entity: "hotel", entityId: hotel.id, summary: `${hotel.hotel_name}: ${parts.join(", ")}`, before, after, reason: why }, { transaction: t });
        return { ...after, released: r.released, revoked: r.revoked };
    });
}

/** Frees the outlet for a new PC (the old one stops syncing). */
async function releasePc(s, hotelId, reason) {
    need(s, "outlets.manage");
    const why = reasonOf(reason);
    const link = await getLink(hotelId);
    return sequelize.transaction(async (t) => {
        const reg = await LocalServerRegistration.findOne({ where: { hotel_id: link.hotel_id, status: "active" }, transaction: t, lock: t.LOCK.UPDATE });
        if (!reg) throw new RuleError("This outlet has no registered PC to release.");
        const hotel = await Hotel.findOne({ where: { id: link.hotel_id }, attributes: ["id", "hotel_name"], raw: true, transaction: t });
        await reg.update({ status: "released", released_at: new Date(), released_by: null }, { transaction: t });
        await addActivity(link.account_id, link.hotel_id, "pc", s.user.id, `${hotel.hotel_name}: outlet PC ${reg.hostname || ""} released (${why})`, { hostname: reg.hostname, deviceId: reg.device_id }, t);
        await audit.write(s, { action: "outlet.release_pc", entity: "hotel", entityId: hotel.id, summary: `Released the PC of ${hotel.hotel_name} (${reg.hostname || "unknown PC"})`, before: { hostname: reg.hostname, app_version: reg.app_version, last_seen_at: reg.last_seen_at }, reason: why }, { transaction: t });
        return { released: true };
    });
}

/** Logs one POS App phone out (lost phone, staff left). */
async function logoutDevice(s, hotelId, deviceRowId, reason) {
    need(s, "outlets.manage");
    const why = reasonOf(reason);
    const link = await getLink(hotelId);
    const d = await AppDevice.findOne({ where: { id: Number(deviceRowId) || 0, hotel_id: link.hotel_id, status: "active" } });
    if (!d) throw new RuleError("This phone is not logged in.");
    return sequelize.transaction(async (t) => {
        await d.update({ status: "revoked", push_token: null }, { transaction: t });
        await addActivity(link.account_id, link.hotel_id, "devices", s.user.id, `POS App phone ${d.name || d.model} logged out (${why})`, { deviceId: d.device_id }, t);
        await audit.write(s, { action: "outlet.device_logout", entity: "hotel", entityId: link.hotel_id, summary: `Logged out POS App phone ${d.name || d.model}`, reason: why }, { transaction: t });
        return { id: d.id };
    });
}

/**
 * "Open as outlet": a 30-minute Owner Dashboard session as the outlet's
 * owner, for support (Local Suite outlets; the POS App has no Owner
 * Dashboard - those outlets get the read-only look in the panel).
 */
async function openAs(s, hotelId, reason) {
    need(s, "outlets.open_as");
    const why = reasonOf(reason);
    const link = await getLink(hotelId);
    const cfg = await customerSettings();
    if (!cfg.ownerDashboardUrl) throw new RuleError("Set the Owner Dashboard address in Settings > Customers first.");
    const hotel = await Hotel.findOne({ where: { id: link.hotel_id }, attributes: ["id", "hotel_name", "owner_number", "product_plan", "active"], raw: true });
    if (hotel.product_plan === "CLOUD_APP") throw new RuleError("POS App outlets have no Owner Dashboard. Use the look inside this page.");
    if (hotel.active === false || hotel.active === 0) throw new RuleError("This outlet is switched off.");
    const m = mobile10(hotel.owner_number);
    const owner = m ? await HotelUser.findOne({ where: { hotel_id: hotel.id, number: spellings(m), active: true }, attributes: ["id"], raw: true }) : null;
    if (!owner) throw new RuleError("This outlet has no working owner login to open it with.");
    const expires = new Date(Date.now() + cfg.supportMinutes * 60000);
    return sequelize.transaction(async (t) => {
        const row = await AdmSupportSession.create({ user_id: s.user.id, hotel_id: hotel.id, reason: why, expires_at: expires, ip: String(s.ip || "").slice(0, 64) }, { transaction: t });
        await addActivity(link.account_id, hotel.id, "open_as", s.user.id, `${s.user.name} opened ${hotel.hotel_name} as the owner for ${cfg.supportMinutes} min (${why})`, { sessionId: row.id }, t);
        await audit.write(s, { action: "outlet.open_as", entity: "hotel", entityId: hotel.id, summary: `Opened ${hotel.hotel_name} as the owner (${cfg.supportMinutes} min)`, after: { sessionId: row.id, expiresAt: expires }, reason: why }, { transaction: t });
        const token = support.sign(row.id, cfg.supportMinutes);
        return { url: `${cfg.ownerDashboardUrl}/?support=${encodeURIComponent(token)}#/`, expiresAt: expires, sessionId: row.id };
    });
}

/** Ends an open support session early (its next call gets "session ended"). */
async function endSupport(s, sessionId) {
    need(s, "outlets.open_as");
    const row = await AdmSupportSession.findOne({ where: { id: Number(sessionId) || 0, ended_at: null } });
    if (!row) throw new RuleError("This session has already ended.");
    if (row.user_id !== s.user.id && !s.can("outlets.manage")) throw new RuleError("Only the person who opened it (or an admin) can end it.");
    await row.update({ ended_at: new Date() });
    return { id: row.id };
}

module.exports = { list, detail, switchPlan, releasePc, logoutDevice, openAs, endSupport, ONLINE_MS };
