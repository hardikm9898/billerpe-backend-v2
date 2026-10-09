// Scenario tests for setting an outlet up at creation (owner 2026-10-09):
// plan from the catalog with what it includes, extras from the stock, the
// Rs 500 token, the first invoice made from the order, approvals (more than
// a year, more than one printer, a big discount, a free trial), Mark won,
// Add outlet to an account, and paying the first invoice in full.
//
//   DATABASE_NAME=billerpe_app_test node scripts/test-setup.js
//
// Refuses to run unless the database name ends in "_test". Everything it
// makes carries a per-run stamp and is removed at the end.

require("dotenv").config();
if (!/_test$/.test(process.env.DATABASE_NAME || "")) {
    console.error("Refusing to run: DATABASE_NAME must end in _test");
    process.exit(1);
}
process.env.ADMIN_JWT_SECRET = process.env.ADMIN_JWT_SECRET || "setup-test-secret";
process.env.DISABLE_CRON = "1";
delete process.env.ADMIN_FILES_LIVE;
delete process.env.ADMIN_PAY_LIVE;

const http = require("http");
const express = require("express");
const bcrypt = require("bcrypt");
const { Op } = require("sequelize");
const M = require("../model");
const { ensureDefaultRoles } = require("../adminv1/permissions");

let passed = 0;
const failures = [];
function check(name, ok, detail) {
    if (ok) {
        passed += 1;
        console.log(`  ok   ${name}`);
    } else {
        failures.push(name);
        console.log(`  FAIL ${name}${detail !== undefined ? `  ${JSON.stringify(detail).slice(0, 500)}` : ""}`);
    }
}

