// Scenario tests for SuperAdmin phase 6: BillerPe's own billing and the plan
// lock - GST maths, catalog, drafts and numbering, the 25% discount approval,
// manual and PhonePe (simulated) payments, credit notes, what a paid invoice
// does (plan, product, devices, e-bill credits), renewals and the single
// 1-day reminder, the lock + one "Extend 1 day" (POS App, Owner API, outlet
// PC), hardware orders (browser prices ignored, website orders invoiced),
// the PDF, dues and permissions.
//
//   DATABASE_NAME=billerpe_app_test node scripts/test-billing.js
//
// Refuses to run unless the database name ends in "_test". PhonePe and
// WhatsApp are simulated. Everything it makes carries a per-run stamp and is
// removed at the end.

require("dotenv").config();
if (!/_test$/.test(process.env.DATABASE_NAME || "")) {
    console.error("Refusing to run: DATABASE_NAME must end in _test");
    process.exit(1);
}
process.env.ADMIN_JWT_SECRET = process.env.ADMIN_JWT_SECRET || "bil-test-secret";
process.env.OWNER_JWT_SECRET = process.env.OWNER_JWT_SECRET || "bil-owner-secret";
delete process.env.ADMIN_WA_LIVE;
delete process.env.ADMIN_PAY_LIVE;
delete process.env.ADMIN_FILES_LIVE;

const http = require("http");
const express = require("express");
const bcrypt = require("bcrypt");
const { Op } = require("sequelize");
const M = require("../model");
const { ensureDefaultRoles } = require("../adminv1/permissions");
const util = require("../adminv1/crm/util");
const config = require("../adminv1/crm/config");
const push = require("../adminv1/push");
const { seedOutlet } = require("../services/outletSetup");
const accounts = require("../adminv1/cs/accounts");
const common = require("../adminv1/bil/common");
const renewals = require("../adminv1/bil/renewals");
const payments = require("../adminv1/bil/payments");
const hardware = require("../adminv1/bil/hardware");
const pdf = require("../adminv1/bil/pdf");
const { signDeviceToken } = require("../middleware/deviceAuth");
const WebSiteProducts = require("../model/webSiteProducts");
const { moment, TZ } = util;

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
const mob = (n) => `8${String(n).padStart(4, "0")}${stamp}`;
const PW = "Bil-pass-1";
let root;
const post = async (url, body, token, headers = {}) => {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers, ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body || {}) });
    return { status: res.status, ...(await res.json().catch(() => ({}))) };
};
const call = (name, token, ...args) => post(`${root}/admin/v1/${name}`, { args }, token);
const appCall = (name, token, ...args) => post(`${root}/app/v1/${name}`, { args }, token);
const ownerCall = (name, token, ...args) => post(`${root}/owner/v1/${name}`, { args }, token);
push.sender.send = async (tokens) => ({ successCount: tokens.length, responses: tokens.map(() => ({ success: true })) });

const created = { users: [], hotels: [], products: [], orders: [] };
const SETTING_KEYS = ["working_hours", "timers", "customers", "billing", "bil_hw_from"];
const restore = { settings: [] };
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

async function person(name, roleName) {
    const roles = Object.fromEntries((await M.AdmRole.findAll({ raw: true })).map((r) => [r.name, r]));
    const u = await M.AdmUser.create({ name: `${name} ${stamp}`, mobile: `6${String(created.users.length + 80).padStart(3, "0")}${stamp}2`.slice(0, 10), role_id: roles[roleName].id, password_hash: await bcrypt.hash(PW, 4), must_change_password: false });
    created.users.push(u.id);
    const r = await post(`${root}/admin/v1/login`, { mobile: u.mobile, password: PW, device: { kind: "web", deviceId: `web-${u.id}`, name: "Chrome", appVersion: "0.6.0" } });
    return { u, token: r.session.token };
}

async function outlet(name, mobile, { pin = 390001, plan = "LOCAL_SUITE", endInHours = 24 * 200, gst = "" } = {}) {
    const made = moment().subtract(300, "days").toDate();
    const h = await M.Hotel.create({ hotel_name: `${name} ${stamp}`, owner_name: `Owner ${name}`, owner_number: Number(mobile), address1: "Test road", pinCode: pin, gst_no: gst, hotel_logo: "", password: "x", hotel_reg_date: made, plan_start_date: made, plan_end_date: new Date(Date.now() + endInHours * 3600000), product_plan: plan, app_device_limit: plan === "CLOUD_APP" ? 6 : 3 });
    created.hotels.push(h.id);
    await seedOutlet(h, { name: `Owner ${name}`, number: mobile, email: null, passwordHash: await bcrypt.hash("owner-pw", 4) });
    return h;
}
const H = (id) => M.Hotel.findByPk(id);
const near = (a, b, ms = 120000) => Math.abs(new Date(a).getTime() - new Date(b).getTime()) < ms;

