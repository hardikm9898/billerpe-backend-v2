const crypto = require("crypto");
const bcrypt = require("bcrypt");
const { Op } = require("sequelize");
const { sequelize, Hotel, BilItem, InvItem, InvMove, BilInvoice, BilPayment, CsAccount, CsAccountOutlet, CsOutletSetup, AdmUser } = require("../../model");
const { RuleError } = require("../../appv1/core");
const { need } = require("../auth");
const audit = require("../audit");
const { notify, peopleWith } = require("../crm/notify");
const { seedOutlet } = require("../../services/outletSetup");
const accounts = require("./accounts");
const onboarding = require("./onboarding");
const won = require("./won");
const { customerSettings, addActivity, mobile10, txt, json, parse, moment, TZ } = require("./common");

// An outlet is set up once, when it is created (owner 2026-10-09): the
// restaurant's details, the plan from the catalog and for how long, what the
// plan includes (a "with printer" plan gives a printer and rolls), extras
// sold from the office stock, the discount and a token payment of at least
// Rs 500 (no outlet starts at Rs 0). The first invoice is made from that -
// nobody picks the plan again at billing time. A plan longer than a year,
// more than one printer, a discount above the free limit or a free trial
// waits for an approver; the outlet is made when it is approved. The full
// amount is due within 15 days (the freeze after that is the payment rule).

const TOKEN_MIN = 500;
const PAY_DAYS = 15;
const MAX_YEARS_DAYS = 366;
const SOURCES = ["new", "won", "account"];
const PASS_CHARS = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const newPassword = () => Array.from(crypto.randomBytes(8), (b) => PASS_CHARS[b % PASS_CHARS.length]).join("");
const money = (n) => `Rs ${Math.round(Number(n) || 0).toLocaleString("en-IN")}`;

function needFor(s, source) {
    if (source === "won") need(s, "leads.edit");
    else need(s, "customers.manage");
}

/* ------------------------------ the order ------------------------------ */

/** What the outlet form offers: catalog plans (with what they include), stock items, add-ons, the rules. */
async function options(s) {
    if (!["customers.manage", "leads.edit"].some((p) => s.can(p))) need(s, "customers.manage");
    await require("../bil/catalog").ensureCatalog();
    const { includesOf } = require("../bil/catalog");
    const cat = await BilItem.findAll({ where: { active: true, kind: ["plan", "addon"] }, order: [["sort", "ASC"], ["id", "ASC"]], raw: true });
    const items = await InvItem.findAll({ where: { active: true }, order: [["sort", "ASC"], ["name", "ASC"]], raw: true });
    const byId = new Map(items.map((i) => [i.id, i]));
    const cfg = await require("../bil/common").billingSettings();
    const cust = await customerSettings();
    return {
        plans: cat.filter((i) => i.kind === "plan").map((i) => ({
            id: i.id, name: i.name, product: i.product, planName: i.plan_name, days: i.days, devices: i.devices, price: Number(i.price), gstRate: Number(i.gst_rate),
            includes: includesOf(i).map((x) => ({ itemId: x.itemId, qty: x.qty, name: byId.get(x.itemId)?.name || `#${x.itemId}`, category: byId.get(x.itemId)?.category || "other" })),
        })),
        addons: cat.filter((i) => i.kind === "addon").map((i) => ({ id: i.id, name: i.name, product: i.product, devices: i.devices, price: Number(i.price), gstRate: Number(i.gst_rate) })),
        items: items.map((i) => ({ id: i.id, name: i.name, category: i.category, unit: i.unit, price: Number(i.price), gstRate: Number(i.gst_rate), office: i.stock_office })),
        rules: { tokenMin: TOKEN_MIN, payDays: PAY_DAYS, discountFreePct: cfg.discountFreePct, trialDays: cust.trialDays, maxDaysWithoutApproval: MAX_YEARS_DAYS },
        methods: require("../bil/payments").METHODS,
    };
}

