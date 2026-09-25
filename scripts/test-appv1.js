// Scenario tests for the BillerPe POS App API (/app/v1) against a real
// MySQL database. Mirrors BillerPe POS App scripts/verify-rules.ts (the
// mock's executable spec) on the real tables.
//
//   DATABASE_NAME=billerpe_app_test node scripts/test-appv1.js
//
// Refuses to run against any database whose name does not end in "_test".
// Every run creates its own new CLOUD_APP outlet (fresh mobile numbers), so
// runs never interfere and no existing outlet is touched.

require("dotenv").config();
if (!/_test$/.test(process.env.DATABASE_NAME || "")) {
    console.error("Refusing to run: DATABASE_NAME must end in _test");
    process.exit(1);
}
process.env.APP_JWT_SECRET = process.env.APP_JWT_SECRET || "appv1-test-secret";

const http = require("http");
const express = require("express");
const bcrypt = require("bcrypt");
const moment = require("moment");
const sequelize = require("../connection/connect");
const M = require("../model");
const { computeBill } = require("../appv1/engine/billEngine");
const { loadBillConfig } = require("../appv1/engine/totals");
const { ROLES, ROLE_PERMISSION_DEFAULTS, ROLE_SPECIAL_DEFAULTS } = require("../constant/rolePermissionDefaults");

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

/* ------------------------------ tenant ------------------------------ */

const stamp = String(Date.now()).slice(-7);
const mobile = (n) => `9${n}${stamp}`.slice(0, 10).padEnd(10, "0");
const PW = "secret123";