const stamp = String(Date.now()).slice(-5);
const PW = "Set-pass-1";
let base;
const post = async (path, body, token) => {
    const res = await fetch(`${base}${path}`, { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body || {}) });
    return { status: res.status, ...(await res.json().catch(() => ({}))) };
};
const call = (name, token, ...args) => post(`/${name}`, { args }, token);
const created = { users: [], items: [], catalog: [] };
const PHOTO = { name: "p.png", mime: "image/png", data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==" };
let mob = 0;
const mobile = () => `96${stamp}${String((mob += 1)).padStart(3, "0")}`.slice(0, 10);
let utr = 0;
const token = (amount, extra = {}) => ({ method: "upi", amount, reference: `UTR${stamp}${(utr += 1)}`, proof: PHOTO, ...extra });
const outlet = (name, extra = {}) => ({ name: `${name} ${stamp}`, ownerName: "Owner", ownerMobile: mobile(), address: "Station road", city: "Surat", pinCode: "395003", ...extra });

async function person(name, roleName, extra = {}) {
    const roles = Object.fromEntries((await M.AdmRole.findAll({ raw: true })).map((r) => [r.name, r]));
    const u = await M.AdmUser.create({ name: `${name} ${stamp}`, mobile: `6${String(created.users.length + 80).padStart(3, "0")}${stamp}6`.slice(0, 10), role_id: roles[roleName].id, password_hash: await bcrypt.hash(PW, 4), must_change_password: false, ...extra });
    created.users.push(u.id);
    const r = await post("/login", { mobile: u.mobile, password: PW, device: { kind: "web", deviceId: `s-${u.id}`, name: "test" } });
    return { u, token: r.session.token };
}
const setupOf = (hotelId) => M.CsOutletSetup.findOne({ where: { hotel_id: hotelId } });
const lines = (invoiceId) => M.BilInvoiceLine.findAll({ where: { invoice_id: invoiceId }, order: [["sort", "ASC"]], raw: true });

async function run() {
    const admin = await person("Admin", "Admin");
    const cs = await person("Success", "Customer success");
    const exec = await person("Exec", "Sales executive");

    console.log("\nCatalog: a plan with a printer");
    let r = await call("invItemSave", admin.token, { name: `Setup printer ${stamp}`, category: "printer", price: 4500 });
    const printer = r.result.id;
    created.items.push(printer);
    r = await call("invItemSave", admin.token, { name: `Setup roll ${stamp}`, category: "roll", price: 40 });
    const roll = r.result.id;
    created.items.push(roll);
    await call("invStockIn", admin.token, { itemId: printer, qty: 5, ref: "S-1" });
    await call("invStockIn", admin.token, { itemId: roll, qty: 100, ref: "S-2" });
    r = await call("catalogSave", admin.token, { name: `Suite Pro + printer ${stamp}`, kind: "plan", product: "LOCAL_SUITE", planName: "Suite Pro", days: 365, price: 15999, includes: [{ itemId: printer, qty: 1 }, { itemId: roll, qty: 5 }] });
    check("a plan item can include a printer and 5 rolls", r.ok && r.result.item.includes.length === 2, r);
    const withPrinter = r.result.item.id;
    created.catalog.push(withPrinter);
    r = await call("catalogSave", admin.token, { name: `Suite Pro no printer ${stamp}`, kind: "plan", product: "LOCAL_SUITE", planName: "Suite Pro", days: 365, price: 11999 });
    const noPrinter = r.result.item.id;
    created.catalog.push(noPrinter);
    r = await call("catalogSave", admin.token, { name: `Bad ${stamp}`, kind: "plan", product: "LOCAL_SUITE", planName: "Suite Pro", days: 365, price: 1, includes: [{ itemId: 99999999, qty: 1 }] });
    check("an included item must be in the inventory", !r.ok, r);
    r = await call("setupOptions", cs.token);
    const opt = r.ok && r.result.plans.find((p) => p.id === withPrinter);
    check("the outlet form lists the plan with what it includes, and the rules", opt && opt.includes.some((x) => x.itemId === printer && x.name.includes("Setup printer")) && r.result.rules.tokenMin === 500, r.ok ? r.result.rules : r);
    r = await call("setupOptions", exec.token);
    check("…a salesperson sees it too (for Mark won)", r.ok, r);

    console.log("\nAdd a restaurant: token and first invoice");
    const order = { planItemId: withPrinter, periods: 1, extras: [{ itemId: roll, qty: 10 }] };
    r = await call("setupQuote", cs.token, order);
    const total = r.ok && r.result.total;
    check("the quote: plan + 10 extra rolls with GST, no approval", r.ok && total === Math.round((15999 + 400) * 1.18) && !r.result.needsApproval, r);
    r = await call("outletCreate", cs.token, { outlet: outlet("Setup Cafe"), order });
    check("no token: refused", !r.ok && /how it was paid/i.test(r.error), r);
    r = await call("outletCreate", cs.token, { outlet: outlet("Setup Cafe"), order, token: token(499) });
    check("a token under Rs 500: refused", !r.ok && /at least Rs 500/.test(r.error), r);
    r = await call("outletCreate", cs.token, { outlet: outlet("Setup Cafe"), order, token: token(1000, { proof: undefined }) });
    check("a UPI token needs its screenshot", !r.ok && /screenshot/.test(r.error), r);
    r = await call("outletCreate", cs.token, { outlet: outlet("Setup Cafe"), order, token: token(99999) });
    check("a token above the total: refused", !r.ok && /more than the invoice total/.test(r.error), r);
    const cafeOutlet = outlet("Setup Cafe");
    r = await call("outletCreate", cs.token, { outlet: cafeOutlet, order, token: token(2000) });
    check("with a Rs 2,000 token the outlet is made at once, password shown once", r.ok && r.result.status === "done" && r.result.hotelId && r.result.password && r.result.login === cafeOutlet.ownerMobile, r);
    const cafe = r.result.hotelId;
    const hotel = await M.Hotel.findByPk(cafe);
    const days = Math.round((new Date(hotel.plan_end_date) - new Date(hotel.plan_start_date)) / 86400000);
    check("the outlet runs the plan for 1 year from today", days >= 364 && days <= 366, days);
    const setup = await setupOf(cafe);
    check("its setup: done, Rs 2,000 token, full payment due in 15 days", setup && setup.status === "done" && Number(setup.token_amount) === 2000 && Math.round((new Date(setup.pay_by) - Date.now()) / 86400000) >= 14, setup && setup.toJSON());
    const inv = await M.BilInvoice.findByPk(setup.invoice_id);
    const ls = await lines(inv.id);
    check("the first invoice is issued from the order (nobody picks the plan again)", inv.status === "issued" && Math.abs(Number(inv.total) - total) < 0.01 && ls[0].kind === "plan", inv.toJSON());
    check("…lines: plan, printer Rs 0 + 5 rolls Rs 0 (included), 10 rolls sold", ls.length === 4 && ls[1].kind === "goods" && Number(ls[1].unit_price) === 0 && /included/.test(ls[1].description) && Number(ls[3].qty) === 10 && Number(ls[3].unit_price) === 40, ls.map((l) => [l.kind, l.description, Number(l.qty), Number(l.unit_price)]));
    const pay = await M.BilPayment.findByPk(setup.token_payment_id);
    check("the token is a payment waiting for an approver (customer success took it)", pay && pay.status === "pending" && Number(pay.amount) === 2000 && pay.created_by === cs.u.id, pay && pay.toJSON());
    const payStep = await M.CsOnboardingItem.findOne({ where: { hotel_id: cafe, item_key: "payment" } });
    check("onboarding started; 'Payment received' is NOT ticked by a token", payStep && !payStep.done_at, payStep && payStep.toJSON());
    r = await call("outletCreate", cs.token, { outlet: { ...outlet("Setup Twice"), ownerMobile: cafeOutlet.ownerMobile }, order, token: token(1000) });
    check("the same owner mobile twice is refused", !r.ok && /already the login/.test(r.error), r);

    console.log("\nWhat the plan includes, sent from the stock");
    r = await call("invDispatch", cs.token, { hotelId: cafe, itemId: printer, qty: 1, basis: "plan", carrier: "hand", serials: `SP1-${stamp}`, proof: PHOTO });
    check("the plan's printer goes out as 'part of the plan'", r.ok && r.result.status === "done", r);
    r = await call("invDispatch", cs.token, { hotelId: cafe, itemId: printer, qty: 1, basis: "plan", carrier: "hand", serials: `SP2-${stamp}`, proof: PHOTO });
    check("a second printer is not in the plan", !r.ok && /no more|includes no|only 0/i.test(r.error), r);
    r = await call("invDispatch", cs.token, { hotelId: cafe, itemId: roll, qty: 6, basis: "plan", carrier: "hand", proof: PHOTO });
    check("6 rolls 'from the plan' when it includes 5: refused", !r.ok && /only 5 more/.test(r.error), r);
    r = await call("invDispatch", cs.token, { hotelId: cafe, itemId: roll, qty: 5, basis: "plan", carrier: "hand", proof: PHOTO });
    check("the plan's 5 rolls go out", r.ok, r);
    r = await call("invDispatch", cs.token, { hotelId: cafe, itemId: roll, qty: 10, basis: "invoice", invoiceId: inv.id, carrier: "hand", proof: PHOTO });
    check("the 10 sold rolls go out on the invoice", r.ok, r);
    r = await call("invDispatch", cs.token, { hotelId: cafe, itemId: roll, qty: 1, basis: "invoice", invoiceId: inv.id, carrier: "hand", proof: PHOTO });
    check("…and not one more", !r.ok && /already sent/.test(r.error), r);

    console.log("\nApprovals");
    r = await call("setupQuote", cs.token, { planItemId: withPrinter, periods: 1, extras: [{ itemId: printer, qty: 1 }] });
    check("plan printer + 1 extra = 2 printers: needs approval", r.ok && r.result.needsApproval && r.result.reasons.some((x) => /2 printers/.test(x)), r);
    const twoPr = outlet("Setup Two Printers");
    r = await call("outletCreate", cs.token, { outlet: twoPr, order: { planItemId: withPrinter, periods: 1, extras: [{ itemId: printer, qty: 1 }] }, token: token(1000) });
    check("customer success: the request waits, no outlet yet, password shown for later", r.ok && r.result.status === "approval" && r.result.password && !(await M.Hotel.findOne({ where: { hotel_name: twoPr.name } })), r);
    const reqId = r.result.setupId;
    check("approvers are told", !!(await M.AdmNotification.findOne({ where: { user_id: admin.u.id, type: "setup.approval" } })));
    r = await call("setupList", cs.token);
    check("the waiting list shows it with its reasons and token", r.ok && r.result.setups.some((x) => x.id === reqId && x.reasons.length && x.token === 1000 && x.tokenProof), r.ok ? r.result.setups.length : r);
    r = await call("setupDecide", cs.token, reqId, true);
    check("customer success cannot approve", !r.ok, r);
    r = await call("setupDecide", admin.token, reqId, true);
    check("admin approves: the outlet is made with its invoice", r.ok && r.result.status === "done" && r.result.hotelId && r.result.invoiceId, r);
    const twoHotel = r.ok && r.result.hotelId;
    const twoPay = await M.BilPayment.findOne({ where: { invoice_id: r.result.invoiceId } });
    check("…the token, seen by the approver, is approved with it; taken by customer success", twoPay && twoPay.status === "approved" && twoPay.created_by === cs.u.id, twoPay && twoPay.toJSON());
    check("…the requester is told", !!(await M.AdmNotification.findOne({ where: { user_id: cs.u.id, type: "setup.approved" } })));
    const twoUser = await M.HotelUser.findOne({ where: { hotel_id: twoHotel } });
    const twoReq = await M.CsOutletSetup.findByPk(reqId);
    check("the owner can log in with the password shown at request time (hash kept until approval, then dropped)", !!twoUser && twoReq.request && JSON.parse(twoReq.request).hash === null, twoReq && twoReq.status);
    r = await call("setupDecide", admin.token, reqId, true);
    check("deciding twice is refused", !r.ok, r);

    r = await call("outletCreate", cs.token, { outlet: outlet("Setup Two Years"), order: { planItemId: noPrinter, periods: 2 }, token: token(1000) });
    check("2 years: waits for approval", r.ok && r.result.status === "approval" && r.result.reasons.some((x) => /longer than 1 year/.test(x)), r);
    r = await call("setupDecide", admin.token, r.result.setupId, false, "Only yearly plans this month");
    check("refused: no outlet, requester told", r.ok && r.result.status === "rejected" && !!(await M.AdmNotification.findOne({ where: { user_id: cs.u.id, type: "setup.refused" } })), r);
    r = await call("outletCreate", cs.token, { outlet: outlet("Setup Big Discount"), order: { planItemId: noPrinter, discountPct: 40, discountReason: "Chain deal" }, token: token(1000) });
    check("a 40% discount: waits for approval", r.ok && r.result.status === "approval" && r.result.reasons.some((x) => /Discount 40%/.test(x)), r);
    r = await call("outletCreate", cs.token, { outlet: outlet("Setup Trial"), order: { planItemId: "trial", product: "CLOUD_APP" } });
    check("a free trial (Rs 0) always waits for approval, no token asked", r.ok && r.result.status === "approval" && r.result.reasons.some((x) => /Free trial/.test(x)), r);
    r = await call("setupDecide", admin.token, r.result.setupId, true);
    const trial = r.ok && (await setupOf(r.result.hotelId));
    check("approved trial: outlet, no invoice, no 15-day rule", r.ok && trial && !trial.invoice_id && !trial.pay_by, r);
    r = await call("outletCreate", admin.token, { outlet: outlet("Setup Admin Two Years"), order: { planItemId: noPrinter, periods: 2 }, token: token(1000) });
    check("an approver's own request is made at once (and their token approved)", r.ok && r.result.status === "done", r);
    const adm2 = r.ok && (await setupOf(r.result.hotelId));
    check("…recorded as decided by them", adm2 && adm2.decided_by === admin.u.id);

    console.log("\nMark won and Add outlet");
    const intake = require("../adminv1/crm/intake");
    const leadId = (await intake.receive({ source: "website", name: `Setup Lead ${stamp}`, phone: `8${stamp}11111`.slice(0, 10), message: "test" })).leadId;
    await M.CrmLeadV2.update({ owner_id: exec.u.id }, { where: { id: leadId } });
    r = await call("leadWonCustomer", exec.token, leadId, { mode: "create", outlet: outlet("Setup Won"), order: { planItemId: noPrinter } });
    check("Mark won -> create also needs the token", !r.ok && /how it was paid/i.test(r.error), r);
    r = await call("leadWonCustomer", exec.token, leadId, { mode: "create", outlet: outlet("Setup Won"), order: { planItemId: noPrinter }, token: token(500, { method: "cash", reference: "", proof: undefined }), note: "Signed today" });
    check("salesperson: Rs 500 cash token, outlet made, lead won", r.ok && r.result.status === "done" && (await M.CrmLeadV2.findByPk(leadId)).won_at, r);
    const wonSetup = r.ok && (await setupOf(r.result.hotelId));
    const acc = r.ok && (await M.CsAccount.findByPk(r.result.accountId));
    check("…the account comes from the lead, won by the salesperson", wonSetup && wonSetup.source === "won" && wonSetup.lead_id === leadId && acc && acc.lead_id === leadId && acc.won_by_id === exec.u.id, acc && acc.toJSON());
    r = await call("leadWonCustomer", exec.token, leadId, { mode: "create", outlet: outlet("Setup Won Again"), order: { planItemId: noPrinter }, token: token(500) });
    check("a won lead cannot make a second outlet", !r.ok && /already closed/.test(r.error), r);
    r = await call("accountAddOutlet", cs.token, acc.id, { outlet: outlet("Setup Branch"), order: { planItemId: noPrinter }, token: token(1500) });
    check("Add outlet to the account (second branch) goes through the same setup", r.ok && r.result.status === "done" && r.result.accountId === acc.id, r);

    console.log("\nOnboarding needs proof");
    const step = async (key) => M.CsOnboardingItem.findOne({ where: { hotel_id: cafe, item_key: key } });
    let st = await step("printers");
    r = await call("onboardingTick", cs.token, st.id, true, "Done");
    check("'Printers set up' without a photo: refused", !r.ok && /photo/.test(r.error), r);
    r = await call("onboardingTick", cs.token, st.id, true, "Both printers print KOTs", { proof: PHOTO });
    check("…with a photo: done, the photo kept", r.ok && !!(await step("printers")).proof, r);
    r = await call("onboardingProof", cs.token, st.id);
    check("…and the photo opens", r.ok && /bil-proofs/.test(r.result.url), r);
    st = await step("day7");
    r = await call("onboardingTick", cs.token, st.id, true, "Owner is happy with the billing");
    check("Day-7 call before its due day: refused", !r.ok && /due on/.test(r.error), r);
    await st.update({ due_at: new Date(Date.now() - 86400000) });
    r = await call("onboardingTick", cs.token, st.id, true, "ok");
    check("…on its day it needs what the owner said", !r.ok && /what the owner said/.test(r.error), r);
    r = await call("onboardingTick", cs.token, st.id, true, "Owner happy, wants a second printer later");
    check("…with the outcome: done", r.ok && !!(await step("day7")).done_at, r);
    st = await step("menu");
    r = await call("onboardingTick", cs.token, st.id, true, "Uploaded");
    check("'Menu uploaded' cannot be ticked by hand (it ticks from the menu)", !r.ok && /ticks itself/.test(r.error), r);
    await M.Menu.create({ hotel_id: cafe, item_name: "Proof dish", price: 100 });
    r = await call("onboardingCheck", cs.token, cafe);
    const menuStep = await step("menu");
    check("Check now ticks it from the outlet's menu, with the date", r.ok && !!menuStep.done_at && /item/.test(menuStep.note), [r, menuStep && menuStep.toJSON()]);
    st = await step("payment");
    r = await call("onboardingTick", cs.token, st.id, true, "Paid", { invoiceId: inv.id });
    check("'Payment received' with an invoice not yet paid in full: refused", !r.ok && /not paid in full/.test(r.error), r);
    r = await call("onboardingTick", cs.token, (await step("outlet")).id, false, "Owner cannot log in");
    check("a data step cannot be unticked by hand", !r.ok && /cannot be unticked/.test(r.error), r);

    console.log("\nUnpaid after 15 days: frozen");
    const freeze = require("../adminv1/cs/freeze");
    const renewals = require("../adminv1/bil/renewals");
    const twoSetup = await setupOf(twoHotel);
    await twoSetup.update({ pay_by: new Date(Date.now() - 60000) });
    const n = await freeze.run();
    check("the job freezes the outlet whose first invoice is not paid in 15 days", n >= 1 && !!(await setupOf(twoHotel)).frozen_at && (await freeze.isFrozen(twoHotel)), n);
    let ps = await renewals.planState(twoHotel);
    check("its plan state: locked 'payment pending', no extra day, a past lock date (exe 1.1.7 locks too)", ps.expired && ps.reason === "unpaid" && !ps.canExtend && ps.graceUsed && new Date(ps.endsAt) <= new Date() && /payment of Rs [\d,]+ to BillerPe is pending/.test(ps.message), ps);
    const pl = await renewals.payLink(twoHotel);
    const twoInv = await M.BilInvoice.findByPk(twoSetup.invoice_id);
    check("'Pay now' gives the link for what is due on the first invoice", pl && pl.invoice === twoInv.number && Math.abs(pl.amount - (Number(twoInv.total) - Number(twoInv.paid))) < 1, pl);
    check("the success owner / requester is told", !!(await M.AdmNotification.findOne({ where: { user_id: cs.u.id, type: "setup.frozen" } })));
    r = await call("setupMoreTime", cs.token, twoHotel, 3, "Owner pays on Friday");
    check("customer success cannot give more time", !r.ok, r);
    r = await call("setupMoreTime", admin.token, twoHotel, 3, "Owner pays on Friday");
    ps = await renewals.planState(twoHotel);
    check("an approver gives 3 more days: unlocked, new date", r.ok && !(await freeze.isFrozen(twoHotel)) && !ps.expired && new Date((await setupOf(twoHotel)).pay_by) > new Date(), [r, ps]);
    await (await setupOf(twoHotel)).update({ pay_by: new Date(Date.now() - 60000) });
    await freeze.run();
    check("…and freezes again when those days pass unpaid", await freeze.isFrozen(twoHotel));
    r = await call("paymentRecord", admin.token, twoInv.id, { method: "bank", amount: Number(twoInv.total) - Number(twoInv.paid), reference: `NEFTF${stamp}` });
    ps = await renewals.planState(twoHotel);
    check("paid in full: the freeze lifts at once and the plan runs", r.ok && !(await freeze.isFrozen(twoHotel)) && !ps.expired && !ps.reason, [r.ok ? "" : r.error, ps]);

    console.log("\nA rejected token freezes at once");
    r = await call("outletCreate", cs.token, { outlet: outlet("Setup Fake Token"), order: { planItemId: noPrinter }, token: token(800) });
    const fakeHotel = r.ok && r.result.hotelId;
    const fakePay = fakeHotel && (await M.BilPayment.findByPk((await setupOf(fakeHotel)).token_payment_id));
    r = await call("paymentDecide", admin.token, fakePay.id, false, "No such UTR in the bank");
    check("token rejected: the outlet is frozen straight away", r.ok && (await freeze.isFrozen(fakeHotel)) && (await renewals.planState(fakeHotel)).reason === "unpaid", r);
    const oldOutlet = await M.Hotel.findOne({ where: { id: { [Op.notIn]: [cafe, twoHotel, fakeHotel] } }, order: [["id", "ASC"]], attributes: ["id"], raw: true });
    const fakeInv = (await setupOf(fakeHotel)).invoice_id;
    r = await call("paymentRecord", admin.token, fakeInv, { method: "upi", amount: 600, reference: `UTRREV${stamp}` });
    r = await call("paymentReverse", admin.token, r.result.id, "UTR belongs to another customer");
    const fakeAfter = await M.BilInvoice.findByPk(fakeInv);
    check("admin reverses a wrong payment: it comes off the invoice, with the reason in the history", r.ok && Number(fakeAfter.paid) === 0 && fakeAfter.status === "issued" && (await call("invoice", admin.token, fakeInv)).result.history.some((h) => h.what === "Payment reversed" && /another customer/.test(h.reason)), [r, fakeAfter.toJSON()]);
    check("an outlet made before this rule (no setup) is never frozen", !(await freeze.state(oldOutlet.id)) && !(await freeze.isFrozen(oldOutlet.id)));

    console.log("\nBilling rights and the invoice history");
    r = await call("invoiceDraft", cs.token, { hotelId: cafe, lines: [{ invItemId: roll, qty: 20 }] });
    const draftId = r.ok && r.result.id;
    check("customer success makes a draft", !!draftId, r);
    r = await call("invoiceUpdate", admin.token, draftId, { hotelId: cafe, lines: [{ invItemId: roll, qty: 25 }] });
    check("changing someone else's draft needs a reason", !r.ok && /why/.test(r.error), r);
    r = await call("invoiceUpdate", admin.token, draftId, { hotelId: cafe, lines: [{ invItemId: roll, qty: 25 }], reason: "Owner asked for 25 rolls" });
    check("…with the edit right and a reason it changes", r.ok, r);
    r = await call("invoiceUpdate", cs.token, draftId, { hotelId: cafe, lines: [{ invItemId: roll, qty: 30 }] });
    check("the maker may still work on their own draft", r.ok, r);
    r = await call("invoice", cs.token, draftId);
    const hist = r.ok ? r.result.history : [];
    check("the invoice history: made, changed by Admin with the reason, changed again", hist.length >= 3 && hist[0].what === "Draft made" && hist.some((h) => h.what === "Draft changed" && /Admin/.test(h.by) && h.reason === "Owner asked for 25 rolls"), hist);
    r = await call("invoiceDraft", admin.token, { hotelId: cafe, lines: [{ invItemId: roll, qty: 2 }] });
    const adminDraft = r.result.id;
    r = await call("invoiceCancel", cs.token, adminDraft, "Not needed any more");
    check("customer success cannot delete someone else's draft", !r.ok, r);
    r = await call("invoiceCancel", cs.token, draftId, "Owner changed his mind");
    check("…but can delete their own, with a reason in the history", r.ok && (await call("invoice", cs.token, draftId)).result.history.some((h) => h.what === "Draft deleted" && /changed his mind/.test(h.reason)), r);
    await call("invoiceCancel", admin.token, adminDraft, "Test cleanup");
    const twoInvoice = twoSetup.invoice_id;
    r = await call("invoiceCancel", cs.token, twoInvoice, "Wrong outlet");
    check("customer success cannot cancel an issued invoice (needs the edit right)", !r.ok, r);
    const twoTok = await M.BilPayment.findOne({ where: { invoice_id: twoInvoice, status: "approved" }, order: [["id", "ASC"]] });
    r = await call("paymentReverse", cs.token, twoTok.id, "Cheque bounced");
    check("customer success cannot reverse a payment", !r.ok, r);
    r = await call("paymentReverse", admin.token, twoTok.id, "Cash was counted twice");
    const twoAfter = await M.BilInvoice.findByPk(twoInvoice);
    check("reversing a payment on an invoice already in effect is refused (credit note instead)", !r.ok && /credit note/.test(r.error), [r, twoAfter.status]);

    console.log("\nPaying the first invoice in full");
    const before = (await M.Hotel.findByPk(cafe)).plan_end_date;
    r = await call("paymentDecide", admin.token, pay.id, true);
    const inv1 = await M.BilInvoice.findByPk(inv.id);
    check("approving the token: part paid", ["part_paid"].includes(inv1.status), [r.ok ? "" : r.error, inv1.status]);
    r = await call("paymentRecord", admin.token, inv.id, { method: "bank", amount: Number(inv1.total) - Number(inv1.paid), reference: `NEFT${stamp}` });
    const inv2 = await M.BilInvoice.findByPk(inv.id);
    const after = (await M.Hotel.findByPk(cafe)).plan_end_date;
    check("the rest paid: invoice paid", inv2.status === "paid", [r.ok ? "" : r.error, inv2.status]);
    check("…the plan is NOT extended a second time (it started at setup)", new Date(after).getTime() === new Date(before).getTime(), [before, after]);
    const payDone = await M.CsOnboardingItem.findOne({ where: { hotel_id: cafe, item_key: "payment" } });
    check("…'Payment received' ticks itself from the paid invoice (invoice kept)", payDone && !!payDone.done_at && /paid/.test(payDone.note) && payDone.invoice_id === inv.id, payDone && payDone.toJSON());
}

async function cleanup() {
    const hotels = (await M.Hotel.findAll({ where: { hotel_name: { [Op.like]: `Setup %${stamp}` } }, attributes: ["id"], raw: true })).map((h) => h.id);
    const setups = (await M.CsOutletSetup.findAll({ where: { [Op.or]: [{ outlet_name: { [Op.like]: `Setup %${stamp}` } }, ...(hotels.length ? [{ hotel_id: hotels }] : [])] }, raw: true }));
    await M.CsOutletSetup.destroy({ where: { id: setups.map((x) => x.id).concat([0]) } });
    if (hotels.length) {
        const invs = (await M.BilInvoice.findAll({ where: { hotel_id: hotels }, attributes: ["id"], raw: true })).map((x) => x.id);
        if (invs.length) {
            for (const m of [M.BilPayment, M.BilPayLink, M.BilInvoiceLine]) await m.destroy({ where: { invoice_id: invs } });
            await M.BilInvoice.destroy({ where: { id: invs } });
        }
        await M.InvMove.destroy({ where: { hotel_id: hotels } });
        if (M.Menu) await M.Menu.destroy({ where: { hotel_id: hotels } }).catch(() => {});
        const accIds = (await M.CsAccountOutlet.findAll({ where: { hotel_id: hotels }, attributes: ["account_id"], raw: true })).map((x) => x.account_id);
        for (const name of ["CsRenewal", "CsOnboardingItem", "CsTask", "CsOutletDay", "CsAccountOutlet", "UserAccess", "PaymentMode", "BillChargeRule", "NotificationSetting", "RolePermissionDefault", "MenuCatalog", "RestaurantSetting"]) if (M[name]) await M[name].destroy({ where: { hotel_id: hotels } }).catch(() => {});
        if (accIds.length) {
            await M.CsActivity.destroy({ where: { account_id: accIds } });
            await M.CsAccount.destroy({ where: { id: accIds } });
        }
        await M.HotelUser.destroy({ where: { hotel_id: hotels } });
        await M.Role.destroy({ where: { hotel_id: hotels } }).catch(() => {});
        await M.Hotel.destroy({ where: { id: hotels } });
    }
    if (created.items.length) {
        await M.InvMove.destroy({ where: { item_id: created.items } });
        await M.InvItem.destroy({ where: { id: created.items } });
    }
    if (created.catalog.length) await M.BilItem.destroy({ where: { id: created.catalog } });
    const leadIds = (await M.CrmLeadV2.findAll({ where: { name: { [Op.like]: `Setup Lead ${stamp}` } }, attributes: ["id"], raw: true })).map((l) => l.id);
    if (leadIds.length) {
        for (const m of [M.CrmInquiry, M.CrmTaskV2, M.CrmActivity, M.CrmCall, M.CrmAssignment]) await m.destroy({ where: { lead_id: leadIds } });
        await M.CrmLeadV2.destroy({ where: { id: leadIds } });
        await M.CrmEvent.destroy({ where: { entity: "crm_lead", entity_id: leadIds.map(String) } });
    }
    if (created.users.length) {
        await M.CrmLeadV2.update({ owner_id: null }, { where: { owner_id: created.users } });
        for (const m of [M.AdmNotification, M.AdmSession]) await m.destroy({ where: { user_id: created.users } });
        await M.AdmAuditLog.destroy({ where: { actor_id: created.users } });
        await M.AdmUser.destroy({ where: { id: created.users } });
    }
}

(async () => {
    await ensureDefaultRoles(M.AdmRole);
    const app = express();
    app.use(express.json({ limit: "10mb" }));
    app.use("/admin/v1", require("../adminv1/routes"));
    const server = http.createServer(app);
    await new Promise((res) => server.listen(0, res));
    base = `http://127.0.0.1:${server.address().port}/admin/v1`;
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
    process.exit(0);
})();
