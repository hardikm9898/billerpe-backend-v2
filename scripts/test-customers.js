// Scenario tests for SuperAdmin phase 5: customer accounts for every outlet,
// "Mark won" -> customer (create / link / later), onboarding auto-ticks,
// the health rules and their follow-up tasks, outlet operations (plan
// switch, PC release, move), "Open as outlet" through the Owner API, the
// digest counts, permissions, and the old add-restaurant call after its
// seed moved to services/outletSetup.js.
//
//   DATABASE_NAME=billerpe_app_test node scripts/test-customers.js
//
// Refuses to run unless the database name ends in "_test". Everything it
// makes carries a per-run stamp and is removed at the end.

require("dotenv").config();
if (!/_test$/.test(process.env.DATABASE_NAME || "")) {
    console.error("Refusing to run: DATABASE_NAME must end in _test");
    process.exit(1);
}
process.env.ADMIN_JWT_SECRET = process.env.ADMIN_JWT_SECRET || "cs-test-secret";
process.env.OWNER_JWT_SECRET = process.env.OWNER_JWT_SECRET || "cs-owner-secret";
delete process.env.ADMIN_WA_LIVE;

const http = require("http");
const express = require("express");
const bcrypt = require("bcrypt");
const { Op } = require("sequelize");
const M = require("../model");
const { ensureDefaultRoles } = require("../adminv1/permissions");
const util = require("../adminv1/crm/util");
const config = require("../adminv1/crm/config");
const intake = require("../adminv1/crm/intake");
const push = require("../adminv1/push");
const { seedOutlet } = require("../services/outletSetup");
const health = require("../adminv1/cs/health");
const onboarding = require("../adminv1/cs/onboarding");
const accounts = require("../adminv1/cs/accounts");
const digest = require("../adminv1/crm/digest");
const { moment, TZ } = require("../adminv1/crm/util");

let passed = 0;
const failures = [];
function check(name, ok, detail) {
    if (ok) {
        passed += 1;
        console.log(`  ok   ${name}`);
    } else {
        failures.push(name);
        console.log(`  FAIL ${name}${detail !== undefined ? `  ${JSON.stringify(detail).slice(0, 600)}` : ""}`);
    }
}

const stamp = String(Date.now()).slice(-5);
// Test mobiles: 9 + 4 digits + stamp (never a real customer's pattern in the test DB).
const mob = (n) => `9${String(n).padStart(4, "0")}${stamp}`;
const PW = "Cs-pass-1";
let base;
let ownerBase;
const post = async (url, body, token) => {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body || {}) });
    return { status: res.status, ...(await res.json().catch(() => ({}))) };
};
const call = (name, token, ...args) => post(`${base}/${name}`, { args }, token);
const ownerCall = (name, token, ...args) => post(`${ownerBase}/${name}`, { args }, token);
push.sender.send = async (tokens) => ({ successCount: tokens.length, responses: tokens.map(() => ({ success: true })) });

const created = { users: [], hotels: [], leads: [] };
const restore = { settings: [] };
const SETTING_KEYS = ["working_hours", "timers", "customers"];

async function person(name, roleName) {
    const roles = Object.fromEntries((await M.AdmRole.findAll({ raw: true })).map((r) => [r.name, r]));
    const u = await M.AdmUser.create({ name: `${name} ${stamp}`, mobile: `6${String(created.users.length + 70).padStart(3, "0")}${stamp}1`.slice(0, 10), role_id: roles[roleName].id, password_hash: await bcrypt.hash(PW, 4), must_change_password: false });
    created.users.push(u.id);
    const r = await post(`${base}/login`, { mobile: u.mobile, password: PW, device: { kind: "web", deviceId: `web-${u.id}`, name: "Chrome", appVersion: "0.5.0" } });
    return { u, token: r.session.token };
}

/** An outlet like the old add-restaurant call makes it (all defaults, owner login). */
async function outlet(name, mobile, { daysOld = 200, plan = "LOCAL_SUITE", planEnd = 300 } = {}) {
    const made = moment().subtract(daysOld, "days").toDate();
    const h = await M.Hotel.create({ hotel_name: `${name} ${stamp}`, owner_name: `Owner ${name}`, owner_number: Number(mobile), address1: "Test road", pinCode: 390001, hotel_logo: "", password: "x", hotel_reg_date: made, plan_start_date: made, plan_end_date: moment().add(planEnd, "days").toDate(), product_plan: plan });
    await M.Hotel.update({ createdAt: made }, { where: { id: h.id }, silent: true });
    created.hotels.push(h.id);
    await seedOutlet(h, { name: `Owner ${name}`, number: mobile, email: null, passwordHash: await bcrypt.hash("owner-pw", 4) });
    return h;
}

const order = (hotelId, day, n = 1) => M.Order.bulkCreate(Array.from({ length: n }, (_, i) => ({ hotel_id: hotelId, bill_no: String(i + 1), order_type: "pickup", business_date: day, payment: "success", grandAmount: 100 })));
const dayAgo = (n) => moment().tz(TZ).subtract(n, "days").format("YYYY-MM-DD");
const linkOf = (hotelId) => M.CsAccountOutlet.findOne({ where: { hotel_id: hotelId }, raw: true });
const items = (hotelId) => M.CsOnboardingItem.findAll({ where: { hotel_id: hotelId }, order: [["sort", "ASC"]], raw: true });