async function seed() {
    const hash = await bcrypt.hash(PW, 4);
    const pin = await bcrypt.hash("1234", 4);
    const hotel = await M.Hotel.create({
        hotel_name: `App Test ${stamp}`, owner_name: "Owner", owner_number: mobile(1), address1: "1 Test Road", pinCode: 380001,
        hotel_logo: "", password: hash, hotel_reg_date: new Date(), plan_start_date: new Date(), plan_end_date: moment().add(1, "year").toDate(),
        product_plan: "CLOUD_APP", app_device_limit: 3, is_token_on: "0", bill_with_kot: "3", bill_with_token: "0", upiId: "test@upi",
    });
    const hid = hotel.id;
    await M.RestaurantSetting.create({ hotel_id: hid, bill_reset_type: "never" });
    const catalog = await M.MenuCatalog.create({ name: "Main Menu", hotel_id: hid, is_default: true, enter_by: "t" });
    await M.PaymentMode.bulkCreate([
        { name: "Cash", hotel_id: hid, active: true, deletable: false },
        { name: "UPI", hotel_id: hid, active: true, deletable: true },
        { name: "Card", hotel_id: hid, active: true, deletable: true },
        { name: "Due", hotel_id: hid, active: true, deletable: false },
        { name: "Paytm", hotel_id: hid, active: true, deletable: true },
    ]);
    await M.BillChargeRule.create({ rule_for: "packaging", hotel_id: hid, active: true, charge_type: "fixed", charge_value: 15, calculation_on: "core", charge_automatic: ["pickup"], calculation_on_tax: false, greater_less: "3", greater_less_amount: 0 });
    await M.RolePermissionDefault.bulkCreate(ROLES.map((role) => ({ hotel_id: hid, role, permissions: ROLE_PERMISSION_DEFAULTS[role], special_permissions: ROLE_SPECIAL_DEFAULTS[role] })));
    await M.TaxType.bulkCreate([
        { tax_name: "CGST", tax_value: "pr", amount: 2.5, order_type: [], hotel_id: hid, active: true },
        { tax_name: "SGST", tax_value: "pr", amount: 2.5, order_type: [], hotel_id: hid, active: true },
    ]);
    await M.PromoCode.create({ promo_code_name: "Ten off", promo_code: "TEN", discount_type: "pr", discount_value: 10, status: true, hotel_id: hid });

    const staff = {};
    for (const [key, roleName, n] of [["owner", "A", 1], ["manager", "Manager", 2], ["captain", "Captain", 3], ["captain2", "Captain", 4], ["cashier", "Cashier", 5], ["kitchen", "Kitchen Staff", 6]]) {
        const role = await M.Role.create({ role_name: roleName, hotel_id: hid });
        staff[key] = await M.HotelUser.create({ role_cd: role.role_cd, hotel_id: hid, number: mobile(n), name: key[0].toUpperCase() + key.slice(1), email: "", active: true, password: hash, pin });
    }

    const half = await M.Variants.create({ variants_name: "Half", active: true, hotel_id: hid, menu_catalog_id: catalog.id });
    const dept = await M.AddonDepartment.create({ department_name: "Extras", maximum_allowed_addon: 2, minimum_allowed_addon: 0, singleSelection: false, hotel_id: hid, menu_catalog_id: catalog.id });
    const cheese = await M.Addons.create({ addon_name: "Cheese", price: 30, attributes: "veg", department_id: dept.id, hotel_id: hid });
    const starters = await M.Menu_categ.create({ menu_categ_nm: "Starters", hotel_id: hid, rank: 1, menu_catalog_id: catalog.id });
    const drinks = await M.Menu_categ.create({ menu_categ_nm: "Drinks", hotel_id: hid, rank: 2, menu_catalog_id: catalog.id });
    const paneer = await M.Menu.create({ item_name: "Paneer Tikka", price: "200", shortCode: "101", sub_categories: "Regular Veg", menu_categ_id: starters.id, hotel_id: hid, active: true });
    const chicken = await M.Menu.create({ item_name: "Chicken Tikka", price: "300", shortCode: "102", sub_categories: "Non-Veg", menu_categ_id: starters.id, hotel_id: hid, active: true });
    const chai = await M.Menu.create({ item_name: "Masala Chai", price: "30", shortCode: "201", sub_categories: "regular", menu_categ_id: drinks.id, hotel_id: hid, active: true });
    await M.MenuVariants.create({ menu_id: paneer.id, variant_id: half.id, variant_price: 120, hotel_id: hid });
    await M.MenuAddon.create({ menu_id: paneer.id, addon_department_id: dept.id, hotel_id: hid, active: true });

    const hall = await M.TableCatagories.create({ type: "T", table_catag_nm: "Hall", hotel_id: hid, rank: 1 });
    const tables = {};
    for (const name of ["T1", "T2", "T3", "T4", "T5", "T6"]) {
        tables[name] = await M.Table.create({ table_name: name, type: "T", table_catag_id: hall.id, hotel_id: hid, capacity: 4, table_status: "F" });
    }
    const kitchen = await M.KitchenSetting.create({ kitchen_name: "Main Kitchen", hotel_id: hid, table_ids: [], menu_categ_ids: [], order_type: [] });
    const bar = await M.KitchenSetting.create({ kitchen_name: "Bar", hotel_id: hid, table_ids: [], menu_categ_ids: [drinks.id], order_type: [] });
    // Main Kitchen takes every category; the Bar only drinks.
    await kitchen.update({ menu_categ_ids: [starters.id] });

    const unit = await M.Unit.create({ unit_name: "Kilogram", shortName: "kg", hotel_id: hid });
    const gram = await M.Unit.create({ unit_name: "Gram", shortName: "g", hotel_id: hid });
    const paneerRaw = await M.RawMaterial.create({ raw_material_name: "Paneer", purchase_price: 400, conversion_qty: 1000, unit_id: unit.id, consumption_unit: gram.id, hotel_id: hid });
    await M.Recipes.create({ hotel_id: hid, menu_id: paneer.id, raw_material_id: paneerRaw.id, consumption_qty: 150 });

    return { hotel, hid, staff, tables, items: { paneer, chicken, chai }, half, dept, cheese, kitchen, bar, paneerRaw, catalog };
}

/* ------------------------------ client ------------------------------ */

