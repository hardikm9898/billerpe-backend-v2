// Scenario tests for the BillerPe Owner App API (/owner/v1) against a real
// MySQL database.
//
//   DATABASE_NAME=billerpe_app_test node scripts/test-ownerv1.js
//
// Optional: OWNER_FIREBASE_SERVICE_ACCOUNT_FILE=<key.json> also checks that
// Firebase accepts the key (a dry-run send to a made-up token).
//
// Refuses to run against any database whose name does not end in "_test".
// Every run creates its own outlets with fresh mobile numbers and deletes
// them at the end.

require("dotenv").config();
if (!/_test$/.test(process.env.DATABASE_NAME || "")) {
    console.error("Refusing to run: DATABASE_NAME must end in _test");
    process.exit(1);
}
process.env.OWNER_JWT_SECRET = process.env.OWNER_JWT_SECRET || "ownerv1-test-secret";

const http = require("http");
const express = require("express");
const bcrypt = require("bcrypt");
const moment = require("moment-timezone");
const sequelize = require("../connection/connect");
const M = require("../model");

let passed = 0;
const failures = [];
function check(name, ok, detail) {
    if (ok) {
        passed += 1;
        console.log(`  ok   ${name}`);
    } else {
        failures.push(name);
        console.log(`  FAIL ${name}${detail !== undefined ? `  ${JSON.stringify(detail).slice(0, 400)}` : ""}`);
    }
}

const stamp = String(Date.now()).slice(-7);
const mobile = (n) => `8${n}${stamp}`.slice(0, 10).padEnd(10, "0");
const PW = "owner-pass-1";
const created = { hotels: [] };

async function makeHotel(name, ownerNumber, extra = {}) {
    const hotel = await M.Hotel.create({
        hotel_name: `${name} ${stamp}`, owner_name: "Test Owner", owner_number: ownerNumber, address1: "1 Test Road", pinCode: 380001,
        hotel_logo: "", password: "x", hotel_reg_date: new Date(), plan_start_date: new Date(), plan_end_date: moment().add(1, "year").toDate(),
        product_plan: "LOCAL_SUITE", is_token_on: "0", bill_with_kot: "3", bill_with_token: "0", upiId: "test@upi", ...extra,
    });
    created.hotels.push(hotel.id);
    return hotel;
}
async function makeUser(hotel, roleName, number, password, extra = {}) {
    const role = await M.Role.create({ role_name: roleName, hotel_id: hotel.id });
    return M.HotelUser.create({ role_cd: role.role_cd, hotel_id: hotel.id, number, name: `${roleName} ${number}`, email: "", active: true, password: await bcrypt.hash(password, 4), ...extra });
}

