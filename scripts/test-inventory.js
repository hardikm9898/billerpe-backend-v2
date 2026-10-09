// Scenario tests for the office stock (owner 2026-10-09): items, stock in,
// sending to an outlet with proof, free items waiting for approval, serials,
// returns (good / damaged), adjustments and who may do what.
//
//   DATABASE_NAME=billerpe_app_test node scripts/test-inventory.js
//
// Refuses to run unless the database name ends in "_test". Everything it
// makes carries a per-run stamp and is removed at the end.

require("dotenv").config();
if (!/_test$/.test(process.env.DATABASE_NAME || "")) {
    console.error("Refusing to run: DATABASE_NAME must end in _test");
    process.exit(1);
}
process.env.ADMIN_JWT_SECRET = process.env.ADMIN_JWT_SECRET || "inventory-test-secret";
process.env.DISABLE_CRON = "1";
delete process.env.ADMIN_FILES_LIVE;
delete process.env.ADMIN_PAY_LIVE;

const http = require("http");
const express = require("express");
const bcrypt = require("bcrypt");
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
const PW = "Inv-pass-1";
let base;
const post = async (path, body, token) => {
    const res = await fetch(`${base}${path}`, { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body || {}) });
    return { status: res.status, ...(await res.json().catch(() => ({}))) };
};
const call = (name, token, ...args) => post(`/${name}`, { args }, token);
const created = { users: [], hotels: [], items: [], invoices: [] };
const PHOTO = { name: "p.png", mime: "image/png", data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==" };

async function person(name, roleName) {
    const roles = Object.fromEntries((await M.AdmRole.findAll({ raw: true })).map((r) => [r.name, r]));
    const u = await M.AdmUser.create({ name: `${name} ${stamp}`, mobile: `6${String(created.users.length + 70).padStart(3, "0")}${stamp}5`.slice(0, 10), role_id: roles[roleName].id, password_hash: await bcrypt.hash(PW, 4), must_change_password: false });
    created.users.push(u.id);
    const r = await post("/login", { mobile: u.mobile, password: PW, device: { kind: "web", deviceId: `i-${u.id}`, name: "test" } });
    return { u, token: r.session.token };
}

async function outlet(name) {
    const { seedOutlet } = require("../services/outletSetup");
    const h = await M.Hotel.create({ hotel_name: `${name} ${stamp}`, owner_name: "Owner", owner_number: Number(`97${stamp}${created.hotels.length}11`.slice(0, 10)), address1: "Road", address2: "Surat", pinCode: 395001, hotel_logo: "", password: "x", hotel_reg_date: new Date(), plan_start_date: new Date(), plan_end_date: new Date(Date.now() + 200 * 86400000), product_plan: "LOCAL_SUITE" });
    created.hotels.push(h.id);
    await seedOutlet(h, { name: "Owner", number: String(h.owner_number), email: null, passwordHash: await bcrypt.hash("x1234567", 4) });
    await require("../adminv1/cs/accounts").ensureAccounts({ only: [h.id] });
    return h;
}

async function run() {
    const admin = await person("Admin", "Admin");
    const cs = await person("Success", "Customer success");
    const sup = await person("Support", "Support");
    const exec = await person("Exec", "Sales executive");
    const cafe = await outlet("Inv Cafe");
    const other = await outlet("Inv Other");

    console.log("\nItems");
    let r = await call("invItems", exec.token);
    check("a salesperson cannot see the stock", !r.ok, r);
    r = await call("invItems", sup.token);
    check("support can see the stock", r.ok, r);
    r = await call("invItemSave", sup.token, { name: "x", category: "roll" });
    check("support cannot add items", !r.ok);
    r = await call("invItemSave", cs.token, { name: `Thermal printer 3in ${stamp}`, category: "printer", price: 4500, gstRate: 18, hsn: "8443", lowAt: 2 });
    check("customer success adds a printer", r.ok, r);
    const printer = r.result.id;
    created.items.push(printer);
    r = await call("invItemSave", cs.token, { name: `Paper roll 3in ${stamp}`, category: "roll", price: 40, gstRate: 18, hsn: "4811" });
    const roll = r.result.id;
    created.items.push(roll);
    check("…and a roll (unit 'rolls' by itself)", r.ok && (await M.InvItem.findByPk(roll)).unit === "rolls", r);
    r = await call("invItemSave", cs.token, { name: `Paper roll 3in ${stamp}`, category: "roll" });
    check("the same item twice is refused", !r.ok && /exists/.test(r.error), r);
    r = await call("invItemSave", cs.token, { name: "Bad gst", category: "roll", gstRate: 7 });
    check("odd GST rates are refused", !r.ok && /GST/.test(r.error), r);
    r = await call("invItemSave", cs.token, { name: "Mobile POS", category: "device", price: 9000 });
    created.items.push(r.result.id);
    check("any new kind of item can be added later (a mobile POS)", r.ok, r);

    console.log("\nStock in");
    r = await call("invStockIn", cs.token, { itemId: roll, qty: 100 });
    check("stock in needs the supplier's bill number", !r.ok && /bill/.test(r.error), r);
    r = await call("invStockIn", cs.token, { itemId: roll, qty: 100, ref: "SUP-1", unitCost: 22 });
    check("100 rolls in", r.ok && r.result.office === 100, r);
    r = await call("invStockIn", cs.token, { itemId: printer, qty: 3, ref: "SUP-2", serials: "P1, P2" });
    check("printers: serials must match the count (or be left out)", !r.ok && /serial/.test(r.error), r);
    r = await call("invStockIn", cs.token, { itemId: printer, qty: 3, ref: "SUP-2", serials: "P1-" + stamp + ", P2-" + stamp + ", P3-" + stamp });
    check("3 printers in", r.ok && r.result.office === 3, r);

    console.log("\nSend to an outlet");
    const P = (n) => `P${n}-${stamp}`;
    r = await call("invDispatch", cs.token, { hotelId: cafe.id, itemId: roll, qty: 5, basis: "free", carrier: "post", ref: "EM123456789IN", note: "Goodwill rolls" });
    check("a photo is always needed", !r.ok && /photo/.test(r.error), r);
    r = await call("invDispatch", cs.token, { hotelId: cafe.id, itemId: roll, qty: 5, basis: "free", carrier: "post", note: "Goodwill rolls", proof: PHOTO });
    check("India Post needs the consignment number", !r.ok && /consignment/.test(r.error), r);
    r = await call("invDispatch", cs.token, { hotelId: cafe.id, itemId: roll, qty: 5, basis: "plan", carrier: "hand", proof: PHOTO });
    check("'part of the plan' is refused while the outlet's plan includes none", !r.ok && /plan includes no/.test(r.error), r);
    r = await call("invDispatch", cs.token, { hotelId: cafe.id, itemId: roll, qty: 5, basis: "invoice", carrier: "hand", proof: PHOTO });
    check("'sold on an invoice' needs an issued invoice of this outlet", !r.ok && /invoice/.test(r.error), r);
    const inv = await M.BilInvoice.create({ kind: "invoice", number: `TINV-${stamp}`, status: "issued", hotel_id: cafe.id, bill_name: cafe.hotel_name, total: 236, issued_at: new Date() });
    created.invoices.push(inv.id);
    const otherInv = await M.BilInvoice.create({ kind: "invoice", number: `TINV2-${stamp}`, status: "issued", hotel_id: other.id, bill_name: other.hotel_name, total: 236, issued_at: new Date() });
    created.invoices.push(otherInv.id);
    const goods = (invId, itemId, qty) => M.BilInvoiceLine.create({ invoice_id: invId, kind: "goods", description: "x", sac: "", qty, unit_price: 1, amount: qty, gst_rate: 18, effect: JSON.stringify({ goods: { itemId, included: false } }) });
    r = await call("invDispatch", cs.token, { hotelId: cafe.id, itemId: roll, qty: 5, basis: "invoice", invoiceId: inv.id, carrier: "hand", proof: PHOTO });
    check("an invoice that does not sell rolls is refused", !r.ok && /does not sell/.test(r.error), r);
    await goods(inv.id, roll, 520);
    await goods(inv.id, printer, 1);
    await goods(otherInv.id, printer, 2);
    r = await call("invDispatch", cs.token, { hotelId: cafe.id, itemId: roll, qty: 5, basis: "invoice", invoiceId: otherInv.id, carrier: "hand", proof: PHOTO });
    check("another outlet's invoice is refused", !r.ok, r);
    r = await call("invDispatch", cs.token, { hotelId: cafe.id, itemId: roll, qty: 5, basis: "invoice", invoiceId: inv.id, carrier: "post", ref: "EM123456789IN", proof: PHOTO });
    check("5 rolls sold on its invoice go out at once", r.ok && r.result.status === "done" && r.result.office === 95, r);
    r = await call("invDispatch", cs.token, { hotelId: cafe.id, itemId: printer, qty: 1, basis: "invoice", invoiceId: inv.id, carrier: "hand", proof: PHOTO });
    check("a printer goes by its serial number", !r.ok && /serial/.test(r.error), r);
    r = await call("invDispatch", cs.token, { hotelId: cafe.id, itemId: printer, qty: 1, basis: "invoice", invoiceId: inv.id, carrier: "hand", serials: P(1), proof: PHOTO });
    check("printer P1 sent", r.ok && r.result.office === 2, r);
    r = await call("invDispatch", cs.token, { hotelId: other.id, itemId: printer, qty: 1, basis: "invoice", invoiceId: otherInv.id, carrier: "hand", serials: P(1), proof: PHOTO });
    check("the same serial cannot go out twice", !r.ok && /already at an outlet/.test(r.error), r);
    r = await call("invDispatch", cs.token, { hotelId: cafe.id, itemId: roll, qty: 500, basis: "invoice", invoiceId: inv.id, carrier: "hand", proof: PHOTO });
    check("cannot send more than the office holds", !r.ok && /Only 95/.test(r.error), r);
    r = await call("invDispatch", cs.token, { hotelId: cafe.id, itemId: printer, qty: 1, basis: "invoice", invoiceId: inv.id, carrier: "hand", serials: P(2), proof: PHOTO });
    check("no more than the invoice sells (1 printer, already sent)", !r.ok && /already sent/.test(r.error), r);

    console.log("\nFree items need an approver");
    r = await call("invDispatch", cs.token, { hotelId: cafe.id, itemId: roll, qty: 10, basis: "free", carrier: "hand", proof: PHOTO });
    check("free needs a reason", !r.ok && /why/.test(r.error), r);
    r = await call("invDispatch", cs.token, { hotelId: cafe.id, itemId: roll, qty: 10, basis: "free", carrier: "hand", note: "Late install, goodwill", proof: PHOTO });
    const pendingId = r.ok && r.result.id;
    check("customer success: free rolls wait for approval, stock untouched", r.ok && r.result.status === "pending" && (await M.InvItem.findByPk(roll)).stock_office === 95, r);
    check("approvers are told", !!(await M.AdmNotification.findOne({ where: { user_id: admin.u.id, type: "inventory.approval" } })));
    r = await call("invItems", cs.token);
    const rollRow = r.ok && r.result.items.find((i) => i.id === roll);
    check("items list: 95 in office, 5 at outlets, 10 waiting", rollRow && rollRow.office === 95 && rollRow.atOutlets === 5 && rollRow.waiting === 10, rollRow);
    r = await call("invDecide", cs.token, pendingId, true);
    check("customer success cannot approve", !r.ok, r);
    r = await call("invDecide", admin.token, pendingId, true);
    check("admin approves: stock goes down", r.ok && (await M.InvItem.findByPk(roll)).stock_office === 85, r);
    check("…the sender is told", !!(await M.AdmNotification.findOne({ where: { user_id: cs.u.id, type: "inventory.approved" } })));
    r = await call("invDecide", admin.token, pendingId, true);
    check("deciding twice is refused", !r.ok, r);
    r = await call("invDispatch", cs.token, { hotelId: cafe.id, itemId: roll, qty: 2, basis: "free", carrier: "hand", note: "Asked for more", proof: PHOTO });
    r = await call("invDecide", admin.token, r.result.id, false, "Plan rolls already given");
    check("a refused request changes nothing", r.ok && r.result.status === "rejected" && (await M.InvItem.findByPk(roll)).stock_office === 85, r);
    r = await call("invDispatch", admin.token, { hotelId: other.id, itemId: roll, qty: 3, basis: "free", carrier: "hand", note: "Admin sends free", proof: PHOTO });
    check("an approver's own free send goes at once", r.ok && r.result.status === "done" && (await M.InvItem.findByPk(roll)).stock_office === 82, r);

    console.log("\nReturns");
    r = await call("invReturn", cs.token, { hotelId: other.id, itemId: printer, qty: 1, condition: "good", serials: P(1), note: "Swap", proof: PHOTO });
    check("an outlet cannot return what it never got", !r.ok && /holds no/.test(r.error), r);
    r = await call("invReturn", cs.token, { hotelId: cafe.id, itemId: printer, qty: 1, condition: "damaged", serials: P(2), note: "Broken", proof: PHOTO });
    check("a serial that went elsewhere is refused", !r.ok && /was not sent/.test(r.error), r);
    r = await call("invReturn", cs.token, { hotelId: cafe.id, itemId: printer, qty: 1, condition: "damaged", serials: P(1), note: "Head broken", proof: PHOTO });
    check("printer P1 back damaged: kept apart, office unchanged", r.ok && r.result.damaged === 1 && r.result.office === 2, r);
    r = await call("invDispatch", cs.token, { hotelId: other.id, itemId: printer, qty: 1, basis: "invoice", invoiceId: otherInv.id, carrier: "hand", serials: P(1), proof: PHOTO });
    check("once back, its serial can go out again", r.ok, r);
    r = await call("invReturn", cs.token, { hotelId: cafe.id, itemId: roll, qty: 3, condition: "good", note: "Unused", proof: PHOTO });
    check("3 good rolls back into the office", r.ok && r.result.office === 85, r);
    r = await call("invReturn", cs.token, { hotelId: cafe.id, itemId: roll, qty: 50, condition: "good", note: "Too many", proof: PHOTO });
    check("cannot return more than the outlet holds", !r.ok && /holds only 12/.test(r.error), r);

    console.log("\nAdjustments, ledger, outlet view");
    r = await call("invAdjust", cs.token, { itemId: printer, qty: -1, bucket: "damaged", reason: "Scrapped" });
    check("customer success cannot adjust stock", !r.ok, r);
    r = await call("invAdjust", admin.token, { itemId: printer, qty: -1, bucket: "damaged", reason: "Scrapped, beyond repair" });
    check("admin writes off the damaged printer", r.ok && r.result.damaged === 0, r);
    r = await call("invAdjust", admin.token, { itemId: roll, qty: -1000, reason: "Count fix test" });
    check("stock never goes below 0", !r.ok && /below 0/.test(r.error), r);
    r = await call("invMoves", sup.token, { hotelId: cafe.id });
    check("ledger for the outlet: sends, returns, the refused one", r.ok && r.result.moves.length >= 6 && r.result.moves.some((m) => m.status === "rejected") && r.result.moves.every((m) => m.outlet.id === cafe.id), r.ok ? r.result.moves.length : r);
    r = await call("invOutlet", sup.token, cafe.id);
    const h = r.ok && r.result.holds.find((x) => x.item.id === roll);
    check("outlet holds 12 rolls and no printer", h && h.qty === 12 && !r.result.holds.some((x) => x.item.id === printer), r.ok ? r.result.holds : r);
    const send = r.ok && r.result.moves.find((m) => m.kind === "dispatch" && m.hasProof);
    r = await call("invProof", sup.token, send.id);
    check("the photo of a send opens", r.ok && /bil-proofs/.test(r.result.url), r);
    const acts = await M.CsActivity.findAll({ where: { hotel_id: cafe.id, type: "inventory" }, raw: true });
    check("the account timeline shows sends and returns", acts.length >= 4 && acts.some((a) => /Returned/.test(a.body)), acts.map((a) => a.body));
    check("every move is in the audit log", (await M.AdmAuditLog.count({ where: { entity: "inv_move", actor_id: [cs.u.id, admin.u.id] } })) >= 10);
}

async function cleanup() {
    if (created.items.length) await M.InvMove.destroy({ where: { item_id: created.items } });
    if (created.items.length) await M.InvItem.destroy({ where: { id: created.items } });
    if (created.invoices.length) await M.BilInvoiceLine.destroy({ where: { invoice_id: created.invoices } });
    if (created.invoices.length) await M.BilInvoice.destroy({ where: { id: created.invoices } });
    if (created.hotels.length) {
        const hotels = created.hotels;
        const accIds = (await M.CsAccountOutlet.findAll({ where: { hotel_id: hotels }, attributes: ["account_id"], raw: true })).map((x) => x.account_id);
        for (const name of ["CsOnboardingItem", "CsTask", "CsOutletDay", "CsAccountOutlet", "UserAccess", "PaymentMode", "BillChargeRule", "NotificationSetting", "RolePermissionDefault", "MenuCatalog", "RestaurantSetting"]) if (M[name]) await M[name].destroy({ where: { hotel_id: hotels } }).catch(() => {});
        if (accIds.length) {
            await M.CsActivity.destroy({ where: { account_id: accIds } });
            await M.CsAccount.destroy({ where: { id: accIds } });
        }
        await M.HotelUser.destroy({ where: { hotel_id: hotels } });
        await M.Role.destroy({ where: { hotel_id: hotels } }).catch(() => {});
        await M.Hotel.destroy({ where: { id: hotels } });
    }
    if (created.users.length) {
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
