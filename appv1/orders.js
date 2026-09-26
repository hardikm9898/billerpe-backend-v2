const { Op } = require("sequelize");
const {
    Order, OrderDetails, Table, Menu, User, TimeLine, Hotel, PaymentMode, CashSession, CashMovement, KitchenSetting, AppAlert,
    QrSession, QrOrder, MenuVariants, Variants, Addons, AddonDepartment,
} = require("../model");
const { fail, need, needSpecial, r2, isOff, parseJson, outletClock, businessDate, audit } = require("./core");
const { recomputeOrderTotals, nextBillNo, nextToken, tokenApplies } = require("./engine/totals");
const { routeItemsToKitchens } = require("./engine/routing");
const { deductStockForOrder, reverseOrderItemStock, reverseAllOrderStock } = require("./engine/stockDeduction");
// Lazy: load.js requires views.js only, but keep the order engine loadable on its own.
const loadOrderView = (...a) => require("./load").loadOrderView(...a);

// The order rules of Plan 2 on the real tables, stored exactly the way the
// exe stores them (so reports, the Web POS and a later plan switch read them
// the same). Mirrors BillerPe POS App src/lib/pos/backend/mock/core.ts, which
// is the executable spec (npm run verify:rules there).
//
// Storage: status in-progress/hold/success, payment pending/success,
// deleted = cancelled; table_status F/R/H/P; line status in-progress (held) /
// kot (sent) / delivered (served); kotNumber = round within the order.

const OPEN = { deleted: false, payment: "pending" };

async function clockOf(c) {
    if (!c.clock) {
        const clock = await outletClock(c.hotelId, c.t);
        clock.today = businessDate(clock);
        c.clock = clock;
    }
    return c.clock;
}

// Timeline row in the exe's snapshot format (helpers/timeline.js), with a
// readable event_name so the order history says what happened.
async function event(c, orderId, label, action = "update_order") {
    const o = await Order.findOne({ where: { id: orderId, hotel_id: c.hotelId }, transaction: c.t });
    if (!o) return;
    const items = await OrderDetails.findAll({ where: { orderId, hotel_id: c.hotelId }, include: [{ model: Menu, attributes: ["id", "item_name", "price"] }], transaction: c.t });
    await TimeLine.create({
        gst: o.gst, service_charge: o.service_charge, grandAmount: o.grandAmount, discount: o.totalDiscount,
        sub_total: Number(o.totalAmount) - Number(o.totalDiscount), order_type: o.order_type, order_status: o.status, bill_no: o.bill_no,
        items: items.map((i) => i.get({ plain: true })), action, event_name: label.slice(0, 250), creator: c.userName,
        order_id: o.id, TableId: o.TableId, hotelUserId: c.userId, hotel_id: c.hotelId,
        device_name: "pos-app", from: "app", created_Date: new Date(),
    }, { transaction: c.t });
}

async function alert(c, a) {
    await AppAlert.create(
        { hotel_id: c.hotelId, kind: a.kind, title: a.title.slice(0, 160), body: (a.body || "").slice(0, 400), link: a.link || null, for_user_id: a.forUserId || null, for_roles: a.forRoles ? JSON.stringify(a.forRoles) : null, read_by: "[]" },
        { transaction: c.t },
    );
}

const findOrder = async (c, id) => {
    const o = await Order.findOne({ where: { id: Number(id) || 0, hotel_id: c.hotelId }, transaction: c.t });
    if (!o) fail("This order is no longer open. Refresh and try again.");
    return o;
};

const isOpen = (o) => !o.deleted && o.payment === "pending";
const isHeldStatus = (o) => o.status === "hold";
const isBilled = (o) => o.status === "success" && o.payment === "pending";

const openOrderOnTable = (c, tableId) =>
    Order.findOne({ where: { hotel_id: c.hotelId, TableId: Number(tableId), ...OPEN }, transaction: c.t });

async function findTable(c, id) {
    const t = await Table.findOne({ where: { id: Number(id) || 0, hotel_id: c.hotelId, active: true }, transaction: c.t });
    if (!t) fail("Table not found");
    return t;
}

/**
 * Table state, and what the table's QR customers may do (the exe's
 * helpers/qrTableState.js, done in place here since the cloud owns both):
 * bill printed = no more rounds; items again = ordering re-opens; table
 * freed (settled, cancelled, moved) = the visit is over and rounds still
 * waiting expire.
 */
async function setTableStatus(c, tableId, status, reason = "settled") {
    if (!tableId) return;
    await Table.update({ table_status: status }, { where: { id: tableId, hotel_id: c.hotelId }, transaction: c.t });
    const where = { hotel_id: c.hotelId, table_id: tableId, status: "open" };
    if (status === "F") {
        const sessions = await QrSession.findAll({ where, attributes: ["id"], transaction: c.t });
        if (!sessions.length) return;
        await QrSession.update({ status: "closed", closed_reason: reason, closed_at: new Date() }, { where, transaction: c.t });
        await QrOrder.update({ status: "expired" }, { where: { hotel_id: c.hotelId, session_id: sessions.map((x) => x.id), status: "pending" }, transaction: c.t });
    } else {
        await QrSession.update({ bill_ready: status === "P" }, { where, transaction: c.t });
    }
}

/* ------------------------------ lines ------------------------------ */

// LineAddon[] -> the department-grouped JSON every other reader expects
// (exe billEngine addonsTotal, pdf bill, Web POS).
function addonsJson(addons = []) {
    const groups = new Map();
    for (const a of addons) {
        const g = groups.get(a.groupId) || { id: Number(a.groupId) || a.groupId, department_name: a.groupName || "", hms_addon_msts: [] };
        g.hms_addon_msts.push({ id: Number(a.id) || a.id, addon_name: a.name, price: Number(a.price) || 0, qty: Number(a.qty) || 1 });
        groups.set(a.groupId, g);
    }
    return [...groups.values()];
}

async function checkLines(c, lines) {
    if (!Array.isArray(lines) || lines.length === 0) fail("Add at least one item");
    for (const l of lines) {
        const qty = Number(l.qty);
        if (!(qty > 0)) fail(`${l.name || "Item"}: quantity must be more than 0`);
        if (Math.round(qty * 100) !== qty * 100) fail(`${l.name}: quantity can have at most 2 decimals`);
        if (l.custom) {
            if (!String(l.name || "").trim()) fail("A custom item needs a name");
            if (!(Number(l.price) > 0)) fail(`${l.name}: enter a price`);
            continue;
        }
        const item = await Menu.findOne({ where: { id: Number(l.itemId) || 0, hotel_id: c.hotelId }, attributes: ["id", "active", "is_deleted", "out_of_stock", "item_name"], transaction: c.t });
        if (!item || !item.active || item.is_deleted) fail(`${l.name} is no longer on the menu`);
        if (item.out_of_stock) fail(`${l.name} is out of stock`);
    }
}

/** DraftLine[] -> OrderDetails rows. A custom item becomes a hidden menu row (as on the exe). */
async function buildRows(c, order, lines, { held = false, kotNumber = null, kdsHidden = false } = {}) {
    const rows = [];
    for (const l of lines) {
        let menuId = Number(l.itemId) || null;
        if (l.custom) {
            const custom = await Menu.create({ price: Number(l.price), item_name: String(l.name).trim(), active: false, hotel_id: c.hotelId, shortCode: "CUSTOM", sub_categories: dietaryText(l.dietary) }, { transaction: c.t });
            menuId = custom.id;
        }
        rows.push({
            orderId: order.id, hotel_id: c.hotelId, MenuId: menuId, qty: Number(l.qty), price: Number(l.price),
            order_type: order.order_type, kotNumber: held ? null : kotNumber, totalDiscount: 0,
            status: held ? "in-progress" : "kot", payment_status: "pending",
            comment: String(l.note || "").slice(0, 250), addons: addonsJson(l.addons),
            variant_id: Number(l.variantId) || null, variant_name: l.variantName || null,
            TableId: order.TableId ?? null, UserId: order.UserId,
            firedBy: held ? null : c.userId, kds_hidden: !!kdsHidden,
            route_kitchen_id: Number(l.routeKitchenId) || null, route_printer_ref: l.routePrinterId ? String(l.routePrinterId).slice(0, 64) : null,
            kds_state: held ? null : "sent",
        });
    }
    return OrderDetails.bulkCreate(rows, { transaction: c.t });
}