let base;
let syncBase;
async function post(path, body, token) {
    const res = await fetch(`${base}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(body || {}),
    });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, ...json };
}
const call = (name, token, ...args) => post(`/${name}`, { args }, token);
const phone = (id) => ({ deviceId: id, name: "Test phone", make: "Test", model: "T1", android: "14", appVersion: "0.1.0" });

async function run() {
    const OWNER = mobile(1);
    const STAFF = mobile(2);
    const PLAN2_OWNER = mobile(3);
    const OTHER_OWNER = mobile(4);

    // Two Plan 1 outlets of the same owner: one stores the number plainly with
    // the legacy owner role "A", the other with a 91 prefix and role "Owner".
    const h1 = await makeHotel("Owner Test A", OWNER);
    const h2 = await makeHotel("Owner Test B", Number(`91${OWNER}`));
    const hOff = await makeHotel("Owner Test Off", OWNER, { active: false }); // switched off by superadmin
    const hPlan2 = await makeHotel("Owner Test Plan2", PLAN2_OWNER, { product_plan: "CLOUD_APP" });
    const hPlan2b = await makeHotel("Owner Test Plan2 mine", OWNER, { product_plan: "CLOUD_APP" }); // owner's Plan 2 outlet
    const hOther = await makeHotel("Someone else", OTHER_OWNER);

    const o1 = await makeUser(h1, "A", OWNER, PW);
    await makeUser(h2, "Owner", `+91${OWNER}`, PW);
    await makeUser(hOff, "Owner", OWNER, PW);
    await makeUser(hPlan2b, "Owner", OWNER, PW);
    await makeUser(h1, "Cashier", STAFF, PW);
    await makeUser(hPlan2, "Owner", PLAN2_OWNER, PW);
    await makeUser(hOther, "Owner", OTHER_OWNER, PW);

    const reg = (hotel, seenAgoMs, extra = {}) => M.LocalServerRegistration.create({
        hotel_id: hotel.id, device_id: `dev-${hotel.id}`, installation_id: `inst-${hotel.id}-${stamp}`, status: "active",
        hostname: `PC-${hotel.id}`, app_version: "1.1.1", last_seen_at: new Date(Date.now() - seenAgoMs), ...extra,
    });
    await reg(h1, 20 * 1000);
    await reg(h2, 10 * 60 * 1000, { update_status: "ready 1.1.2" });

    console.log("\nlogin");
    let r = await post("/login", { mobile: OWNER, password: "nope", device: phone("p1") });
    check("wrong password is refused", r.ok === false && r.error === "wrong-password", r);
    r = await post("/login", { mobile: STAFF, password: PW, device: phone("p1") });
    check("a staff login is refused as not-owner", r.ok === false && r.error === "not-owner", r);
    r = await post("/login", { mobile: PLAN2_OWNER, password: PW, device: phone("p1") });
    check("a Plan 2 owner is sent to the POS App", r.ok === false && r.error === "plan-2", r);
    r = await post("/login", { mobile: "12345", password: PW, device: phone("p1") });
    check("a short mobile is refused", r.ok === false && r.error === "wrong-password", r);
    r = await post("/login", { mobile: OWNER, password: PW, device: {} });
    check("a phone without an id is refused", r.ok === false && r.error === "device", r);
    r = await post("/login", { mobile: `+91 ${OWNER.slice(0, 5)} ${OWNER.slice(5)}`, password: PW, device: phone("p1") });
    check("owner logs in with a formatted +91 mobile", r.ok === true && !!r.session?.token, r);
    const t1 = r.session?.token;
    check("session names the owner", r.session?.owner?.mobile === OWNER, r.session?.owner);

    console.log("\noutlets");
    r = await call("outlets", t1);
    const ids = (r.result?.outlets || []).map((x) => x.id);
    check("both Plan 1 outlets are listed (plain and 91-prefixed owner number)", ids.includes(h1.id) && ids.includes(h2.id), ids);
    check("a switched-off outlet is not listed", !ids.includes(hOff.id), ids);
    check("the owner's Plan 2 outlet is not listed", !ids.includes(hPlan2b.id), ids);
    check("someone else's outlet is not listed", !ids.includes(hOther.id), ids);
    const a = r.result?.outlets?.find((x) => x.id === h1.id);
    const b = r.result?.outlets?.find((x) => x.id === h2.id);
    check("outlet A PC is online (seen 20 s ago)", a?.pc?.status === "online", a?.pc);
    check("outlet B PC is offline (seen 10 min ago)", b?.pc?.status === "offline", b?.pc);
    check("PC version, name and update status come through", a?.pc?.version === "1.1.1" && a?.pc?.pcName === `PC-${h1.id}` && b?.pc?.updateStatus === "ready 1.1.2", { a: a?.pc, b: b?.pc });
    check("server time is sent for 'X min ago'", !!r.result?.serverTime);

    console.log("\nguards");
    r = await call("outlets", null);
    check("no token = 401 session-ended", r.status === 401 && r.code === "session-ended", r);
    r = await call("outlets", "not-a-token");
    check("garbage token = 401", r.status === 401, r);
    const posToken = require("jsonwebtoken").sign({ typ: "pos-app", hid: h1.id, uid: o1.id, did: "p1" }, process.env.OWNER_JWT_SECRET);
    r = await call("outlets", posToken);
    check("a POS App token type is refused", r.status === 401, r);
    r = await call("noSuchCall", t1);
    check("unknown call = 404", r.status === 404, r);
    const { ownOutlet } = require("../ownerv1/outlets");
    const fakeOwner = { outletIds: new Set([h1.id, h2.id]) };
    let threw = false;
    try { ownOutlet(fakeOwner, hOther.id); } catch (e) { threw = /do not own/.test(e.message); }
    check("ownOutlet refuses someone else's outlet", threw);
    check("ownOutlet accepts an owned outlet (string id)", ownOutlet(fakeOwner, String(h2.id)) === h2.id);

    console.log("\nresume & devices");
    r = await post("/resume", { token: t1, device: phone("p1") });
    check("resume on the same phone works", r.ok === true && r.session?.owner?.mobile === OWNER, r);
    r = await post("/resume", { token: t1, device: phone("other-phone") });
    check("resume from another phone with a copied token is refused", r.ok === false, r);
    r = await post("/login", { mobile: OWNER, password: PW, device: phone("p2") });
    const t2 = r.session?.token;
    check("a second phone can log in too", !!t2, r);
    await call("setPushToken", t1, "push-token-A");
    await call("setPushToken", t2, "push-token-A");
    const rows = await M.OwnerDevice.findAll({ where: { owner_mobile: OWNER }, raw: true });
    check("a push token belongs to one phone at a time", rows.filter((x) => x.push_token === "push-token-A").length === 1 && rows.find((x) => x.device_id === "p2")?.push_token === "push-token-A", rows.map((x) => [x.device_id, x.push_token]));
    r = await call("setLanguage", t1, "gu");
    check("language is saved", r.result?.language === "gu", r);
    r = await call("setLanguage", t1, "xx");
    check("an unknown language falls back to English", r.result?.language === "en", r);

    console.log("\nlogged-in devices (Owner Dashboard)");
    r = await post("/login", { mobile: OWNER, password: PW, device: { ...phone("web-browser-1"), name: "Chrome on Windows" } });
    const tWeb = r.session?.token;
    check("a browser logs in like a phone", !!tWeb, r);
    r = await post("/login", { mobile: OWNER, password: PW, device: phone("p3") });
    const t3dev = r.session?.token;
    r = await call("devices", tWeb);
    const devs = r.result?.devices || [];
    check("devices lists every active phone and browser", devs.length === 4 && devs.filter((d) => d.current).length === 1, devs);
    check("the browser is marked web and current", devs.find((d) => d.current)?.web === true && devs.find((d) => d.current)?.name === "Chrome on Windows", devs);
    const otherOwner = await M.OwnerDevice.create({ owner_mobile: "9999999999", hotel_user_id: o1.id, password_fp: "x", device_id: `other-${stamp}`, status: "active" });
    r = await call("logoutDevice", tWeb, otherOwner.id);
    check("logoutDevice cannot touch another owner's device", (await M.OwnerDevice.findByPk(otherOwner.id)).status === "active", r);
    await otherOwner.destroy();
    r = await call("logoutDevice", tWeb, devs.find((d) => d.current).id);
    check("logoutDevice refuses this session itself", r.ok === false && /Log out/.test(r.error || ""), r);
    const p3row = await M.OwnerDevice.findOne({ where: { owner_mobile: OWNER, device_id: "p3" }, raw: true });
    r = await call("logoutDevice", tWeb, p3row.id);
    check("logoutDevice logs another phone out", r.ok === true && r.result.devices.length === 3 && !r.result.devices.some((d) => d.id === p3row.id), r);
    r = await call("outlets", t3dev);
    check("the phone logged out from the dashboard gets 401", r.status === 401, r);
    await call("logout", tWeb);

    console.log("\nsession end");
    r = await call("logout", t2);
    check("logout answers ok", r.ok === true, r);
    r = await call("outlets", t2);
    check("after logout the token is dead", r.status === 401, r);
    const p2 = await M.OwnerDevice.findOne({ where: { owner_mobile: OWNER, device_id: "p2" }, raw: true });
    check("logout clears the push token", p2?.push_token === null && p2?.status === "revoked", p2);
    await M.HotelUser.update({ password: await bcrypt.hash("changed-at-outlet", 4) }, { where: { id: o1.id } });
    r = await call("outlets", t1);
    check("changing the password at the outlet ends the session", r.status === 401, r);
    r = await post("/login", { mobile: OWNER, password: PW, device: phone("p1") });
    check("old password still opens via the other outlet's owner login", r.ok === true, r);
    const t3 = r.session?.token;
    await M.HotelUser.update({ active: false }, { where: { hotel_id: h2.id, number: `+91${OWNER}` } });
    r = await call("outlets", t3);
    check("switching off the login's owner row ends the session", r.status === 401, r);
    r = await post("/login", { mobile: OWNER, password: "changed-at-outlet", device: phone("p1") });
    const t4 = r.session?.token;
    r = await call("outlets", t4);
    check("with outlet B's owner login off, only outlet A is listed", r.result?.outlets?.length === 1 && r.result.outlets[0].id === h1.id, r.result);

    console.log("\nheartbeat backlog (exe 1.1.7+)");
    // The outlet PC reports bills still to upload + the age of its last
    // upload on the heartbeat; the owner sees them on the outlet's card.
    const { signDeviceToken } = require("../middleware/deviceAuth");
    const regA = await M.LocalServerRegistration.findOne({ where: { hotel_id: h1.id, status: "active" } });
    const devToken = signDeviceToken({ hotel_id: h1.id, device_id: regA.device_id, installation_id: regA.installation_id });
    const beat = (headers) => fetch(`${syncBase}/heartbeat`, { headers: { Authorization: `Bearer ${devToken}`, "x-exe-version": "1.1.7", ...headers } }).then((x) => x.json());
    // Outside the model on purpose (model/localServerRegistration.js): read with SQL.
    const backlogOf = async (hid) => (await sequelize.query("SELECT pending_orders, last_push_at FROM local_server_registrations WHERE hotel_id = ? AND status = 'active'", { replacements: [hid], type: "SELECT" }))[0];
    let hb = await beat({ "x-exe-pending-orders": "6", "x-exe-last-push-age": "120" });
    check("heartbeat with backlog headers answers ok", hb && !hb.error, hb);
    let bl = await backlogOf(h1.id);
    check("pending bills stored", bl.pending_orders === 6, bl);
    const ageMs = Date.now() - new Date(bl.last_push_at).getTime();
    check("last upload time = cloud now - age (about 2 min)", ageMs > 115000 && ageMs < 130000, ageMs);
    const tNew = (await post("/login", { mobile: OWNER, password: "changed-at-outlet", device: phone("p1") })).session?.token;
    r = await call("outlets", tNew);
    const pcA = r.result?.outlets?.find((x) => x.id === h1.id)?.pc;
    check("owner sees 6 bills waiting and the last upload", pcA?.pendingOrders === 6 && !!pcA?.lastPushAt, pcA);
    await beat({ "x-exe-pending-orders": "lots", "x-exe-last-push-age": "-5" });
    bl = await backlogOf(h1.id);
    check("junk header values are ignored (old values kept)", bl.pending_orders === 6, bl);
    await beat({});
    bl = await backlogOf(h1.id);
    check("a heartbeat without the headers (older exe) changes nothing", bl.pending_orders === 6, bl);
    await beat({ "x-exe-pending-orders": "0", "x-exe-last-push-age": "3" });
    bl = await backlogOf(h1.id);
    check("a cleared backlog reads 0", bl.pending_orders === 0, bl);
    const fresh = { ...(await M.LocalServerRegistration.findOne({ where: { hotel_id: h2.id, status: "active" }, raw: true })), ...(await backlogOf(h2.id)) };
    const { pcView } = require("../ownerv1/outlets");
    const v = pcView(fresh, Date.now());
    check("an outlet whose exe never sent it reads null (app shows '—')", fresh.pending_orders === null && v.pendingOrders === null && v.lastPushAt === null, v);

    console.log("\nwatch (phase 1): bills uploaded by the outlet PC");
    {
        const { outletClock, businessDate } = require("../appv1/core");
        const today = businessDate(await outletClock(h1.id));
        const lastWeek = moment(today).subtract(7, "days").format("YYYY-MM-DD");
        const catalog = await M.MenuCatalog.create({ name: "Main Menu", hotel_id: h1.id, is_default: true, enter_by: "t" });
        const cat = await M.Menu_categ.create({ menu_categ_nm: "Starters", hotel_id: h1.id, rank: 1, menu_catalog_id: catalog.id });
        const paneer = await M.Menu.create({ item_name: "Paneer Tikka", price: "320", shortCode: "PT", sub_categories: "Regular Veg", menu_categ_id: cat.id, hotel_id: h1.id, active: true });
        const naan = await M.Menu.create({ item_name: "Butter Naan", price: "60", shortCode: "BN", sub_categories: "Regular Veg", menu_categ_id: cat.id, hotel_id: h1.id, active: true });
        const hall = await M.TableCatagories.create({ type: "T", table_catag_nm: "AC Hall", hotel_id: h1.id, rank: 1 });
        const garden = await M.TableCatagories.create({ type: "T", table_catag_nm: "Garden", hotel_id: h1.id, rank: 2 });
        const T1 = await M.Table.create({ table_name: "T1", type: "T", table_catag_id: hall.id, hotel_id: h1.id, capacity: 4, table_status: "R" });
        const T2 = await M.Table.create({ table_name: "T2", type: "T", table_catag_id: hall.id, hotel_id: h1.id, capacity: 4, table_status: "F" });
        await M.Table.create({ table_name: "G1", type: "T", table_catag_id: garden.id, hotel_id: h1.id, capacity: 4, table_status: "F" });
        await M.Table.create({ table_name: "G9", type: "T", table_catag_id: garden.id, hotel_id: h1.id, capacity: 4, table_status: "F", active: false });
        const ravi = await makeUser(h1, "Captain", mobile(6), PW, { name: "Ravi Solanki" });
        const meena = await makeUser(h1, "Cashier", mobile(7), PW, { name: "Meena Joshi" });

        const ago = (min) => new Date(Date.now() - min * 60000).toISOString();
        const line = (menu, qty, price, kot, atMin, extra = {}) => ({ MenuId: menu.id, qty, price, order_type: "dinin", kotNumber: kot, totalDiscount: 0, status: "kot", payment_status: "pending", comment: "", addons: [], variant_name: "", firedBy: ravi.id, createdAt: ago(atMin), ...extra });
        const ev = (action, by, atMin, extra = {}) => ({ action, event: action, by: by.name, user: by.id, at: ago(atMin), kot: null, detail: null, ...extra });
        const order = (localId, billNo, extra) => ({
            local_id: localId, bill_no: String(billNo), order_type: "dinin", payment: "pending", status: "dispatch", totalAmount: 0, gst: 0, grandAmount: 0, roundOff: 0,
            totalDiscount: 0, discount_reason: "", discount_type: "fix", discount_value: 0, service_charge: 0, delivery_charge: 0, packaging_charge: 0,
            cash: 0, upi: 0, card: 0, due: 0, other_payments: "[]", other_amount: 0, tip: 0, billPrintCount: 0, billed_at: null, total_sgst: 0, total_cgst: 0,
            deleted: false, token: 0, business_date: today, createdAt: ago(30), TableId: null, customer: null, details: [], taxes: [], hotelUserId: ravi.id, created_from: "web", ...extra,
        });
        const settled = (extra) => ({ payment: "success", status: "success", ...extra });
        // Times stay inside today's business day even right after midnight.
        const sinceDayStart = Math.floor((Date.now() - moment.tz(today, "YYYY-MM-DD", "Asia/Kolkata").valueOf()) / 60000);
        const cap = (m) => Math.min(m, Math.max(1, sinceDayStart - 1));
        const payload = [
            order(9001, 101, settled({ TableId: T2.id, totalAmount: 640, grandAmount: 640, upi: 640, createdAt: ago(cap(30)), details: [line(paneer, 2, 320, 1, cap(70))],
                timeline: [ev("place_order", ravi, cap(72)), ev("kot", ravi, cap(70), { kot: 1 }), ev("settle", meena, cap(30))] })),
            order(9002, 102, { TableId: T1.id, totalAmount: 500, grandAmount: 500, createdAt: ago(100), details: [line(paneer, 1, 320, 1, 98), line(naan, 3, 60, 2, 40)],
                timeline: [ev("place_order", ravi, 100), ev("kot", ravi, 98, { kot: 1 }), ev("kot", ravi, 40, { kot: 2 })] }),
            order(9003, 103, { TableId: T2.id, deleted: true, totalAmount: 380, grandAmount: 380, createdAt: ago(cap(50)), details: [line(paneer, 1, 320, 1, cap(55)), line(naan, 1, 60, 1, cap(55))],
                timeline: [ev("place_order", ravi, cap(56)), ev("kot", ravi, cap(55), { kot: 1 }), ev("delete_order", meena, cap(50), { detail: { reason: "Customer left" } })] }),
            order(9004, 104, settled({ order_type: "pickup", totalAmount: 1000, totalDiscount: 350, discount_type: "pr", discount_value: 35, grandAmount: 650, cash: 650, createdAt: ago(cap(20)), details: [line(paneer, 3, 320, 1, cap(25), { order_type: "pickup" }), line(naan, 1, 40, 1, cap(25), { order_type: "pickup" })],
                timeline: [ev("place_order", meena, cap(26)), ev("kot", meena, cap(25), { kot: 1 }), ev("settle", meena, cap(20))] })),
            order(9005, 105, settled({ order_type: "pickup", totalAmount: 120, grandAmount: 120, cash: 120, createdAt: ago(cap(15)), details: [line(naan, 2, 60, 1, cap(18), { order_type: "pickup" })],
                timeline: [ev("place_order", meena, cap(18)), ev("settle", meena, cap(16)), ev("update_order", meena, cap(15))] })),
            order(9006, 106, settled({ order_type: "pickup", totalAmount: 200, grandAmount: 200, due: 200, createdAt: ago(cap(10)), customer: { local_id: 77, name: "Rakesh Patel", number: "9824012345", isPlaceholder: false }, details: [line(naan, 2, 100, 1, cap(12), { order_type: "pickup" })],
                timeline: [ev("place_order", meena, cap(12)), ev("settle", meena, cap(10))] })),
            order(9007, 90, settled({ order_type: "pickup", business_date: lastWeek, totalAmount: 1000, grandAmount: 1000, cash: 1000, createdAt: moment.tz(lastWeek, "YYYY-MM-DD", "Asia/Kolkata").add(1, "minute").toISOString(), details: [line(naan, 10, 100, 1, 7 * 1440, { order_type: "pickup" })] })),
        ];
        const pushOrders = (orders) => fetch(`${syncBase}/push/orders`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${devToken}` }, body: JSON.stringify({ orders }) }).then((x) => x.json());
        const resultsOf = (pr) => pr?.results?.results || pr?.results || [];
        let pr = await pushOrders(payload);
        check("the PC's upload of 7 bills is accepted", resultsOf(pr).length === 7 && resultsOf(pr).every((x) => x.ok), pr);
        const cloud = Object.fromEntries((await M.Order.findAll({ where: { hotel_id: h1.id }, raw: true })).map((x) => [x.bill_no, x]));
        check("the captain (staff) of the bill is stored", cloud["102"]?.hotelUserId === ravi.id, cloud["102"]?.hotelUserId);
        const lines102 = await M.OrderDetails.findAll({ where: { orderId: cloud["102"].id }, order: [["kotNumber", "ASC"]], raw: true });
        check("KOT time and who sent it are kept per line", lines102.length === 2 && Math.abs(new Date(lines102[1].createdAt) - new Date(payload[1].details[1].createdAt)) < 2000 && lines102[0].firedBy === ravi.id, lines102.map((l) => [l.createdAt, l.firedBy]));
        let tl = await M.TimeLine.count({ where: { order_id: cloud["102"].id, hotel_id: h1.id } });
        check("the bill's 3 events are stored", tl === 3, tl);
        await pushOrders(payload);
        tl = await M.TimeLine.count({ where: { order_id: cloud["102"].id, hotel_id: h1.id } });
        check("a second upload replaces the events, never duplicates them", tl === 3, tl);
        const legacy = order(9008, 107, settled({ order_type: "pickup", totalAmount: 60, grandAmount: 60, cash: 60, createdAt: ago(cap(5)), details: [line(naan, 1, 60, 1, cap(6), { order_type: "pickup" })] }));
        delete legacy.timeline; delete legacy.hotelUserId; delete legacy.created_from;
        delete legacy.details[0].firedBy; delete legacy.details[0].createdAt;
        pr = await pushOrders([legacy]);
        check("an older PC's upload (no events, no captain) still works", resultsOf(pr)[0]?.ok === true, pr);
        const strange = order(9009, 108, settled({ order_type: "pickup", totalAmount: 10, grandAmount: 10, cash: 10, hotelUserId: 999999999, timeline: [{ action: "settle", by: "x", at: "not-a-date" }] }));
        pr = await pushOrders([strange]);
        const s108 = await M.Order.findOne({ where: { hotel_id: h1.id, bill_no: "108" }, raw: true });
        check("a staff id of another outlet is dropped, a bad event date skipped", resultsOf(pr)[0]?.ok === true && s108.hotelUserId === null && (await M.TimeLine.count({ where: { order_id: s108.id } })) === 0, s108);
        await M.Order.update({ deleted: true }, { where: { id: s108.id } }); // keep the figures below simple

        const T = tNew;
        r = await call("home", T);
        const hA = r.result?.outlets?.find((x) => x.id === h1.id);
        check("home: net sales today = settled bills (640+650+120+200+60)", hA?.net === 1670, hA);
        check("home: 5 bills, 2 cancelled, 1 of 3 tables running with ₹500 open", hA?.bills === 5 && hA?.cancelled === 2 && hA?.runningTables === 1 && hA?.totalTables === 3 && hA?.openAmount === 500, hA);
        check("home: items sold today (2+4+2+2+1)", hA?.items === 11, hA?.items);
        check("home: compared with last week's same weekday so far (₹1,000)", hA?.compareNet === 1000 && /^vs last /.test(hA?.compareLabel || ""), hA && [hA.compareNet, hA.compareLabel]);
        check("home: hourly sales add up to the day's net", Math.abs((hA?.hourly || []).reduce((a, x) => a + x.amount, 0) - 1670) < 0.01, hA?.hourly);
        check("home: a risky action needs attention", ["edited", "cancel-after-kot", "discount"].includes(r.result?.attention?.kind), r.result?.attention);

        const cs = await M.CashSession.create({ hotel_id: h1.id, opening_float: 2000, status: "Open", opened_at: new Date(Date.now() - 5 * 3600000), deleted: false, hotelUserId: meena.id });
        await M.CashMovement.bulkCreate([{ cashSessionId: cs.id, amount: 2000, type: "Opening" }, { cashSessionId: cs.id, amount: 770, type: "Sale" }]).catch((e) => console.log("    (cash movement:", e.message, ")"));
        r = await call("outlet", T, h1.id, { key: "today" });
        const out = r.result;
        check("outlet: net, bills, avg bill", out?.net === 1670 && out?.bills === 5 && out?.avgBill === 334, out && [out.net, out.bills, out.avgBill]);
        check("outlet: discount and cancelled counts", out?.discount === 350 && out?.cancelled === 2, out && [out.discount, out.cancelled]);
        check("outlet: payment mix by mode name", JSON.stringify(out?.payments?.map((p) => p.name).sort()) === JSON.stringify(["Cash", "Due", "UPI"]), out?.payments);
        check("outlet: top item is Paneer Tikka", out?.topItems?.[0]?.name === "Paneer Tikka", out?.topItems);
        check("outlet: open cash drawer = sum of its movements, opened by Meena", out?.cash?.expected === 2770 && out?.cash?.by === "Meena Joshi", out?.cash);
        r = await call("outlet", T, h1.id, { key: "yesterday" });
        check("outlet: yesterday has none of today's bills", r.result?.bills === 0 && r.result?.net === 0, r.result && [r.result.bills, r.result.net]);
        r = await call("outlet", T, h1.id, { key: "7d" });
        check("outlet: 7 days gives a per-day series ending today", r.result?.daily?.length === 7 && r.result.daily[6].day === today && r.result.daily[6].amount === 1670, r.result?.daily);
        r = await call("outlet", T, h1.id, { key: "custom", from: "2026-01-01", to: "2026-09-01" });
        check("outlet: a custom range over 3 months is refused", r.ok === false, r);
        r = await call("outlet", T, hOther.id, { key: "today" });
        check("outlet: someone else's outlet is refused", r.ok === false && /do not own/.test(r.error || ""), r);

        r = await call("tables", T, h1.id);
        const secs = r.result?.sections || [];
        const all = secs.flatMap((s) => s.tables);
        const t1v = all.find((t) => t.name === "T1");
        check("tables: grouped by section (AC Hall, Garden)", secs.map((s) => s.name).join(",") === "AC Hall,Garden", secs.map((s) => s.name));
        check("tables: T1 running ₹500, captain Ravi, open 100 min = overdue", t1v?.state === "running" && t1v.amount === 500 && t1v.captain === "Ravi Solanki" && t1v.minutes >= 99 && t1v.overdue === true, t1v);
        check("tables: T2 (settled + cancelled) and G1 are free; switched-off G9 hidden", all.filter((t) => t.state === "free").map((t) => t.name).sort().join(",") === "G1,T2" && !all.some((t) => t.name === "G9"), all);
        check("tables: 1 running of 3", r.result?.running === 1 && r.result?.total === 3, r.result && [r.result.running, r.result.total]);

        r = await call("bills", T, { range: { key: "today" } });
        const c = r.result?.counts || {};
        check("bills: counts per filter", c.all === 8 && c.running === 1 && c.settled === 5 && c.cancelled === 2 && c.edited === 1 && c.due === 1 && c.discount === 1, c);
        const tagOfBill = (no) => r.result?.bills?.find((b) => b.billNo === no)?.tag?.text;
        check("bills: tags say what the owner worries about", tagOfBill("103") === "Cancelled after KOT" && tagOfBill("105") === "Edited after settle" && tagOfBill("106") === "Due" && tagOfBill("104") === "35% discount" && tagOfBill("102") === "Running" && tagOfBill("101") === "Settled",
            r.result?.bills?.map((b) => [b.billNo, b.tag.text]));
        check("bills: table names include the section", r.result?.bills?.find((b) => b.billNo === "102")?.place === "T1 AC Hall", r.result?.bills?.find((b) => b.billNo === "102"));
        check("bills: newest first", r.result?.bills?.[0]?.at >= r.result?.bills?.at(-1)?.at, r.result?.bills?.map((b) => [b.billNo, b.at]));
        r = await call("bills", T, { range: { key: "today" }, filter: "cancelled" });
        const can = r.result?.bills?.find((b) => b.billNo === "103");
        check("bills: cancelled filter, says who cancelled", r.result?.bills?.length === 2 && can?.sub === "Meena Joshi", r.result?.bills);
        r = await call("bills", T, { range: { key: "today" }, search: "98240" });
        check("bills: search by customer mobile", r.result?.bills?.length === 1 && r.result.bills[0].billNo === "106", r.result?.bills);
        r = await call("bills", T, { range: { key: "today" }, search: "t1" });
        check("bills: search by table", r.result?.bills?.map((b) => b.billNo).join(",") === "102", r.result?.bills);
        r = await call("bills", T, { outletId: hOther.id, range: { key: "today" } });
        check("bills: someone else's outlet is refused", r.ok === false, r);

        r = await call("bill", T, h1.id, cloud["102"].id);
        const b2 = r.result;
        check("bill: 2 KOTs with their own times, sent by Ravi", b2?.kots?.length === 2 && b2.kots[0].by === "Ravi Solanki" && Math.abs(new Date(b2.kots[1].at) - new Date(payload[1].details[1].createdAt)) < 2000, b2?.kots);
        check("bill: table, section and captain", b2?.table === "T1" && b2?.section === "AC Hall" && b2?.captain === "Ravi Solanki", b2 && [b2.table, b2.section, b2.captain]);
        check("bill: activity in order with labels and roles", JSON.stringify(b2?.activity?.map((a) => a.label)) === JSON.stringify(["Order opened", "KOT 1 sent", "KOT 2 sent"]) && b2.activity[0].role === "Captain", b2?.activity);
        r = await call("bill", T, h1.id, cloud["103"].id);
        const last = r.result?.activity?.at(-1);
        check("bill: cancel reason and who cancelled", r.result?.cancelReason === "Customer left" && last?.label === "Cancelled — Customer left" && last?.by === "Meena Joshi" && last?.role === "Cashier", r.result && [r.result.cancelReason, r.result.activity]);
        r = await call("bill", T, h1.id, cloud["101"].id);
        check("bill: payments and cashier of a settled bill", r.result?.payments?.[0]?.name === "UPI" && r.result?.payments?.[0]?.amount === 640 && r.result?.cashier === "Meena Joshi", r.result && [r.result.payments, r.result.cashier]);
        r = await call("bill", T, hOther.id, cloud["101"].id);
        check("bill: through someone else's outlet is refused", r.ok === false, r);
        const otherOrder = await M.Order.create({ hotel_id: hOther.id, bill_no: "1", order_type: "pickup", business_date: today, payment: "success", grandAmount: 10 });
        r = await call("bill", T, h1.id, otherOrder.id);
        check("bill: another outlet's bill id through my outlet is not found", r.ok === false, r);
    }

    console.log("\nreports (phase 2) + stock upload");
    {
        const T = tNew;
        const today = (await call("outlet", T, h1.id, { key: "today" })).result.range.from;
        const rep = async (id, extra = {}) => (await call("report", T, { id, range: { key: "today" }, ...extra })).result;
        let r = await call("reportCatalog", T);
        check("catalog: 14 reports in 3 groups", r.result?.reports?.length === 14 && new Set(r.result.reports.map((x) => x.group)).size === 3, r.result?.reports?.map((x) => x.id));

        let x = await rep("day-wise");
        check("day wise: today = ₹1,670 over 5 bills, no guests column", x?.rows?.length === 1 && x.rows[0].sales === 1670 && x.rows[0].bills === 5 && !x.columns.some((c) => c.key === "guests"), x);
        x = await rep("item-wise");
        check("item wise: by item, merged, visual ranked", x?.view === "item" && x.rows.some((y) => y.name === "Paneer Tikka") && x.visual?.items?.[0]?.value >= x.visual?.items?.[1]?.value, x?.visual);
        x = await rep("item-wise", { view: "category" });
        check("item wise: by category", x?.view === "category" && x.rows.length === 1 && x.rows[0].name === "Starters", x?.rows);
        x = await rep("item-wise", { view: "outlet" });
        check("item wise: by outlet", x?.rows?.length === 1 && x.rows[0].outlet === h1.hotel_name, x?.rows);
        x = await rep("payment-mode");
        const modes = Object.fromEntries((x?.rows || []).map((y) => [y.mode, y.amount]));
        check("payment mode: UPI 640, Cash 830, Due 200", modes.UPI === 640 && modes.Cash === 830 && modes.Due === 200, x?.rows);
        x = await rep("hourly");
        check("hourly: adds up to ₹1,670, in hour order", x?.totals?.sales === 1670 && x.rows.length >= 1, x?.rows);
        x = await rep("outlets");
        check("outlet comparison: my one outlet with sales, cancelled, expenses", x?.rows?.length === 1 && x.rows[0].sales === 1670 && x.rows[0].cancelled === 2, x?.rows);
        x = await rep("cancelled-edited");
        const c103 = x?.rows?.find((y) => y.bill === "103");
        check("cancelled: who, after KOT, reason", c103?.by === "Meena Joshi" && c103?.after === "After KOT" && c103?.reason === "Customer left", x?.rows);
        x = await rep("cancelled-edited", { view: "edited" });
        check("edited after settle: bill 105 by Meena", x?.rows?.length === 1 && x.rows[0].bill === "105" && x.rows[0].by === "Meena Joshi", x?.rows);
        x = await rep("discount");
        check("discount: bill 104 at 35%", x?.rows?.length === 1 && x.rows[0].pct === 35 && x.rows[0].amount === 350, x?.rows);
        x = await rep("due");
        check("due now: Rakesh owes ₹200 on bill 106", x?.view === "outstanding" && x.rows.some((y) => y.customer === "Rakesh Patel" && y.amount === 200 && y.bill === "106"), x?.rows);
        x = await rep("due", { view: "received" });
        check("due received: a list (none collected yet)", Array.isArray(x?.rows), x);
        x = await rep("tax");
        check("tax: answers", Array.isArray(x?.rows), x);
        x = await rep("cash-session");
        check("cash sessions: the open session", x?.rows?.length >= 1 && x.rows.some((y) => y.status === "Open"), x?.rows);
        x = await rep("expense");
        check("expenses: answers", Array.isArray(x?.rows), x);
        x = await rep("purchases-wastage");
        check("purchases: answers", x?.view === "purchases" && Array.isArray(x.rows), x);
        r = await call("report", T, { id: "day-wise", outletId: hOther.id, range: { key: "today" } });
        check("someone else's outlet is refused", r.ok === false, r);
        r = await call("report", T, { id: "nope", range: { key: "today" } });
        check("an unknown report is refused", r.ok === false, r);
        r = await call("report", T, { id: "day-wise", range: { key: "custom", from: "2026-01-01", to: "2026-08-01" } });
        check("more than 3 months is refused", r.ok === false, r);

        // ---- stock, uploaded by the PC ----
        x = await rep("stock");
        check("stock before any upload says so", x?.rows?.length === 0 && /1\.1\.7/.test(x?.note || ""), x);
        const unit = await M.Unit.create({ unit_name: "Gram", shortName: "g", hotel_id: h1.id });
        const kg = await M.Unit.create({ unit_name: "Kilogram", shortName: "kg", hotel_id: h1.id });
        const paneerRaw = await M.RawMaterial.create({ raw_material_name: "Paneer", purchase_price: "300", unit_id: kg.id, consumption_unit: unit.id, conversion_qty: 1000, mini_stock_level_qty: 2000, hotel_id: h1.id });
        const milk = await M.RawMaterial.create({ raw_material_name: "Milk", purchase_price: "60", unit_id: kg.id, consumption_unit: unit.id, conversion_qty: 1000, mini_stock_level_qty: 1000, hotel_id: h1.id });
        const foreign = await M.RawMaterial.create({ raw_material_name: "Not mine", purchase_price: "1", unit_id: kg.id, hotel_id: hOther.id });
        const pushStock = (body) => fetch(`${syncBase}/push/stock`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${devToken}` }, body: JSON.stringify(body) }).then((y) => y.json());
        const yday = moment(today).subtract(1, "day").format("YYYY-MM-DD");
        const old = moment(today).subtract(10, "day").format("YYYY-MM-DD");
        const day = (date, id, cols) => ({ date, rows: [{ kind: "raw", id, ...cols }] });
        let ps = await pushStock({
            snapshot: [{ kind: "raw", id: paneerRaw.id, qty: 1500, cost: 0.3, value: 450 }, { kind: "raw", id: milk.id, qty: 5000, cost: 0.06, value: 300 }, { kind: "raw", id: foreign.id, qty: 1, cost: 1, value: 1 }],
            days: [day(old, paneerRaw.id, { opening_entry_qty: 4, opening_entry_value: 1200 }), day(yday, paneerRaw.id, { purchased_qty: 2, purchased_value: 600, used_qty: -3, used_value: -900 }), day(today, paneerRaw.id, { used_qty: -1.5, used_value: -450, wastage_qty: -0.5, wastage_value: -150 })],
        });
        check("the PC's stock upload is accepted; another outlet's item dropped", ps?.results?.levels === 2 && ps?.results?.days === 3, ps);
        x = await rep("stock");
        const pRow = x?.rows?.find((y) => y.item === "Paneer");
        check("in hand: Paneer 1500 g, minimum 2000 = Low; Milk OK", pRow?.stock === 1500 && pRow?.unit === "g" && pRow?.status === "Low" && x.rows.find((y) => y.item === "Milk")?.status === "OK" && !x.note, x?.rows);
        check("in hand: value total and low count", x?.summary?.find((s) => s.label === "Stock value")?.value === 750 && x?.summary?.find((s) => s.label === "Low")?.value === 1, x?.summary);
        x = await rep("stock", { view: "ledger" });
        const lRow = x?.rows?.find((y) => y.item === "Paneer");
        check("ledger today: opening 3000 g, used 1500, wastage 500, closing 1000", lRow?.opening === 3000 && lRow?.used === 1500 && lRow?.wastage === 500 && lRow?.purchased === 0 && lRow?.closing === 1000, lRow);
        x = (await call("report", T, { id: "stock", view: "ledger", range: { key: "7d" } })).result;
        const l7 = x?.rows?.find((y) => y.item === "Paneer");
        check("ledger 7 days: opening 4000, +2000, −4500 used, closing 1000", l7?.opening === 4000 && l7?.purchased === 2000 && l7?.used === 4500 && l7?.closing === 1000, l7);
        ps = await pushStock({ days: [day(today, paneerRaw.id, { used_qty: -1, used_value: -300 })] });
        x = await rep("stock", { view: "ledger" });
        check("a day uploaded again replaces that day (not added)", x?.rows?.find((y) => y.item === "Paneer")?.used === 1000 && x.rows.find((y) => y.item === "Paneer").wastage === 0, x?.rows);
        ps = await pushStock({ snapshot: [{ kind: "raw", id: paneerRaw.id, qty: 2500, cost: 0.3, value: 750 }] });
        x = await rep("stock");
        check("a new snapshot replaces all levels (Milk gone from it)", x?.rows?.length === 1 && x.rows[0].status === "OK", x?.rows);
    }

    console.log("\nmanage (phase 3): guards");
    {
        const T = tNew;
        let r = await call("manage", T, hOther.id);
        check("manage: someone else's outlet is refused", r.ok === false && /do not own/.test(r.error || ""), r);
        r = await call("saveCategory", T, hOther.id, { name: "Hack" });
        check("a write to someone else's outlet is refused", r.ok === false, r);
        r = await call("manageStaff", T, h1.id);
        const ownerRow = r.result?.staff?.find((s) => s.isOwner);
        check("staff: the owner's own login is flagged", !!ownerRow, r.result?.staff);
        r = await call("setStaffPermissions", T, h1.id, ownerRow?.id, { modules: {}, special: {} });
        check("the owner's own permissions cannot be changed", r.ok === false, r);
        r = await call("setStaffActive", T, h1.id, ownerRow?.id, false);
        check("the owner's own login cannot be switched off", r.ok === false, r);
        const menuNow = (await call("manageMenu", T, h1.id)).result;
        const paneerItem = menuNow.items.find((i) => i.name === "Paneer Tikka");
        await M.Recipes.create({ hotel_id: h1.id, menu_id: Number(paneerItem.id), consumption_qty: 1 }).catch(() => null);
        const recipesBefore = await M.Recipes.count({ where: { hotel_id: h1.id, menu_id: Number(paneerItem.id) } });
        r = await call("deleteItem", T, h1.id, paneerItem.id);
        const row = await M.Menu.findOne({ where: { id: Number(paneerItem.id) }, raw: true });
        check("deleting an item only flags it (off + is_deleted), its row stays", r.ok && row && !row.active && (row.is_deleted === true || row.is_deleted === 1), row);
        check("deleting an item keeps its recipe rows (a delete would never reach the PC)", (await M.Recipes.count({ where: { hotel_id: h1.id, menu_id: Number(paneerItem.id) } })) === recipesBefore, recipesBefore);
        r = await call("manageMenu", T, h1.id);
        check("a deleted item is gone from the Owner App menu", !r.result.items.some((i) => i.id === paneerItem.id), r.result.items.map((i) => i.name));
        const changes = await M.OwnerChange.findAll({ where: { hotel_id: h1.id }, raw: true });
        check("each change is recorded for the PC", changes.some((c) => c.entity === "menuItems" && c.item_id === Number(paneerItem.id) && c.synced_at === null), changes);
        r = await call("manage", T, h1.id);
        check("hub counts what waits for the PC", r.result?.pending >= 1, r.result);
        r = await call("saveRaw", T, h1.id, { name: "Ghee", unitId: null, purchaseUnitId: null, conversion: 1, reorderLevel: 1, openingStock: 50 });
        check("no opening stock from the Owner App (refused without units, never stock)", (await M.StockInHand.count({ where: { hotel_id: h1.id } })) === 0, r);
        r = await call("removePaymentMode", T, h1.id, "pm-1");
        check("there is no way to delete a payment mode from the Owner App", r.status === 404, r);
    }

    console.log("\nalerts (phase 4)");
    {
        const A = require("../ownerv1/alerts");
        A._resetForTests();
        const T = tNew;
        await M.OwnerAlert.destroy({ where: { owner_mobile: OWNER } });
        const ownAlerts = (where = {}) => M.OwnerAlert.findAll({ where: { owner_mobile: OWNER, ...where }, raw: true });
        const now0 = new Date();
        const sc = await A.scope();
        check("scope: this owner (logged in) with outlet A", sc.some((x) => x.mobile === OWNER && x.hotels.some((h) => h.id === h1.id)), sc.map((x) => x.mobile));

        // ---- the PC goes offline and comes back ----
        await M.LocalServerRegistration.update({ last_seen_at: new Date(now0 - 20 * 60000) }, { where: { hotel_id: h1.id } });
        let out = await A.runOwnerAlerts(now0);
        let offl = await ownAlerts({ kind: "pc-offline" });
        check("PC silent 20 min (rule 10): one 'offline' alert", offl.length === 1 && /PC is offline/.test(offl[0].title) && /No contact for 20 min/.test(offl[0].body), offl);
        await A.runOwnerAlerts(new Date(now0.getTime() + 60000));
        check("the next minute does not alert again", (await ownAlerts({ kind: "pc-offline" })).length === 1);
        const back = new Date(now0.getTime() + 2 * 60000);
        await M.LocalServerRegistration.update({ last_seen_at: back }, { where: { hotel_id: h1.id } });
        await A.runOwnerAlerts(new Date(back.getTime() + 5000));
        const onl = await ownAlerts({ kind: "pc-online" });
        check("heartbeat again: one 'back online' alert", onl.length === 1 && /back online/.test(onl[0].title) && /Was offline 22 min/.test(onl[0].body), onl);
        let r = await call("pcHistory", T, h1.id);
        check("PC screen history lists the offline spell", r.result?.periods?.length === 1 && r.result.periods[0].minutes === 22, r.result);
        r = await call("saveAlertRules", T, { pcOffline: { minutes: 30 } });
        check("rule: offline after 30 min saved", r.result?.rules?.pcOffline?.minutes === 30, r);
        await M.LocalServerRegistration.update({ last_seen_at: new Date(back.getTime() - 20 * 60000 + 5 * 60000) }, { where: { hotel_id: h1.id } });
        await A.runOwnerAlerts(new Date(back.getTime() + 5 * 60000));
        check("a 20-min spell under the 30-min rule is not alerted", (await ownAlerts({ kind: "pc-offline" })).length === 1);
        await M.LocalServerRegistration.update({ last_seen_at: new Date() }, { where: { hotel_id: h1.id } });
        await A.runOwnerAlerts(new Date(Date.now() + 1000));
        check("no 'back online' for a spell that was never alerted", (await ownAlerts({ kind: "pc-online" })).length === 1);
        r = await call("saveAlertRules", T, { pcOffline: { minutes: 7 } });
        check("rule values are checked (7 min refused)", r.ok === false, r);

        // ---- risky actions from the bills uploaded earlier in this test ----
        A._resetForTests();
        out = await A.runOwnerAlerts(new Date());
        const kinds = (await ownAlerts()).map((a) => a.kind);
        const cancelA = (await ownAlerts({ kind: "cancel-after-kot" })).find((a) => /#103/.test(a.title));
        check("cancelled after KOT: who, role, reason", cancelA && /Meena Joshi \(Cashier\)/.test(cancelA.body) && /Customer left/.test(cancelA.body) && cancelA.link.startsWith(`/bill/${h1.id}/`), cancelA);
        const discA = (await ownAlerts({ kind: "discount" })).find((a) => /#104/.test(a.title));
        check("35% discount over the 20% limit", discA && /^35% discount on bill #104/.test(discA.title) && /₹350 off/.test(discA.body), discA);
        check("settled bill edited", kinds.includes("edited") && (await ownAlerts({ kind: "edited" })).some((a) => /#105/.test(a.title)), kinds);
        const before = (await ownAlerts()).length;
        A._resetForTests();
        await A.runOwnerAlerts(new Date());
        check("looking again never repeats an alert", (await ownAlerts()).length === before, before);

        // ---- cash difference at closing ----
        const cs = await M.CashSession.create({ hotel_id: h1.id, opening_float: 1000, status: "Closed", opened_at: new Date(Date.now() - 6 * 3600000), closed_at: new Date(), counted_cash: 800, variance: -200, variance_reason: "Change given wrong", deleted: false });
        await A.runOwnerAlerts(new Date());
        const cashA = await ownAlerts({ kind: "cash-diff" });
        check("cash short ₹200 at closing", cashA.length === 1 && /short by ₹200/.test(cashA[0].title) && /Change given wrong/.test(cashA[0].body), cashA);
        await cs.destroy();

        // ---- low stock, from a stock upload ----
        const paneerRaw = await M.RawMaterial.findOne({ where: { hotel_id: h1.id, raw_material_name: "Paneer" }, raw: true });
        await fetch(`${syncBase}/push/stock`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${devToken}` }, body: JSON.stringify({ snapshot: [{ kind: "raw", id: paneerRaw.id, qty: 1500, cost: 0.3, value: 450 }] }) });
        await A.runOwnerAlerts(new Date());
        await A.runOwnerAlerts(new Date(Date.now() + 60000));
        const lowA = await ownAlerts({ kind: "low-stock" });
        check("low stock: once per item per day", lowA.length === 1 && /Paneer is running low/.test(lowA[0].title) && /1,500 g left · minimum 2,000 g/.test(lowA[0].body), lowA);
        await call("saveAlertRules", T, { lowStock: { on: false } });

        // ---- the nightly day summary at the owner's time ----
        const ist = moment.tz("Asia/Kolkata");
        r = await call("saveAlertRules", T, { summary: { time: ist.clone().subtract(1, "minute").format("HH:mm") } });
        check("summary time saved", !!r.result?.rules?.summary?.time, r);
        if (ist.format("HH:mm") !== "00:00") {
            await A.runOwnerAlerts(new Date());
            await A.runOwnerAlerts(new Date(Date.now() + 60000));
            const sumA = await ownAlerts({ kind: "summary" });
            check("one day summary, sent at the owner's time", sumA.length === 1 && /^Day summary · /.test(sumA[0].title) && /across 1 outlet/.test(sumA[0].body) && sumA[0].link.startsWith("/summary/"), sumA);
            const date = sumA[0]?.link.split("/").pop();
            r = await call("daySummary", T, date);
            check("day summary: net, bills, the outlet, things worth a look", r.result?.net === 1670 && r.result.bills === 5 && r.result.outlets.length === 1 && r.result.look.cancelled === 2 && r.result.look.cancelledAfterKot === 1 && r.result.look.edited.length === 1, r.result);
        }
        await call("saveAlertRules", T, { summary: { time: "23:30" } });

        // ---- the Alerts screen ----
        r = await call("alerts", T, {});
        check("alerts list, newest first, with unread count", r.result?.alerts?.length >= 7 && r.result.unread === r.result.alerts.length && r.result.alerts[0].at >= r.result.alerts.at(-1).at, r.result && [r.result.unread, r.result.alerts.length]);
        r = await call("alerts", T, { filter: "risky" });
        check("filter: risky actions only", r.result?.alerts?.every((a) => ["cancel-after-kot", "discount", "edited", "cash-diff"].includes(a.kind)) && r.result.alerts.length >= 3, r.result?.alerts?.map((a) => a.kind));
        r = await call("markAlertsRead", T, [r.result.alerts[0].id]);
        const c1 = (await call("alertCount", T)).result.unread;
        r = await call("markAlertsRead", T, "all");
        check("mark one, then all read", c1 >= 6 && r.result?.unread === 0, [c1, r.result]);
        const otherT = (await post("/login", { mobile: OTHER_OWNER, password: PW, device: phone("po") })).session?.token;
        r = await call("alerts", otherT, {});
        check("another owner sees none of these alerts", r.ok && r.result.alerts.every((a) => a.outletId !== h1.id), r);
        r = await call("pcHistory", T, hOther.id);
        check("PC history of someone else's outlet is refused", r.ok === false, r);
    }

    console.log("\npush language (phase 5)");
    // Push texts go out in each phone's language (ownerv1/i18n.js, the app's dictionaries).
    const { tr } = require("../ownerv1/i18n");
    check("push in Hindi: PC offline title", tr("SG Hwy PC is offline", "hi") === "SG Hwy का PC ऑफ़लाइन है", tr("SG Hwy PC is offline", "hi"));
    check("push in Gujarati: cancel after KOT title", tr("Bill #1482 cancelled after KOT", "gu") === "બિલ #1482 KOT પછી રદ", tr("Bill #1482 cancelled after KOT", "gu"));
    const offBody = "No contact for 14 min · 6 bills waiting to upload · billing keeps working at the outlet";
    check("push in Hindi: offline body with a count inside", tr(offBody, "hi") === "14 मिनट से संपर्क नहीं · 6 बिल अपलोड के इंतज़ार में · आउटलेट पर बिलिंग चलती रहती है", tr(offBody, "hi"));
    check("push in Hindi: a discount '₹620 off' is not 'switched off'", tr("₹620 off · above your limit · CG Road · Arjun (Manager)", "hi") === "₹620 की छूट · आपकी सीमा से ऊपर · CG Road · Arjun (मैनेजर)", tr("₹620 off · above your limit · CG Road · Arjun (Manager)", "hi"));
    check("push in Gujarati: day summary date", tr("Day summary · Tue, 6 Oct", "gu") === "દિવસનો સારાંશ · મંગળવાર, 6 ઑક્ટો", tr("Day summary · Tue, 6 Oct", "gu"));
    check("push in English stays English", tr("SG Hwy PC is offline", "en") === "SG Hwy PC is offline");
    check("an unknown language stays English", tr("SG Hwy PC is offline", "xx") === "SG Hwy PC is offline");
    check("a name is never translated", tr("Paneer is running low", "hi") === "Paneer कम हो रहा है", tr("Paneer is running low", "hi"));

    console.log("\nthrottle");
    const LOCKME = mobile(5);
    const hl = await makeHotel("Owner Test Lock", LOCKME);
    await makeUser(hl, "Owner", LOCKME, PW);
    for (let i = 0; i < 5; i += 1) await post("/login", { mobile: LOCKME, password: "bad", device: phone("p9") });
    r = await post("/login", { mobile: LOCKME, password: PW, device: phone("p9") });
    check("5 wrong passwords lock the mobile, even for the right one", r.ok === false && r.error === "locked", r);

    if (process.env.OWNER_FIREBASE_SERVICE_ACCOUNT_FILE) {
        console.log("\nfirebase");
        const { fcm } = require("../ownerv1/push");
        const m = fcm();
        check("Firebase starts with the Owner App key", !!m);
        let code = "";
        try {
            await m.send({ token: "made-up-token-for-a-dry-run", notification: { title: "test" } }, true);
        } catch (e) {
            code = e.code || e.message;
        }
        // An auth/project problem gives a credential error; a good key gets as far as rejecting the token.
        check("Firebase accepts the key (only the made-up token is rejected)", /invalid-argument|registration-token|invalid-registration/.test(code), code);
    }
}

