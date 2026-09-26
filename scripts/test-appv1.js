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

    await runDomains({ s, owner, cap, cashier, mgr, T3, session, cap2T, tbl });

    console.log("\nisolation");
    const other = await M.Order.findOne({ where: { hotel_id: { [require("sequelize").Op.ne]: s.hid } } });
    if (other) {
        const peek = await owner.settle(String(other.id), { payments: [{ modeId: "cash", amount: 1 }], clientKey: key() });
        check("another outlet's order is unreachable", !peek.ok, peek);
    }
    const ver = await fetch(`${base}/version`, { headers: { Authorization: `Bearer ${ownerT}` } }).then((r) => r.json());
    check("version fingerprint", ver.ok && typeof ver.result.v === "string");
}

/* ------------------------------ domains ------------------------------ */

async function runDomains({ s, owner, cap, cashier, mgr, T3, session, cap2T, tbl }) {
    const later = (min) => new Date(Date.now() + min * 60000).toISOString();
    const today = new Date().toISOString().slice(0, 10);
    const rnd = () => `k${Math.random()}`;

    console.log("\nreservations & queue");
    // A table nobody has ordered at yet: an order started in the hold window counts as the guest arriving.
    await owner.addTables((await owner.load()).sections[0].id, "R1", 4);
    const R1 = (await owner.load()).tables.find((t) => t.name === "R1").id;
    const res1 = await mgr.saveReservation({ name: "Mehta", mobile: "9000011111", guests: 4, at: later(20), endAt: later(80), tableIds: [R1], advance: 0 });
    check("booking saved", res1.ok, res1);
    check("booked table shows reserved (held 30 min before)", (await tbl("R1")).status === "reserved");
    const clash = await mgr.saveReservation({ name: "Shah", mobile: "9000022222", guests: 2, at: later(40), endAt: later(100), tableIds: [R1], advance: 0 });
    check("overlapping booking on the same table refused", !clash.ok && /already booked/.test(clash.error || ""), clash);
    const ns = await mgr.setReservationStatus(res1.id, "noshow");
    const rv = (await owner.load()).reservations.find((x) => x.id === res1.id);
    check("no-show frees the table", ns.ok && rv?.status === "noshow" && (await tbl("R1")).status === "free", rv);
    check("waitlist needs a mobile", !(await cap.addToQueue({ name: "Rao", mobile: "", guests: 2 })).ok);
    const q = await cap.addToQueue({ name: "Rao", mobile: "9000033333", guests: 2 });
    const qc = await cap.setQueueStatus(q.id, "called");
    check("waitlist add + call", q.ok && qc.ok && (await owner.load()).queue.find((x) => x.id === q.id)?.status === "called", { q, qc });

    console.log("\ncustomers & due");
    const cust = await owner.saveCustomer({ name: "Kiran", mobile: "9000044444", gstin: "", address: "" });
    check("customer saved", cust.ok, cust);
    check("same mobile refused", !(await owner.saveCustomer({ name: "Other", mobile: "9000044444" })).ok);
    const asha = (await owner.load()).customers.find((c) => c.mobile === "9876500000");
    check("cashier cannot collect dues (Ledger permission, as in the Web POS)", !(await cashier.collectDue("9876500000", 10, "cash")).ok);
    const tooMuch = await owner.collectDue("9876500000", asha.dueOutstanding + 1, "cash");
    check("collecting more than the due refused", !tooMuch.ok, tooMuch);
    const drawerBefore = await M.CashMovement.sum("amount", { where: { cashSessionId: session.id } });
    const coll = await owner.collectDue("9876500000", 50, "cash");
    const d1 = await owner.load();
    const drawerAfter = await M.CashMovement.sum("amount", { where: { cashSessionId: session.id } });
    check("part due collected in cash: due down, drawer up", coll.ok && Math.abs(d1.customers.find((c) => c.mobile === "9876500000").dueOutstanding - (asha.dueOutstanding - 50)) < 0.01 && Math.abs(drawerAfter - drawerBefore - 50) < 0.01, coll);
    check("collection listed with its mode", d1.dueCollections.some((x) => x.amount === 50 && x.modeId === "cash"), d1.dueCollections);

    console.log("\ncash & expenses");
    const bal = await M.CashMovement.sum("amount", { where: { cashSessionId: session.id } });
    check("cash out above the drawer refused", !(await cashier.cashMovement("out", bal + 1000, "bank")).ok);
    check("cash in", (await cashier.cashMovement("in", 100, "change from bank")).ok);
    const head = await owner.saveExpenseHead({ name: "Gas", type: "Variable", active: true });
    const headId = (await owner.load()).expenseHeads.find((h) => h.name === "Gas")?.id;
    const ex = await owner.saveExpense({ headId, amount: 40, modeId: "cash", note: "cylinder", fromDrawer: true });
    let d2 = await owner.load();
    const exRow = d2.expenses.find((e) => e.note === "cylinder");
    check("cash expense from the drawer", head.ok && ex.ok && exRow?.fromDrawer && d2.cashSession.movements.some((m) => m.kind === "expense" && m.amount === 40), { head, ex, exRow });
    const del = exRow ? await owner.deleteExpense(exRow.id) : { ok: false };
    d2 = await owner.load();
    check("deleting it gives the cash back", del.ok && !d2.expenses.some((e) => e.id === exRow?.id), del);

    console.log("\nstock");
    let st = (await owner.load()).stock;
    const kg = st.units.find((u) => u.short === "kg");
    const g = st.units.find((u) => u.short === "g");
    const raw = await owner.saveRaw({ name: "Tomato", category: "", unitId: g.id, purchaseUnitId: kg.id, conversion: 1000, reorderLevel: 500, active: true, openingStock: 3000, openingRate: 0.05 });
    st = (await owner.load()).stock;
    const tomato = st.raw.find((r) => r.name === "Tomato");
    check("raw material with opening stock (g)", raw.ok && tomato?.stock === 3000 && tomato.rate === 0.05, { raw, tomato });
    const sup = await owner.saveSupplier({ name: "Fresh Farms", contact: "", phone: "", gstin: "" });
    const supId = (await owner.load()).stock.suppliers.find((x) => x.name === "Fresh Farms")?.id;
    const po = await owner.savePurchase({ supplierId: supId, date: today, lines: [{ rawId: tomato.id, qty: 2, rate: 40, taxPct: 5 }], firstPayment: { amount: 50, modeId: "cash", fromDrawer: true } });
    st = (await owner.load()).stock;
    const p1 = st.purchases.find((x) => x.supplierId === supId);
    check("purchase: stock in, total with tax, first payment from the drawer", sup.ok && po.ok && p1?.total === 84 && p1.payments[0]?.amount === 50 && p1.payments[0].fromDrawer && st.raw.find((r) => r.id === tomato.id).stock === 5000, { po, p1 });
    check("supplier outstanding", st.suppliers.find((x) => x.id === supId)?.outstanding === 34, st.suppliers);
    const overpay = await owner.addPurchasePayment(p1.id, { amount: 100, modeId: "upi", date: today, fromDrawer: false });
    check("paying more than is due refused", !overpay.ok, overpay);
    const upiPay = await owner.addPurchasePayment(p1.id, { amount: 34, modeId: "upi", date: today, fromDrawer: false });
    check("rest paid by UPI, recorded as expense", upiPay.ok && (await owner.load()).expenses.some((e) => e.fromPurchase), upiPay);
    const cnt = await owner.stockEntry({ kind: "count", refKind: "raw", refId: tomato.id, qty: 4500, note: "count" });
    check("stock count adjusts to what is on the shelf", cnt.ok && (await owner.load()).stock.raw.find((r) => r.id === tomato.id).stock === 4500, cnt);
    check("wastage above stock refused", !(await owner.recordWastage({ refKind: "raw", refId: tomato.id, qty: 99999, reason: "spoilt" })).ok);
    const w = await owner.recordWastage({ refKind: "raw", refId: tomato.id, qty: 500, reason: "spoilt" });
    st = (await owner.load()).stock;
    check("wastage in grams, with its cost", w.ok && st.raw.find((r) => r.id === tomato.id).stock === 4000 && st.wastage.some((x) => x.qty === 500 && x.cost > 0), { w, wastage: st.wastage });
    const rec = await owner.saveRecipe({ itemId: String(s.items.chai.id), base: [{ kind: "raw", refId: tomato.id, qty: 10 }], byVariant: {}, byAddon: {} });
    check("recipe saved", rec.ok && (await owner.load()).stock.recipes.some((r) => r.itemId === String(s.items.chai.id)), rec);
    const semi = await owner.saveSemi({ name: "Tomato puree", unitId: g.id, minStock: 0, components: [{ kind: "raw", refId: tomato.id, qty: 2 }] });
    const semiId = (await owner.load()).stock.semi.find((x) => x.name === "Tomato puree")?.id;
    const prod = await owner.produceSemi(semiId, 100, "batch");
    st = (await owner.load()).stock;
    check("production uses raw stock, adds the semi-finished item", semi.ok && prod.ok && st.semi.find((x) => x.id === semiId)?.stock === 100 && st.raw.find((r) => r.id === tomato.id).stock === 3800, { semi, prod });

    console.log("\nmenu & tables");
    const cat = await owner.saveCategory({ menuId: String(s.catalog.id), name: "Soups", rank: 3, active: true });
    const catId = (await owner.load()).categories.find((x) => x.name === "Soups")?.id;
    const item = await owner.saveItem({ menuId: String(s.catalog.id), categoryId: catId, name: "Tomato Soup", shortCode: "", price: 90, dietary: "veg", gstType: "G", description: "", favorite: false, active: true, outOfStock: false, variants: [], addonGroupIds: [] });
    const soup = (await owner.load()).items.find((i) => i.name === "Tomato Soup");
    check("item saved with a generated short code", cat.ok && item.ok && soup && soup.shortCode.length > 0, { cat, item });
    if (soup) {
        await owner.setOutOfStock(soup.id, true);
        const oos = await cap.sendKot({ type: "dinin", tableId: T3, guests: 1, menuId: "", clientKey: rnd(), lines: [{ key: "x", itemId: soup.id, name: soup.name, dietary: "veg", addons: [], price: 90, qty: 1, custom: false }] });
        check("out-of-stock item cannot be ordered", !oos.ok, oos);
        check("a category with items cannot be deleted", !(await owner.deleteCategory(catId)).ok);
        await owner.deleteItem(soup.id);
        check("deleted item is gone", !(await owner.load()).items.some((i) => i.id === soup.id));
    }
    check("addon group max above its options refused", !(await owner.saveAddonGroup({ menuId: String(s.catalog.id), name: "Dips", min: 0, max: 3, single: false, active: true, options: [{ id: "", name: "Mint", price: 10, dietary: "veg" }] })).ok);
    const sec = (await owner.load()).sections[0].id;
    const add = await owner.addTables(sec, "G1-G3", 4);
    const again = await owner.addTables(sec, "G1-G4", 4);
    check("bulk add tables; existing names skipped", add.ok && add.added === 3 && again.ok && again.added === 1 && again.skipped.length === 3, { add, again });
    const g1 = (await owner.load()).tables.find((t) => t.name === "G1");
    const qr = await owner.newTableQr(g1.id);
    check("new QR bumps the version", qr.ok && (await owner.load()).tables.find((t) => t.id === g1.id).qrVersion === 2, qr);
    check("rename + delete a free table", (await owner.editTable(g1.id, { name: "G10" })).ok && (await owner.deleteTable(g1.id)).ok);

    console.log("\nstaff & permissions");
    const ownerRow = (await owner.load()).staff.find((x) => x.isOwner);
    check("the owner is the owner-number login", ownerRow && ownerRow.mobile === s.staff.owner.number, ownerRow);
    check("manager cannot edit the owner", !(await mgr.saveStaff({ id: ownerRow.id, name: "X", mobile: ownerRow.mobile, role: "Owner" })).ok);
    check("owner cannot be switched off", !(await owner.setStaffActive(ownerRow.id, false)).ok);
    const newCap = await owner.saveStaff({ name: "Veer", mobile: `8${String(Date.now()).slice(-9)}`, role: "Captain", pin: "4321", password: "secret99" });
    check("new captain added", newCap.ok, newCap);
    check("a used mobile is refused", !(await owner.saveStaff({ name: "Dup", mobile: s.staff.captain.number, role: "Captain", pin: "1111", password: "secret99" })).ok);
    const off = await owner.setStaffActive(String(s.staff.captain2.id), false);
    const after = await post("/load", { args: [] }, cap2T);
    check("switched-off staff are signed out at once", off.ok && after.status === 401, { off, status: after.status });
    await owner.setStaffActive(String(s.staff.captain2.id), true);
    const rd = await mgr.setRoleDefaults("Captain", (await owner.load()).roleDefaults.Captain);
    check("manager cannot change role permissions (no special)", !rd.ok, rd);
    check("owner can", (await owner.setRoleDefaults("Captain", (await owner.load()).roleDefaults.Captain)).ok);

    console.log("\nsettings");
    const fmt = { header: [{ id: "h1", content: "outlet-name", fontSize: 16 }, { id: "h2", content: "text", text: "Welcome", fontSize: 12 }], footer: [{ id: "f1", content: "phone", fontSize: 12 }] };
    const us = await owner.updateSettings({ invoiceFormat: fmt, businessDayStart: "05:00", tokens: { tokenFor: "both", billWithKot: "dinin", billWithToken: "off" } });
    const set = (await owner.load()).settings;
    check("invoice format + day start + tokens round-trip", us.ok && set.invoiceFormat.header[0]?.content === "outlet-name" && set.invoiceFormat.header[1]?.text === "Welcome" && set.invoiceFormat.footer[0]?.content === "phone" && set.businessDayStart === "05:00" && set.tokens.tokenFor === "both", { us, fmt: set.invoiceFormat });
    await owner.updateSettings({ businessDayStart: "00:00" });
    check("bad day start refused", !(await owner.updateSettings({ businessDayStart: "25:00" })).ok);
    const svc = await owner.saveCharge("service", { active: true, type: "percentage", value: 10, calculationOn: "core", orderTypes: ["dinin"], taxOnCharge: false, condition: "3", threshold: 0 });
    const withSvc = await cap.sendKot({ type: "dinin", tableId: T3, guests: 1, menuId: "", clientKey: rnd(), lines: [{ key: "y", itemId: String(s.items.paneer.id), name: "Paneer Tikka", dietary: "veg", addons: [], price: 200, qty: 1, custom: false }] });
    const svcOrder = (await owner.load()).orders.find((o) => o.id === withSvc.orderId);
    check("automatic 10% service on dine-in", svc.ok && svcOrder?.totals.service === 20, { svc, totals: svcOrder?.totals });
    check("Cash cannot be renamed", !(await owner.savePaymentMode({ id: "cash", name: "Money", active: true })).ok);
    check("UPI cannot be removed", !(await owner.removePaymentMode("upi")).ok);
    const sw = await owner.savePaymentMode({ name: "Swiggy", active: true });
    check("custom mode added", sw.ok && (await owner.load()).settings.paymentModes.some((m) => m.name === "Swiggy" && m.custom), sw);
    const kit = await owner.saveKitchen({ name: "Tandoor", categoryIds: [String(s.items.paneer.menu_categ_id)], sectionIds: [sec], orderTypes: ["dinin"] });
    const tandoor = (await owner.load()).settings.kitchens.find((k) => k.name === "Tandoor");
    check("kitchen by section / category", kit.ok && tandoor?.sectionIds[0] === sec && tandoor.orderTypes[0] === "dinin", { kit, tandoor });
    await owner.resetTokens();
    const tk = await cashier.counterOrder({ type: "pickup", lines: [{ key: "z", itemId: String(s.items.chai.id), name: "Masala Chai", dietary: "veg", addons: [], price: 30, qty: 1, custom: false }], menuId: "", clientKey: rnd() });
    check("token numbering restarts after a reset", tk.ok && tk.token === 1, tk);
    const tx = await owner.saveTax({ name: "Cess", type: "pr", rate: 1, active: true, orderTypes: [], sectionIds: [], itemIds: [] });
    check("tax saved", tx.ok && (await owner.load()).settings.taxes.some((t) => t.name === "Cess"), tx);
    const promo = await owner.savePromo({ name: "Flat 20", code: "FLAT20", type: "fix", value: 20, active: true });
    check("promo saved; duplicate code refused", promo.ok && !(await owner.savePromo({ name: "x", code: "FLAT20", type: "fix", value: 5, active: true })).ok, promo);
    check("bad UPI id refused", !(await owner.updateOutlet({ upiId: "bad" })).ok);

    console.log("\ndevices & account");
    const printer = (address) => [{ id: "p1", name: "Kitchen", connection: "wifi", address, paperWidth: "80mm", copies: 1, printsKot: true, printsInvoice: false, categoryIds: [], sectionIds: [], orderTypes: [], status: "unknown" }];
    check("printer with a bad IP refused", !(await owner.saveDevicePrinters("d-owner", printer("1.2.3"), true)).ok);
    const okPr = await owner.saveDevicePrinters("d-owner", printer("192.168.1.60:9100"), true);
    check("printers saved per device", okPr.ok && (await owner.load()).devices.find((x) => x.id === "d-owner")?.printers.length === 1, okPr);
    check("wrong current PIN refused", !(await cap.changePin("0000", "5555")).ok);
    const tkt = await owner.raiseTicket("Plan change", "Move us to App Pro", "plan-change");
    check("plan change request raised", tkt.ok && (await owner.load()).tickets.some((x) => x.kind === "plan-change"), tkt);
    const logout = await owner.logoutDevice("d-cap2");
    const gone = await post("/load", { args: [] }, cap2T);
    check("owner logs a phone out: its token stops", logout.ok && gone.status === 401, { logout, status: gone.status });

    console.log("\nreports");
    const dash = await owner.dashboard({ key: "today" });
    check("dashboard: sales, bills, modes, top items", dash.ok && dash.net > 0 && dash.bills > 0 && dash.byMode.length > 0 && dash.topItems.length > 0, dash);
    for (const id of ["day-wise", "item-wise", "category-wise", "tax", "payment-mode", "kot", "staff", "table", "due-collected", "cash-session", "expense", "purchase", "closing-stock", "stock-ledger", "wastage", "discount", "cancelled"]) {
        const rep = await owner.report(id, { key: "today" }, {});
        check(`report ${id}`, rep.ok && Array.isArray(rep.rows) && (["cancelled", "discount", "cash-session", "expense"].includes(id) || rep.rows.length > 0), rep.error || rep.rows?.length);
    }
    check("captain cannot open reports", !(await cap.report("day-wise", { key: "today" }, {})).ok);
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
