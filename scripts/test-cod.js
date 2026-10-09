// Scenario tests for India Post cash on delivery (owner 2026-10-09): COD
// parcels on invoices (by hand, or when stock goes by India Post COD), one
// post office cheque for many parcels less its charges, approval paying
// every invoice, refusals, returned parcels and who may do what.
//
//   DATABASE_NAME=billerpe_app_test node scripts/test-cod.js
//
// Refuses to run unless the database name ends in "_test". Everything it
// makes carries a per-run stamp and is removed at the end.

require("dotenv").config();
if (!/_test$/.test(process.env.DATABASE_NAME || "")) {
    console.error("Refusing to run: DATABASE_NAME must end in _test");
    process.exit(1);
}
process.env.ADMIN_JWT_SECRET = process.env.ADMIN_JWT_SECRET || "cod-test-secret";
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
const PW = "Cod-pass-1";
let base;
const post = async (path, body, token) => {
    const res = await fetch(`${base}${path}`, { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body || {}) });
    return { status: res.status, ...(await res.json().catch(() => ({}))) };
};
const call = (name, token, ...args) => post(`/${name}`, { args }, token);
const created = { users: [], items: [], catalog: [] };
const PHOTO = { name: "p.png", mime: "image/png", data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==" };
let mob = 0;
const mobile = () => `95${stamp}${String((mob += 1)).padStart(3, "0")}`.slice(0, 10);
const outlet = (name) => ({ name: `Cod ${name} ${stamp}`, ownerName: "Owner", ownerMobile: mobile(), address: "Station road", city: "Surat", pinCode: "395003" });
const cn = (n) => `EM${stamp}${n}IN`;

async function person(name, roleName) {
    const roles = Object.fromEntries((await M.AdmRole.findAll({ raw: true })).map((r) => [r.name, r]));
    const u = await M.AdmUser.create({ name: `${name} ${stamp}`, mobile: `6${String(created.users.length + 90).padStart(3, "0")}${stamp}7`.slice(0, 10), role_id: roles[roleName].id, password_hash: await bcrypt.hash(PW, 4), must_change_password: false });
    created.users.push(u.id);
    const r = await post("/login", { mobile: u.mobile, password: PW, device: { kind: "web", deviceId: `c-${u.id}`, name: "test" } });
    return { u, token: r.session.token };
}
const inv = (id) => M.BilInvoice.findByPk(id);

async function run() {
    const admin = await person("Admin", "Admin");
    const cs = await person("Success", "Customer success");
    const exec = await person("Exec", "Sales executive");
    let r = await call("invItemSave", admin.token, { name: `Cod roll ${stamp}`, category: "roll", price: 50 });
    const roll = r.result.id;
    created.items.push(roll);
    await call("invStockIn", admin.token, { itemId: roll, qty: 100, ref: "S-1" });
    r = await call("catalogSave", admin.token, { name: `Cod plan ${stamp}`, kind: "plan", product: "LOCAL_SUITE", planName: "Suite Pro", days: 365, price: 10000 });
    const plan = r.result.item.id;
    created.catalog.push(plan);
    // Two outlets, each with an approved Rs 1,000 token on its first invoice.
    r = await call("outletCreate", admin.token, { outlet: outlet("Alpha"), order: { planItemId: plan }, token: { method: "cash", amount: 1000 } });
    const A = r.result;
    r = await call("outletCreate", admin.token, { outlet: outlet("Beta"), order: { planItemId: plan, extras: [{ itemId: roll, qty: 10 }] }, token: { method: "cash", amount: 1000 } });
    const Bo = r.result;
    const dueA = Number((await inv(A.invoiceId)).total) - 1000;
    const dueB = Number((await inv(Bo.invoiceId)).total) - 1000;
    check("two new outlets with their first invoices, Rs 1,000 paid on each", A.invoiceId && Bo.invoiceId && dueA > 0 && dueB > 0, [A, Bo]);

    console.log("\nCOD parcels");
    r = await call("codBook", exec.token, { invoiceId: A.invoiceId, consignment: cn(1) });
    check("a salesperson cannot book COD parcels", !r.ok, r);
    r = await call("codBook", cs.token, { invoiceId: A.invoiceId, consignment: "x" });
    check("the consignment number must look right", !r.ok && /consignment/.test(r.error), r);
    r = await call("codBook", cs.token, { invoiceId: A.invoiceId, consignment: cn(1), amount: dueA + 100 });
    check("not more than is left to collect", !r.ok && /More than is left/.test(r.error), r);
    r = await call("codBook", cs.token, { invoiceId: A.invoiceId, consignment: cn(1) });
    check("parcel 1 books what is left on invoice A", r.ok && Math.abs(r.result.amount - dueA) < 0.01, r);
    r = await call("codBook", cs.token, { invoiceId: A.invoiceId, consignment: cn(9), amount: 10 });
    check("a second parcel cannot collect more than is left (nothing left)", !r.ok && /Nothing is left|More than is left/.test(r.error), r);
    r = await call("codBook", cs.token, { invoiceId: A.invoiceId, consignment: cn(1) });
    check("the same consignment twice: refused", !r.ok && /already booked/.test(r.error), r);
    r = await call("invDispatch", cs.token, { hotelId: Bo.hotelId, itemId: roll, qty: 10, basis: "invoice", invoiceId: Bo.invoiceId, carrier: "post", ref: cn(2), cod: true, proof: PHOTO });
    check("rolls sent by India Post COD book parcel 2 on invoice B at once", r.ok && !!(await M.BilCodParcel.findOne({ where: { consignment: cn(2), invoice_id: Bo.invoiceId } })), r);
    r = await call("invDispatch", cs.token, { hotelId: Bo.hotelId, itemId: roll, qty: 1, basis: "invoice", invoiceId: Bo.invoiceId, carrier: "hand", cod: true, proof: PHOTO });
    check("cash on delivery only by India Post", !r.ok, r);
    r = await call("codParcels", cs.token, {});
    check("the list of parcels waiting for money shows both", r.ok && r.result.parcels.filter((p) => [cn(1), cn(2)].includes(p.consignment)).length === 2 && r.result.waiting >= dueA + dueB - 0.01, r.ok ? r.result.counts : r);

    console.log("\nThe post office's cheque");
    const parcels = (await M.BilCodParcel.findAll({ where: { consignment: [cn(1), cn(2)] }, raw: true })).map((p) => p.id);
    const total = dueA + dueB;
    r = await call("codRemit", cs.token, { reference: `CHQ${stamp}`, amount: total - 200, parcelIds: parcels });
    check("a cheque needs its photo", !r.ok && /photo/.test(r.error), r);
    r = await call("codRemit", cs.token, { reference: `CHQ${stamp}`, amount: total + 1, parcelIds: parcels, proof: PHOTO });
    check("more than the ticked parcels: refused", !r.ok && /more than the ticked parcels/.test(r.error), r);
    r = await call("codRemit", cs.token, { reference: `CHQ${stamp}`, amount: total * 0.5, parcelIds: parcels, proof: PHOTO });
    check("post charges above 20%: refused (check the parcels)", !r.ok && /more than 20%/.test(r.error), r);
    r = await call("codRemit", cs.token, { reference: `CHQ${stamp}`, amount: total - 200, parcelIds: parcels, proof: PHOTO });
    const remitId = r.ok && r.result.id;
    check("customer success records the cheque (Rs 200 post charges): it waits for an approver", r.ok && r.result.status === "pending", r);
    const rm = await M.BilCodRemit.findByPk(remitId);
    check("…charges worked out, parcels on the cheque, approvers told", Math.abs(Number(rm.charges) - 200) < 0.01 && (await M.BilCodParcel.count({ where: { id: parcels, status: "remitting" } })) === 2 && !!(await M.AdmNotification.findOne({ where: { user_id: admin.u.id, type: "billing.cod" } })));
    r = await call("codRemit", cs.token, { reference: `CHQX${stamp}`, amount: 100, parcelIds: [parcels[0]], proof: PHOTO });
    check("a parcel on one cheque cannot go on another", !r.ok && /on another cheque/.test(r.error), r);
    r = await call("codDecide", cs.token, remitId, true);
    check("customer success cannot approve", !r.ok, r);
    r = await call("codDecide", admin.token, remitId, false, "Cheque amount does not match the slip");
    check("refused: parcels go back to waiting", r.ok && (await M.BilCodParcel.count({ where: { id: parcels, status: "booked", remit_id: null } })) === 2, r);
    r = await call("codRemit", cs.token, { reference: `CHQ2${stamp}`, amount: total - 200, parcelIds: parcels, proof: PHOTO });
    r = await call("codDecide", admin.token, r.result.id, true);
    check("approved: both invoices are paid in full", r.ok && (await inv(A.invoiceId)).status === "paid" && (await inv(Bo.invoiceId)).status === "paid", r);
    const pays = await M.BilPayment.findAll({ where: { invoice_id: [A.invoiceId, Bo.invoiceId], method: "cod" }, raw: true });
    check("…each with an approved COD payment (consignment as reference, taken by customer success)", pays.length === 2 && pays.every((p) => p.status === "approved" && /^COD EM/.test(p.reference) && p.created_by === cs.u.id), pays);
    const step = await M.CsOnboardingItem.findOne({ where: { hotel_id: A.hotelId, item_key: "payment" } });
    check("…and 'Payment received' ticks itself for the outlet", step && !!step.done_at, step && step.toJSON());
    r = await call("codRemits", cs.token, {});
    const mine = r.ok && r.result.remits.find((x) => x.reference === `CHQ2${stamp}`);
    check("the cheques list shows it approved with its parcels and charges", mine && mine.status === "approved" && mine.parcels.length === 2 && Math.abs(mine.charges - 200) < 0.01, mine);
    r = await call("codProof", cs.token, mine.id);
    check("its photo opens", r.ok && /bil-proofs/.test(r.result.url), r);

    console.log("\nA parcel that comes back");
    r = await call("outletCreate", admin.token, { outlet: outlet("Gamma"), order: { planItemId: plan }, token: { method: "cash", amount: 1000 } });
    const G = r.result;
    r = await call("codBook", cs.token, { invoiceId: G.invoiceId, consignment: cn(3) });
    const g = r.result.id;
    r = await call("codReturned", cs.token, g, "Owner refused the parcel");
    check("marked returned (the invoice is still due)", r.ok && (await M.BilCodParcel.findByPk(g)).status === "returned" && (await inv(G.invoiceId)).status === "part_paid", r);
    r = await call("codBook", cs.token, { invoiceId: G.invoiceId, consignment: cn(4) });
    check("…and the invoice can go again by COD", r.ok, r);
    r = await call("codRemit", admin.token, { reference: `CHQ3${stamp}`, amount: r.result.amount, parcelIds: [r.result.id], proof: PHOTO });
    check("an approver's own cheque is approved at once", r.ok && r.result.status === "approved" && (await inv(G.invoiceId)).status === "paid", r);
}

async function cleanup() {
    const hotels = (await M.Hotel.findAll({ where: { hotel_name: { [Op.like]: `Cod %${stamp}` } }, attributes: ["id"], raw: true })).map((h) => h.id);
    const invs = hotels.length ? (await M.BilInvoice.findAll({ where: { hotel_id: hotels }, attributes: ["id"], raw: true })).map((x) => x.id) : [];
    if (invs.length) {
        const remitIds = (await M.BilCodParcel.findAll({ where: { invoice_id: invs }, attributes: ["remit_id"], raw: true })).map((p) => p.remit_id).filter(Boolean);
        await M.BilCodParcel.destroy({ where: { invoice_id: invs } });
        if (remitIds.length) await M.BilCodRemit.destroy({ where: { id: remitIds } });
        for (const m of [M.BilPayment, M.BilPayLink, M.BilInvoiceLine]) await m.destroy({ where: { invoice_id: invs } });
        await M.BilInvoice.destroy({ where: { id: invs } });
    }
    await M.BilCodRemit.destroy({ where: { reference: { [Op.like]: `CHQ%${stamp}` } } });
    if (hotels.length) {
        await M.CsOutletSetup.destroy({ where: { hotel_id: hotels } });
        await M.InvMove.destroy({ where: { hotel_id: hotels } });
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