/** The order as asked -> checked plan, periods, extras, add-ons, discount; and why it needs an approver. */
async function cleanOrder(order = {}) {
    const { includesOf } = require("../bil/catalog");
    const trial = order.planItemId === "trial";
    let plan = null;
    let qty = 1;
    if (!trial) {
        plan = await BilItem.findOne({ where: { id: Number(order.planItemId) || 0, kind: "plan", active: true }, raw: true });
        if (!plan) throw new RuleError("Choose the plan sold.");
        qty = Number(order.periods ?? 1);
        if (!Number.isInteger(qty) || qty < 1 || qty > 60) throw new RuleError("How many periods of the plan: a whole number from 1.");
    }
    const product = trial ? (order.product === "CLOUD_APP" ? "CLOUD_APP" : "LOCAL_SUITE") : plan.product;
    const extras = [];
    for (const x of Array.isArray(order.extras) ? order.extras : []) {
        const n = Number(x && x.qty);
        if (!n) continue;
        if (!Number.isInteger(n) || n < 1 || n > 100) throw new RuleError("Extra items: a quantity from 1 to 100.");
        const it = await InvItem.findOne({ where: { id: Number(x.itemId) || 0, active: true }, raw: true });
        if (!it) throw new RuleError("An extra item is not in the inventory.");
        if (extras.some((e) => e.item.id === it.id)) throw new RuleError(`${it.name} is listed twice.`);
        extras.push({ item: it, qty: n });
    }
    const addons = [];
    for (const x of Array.isArray(order.addons) ? order.addons : []) {
        const n = Number(x && x.qty);
        if (!n) continue;
        if (!Number.isInteger(n) || n < 1 || n > 100) throw new RuleError("Add-ons: a quantity from 1 to 100.");
        const it = await BilItem.findOne({ where: { id: Number(x.itemId) || 0, kind: "addon", active: true }, raw: true });
        if (!it) throw new RuleError("An add-on is not sold any more.");
        if (it.product && it.product !== product) throw new RuleError(`${it.name} is for the ${it.product === "CLOUD_APP" ? "POS App" : "Local Suite"}.`);
        addons.push({ item: it, qty: n });
    }
    if (trial && (extras.length || addons.length)) throw new RuleError("A free trial sells nothing. Make the outlet with a plan to sell extras.");
    const discountPct = Math.round((Number(order.discountPct) || 0) * 100) / 100;
    if (discountPct < 0 || discountPct > 100) throw new RuleError("Discount: from 0 to 100%.");
    const discountReason = txt(order.discountReason, 200);
    if (discountPct > 0 && discountReason.length < 3) throw new RuleError("Write why there is a discount.");
    const includes = plan ? includesOf(plan) : [];
    const incItems = includes.length ? await InvItem.findAll({ where: { id: includes.map((x) => x.itemId) }, raw: true }) : [];
    const cfg = await require("../bil/common").billingSettings();
    const printers = includes.reduce((n, x) => n + ((incItems.find((i) => i.id === x.itemId) || {}).category === "printer" ? x.qty : 0), 0) + extras.reduce((n, e) => n + (e.item.category === "printer" ? e.qty : 0), 0);
    const days = trial ? (await customerSettings()).trialDays : plan.days * qty;
    const reasons = [];
    if (trial) reasons.push("Free trial: no payment");
    if (!trial && days > MAX_YEARS_DAYS) reasons.push(`Plan longer than 1 year (${days} days)`);
    if (printers > 1) reasons.push(`${printers} printers`);
    if (discountPct > cfg.discountFreePct) reasons.push(`Discount ${discountPct}% (more than ${cfg.discountFreePct}%)`);
    return { trial, plan, qty, product, days, extras, addons, includes, incItems, discountPct, discountReason, printers, reasons };
}

/** Invoice lines for the order: the plan, what it includes (Rs 0), the extras and add-ons. */
function linesOf(o) {
    return [
        { itemId: o.plan.id, qty: o.qty },
        ...o.includes.map((x) => ({ invItemId: x.itemId, qty: x.qty, included: true })),
        ...o.extras.map((e) => ({ invItemId: e.item.id, qty: e.qty })),
        ...o.addons.map((a) => ({ itemId: a.item.id, qty: a.qty })),
    ];
}