async function run() {
    await config.load(true);
    await M.AdmSetting.destroy({ where: { setting_key: SETTING_KEYS } });
    await M.AdmSetting.create({ setting_key: "working_hours", value: JSON.stringify({ days: [0, 1, 2, 3, 4, 5, 6], start: "00:00", end: "23:59", lunchMinutes: 60, teaBreaks: 2, teaMinutes: 15 }) });
    util.resetHoursCache();

    console.log("\nGST maths");
    let t = common.totals([{ unit_price: 11999, qty: 1, gst_rate: 18 }], 0, true);
    check("Suite Pro in Gujarat: CGST + SGST 1079.91 each, total 14,159 (round off 0.18)", t.cgst === 1079.91 && t.sgst === 1079.91 && t.igst === 0 && t.total === 14159 && t.round_off === 0.18, t);
    t = common.totals([{ unit_price: 11999, qty: 1, gst_rate: 18 }], 0, false);
    check("other state: IGST 2159.82", t.igst === 2159.82 && t.cgst === 0 && t.total === 14159, t);
    t = common.totals([{ unit_price: 11999, qty: 1, gst_rate: 18 }, { unit_price: 250, qty: 2, gst_rate: 18 }], 10, true);
    check("10% discount shared over lines before tax", t.subtotal === 12499 && t.discount === 1249.9 && t.taxable === 11249.1 && t.total === 13274, t);
    check("PIN codes give the state", [["390001", "24"], ["400001", "27"], ["560001", "29"], ["110001", "07"], ["396210", "26"], ["403001", "30"], ["500001", "36"]].every(([p, c]) => common.stateOfPin(p) === c));
    check("a GSTIN wins over the PIN", common.supplyState({ gstin: "27AAAAA0000A1Z5", pin: "390001" }, "24") === "27");
    check("financial year turns on 1 April", common.fyOf(new Date("2026-03-31T12:00:00+05:30")) === "25-26" && common.fyOf(new Date("2026-04-01T00:30:00+05:30")) === "26-27");
    check("amount in words (Indian)", pdf.inWords(14159) === "Rupees Fourteen Thousand One Hundred Fifty Nine Only" && pdf.inWords(125000) === "Rupees One Lakh Twenty Five Thousand Only", pdf.inWords(125000));

    const admin = await person("Admin", "Admin");
    const cs1 = await person("Meena", "Customer success");
    const exec = await person("Priya", "Sales executive");

    const hGuj = await outlet("Guj Cafe", mob(1), { endInHours: 24 * 20 });
    const hMum = await outlet("Mum Momo", mob(2), { pin: 400001, plan: "CLOUD_APP", gst: "27AAAAA0000A1Z5", endInHours: 10 });
    const hExp = await outlet("Expired Dhaba", mob(3), { endInHours: -48 });
    const hSw = await outlet("Switch Diner", mob(4));
    await accounts.ensureAccounts({ only: created.hotels });
    await M.CsAccountOutlet.update({ plan_name: "Suite Pro" }, { where: { hotel_id: [hGuj.id, hExp.id] } });
    await M.CsAccountOutlet.update({ plan_name: "App Standard" }, { where: { hotel_id: hMum.id } });

    console.log("\nCatalog");
    let r = await call("catalog", cs1.token);
    const items = r.ok ? r.result.items : [];
    const item = (code) => items.find((i) => i.code === code);
    check("catalog has the approved prices", item("SUITE_PRO_Y")?.price === 11999 && item("APP_STD_Y")?.devices === 6 && item("EBILL_1000")?.credits === 1000 && item("APP_DEVICE_Y")?.price === 1200, items.length);
    r = await call("catalog", exec.token);
    check("a salesperson has no billing", !r.ok && /permission/.test(r.error));
    r = await call("catalogSave", cs1.token, { id: item("SUITE_PRO_Y").id, name: "x", price: 1, kind: "plan" });
    check("only settings managers change prices", !r.ok);

    console.log("\nInvoices");
    r = await call("invoiceDraft", cs1.token, { hotelId: hGuj.id, lines: [{ itemId: item("SUITE_PRO_Y").id, qty: 1 }] });
    const inv1 = r.ok ? r.result.id : 0;
    let d = await call("invoice", cs1.token, inv1);
    const end0 = moment(hGuj.plan_end_date).tz(TZ);
    check("draft: no number, CGST+SGST, total 14,159", d.ok && !d.result.invoice.number && d.result.invoice.status === "draft" && d.result.invoice.cgst === 1079.91 && d.result.invoice.total === 14159, d.ok ? d.result.invoice : d);
    check("plan period starts the day after the paid-up end", d.ok && d.result.lines[0].periodFrom === end0.clone().add(1, "day").format("YYYY-MM-DD") && d.result.lines[0].periodTo === end0.clone().add(365, "days").format("YYYY-MM-DD"), d.ok ? d.result.lines[0] : d);
    r = await call("invoiceIssue", cs1.token, inv1);
    d = await call("invoice", cs1.token, inv1);
    const fy = common.fyOf();
    check("issued: BPE/<fy>/00000 number, due in 7 days, demo GSTIN marked", r.ok && new RegExp(`^BPE/${fy}/\\d{5}$`).test(d.result.invoice.number) && d.result.invoice.demo && near(d.result.invoice.dueAt, moment().tz(TZ).add(7, "days").endOf("day"), 60000), d.ok ? d.result.invoice : r);

    r = await call("invoiceDraft", cs1.token, { hotelId: hGuj.id, lines: [{ itemId: item("SUITE_STARTER_Y").id }], discountPct: 30, discountReason: "Second outlet" });
    const inv2 = r.ok ? r.result.id : 0;
    r = await call("invoiceIssue", cs1.token, inv2);
    check("30% discount waits for an admin", r.ok && r.result.status === "approval" && !r.result.number, r);
    check("admins are told", !!(await M.AdmNotification.findOne({ where: { user_id: admin.u.id, ref: `approve:${inv2}` } })));
    r = await call("invoiceApprove", cs1.token, inv2);
    check("customer success cannot approve", !r.ok);
    r = await call("invoiceApprove", admin.token, inv2);
    check("admin approves: issued with a number", r.ok && /^BPE\//.test(r.result.number), r);
    r = await call("invoiceDraft", cs1.token, { hotelId: hGuj.id, lines: [{ itemId: item("SUITE_STARTER_Y").id }], discountPct: 25, discountReason: "Festival" });
    const inv3 = r.ok ? r.result.id : 0;
    r = await call("invoiceIssue", cs1.token, inv3);
    check("25% needs no approval", r.ok && r.result.status === "issued", r);
    r = await call("invoiceDraft", cs1.token, { hotelId: hGuj.id, lines: [{ description: "Special", unitPrice: 10 }] });
    check("a free line needs an admin", !r.ok && /Only an admin/.test(r.error));
    r = await call("invoiceDraft", cs1.token, { hotelId: hGuj.id, lines: [{ itemId: item("SUITE_PRO_Y").id }, { itemId: item("SUITE_PRO_M").id }] });
    check("one plan per invoice", !r.ok && /one plan per invoice/i.test(r.error));
    r = await call("invoiceDraft", cs1.token, { hotelId: hGuj.id, lines: [{ itemId: item("SUITE_PRO_Y").id }], discountPct: 5 });
    check("a discount needs its reason", !r.ok && /why/.test(r.error));

    console.log("\nManual payments");
    r = await call("paymentRecord", cs1.token, inv1, { method: "upi", amount: 14159, reference: `UTR${stamp}1` });
    check("UPI without a screenshot is refused", !r.ok && /screenshot/.test(r.error));
    r = await call("paymentRecord", cs1.token, inv1, { method: "upi", amount: 20000, reference: `UTR${stamp}1`, proof: { mime: "image/png", data: PNG } });
    check("more than due is refused", !r.ok && /More than is due/.test(r.error));
    r = await call("paymentRecord", cs1.token, inv1, { method: "upi", amount: 14159, reference: `UTR${stamp}1`, proof: { mime: "image/png", data: PNG } });
    const pay1 = r.ok ? r.result.id : 0;
    check("recorded: waits for approval", r.ok && r.result.status === "pending", r);
    r = await call("paymentRecord", cs1.token, inv1, { method: "upi", amount: 1, reference: `UTR${stamp}1`, proof: { mime: "image/png", data: PNG } });
    check("the same reference twice is refused", !r.ok);
    r = await call("payments", admin.token);
    check("approval queue shows it with its proof", r.ok && r.result.pending.some((p) => p.id === pay1 && p.hasProof));
    r = await call("paymentProof", admin.token, pay1);
    check("proof link", r.ok && !!r.result.url);
    r = await call("paymentDecide", admin.token, pay1, true);
    const g1 = await H(hGuj.id);
    check("approved: receipt BPR number, invoice paid", r.ok && /^BPR\//.test(r.result.number) && (await M.BilInvoice.findByPk(inv1)).status === "paid", r);
    check("paid: plan runs on 365 days from its old end", moment(g1.plan_end_date).tz(TZ).format("YYYY-MM-DD") === end0.clone().add(365, "days").format("YYYY-MM-DD"), [g1.plan_end_date, end0.format()]);
    check("the account timeline says so", !!(await M.CsActivity.findOne({ where: { hotel_id: hGuj.id, type: "invoice", body: { [Op.like]: "%paid: plan runs to%" } } })));
    check("the creator is told", !!(await M.AdmNotification.findOne({ where: { user_id: cs1.u.id, ref: `paydec:${pay1}` } })));

    r = await call("paymentRecord", cs1.token, inv3, { method: "bank", amount: 100, reference: `NEFT${stamp}`, proof: { mime: "image/png", data: PNG } });
    const pay2 = r.ok ? r.result.id : 0;
    r = await call("paymentDecide", admin.token, pay2, false, "Not in the bank");
    check("rejected with a reason", r.ok && (await M.BilPayment.findByPk(pay2)).status === "rejected" && (await M.BilInvoice.findByPk(inv3)).status === "issued");
    r = await call("paymentRecord", admin.token, inv3, { method: "cash", amount: 5000 });
    check("an approver's own cash entry is approved at once: part paid", r.ok && r.result.status === "approved" && (await M.BilInvoice.findByPk(inv3)).status === "part_paid", r);

    console.log("\nCancel = credit note");
    r = await call("invoiceCancel", cs1.token, inv2, "Customer changed mind");
    check("customer success cannot cancel an issued invoice", !r.ok);
    r = await call("invoiceCancel", admin.token, inv2, "Customer changed mind");
    const cn = r.ok ? await M.BilInvoice.findByPk(r.result.creditNoteId) : null;
    const i2 = await M.BilInvoice.findByPk(inv2);
    check("cancelled by a credit note BCN/<fy>/.. with the same totals", r.ok && i2.status === "cancelled" && cn && new RegExp(`^BCN/${fy}/`).test(cn.number) && Number(cn.total) === Number(i2.total) && cn.credit_for_id === inv2, r);
    r = await call("invoiceCancel", admin.token, inv2, "again please");
    check("cannot cancel twice", !r.ok);

    console.log("\nPhonePe links (simulated)");
    r = await call("invoiceDraft", cs1.token, { hotelId: hMum.id, lines: [{ itemId: item("APP_DEVICE_Y").id, qty: 2 }, { itemId: item("EBILL_1000").id, qty: 2 }] });
    const inv4 = r.ok ? r.result.id : 0;
    await call("invoiceIssue", cs1.token, inv4);
    d = await call("invoice", cs1.token, inv4);
    check("Maharashtra GSTIN: IGST, place of supply 27", d.ok && d.result.invoice.supplyState === "27" && d.result.invoice.igst > 0 && d.result.invoice.cgst === 0, d.ok ? d.result.invoice : d);
    r = await call("invoiceLink", cs1.token, inv4);
    const link = r.ok ? r.result : {};
    check("payment link for the due amount (simulated on a test server)", r.ok && link.simulated && link.amount === d.result.invoice.total, r);
    r = await call("invoiceLink", cs1.token, inv4);
    check("asking again gives the same open link", r.ok && r.result.id === link.id);
    const linkRow = await M.BilPayLink.findByPk(link.id);
    await linkRow.update({ state: "COMPLETED", detail: JSON.stringify({ amount: 100, paymentDetails: [] }) });
    r = await payments.check(linkRow.merchant_order_id);
    check("a paid amount that does not match is not recorded", r.state === "AMOUNT_MISMATCH" && !(await M.BilPayment.findOne({ where: { link_id: link.id } })), r);
    await linkRow.update({ state: "PENDING", detail: null });
    const mum0 = await H(hMum.id);
    const credit0 = Number((await M.EBillCredit.findOne({ where: { hotel_id: hMum.id } }))?.credit || 0);
    r = await call("payLinkSimulate", admin.token, link.id, "COMPLETED");
    const mum1 = await H(hMum.id);
    const credit1 = Number((await M.EBillCredit.findOne({ where: { hotel_id: hMum.id } }))?.credit || 0);
    check("paid online: payment approved by itself, invoice paid", r.ok && r.result.paymentId && (await M.BilInvoice.findByPk(inv4)).status === "paid" && (await M.BilPayment.findByPk(r.result.paymentId)).method === "phonepe", r);
    check("2 more POS App devices, 2,000 e-bill credits", mum1.app_device_limit === mum0.app_device_limit + 2 && credit1 === credit0 + 2000, [mum0.app_device_limit, mum1.app_device_limit, credit0, credit1]);
    const { webHook } = require("../controller/Subscription/payment");
    const fakeRes = { statusCode: 0, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
    await webHook({ body: { payload: { merchantOrderId: linkRow.merchant_order_id, state: "COMPLETED", amount: 1 } } }, fakeRes);
    check("the PhonePe webhook hands BPE orders to billing; no double payment", fakeRes.statusCode === 200 && (await M.BilPayment.count({ where: { link_id: link.id } })) === 1);

    console.log("\nProduct switch on payment");
    r = await call("invoiceDraft", cs1.token, { hotelId: hSw.id, lines: [{ itemId: item("APP_STD_Y").id }] });
    const inv5 = r.ok ? r.result.id : 0;
    await call("invoiceIssue", cs1.token, inv5);
    await M.LocalServerRegistration.create({ hotel_id: hSw.id, device_id: `sw-${stamp}`, installation_id: `swi-${stamp}`, status: "active", registered_at: new Date(), last_seen_at: new Date() });
    r = await call("paymentRecord", admin.token, inv5, { method: "cash", amount: (await M.BilInvoice.findByPk(inv5)).total });
    const sw = await H(hSw.id);
    check("paid App Standard on a Local Suite outlet: POS App, 6 devices, PC released", r.ok && sw.product_plan === "CLOUD_APP" && sw.app_device_limit === 6 && !(await M.LocalServerRegistration.findOne({ where: { hotel_id: hSw.id, status: "active" } })), [sw.product_plan, sw.app_device_limit]);

    console.log("\nRenewals and the 1-day reminder");
    await renewals.ensure({ only: created.hotels });
    const rGuj = await M.CsRenewal.findOne({ where: { hotel_id: hGuj.id } });
    const rMum = await M.CsRenewal.findOne({ where: { hotel_id: hMum.id } });
    const rExp = await M.CsRenewal.findOne({ where: { hotel_id: hExp.id } });
    check("renewals open for plans ending within 30 days (not for the one already paid ahead)", !!rMum && !!rExp && !rGuj, [!!rGuj, !!rMum, !!rExp]);
    await renewals.ensure({ only: created.hotels });
    check("no second renewal", (await M.CsRenewal.count({ where: { hotel_id: hMum.id } })) === 1);
    r = await renewals.remind({ only: [hExp.id] });
    check("no reminder for an ended plan or one more than a day away", (await M.CsRenewal.findByPk(rExp.id)).reminded_at === null);
    r = await renewals.remind({ only: [hMum.id] });
    const rMum2 = await M.CsRenewal.findByPk(rMum.id);
    const remindInv = rMum2.invoice_id ? await M.BilInvoice.findByPk(rMum2.invoice_id) : null;
    check("1 day before: renewal invoice issued at the plan's price + link", remindInv && /^BPE\//.test(remindInv.number) && remindInv.renewal_id === rMum.id && rMum2.stage === "invoiced" && !!(await M.BilPayLink.findOne({ where: { invoice_id: remindInv.id } })), rMum2.toJSON());
    check("no approved template: a task for the success owner instead", rMum2.remind_how === "task" && !!(await M.CsTask.findOne({ where: { ref: `renew-remind:${rMum.id}` } })), rMum2.remind_how);
    await renewals.remind({ only: [hMum.id] });
    check("reminded once only", (await M.CsTask.count({ where: { ref: `renew-remind:${rMum.id}` } })) === 1);
    const hRem = await outlet("Remind Cafe", mob(5), { endInHours: 6 });
    await accounts.ensureAccounts({ only: [hRem.id] });
    await renewals.ensure({ only: [hRem.id] });
    const tpl = await M.CrmWaTemplate.create({ name: `renewal_reminder_${stamp}`, language: "en", category: "UTILITY", body: renewals.TEMPLATE_TEXT, params: JSON.stringify([{ name: "1" }, { name: "2" }, { name: "3" }, { name: "4" }, { name: "5" }]), active: true }).catch((e) => ({ error: e.message }));
    await M.AdmSetting.create({ setting_key: "billing", value: JSON.stringify({ reminderTemplate: `renewal_reminder_${stamp}` }) });
    r = await renewals.remind({ only: [hRem.id] });
    const rRem = await M.CsRenewal.findOne({ where: { hotel_id: hRem.id } });
    check("with the template: the reminder goes on WhatsApp", rRem.remind_how === "whatsapp", [r, rRem.remind_how, tpl.error]);
    r = await call("renewals", cs1.token, { view: "upcoming" });
    check("renewals screen lists them", r.ok && r.result.renewals.some((x) => x.id === rMum.id && x.invoice), r.ok ? r.result.counts : r);

    console.log("\nThe plan lock and its one extension");
    let st = await renewals.planState(hExp.id);
    check("ended plan: locked, Extend 1 day available", st.expired && st.canExtend && !st.graceUsed, st);
    st = await renewals.extendOneDay(hExp.id, "test");
    const e1 = await H(hExp.id);
    check("extended: plan end = now + 24 h, unlocked, in grace", near(e1.plan_end_date, Date.now() + 24 * 3600000) && !st.state.expired && st.state.inGrace, st);
    let err = await renewals.extendOneDay(hExp.id).catch((e) => e.message);
    check("cannot extend before it ends again", /has not ended/.test(err), err);
    await e1.update({ plan_end_date: moment().subtract(1, "minute").toDate() });
    st = await renewals.planState(hExp.id);
    err = await renewals.extendOneDay(hExp.id).catch((e) => e.message);
    check("next day: locked, the extension is used", st.expired && !st.canExtend && st.graceUsed && /already used/.test(err), [st, err]);
    const pl = await renewals.payLink(hExp.id);
    const plRow = await M.BilPayLink.findOne({ where: { merchant_order_id: pl.url.split("/").pop() } });
    check("Pay now: renewal invoice + link at Suite Pro's price", pl.amount === 14159 && !!plRow, pl);
    await call("payLinkSimulate", admin.token, plRow.id, "COMPLETED");
    const e2 = await H(hExp.id);
    st = await renewals.planState(hExp.id);
    check("paid late: plan from today for a year (grace day not counted again), unlocked", !st.expired && moment(e2.plan_end_date).tz(TZ).format("YYYY-MM-DD") === moment().tz(TZ).add(364, "days").format("YYYY-MM-DD") && (await M.CsRenewal.findByPk(rExp.id)).stage === "paid", [e2.plan_end_date, st]);

    console.log("\nLock in the POS App");
    const dev = { deviceId: `bil-dev-${stamp}`, name: "Phone", make: "Test", model: "T1", android: "14", appVersion: "1.5.0" };
    await M.Hotel.update({ plan_end_date: moment().subtract(1, "hour").toDate() }, { where: { id: hMum.id } });
    r = await post(`${root}/app/v1/login/password`, { mobile: mob(2), password: "owner-pw", device: { ...dev, deviceId: `old-${stamp}`, appVersion: "1.0.0" } });
    check("an old app (no lock screen) keeps the old rule: login refused", !r.ok && r.error === "subscription-expired", r);
    r = await post(`${root}/app/v1/login/password`, { mobile: mob(2), password: "owner-pw", device: dev });
    const appToken = r.ok ? r.session.token : "";
    check("login still works when the plan has ended", r.ok, r);
    r = await appCall("load", appToken);
    check("everything else answers 'plan expired' with the plan", r.status === 402 && r.code === "plan-expired" && r.plan && r.plan.canExtend, r);
    r = await fetch(`${root}/app/v1/version`, { headers: { Authorization: `Bearer ${appToken}` } });
    check("the version poll is locked too", r.status === 402);
    r = await appCall("planStatus", appToken);
    check("the lock screen can read the plan", r.ok && r.result.expired, r);
    r = await appCall("planPayLink", appToken);
    check("the lock screen gets the payment link", r.ok && r.result.amount > 0 && r.result.invoice, r);
    r = await appCall("planExtend", appToken);
    check("Extend 1 day from the app", r.ok && !r.result.state.expired, r);
    r = await appCall("load", appToken);
    check("unlocked for the day", r.ok, r.status);

    console.log("\nLock in the Owner App / Dashboard");
    await M.Hotel.update({ plan_end_date: moment().subtract(1, "hour").toDate() }, { where: { id: hGuj.id } });
    r = await post(`${root}/owner/v1/login`, { mobile: mob(1), password: "owner-pw", device: { deviceId: `web-bil-${stamp}`, name: "Chrome" } });
    const ownerToken = r.ok ? r.session.token : "";
    r = await ownerCall("outlets", ownerToken);
    check("the outlet list says the plan ended", r.ok && r.result.outlets.some((o) => o.id === hGuj.id && o.planExpired), r.ok ? r.result.outlets : r);
    r = await ownerCall("outlet", ownerToken, hGuj.id, { key: "today" });
    check("that outlet's pages are locked", r.status === 402 && r.code === "plan-expired", r);
    r = await ownerCall("planStatus", ownerToken, hGuj.id);
    check("the owner can read the plan, pay or extend", r.ok && r.result.canExtend, r);
    r = await ownerCall("planStatus", ownerToken, hMum.id);
    check("not for someone else's outlet", !r.ok);

    console.log("\nOutlet PC");
    const reg = await M.LocalServerRegistration.create({ hotel_id: hGuj.id, device_id: `pc-${stamp}`, installation_id: `pci-${stamp}`, status: "active", registered_at: new Date(), last_seen_at: new Date() });
    const devToken = signDeviceToken({ hotel_id: hGuj.id, device_id: reg.device_id, installation_id: reg.installation_id });
    let res = await fetch(`${root}/sync/heartbeat`, { headers: { Authorization: `Bearer ${devToken}` } }).then((x) => x.json());
    check("the heartbeat carries the plan (ended)", !!(res && res.results && res.results.plan && res.results.plan.expired), JSON.stringify(res).slice(0, 300));
    const pressedAt = new Date(Date.now() - 30 * 60000).toISOString();
    res = await post(`${root}/sync/plan/extend`, { staff: "Cashier", usedAt: pressedAt }, devToken);
    check("Extend 1 day pressed offline 30 min ago, reported now: the day counts from the press", res.results && !res.results.state.expired && near((await H(hGuj.id)).plan_end_date, new Date(pressedAt).getTime() + 24 * 3600000), res);
    res = await post(`${root}/sync/plan/extend`, {}, devToken);
    check("only once", res.error && /has not ended|already used/.test(res.results.message), res);
    res = await fetch(`${root}/sync/plan`, { headers: { Authorization: `Bearer ${devToken}` } }).then((x) => x.json());
    check("the PC can read its plan", res.results && res.results.inGrace === true, res);

    console.log("\nHardware");
    const prod = await WebSiteProducts.create({ title: `Test printer ${stamp}`, images: [], keyFeatures: [], price: 5000, offer_active: true, offer_price: 4500, status: true });
    created.products.push(prod.id);
    const { createRollAndPrinterPurchase } = require("../controller/websitePurchase/purchase");
    const resp = { body: null, status() { return this; }, json(b) { this.body = b; return this; } };
    const order = (price, sub) => ({ headers: { origin: "https://www.billerpe.com" }, body: { name: "Buyer", email: "b@example.com", mobile: mob(9), address1: "Shop road", city: "Surat", state: "Gujarat", pincode: "395001", items: [{ id: prod.id, title: "x", quantity: 2, price }], subtotal: sub, gst: Math.round(sub * 18) / 100, grandAmount: Math.round(sub * 118) / 100 } });
    await createRollAndPrinterPurchase(order(1, 2), resp);
    check("a browser price is not trusted", resp.body && resp.body.error, resp.body);
    await hardware.invoiceWebsiteOrders();
    await createRollAndPrinterPurchase(order(4500, 9000), resp);
    const wo = await M.PurchaseRollsAndPrinter.findOne({ where: { mobile: Number(mob(9)) }, order: [["id", "DESC"]] });
    if (wo) created.orders.push(wo.id);
    check("with the real (offer) price the order is taken", wo && Number(wo.subtotal) === 9000, resp.body);
    await wo.update({ payment_status: "completed" });
    await hardware.invoiceWebsiteOrders();
    const woInv = await M.BilInvoice.findOne({ where: { hardware_order_id: wo.id } });
    check("a paid website order gets a paid GST invoice", woInv && woInv.status === "paid" && Number(woInv.total) === 10620 && !!(await M.BilPayment.findOne({ where: { invoice_id: woInv.id, method: "phonepe", status: "approved" } })), woInv && woInv.toJSON());
    await hardware.invoiceWebsiteOrders();
    check("only once", (await M.BilInvoice.count({ where: { hardware_order_id: wo.id } })) === 1);
    r = await call("hardwareCreate", cs1.token, { hotelId: hGuj.id, items: [{ productId: prod.id, qty: 1 }] });
    const ho = r.ok ? r.result : {};
    if (ho.orderId) created.orders.push(ho.orderId);
    check("staff order: priced from the list, invoice issued", r.ok && ho.invoiceStatus === "issued" && Number((await M.BilInvoice.findByPk(ho.invoiceId)).subtotal) === 4500, r);
    r = await call("hardwareStatus", cs1.token, ho.orderId, { action: "ship", tracking: "DTDC 12345" });
    check("cannot ship before it is paid", !r.ok && /not paid/.test(r.error));
    await call("paymentRecord", admin.token, ho.invoiceId, { method: "cash", amount: (await M.BilInvoice.findByPk(ho.invoiceId)).total });
    r = await call("hardwareStatus", cs1.token, ho.orderId, { action: "ship", tracking: "DTDC 12345" });
    const hoRow = await M.PurchaseRollsAndPrinter.findByPk(ho.orderId);
    check("paid -> shipped with tracking", r.ok && hoRow.order_status === "shipped" && hoRow.order_tracking_id === "DTDC 12345", r);
    r = await call("hardwareStatus", cs1.token, ho.orderId, { action: "delivered" });
    check("delivered", r.ok && (await M.PurchaseRollsAndPrinter.findByPk(ho.orderId)).order_status === "delivered");

    console.log("\nPDF, dues, numbers, money on the account");
    r = await call("invoicePdf", cs1.token, inv1);
    check("invoice PDF", r.ok && Buffer.from(r.result.data, "base64").slice(0, 4).toString() === "%PDF", r.ok ? r.result.name : r);
    const html = await pdf.html(await M.BilInvoice.findByPk(inv1));
    check("PDF text: Tax Invoice, DEMO, CGST 9%, amount in words", html.includes("Tax Invoice") && html.includes("DEMO") && html.includes("CGST 9%") && html.includes("Fourteen Thousand One Hundred Fifty Nine"));
    await M.BilInvoice.update({ due_at: moment().subtract(20, "days").toDate() }, { where: { id: inv3 } });
    r = await call("dues", cs1.token);
    check("dues by lateness", r.ok && r.result.buckets.find((b) => b.key === "d30").amount >= Number((await M.BilInvoice.findByPk(inv3)).total) - 5000 - 0.01, r.ok ? r.result.buckets : r);
    r = await call("billingCounter", admin.token, "invoice", 1);
    check("the next number cannot go down", !r.ok && /only go up/.test(r.error));
    const nowNext = (await M.BilCounter.findOne({ where: { kind: "invoice", fy } })).next;
    r = await call("billingCounter", admin.token, "invoice", nowNext + 5);
    check("it can go up (continue an earlier book)", r.ok && r.result.next === nowNext + 5, r);
    const accId = (await M.CsAccountOutlet.findOne({ where: { hotel_id: hGuj.id } })).account_id;
    r = await call("account", cs1.token, accId);
    check("the account's money: paid this year and its invoices", r.ok && r.result.money.paidThisYear >= 14159 && r.result.money.invoices.length >= 2, r.ok ? r.result.money : r);
    r = await call("invoices", exec.token, {});
    check("a salesperson cannot see invoices", !r.ok);
    await pdf.close();
}

async function cleanup() {
    const hotels = created.hotels;
    const invs = (await M.BilInvoice.findAll({ where: { [Op.or]: [{ hotel_id: hotels }, { hardware_order_id: created.orders.length ? created.orders : [0] }] }, attributes: ["id"], raw: true })).map((i) => i.id);
    const cns = (await M.BilInvoice.findAll({ where: { credit_for_id: invs.length ? invs : [0] }, attributes: ["id"], raw: true })).map((i) => i.id);
    const all = [...invs, ...cns];
    await M.BilPayment.destroy({ where: { invoice_id: all } });
    await M.BilPayLink.destroy({ where: { invoice_id: all } });
    await M.BilInvoiceLine.destroy({ where: { invoice_id: all } });
    await M.BilInvoice.destroy({ where: { id: all } });
    await M.CsRenewal.destroy({ where: { hotel_id: hotels } });
    const accIds = (await M.CsAccountOutlet.findAll({ where: { hotel_id: hotels }, attributes: ["account_id"], raw: true })).map((x) => x.account_id);
    for (const m of [M.CsOnboardingItem, M.CsTask, M.CsOutletDay, M.CsAccountOutlet, M.AdmSupportSession]) await m.destroy({ where: { hotel_id: hotels } });
    await M.CsActivity.destroy({ where: { account_id: accIds } });
    await M.CsTask.destroy({ where: { account_id: accIds } });
    await M.CsAccount.destroy({ where: { id: accIds } });
    await M.CrmWaTemplate.destroy({ where: { name: `renewal_reminder_${stamp}` } });
    const chats = (await M.CrmWaChat.findAll({ where: { phone_key: { [Op.like]: `8%${stamp}` } }, attributes: ["id"], raw: true })).map((c) => c.id);
    await M.CrmWaMessage.destroy({ where: { chat_id: chats } });
    await M.CrmWaChat.destroy({ where: { id: chats } });
    await M.PurchaseRollsAndPrinter.destroy({ where: { [Op.or]: [{ id: created.orders.length ? created.orders : [0] }, { mobile: Number(mob(9)) }] } });
    await WebSiteProducts.destroy({ where: { id: created.products } });
    const users = (await M.HotelUser.findAll({ where: { hotel_id: hotels }, attributes: ["id"], raw: true })).map((u) => u.id);
    await M.UserAccess.destroy({ where: { hotel_id: hotels } });
    for (const name of ["EBillCreditDebit", "EBillCredit", "AppDevice", "LocalServerRegistration", "PaymentMode", "BillChargeRule", "NotificationSetting", "RolePermissionDefault", "MenuCatalog", "RestaurantSetting", "OwnerDevice"]) {
        if (M[name]) await M[name].destroy({ where: name === "OwnerDevice" ? { owner_mobile: [mob(1), mob(2)] } : { hotel_id: hotels } }).catch((e) => console.error(`cleanup ${name}:`, e.message));
    }
    await M.HotelUser.destroy({ where: { id: users } });
    await M.Role.destroy({ where: { hotel_id: hotels } }).catch(() => {});
    await M.Hotel.destroy({ where: { id: hotels } }).catch((e) => console.error("cleanup hotels:", e.message));
    await M.AdmNotification.destroy({ where: { user_id: created.users } });
    await M.AdmSession.destroy({ where: { user_id: created.users } });
    await M.AdmAuditLog.destroy({ where: { actor_id: created.users } });
    await M.AdmUser.destroy({ where: { id: created.users } });
    await M.AdmSetting.destroy({ where: { setting_key: SETTING_KEYS } });
    if (restore.settings.length) await M.AdmSetting.bulkCreate(restore.settings);
}

(async () => {
    await ensureDefaultRoles(M.AdmRole);
    await config.ensureDefaults();
    restore.settings = await M.AdmSetting.findAll({ where: { setting_key: SETTING_KEYS }, raw: true });
    const app = express();
    app.use(express.json({ limit: "10mb" }));
    app.use("/admin/v1", require("../adminv1/routes"));
    app.use("/owner/v1", require("../ownerv1/routes"));
    app.use("/app/v1", require("../appv1/routes"));
    app.use("/sync", require("../routes/sync"));
    const server = http.createServer(app);
    await new Promise((res) => server.listen(0, res));
    root = `http://127.0.0.1:${server.address().port}`;
    try {
        await run();
    } catch (e) {
        console.error(e);
        failures.push(`crashed: ${e.message}`);
    } finally {
        await pdf.close().catch(() => {});
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
