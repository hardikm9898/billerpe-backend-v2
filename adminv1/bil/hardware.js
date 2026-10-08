const { Op } = require("sequelize");
const { sequelize, PurchaseRollsAndPrinter, BilInvoice, BilInvoiceLine, BilPayment, AdmSetting, CsAccountOutlet, Hotel } = require("../../model");
const PhonePayPaymentLink = require("../../model/paymentLink");
const WebSiteProducts = require("../../model/webSiteProducts");
const { RuleError } = require("../../appv1/core");
const worker = require("../../services/admin/worker");
const { need } = require("../auth");
const audit = require("../audit");
const invoices = require("./invoices");
const { hardwarePrice } = require("./catalog");
const { GSTIN_RE, supplyState, totals, nextNumber, seller, money, moment, TZ, txt, json } = require("./common");

// Hardware orders (printers, paper rolls): the website shop's orders (paid by
// PhonePe on the website) and orders staff take for a customer. Prices come
// from the website's product list, never from the browser. Every paid order
// gets a GST invoice in the panel's invoice book (owner 2026-10-08): website
// orders paid from the day this runs get one by themselves (job), staff
// orders get theirs when they are made.

const live = () => process.env.ADMIN_WA_LIVE === "1" || process.env.ADMIN_MAIL_LIVE === "1";

function view(o, inv) {
    const items = Array.isArray(o.items) ? o.items : (() => {
        try {
            return JSON.parse(o.items || "[]");
        } catch {
            return [];
        }
    })();
    return {
        id: o.id,
        name: o.name,
        mobile: String(o.mobile || ""),
        email: o.email || "",
        address: [o.address1, o.address2, o.city, o.state, o.pincode].filter(Boolean).join(", "),
        items: items.map((i) => ({ id: i.id, title: i.title, quantity: Number(i.quantity), price: Number(i.price) })),
        subtotal: Number(o.subtotal),
        gst: Number(o.gst),
        total: Number(o.grandAmount),
        payment: o.payment_status,
        approval: o.order_approval_status,
        status: o.order_status,
        tracking: o.order_tracking_id || "",
        rejectReason: o.reject_reason || "",
        createdAt: o.createdAt,
        invoice: inv ? { id: inv.id, number: inv.number, status: inv.status } : null,
    };
}

const VIEWS = ["new", "unpaid", "shipped", "delivered", "rejected", "all"];
function viewWhere(v) {
    switch (v) {
        case "new":
            return { payment_status: "completed", order_status: "pending", order_approval_status: { [Op.ne]: "rejected" } };
        case "unpaid":
            return { payment_status: "pending", order_approval_status: { [Op.ne]: "rejected" } };
        case "shipped":
            return { order_status: "shipped" };
        case "delivered":
            return { order_status: "delivered" };
        case "rejected":
            return { order_approval_status: "rejected" };
        default:
            return {};
    }
}

async function list(s, query = {}) {
    need(s, "billing.view");
    const v = VIEWS.includes(query.view) ? query.view : "new";
    const where = { ...viewWhere(v) };
    const q = txt(query.q, 60);
    if (q) where[Op.or] = [{ name: { [Op.like]: `%${q}%` } }, ...(/^\d+$/.test(q) ? [{ id: Number(q) }, sequelize.where(sequelize.cast(sequelize.col("mobile"), "CHAR"), { [Op.like]: `%${q}%` })] : [])];
    const rows = await PurchaseRollsAndPrinter.findAll({ where, order: [["id", "DESC"]], limit: 100 });
    const invs = new Map((rows.length ? await BilInvoice.findAll({ where: { hardware_order_id: rows.map((r) => r.id) }, raw: true }) : []).map((i) => [i.hardware_order_id, i]));
    const counts = {};
    for (const k of VIEWS) counts[k] = await PurchaseRollsAndPrinter.count({ where: viewWhere(k) });
    return { serverTime: new Date().toISOString(), view: v, counts, orders: rows.map((o) => view(o.get({ plain: true }), invs.get(o.id))) };
}