/** The total with GST, as the invoice will show it (same-state split does not change the total). */
function totalOf(o) {
    if (o.trial) return 0;
    const { totals } = require("../bil/common");
    const lines = [
        { qty: o.qty, unit_price: Number(o.plan.price), gst_rate: Number(o.plan.gst_rate) },
        ...o.extras.map((e) => ({ qty: e.qty, unit_price: Number(e.item.price), gst_rate: Number(e.item.gst_rate) })),
        ...o.addons.map((a) => ({ qty: a.qty, unit_price: Number(a.item.price), gst_rate: Number(a.item.gst_rate) })),
    ];
    return Number(totals(lines, o.discountPct, true).total);
}

/** For the form: what it will cost and whether it waits for an approver. */
async function quote(s, order) {
    if (!["customers.manage", "leads.edit"].some((p) => s.can(p))) need(s, "customers.manage");
    const o = await cleanOrder(order);
    return {
        total: totalOf(o),
        days: o.days,
        printers: o.printers,
        reasons: o.reasons,
        needsApproval: o.reasons.length > 0 && !s.can("billing.approve"),
        includes: o.includes.map((x) => ({ itemId: x.itemId, qty: x.qty, name: (o.incItems.find((i) => i.id === x.itemId) || {}).name || "" })),
        tokenMin: o.trial ? 0 : Math.min(TOKEN_MIN, totalOf(o)),
    };
}

function planDates(o) {
    const start = moment().tz(TZ).startOf("day");
    return { start, end: start.clone().add(o.days - 1, "days") };
}

function outletPlan(o) {
    const { start, end } = planDates(o);
    const addonDevices = o.addons.reduce((n, a) => n + (a.item.devices || 1) * a.qty, 0);
    return { product: o.product, planName: o.trial ? "Free trial" : o.plan.plan_name, start, end, devices: (o.trial ? 3 : o.plan.devices || 3) + (o.product === "CLOUD_APP" ? addonDevices : 0) };
}

/* ------------------------------ create ------------------------------ */

/**
 * source: "new" (Add restaurant), "won" (Mark won -> create outlet: leadId),
 * "account" (Add outlet to an account: accountId). Returns the owner's
 * login and password (shown once) and either the made outlet or, when it
 * waits for an approver, the setup request.
 */