const DIETARY_TEXT = { veg: "Regular Veg", nonveg: "Non-Veg", egg: "Egg", jain: "Jain", vegan: "Vegan", swaminarayan: "Swaminarayan" };
const dietaryText = (d) => DIETARY_TEXT[d] || "Regular Veg";

/* ------------------------------ create / KOT / hold ------------------------------ */

async function createOrder(c, cart, status) {
    const clock = await clockOf(c);
    let table = null;
    if (cart.type === "dinin") {
        if (!cart.tableId) fail("Pick a table for a dine-in order");
        table = await findTable(c, cart.tableId);
        if (await openOrderOnTable(c, table.id)) fail(`${table.table_name} already has an order. Refresh the tables.`);
    } else if (cart.type !== "pickup") fail("Unknown order type");
    // Every order has its own customer row (exe keeps a placeholder until a real customer is attached).
    const user = await User.create({ hotel_id: c.hotelId, name: "", number: "", address: "", gstin: "", isPlaceholder: true }, { transaction: c.t });
    const bill_no = await nextBillNo(c.hotelId, clock, c.t);
    const token = await nextToken(c.hotelId, cart.type, clock, c.t);
    const order = await Order.create({
        hotel_id: c.hotelId, hotelUserId: c.userId, UserId: user.id, TableId: table ? table.id : null,
        bill_no, token, business_date: clock.today, status, order_type: cart.type, payment: "pending",
        isOffline: false, created_from: cart.fromQr ? "qr" : "app",
        guests: cart.type === "dinin" ? Math.max(1, Number(cart.guests) || 1) : 0,
        menu_catalog_id: Number(cart.menuId) || null,
    }, { transaction: c.t });
    await attachCustomer(c, order, cart.customerName, cart.customerMobile, { address: cart.customerAddress, gstin: cart.customerGstin });
    await event(c, order.id, `Order created · bill ${bill_no}${token ? ` · token ${token}` : ""}`, "place_order");
    // A reservation holding this table is fulfilled by this order (the
    // reservation clock sees an order started during the hold - exe rule).
    return order;
}

async function orderForCart(c, cart) {
    if (cart.orderId) {
        const o = await findOrder(c, cart.orderId);
        if (o.deleted) fail(`Bill ${o.bill_no} was cancelled`);
        if (o.payment === "success") fail(`Bill ${o.bill_no} is already settled`);
        return o;
    }
    // Two phones on one table: the second cart joins the table's open order.
    if (cart.type === "dinin" && cart.tableId) return openOrderOnTable(c, cart.tableId);
    return null;
}

async function applyCartMeta(c, order, cart) {
    const patch = {};
    if (cart.type === "dinin" && Number(cart.guests) > 0) patch.guests = Math.floor(Number(cart.guests));
    if (Number(cart.menuId)) patch.menu_catalog_id = Number(cart.menuId);
    if (Object.keys(patch).length) await order.update(patch, { transaction: c.t });
    if (cart.customerName || cart.customerMobile) await attachCustomer(c, order, cart.customerName, cart.customerMobile, { address: cart.customerAddress, gstin: cart.customerGstin });
}

async function kitchensFor(c, order, lines) {
    const [kitchens, table] = await Promise.all([
        KitchenSetting.findAll({ where: { hotel_id: c.hotelId }, raw: true, transaction: c.t }),
        order.TableId ? Table.findOne({ where: { id: order.TableId }, raw: true, transaction: c.t }) : null,
    ]);
    const menuIds = lines.map((l) => l.MenuId).filter(Boolean);
    const menus = await Menu.findAll({ where: { id: menuIds }, attributes: ["id", "menu_categ_id"], raw: true, transaction: c.t });
    const categ = new Map(menus.map((m) => [m.id, m.menu_categ_id]));
    const routed = routeItemsToKitchens(kitchens, lines.map((l) => ({ ...l, menu_categ_id: categ.get(l.MenuId) })), order.order_type, table?.id);
    return routed.map((r) => r.kitchen.kitchen_name);
}

/**
 * Send KOT. The table turns Running only now (owner rule: a cart on a
 * phone never changes it). The cart REPLACES any held lines: the device
 * loaded them into its cart when it opened the held order.
 */
async function sendKot(c, cart, opts = {}) {
    need(c, "biller", "create");
    await checkLines(c, cart.lines);
    const order = (await orderForCart(c, cart)) || (await createOrder(c, cart, "in-progress"));
    await applyCartMeta(c, order, cart);
    await OrderDetails.destroy({ where: { orderId: order.id, hotel_id: c.hotelId, status: "in-progress" }, transaction: c.t });
    const maxKot = (await OrderDetails.max("kotNumber", { where: { orderId: order.id, hotel_id: c.hotelId }, transaction: c.t })) || 0;
    const kotNumber = maxKot + 1;
    const rows = await buildRows(c, order, cart.lines, { kotNumber, kdsHidden: opts.kdsHidden });
    await order.update({ status: "in-progress" }, { transaction: c.t });
    await setTableStatus(c, order.TableId, "R");
    await recomputeOrderTotals(order.id, c.hotelId, { transaction: c.t });
    await event(c, order.id, `KOT #${kotNumber} · ${rows.length} item${rows.length === 1 ? "" : "s"}${opts.kdsHidden ? " (printed with the bill)" : ""}`, "kot");
    await audit(c, "Orders", `KOT #${kotNumber} sent for bill ${order.bill_no}`);
    const kitchens = opts.kdsHidden ? [] : await kitchensFor(c, order, rows.map((r) => r.get({ plain: true })));
    // Pickup stock goes out when the order is taken (owner rule); dine-in at settle.
    if (order.order_type === "pickup") await deductStockForOrder(order.id, c.hotelId, c.t, c.userId);
    const view = await loadOrderView(c.hotelId, order.id, c.t);
    const kot = view.kots.find((k) => k.kotNo === kotNumber);
    return { orderId: String(order.id), billNo: String(order.bill_no), token: order.token || 0, kot, kitchens };
}

/** Hold: save the cart on the server without sending it to the kitchen. */
async function holdOrder(c, cart) {
    need(c, "biller", "create");
    await checkLines(c, cart.lines);
    const order = (await orderForCart(c, cart)) || (await createOrder(c, cart, "hold"));
    if (isBilled(order)) fail("The bill is already printed. Send new items as a KOT instead.");
    await applyCartMeta(c, order, cart);
    await OrderDetails.destroy({ where: { orderId: order.id, hotel_id: c.hotelId, status: "in-progress" }, transaction: c.t });
    await buildRows(c, order, cart.lines, { held: true });
    await order.update({ status: "hold" }, { transaction: c.t });
    await setTableStatus(c, order.TableId, "H");
    await recomputeOrderTotals(order.id, c.hotelId, { transaction: c.t });
    await event(c, order.id, `Held · ${cart.lines.length} item(s) not sent`, "hold");
    await audit(c, "Orders", `Held bill ${order.bill_no}`);
    return { orderId: String(order.id), billNo: order.bill_no };
}

/* ------------------------------ customer ------------------------------ */

// Web POS customer-details-dialog.tsx GSTIN_PATTERN.
const GSTIN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/**
 * The order's customer (Web POS dialog: mobile, name, address, GSTIN).
 * A known mobile re-uses that customer row; otherwise the order's own
 * placeholder row becomes the customer. A row that already belongs to a
 * real customer is never renamed to someone else: a new row is made.
 * All fields empty = the order has no customer again.
 */