/** Approve / reject, ship (with the tracking number), delivered. */
async function setStatus(s, id, input = {}) {
    need(s, "billing.manage");
    const o = await PurchaseRollsAndPrinter.findByPk(Number(id) || 0);
    if (!o) throw new RuleError("This order does not exist.");
    const before = { approval: o.order_approval_status, status: o.order_status, tracking: o.order_tracking_id };
    if (input.action === "approve") {
        await o.update({ order_approval_status: "approved" });
    } else if (input.action === "reject") {
        const why = txt(input.reason, 200);
        if (why.length < 3) throw new RuleError("Write why it is rejected.");
        await o.update({ order_approval_status: "rejected", reject_reason: why });
    } else if (input.action === "ship") {
        const tracking = txt(input.tracking, 80);
        if (tracking.length < 4) throw new RuleError("Write the courier and tracking number.");
        if (o.payment_status !== "completed") throw new RuleError("The order is not paid yet.");
        await o.update({ order_status: "shipped", order_tracking_id: tracking, order_approval_status: "approved" });
        if (live() && o.email) {
            try {
                require("../../services/sendMail").sendShippedMail(o.email, { ...o.get({ plain: true }), orderId: o.id, order_tracking_id: tracking });
            } catch (e) {
                console.error("[hardware] shipped mail:", e && e.message);
            }
        }
    } else if (input.action === "delivered") {
        if (o.order_status !== "shipped") throw new RuleError("Mark it shipped first.");
        await o.update({ order_status: "delivered" });
    } else throw new RuleError("Unknown action.");
    await audit.write(s, { action: `hardware.${input.action}`, entity: "hms_purchase_roll", entityId: o.id, summary: `Hardware order #${o.id}: ${input.action}`, before, after: { approval: o.order_approval_status, status: o.order_status, tracking: o.order_tracking_id }, reason: txt(input.reason, 300) });
    return { id: o.id };
}

/** Staff take a hardware order for a customer: the order + its invoice (to pay by link or by hand). */
async function create(s, input = {}) {
    need(s, "billing.manage");
    const hotelId = Number(input.hotelId) || null;
    const hotel = hotelId ? await Hotel.findByPk(hotelId) : null;
    if (hotelId && !hotel) throw new RuleError("This outlet does not exist.");
    const name = txt(input.name || (hotel && hotel.owner_name), 100);
    const mobile = String(input.mobile || (hotel && hotel.owner_number) || "").replace(/\D/g, "").slice(-10);
    if (!name || mobile.length !== 10) throw new RuleError("Write the buyer's name and 10-digit mobile.");
    const address1 = txt(input.address || (hotel && hotel.address1), 255);
    const pincode = String(input.pinCode || (hotel && hotel.pinCode) || "").replace(/\D/g, "");
    if (address1.length < 4 || !/^\d{6}$/.test(pincode)) throw new RuleError("Write the delivery address and PIN code.");
    const want = Array.isArray(input.items) ? input.items : [];
    if (!want.length) throw new RuleError("Add at least one item.");
    const items = [];
    for (const w of want) {
        const p = await WebSiteProducts.findByPk(Number(w.productId) || 0, { raw: true });
        const qty = Math.floor(Number(w.qty));
        if (!p || !(qty >= 1 && qty <= 99)) throw new RuleError("An item or its quantity is not right.");
        items.push({ id: p.id, title: p.title, quantity: qty, price: hardwarePrice(p) });
    }
    const subtotal = Math.round(items.reduce((n, i) => n + i.price * i.quantity, 0) * 100) / 100;
    const gst = Math.round(subtotal * 18) / 100;
    const order = await PurchaseRollsAndPrinter.create({ name, mobile, email: txt(input.email, 120) || null, address1, address2: txt(input.address2, 255), city: txt(input.city, 80), state: txt(input.state, 80), Country: "india", pincode, items, subtotal, gst, grandAmount: Math.round((subtotal + gst) * 100) / 100, order_approval_status: "approved" });
    const link = hotelId ? await CsAccountOutlet.findOne({ where: { hotel_id: hotelId }, raw: true }) : null;
    const draft = await invoices.saveDraft(s, { hotelId, accountId: link ? link.account_id : null, lines: items.map((i) => ({ productId: i.id, qty: i.quantity })), bill: { name, mobile, email: txt(input.email, 120), address: [address1, txt(input.city, 80), txt(input.state, 80), pincode].filter(Boolean).join(", "), gstin: txt(input.gstin, 15).toUpperCase() }, note: `Hardware order #${order.id}` });
    await BilInvoice.update({ hardware_order_id: order.id }, { where: { id: draft.id } });
    const issued = await invoices.issue(s, draft.id);
    await audit.write(s, { action: "hardware.create", entity: "hms_purchase_roll", entityId: order.id, summary: `Hardware order #${order.id} for ${name} (${money(order.grandAmount)})` });
    return { orderId: order.id, invoiceId: draft.id, invoiceStatus: issued.status };
}