async function create(s, input = {}) {
    const source = SOURCES.includes(input.source) ? input.source : "new";
    needFor(s, source);
    const cfg = await customerSettings();
    const o = await cleanOrder(input.order);
    const out = await won.cleanOutlet(input.outlet, cfg, { plan: outletPlan(o) });
    const total = totalOf(o);
    let token = null;
    if (!o.trial) {
        token = await require("../bil/payments").cleanPayment(s, input.token || {});
        const min = Math.min(TOKEN_MIN, total);
        if (token.amount < min) throw new RuleError(`Take a token of at least ${money(min)} before the outlet is made.`);
        if (token.amount > total + 0.005) throw new RuleError(`The token is more than the invoice total (${money(total)}).`);
    }
    if (source === "won") {
        const lead = await require("../crm/leads").getLead(s, input.leadId);
        const c = await require("../crm/config").load();
        if (c.stageById.get(lead.stage_id)?.kind !== "open") throw new RuleError("This lead is already closed.");
    }
    if (source === "account") await accounts.getAccount(input.accountId);
    const generated = out.password ? null : newPassword();
    const hash = await bcrypt.hash(out.password || generated, 10);
    const note = txt(input.note, 500);
    const login = generated ? { password: generated, login: out.m } : {};
    const request = { outlet: input.outlet, order: input.order, token: token ? { ...token } : null, hash, note, leadId: Number(input.leadId) || null, accountId: Number(input.accountId) || null };

    if (o.reasons.length && !s.can("billing.approve")) {
        const row = await sequelize.transaction(async (t) => {
            const r = await CsOutletSetup.create({ status: "approval", source, account_id: request.accountId, lead_id: request.leadId, outlet_name: out.name, owner_mobile: out.m, plan_item_id: o.plan ? o.plan.id : null, plan_label: o.trial ? "Free trial" : `${o.plan.name}${o.qty > 1 ? ` x ${o.qty}` : ""}`, years: o.qty, includes: json(o.includes), request: json(request), reasons: json(o.reasons), total, token_amount: token ? token.amount : 0, created_by: s.user.id }, { transaction: t });
            for (const p of await peopleWith("billing.approve")) {
                await notify(p.id, { type: "setup.approval", title: `New outlet to approve: ${out.name}`, body: `${o.reasons.join(", ")} · ${money(total)} · by ${s.user.name}`, link: `/outlets?setups=1`, ref: `setup:${r.id}` }, { transaction: t });
            }
            await audit.write(s, { action: "setup.ask", entity: "cs_outlet_setup", entityId: r.id, summary: `Asked approval for the outlet ${out.name} (${o.reasons.join(", ")})`, after: { total, token: token && token.amount } }, { transaction: t });
            return r;
        });
        return { status: "approval", setupId: row.id, reasons: o.reasons, ...login };
    }
    const result = await sequelize.transaction(async (t) => execute(s, { id: s.user.id, name: s.user.name }, null, { source, o, out, hash, token, note, leadId: request.leadId, accountId: request.accountId, request }, t));
    await onboarding.autoCheck({ only: [result.hotelId] });
    return { status: "done", ...result, ...login };
}