async function attachCustomer(c, order, name, mobile, extra = {}) {
    const number = String(mobile || "").trim();
    const nm = String(name || "").trim();
    const address = String(extra.address || "").trim();
    const gstin = String(extra.gstin || "").trim().toUpperCase();
    if (number && !/^\d{10}$/.test(number)) fail("Enter a 10-digit mobile number");
    if (gstin && !GSTIN.test(gstin)) fail("Enter a valid 15-character GSTIN");
    const pointTo = async (userId) => {
        if (order.UserId === userId) return;
        await order.update({ UserId: userId }, { transaction: c.t });
        await OrderDetails.update({ UserId: userId }, { where: { orderId: order.id, hotel_id: c.hotelId }, transaction: c.t });
    };
    if (!number && !nm) {
        if (!extra.clear) return;
        const blank = await User.create({ hotel_id: c.hotelId, name: "", number: "", address: "", gstin: "", isPlaceholder: true }, { transaction: c.t });
        return pointTo(blank.id);
    }
    const details = { ...(nm ? { name: nm } : {}), ...(address ? { address } : {}), ...(gstin ? { gstin } : {}) };
    if (number) {
        const existing = await User.findOne({ where: { hotel_id: c.hotelId, number, isPlaceholder: false }, order: [["id", "DESC"]], transaction: c.t });
        if (existing) {
            if (Object.keys(details).length) await existing.update(details, { transaction: c.t });
            return pointTo(existing.id);
        }
    }
    const own = await User.findOne({ where: { id: order.UserId, hotel_id: c.hotelId }, transaction: c.t });
    if (own && own.isPlaceholder) {
        await own.update({ ...details, ...(number ? { number } : {}), isPlaceholder: false }, { transaction: c.t });
        return;
    }
    const fresh = await User.create({ hotel_id: c.hotelId, name: nm, number, address, gstin, isPlaceholder: false }, { transaction: c.t });
    return pointTo(fresh.id);
}

/** setCustomer(orderId, { name, mobile, address, gstin }) - all empty removes the customer. */
async function setCustomer(c, orderId, cust = {}) {
    need(c, "biller", "edit");
    const o = await findOrder(c, orderId);
    await attachCustomer(c, o, cust.name, cust.mobile, { address: cust.address, gstin: cust.gstin, clear: true });
    await event(c, o.id, cust.mobile ? `Customer ${cust.name || ""} ${cust.mobile}`.replace(/\s+/g, " ") : "Customer removed", "update_order");
}

async function setGuests(c, orderId, guests) {
    need(c, "biller", "edit");
    const o = await findOrder(c, orderId);
    if (!isOpen(o)) fail("This order is closed");
    if (!Number.isInteger(Number(guests)) || Number(guests) < 1) fail("Guests must be at least 1");
    await o.update({ guests: Number(guests) }, { transaction: c.t });
    await event(c, o.id, `Guests: ${guests}`);
}

/* ------------------------------ lines after KOT ------------------------------ */

/**
 * Remove one line. Held: anyone who can bill. Fired: only the staff who
 * sent it, or a Manager/Owner, never once served (exe removeKotLine).
 */
