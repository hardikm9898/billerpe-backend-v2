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
const moment = require("moment");
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
    await M.HotelUser.destroy({ where: { hotel_id: ids }, force: true });
    await M.Role.destroy({ where: { hotel_id: ids } });
    await M.Hotel.destroy({ where: { id: ids }, force: true });
}

(async () => {
    const app = express();
    app.use(express.json());
    app.use("/owner/v1", require("../ownerv1/routes"));
    const server = http.createServer(app);
    await new Promise((r) => server.listen(0, r));
    base = `http://127.0.0.1:${server.address().port}/owner/v1`;
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