async function cleanup() {
    const ids = created.hotels;
    if (!ids.length) return;
    const users = await M.HotelUser.findAll({ where: { hotel_id: ids }, attributes: ["id", "role_cd"], raw: true });
    await M.OwnerDevice.destroy({ where: { hotel_user_id: users.map((u) => u.id) } });
    await M.LocalServerRegistration.destroy({ where: { hotel_id: ids } });
    const orders = await M.Order.findAll({ where: { hotel_id: ids }, attributes: ["id"], raw: true });
    await M.OrderDetails.destroy({ where: { orderId: orders.map((x) => x.id) } });
    await M.OrderTax.destroy({ where: { hmsOrderMstId: orders.map((x) => x.id) } });
    await M.Order.destroy({ where: { hotel_id: ids }, force: true });
    await M.TimeLine.destroy({ where: { hotel_id: ids } });
    const sessions = await M.CashSession.findAll({ where: { hotel_id: ids }, attributes: ["id"], raw: true });
    await M.CashMovement.destroy({ where: { cashSessionId: sessions.map((x) => x.id) } });
    await M.OwnerStockLevel.destroy({ where: { hotel_id: ids } });
    await M.OwnerChange.destroy({ where: { hotel_id: ids } });
    await M.OwnerAlert.destroy({ where: { hotel_id: ids } });
    await M.OwnerOfflinePeriod.destroy({ where: { hotel_id: ids } });
    await M.Recipes.destroy({ where: { hotel_id: ids } }).catch(() => {});
    await M.OwnerStockDay.destroy({ where: { hotel_id: ids } });
    for (const Model of [M.RawMaterial, M.Unit, M.MenuCatalog, M.AuditLog, M.ExpenseEntry, M.CashSession, M.Table, M.TableCatagories, M.Menu, M.Menu_categ, M.PaymentMode, M.TaxType, M.User]) {
        await Model.destroy({ where: { hotel_id: ids }, force: true }).catch((e) => console.error("cleanup", Model.name, e.message));
    }
    await M.HotelUser.destroy({ where: { hotel_id: ids }, force: true });
    await M.Role.destroy({ where: { hotel_id: ids } });
    await M.Hotel.destroy({ where: { id: ids }, force: true });
}

(async () => {
    const app = express();
    app.use(express.json());
    app.use("/owner/v1", require("../ownerv1/routes"));
    app.use("/sync", require("../routes/sync"));
    const server = http.createServer(app);
    await new Promise((r) => server.listen(0, r));
    base = `http://127.0.0.1:${server.address().port}/owner/v1`;
    syncBase = `http://127.0.0.1:${server.address().port}/sync`;
    try {
        await run();
    } catch (e) {
        failures.push(`crashed: ${e.message}`);
        console.error(e);
    } finally {
        await cleanup().catch((e) => console.error("cleanup:", e.message));
        server.close();
        await sequelize.close();
    }
    console.log(`\n${passed} passed, ${failures.length} failed`);
    if (failures.length) {
        failures.forEach((f) => console.log(`  - ${f}`));
        process.exit(1);
    }
})();