async function removeLine(c, orderId, lineId, reason) {
    need(c, "biller", "edit");
    const o = await findOrder(c, orderId);
    if (!isOpen(o)) fail("This order is closed");
    if (!String(reason || "").trim()) fail("Add a reason");
    const line = await OrderDetails.findOne({ where: { id: Number(lineId) || 0, orderId: o.id, hotel_id: c.hotelId }, include: [{ model: Menu, attributes: ["item_name"] }], transaction: c.t });
    if (!line) fail("Item not found");
    const name = line.hms_menu_mst?.item_name || "item";
    if (line.status === "delivered") fail("This item is already served and cannot be removed");
    if (line.status === "kot") {
        const boss = c.perms.owner || c.role === "Manager";
        if (!boss && line.firedBy !== c.userId) fail("Only the staff who sent it, or a Manager/Owner, can remove this item");
    }
    await reverseOrderItemStock({ order_id: o.id, order_item_id: line.id, hotel_id: c.hotelId, t: c.t });
    await line.destroy({ transaction: c.t });
    await recomputeOrderTotals(o.id, c.hotelId, { transaction: c.t });
    await event(c, o.id, `Removed ${line.qty}× ${name}${line.kotNumber ? ` from KOT #${line.kotNumber}` : ""} — ${String(reason).trim()}`, "remove_kot");
    await audit(c, "Orders", `Removed an item from bill ${o.bill_no} — ${String(reason).trim()}`);
}

async function markServed(c, orderId, kotNo) {
    need(c, "biller", "edit");
    const o = await findOrder(c, orderId);
    await OrderDetails.update({ status: "delivered", ready: true, kds_state: "ready" }, { where: { orderId: o.id, hotel_id: c.hotelId, kotNumber: Number(kotNo), status: "kot" }, transaction: c.t });
    await event(c, o.id, `KOT #${kotNo} served`);
}

/* ------------------------------ bill ------------------------------ */

/**
 * Generate the bill: order "success" + table "P"; the table's QR can no
 * longer add items. Held lines follow Bill-with-KOT: printed with the bill
 * as a KOT, never sent to a KDS; otherwise they must be sent first.
 */
async function printBill(c, orderId, { byRequest = false } = {}) {
    need(c, "biller", byRequest ? "edit" : "create");
    const o = await findOrder(c, orderId);
    if (!isOpen(o)) fail("This order is closed");
    const lines = await OrderDetails.findAll({ where: { orderId: o.id, hotel_id: c.hotelId }, transaction: c.t });
    if (!lines.length) fail("Nothing to bill yet");
    const { held, kotNo, printKot } = await billUnsent(c, o, lines);
    await o.update({ status: "success", ...(o.billed_at ? {} : { billed_at: new Date() }) }, { transaction: c.t });
    await setTableStatus(c, o.TableId, "P");
    await recomputeOrderTotals(o.id, c.hotelId, { transaction: c.t });
    await event(c, o.id, byRequest ? "Bill requested at the counter" : "Bill printed", "update_order");
    const hotel = await Hotel.findOne({ where: { id: c.hotelId }, attributes: ["bill_with_token"], transaction: c.t });
    const order = await loadOrderView(c.hotelId, o.id, c.t);
    const heldIds = new Set(held.map((l) => String(l.id)));
    const kotLines = kotNo && printKot ? (order.kots.find((k) => k.kotNo === kotNo)?.lines ?? []).filter((l) => heldIds.has(l.id)) : [];
    return { order, kotLines, printToken: o.token > 0 && tokenApplies(hotel?.bill_with_token, o.order_type) };
}

/**
 * Items never sent to the kitchen, on a bill (Web POS "Save" / "Bill Print"
 * / Settle without a KOT - exe AdminOrder): they become the order's next
 * round, shown on no KDS. With Bill-with-KOT on for this order type they
 * are also printed as a KOT with the bill (on the invoice printer).
 */
async function billUnsent(c, o, lines) {
    const all = lines || (await OrderDetails.findAll({ where: { orderId: o.id, hotel_id: c.hotelId }, transaction: c.t }));
    const held = all.filter((l) => l.status === "in-progress");
    if (!held.length) return { held, kotNo: null, printKot: false };
    const kotNo = ((await OrderDetails.max("kotNumber", { where: { orderId: o.id, hotel_id: c.hotelId }, transaction: c.t })) || 0) + 1;
    await OrderDetails.update({ status: "kot", kotNumber: kotNo, kds_hidden: true, firedBy: c.userId, kds_state: "sent" }, { where: { id: held.map((l) => l.id) }, transaction: c.t });
    const hotel = await Hotel.findOne({ where: { id: c.hotelId }, attributes: ["bill_with_kot"], transaction: c.t });
    await event(c, o.id, `${held.length} item(s) billed without a KOT`, "update_order");
    return { held, kotNo, printKot: tokenApplies(hotel?.bill_with_kot, o.order_type) };
}

/**
 * Bill straight from a phone's cart without a KOT first (Web POS): the cart
 * replaces the order's held items, and the bill is generated (request = a
 * captain with no bill printer: the counter is told).
 */
async function billCart(c, cart, opts = {}) {
    need(c, "biller", "create");
    await checkLines(c, cart.lines);
    const order = (await orderForCart(c, cart)) || (await createOrder(c, cart, "hold"));
    await applyCartMeta(c, order, cart);
    await OrderDetails.destroy({ where: { orderId: order.id, hotel_id: c.hotelId, status: "in-progress" }, transaction: c.t });
    await buildRows(c, order, cart.lines, { held: true });
    // Pickup: stock goes out when the order is taken (owner rule).
    const r = opts.request ? await requestBill(c, order.id) : await printBill(c, order.id);
    if (order.order_type === "pickup") await deductStockForOrder(order.id, c.hotelId, c.t, c.userId);
    return r;
}

/** A captain whose phone has no bill printer: the bill is generated for the counter. */
async function requestBill(c, orderId) {
    const r = await printBill(c, orderId, { byRequest: true });
    const o = await findOrder(c, orderId);
    const table = o.TableId ? await Table.findOne({ where: { id: o.TableId }, attributes: ["table_name"], transaction: c.t }) : null;
    await alert(c, {
        kind: "bill-requested",
        title: `Bill requested · ${table?.table_name ?? `Token ${o.token}`}`,
        body: `Bill ${o.bill_no} · ${Number(o.grandAmount).toFixed(2)} · by ${c.userName}`,
        link: `/bill/${o.id}`,
        forRoles: ["Cashier", "Manager", "Owner"],
    });
    return r;
}

/**
 * Cancel. Nothing sent to the kitchen yet: anyone who can bill. Food
 * already fired: Orders delete + the "delete orders" permission (exe
 * controller/order.js#deleteOrder).
 */
async function cancelOrder(c, orderId, reason) {
    const o = await findOrder(c, orderId);
    if (!isOpen(o)) fail("Only an open order can be cancelled");
    const fired = await OrderDetails.count({ where: { orderId: o.id, hotel_id: c.hotelId, status: ["kot", "delivered"] }, transaction: c.t });
    if (fired) {
        need(c, "orders", "delete");
        needSpecial(c, "orders.deleteOrder");
    } else need(c, "biller", "edit");
    if (!String(reason || "").trim()) fail("Add a reason for cancelling");
    await reverseAllOrderStock(o.id, c.hotelId, c.t, "Order cancelled");
    await o.update({ deleted: true }, { transaction: c.t });
    await setTableStatus(c, o.TableId, "F", "cancelled");
    await event(c, o.id, `Cancelled — ${String(reason).trim()}`, "delete_order");
    await audit(c, "Orders", `Cancelled bill ${o.bill_no} — ${String(reason).trim()}`);
}

/* ------------------------------ tables ------------------------------ */

// exe controller/table.js#destinationProblem, word for word.
const HELD_MERGE_MESSAGE = "A held order can't be merged. Transfer it to a free table instead - it stays on hold there.";
function destinationProblem(source, target) {
    if (!target || target.id === source.id) return null;
    if (isBilled(target)) return "The bill for the destination table is already generated - pick another table.";
    if (isHeldStatus(source)) return HELD_MERGE_MESSAGE;
    if (isHeldStatus(target)) return "The destination table is on hold - held orders can't be merged. Pick another table.";
    return null;
}

/** Transfer to a free table; a held order stays Hold (owner rule). */
async function transferTable(c, orderId, toTableId) {
    needSpecial(c, "tables.mergeTransfer");
    const o = await findOrder(c, orderId);
    if (!isOpen(o) || o.order_type !== "dinin") fail("Only an open dine-in order can move");
    if (isBilled(o)) fail("Bill already generated for this order - it can no longer be moved or merged");
    const to = await findTable(c, toTableId);
    if (await openOrderOnTable(c, to.id)) fail(`${to.table_name} is not free — use Merge instead`);
    const fromId = o.TableId;
    await o.update({ TableId: to.id }, { transaction: c.t });
    await OrderDetails.update({ TableId: to.id }, { where: { orderId: o.id, hotel_id: c.hotelId }, transaction: c.t });
    await setTableStatus(c, fromId, "F", "moved");
    await setTableStatus(c, to.id, isHeldStatus(o) ? "H" : "R");
    await recomputeOrderTotals(o.id, c.hotelId, { transaction: c.t });
    await event(c, o.id, `Moved to ${to.table_name}`, "update_order");
    await audit(c, "Tables", `Transferred bill ${o.bill_no} to ${to.table_name}`);
}

/** Merge: a held order is never part of a merge, neither side (owner rule). */
async function mergeTables(c, fromTableId, toTableId) {
    needSpecial(c, "tables.mergeTransfer");
    const from = await openOrderOnTable(c, fromTableId);
    const to = await openOrderOnTable(c, toTableId);
    if (!from) fail("The first table has no order");
    if (!to) fail("The second table has no order");
    if (from.id === to.id) fail("Pick a different table");
    if (isBilled(from)) fail("Bill already generated for this order - it can no longer be moved or merged");
    const problem = destinationProblem(from, to);
    if (problem) fail(problem);
    const offset = (await OrderDetails.max("kotNumber", { where: { orderId: to.id, hotel_id: c.hotelId }, transaction: c.t })) || 0;
    const moving = await OrderDetails.findAll({ where: { orderId: from.id, hotel_id: c.hotelId }, transaction: c.t });
    for (const l of moving) {
        await l.update({ orderId: to.id, TableId: to.TableId, UserId: to.UserId, kotNumber: l.kotNumber ? l.kotNumber + offset : null }, { transaction: c.t });
    }
    await to.update({ guests: (to.guests || 0) + (from.guests || 0) }, { transaction: c.t });
    await from.update({ deleted: true }, { transaction: c.t });
    await setTableStatus(c, from.TableId, "F", "moved");
    await setTableStatus(c, to.TableId, "R");
    await recomputeOrderTotals(to.id, c.hotelId, { transaction: c.t });
    const [a, b] = await Promise.all([Table.findByPk(from.TableId, { transaction: c.t }), Table.findByPk(to.TableId, { transaction: c.t })]);
    await event(c, to.id, `Merged ${a?.table_name} (bill ${from.bill_no}) into ${b?.table_name}`, "update_order");
    await event(c, from.id, `Merged into ${b?.table_name} (bill ${to.bill_no})`, "update_order");
    await audit(c, "Tables", `Merged ${a?.table_name} into ${b?.table_name}`);
}

/** Move one KOT round to another table: joins its order, or starts a new one there (exe moveKot). */
async function moveKot(c, orderId, kotNo, toTableId) {
    needSpecial(c, "tables.mergeTransfer");
    const o = await findOrder(c, orderId);
    if (!isOpen(o)) fail("This order is closed");
    if (isBilled(o)) fail("Bill already generated for this order - its KOT rounds can no longer be moved");
    // Only what is still with the kitchen moves (exe: status "kot"); served food stays.
    const lines = await OrderDetails.findAll({ where: { orderId: o.id, hotel_id: c.hotelId, kotNumber: Number(kotNo), status: "kot" }, transaction: c.t });
    if (!lines.length) fail("KOT not found");
    const to = await findTable(c, toTableId);
    if (to.id === o.TableId) fail("Pick a different table");
    let target = await openOrderOnTable(c, to.id);
    const problem = destinationProblem(o, target);
    if (problem) fail(problem);
    if (!target) target = await createOrder(c, { type: "dinin", tableId: to.id, guests: 1, menuId: o.menu_catalog_id }, "in-progress");
    const newKot = ((await OrderDetails.max("kotNumber", { where: { orderId: target.id, hotel_id: c.hotelId }, transaction: c.t })) || 0) + 1;
    for (const l of lines) await l.update({ orderId: target.id, TableId: to.id, UserId: target.UserId, kotNumber: newKot }, { transaction: c.t });
    await setTableStatus(c, to.id, "R");
    await recomputeOrderTotals(o.id, c.hotelId, { transaction: c.t });
    await recomputeOrderTotals(target.id, c.hotelId, { transaction: c.t });
    await event(c, o.id, `KOT #${kotNo} moved to ${to.table_name}`, "update_order");
    await event(c, target.id, `KOT #${newKot} moved in from another table`, "update_order");
    // Nothing left on the old order: it goes away and the table frees up.
    const left = await OrderDetails.count({ where: { orderId: o.id, hotel_id: c.hotelId }, transaction: c.t });
    if (!left) {
        await o.update({ deleted: true }, { transaction: c.t });
        await setTableStatus(c, o.TableId, "F", "moved");
    }
    await audit(c, "Tables", `Moved KOT #${kotNo} to ${to.table_name}`);
}

/* ------------------------------ discount / promo / service ------------------------------ */

async function setDiscount(c, orderId, d) {
    need(c, "biller", "edit");
    const o = await findOrder(c, orderId);
    if (!isOpen(o)) fail("This bill is closed");
    if (d) {
        const value = Number(d.value);
        if (!(value > 0)) fail("Enter a discount");
        if (d.type === "pr" && value > 100) fail("A discount cannot be above 100%");
        if (d.type === "fix" && value > Number(o.totalAmount)) fail("A discount cannot be more than the bill");
        if (!String(d.reason || "").trim()) fail("Add a reason for the discount");
        await recomputeOrderTotals(o.id, c.hotelId, { transaction: c.t, discount: { type: d.type === "pr" ? "pr" : "fix", value }, discountReason: String(d.reason).trim() });
        await event(c, o.id, `Discount ${d.type === "pr" ? `${value}%` : `₹${value}`} — ${String(d.reason).trim()}`, "update_order");
    } else {
        await recomputeOrderTotals(o.id, c.hotelId, { transaction: c.t, discount: { type: "fix", value: 0 }, discountReason: "" });
        await event(c, o.id, "Discount removed", "update_order");
    }
    await audit(c, "Billing", `Discount on bill ${o.bill_no}: ${d ? `${d.value}${d.type === "pr" ? "%" : " flat"}` : "removed"}`);
}

/** A promo code is the order's one discount, carrying the code (Web POS rule). */
async function applyPromo(c, orderId, code) {
    need(c, "biller", "edit");
    if (!code) return setDiscount(c, orderId, null);
    const { PromoCode } = require("../model");
    const o = await findOrder(c, orderId);
    if (!isOpen(o)) fail("This bill is closed");
    const p = await PromoCode.findOne({ where: { hotel_id: c.hotelId, promo_code: String(code).trim().toUpperCase(), status: true }, transaction: c.t });
    if (!p) fail("This promo code is not valid");
    const type = p.discount_type === "pr" || p.discount_type === "percent" || p.discount_type === "percentage" ? "pr" : "fix";
    if (type === "fix" && Number(p.discount_value) > Number(o.totalAmount)) fail(`${p.promo_code} is more than the bill`);
    await recomputeOrderTotals(o.id, c.hotelId, { transaction: c.t, discount: { type, value: Number(p.discount_value) }, discountReason: `Promo ${p.promo_code}` });
    await event(c, o.id, `Promo ${p.promo_code} applied`, "update_order");
}

async function setServiceCharge(c, orderId, amount) {
    need(c, "biller", "edit");
    const o = await findOrder(c, orderId);
    if (!isOpen(o)) fail("This bill is closed");
    if (amount !== null && !(Number(amount) >= 0)) fail("Enter a valid amount");
    await recomputeOrderTotals(o.id, c.hotelId, { transaction: c.t, serviceOverride: amount === null ? null : Number(amount) });
    await event(c, o.id, amount === null ? "Service charge removed" : `Service charge ₹${amount}`);
}

/* ------------------------------ settle ------------------------------ */

/** Cash into / out of the open drawer - best effort like the exe (helpers/cashDrawer.js): no open session = nowhere to record. */
async function recordCash(c, amount, reason, type = "Settlement") {
    if (!(Number(amount) > 0)) return;
    const session = await CashSession.findOne({ where: { hotel_id: c.hotelId, status: "Open", deleted: false }, order: [["opened_at", "DESC"], ["id", "DESC"]], transaction: c.t });
    if (!session) return;
    // Signed like every exe movement (model/cashMovement.js): the drawer's
    // expected cash is the plain SUM, so money out is negative.
    const signed = type === "Withdraw" || type === "Expense" ? -r2(amount) : r2(amount);
    await CashMovement.create({ cashSessionId: session.id, hotelUserId: c.userId, type, amount: signed, reason: String(reason).slice(0, 250), at: new Date() }, { transaction: c.t });
}

const BUILT_IN = ["cash", "upi", "card", "due"];

async function paymentModes(c) {
    const modes = await PaymentMode.findAll({ where: { hotel_id: c.hotelId }, raw: true, transaction: c.t });
    return modes;
}

/**
 * Settle. Split rules (owner decision): only cash may exceed the bill (the
 * rest is change); non-cash can never exceed it; Due needs the customer's
 * name + 10-digit mobile. Custom modes go to other_payments by name.
 * modeId: "cash" | "upi" | "card" | "due" | "pm-<paymentModeId>".
 */
async function settle(c, orderId, input) {
    need(c, "biller", "edit");
    const o = await findOrder(c, orderId);
    if (o.payment === "success") fail(`Bill ${o.bill_no} is already settled`);
    if (!isOpen(o)) fail("This order is closed");
    // Held items are settled like a bill without a KOT (Web POS).
    await billUnsent(c, o);
    const totals = await recomputeOrderTotals(o.id, c.hotelId, { transaction: c.t });
    const grand = totals.grandAmount;
    if (!(grand > 0) && !(await OrderDetails.count({ where: { orderId: o.id, hotel_id: c.hotelId }, transaction: c.t }))) fail("Nothing to bill yet");
    const rows = (input.payments || []).filter((p) => Number(p.amount) > 0).map((p) => ({ modeId: String(p.modeId), amount: r2(p.amount) }));
    if (!rows.length) fail("Add a payment");
    const cash = r2(rows.filter((p) => p.modeId === "cash").reduce((a, p) => a + p.amount, 0));
    const nonCash = r2(rows.filter((p) => p.modeId !== "cash").reduce((a, p) => a + p.amount, 0));
    if (nonCash > grand) fail("Non-cash payments cannot be more than the bill");
    if (r2(cash + nonCash) < grand) fail("Payments are short of the bill");
    const modes = await paymentModes(c);
    const byId = (id) => modes.find((m) => `pm-${m.id}` === id || String(m.name).toLowerCase() === id);
    const other = [];
    const cols = { cash: 0, upi: 0, card: 0, due: 0 };
    for (const p of rows) {
        const mode = byId(p.modeId);
        if (mode && isOff(mode.active)) fail(`${mode.name} is switched off`);
        if (BUILT_IN.includes(p.modeId)) cols[p.modeId] = r2(cols[p.modeId] + p.amount);
        else {
            if (!mode) fail("That payment mode is not set up for this outlet");
            other.push({ name: mode.name, amount: p.amount });
        }
    }
    const change = r2(cash + nonCash - grand);
    cols.cash = r2(cols.cash - Math.max(0, change));
    const name = String(input.customerName || "").trim();
    const mobile = String(input.customerMobile || "").trim();
    if (cols.due > 0) {
        const user = await User.findOne({ where: { id: o.UserId }, transaction: c.t });
        const haveName = name || user?.name;
        const haveMobile = mobile || user?.number;
        if (!haveName || !/^\d{10}$/.test(String(haveMobile || ""))) fail("Due needs the customer's name and 10-digit mobile");
    }
    if (name || mobile) await attachCustomer(c, o, name, mobile);
    const kinds = Object.entries(cols).filter(([, v]) => v > 0).map(([k]) => k).concat(other.map((x) => x.name));
    await o.update({
        ...cols,
        other_payments: other.length ? JSON.stringify(other) : null,
        other_amount: r2(other.reduce((a, x) => a + x.amount, 0)),
        payment: "success",
        status: "success",
        ...(o.billed_at ? {} : { billed_at: new Date() }),
    }, { transaction: c.t });
    await OrderDetails.update({ payment_status: "success" }, { where: { orderId: o.id, hotel_id: c.hotelId }, transaction: c.t });
    await setTableStatus(c, o.TableId, "F");
    await recordCash(c, cols.cash, `Bill ${o.bill_no}`);
    const modeNames = kinds.map((k) => (BUILT_IN.includes(k) ? k.toUpperCase() === "UPI" ? "UPI" : k[0].toUpperCase() + k.slice(1) : k)).join(" + ");
    await event(c, o.id, `Settled ₹${grand.toFixed(2)} · ${modeNames}${change > 0 ? ` · change ₹${change.toFixed(2)}` : ""}`, "settle");
    await audit(c, "Billing", `Settled bill ${o.bill_no}`);
    // Stock at settle (owner rule); pickup lines already deducted at creation
    // are skipped line by line. Stock may go negative, never blocks a sale.
    await deductStockForOrder(o.id, c.hotelId, c.t, c.userId);
    return { change: change > 0 ? change : 0, billNo: o.bill_no };
}

/** Counter billing: create + fire in one step. Dine-in must be given a table (Web POS rule). */
async function counterOrder(c, input) {
    need(c, "biller", "create");
    if (input.type === "dinin" && !input.tableId) fail("Pick a table for a dine-in order");
    if (input.customerMobile && !/^\d{10}$/.test(input.customerMobile)) fail("Enter a 10-digit mobile number");
    return sendKot(c, { ...input, guests: 1 });
}

/**
 * Payment rows -> the order's columns (cash/upi/card/due + the outlet's own
 * modes by name in other_payments). `had` = modes the bill already used:
 * those stay allowed even if switched off since.
 */
async function paymentColumns(c, rows, had = new Set()) {
    const modes = await paymentModes(c);
    const byId = (id) => modes.find((m) => `pm-${m.id}` === id || String(m.name).toLowerCase() === id);
    const cols = { cash: 0, upi: 0, card: 0, due: 0 };
    const other = [];
    for (const p of rows) {
        const mode = byId(p.modeId);
        if (mode && isOff(mode.active) && !had.has(p.modeId)) fail(`${mode.name} is switched off`);
        if (BUILT_IN.includes(p.modeId)) cols[p.modeId] = r2(cols[p.modeId] + p.amount);
        else {
            if (!mode) fail("That payment mode is not set up for this outlet");
            const same = other.find((x) => x.name === mode.name);
            if (same) same.amount = r2(same.amount + p.amount);
            else other.push({ name: mode.name, amount: p.amount });
        }
    }
    return { cols, other };
}

/**
 * Edit a settled bill (owner bug list 2026-09-26 item 11; Web POS / exe
 * controller/editSettledOrder.js). Lines change in place - the table is not
 * occupied again - and the payment is given again for the whole new bill.
 * Cash differences go in/out of the open drawer (signed, unlike the exe's
 * positive Withdraw); a lower bill's difference is handed back now or kept
 * as a refund owed (due < 0, as on the exe). Stock is re-deducted.
 */
async function editSettled(c, orderId, edit = {}) {
    needSpecial(c, "orders.reopenSettled");
    const o = await findOrder(c, orderId);
    if (o.deleted || o.payment !== "success") fail("Only a settled bill can be edited");
    const rows = await OrderDetails.findAll({ where: { orderId: o.id, hotel_id: c.hotelId }, include: [{ model: Menu, attributes: ["item_name"] }], transaction: c.t });
    const byId = new Map(rows.map((r) => [String(r.id), r]));
    const qtyOf = new Map();
    for (const e of edit.lines || []) {
        const row = byId.get(String(e.lineId));
        if (!row) fail("An item on this bill was not found");
        const name = row.hms_menu_mst?.item_name || "Item";
        const q = Number(e.qty);
        if (!(q >= 0)) fail(`${name}: quantity cannot be negative`);
        if (Math.round(q * 100) !== q * 100) fail(`${name}: quantity can have at most 2 decimals`);
        qtyOf.set(String(e.lineId), r2(q));
    }
    const added = Array.isArray(edit.added) ? edit.added : [];
    if (added.length) await checkLines(c, added);
    const qtyNow = (r) => (qtyOf.has(String(r.id)) ? qtyOf.get(String(r.id)) : Number(r.qty));
    if (!rows.some((r) => qtyNow(r) > 0) && !added.length) fail("A bill needs at least one item");

    const oldGrand = r2(o.grandAmount);
    const oldCash = r2(o.cash);
    const had = new Set(["cash", "upi", "card", "due"].filter((k) => Number(o[k]) > 0));
    const modes = await paymentModes(c);
    for (const p of parseJson(o.other_payments, []) || []) {
        const m = modes.find((x) => String(x.name).trim().toLowerCase() === String(p.name || "").trim().toLowerCase());
        if (m) had.add(`pm-${m.id}`);
    }

    // Stock: everything the old bill took goes back; the new bill is deducted below.
    await reverseAllOrderStock(o.id, c.hotelId, c.t, `Bill ${o.bill_no} edited`);
    for (const r of rows) {
        const q = qtyNow(r);
        if (q <= 0) await r.destroy({ transaction: c.t });
        else if (q !== Number(r.qty)) await r.update({ qty: q }, { transaction: c.t });
    }
    if (added.length) {
        // Added on the bill, never cooked from a KOT: a round shown on no KDS.
        const kotNo = ((await OrderDetails.max("kotNumber", { where: { orderId: o.id, hotel_id: c.hotelId }, transaction: c.t })) || 0) + 1;
        const made = await buildRows(c, o, added, { kotNumber: kotNo, kdsHidden: true });
        await OrderDetails.update({ status: "delivered", ready: true, kds_state: "ready", payment_status: "success" }, { where: { id: made.map((m) => m.id) }, transaction: c.t });
    }

    // One discount per bill, checked against the new subtotal.
    const d = edit.discount && Number(edit.discount.value) > 0 ? edit.discount : null;
    const plain = await recomputeOrderTotals(o.id, c.hotelId, { transaction: c.t, discount: { type: "fix", value: 0 }, discountReason: "" });
    let totals = plain;
    if (d) {
        const value = Number(d.value);
        if (d.type === "pr" && value > 100) fail("A discount cannot be above 100%");
        if (d.type !== "pr" && value > plain.subtotal) fail("A discount cannot be more than the bill");
        if (!String(d.reason || "").trim()) fail("Add a reason for the discount");
        totals = await recomputeOrderTotals(o.id, c.hotelId, { transaction: c.t, discount: { type: d.type === "pr" ? "pr" : "fix", value }, discountReason: String(d.reason).trim() });
    }
    const grand = r2(totals.grandAmount);

    const pays = (edit.payments || []).filter((p) => Number(p.amount) > 0).map((p) => ({ modeId: String(p.modeId), amount: r2(p.amount) }));
    const { cols, other } = await paymentColumns(c, pays, had);
    const refundLater = r2(Math.max(0, Number(edit.refundLater) || 0));
    const paid = r2(pays.reduce((a, p) => a + p.amount, 0));
    if (refundLater > 0 && cols.due > 0) fail("A bill cannot be both due and owed a refund");
    if (Math.abs(paid - refundLater - grand) > 0.009) {
        fail(`The edited bill totals ₹${grand.toFixed(2)}, but the payments add up to ₹${r2(paid - refundLater).toFixed(2)}. Please adjust the payment.`);
    }
    const name = String(edit.customerName || "").trim();
    const mobile = String(edit.customerMobile || "").trim();
    if (cols.due > 0) {
        const user = await User.findOne({ where: { id: o.UserId }, transaction: c.t });
        const haveName = name || (!user?.isPlaceholder && user?.name);
        const haveMobile = mobile || (!user?.isPlaceholder && user?.number);
        if (!haveName || !/^\d{10}$/.test(String(haveMobile || ""))) fail("Due needs the customer's name and 10-digit mobile");
    }
    if (name || mobile) await attachCustomer(c, o, name, mobile);

    await o.update({
        ...cols,
        due: cols.due > 0 ? cols.due : refundLater > 0 ? -refundLater : 0,
        other_payments: other.length ? JSON.stringify(other) : null,
        other_amount: r2(other.reduce((a, x) => a + x.amount, 0)),
    }, { transaction: c.t });
    await OrderDetails.update({ payment_status: "success" }, { where: { orderId: o.id, hotel_id: c.hotelId }, transaction: c.t });
    await deductStockForOrder(o.id, c.hotelId, c.t, c.userId);

    const cashDelta = r2(cols.cash - oldCash);
    if (cashDelta > 0) await recordCash(c, cashDelta, `Edited bill ${o.bill_no}`);
    if (cashDelta < 0) await recordCash(c, -cashDelta, `Refund · edited bill ${o.bill_no}`, "Withdraw");
    const modeLabel = (k) => (k === "upi" ? "UPI" : k[0].toUpperCase() + k.slice(1));
    const paidText = [
        ...Object.entries(cols).filter(([, v]) => v > 0).map(([k, v]) => `${modeLabel(k)} ₹${v.toFixed(2)}`),
        ...other.map((x) => `${x.name} ₹${x.amount.toFixed(2)}`),
    ].join(" + ");
    await event(c, o.id, `Settled bill edited · ₹${oldGrand.toFixed(2)} → ₹${grand.toFixed(2)} · ${paidText}${refundLater > 0 ? ` · refund owed ₹${refundLater.toFixed(2)}` : ""}`, "update_order");
    await audit(c, "Billing", `Edited settled bill ${o.bill_no}`);
    return { grand, due: cols.due, refundOwed: refundLater, cashIn: cashDelta > 0 ? cashDelta : 0, cashOut: cashDelta < 0 ? -cashDelta : 0 };
}

/** Hand back a refund owed. Cash comes out of the open drawer; the bill's payments drop by it. */
async function settleRefund(c, orderId, modeId) {
    need(c, "ops-ledger", "edit");
    const o = await findOrder(c, orderId);
    const amount = r2(-(Number(o.due) || 0));
    if (o.deleted || !(amount > 0)) fail("This bill has no refund owed");
    if (!modeId || modeId === "due") fail("Pick how the money was handed back");
    const modes = await paymentModes(c);
    const custom = BUILT_IN.includes(modeId) ? null : modes.find((m) => `pm-${m.id}` === modeId);
    const builtIn = BUILT_IN.includes(modeId) ? modes.find((m) => String(m.name).toLowerCase() === modeId) : null;
    if ((!BUILT_IN.includes(modeId) && !custom) || (custom && isOff(custom.active)) || (builtIn && isOff(builtIn.active))) fail("Pick how the money was handed back");
    // The refund leaves the bill's own payments: the mode it went back by first.
    const cols = { cash: r2(o.cash), upi: r2(o.upi), card: r2(o.card) };
    const other = parseJson(o.other_payments, []) || [];
    const slots = [
        ...Object.keys(cols).map((k) => ({ id: k, get: () => cols[k], set: (v) => { cols[k] = v; } })),
        ...other.map((p) => ({ id: `name:${String(p.name).trim().toLowerCase()}`, get: () => r2(p.amount), set: (v) => { p.amount = v; } })),
    ];
    const first = custom ? `name:${String(custom.name).trim().toLowerCase()}` : modeId;
    const ordered = [...slots.filter((s) => s.id === first), ...slots.filter((s) => s.id !== first).reverse()];
    let left = amount;
    for (const s of ordered) {
        if (left <= 0) break;
        const cut = Math.min(s.get(), left);
        s.set(r2(s.get() - cut));
        left = r2(left - cut);
    }
    const kept = other.filter((p) => Number(p.amount) > 0);
    await o.update({ ...cols, due: 0, other_payments: kept.length ? JSON.stringify(kept) : null, other_amount: r2(kept.reduce((a, p) => a + Number(p.amount), 0)) }, { transaction: c.t });
    if (modeId === "cash") await recordCash(c, amount, `Refund · bill ${o.bill_no}`, "Withdraw");
    await event(c, o.id, `Refund ₹${amount.toFixed(2)} handed back (${custom ? custom.name : modeId === "upi" ? "UPI" : modeId[0].toUpperCase() + modeId.slice(1)})`, "update_order");
    await audit(c, "Billing", `Refunded ₹${amount} on bill ${o.bill_no}`);
}

/**
 * E-bill on WhatsApp through the existing cloud sender (template, credits).
 * NOT inside mutate(): it calls WhatsApp, which must not hold the outlet lock.
 */
async function sendEbill(c, orderId, mobile) {
    need(c, "biller", "edit");
    if (!/^\d{10}$/.test(String(mobile || ""))) fail("Enter a 10-digit mobile number");
    const o = await findOrder(c, orderId);
    const { callController } = require("./legacy");
    const { sentEbill } = require("../controller/kto");
    await callController(sentEbill, c, { body: { orderId: o.id, mobile: String(mobile) } });
    await event(c, o.id, `E-bill sent to ${mobile}`, "update_order");
}

async function markPickupReady(c, orderId, ready) {
    need(c, "biller", "edit");
    const o = await findOrder(c, orderId);
    await o.update({ token_ready_at: ready ? new Date() : null }, { transaction: c.t });
}

async function logReprint(c, orderId, what) {
    const o = await findOrder(c, orderId);
    if (/bill/i.test(what)) await o.increment("billPrintCount", { transaction: c.t });
    await event(c, o.id, `${what} reprinted`, "update_order");
}

/* ------------------------------ kitchen ------------------------------ */

const RANK = { sent: 0, preparing: 1, ready: 2, served: 3 };
const lineState = (l) => (l.status === "delivered" ? "served" : l.kds_state || (l.ready ? "ready" : "sent"));

async function kitchenLines(c, o, kotNo, kitchenId) {
    const [kitchens, lines] = await Promise.all([
        KitchenSetting.findAll({ where: { hotel_id: c.hotelId }, raw: true, transaction: c.t }),
        OrderDetails.findAll({ where: { orderId: o.id, hotel_id: c.hotelId, kotNumber: Number(kotNo), status: { [Op.in]: ["kot", "delivered"] }, kds_hidden: false }, include: [{ model: Menu, attributes: ["id", "menu_categ_id", "item_name"] }], transaction: c.t }),
    ]);
    for (const l of lines) l.menu_categ_id = l.hms_menu_mst?.menu_categ_id;
    const routed = routeItemsToKitchens(kitchens, lines, o.order_type, o.TableId);
    return routed.find((r) => String(r.kitchen.id) === String(kitchenId))?.items ?? [];
}

/**
 * KDS: New -> Preparing -> Ready -> Served (bumped off). Tapping a card
 * moves every line of that kitchen with its slowest line. Ready alerts the
 * captain who sent it (dine-in) / marks the token ready (pickup).
 */
async function kdsAdvance(c, orderId, kotNo, kitchenId, lineId) {
    need(c, "kds", "edit");
    const o = await findOrder(c, orderId);
    const mine = await kitchenLines(c, o, kotNo, kitchenId);
    if (!mine.length) fail("Nothing for this kitchen");
    const wasReady = mine.every((l) => RANK[lineState(l)] >= 2);
    const NEXT = { sent: "preparing", preparing: "ready", ready: "served", served: "served" };
    const setState = (l, s) => l.update(s === "served" ? { status: "delivered", ready: true, kds_state: "ready" } : { kds_state: s, ready: s === "ready" }, { transaction: c.t });
    if (lineId) {
        const l = mine.find((x) => String(x.id) === String(lineId));
        if (!l) fail("Item not found");
        await setState(l, NEXT[lineState(l)]);
    } else {
        const slowest = Math.min(...mine.map((l) => RANK[lineState(l)]));
        const to = NEXT[Object.keys(RANK).find((k) => RANK[k] === slowest)];
        for (const l of mine) if (RANK[lineState(l)] < RANK[to]) await setState(l, to);
    }
    const nowReady = mine.every((l) => RANK[lineState(l)] >= 2);
    if (nowReady && !wasReady) {
        const kitchen = await KitchenSetting.findOne({ where: { id: Number(kitchenId) || 0 }, attributes: ["kitchen_name"], transaction: c.t });
        const table = o.TableId ? await Table.findOne({ where: { id: o.TableId }, attributes: ["table_name"], transaction: c.t }) : null;
        if (o.order_type === "pickup") await o.update({ token_ready_at: new Date() }, { transaction: c.t });
        await alert(c, {
            kind: "food-ready",
            title: `Food ready · ${table?.table_name ?? `Token ${o.token}`}`,
            body: `KOT #${kotNo} · ${kitchen?.kitchen_name ?? "Kitchen"} · ${mine.slice(0, 3).map((l) => `${l.qty}× ${l.hms_menu_mst?.item_name ?? ""}`).join(", ")}${mine.length > 3 ? "…" : ""}`,
            link: `/order/${o.TableId ? `t.${o.TableId}` : `o.${o.id}`}`,
            forUserId: mine[0].firedBy || o.hotelUserId,
        });
    }
}

async function kdsRecall(c, orderId, kotNo, kitchenId) {
    need(c, "kds", "edit");
    const o = await findOrder(c, orderId);
    for (const l of await kitchenLines(c, o, kotNo, kitchenId)) {
        if (l.status === "delivered") await l.update({ status: "kot", kds_state: "ready", ready: true }, { transaction: c.t });
    }
}

/* ------------------------------ QR rounds ------------------------------ */

const MAX_REASON = 120;

/**
 * Staff accept / reject a customer's QR round item by item (owner rule,
 * 2026-09-24; exe controller/qrOrder.js#acceptQrOrderCore). Rejected items
 * never reach the order, KOT or bill, and carry the reason the customer is
 * shown. Accepted items are priced from the LIVE menu (never the price the
 * phone saw) and sent as a KOT on the table's order.
 */
async function decideQr(c, qrId, decisions) {
    need(c, "biller", "create");
    const qr = await QrOrder.findOne({ where: { id: Number(qrId) || 0, hotel_id: c.hotelId }, transaction: c.t });
    if (!qr) fail("This QR order is gone");
    if (qr.status !== "pending") fail("This QR order was already handled");
    const items = parseJson(qr.items, []) || [];
    const list = items.map((item, i) => {
        const d = (decisions || []).find((x) => String(x.key) === String(i));
        if (!d) fail(`Accept or reject ${item.itemName || "every item"}`);
        if (d.accept) return { accepted: true };
        const reason = String(d.reason ?? "").trim().slice(0, MAX_REASON);
        if (!reason) fail(`Pick a reason for rejecting ${item.itemName || "an item"} - the customer sees it`);
        return { accepted: false, reason };
    });
    const decided = items.map((item, i) => ({ ...item, decision: list[i].accepted ? "accepted" : "rejected", ...(list[i].accepted ? {} : { rejectReason: list[i].reason }) }));
    const table = await Table.findOne({ where: { id: qr.table_id, hotel_id: c.hotelId, active: true }, transaction: c.t });
    if (!list.some((d) => d.accepted)) {
        await qr.update({ status: "rejected", items: decided }, { transaction: c.t });
        await audit(c, "QR orders", `Rejected a QR order on ${table?.table_name ?? "a table"}`);
        return {};
    }
    if (!table) fail("This table is no longer available");
    const existing = await openOrderOnTable(c, table.id);
    if (existing && isBilled(existing)) fail("The bill for this table is printed - the customer can no longer add items");
    if (existing && isHeldStatus(existing)) fail("This table's order is on hold. Send or clear the held items first.");

    const lines = [];
    for (const [i, item] of items.entries()) {
        if (!list[i].accepted) continue;
        const menu = await Menu.findOne({ where: { id: Number(item.menuId) || 0, hotel_id: c.hotelId }, transaction: c.t });
        if (!menu || !menu.active || menu.is_deleted) fail(`"${item.itemName || "An item"}" is no longer available - reject it (e.g. "Out of stock") and accept the rest.`);
        if (menu.out_of_stock) fail(`"${menu.item_name}" is out of stock - reject it and accept the rest.`);
        let price = Number(menu.price) || 0;
        let variantId;
        let variantName;
        if (item.variantId != null) {
            const mv = await MenuVariants.findOne({ where: { menu_id: menu.id, variant_id: item.variantId }, transaction: c.t });
            const v = mv ? await Variants.findOne({ where: { id: item.variantId, hotel_id: c.hotelId, active: true }, transaction: c.t }) : null;
            if (!mv || !v) fail(`The option chosen for "${menu.item_name}" is no longer available - reject it and accept the rest.`);
            price = Number(mv.variant_price) || 0;
            variantId = String(v.id);
            variantName = v.variants_name;
        }
        const addons = [];
        const addonIds = Array.isArray(item.addonIds) ? item.addonIds : [];
        if (addonIds.length) {
            const rows = await Addons.findAll({ where: { id: addonIds, hotel_id: c.hotelId }, transaction: c.t });
            if (rows.length !== addonIds.length) fail(`An add-on for "${menu.item_name}" is no longer available - reject it and accept the rest.`);
            const depts = await AddonDepartment.findAll({ where: { id: [...new Set(rows.map((a) => a.department_id).filter(Boolean))] }, transaction: c.t });
            for (const a of rows) {
                addons.push({ id: String(a.id), groupId: String(a.department_id ?? 0), groupName: depts.find((d) => d.id === a.department_id)?.department_name || "", name: a.addon_name, price: Number(a.price) || 0, qty: 1 });
            }
        }
        lines.push({ key: String(i), itemId: String(menu.id), name: menu.item_name, price, qty: Number(item.qty) || 1, variantId, variantName, addons, note: item.comment || "", custom: false });
    }

    // A real customer already on the table's order is never replaced.
    const orderUser = existing ? await User.findOne({ where: { id: existing.UserId }, transaction: c.t }) : null;
    const keepCustomer = orderUser && !orderUser.isPlaceholder && orderUser.number;
    const r = await sendKot(c, {
        orderId: existing ? existing.id : undefined,
        type: "dinin",
        tableId: table.id,
        guests: existing ? existing.guests : 1,
        customerName: keepCustomer ? undefined : qr.customer_name || undefined,
        customerMobile: keepCustomer ? undefined : qr.customer_mobile || undefined,
        menuId: existing?.menu_catalog_id ?? undefined,
        fromQr: true,
        lines,
    });
    await qr.update({ status: "accepted", items: decided }, { transaction: c.t });
    await audit(c, "QR orders", `Accepted ${lines.length} of ${items.length} QR items on ${table.table_name}`);
    return { orderId: r.orderId, kot: r.kot };
}

module.exports = {
    sendKot, holdOrder, setGuests, setCustomer, removeLine, markServed, printBill, requestBill, cancelOrder,
    transferTable, mergeTables, moveKot, setDiscount, applyPromo, setServiceCharge, settle, counterOrder,
    editSettled, settleRefund, sendEbill, markPickupReady, logReprint, kdsAdvance, kdsRecall, decideQr, billCart,
    // shared with domains
    createOrder, recordCash, event, alert, attachCustomer, findOrder, openOrderOnTable, clockOf, lineState, dietaryText, addonsJson,
};