/** Makes the outlet, its account link, onboarding, first invoice and token payment - one transaction. */
async function execute(actor, requester, row, d, t) {
    const { o, out } = d;
    const hotel = await Hotel.create({
        hotel_name: out.name, owner_name: out.ownerName, owner_number: Number(out.m), owner_email_id: out.email || null, address1: out.address, address2: out.city || null,
        pinCode: out.pin, contact1: out.m, email_id: out.email || null, gst_no: out.gst, hotel_logo: "", password: d.hash, hotel_reg_date: new Date(),
        plan_start_date: out.start.toDate(), plan_end_date: out.end.clone().endOf("day").toDate(), product_plan: out.product, app_device_limit: out.devices,
    }, { transaction: t });
    await seedOutlet(hotel, { name: out.ownerName, number: out.m, email: out.email || null, passwordHash: d.hash }, { transaction: t });

    let acc;
    let lead = null;
    if (d.source === "account") acc = await accounts.getAccount(d.accountId, t, true);
    else {
        if (d.source === "won") lead = await require("../crm/leads").getLead(actor, d.leadId, t, true);
        acc = await CsAccount.findOne({ where: { owner_mobile: out.m }, transaction: t, lock: t.LOCK.UPDATE });
        if (!acc) {
            const seller = (lead && lead.owner_id) || requester.id;
            acc = await CsAccount.create({
                name: txt(out.ownerName || (lead && lead.name) || out.name, 120), owner_mobile: out.m, owner_name: out.ownerName, email: out.email || (lead && lead.email) || "", city: out.city || (lead && lead.city) || "",
                origin: d.source === "won" ? "won" : "outlet", customer_since: new Date(), lead_id: lead ? lead.id : null, won_by_id: lead ? seller : null, success_owner_id: await accounts.pickSuccessOwner(seller, t),
            }, { transaction: t });
            await addActivity(acc.id, hotel.id, "created", requester.id, lead ? `Customer account made: ${lead.name || lead.phone} was won by ${requester.name}` : `Customer account made by ${requester.name} (new restaurant)`, lead ? { leadId: lead.id } : null, t);
        } else if (lead) {
            await acc.update({ lead_id: acc.lead_id || lead.id, won_by_id: acc.won_by_id || lead.owner_id || requester.id }, { transaction: t });
        }
    }
    const link = await CsAccountOutlet.create({ account_id: acc.id, hotel_id: hotel.id, plan_name: out.planName, linked_by: requester.id }, { transaction: t });
    await addActivity(acc.id, hotel.id, "link", requester.id, `New outlet ${hotel.hotel_name} (#${hotel.id}) set up by ${requester.name}: ${o.trial ? "free trial" : `${o.plan.name}${o.qty > 1 ? ` x ${o.qty}` : ""}`}${row ? ` - approved by ${actor.user.name}` : ""}`, null, t);
    if (lead) {
        const as = { ...actor, user: { ...actor.user, id: requester.id, name: requester.name } };
        await require("../crm/leads").wonIn(as, lead, { note: d.note, hotelId: hotel.id, data: { hotelId: hotel.id, accountId: acc.id, outlet: hotel.hotel_name, created: true } }, t);
        await addActivity(acc.id, hotel.id, "won", requester.id, `Won by ${requester.name}: outlet ${hotel.hotel_name} created${d.note ? ` (${d.note})` : ""}`, { leadId: lead.id }, t);
    }
    await onboarding.start(link, { ownerId: acc.success_owner_id, actorId: requester.id }, t);

    let invoiceId = null;
    let paymentId = null;
    if (!o.trial) {
        const { start, end } = planDates(o);
        const invoices = require("../bil/invoices");
        const { id } = await invoices.saveDraft(actor, { hotelId: hotel.id, accountId: acc.id, lines: linesOf(o), discountPct: o.discountPct, discountReason: o.discountReason, note: `Outlet setup${row ? ` approved by ${actor.user.name}` : ""}` }, null, { setupPeriod: { from: start.format("YYYY-MM-DD"), to: end.format("YYYY-MM-DD") }, t });
        const inv = await invoices.getInvoice(id, t, true);
        await invoices.issueIn(actor, inv, t, { system: true });
        invoiceId = inv.id;
        const pay = await require("../bil/payments").recordIn(actor, inv, d.token, t, { createdBy: requester.id });
        paymentId = pay.id;
    }
    const payBy = o.trial ? null : moment().tz(TZ).add(PAY_DAYS, "days").endOf("day").toDate();
    const fields = { status: "done", source: d.source, hotel_id: hotel.id, account_id: acc.id, lead_id: lead ? lead.id : null, outlet_name: out.name, owner_mobile: out.m, plan_item_id: o.plan ? o.plan.id : null, plan_label: o.trial ? "Free trial" : `${o.plan.name}${o.qty > 1 ? ` x ${o.qty}` : ""}`, years: o.qty, includes: json(o.includes), reasons: json(o.reasons), total: totalOf(o), token_amount: d.token ? d.token.amount : 0, invoice_id: invoiceId, token_payment_id: paymentId, pay_by: payBy };
    let setup;
    if (row) {
        await row.update({ ...fields, request: json({ ...d.request, hash: null }), decided_by: actor.user.id, decided_at: new Date() }, { transaction: t });
        setup = row;
    } else {
        setup = await CsOutletSetup.create({ ...fields, request: json({ ...d.request, hash: null }), created_by: requester.id, ...(o.reasons.length ? { decided_by: actor.user.id, decided_at: new Date() } : {}) }, { transaction: t });
    }
    await audit.write(actor, { action: "outlet.create", entity: "hotel", entityId: hotel.id, summary: `Set up the outlet ${hotel.hotel_name}${row ? ` (approved request #${row.id})` : ""}`, after: { hotel_name: hotel.hotel_name, owner_number: out.m, product_plan: out.product, plan: fields.plan_label, plan_end_date: hotel.plan_end_date, invoiceId, token: fields.token_amount } }, { transaction: t });
    if (acc.success_owner_id && acc.success_owner_id !== requester.id) {
        await notify(acc.success_owner_id, { type: "account.won", title: `New outlet: ${hotel.hotel_name}`, body: `Set up by ${requester.name}. Onboarding has started.`, link: `/accounts/${acc.id}`, ref: `setup-done:${setup.id}` }, { transaction: t });
    }
    return { hotelId: hotel.id, accountId: acc.id, invoiceId, paymentId, setupId: setup.id, leadId: lead ? lead.id : null };
}

/* ------------------------------ approval ------------------------------ */

async function decide(s, setupId, ok, reason) {
    need(s, "billing.approve");
    const row0 = await CsOutletSetup.findOne({ where: { id: Number(setupId) || 0 } });
    if (!row0 || row0.status !== "approval") throw new RuleError("This request is already decided.");
    const req = parse(row0.request) || {};
    const requester = await AdmUser.findOne({ where: { id: row0.created_by || 0 }, attributes: ["id", "name"], raw: true }) || { id: s.user.id, name: s.user.name };
    if (!ok) {
        const why = txt(reason, 200);
        if (why.length < 3) throw new RuleError("Write why it is refused.");
        await sequelize.transaction(async (t) => {
            const row = await CsOutletSetup.findOne({ where: { id: row0.id, status: "approval" }, transaction: t, lock: t.LOCK.UPDATE });
            if (!row) throw new RuleError("This request is already decided.");
            await row.update({ status: "rejected", decided_by: s.user.id, decided_at: new Date(), reject_reason: why, request: json({ ...req, hash: null }) }, { transaction: t });
            await notify(requester.id, { type: "setup.refused", title: `Not approved: ${row.outlet_name}`, body: why, link: `/outlets?setups=1`, ref: `setup-no:${row.id}` }, { transaction: t });
            await audit.write(s, { action: "setup.reject", entity: "cs_outlet_setup", entityId: row.id, summary: `Refused the outlet ${row.outlet_name}`, reason: why }, { transaction: t });
        });
        return { id: row0.id, status: "rejected" };
    }
    if (!req.hash) throw new RuleError("This request cannot be approved any more. Ask for it again.");
    const cfg = await customerSettings();
    const o = await cleanOrder(req.order);
    const out = await won.cleanOutlet(req.outlet, cfg, { plan: outletPlan(o) });
    const result = await sequelize.transaction(async (t) => {
        const row = await CsOutletSetup.findOne({ where: { id: row0.id, status: "approval" }, transaction: t, lock: t.LOCK.UPDATE });
        if (!row) throw new RuleError("This request is already decided.");
        const r = await execute(s, requester, row, { source: row.source, o, out, hash: req.hash, token: req.token, note: req.note, leadId: req.leadId, accountId: req.accountId, request: req }, t);
        if (requester.id !== s.user.id) await notify(requester.id, { type: "setup.approved", title: `Approved: ${row.outlet_name} is ready`, body: `The owner can log in now. Invoice made; full payment due in ${PAY_DAYS} days.`, link: `/outlets?sel=${r.hotelId}`, ref: `setup-ok:${row.id}` }, { transaction: t });
        await audit.write(s, { action: "setup.approve", entity: "cs_outlet_setup", entityId: row.id, summary: `Approved the outlet ${row.outlet_name}`, reason: (parse(row.reasons) || []).join(", ") }, { transaction: t });
        return r;
    });
    await onboarding.autoCheck({ only: [result.hotelId] });
    return { id: row0.id, status: "done", ...result };
}

/* ------------------------------ read ------------------------------ */

async function viewOf(rows) {
    const people = new Map((await AdmUser.findAll({ where: { id: [...new Set(rows.flatMap((r) => [r.created_by, r.decided_by]).filter(Boolean))] }, attributes: ["id", "name"], raw: true })).map((u) => [u.id, u.name]));
    return rows.map((r) => {
        const req = parse(r.request) || {};
        return {
            id: r.id,
            status: r.status,
            source: r.source,
            outlet: r.outlet_name,
            ownerMobile: r.owner_mobile,
            hotelId: r.hotel_id,
            plan: r.plan_label,
            reasons: parse(r.reasons) || [],
            total: Number(r.total),
            token: Number(r.token_amount),
            tokenMethod: req.token ? req.token.method : "",
            tokenReference: req.token ? req.token.reference : "",
            tokenProof: !!(req.token && req.token.proof),
            discount: req.order ? Number(req.order.discountPct) || 0 : 0,
            discountReason: req.order ? txt(req.order.discountReason, 200) : "",
            city: req.outlet ? txt(req.outlet.city, 60) : "",
            by: r.created_by ? people.get(r.created_by) || `#${r.created_by}` : "",
            at: r.createdAt,
            decidedBy: r.decided_by ? people.get(r.decided_by) || "" : "",
            decidedAt: r.decided_at,
            rejectReason: r.reject_reason,
        };
    });
}

/** Requests waiting for an approver (and recent decisions). */
async function list(s, query = {}) {
    if (!["customers.view", "leads.edit"].some((p) => s.can(p))) need(s, "customers.view");
    const status = ["approval", "done", "rejected"].includes(query.status) ? query.status : "approval";
    const where = { status };
    if (!s.can("customers.view")) where.created_by = s.user.id;
    const rows = await CsOutletSetup.findAll({ where, order: [["id", "DESC"]], limit: 100, raw: true });
    return { setups: await viewOf(rows), waiting: await CsOutletSetup.count({ where: { status: "approval", ...(where.created_by ? { created_by: where.created_by } : {}) } }) };
}

/** The token's screenshot of a waiting request. */
async function tokenProof(s, setupId) {
    need(s, "billing.view");
    const r = await CsOutletSetup.findOne({ where: { id: Number(setupId) || 0 }, attributes: ["request"], raw: true });
    const req = r ? parse(r.request) || {} : {};
    if (!req.token || !req.token.proof) throw new RuleError("No screenshot with this request.");
    return { url: await require("../bil/payments").store.link(req.token.proof) };
}

/**
 * One outlet's setup as its page shows it: the plan, what it includes and
 * how much of it has gone out, the first invoice's money, the 15-day date.
 */
async function forHotel(hotelId, t) {
    const r = await CsOutletSetup.findOne({ where: { hotel_id: Number(hotelId) || 0, status: "done" }, raw: true, transaction: t });
    if (!r) return null;
    const inc = parse(r.includes) || [];
    const items = inc.length ? await InvItem.findAll({ where: { id: inc.map((x) => x.itemId) }, raw: true, transaction: t }) : [];
    const sent = inc.length ? await InvMove.findAll({ where: { hotel_id: r.hotel_id, kind: "dispatch", basis: "plan", status: ["done", "pending"], item_id: inc.map((x) => x.itemId) }, attributes: ["item_id", [sequelize.fn("SUM", sequelize.col("qty")), "n"]], group: ["item_id"], raw: true, transaction: t }) : [];
    const inv = r.invoice_id ? await BilInvoice.findOne({ where: { id: r.invoice_id }, attributes: ["id", "number", "status", "total", "paid"], raw: true, transaction: t }) : null;
    const tokenPay = r.token_payment_id ? await BilPayment.findOne({ where: { id: r.token_payment_id }, attributes: ["status", "amount"], raw: true, transaction: t }) : null;
    return {
        id: r.id,
        plan: r.plan_label,
        includes: inc.map((x) => ({ itemId: x.itemId, name: (items.find((i) => i.id === x.itemId) || {}).name || `#${x.itemId}`, qty: x.qty, sent: Number((sent.find((y) => y.item_id === x.itemId) || {}).n) || 0 })),
        invoice: inv ? { id: inv.id, number: inv.number, status: inv.status, total: Number(inv.total), paid: Number(inv.paid) } : null,
        token: { amount: Number(r.token_amount), status: tokenPay ? tokenPay.status : null },
        payBy: r.pay_by,
        frozenAt: r.frozen_at,
    };
}

module.exports = { options, quote, create, decide, list, tokenProof, forHotel, cleanOrder, TOKEN_MIN, PAY_DAYS };