/**
 * Job: website shop orders paid from the start day on get their GST invoice
 * (paid, PhonePe) by themselves. The start day is the first run, so older
 * orders are left as they were.
 */
async function invoiceWebsiteOrders(now = new Date()) {
    const [from] = await AdmSetting.findOrCreate({ where: { setting_key: "bil_hw_from" }, defaults: { value: now.toISOString() } });
    const since = new Date(from.value);
    const orders = await PurchaseRollsAndPrinter.findAll({ where: { payment_status: "completed", createdAt: { [Op.gte]: since } }, order: [["id", "ASC"]], limit: 50 });
    const sel = await seller();
    let made = 0;
    for (const o of orders) {
        if (await BilInvoice.findOne({ where: { hardware_order_id: o.id }, attributes: ["id"], raw: true })) continue;
        const items = Array.isArray(o.items) ? o.items : JSON.parse(o.items || "[]");
        if (!items.length) continue;
        const lines = items.map((i) => ({ product_id: Number(i.id) || null, kind: "hardware", description: txt(i.title, 200) || "Hardware", sac: "", qty: Number(i.quantity) || 1, unit_price: Number(i.price) || 0, gst_rate: 18, effect: null }));
        const gstin = GSTIN_RE.test(String(o.gstin || "").toUpperCase()) ? String(o.gstin).toUpperCase() : "";
        const supply = supplyState({ gstin, pin: o.pincode }, sel.state);
        const tot = totals(lines, 0, supply === sel.state);
        const plink = await PhonePayPaymentLink.findOne({ where: { printer_roll_id: o.id, state: "COMPLETED" }, raw: true }).catch(() => null);
        await sequelize.transaction(async (t) => {
            const number = await nextNumber("invoice", sel.prefixes.invoice || "BPE", t, now);
            const { amounts, ...money_ } = tot;
            const inv = await BilInvoice.create({
                kind: "invoice", number, status: "paid", hardware_order_id: o.id, bill_name: txt(o.name, 160), bill_gstin: gstin, bill_mobile: String(o.mobile || "").slice(-10), bill_email: txt(o.email, 120),
                bill_address: txt([o.address1, o.address2, o.city, o.state, o.pincode].filter(Boolean).join(", "), 400), supply_state: supply, ...money_, paid: money_.total, issued_at: now, due_at: now, paid_at: now, applied_at: now,
                seller: json({ name: sel.name, gstin: sel.gstin, state: sel.state, stateName: sel.stateName, address: sel.address }), demo: sel.demo, note: `Website shop order #${o.id}`,
            }, { transaction: t });
            await BilInvoiceLine.bulkCreate(lines.map((l, i) => ({ ...l, invoice_id: inv.id, amount: amounts[i], sort: i })), { transaction: t });
            const receipt = await nextNumber("receipt", sel.prefixes.receipt || "BPR", t, now);
            await BilPayment.create({ number: receipt, invoice_id: inv.id, method: "phonepe", amount: money_.total, reference: txt((plink && plink.merchantOrderId) || `website-order-${o.id}`, 80), status: "approved", received_on: moment(o.updatedAt || now).tz(TZ).format("YYYY-MM-DD"), decided_at: now, note: "Website shop (PhonePe)" }, { transaction: t });
            if (Math.abs(money_.total - Number(o.grandAmount)) > 1) console.error(`[hardware] order #${o.id}: invoice ${money_.total} vs paid ${o.grandAmount}`);
        });
        made += 1;
    }
    return `${made} website orders invoiced`;
}

worker.registerJob("bil.hardware", () => invoiceWebsiteOrders());
worker.registerSchedule("bil.hardware", 900);

module.exports = { list, setStatus, create, invoiceWebsiteOrders, view };