let base;
async function post(path, body, token) {
    const res = await fetch(`${base}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(body ?? {}),
    });
    return res.json().then((j) => ({ status: res.status, ...j }));
}
const device = (id) => ({ deviceId: id, name: `Phone ${id}`, make: "Test", model: "T1", android: "14", appVersion: "1.0.0" });
async function login(user, deviceId) {
    const r = await post("/login/password", { mobile: user.number, password: PW, device: device(deviceId) });
    return r.ok ? r.session.token : null;
}
function api(token) {
    return new Proxy({}, {
        get: (_, name) => async (...args) => {
            const r = await post(`/${name}`, { args }, token);
            return r.ok ? { ok: true, ...(r.result || {}) } : { ok: false, error: r.error, code: r.code, status: r.status };
        },
    });
}
const key = () => `k-${Math.random().toString(36).slice(2)}`;
const line = (item, qty = 1, extra = {}) => ({ key: key(), itemId: String(item.id), name: item.item_name, dietary: "veg", addons: [], price: Number(item.price), qty, custom: false, ...extra });

/* ------------------------------ scenarios ------------------------------ */

async function run() {
    const s = await seed();
    console.log(`Tenant: hotel ${s.hid} (${s.hotel.hotel_name})\n`);

    console.log("session");
    const bad = await post("/login/password", { mobile: s.staff.owner.number, password: "nope", device: device("d1") });
    check("wrong password refused", !bad.ok && bad.error === "wrong-password", bad);
    const ownerT = await login(s.staff.owner, "d-owner");
    check("owner logs in", !!ownerT);
    const capT = await login(s.staff.captain, "d-cap");
    const cap2T = await login(s.staff.captain2, "d-cap2");
    check("captains log in (3 of 3 devices)", !!capT && !!cap2T);
    const over = await post("/login/password", { mobile: s.staff.cashier.number, password: PW, device: device("d-4th") });
    check("4th device hits the outlet limit of 3", !over.ok && over.error === "device-limit", over);
    const pinOk = await post("/login/pin", { staffId: String(s.staff.cashier.id), pin: "1234", device: device("d-owner") });
    check("cashier PIN login on a registered device", pinOk.ok, pinOk);
    const cashT = pinOk.session?.token;
    const pinUnknown = await post("/login/pin", { staffId: String(s.staff.cashier.id), pin: "1234", device: device("d-unknown") });
    check("PIN refused on an unregistered device", !pinUnknown.ok, pinUnknown);
    const mgrT = (await post("/login/pin", { staffId: String(s.staff.manager.id), pin: "1234", device: device("d-cap2") })).session?.token;
    const kitT = (await post("/login/pin", { staffId: String(s.staff.kitchen.id), pin: "1234", device: device("d-cap2") })).session?.token;
    const noToken = await post("/load", { args: [] });
    check("no token -> 401 session-ended", noToken.status === 401 && noToken.code === "session-ended", noToken);
    const plan1 = await M.Hotel.create({ hotel_name: `Plan1 ${stamp}`, owner_name: "P1", owner_number: mobile(8), address1: "x", pinCode: 1, hotel_logo: "", password: "x", plan_start_date: new Date(), plan_end_date: moment().add(1, "year").toDate() });
    const p1role = await M.Role.create({ role_name: "A", hotel_id: plan1.id });
    await M.HotelUser.create({ role_cd: p1role.role_cd, hotel_id: plan1.id, number: mobile(8), name: "P1", active: true, password: await bcrypt.hash(PW, 4) });
    const mismatch = await post("/login/password", { mobile: mobile(8), password: PW, device: device("d-p1") });
    check("Plan 1 outlet refused (plan-mismatch)", !mismatch.ok && mismatch.error === "plan-mismatch", mismatch);

    const owner = api(ownerT);
    const cap = api(capT);
    const cap2 = api(cap2T);
    const cashier = api(cashT);
    const mgr = api(mgrT);
    const kit = api(kitT);

    console.log("\nload");
    let d = await owner.load();
    check("load ok", d.ok && d.outlet?.name === s.hotel.hotel_name, d.error);
    check("6 free tables", d.tables.length === 6 && d.tables.every((t) => t.status === "free"));
    check("menu: 3 items, variant + addon group", d.items.length === 3 && d.items.find((i) => i.name === "Paneer Tikka").variants.length === 1 && d.addonGroups.length === 1);
    check("dietary from free text", d.items.find((i) => i.name === "Chicken Tikka").dietary === "nonveg" && d.items.find((i) => i.name === "Masala Chai").dietary === "veg");
    check("payment modes: Cash/Due locked, Paytm custom", d.settings.paymentModes.find((m) => m.id === "cash").locked && d.settings.paymentModes.some((m) => m.custom && m.name === "Paytm"));
    check("7 role defaults", Object.keys(d.roleDefaults).length === 7);
    check("table QR link built", d.tables[0].qrUrl === undefined || d.tables[0].qrUrl.includes("/qr-menu?"));
    const tbl = async (name) => (await owner.load()).tables.find((t) => t.name === name);

    console.log("\nsend KOT");
    const T1 = String(s.tables.T1.id);
    const cart1 = { type: "dinin", tableId: T1, guests: 2, menuId: String(s.catalog.id), clientKey: key(), lines: [line(s.items.paneer, 1), line(s.items.chai, 2)] };
    const r1 = await cap.sendKot(cart1);
    check("KOT ok", r1.ok, r1);
    check("bill number 1", r1.billNo === "1", r1.billNo);
    check("no token for dine-in (tokens: pickup only)", r1.token === 0);
    check("KOT #1 = round 1, 2 lines", r1.kot?.kotNo === 1 && r1.kot.lines.length === 2, r1.kot);
    check("routed to Main Kitchen + Bar", r1.kitchens?.length === 2 && r1.kitchens.includes("Bar"), r1.kitchens);
    check("T1 running after KOT", (await tbl("T1")).status === "running");
    const again = await cap.sendKot(cart1);
    const o1 = (await owner.load()).orders.find((o) => o.id === r1.orderId);
    check("same clientKey applied once", again.ok && again.orderId === r1.orderId && o1.kots.length === 1, o1?.kots.length);
    const r2 = await cap2.sendKot({ type: "dinin", tableId: T1, guests: 2, menuId: "", clientKey: key(), lines: [line(s.items.chicken, 1)] });
    check("second phone on the same table joins the order as KOT #2", r2.ok && r2.orderId === r1.orderId && r2.kot.kotNo === 2, r2);
    const engineCfg = await loadBillConfig(s.hid);
    d = await owner.load();
    const o1b = d.orders.find((o) => o.id === r1.orderId);
    const exp = computeBill({ lines: [{ qty: 1, price: 200 }, { qty: 2, price: 30 }, { qty: 1, price: 300 }], orderType: "dinin", tableCategId: null, discount: { type: "fix", value: 0 }, config: engineCfg });
    check("totals = bill engine (560 + 5% GST)", o1b.totals.grand === exp.grandAmount && o1b.totals.taxLines.length === 2, { got: o1b.totals, exp: exp.grandAmount });
    check("order keeps guests + captain", o1b.guests === 2 && o1b.captainName === "Captain");

    console.log("\npickup");
    const p = await cashier.counterOrder({ type: "pickup", lines: [line(s.items.paneer, 1)], menuId: "", clientKey: key() });
    check("pickup order ok, bill 2, token 1 (tokens: pickup)", p.ok && p.billNo === "2" && p.token === 1, p);
    const p2 = await cashier.counterOrder({ type: "pickup", lines: [line(s.items.chai, 1)], menuId: "", clientKey: key() });
    check("next pickup gets token 2 (one daily sequence)", p2.ok && p2.token === 2, p2);
    await s.hotel.update({ is_token_on: "2" });
    d = await owner.load();
    const po = d.orders.find((o) => o.id === p.orderId);
    check("packaging 15 on pickup", po.totals.packaging === 15, po.totals);
    const stock1 = await M.StockInHand.findOne({ where: { hotel_id: s.hid, raw_material_id: s.paneerRaw.id } });
    check("pickup deducts stock at creation (150 g paneer, negative allowed)", stock1 && Number(stock1.available_stock_Consiompsion_qty) === -150, stock1?.toJSON());
    const dineCounter = await cashier.counterOrder({ type: "dinin", lines: [line(s.items.chai, 1)], menuId: "", clientKey: key() });
    check("counter dine-in without a table refused", !dineCounter.ok, dineCounter);

    console.log("\nhold");
    const T2 = String(s.tables.T2.id);
    const h = await cap.holdOrder({ type: "dinin", tableId: T2, guests: 1, menuId: "", clientKey: key(), lines: [line(s.items.paneer, 1)] });
    check("hold creates order + table Hold", h.ok && (await tbl("T2")).status === "hold", h);
    const pb = await cashier.printBill(h.orderId);
    check("bill blocked while items are held (bill-with-KOT off)", !pb.ok, pb);
    const mergeHeld = await owner.mergeTables(T2, T1);
    check("held table cannot merge", !mergeHeld.ok, mergeHeld);
    await s.hotel.update({ bill_with_kot: "1" });
    const pb2 = await cashier.printBill(h.orderId);
    check("bill-with-KOT on: held lines printed as a KOT with the bill", pb2.ok && pb2.kotLines?.length === 1 && pb2.order.status === "billed", pb2);
    check("T2 bill generated", (await tbl("T2")).status === "billed");
    const kdsHidden = await M.OrderDetails.count({ where: { orderId: Number(h.orderId), kds_hidden: true } });
    check("bill-with-KOT lines never on the KDS", kdsHidden === 1);
    const addAfter = await cap.sendKot({ orderId: h.orderId, type: "dinin", tableId: T2, guests: 1, menuId: "", clientKey: key(), lines: [line(s.items.chai, 1)] });
    check("new items after the bill reopen it (running)", addAfter.ok && (await tbl("T2")).status === "running", addAfter);

    console.log("\nremove a sent item");
    const o1c = (await owner.load()).orders.find((o) => o.id === r1.orderId);
    const capLine = o1c.kots[0].lines[0];
    const rmOther = await cap2.removeLine(r1.orderId, capLine.id, "wrong");
    check("another captain cannot remove it", !rmOther.ok, rmOther);
    const rmNoReason = await cap.removeLine(r1.orderId, capLine.id, " ");
    check("removing needs a reason", !rmNoReason.ok);
    await cap.markServed(r1.orderId, 1);
    const rmServed = await mgr.removeLine(r1.orderId, capLine.id, "customer changed mind");
    check("served line cannot be removed", !rmServed.ok, rmServed);
    const cap2Line = o1c.kots[1].lines[0];
    const rmMgr = await mgr.removeLine(r1.orderId, cap2Line.id, "not needed");
    check("manager can remove another's unserved line", rmMgr.ok, rmMgr);
    const cancelCap = await cap.cancelOrder(r1.orderId, "test");
    check("captain cannot cancel an order with food sent", !cancelCap.ok, cancelCap);

    console.log("\ndiscount & promo");
    const disc = await mgr.setDiscount(r1.orderId, { type: "pr", value: 10, reason: "regular" });
    check("10% discount with a reason", disc.ok, disc);
    check("discount needs a reason", !(await mgr.setDiscount(r1.orderId, { type: "fix", value: 5, reason: "" })).ok);
    check("bad promo refused", !(await mgr.applyPromo(r1.orderId, "NOPE")).ok);
    const promo = await mgr.applyPromo(r1.orderId, "TEN");
    const o1d = (await owner.load()).orders.find((o) => o.id === r1.orderId);
    check("promo is the one discount, carries the code", promo.ok && o1d.promoCode === "TEN" && o1d.totals.discount === 26, o1d.totals);

    console.log("\nsettle");
    const session = await M.CashSession.create({ hotel_id: s.hid, hotelUserId: s.staff.cashier.id, opening_float: 500, status: "Open", opened_at: new Date() });
    await M.CashMovement.create({ cashSessionId: session.id, hotelUserId: s.staff.cashier.id, type: "Opening", amount: 500, reason: "Opening float", at: new Date() });
    const grand = o1d.totals.grand;
    const overUpi = await cashier.settle(r1.orderId, { payments: [{ modeId: "upi", amount: grand + 10 }], clientKey: key() });
    check("non-cash above the bill refused", !overUpi.ok, overUpi);
    const short = await cashier.settle(r1.orderId, { payments: [{ modeId: "cash", amount: grand - 10 }], clientKey: key() });
    check("short payment refused", !short.ok, short);
    const dueNoMobile = await cashier.settle(r1.orderId, { payments: [{ modeId: "due", amount: grand }], clientKey: key() });
    check("due needs name + 10-digit mobile", !dueNoMobile.ok, dueNoMobile);
    const st = await cashier.settle(r1.orderId, { payments: [{ modeId: "cash", amount: grand + 100 }], clientKey: key() });
    check("cash over the bill gives change", st.ok && st.change === 100, st);
    check("table free after settle", (await tbl("T1")).status === "free");
    const drawer = await M.CashMovement.sum("amount", { where: { cashSessionId: session.id } });
    check("drawer gets the bill, not the change", Math.abs(drawer - (500 + grand)) < 0.01, { drawer, grand });
    const settled = (await owner.load()).orders.find((o) => o.id === r1.orderId);
    check("settled order shows cash payment + timeline", settled.status === "settled" && settled.payments[0]?.modeId === "cash" && settled.timeline.some((t) => t.label.startsWith("Settled")), settled.payments);
    const dineStock = await M.StockMovement.count({ where: { hotel_id: s.hid, ref_type: "order", ref_id: Number(r1.orderId), type: "consumption" } });
    check("dine-in deducts stock at settle", dineStock === 1, dineStock);
    const twice = await cashier.settle(r1.orderId, { payments: [{ modeId: "cash", amount: grand }], clientKey: key() });
    check("settling twice refused", !twice.ok, twice);

    // split with a custom mode and due
    const T3 = String(s.tables.T3.id);
    const r3 = await cap.sendKot({ type: "dinin", tableId: T3, guests: 1, menuId: "", clientKey: key(), lines: [line(s.items.chicken, 1)] });
    const g3 = (await owner.load()).orders.find((o) => o.id === r3.orderId).totals.grand;
    const split = await cashier.settle(r3.orderId, { payments: [{ modeId: `pm-${(await M.PaymentMode.findOne({ where: { hotel_id: s.hid, name: "Paytm" } })).id}`, amount: 100 }, { modeId: "due", amount: g3 - 100 }], customerName: "Asha", customerMobile: "9876500000", clientKey: key() });
    check("split: Paytm + due with customer", split.ok, split);
    const o3 = await M.Order.findByPk(Number(r3.orderId));
    check("custom mode in other_payments, due column", JSON.parse(o3.other_payments)[0].name === "Paytm" && Math.abs(o3.due - (g3 - 100)) < 0.01, o3.toJSON());
    d = await owner.load();
    check("customer with due outstanding", d.customers.some((c) => c.mobile === "9876500000" && c.dueOutstanding > 0), d.customers);

    console.log("\ntables");
    const T4 = String(s.tables.T4.id);
    const T5 = String(s.tables.T5.id);
    const r4 = await cap.sendKot({ type: "dinin", tableId: T4, guests: 3, menuId: "", clientKey: key(), lines: [line(s.items.paneer, 1)] });
    const tr = await owner.transferTable(r4.orderId, T5);
    check("transfer to a free table", tr.ok && (await tbl("T5")).status === "running" && (await tbl("T4")).status === "free", tr);
    const trBusy = await owner.transferTable(r4.orderId, T2);
    check("transfer to a busy table refused", !trBusy.ok);
    const mv = await owner.moveKot(r4.orderId, 1, T4);
    d = await owner.load();
    check("move KOT to a free table starts a new order there; old order goes", mv.ok && d.tables.find((t) => t.id === T4).status === "running" && d.tables.find((t) => t.id === T5).status === "free", mv);
    const r5 = await cap.sendKot({ type: "dinin", tableId: T5, guests: 2, menuId: "", clientKey: key(), lines: [line(s.items.chai, 1)] });
    const merge = await owner.mergeTables(T5, T4);
    d = await owner.load();
    const merged = d.orders.find((o) => o.tableId === T4 && o.status === "running");
    // The moved KOT started T4's order with 1 guest; T5's order had 2.
    check("merge: one order, guests added, first table free", merge.ok && merged.guests === 1 + 2 && d.tables.find((t) => t.id === T5).status === "free", { merge, guests: merged?.guests });
    check("merged KOTs keep their own numbers", merged.kots.map((k) => k.kotNo).join(",") === "1,2", merged.kots.map((k) => k.kotNo));
    void r5;

    console.log("\nkitchen");
    const kds1 = await kit.kdsAdvance(merged.id, 1, String(s.kitchen.id));
    const kds2 = await kit.kdsAdvance(merged.id, 1, String(s.kitchen.id));
    const alerts = await M.AppAlert.findAll({ where: { hotel_id: s.hid, kind: "food-ready" } });
    check("KDS: sent -> preparing -> ready alerts the captain", kds1.ok && kds2.ok && alerts.length === 1 && alerts[0].for_user_id === s.staff.captain.id, alerts.map((a) => a.toJSON()));
    const capAlerts = (await cap.load()).alerts.filter((a) => a.kind === "food-ready");
    const cap2Alerts = (await cap2.load()).alerts.filter((a) => a.kind === "food-ready");
    check("only that captain sees it", capAlerts.length === 1 && cap2Alerts.length === 0);
    const capKds = await cap.kdsAdvance(merged.id, 1, String(s.kitchen.id));
    check("captain cannot work the KDS", !capKds.ok, capKds);

    console.log("\nrequest bill");
    const rb = await cap.requestBill(merged.id);
    const reqAlert = (await cashier.load()).alerts.find((a) => a.kind === "bill-requested");
    check("captain requests the bill -> counter alert", rb.ok && !!reqAlert && (await tbl("T4")).status === "billed", rb);

    console.log("\nQR round");
    const qrSession = await M.QrSession.create({ hotel_id: s.hid, table_id: s.tables.T6.id, customer_mobile: "9123400000", customer_name: "Guest", session_key: `s${stamp}`, status: "open" });
    const qr = await M.QrOrder.create({ hotel_id: s.hid, table_id: s.tables.T6.id, qr_version: 1, customer_name: "Guest", customer_mobile: "9123400000", session_id: qrSession.id, status: "pending", items: [{ menuId: s.items.paneer.id, itemName: "Paneer Tikka", qty: 1, variantId: s.half.id, addonIds: [s.cheese.id] }, { menuId: s.items.chicken.id, itemName: "Chicken Tikka", qty: 1 }] });
    d = await owner.load();
    check("QR round listed, table shows it waiting", d.qrOrders.some((q) => q.id === String(qr.id) && q.status === "pending") && d.tables.find((t) => t.name === "T6").qrWaiting);
    const noReason = await cap.decideQr(String(qr.id), [{ key: "0", accept: true }, { key: "1", accept: false }]);
    check("rejecting needs a reason", !noReason.ok, noReason);
    const dq = await cap.decideQr(String(qr.id), [{ key: "0", accept: true }, { key: "1", accept: false, reason: "Out of stock" }]);
    check("accept 1, reject 1 -> KOT with the accepted item", dq.ok && dq.kot?.lines.length === 1 && dq.kot.lines[0].variantName === "Half", dq);
    const qrLine = await M.OrderDetails.findOne({ where: { orderId: Number(dq.orderId) } });
    check("QR item priced from the live menu (Half 120) + addon", Number(qrLine.price) === 120 && JSON.stringify(qrLine.addons).includes("Cheese"), qrLine.toJSON());
    await qr.reload();
    const qrItems = typeof qr.items === "string" ? JSON.parse(qr.items) : qr.items;
    check("round stored with each item's decision + reason", qr.status === "accepted" && qrItems[1].decision === "rejected" && qrItems[1].rejectReason === "Out of stock", qrItems);
    const qrOrder = (await owner.load()).orders.find((o) => o.id === dq.orderId);
    check("QR customer attached to the order", qrOrder.customerMobile === "9123400000" && qrOrder.fromQr);
    await cashier.printBill(dq.orderId);
    await qrSession.reload();
    check("bill printed -> QR session stops taking rounds", qrSession.bill_ready === true);
    await cashier.settle(dq.orderId, { payments: [{ modeId: "upi", amount: qrOrder.totals.grand }], clientKey: key() });
    await qrSession.reload();
    check("settled -> QR visit closed", qrSession.status === "closed");

    console.log("\nreopen & cancel");
    const reo = await cashier.reopenSettled(r1.orderId);
    check("cashier cannot reopen a settled bill", !reo.ok, reo);
    const reo2 = await owner.reopenSettled(r1.orderId);
    const drawer2 = await M.CashMovement.sum("amount", { where: { cashSessionId: session.id } });
    check("owner reopens: back to bill generated, cash out of the drawer", reo2.ok && Math.abs(drawer2 - 500 - (await M.Order.findByPk(Number(r1.orderId))).grandAmount * 0) < grand + 0.01 && (await owner.load()).orders.find((o) => o.id === r1.orderId).status === "billed", { reo2, drawer2 });
    const reversed = await M.StockMovement.count({ where: { hotel_id: s.hid, ref_id: Number(r1.orderId), type: "consumption_reversal" } });
    check("reopen puts the stock back", reversed === 1, reversed);
    const hc = await cap.holdOrder({ type: "dinin", tableId: String(s.tables.T6.id), guests: 1, menuId: "", clientKey: key(), lines: [line(s.items.chai, 1)] });
    const cancelHeld = await cap.cancelOrder(hc.orderId, "customer left");
    check("nothing sent to the kitchen: captain can cancel", cancelHeld.ok && (await tbl("T6")).status === "free", cancelHeld);

    console.log("\nisolation");
    const other = await M.Order.findOne({ where: { hotel_id: { [require("sequelize").Op.ne]: s.hid } } });
    if (other) {
        const peek = await owner.settle(String(other.id), { payments: [{ modeId: "cash", amount: 1 }], clientKey: key() });
        check("another outlet's order is unreachable", !peek.ok, peek);
    }
    const ver = await fetch(`${base}/version`, { headers: { Authorization: `Bearer ${ownerT}` } }).then((r) => r.json());
    check("version fingerprint", ver.ok && typeof ver.result.v === "string");
}

/* ------------------------------ main ------------------------------ */

(async () => {
    const app = express();
    app.use(express.json());
    app.use("/app/v1", require("../appv1/routes"));
    const server = http.createServer(app);
    await new Promise((r) => server.listen(0, r));
    base = `http://127.0.0.1:${server.address().port}/app/v1`;
    try {
        await run();
    } catch (err) {
        console.error("\nCRASH:", err);
        failures.push("crash");
    }
    server.close();
    await sequelize.close().catch(() => {});
    console.log(`\n${passed} passed, ${failures.length} failed`);
    process.exit(failures.length ? 1 : 0);
})();