async function run() {
    await config.load(true);
    await M.AdmSetting.destroy({ where: { setting_key: SETTING_KEYS } });
    await M.AdmSetting.create({ setting_key: "working_hours", value: JSON.stringify({ days: [0, 1, 2, 3, 4, 5, 6], start: "00:00", end: "23:59", lunchMinutes: 60, teaBreaks: 2, teaMinutes: 15 }) });
    util.resetHoursCache();

    const admin = await person("Admin", "Admin");
    const cs1 = await person("Meena", "Customer success");
    const cs2 = await person("Ravi", "Customer success");
    const exec = await person("Priya", "Sales executive");
    const sup = await person("Support", "Support");

    console.log("\nAccounts for every outlet");
    const hOld = await outlet("Old Dhaba", mob(1));
    const hNew = await outlet("New Cafe", mob(2), { daysOld: 3 });
    const hTwinA = await outlet("Twin A", mob(3));
    const hTwinB = await outlet("Twin B", mob(3));
    const hFr = await outlet("Franchise", mob(4));
    await M.OwnerOutletLink.create({ owner_mobile: mob(5), hotel_id: hFr.id });
    const hTest = await outlet("Testing", mob(6));
    await M.Hotel.update({ testing: true }, { where: { id: hTest.id } });
    const ours = () => created.hotels.slice();
    await accounts.ensureAccounts({ only: ours() });
    // The health job runs the auto-ticks right after making accounts.
    await onboarding.autoCheck({ only: ours() });
    const lOld = await linkOf(hOld.id);
    const aOld = lOld ? await M.CsAccount.findByPk(lOld.account_id) : null;
    check("an old outlet becomes an 'existing' account, no onboarding", aOld && aOld.origin === "existing" && lOld.onboarding === "none" && aOld.owner_mobile === mob(1), { aOld, lOld });
    const lNew = await linkOf(hNew.id);
    check("a new outlet (3 days) gets onboarding", lNew && lNew.onboarding === "active" && (await items(hNew.id)).length >= 8, lNew);
    const lA = await linkOf(hTwinA.id);
    const lB = await linkOf(hTwinB.id);
    check("two outlets of one owner mobile = one account", lA && lB && lA.account_id === lB.account_id);
    const lFr = await linkOf(hFr.id);
    const aFr = lFr ? await M.CsAccount.findByPk(lFr.account_id) : null;
    check("a franchise outlet goes to the franchise owner's account", aFr && aFr.owner_mobile === mob(5));
    check("an outlet marked testing gets no account", !(await linkOf(hTest.id)));
    const owners = await M.CsAccount.findAll({ where: { owner_mobile: [mob(1), mob(2), mob(3), mob(5)] }, raw: true });
    const per = owners.reduce((m, a) => m.set(a.success_owner_id, (m.get(a.success_owner_id) || 0) + 1), new Map());
    check("success owners shared out between the two customer-success people", owners.every((a) => [cs1.u.id, cs2.u.id].includes(a.success_owner_id)) && per.size === 2 && Math.abs((per.get(cs1.u.id) || 0) - (per.get(cs2.u.id) || 0)) <= 1, [...per]);
    const again = await accounts.ensureAccounts({ only: ours() });
    check("running again adds nothing", again.created === 0 && again.linked === 0, again);

    console.log("\nOnboarding auto-ticks");
    let it = await items(hNew.id);
    check("suite checklist: PC step, no POS App step", it.some((x) => x.item_key === "pc") && !it.some((x) => x.item_key === "app_devices"));
    check("'outlet created, owner can log in' ticked by itself", it.find((x) => x.item_key === "outlet")?.done_at && it.find((x) => x.item_key === "outlet").done_by === null, it.find((x) => x.item_key === "outlet"));
    check("steps belong to the success owner", it.every((x) => x.owner_id === (owners.find((a) => a.owner_mobile === mob(2)) || {}).success_owner_id));
    const cat = await M.Menu_categ.create({ menu_categ_nm: "Starters", hotel_id: hNew.id, rank: 1 });
    const dish = await M.Menu.create({ item_name: "Paneer Tikka", price: "200", shortCode: "101", sub_categories: "Regular Veg", menu_categ_id: cat.id, hotel_id: hNew.id, active: true });
    await M.LocalServerRegistration.create({ hotel_id: hNew.id, device_id: `dev-${stamp}`, installation_id: `inst-${stamp}`, status: "active", hostname: "BILLING-PC-1", app_version: "1.1.4", registered_at: new Date(), last_seen_at: new Date() });
    await order(hNew.id, dayAgo(0));
    // Payment received follows billing only (owner 2026-10-09): an old-style payment row does not tick it.
    await M.SubscriptionPayment.create({ hotel_id: hNew.id, amount_paid: 14159, payment_method: "upi", payment_date: new Date(), UTR_No: "UTR1", note: "" });
    const paidInv = await M.BilInvoice.create({ kind: "invoice", number: `TPAID-${stamp}`, status: "paid", hotel_id: hNew.id, bill_name: "x", total: 14159, paid: 14159, issued_at: new Date() });
    created.invoices = [paidInv.id];
    const ticked = await onboarding.autoCheck({ only: [hNew.id] });
    it = await items(hNew.id);
    check("payment (a paid invoice), menu, PC and first bill ticked by themselves", ticked === 4 && ["payment", "menu", "pc", "first_bill"].every((k) => it.find((x) => x.item_key === k)?.done_at), it.map((x) => [x.item_key, !!x.done_at, x.note]));
    check("payment note names the paid invoice", new RegExp(`TPAID-${stamp} paid`).test(it.find((x) => x.item_key === "payment").note) && it.find((x) => x.item_key === "payment").invoice_id === paidInv.id, it.find((x) => x.item_key === "payment").note);
    check("auto note says what was seen", it.find((x) => x.item_key === "menu").note === "1 item on the menu", it.find((x) => x.item_key === "menu").note);
    const manual = it.filter((x) => !x.done_at);
    let r;
    const PHOTO = { name: "p.png", mime: "image/png", data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==" };
    r = await call("onboardingTick", cs1.token, manual[0].id, true, "");
    check("a step done by staff needs its proof", !r.ok, r);
    await M.CsOnboardingItem.update({ due_at: new Date(Date.now() - 86400000) }, { where: { id: manual.map((x) => x.id) } });
    for (const x of manual) {
        const kind = ["printers", "training"].includes(x.item_key) ? "photo" : ["day7", "day30"].includes(x.item_key) ? "call" : "note";
        r = await call("onboardingTick", cs1.token, x.id, true, kind === "call" ? "Owner happy, billing daily" : "Done at the outlet", kind === "photo" ? { proof: PHOTO } : {});
        if (!r.ok) break;
    }
    check("staff tick the rest with their proof", r && r.ok, r);
    check("all done = onboarding done", (await linkOf(hNew.id)).onboarding === "done");
    r = await call("onboardingTick", cs1.token, manual[0].id, false);
    check("unticking needs a reason", !r.ok && /why/.test(r.error), r);
    r = await call("onboardingTick", cs1.token, manual[0].id, false, "Printer stopped again");
    check("untick reopens onboarding", r.ok && (await linkOf(hNew.id)).onboarding === "active", r);
    r = await call("onboardingTick", exec.token, manual[0].id, true);
    check("a salesperson cannot tick onboarding", !r.ok && /permission/.test(r.error), r);
    await call("onboardingTick", cs1.token, manual[0].id, true);

    console.log("\nMark won -> customer");
    await intake.receive({ source: "website", name: "Spice Route", phone: mob(10) });
    await intake.receive({ source: "website", name: "Linked Lead", phone: mob(11) });
    await intake.receive({ source: "website", name: "Later Lead", phone: mob(12) });
    await intake.receive({ source: "website", name: "App Lead", phone: mob(13) });
    const leadByPhone = (p) => M.CrmLeadV2.findOne({ where: { phone_key: p }, order: [["id", "DESC"]] });
    const L1 = await leadByPhone(mob(10));
    const L2 = await leadByPhone(mob(11));
    const L3 = await leadByPhone(mob(12));
    const L4 = await leadByPhone(mob(13));
    created.leads.push(L1.id, L2.id, L3.id, L4.id);
    await M.CrmLeadV2.update({ owner_id: exec.u.id }, { where: { id: created.leads } });
    // Outlet setup (owner 2026-10-09): the plan comes from the catalog and a token of Rs 500+ is taken.
    await require("../adminv1/bil/catalog").ensureCatalog();
    const planId = async (code) => (await M.BilItem.findOne({ where: { code }, raw: true })).id;
    const suitePro = { planItemId: await planId("SUITE_PRO_Y") };
    const cashToken = { method: "cash", amount: 500 };
    const form = (o) => ({ name: `Spice Route ${stamp}`, ownerName: "Nikhil Patel", ownerMobile: mob(10), address: "MG Road", city: "Anand", pinCode: "388001", ...o });
    r = await call("leadWonCustomer", exec.token, L1.id, { mode: "create", outlet: form({ pinCode: "12" }), order: suitePro, token: cashToken });
    check("a bad PIN code is refused", !r.ok && /PIN/.test(r.error), r);
    r = await call("leadWonCustomer", exec.token, L1.id, { mode: "create", outlet: form(), order: { planItemId: 0 }, token: cashToken });
    check("a plan that is not in the catalog is refused", !r.ok && /Choose the plan sold/.test(r.error), r);
    r = await call("leadWonCustomer", exec.token, L1.id, { mode: "create", outlet: form({ ownerMobile: mob(1) }), order: suitePro, token: cashToken });
    check("a mobile that is already an outlet login is refused", !r.ok && /already the login/.test(r.error), r);
    r = await call("leadWonCustomer", exec.token, L1.id, { mode: "create", outlet: form(), order: suitePro, token: { method: "cash", amount: 2000, note: "Cash at signing" }, note: "Suite Pro yearly" });
    check("won with a new outlet", r.ok && r.result.hotelId && r.result.accountId && r.result.password && r.result.login === mob(10), r);
    const W = r.ok ? r.result : {};
    if (W.hotelId) created.hotels.push(W.hotelId);
    const wh = W.hotelId ? await M.Hotel.findByPk(W.hotelId) : null;
    check("outlet made with the plan dates and Local Suite", wh && wh.product_plan === "LOCAL_SUITE" && Number(wh.pinCode) === 388001 && moment(wh.plan_end_date).diff(moment(), "days") >= 360, wh && wh.toJSON());
    const ownerRow = W.hotelId ? await M.HotelUser.findOne({ where: { hotel_id: W.hotelId, number: mob(10) } }) : null;
    check("owner login works with the shown password", ownerRow && (await bcrypt.compare(W.password || "", ownerRow.password)));
    check("same defaults as the old add-restaurant (4 pay modes, main menu, role)", W.hotelId && (await M.PaymentMode.count({ where: { hotel_id: W.hotelId } })) === 4 && (await M.MenuCatalog.count({ where: { hotel_id: W.hotelId, is_default: true } })) === 1);
    const L1b = await M.CrmLeadV2.findByPk(L1.id);
    const c = await config.load();
    check("lead closed as won and points at the outlet", c.stageById.get(L1b.stage_id).kind === "won" && L1b.hotel_id === W.hotelId);
    const accW = W.accountId ? await M.CsAccount.findByPk(W.accountId) : null;
    check("account: origin won, won by the seller, success owner set", accW && accW.origin === "won" && accW.won_by_id === exec.u.id && [cs1.u.id, cs2.u.id].includes(accW.success_owner_id) && accW.lead_id === L1.id, accW && accW.toJSON());
    const wItems = W.hotelId ? await items(W.hotelId) : [];
    check("onboarding started; payment NOT ticked by a token; owner login ticked", wItems.length >= 8 && !wItems.find((x) => x.item_key === "payment")?.done_at && !!wItems.find((x) => x.item_key === "outlet")?.done_at, wItems.map((x) => [x.item_key, !!x.done_at]));
    check("the success owner is told", accW && !!(await M.AdmNotification.findOne({ where: { user_id: accW.success_owner_id, type: "account.won" } })));
    check("outlet creation is in the audit log", !!(await M.AdmAuditLog.findOne({ where: { action: "outlet.create", entity_id: String(W.hotelId) } })));
    r = await call("lead", exec.token, L1.id);
    check("the lead page links the customer", r.ok && r.result.customer && r.result.customer.accountId === W.accountId && r.result.customer.onboarding === "active", r.ok ? r.result.customer : r);

    r = await call("wonFindOutlets", exec.token, "Old Dhaba");
    check("find an outlet to link", r.ok && r.result.outlets.some((o) => o.id === hOld.id), r);
    r = await call("leadWonCustomer", exec.token, L2.id, { mode: "link", hotelId: hOld.id, planName: "Suite Starter" });
    const lOld2 = await linkOf(hOld.id);
    check("won by linking an existing outlet: its account, onboarding starts", r.ok && r.result.accountId === lOld.account_id && lOld2.onboarding === "active" && lOld2.plan_name === "Suite Starter", r);

    r = await call("leadWonCustomer", exec.token, L3.id, { mode: "later", note: "Outlet next week" });
    check("won, outlet later", r.ok && !r.result.hotelId && (await M.CrmLeadV2.findByPk(L3.id)).won_at, r);
    const hLater = await outlet("Later Outlet", mob(12), { daysOld: 0 });
    await accounts.ensureAccounts({ only: [hLater.id] });
    const lLater = await linkOf(hLater.id);
    const aLater = lLater ? await M.CsAccount.findByPk(lLater.account_id) : null;
    check("the outlet that appears later joins the won lead", aLater && aLater.origin === "won" && aLater.lead_id === L3.id && (await M.CrmLeadV2.findByPk(L3.id)).hotel_id === hLater.id && lLater.onboarding === "active");

    r = await call("leadWonCustomer", exec.token, L4.id, { mode: "create", outlet: form({ name: `Momo Hub ${stamp}`, ownerMobile: mob(13), password: "momo-123" }), order: { planItemId: await planId("APP_STD_Y") }, token: cashToken });
    if (r.ok) created.hotels.push(r.result.hotelId);
    const hApp = r.ok ? await M.Hotel.findByPk(r.result.hotelId) : null;
    check("POS App customer: 6 devices, no password shown when typed", r.ok && !r.result.password && hApp.product_plan === "CLOUD_APP" && hApp.app_device_limit === 6, r);
    const appItems = hApp ? await items(hApp.id) : [];
    check("POS App checklist: phones step, no PC step", appItems.some((x) => x.item_key === "app_devices") && !appItems.some((x) => x.item_key === "pc"));

    console.log("\nHealth rules");
    const cfg = (await require("../adminv1/settings").read("customers"));
    const base0 = { hotel: { id: 1, hotel_name: "X", product_plan: "LOCAL_SUITE", active: true, createdAt: moment().subtract(100, "days").toDate(), plan_end_date: moment().add(200, "days").toDate() }, link: { onboarding: "none" }, billsToday: 50, billsYesterday: 50, normal: 50, historyDays: 28, lastBillDay: dayAgo(0), daysSinceBill: 0, reg: { last_seen_at: new Date(), app_version: "1.1.6", update_status: "" }, backlog: null, latest: "1.1.6", behind: 0, devices: 0, tickets: { open: 0, oldestAt: null }, ebill: null, late: [] };
    const J = (patch) => health.judge({ ...base0, ...patch, hotel: { ...base0.hotel, ...(patch.hotel || {}) }, link: { ...base0.link, ...(patch.link || {}) } }, cfg);
    const has = (res, key, level) => res.reasons.some((x) => x.key === key && x.level === level);
    check("a busy outlet is green", J({}).level === "green", J({}));
    check("no bills for 3 days = red", has(J({ daysSinceBill: 3, lastBillDay: dayAgo(3), billsToday: 0 }), "billing", "red"));
    check("no bills for 2 days = amber", has(J({ daysSinceBill: 2, lastBillDay: dayAgo(2), billsToday: 0 }), "billing", "amber"));
    check("bills below 30% of normal = red", has(J({ billsYesterday: 10 }), "billing", "red"));
    check("bills below 60% of normal = amber", has(J({ billsYesterday: 25 }), "billing", "amber"));
    check("a closed day (0 yesterday, bills today) is not judged on %", !J({ billsYesterday: 0 }).reasons.length);
    check("never billed after a week = red", has(J({ lastBillDay: null, daysSinceBill: null, normal: null, historyDays: 0 }), "billing", "red"));
    check("PC offline 25 h = red, 17 h = amber", has(J({ reg: { ...base0.reg, last_seen_at: moment().subtract(25, "hours").toDate() } }), "pc", "red") && has(J({ reg: { ...base0.reg, last_seen_at: moment().subtract(17, "hours").toDate() } }), "pc", "amber"));
    check("update failed = red; 2 behind = red; 1 behind = amber", has(J({ reg: { ...base0.reg, update_status: "failed 1.1.7: disk full" } }), "version", "red") && has(J({ behind: 2 }), "version", "red") && has(J({ behind: 1 }), "version", "amber"));
    check("bills waiting to upload for 7 h = red", has(J({ backlog: { pending: 38, since: moment().subtract(7, "hours").toDate() } }), "backlog", "red"));
    check("plan ended = red; ends in 5 days = amber", has(J({ hotel: { plan_end_date: moment().subtract(1, "day").toDate() } }), "plan", "red") && has(J({ hotel: { plan_end_date: moment().add(5, "days").toDate() } }), "plan", "amber"));
    check("e-bill credits finished while in use = red; unused = nothing", has(J({ ebill: { credits: 0, used30: 12 } }), "ebill", "red") && !J({ ebill: { credits: 0, used30: 0 } }).reasons.length);
    check("a ticket open 4 days = amber", has(J({ tickets: { open: 2, oldestAt: moment().subtract(4, "days").toDate() } }), "tickets", "amber"));
    check("an onboarding step 2 days late = amber", has(J({ late: [{ title: "Staff training", due_at: moment().subtract(2, "days").toDate() }] }), "onboarding", "amber"));
    check("in onboarding: no bills / no PC are not judged", J({ link: { onboarding: "active" }, reg: null, lastBillDay: null, daysSinceBill: null, normal: null }).level === "green");
    check("a switched-off outlet is grey", J({ hotel: { active: false } }).level === "grey");
    check("POS App with no phone logged in = amber", has(J({ hotel: { product_plan: "CLOUD_APP" }, reg: null, devices: 0 }), "devices", "amber"));

    console.log("\nHealth run, tasks, normals");
    // Old Dhaba was won by link (onboarding active) - use the twins: A billed 20 a day for 10 days, 3 yesterday.
    for (let d = 2; d <= 11; d++) await order(hTwinA.id, dayAgo(d), 20);
    await order(hTwinA.id, dayAgo(1), 3);
    await order(hTwinA.id, dayAgo(0), 5);
    await M.LocalServerRegistration.create({ hotel_id: hTwinA.id, device_id: `devA-${stamp}`, installation_id: `instA-${stamp}`, status: "active", hostname: "PC-A", app_version: "1.1.6", registered_at: new Date(), last_seen_at: new Date() });
    await health.snapshot({ days: 29 });
    await health.run({ only: ours() });
    const tA = await linkOf(hTwinA.id);
    const sA = JSON.parse(tA.signals || "{}");
    check("normal comes from the daily snapshot", sA.normal >= 15 && sA.normal <= 20 && sA.billsYesterday === 3 && sA.billsToday === 5, sA);
    check("3 bills against a normal of ~18 = red", tA.health === "red" && /3 bills yesterday/.test(tA.health_reasons), tA.health_reasons);
    const accTw = await M.CsAccount.findByPk(tA.account_id);
    const tB = await linkOf(hTwinB.id);
    check("twin B (never billed, no PC) is red too", tB.health === "red");
    check("account = worst of its outlets, reasons name the outlet", accTw.health === "red" && JSON.parse(accTw.health_reasons).some((x) => x.outlet === hTwinA.hotel_name));
    const redTask = await M.CsTask.findOne({ where: { hotel_id: hTwinA.id, origin: "health", status: "open" } });
    check("red made a follow-up task for the success owner", redTask && redTask.owner_id === accTw.success_owner_id && /3 bills yesterday/.test(redTask.note), redTask && redTask.toJSON());
    check("and told them", !!(await M.AdmNotification.findOne({ where: { user_id: accTw.success_owner_id, type: "account.red", ref: { [Op.like]: `red:${hTwinA.id}:%` } } })));
    await health.run({ only: ours() });
    check("a second run makes no second task", (await M.CsTask.count({ where: { hotel_id: hTwinA.id, origin: "health" } })) === 1);
    await order(hTwinA.id, dayAgo(1), 17);
    await health.snapshot({ days: 3 });
    await health.run({ only: ours() });
    const tA2 = await linkOf(hTwinA.id);
    check("back to normal: green", tA2.health === "green", tA2.health_reasons);
    const closed = await M.CsTask.findByPk(redTask.id);
    check("leaving red closes the task by itself", closed.status === "done" && /by itself/.test(closed.result), closed.toJSON());
    check("the timeline shows the colour changes", (await M.CsActivity.count({ where: { hotel_id: hTwinA.id, type: "health" } })) >= 2);

    console.log("\nAccounts screens");
    r = await call("accounts", cs1.token, { view: "red" });
    check("red view lists the twins' account? (B still red)", r.ok && r.result.accounts.some((a) => a.id === accTw.id), r.ok ? r.result.counts : r);
    r = await call("accounts", cs1.token, { q: "Spice Route" });
    check("search by outlet name", r.ok && r.result.accounts.some((a) => a.id === W.accountId), r.ok ? r.result.total : r);
    r = await call("accounts", exec.token, {});
    check("a salesperson cannot open accounts", !r.ok && /permission/.test(r.error));
    r = await call("account", sup.token, W.accountId);
    check("support can see an account (outlets, onboarding, activity)", r.ok && r.result.outlets.length === 1 && r.result.onboarding.length >= 8 && r.result.activity.some((a) => a.type === "won") && r.result.account.lead.id === L1.id, r.ok ? Object.keys(r.result) : r);
    r = await call("accountTaskAdd", sup.token, W.accountId, { note: "Call about printers" });
    check("support cannot add customer tasks", !r.ok);
    r = await call("accountTaskAdd", cs1.token, W.accountId, { type: "visit", note: "Install day", hotelId: W.hotelId });
    const taskId = r.ok ? r.result.id : 0;
    check("success staff add a task", r.ok && taskId);
    const other = accW.success_owner_id === cs1.u.id ? cs2 : cs1;
    r = await call("accountOwner", admin.token, W.accountId, other.u.id, "Meena on leave");
    const moved = await M.CsTask.findByPk(taskId);
    const movedSteps = await M.CsOnboardingItem.count({ where: { account_id: W.accountId, done_at: null, owner_id: other.u.id } });
    check("changing the success owner moves open tasks and steps", r.ok && moved.owner_id === other.u.id && movedSteps > 0, r);
    r = await call("csToday", other.token);
    check("their Customers today lists the task and the steps", r.ok && [...r.result.overdue, ...r.result.later].some((x) => x.kind === "task" && x.id === taskId) && [...r.result.overdue, ...r.result.later].some((x) => x.kind === "step"), r.ok ? r.result.later.length : r);
    const n = await digest.numbersFor(other.u.id);
    check("the morning digest counts customer work", n.overdue + n.today >= 2, n);
    r = await call("accountTaskDone", other.token, taskId, "Installed, staff trained");
    check("task done", r.ok && (await M.CsTask.findByPk(taskId)).status === "done");
    r = await call("accountNote", cs1.token, W.accountId, "Owner prefers WhatsApp");
    check("note on the timeline", r.ok && !!(await M.CsActivity.findOne({ where: { account_id: W.accountId, type: "note" } })));

    console.log("\nOutlet operations");
    await M.LocalServerRegistration.update({ last_seen_at: moment().subtract(3, "hours").toDate() }, { where: { hotel_id: hNew.id, status: "active" } });
    r = await call("outlets", sup.token, { filter: "pc_offline" });
    check("PC-offline filter finds the outlet", r.ok && r.result.outlets.some((o) => o.hotelId === hNew.id && o.pc.state === "offline"), r.ok ? r.result.counts : r);
    r = await call("outlets", sup.token, { filter: "app", q: `Momo Hub ${stamp}` });
    check("POS App filter", r.ok && r.result.outlets.length === 1 && r.result.outlets[0].pc.state === "app", r.ok ? r.result.outlets : r);
    r = await call("outlet", sup.token, hNew.id);
    check("outlet page: PC, versions, a look inside (bills, menu, staff)", r.ok && r.result.outlet.pc.hostname === "BILLING-PC-1" && r.result.look.menuItems === 1 && r.result.look.recentBills.length === 1 && r.result.look.staff >= 1 && r.result.canOpenAs.ownerLogin, r.ok ? r.result.look : r);
    r = await call("outletPlan", sup.token, hNew.id, { productPlan: "CLOUD_APP", reason: "Owner wants phones only" });
    check("support cannot switch plans", !r.ok && /permission/.test(r.error));
    r = await call("outletPlan", admin.token, hNew.id, { productPlan: "CLOUD_APP", reason: "" });
    check("a plan switch needs a reason", !r.ok && /reason/.test(r.error));
    r = await call("outletPlan", admin.token, hNew.id, { productPlan: "CLOUD_APP", deviceLimit: 6, reason: "Owner wants phones only" });
    check("switch to POS App releases the PC", r.ok && r.result.released === 1 && (await M.Hotel.findByPk(hNew.id)).product_plan === "CLOUD_APP" && !(await M.LocalServerRegistration.findOne({ where: { hotel_id: hNew.id, status: "active" } })), r);
    check("plan switch: audit log with reason + timeline", !!(await M.AdmAuditLog.findOne({ where: { action: "outlet.plan", entity_id: String(hNew.id), reason: "Owner wants phones only" } })) && !!(await M.CsActivity.findOne({ where: { hotel_id: hNew.id, type: "plan" } })));
    r = await call("outletPlan", admin.token, hNew.id, { productPlan: "LOCAL_SUITE", reason: "Back to the PC" });
    check("and back to Local Suite", r.ok && r.result.product_plan === "LOCAL_SUITE", r);
    r = await call("outletReleasePc", admin.token, hNew.id, "New PC");
    check("release refused when no PC is registered", !r.ok && /no registered PC/.test(r.error));
    r = await call("outletReleasePc", admin.token, hTwinA.id, "Old PC broke");
    check("release the PC (moves billing to a new PC)", r.ok && !(await M.LocalServerRegistration.findOne({ where: { hotel_id: hTwinA.id, status: "active" } })) && !!(await M.AdmAuditLog.findOne({ where: { action: "outlet.release_pc", entity_id: String(hTwinA.id) } })));
    r = await call("outletMove", admin.token, hTwinB.id, W.accountId, "Same family business");
    check("move an outlet to another account", r.ok && (await linkOf(hTwinB.id)).account_id === W.accountId, r);

    console.log("\nOpen as outlet (Owner Dashboard, 30 min)");
    r = await call("outletOpenAs", sup.token, hNew.id, "Owner cannot find the menu");
    check("refused until the dashboard address is set", !r.ok && /Owner Dashboard address/.test(r.error));
    r = await call("settingSave", admin.token, "customers", { ...cfg, ownerDashboardUrl: "https://owner.example.test/" });
    check("dashboard address saved (trailing / dropped)", r.ok && r.result.value.ownerDashboardUrl === "https://owner.example.test", r);
    r = await call("outletOpenAs", exec.token, hNew.id, "Just looking");
    check("a salesperson cannot open as outlet", !r.ok && /permission/.test(r.error));
    r = await call("outletOpenAs", sup.token, hNew.id, "no");
    check("open as outlet needs a reason", !r.ok && /reason/.test(r.error));
    r = await call("outletOpenAs", sup.token, hApp.id, "Check the menu");
    check("POS App outlets are refused (read-only look instead)", !r.ok && /POS App/.test(r.error));
    r = await call("outletOpenAs", sup.token, hNew.id, "Owner cannot find the menu");
    check("support opens the outlet: dashboard link with a token", r.ok && r.result.url.startsWith("https://owner.example.test/?support=") && r.result.url.endsWith("#/"), r);
    const token = r.ok ? decodeURIComponent(r.result.url.split("support=")[1].replace("#/", "")) : "";
    const sid = r.ok ? r.result.sessionId : 0;
    r = await post(`${ownerBase}/resume`, { token, device: { deviceId: "web-x" } });
    check("the Owner API accepts it as a support session", r.ok && r.session.support && r.session.support.outlet === hNew.hotel_name && r.session.owner.mobile === mob(2), r);
    r = await ownerCall("outlets", token);
    check("it sees only that outlet", r.ok && r.result.outlets.length === 1 && Number(r.result.outlets[0].id) === hNew.id, r.ok ? r.result.outlets : r);
    r = await ownerCall("setItemActive", token, hNew.id, dish.id, false);
    check("a change works", r.ok && (await M.Menu.findByPk(dish.id)).active === false, r);
    const supAudit = await M.AdmAuditLog.findOne({ where: { action: "support.setItemActive", entity_id: String(hNew.id) } });
    check("and is in the audit log as BillerPe support with the reason", supAudit && supAudit.actor_id === sup.u.id && /BillerPe support/.test(supAudit.summary) && supAudit.reason === "Owner cannot find the menu", supAudit && supAudit.toJSON());
    check("the session counts its changes", (await M.AdmSupportSession.findByPk(sid)).writes === 1);
    r = await ownerCall("saveAlertRules", token, {});
    check("the owner's alert rules are off-limits", !r.ok && /belongs to the owner/.test(r.error));
    r = await call("outlet", admin.token, hNew.id);
    check("the outlet page lists the open session", r.ok && r.result.supportSessions.some((x) => x.id === sid && x.open), r.ok ? r.result.supportSessions : r);
    r = await ownerCall("logout", token);
    check("End session (dashboard log out) ends it", r.ok);
    r = await ownerCall("outlets", token);
    check("then its token stops working", r.status === 401, r);
    r = await call("outletOpenAs", sup.token, hNew.id, "Second look at the menu");
    const t2 = r.ok ? decodeURIComponent(r.result.url.split("support=")[1].replace("#/", "")) : "";
    await M.AdmSupportSession.update({ expires_at: moment().subtract(1, "minute").toDate() }, { where: { id: r.result.sessionId } });
    r = await ownerCall("outlets", t2);
    check("an expired session is refused", r.status === 401);
    r = await call("outletOpenAs", sup.token, hNew.id, "Third look");
    const t3 = r.ok ? decodeURIComponent(r.result.url.split("support=")[1].replace("#/", "")) : "";
    r = await call("supportEnd", admin.token, r.result.sessionId);
    check("an admin can end someone's session early", r.ok && (await ownerCall("outlets", t3)).status === 401, r);

    console.log("\nThe old add-restaurant call (seed moved to services/outletSetup.js)");
    const { addHotelDetails } = require("../controller/hotel");
    const plan = await M.Plan.create({ name: `Test plan ${stamp}`, price: 0, duration_days: 365 });
    created.plan = plan.id;
    const docs = { hotel_name: `Old Flow ${stamp}`, owner_name: "Old Flow Owner", owner_number: mob(20), address1: "Station road", pinCode: 390002, password: "oldflow-1", owner_email_id: "", planData: { discountrate: 0, gst: 0, discount: "fix", grandAmount: 0, subTotal: 0, plan_id: plan.id, gst_calculated: true, plan_start_date: new Date(), plan_end_date: moment().add(1, "year").toDate() }, payment_info: { payment_method: "upi", payment_date: new Date(), amount_paid: 0, UTR_NO: "" } };
    const res = { body: null, json(b) { this.body = b; return this; } };
    await addHotelDetails({ body: { documents: JSON.stringify(docs) }, files: { hotel_logo: [{ fieldname: "hotel_logo", originalname: "x.png" }], payment_image: [{ fieldname: "payment_image", originalname: "y.png" }] }, user: (await M.superAdminModel.findOne({ attributes: ["id"], raw: true }))?.id ?? null }, res);
    const oldH = await M.Hotel.findOne({ where: { hotel_name: `Old Flow ${stamp}` } });
    if (oldH) created.hotels.push(oldH.id);
    const oldUser = oldH ? await M.HotelUser.findOne({ where: { hotel_id: oldH.id } }) : null;
    check("still creates the outlet, owner login and defaults", oldH && oldUser && (await bcrypt.compare("oldflow-1", oldUser.password)) && (await M.PaymentMode.count({ where: { hotel_id: oldH.id } })) === 4 && (await M.UserAccess.count({ where: { hotel_id: oldH.id } })) === 11, res.body);
    check("and its subscription and payment, as before", res.body && res.body.code === 201 && oldH && (await M.Subscription.count({ where: { hotel_id: oldH.id } })) === 1 && (await M.SubscriptionPayment.count({ where: { hotel_id: oldH.id } })) === 1, res.body);
}

async function cleanup() {
    const hotels = created.hotels;
    const accIds = (await M.CsAccountOutlet.findAll({ where: { hotel_id: hotels }, attributes: ["account_id"], raw: true })).map((x) => x.account_id);
    const accs = [...new Set([...accIds, ...(await M.CsAccount.findAll({ where: { owner_mobile: { [Op.like]: `9%${stamp}` } }, attributes: ["id"], raw: true })).map((a) => a.id)])];
    const invs = (await M.BilInvoice.findAll({ where: { hotel_id: hotels }, attributes: ["id"], raw: true })).map((x) => x.id);
    if (invs.length) {
        for (const m of [M.BilPayment, M.BilPayLink, M.BilInvoiceLine]) await m.destroy({ where: { invoice_id: invs } });
        await M.BilInvoice.destroy({ where: { id: invs } });
    }
    await M.CsOutletSetup.destroy({ where: { hotel_id: hotels } });
    for (const m of [M.CsOnboardingItem, M.CsTask, M.CsOutletDay, M.CsAccountOutlet, M.AdmSupportSession]) await m.destroy({ where: { hotel_id: hotels } });
    await M.CsActivity.destroy({ where: { account_id: accs } });
    await M.CsTask.destroy({ where: { account_id: accs } });
    await M.CsAccount.destroy({ where: { id: accs } });
    await M.OwnerOutletLink.destroy({ where: { hotel_id: hotels } });
    const leads = (await M.CrmLeadV2.findAll({ where: { phone_key: { [Op.like]: `9%${stamp}` } }, attributes: ["id"], raw: true })).map((l) => l.id);
    for (const m of [M.CrmInquiry, M.CrmTaskV2, M.CrmActivity, M.CrmCall, M.CrmAssignment, M.CrmEscalation, M.CrmCadenceEnrollment, M.CrmRuleRun]) await m.destroy({ where: { lead_id: leads } }).catch(() => {});
    await M.CrmWaChat.destroy({ where: { lead_id: leads } }).catch(() => {});
    await M.CrmLeadV2.destroy({ where: { id: leads } });
    await M.CrmEvent.destroy({ where: { entity: "crm_lead", entity_id: leads.map(String) } });
    // The outlets and everything seeded for them.
    const users = (await M.HotelUser.findAll({ where: { hotel_id: hotels }, attributes: ["id"], raw: true })).map((u) => u.id);
    await M.UserAccess.destroy({ where: { hotel_id: hotels } });
    for (const name of ["Order", "Menu", "Menu_categ", "LocalServerRegistration", "AppDevice", "PaymentMode", "BillChargeRule", "NotificationSetting", "RolePermissionDefault", "MenuCatalog", "RestaurantSetting", "Subscription", "SubscriptionPayment"]) {
        if (M[name]) await M[name].destroy({ where: { hotel_id: hotels } }).catch((e) => console.error(`cleanup ${name}:`, e.message));
    }
    await M.HotelUser.destroy({ where: { id: users } });
    await M.Role.destroy({ where: { hotel_id: hotels } }).catch(() => {});
    await M.Hotel.destroy({ where: { id: hotels } }).catch((e) => console.error("cleanup hotels:", e.message));
    if (created.plan) await M.Plan.destroy({ where: { id: created.plan } });
    await M.AdmNotification.destroy({ where: { user_id: created.users } });
    await M.AdmSession.destroy({ where: { user_id: created.users } });
    await M.AdmAuditLog.destroy({ where: { [Op.or]: [{ actor_id: created.users }, { entity: "hotel", entity_id: hotels.map(String) }] } });
    await M.AdmUser.destroy({ where: { id: created.users } });
    await M.AdmSetting.destroy({ where: { setting_key: SETTING_KEYS } });
    if (restore.settings.length) await M.AdmSetting.bulkCreate(restore.settings);
}

(async () => {
    await ensureDefaultRoles(M.AdmRole);
    await config.ensureDefaults();
    restore.settings = await M.AdmSetting.findAll({ where: { setting_key: SETTING_KEYS }, raw: true });
    const app = express();
    app.use(express.json());
    app.use("/admin/v1", require("../adminv1/routes"));
    app.use("/owner/v1", require("../ownerv1/routes"));
    const server = http.createServer(app);
    await new Promise((res) => server.listen(0, res));
    base = `http://127.0.0.1:${server.address().port}/admin/v1`;
    ownerBase = `http://127.0.0.1:${server.address().port}/owner/v1`;
    try {
        await run();
    } catch (e) {
        console.error(e);
        failures.push(`crashed: ${e.message}`);
    } finally {
        await cleanup().catch((e) => console.error("cleanup:", e.message));
        server.close();
        await M.sequelize.close();
    }
    console.log(`\n${passed} passed, ${failures.length} failed`);
    if (failures.length) {
        for (const f of failures) console.log(`  - ${f}`);
        process.exit(1);
    }
})();
