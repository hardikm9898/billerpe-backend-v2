const { Op } = require("sequelize");
const { sequelize, Hotel, BilItem, InvItem, BilInvoice, BilInvoiceLine, BilPayment, BilPayLink, CsAccount, CsAccountOutlet, CsRenewal, CsOnboardingItem, AdmUser, EBillCredit, EBillCreditDebit, PurchaseRollsAndPrinter } = require("../../model");
const WebSiteProducts = require("../../model/webSiteProducts");
const { RuleError } = require("../../appv1/core");
const { need } = require("../auth");
const audit = require("../audit");
const { notify, peopleWith } = require("../crm/notify");
const { addActivity } = require("../cs/common");
const { hardwarePrice, ensureCatalog } = require("./catalog");
const { STATE_NAME, GSTIN_RE, supplyState, totals, nextNumber, billingSettings, seller, money, moment, TZ, txt, json, parse } = require("./common");

// BillerPe's GST invoices (the panel is the invoice book, owner 2026-10-08).
//   draft -> issue: gets its number (BPE/26-27/00001); a discount above the
//   free limit (25%) waits for an admin first ("approval").
//   issued -> part_paid -> paid: payments (PhonePe, or manual with approval).
//   Paid = its lines take effect once: the plan runs on from its paid-up end,
//   product / devices change, e-bill credits are added.
//   Cancelling an issued invoice makes a credit note (BCN/...) - an issued
//   number is never deleted. Totals are fixed at issue.

const NOT_FOUND = "This invoice does not exist.";
const OPEN = ["issued", "part_paid"];

/* ------------------------------ helpers ------------------------------ */

async function getInvoice(id, t, lock = false) {
    const inv = await BilInvoice.findOne({ where: { id: Number(id) || 0 }, transaction: t, ...(lock && t ? { lock: t.LOCK.UPDATE } : {}) });
    if (!inv) throw new RuleError(NOT_FOUND);
    return inv;
}

/** The paid-up end of an outlet's plan: without a 1-day grace that is running. */
async function paidEnd(hotel, t) {
    const r = await CsRenewal.findOne({ where: { hotel_id: hotel.id, stage: { [Op.notIn]: ["paid", "churned"] }, grace_used_at: { [Op.ne]: null } }, order: [["ends_on", "DESC"]], transaction: t });
    return r ? r.ends_on : hotel.plan_end_date;
}

/** First and last day a plan of `days` covers if paid now: from the day after the paid-up end, or today if it has passed. */
function periodFor(end, days, now = new Date()) {
    const startAfter = end && new Date(end) > now ? moment(end).tz(TZ).add(1, "day").startOf("day") : moment(now).tz(TZ).startOf("day");
    const to = startAfter.clone().add(days - 1, "days");
    return { from: startAfter.format("YYYY-MM-DD"), to: to.format("YYYY-MM-DD") };
}

/** Who the invoice is for, from the outlet (and its account). */
async function billTo(hotel, account) {
    const pin = hotel ? hotel.pinCode : "";
    const gstin = hotel && GSTIN_RE.test(String(hotel.gst_no || "").toUpperCase()) ? String(hotel.gst_no).toUpperCase() : "";
    return {
        bill_name: txt((hotel && (hotel.gst_reg_name || hotel.hotel_name)) || (account && account.name) || "", 160),
        bill_gstin: gstin,
        bill_address: txt([hotel && hotel.address1, hotel && hotel.address2, pin].filter(Boolean).join(", "), 400),
        bill_mobile: txt((account && account.owner_mobile) || (hotel && String(hotel.owner_number || "").slice(-10)) || "", 15),
        bill_email: txt((hotel && hotel.owner_email_id) || (account && account.email) || "", 120),
        pin,
    };
}

/**
 * Lines as asked -> lines with prices from the catalog (or the website's
 * hardware list); only someone who approves payments may write a free line.
 */
async function buildLines(s, rawLines, hotel, t, opts = {}) {
    if (!Array.isArray(rawLines) || !rawLines.length) throw new RuleError("Add at least one line.");
    if (rawLines.length > 30) throw new RuleError("Keep an invoice to 30 lines or fewer.");
    await ensureCatalog();
    const end = hotel ? await paidEnd(hotel, t) : null;
    const out = [];
    let planLines = 0;
    for (const [i, l] of rawLines.entries()) {
        const qty = Number(l.qty || 1);
        if (!(qty > 0 && qty <= 1000)) throw new RuleError(`Line ${i + 1}: quantity from 1 to 1000.`);
        if (l.itemId) {
            const item = await BilItem.findOne({ where: { id: Number(l.itemId), active: true }, raw: true, transaction: t });
            if (!item) throw new RuleError(`Line ${i + 1}: this item is not sold any more.`);
            const line = { item_id: item.id, kind: item.kind, description: item.name, sac: item.sac, qty, unit_price: Number(item.price), gst_rate: Number(item.gst_rate), effect: null };
            if (item.kind === "plan") {
                if (!hotel) throw new RuleError("A plan needs the outlet it is for.");
                if (!Number.isInteger(qty)) throw new RuleError(`Line ${i + 1}: a plan is sold in whole periods.`);
                planLines += 1;
                const days = item.days * qty;
                // An outlet's first invoice (outlet setup): the plan already runs from these dates.
                const p = opts.setupPeriod || periodFor(end, days);
                line.period_from = p.from;
                line.period_to = p.to;
                line.description = `${item.name}${qty > 1 ? ` x ${qty}` : ""} · ${hotel.hotel_name}`;
                line.effect = { plan: { product: item.product, planName: item.plan_name, days, devices: item.devices || null, ...(opts.setupPeriod ? { setup: true } : {}) } };
            } else if (item.kind === "addon") {
                if (!hotel) throw new RuleError("An add-on needs the outlet it is for.");
                line.effect = { devices: (item.devices || 1) * qty };
                line.description = `${item.name} · ${hotel.hotel_name}`;
            } else if (item.kind === "ebill") {
                if (!hotel) throw new RuleError("E-bill credits need the outlet they are for.");
                line.effect = { credits: (item.credits || 0) * qty };
                line.description = `${item.name} · ${hotel.hotel_name}`;
            }
            out.push(line);
        } else if (l.invItemId) {
            // Goods from the office stock (printers, rolls): sold at the item's price, or
            // included free with the plan (outlet setup only). Sending them is Inventory's job.
            const it = await InvItem.findOne({ where: { id: Number(l.invItemId) || 0 }, raw: true, transaction: t });
            if (!it) throw new RuleError(`Line ${i + 1}: this stock item does not exist.`);
            if (!Number.isInteger(qty)) throw new RuleError(`Line ${i + 1}: goods are sold in whole pieces.`);
            const included = !!l.included && !!opts.setupPeriod;
            out.push({ kind: "goods", description: `${it.name}${included ? " (included with the plan)" : ""}`, sac: it.hsn || "", qty, unit_price: included ? 0 : Number(it.price), gst_rate: Number(it.gst_rate), effect: { goods: { itemId: it.id, included } } });
        } else if (l.productId) {
            const p = await WebSiteProducts.findOne({ where: { id: Number(l.productId) }, raw: true, transaction: t });
            if (!p) throw new RuleError(`Line ${i + 1}: this hardware is not in the list.`);
            out.push({ product_id: p.id, kind: "hardware", description: txt(p.title, 200), sac: "", qty, unit_price: hardwarePrice(p), gst_rate: 18, effect: { hardware: true } });
        } else {
            if (!s || !s.can("billing.approve")) throw new RuleError(`Line ${i + 1}: choose an item from the catalog. Only an admin can write a free line.`);
            const desc = txt(l.description, 200);
            const price = Number(l.unitPrice);
            if (!desc || !(price >= 0)) throw new RuleError(`Line ${i + 1}: write what it is and its price.`);
            out.push({ kind: "other", description: desc, sac: txt(l.sac, 8), qty, unit_price: Math.round(price * 100) / 100, gst_rate: [0, 5, 12, 18, 28].includes(Number(l.gstRate)) ? Number(l.gstRate) : 18, effect: null });
        }
    }
    if (planLines > 1) throw new RuleError("Put one plan per invoice (one outlet's plan).");
    return out;
}

function calc(lines, discountPct, supply, sellerState) {
    return totals(lines, discountPct, supply === sellerState);
}

const lineView = (l) => ({
    id: l.id,
    kind: l.kind,
    itemId: l.item_id,
    productId: l.product_id,
    description: l.description,
    sac: l.sac,
    qty: Number(l.qty),
    unitPrice: Number(l.unit_price),
    amount: Number(l.amount),
    gstRate: Number(l.gst_rate),
    periodFrom: l.period_from,
    periodTo: l.period_to,
    // Goods from the office stock (owner 2026-10-09).
    invItemId: ((parse(l.effect) || {}).goods || {}).itemId || null,
    included: !!((parse(l.effect) || {}).goods || {}).included,
});

const due = (inv) => Math.max(0, Math.round((Number(inv.total) - Number(inv.paid)) * 100) / 100);

function view(inv, names = new Map()) {
    const late = OPEN.includes(inv.status) && inv.due_at && new Date(inv.due_at) < new Date();
    return {
        id: inv.id,
        kind: inv.kind,
        number: inv.number,
        status: inv.status,
        overdue: !!late,
        accountId: inv.account_id,
        hotelId: inv.hotel_id,
        renewalId: inv.renewal_id,
        creditForId: inv.credit_for_id,
        billName: inv.bill_name,
        billGstin: inv.bill_gstin,
        billAddress: inv.bill_address,
        billMobile: inv.bill_mobile,
        billEmail: inv.bill_email,
        supplyState: inv.supply_state,
        supplyStateName: STATE_NAME.get(inv.supply_state) || "",
        subtotal: Number(inv.subtotal),
        discount: Number(inv.discount),
        discountPct: Number(inv.discount_pct),
        discountReason: inv.discount_reason,
        taxable: Number(inv.taxable),
        cgst: Number(inv.cgst),
        sgst: Number(inv.sgst),
        igst: Number(inv.igst),
        roundOff: Number(inv.round_off),
        total: Number(inv.total),
        paid: Number(inv.paid),
        due: due(inv),
        issuedAt: inv.issued_at,
        dueAt: inv.due_at,
        paidAt: inv.paid_at,
        cancelledAt: inv.cancelled_at,
        cancelReason: inv.cancel_reason,
        demo: !!inv.demo,
        note: inv.note,
        createdBy: inv.created_by ? names.get(inv.created_by) || `#${inv.created_by}` : "System",
        createdAt: inv.createdAt,
    };
}

/* ------------------------------ draft ------------------------------ */

/** Makes or replaces a draft. input: { hotelId, accountId?, renewalId?, lines, discountPct, discountReason, supplyState?, bill?, note } */
/** opts (outlet setup only): { setupPeriod, t } - the first invoice is made inside the setup's transaction. */
async function saveDraft(s, input = {}, id = null, opts = {}) {
    if (s && !opts.setupPeriod) need(s, "billing.manage");
    const run = (fn) => (opts.t ? fn(opts.t) : sequelize.transaction(fn));
    return run(async (t) => {
        let inv = id ? await getInvoice(id, t, true) : null;
        if (inv && inv.status !== "draft") throw new RuleError("Only a draft can be changed.");
        // Owner 2026-10-09: changing a billing record is for staff with the edit right (and a reason);
        // the person who made a draft may still work on it.
        const editReason = txt(input.reason, 200);
        if (inv && s && inv.created_by !== s.user.id) {
            need(s, "billing.edit");
            if (editReason.length < 5) throw new RuleError("Write why you change someone else's invoice.");
        }
        const before = inv ? { total: Number(inv.total), discount_pct: Number(inv.discount_pct), bill_name: inv.bill_name } : null;
        const hotelId = Number(input.hotelId) || (inv && inv.hotel_id) || null;
        const hotel = hotelId ? await Hotel.findOne({ where: { id: hotelId }, transaction: t }) : null;
        if (hotelId && !hotel) throw new RuleError("This outlet does not exist.");
        const link = hotel ? await CsAccountOutlet.findOne({ where: { hotel_id: hotel.id }, raw: true, transaction: t }) : null;
        const accountId = Number(input.accountId) || (link && link.account_id) || (inv && inv.account_id) || null;
        const account = accountId ? await CsAccount.findOne({ where: { id: accountId }, raw: true, transaction: t }) : null;
        const lines = await buildLines(s, input.lines, hotel, t, opts);
        const pct = Math.round((Number(input.discountPct) || 0) * 100) / 100;
        if (pct < 0 || pct > 100) throw new RuleError("Discount: from 0 to 100%.");
        const reason = txt(input.discountReason, 200);
        if (pct > 0 && reason.length < 3) throw new RuleError("Write why there is a discount.");
        const sel = await seller();
        const base = await billTo(hotel, account);
        const b = input.bill || {};
        const gstin = txt(b.gstin !== undefined ? b.gstin : base.bill_gstin, 15).toUpperCase();
        if (gstin && !GSTIN_RE.test(gstin)) throw new RuleError("The buyer's GSTIN does not look right (15 characters).");
        const bill = {
            bill_name: txt(b.name !== undefined ? b.name : base.bill_name, 160),
            bill_gstin: gstin,
            bill_address: txt(b.address !== undefined ? b.address : base.bill_address, 400),
            bill_mobile: txt(b.mobile !== undefined ? b.mobile : base.bill_mobile, 15),
            bill_email: txt(b.email !== undefined ? b.email : base.bill_email, 120),
        };
        if (!bill.bill_name) throw new RuleError("Write who the invoice is for.");
        const supply = input.supplyState && STATE_NAME.has(String(input.supplyState)) ? String(input.supplyState) : supplyState({ gstin, pin: base.pin }, sel.state);
        const tot = calc(lines, pct, supply, sel.state);
        const fields = { kind: "invoice", account_id: accountId, hotel_id: hotelId, renewal_id: Number(input.renewalId) || (inv && inv.renewal_id) || null, ...bill, supply_state: supply, ...tot, discount_reason: reason, note: txt(input.note, 500) };
        delete fields.amounts;
        if (inv) await inv.update(fields, { transaction: t });
        else inv = await BilInvoice.create({ ...fields, status: "draft", created_by: s ? s.user.id : null }, { transaction: t });
        await BilInvoiceLine.destroy({ where: { invoice_id: inv.id }, transaction: t });
        await BilInvoiceLine.bulkCreate(lines.map((l, i) => ({ ...l, invoice_id: inv.id, amount: tot.amounts[i], effect: json(l.effect), sort: i })), { transaction: t });
        if (s) await audit.write(s, { action: before ? "invoice.edit" : "invoice.draft", entity: "bil_invoice", entityId: inv.id, summary: before ? `Changed the draft (${money(before.total)} -> ${money(inv.total)})` : `Made a draft for ${inv.bill_name} (${money(inv.total)})`, before, after: { total: Number(inv.total), discount_pct: Number(inv.discount_pct), bill_name: inv.bill_name }, reason: editReason }, { transaction: t });
        return { id: inv.id };
    });
}

/* ------------------------------ issue / approve ------------------------------ */

async function issueIn(s, inv, t, { system = false } = {}) {
    const cfg = await billingSettings();
    const sel = await seller();
    if (Number(inv.total) <= 0) throw new RuleError("The invoice total is zero.");
    if (!system && Number(inv.discount_pct) > cfg.discountFreePct && !(s && s.can("billing.approve")) && inv.status !== "approval") {
        await inv.update({ status: "approval" }, { transaction: t });
        for (const p of await peopleWith("billing.approve")) {
            await notify(p.id, { type: "billing.approval", title: `Discount of ${Number(inv.discount_pct)}% waits for you`, body: `${inv.bill_name}: ${money(inv.total)} (${inv.discount_reason})`, link: `/billing/invoices/${inv.id}`, ref: `approve:${inv.id}` }, { transaction: t });
        }
        return "approval";
    }
    const now = new Date();
    const number = await nextNumber("invoice", sel.prefixes.invoice || "BPE", t, now);
    await inv.update({
        number,
        status: "issued",
        issued_at: now,
        due_at: moment(now).tz(TZ).add(cfg.dueDays, "days").endOf("day").toDate(),
        seller: json({ name: sel.name, gstin: sel.gstin, state: sel.state, stateName: sel.stateName, address: sel.address }),
        demo: sel.demo,
        approved_by: Number(inv.discount_pct) > cfg.discountFreePct && s ? s.user.id : null,
    }, { transaction: t });
    if (inv.account_id) await addActivity(inv.account_id, inv.hotel_id, "invoice", s ? s.user.id : null, `Invoice ${number} for ${money(inv.total)}`, { invoiceId: inv.id }, t);
    if (inv.renewal_id) await CsRenewal.update({ stage: "invoiced", invoice_id: inv.id }, { where: { id: inv.renewal_id, stage: ["upcoming", "contacted"] }, transaction: t });
    return "issued";
}

async function issue(s, id) {
    need(s, "billing.manage");
    return sequelize.transaction(async (t) => {
        const inv = await getInvoice(id, t, true);
        if (inv.status !== "draft") throw new RuleError("Only a draft can be issued.");
        const status = await issueIn(s, inv, t);
        await audit.write(s, { action: status === "issued" ? "invoice.issue" : "invoice.ask_approval", entity: "bil_invoice", entityId: inv.id, summary: status === "issued" ? `Issued ${inv.number} (${money(inv.total)})` : `Asked approval for a ${Number(inv.discount_pct)}% discount`, after: { total: inv.total, discount_pct: inv.discount_pct } }, { transaction: t });
        return { id: inv.id, status, number: inv.number };
    });
}

async function approve(s, id) {
    need(s, "billing.approve");
    return sequelize.transaction(async (t) => {
        const inv = await getInvoice(id, t, true);
        if (inv.status !== "approval") throw new RuleError("This invoice is not waiting for approval.");
        await issueIn(s, inv, t);
        await audit.write(s, { action: "invoice.approve", entity: "bil_invoice", entityId: inv.id, summary: `Approved the ${Number(inv.discount_pct)}% discount and issued ${inv.number}`, reason: inv.discount_reason }, { transaction: t });
        if (inv.created_by && inv.created_by !== s.user.id) await notify(inv.created_by, { type: "billing.approved", title: `Discount approved: ${inv.number}`, body: `${inv.bill_name}: ${money(inv.total)}`, link: `/billing/invoices/${inv.id}`, ref: `approved:${inv.id}` }, { transaction: t });
        return { id: inv.id, number: inv.number };
    });
}

/** Back to draft (approval refused, or the seller wants to change it). */
async function toDraft(s, id, reason) {
    need(s, "billing.manage");
    return sequelize.transaction(async (t) => {
        const inv = await getInvoice(id, t, true);
        if (inv.status !== "approval") throw new RuleError("Only an invoice waiting for approval goes back to draft.");
        if (inv.created_by !== s.user.id && !s.can("billing.approve")) throw new RuleError("You do not have permission for this.");
        await inv.update({ status: "draft" }, { transaction: t });
        if (inv.created_by && inv.created_by !== s.user.id) await notify(inv.created_by, { type: "billing.refused", title: `Discount not approved for ${inv.bill_name}`, body: txt(reason, 200) || "Change the invoice and try again.", link: `/billing/invoices/${inv.id}`, ref: `refused:${inv.id}:${Date.now()}` }, { transaction: t });
        await audit.write(s, { action: "invoice.to_draft", entity: "bil_invoice", entityId: inv.id, summary: "Sent back to draft", reason: txt(reason, 300) }, { transaction: t });
        return { id: inv.id };
    });
}

/* ------------------------------ cancel / credit note ------------------------------ */

/** A draft is deleted from use; an issued unpaid invoice is cancelled by a full credit note. Paid money is refunded outside, then credited here. */
async function cancel(s, id, reason) {
    const why = txt(reason, 200);
    if (why.length < 5) throw new RuleError("Write why (at least a few words).");
    return sequelize.transaction(async (t) => {
        const inv = await getInvoice(id, t, true);
        if (["draft", "approval"].includes(inv.status)) {
            need(s, "billing.manage");
            if (inv.created_by !== s.user.id) need(s, "billing.edit");
            await inv.update({ status: "cancelled", cancelled_at: new Date(), cancel_reason: why }, { transaction: t });
            await BilPayLink.update({ state: "CANCELLED" }, { where: { invoice_id: inv.id, state: "PENDING" }, transaction: t });
            await audit.write(s, { action: "invoice.delete_draft", entity: "bil_invoice", entityId: inv.id, summary: `Deleted the draft for ${inv.bill_name} (${money(inv.total)})`, reason: why }, { transaction: t });
            return { id: inv.id };
        }
        // An issued invoice is never edited or deleted (GST): it is cancelled by a credit note.
        need(s, "billing.edit");
        if (inv.kind !== "invoice" || !["issued", "part_paid", "paid"].includes(inv.status)) throw new RuleError("This invoice cannot be cancelled.");
        if (await BilPayment.count({ where: { invoice_id: inv.id, status: "pending" }, transaction: t })) throw new RuleError("A payment for it waits for approval. Decide that first.");
        const sel = await seller();
        const now = new Date();
        const number = await nextNumber("credit", sel.prefixes.credit || "BCN", t, now);
        const lines = await BilInvoiceLine.findAll({ where: { invoice_id: inv.id }, raw: true, transaction: t });
        const plain = inv.get({ plain: true });
        const cn = await BilInvoice.create({
            ...Object.fromEntries(Object.entries(plain).filter(([k]) => !["id", "number", "createdAt", "updatedAt", "paid", "paid_at", "applied_at", "issued_at", "due_at", "status", "renewal_id", "hardware_order_id"].includes(k))),
            kind: "credit_note",
            number,
            status: "issued",
            credit_for_id: inv.id,
            issued_at: now,
            note: `Against ${inv.number}: ${why}`,
            created_by: s.user.id,
            seller: json({ name: sel.name, gstin: sel.gstin, state: sel.state, stateName: sel.stateName, address: sel.address }),
            demo: sel.demo,
        }, { transaction: t });
        await BilInvoiceLine.bulkCreate(lines.map((l) => ({ ...l, id: undefined, invoice_id: cn.id, effect: null })), { transaction: t });
        await inv.update({ status: "cancelled", cancelled_at: now, cancel_reason: why }, { transaction: t });
        await BilPayLink.update({ state: "CANCELLED" }, { where: { invoice_id: inv.id, state: "PENDING" }, transaction: t });
        if (inv.account_id) await addActivity(inv.account_id, inv.hotel_id, "invoice", s.user.id, `Invoice ${inv.number} cancelled by credit note ${number} (${why})`, { invoiceId: inv.id, creditNoteId: cn.id }, t);
        await audit.write(s, { action: "invoice.cancel", entity: "bil_invoice", entityId: inv.id, summary: `Cancelled ${inv.number} with credit note ${number}`, reason: why }, { transaction: t });
        return { id: inv.id, creditNoteId: cn.id, creditNote: number };
    });
}

/* ------------------------------ paid: effects ------------------------------ */

/** Once an invoice is fully paid: the plan, devices and credits it sold take effect (once). */
async function applyPaid(inv, t, actorId = null) {
    if (inv.applied_at || inv.kind !== "invoice") return [];
    const lines = await BilInvoiceLine.findAll({ where: { invoice_id: inv.id }, raw: true, transaction: t });
    const done = [];
    const hotel = inv.hotel_id ? await Hotel.findOne({ where: { id: inv.hotel_id }, transaction: t, lock: t.LOCK.UPDATE }) : null;
    const extraDevices = lines.reduce((n, l) => n + ((parse(l.effect) || {}).devices || 0), 0);
    for (const l of lines) {
        const e = parse(l.effect);
        if (!e || !hotel) continue;
        if (e.plan && e.plan.setup) {
            // The outlet was set up with this plan's dates already: nothing moves.
            await CsAccountOutlet.update({ plan_name: e.plan.planName || "" }, { where: { hotel_id: hotel.id }, transaction: t });
            done.push("plan paid in full");
        } else if (e.plan) {
            const renewal = await CsRenewal.findOne({ where: { hotel_id: hotel.id, stage: { [Op.notIn]: ["paid", "churned"] } }, order: [["ends_on", "ASC"]], transaction: t });
            const end = renewal ? renewal.ends_on : hotel.plan_end_date;
            const p = periodFor(end, e.plan.days);
            const newEnd = moment.tz(p.to, TZ).endOf("day").toDate();
            if (e.plan.product && e.plan.product !== hotel.product_plan) {
                await require("../../appv1/plan").applyPlan(hotel, { product_plan: e.plan.product }, null, { transaction: t });
                done.push(`plan ${e.plan.product === "CLOUD_APP" ? "POS App" : "Local Suite"}`);
            }
            const patch = { plan_end_date: newEnd };
            if (!end || new Date(end) < new Date()) patch.plan_start_date = moment.tz(p.from, TZ).startOf("day").toDate();
            if (hotel.product_plan === "CLOUD_APP" && e.plan.devices) patch.app_device_limit = e.plan.devices + extraDevices;
            await hotel.update(patch, { transaction: t });
            await CsAccountOutlet.update({ plan_name: e.plan.planName || "" }, { where: { hotel_id: hotel.id }, transaction: t });
            if (renewal) await renewal.update({ stage: "paid", paid_at: new Date(), invoice_id: renewal.invoice_id || inv.id }, { transaction: t });
            done.push(`plan runs to ${moment(newEnd).tz(TZ).format("D MMM YYYY")}`);
        } else if (e.devices && !lines.some((x) => (parse(x.effect) || {}).plan)) {
            await hotel.update({ app_device_limit: (hotel.app_device_limit || 0) + e.devices }, { transaction: t });
            done.push(`${e.devices} more POS App device${e.devices === 1 ? "" : "s"}`);
        } else if (e.credits) {
            const row = await EBillCredit.findOne({ where: { hotel_id: hotel.id }, transaction: t });
            if (row) await row.update({ credit: (Number(row.credit) || 0) + e.credits }, { transaction: t });
            else await EBillCredit.create({ hotel_id: hotel.id, credit: e.credits }, { transaction: t });
            await EBillCreditDebit.create({ hotel_id: hotel.id, credit: true, debit: false, amount: Number(l.amount), credit_type: "paid", ebill_count: e.credits, discount: 0, business_date: new Date() }, { transaction: t });
            done.push(`${e.credits.toLocaleString("en-IN")} e-bill credits`);
        }
    }
    await require("../cs/freeze").onPaid(inv.id, t);
    if (inv.hardware_order_id) await PurchaseRollsAndPrinter.update({ payment_status: "completed" }, { where: { id: inv.hardware_order_id }, transaction: t });
    await inv.update({ applied_at: new Date() }, { transaction: t });
    if (inv.hotel_id) await CsOnboardingItem.update({ done_at: new Date(), done_by: actorId, note: `Invoice ${inv.number} paid`, invoice_id: inv.id }, { where: { hotel_id: inv.hotel_id, item_key: "payment", done_at: null }, transaction: t });
    if (inv.account_id) await addActivity(inv.account_id, inv.hotel_id, "invoice", actorId, `Invoice ${inv.number} paid${done.length ? `: ${done.join(", ")}` : ""}`, { invoiceId: inv.id }, t);
    return done;
}

/** A payment was approved: the invoice's paid total, status, and effects when fully paid. */
async function addPaid(inv, amount, t, actorId = null) {
    const paid = Math.round((Number(inv.paid) + Number(amount)) * 100) / 100;
    const full = paid >= Number(inv.total) - 0.005;
    await inv.update({ paid, status: full ? "paid" : "part_paid", paid_at: full ? new Date() : null }, { transaction: t });
    if (full) {
        await BilPayLink.update({ state: "CANCELLED" }, { where: { invoice_id: inv.id, state: "PENDING" }, transaction: t });
        return applyPaid(inv, t, actorId);
    }
    return [];
}

/* ------------------------------ read ------------------------------ */

const VIEWS = ["unpaid", "overdue", "approval", "draft", "paid", "credit", "cancelled", "all"];

function viewWhere(view) {
    const now = new Date();
    switch (view) {
        case "unpaid":
            return { kind: "invoice", status: OPEN };
        case "overdue":
            return { kind: "invoice", status: OPEN, due_at: { [Op.lt]: now } };
        case "approval":
            return { status: "approval" };
        case "draft":
            return { status: "draft" };
        case "paid":
            return { kind: "invoice", status: "paid" };
        case "credit":
            return { kind: "credit_note" };
        case "cancelled":
            return { status: "cancelled" };
        default:
            return {};
    }
}

async function list(s, query = {}) {
    need(s, "billing.view");
    const which = VIEWS.includes(query.view) ? query.view : "unpaid";
    const where = { ...viewWhere(which) };
    if (query.accountId) where.account_id = Number(query.accountId) || 0;
    if (query.hotelId) where.hotel_id = Number(query.hotelId) || 0;
    // Reports drill-down (phase 7): issued in a period (India dates).
    const DAY = /^\d{4}-\d{2}-\d{2}$/;
    if (DAY.test(query.from || "") || DAY.test(query.to || "")) {
        where.issued_at = {
            ...(DAY.test(query.from || "") ? { [Op.gte]: moment.tz(query.from, TZ).startOf("day").toDate() } : {}),
            ...(DAY.test(query.to || "") ? { [Op.lt]: moment.tz(query.to, TZ).add(1, "day").startOf("day").toDate() } : {}),
        };
    }
    const q = txt(query.q, 60);
    if (q) where[Op.or] = [{ number: { [Op.like]: `%${q}%` } }, { bill_name: { [Op.like]: `%${q}%` } }, { bill_mobile: { [Op.like]: `%${q.replace(/\D/g, "") || q}%` } }];
    const limit = 50;
    const page = Math.max(1, Number(query.page) || 1);
    const total = await BilInvoice.count({ where });
    const rows = await BilInvoice.findAll({ where, order: [["id", "DESC"]], limit, offset: (page - 1) * limit });
    const counts = {};
    for (const v of VIEWS) counts[v] = await BilInvoice.count({ where: viewWhere(v) });
    const sums = await BilInvoice.findAll({ where: viewWhere("unpaid"), attributes: [[sequelize.fn("SUM", sequelize.literal("total - paid")), "due"]], raw: true });
    const names = new Map((await AdmUser.findAll({ where: { id: [...new Set(rows.map((r) => r.created_by).filter(Boolean))] }, attributes: ["id", "name"], raw: true })).map((u) => [u.id, u.name]));
    return { serverTime: new Date().toISOString(), view: which, total, page, limit, counts, dueTotal: Number(sums[0]?.due) || 0, invoices: rows.map((r) => view(r, names)) };
}

async function detail(s, id) {
    need(s, "billing.view");
    const inv = await getInvoice(id);
    const lines = await BilInvoiceLine.findAll({ where: { invoice_id: inv.id }, order: [["sort", "ASC"], ["id", "ASC"]], raw: true });
    const pays = await BilPayment.findAll({ where: { invoice_id: inv.id }, order: [["id", "DESC"]], raw: true });
    const links = await BilPayLink.findAll({ where: { invoice_id: inv.id }, order: [["id", "DESC"]], limit: 10, raw: true });
    const hotel = inv.hotel_id ? await Hotel.findOne({ where: { id: inv.hotel_id }, attributes: ["id", "hotel_name", "plan_end_date", "product_plan"], raw: true }) : null;
    const account = inv.account_id ? await CsAccount.findOne({ where: { id: inv.account_id }, attributes: ["id", "name", "owner_mobile"], raw: true }) : null;
    const credit = inv.kind === "invoice" ? await BilInvoice.findOne({ where: { credit_for_id: inv.id }, attributes: ["id", "number"], raw: true }) : inv.credit_for_id ? await BilInvoice.findOne({ where: { id: inv.credit_for_id }, attributes: ["id", "number"], raw: true }) : null;
    const names = new Map((await AdmUser.findAll({ where: { id: [...new Set([inv.created_by, inv.approved_by, ...pays.flatMap((p) => [p.created_by, p.decided_by])].filter(Boolean))] }, attributes: ["id", "name"], raw: true })).map((u) => [u.id, u.name]));
    const cfg = await billingSettings();
    return {
        serverTime: new Date().toISOString(),
        invoice: { ...view(inv, names), approvedBy: inv.approved_by ? names.get(inv.approved_by) || `#${inv.approved_by}` : null, seller: parse(inv.seller), appliedAt: inv.applied_at },
        lines: lines.map(lineView),
        payments: pays.map((p) => ({ id: p.id, number: p.number, method: p.method, amount: Number(p.amount), reference: p.reference, hasProof: !!p.proof, status: p.status, receivedOn: p.received_on, by: p.created_by ? names.get(p.created_by) || `#${p.created_by}` : "PhonePe", decidedBy: p.decided_by ? names.get(p.decided_by) || `#${p.decided_by}` : null, rejectReason: p.reject_reason, note: p.note })),
        links: links.map((l) => ({ id: l.id, url: l.url, amount: Number(l.amount), state: l.state, expiresAt: l.expires_at, createdAt: l.createdAt, simulated: l.url.startsWith("sim:") })),
        hotel: hotel ? { id: hotel.id, name: hotel.hotel_name, planEnd: hotel.plan_end_date, product: hotel.product_plan } : null,
        account: account ? { id: account.id, name: account.name, mobile: account.owner_mobile } : null,
        related: credit ? { id: credit.id, number: credit.number } : null,
        freeDiscountPct: cfg.discountFreePct,
        can: { manage: s.can("billing.manage"), approve: s.can("billing.approve"), edit: s.can("billing.edit"), mine: inv.created_by === s.user.id },
        history: await historyOf(inv, pays),
    };
}

const ACTION_LABEL = {
    "invoice.draft": "Draft made",
    "invoice.edit": "Draft changed",
    "invoice.issue": "Issued",
    "invoice.ask_approval": "Sent for approval",
    "invoice.approve": "Approved and issued",
    "invoice.to_draft": "Sent back to draft",
    "invoice.cancel": "Cancelled (credit note)",
    "invoice.delete_draft": "Draft deleted",
    "invoice.send": "Sent to the customer",
    "payment.record": "Payment recorded",
    "payment.approve": "Payment approved",
    "payment.reject": "Payment rejected",
    "payment.reverse": "Payment reversed",
};

/** Everything that happened to an invoice and its payments: who, when, what, why (owner 2026-10-09). */
async function historyOf(inv, pays) {
    const { AdmAuditLog } = require("../../model");
    const rows = await AdmAuditLog.findAll({
        where: { [Op.or]: [{ entity: "bil_invoice", entity_id: String(inv.id) }, ...(pays.length ? [{ entity: "bil_payment", entity_id: pays.map((p) => String(p.id)) }] : [])] },
        order: [["id", "ASC"]],
        limit: 200,
        raw: true,
    });
    const people = new Map((await AdmUser.findAll({ where: { id: [...new Set(rows.map((r) => r.actor_id).filter(Boolean))] }, attributes: ["id", "name"], raw: true })).map((u) => [u.id, u.name]));
    return rows.map((r) => ({ id: r.id, at: r.createdAt, by: r.actor_id ? people.get(r.actor_id) || `#${r.actor_id}` : "BillerPe (automatic)", what: ACTION_LABEL[r.action] || r.action, summary: r.summary, reason: r.reason || "" }));
}

/** What is owed, by how late it is (from the due date). */
async function dues(s) {
    need(s, "billing.view");
    const rows = await BilInvoice.findAll({ where: { kind: "invoice", status: OPEN }, raw: true });
    const now = Date.now();
    const buckets = [
        { key: "current", label: "Not due yet", amount: 0, count: 0 },
        { key: "d15", label: "1-15 days late", amount: 0, count: 0 },
        { key: "d30", label: "16-30 days late", amount: 0, count: 0 },
        { key: "d60", label: "31-60 days late", amount: 0, count: 0 },
        { key: "d60plus", label: "More than 60 days late", amount: 0, count: 0 },
    ];
    const byAcc = new Map();
    for (const r of rows) {
        const d = due(r);
        const late = r.due_at ? Math.floor((now - new Date(r.due_at).getTime()) / 86400000) : 0;
        const b = late <= 0 ? 0 : late <= 15 ? 1 : late <= 30 ? 2 : late <= 60 ? 3 : 4;
        buckets[b].amount += d;
        buckets[b].count += 1;
        const k = r.account_id || `n:${r.bill_name}`;
        const cur = byAcc.get(k) || { accountId: r.account_id, name: r.bill_name, amount: 0, oldestLateDays: 0, invoices: 0 };
        cur.amount += d;
        cur.invoices += 1;
        cur.oldestLateDays = Math.max(cur.oldestLateDays, late);
        byAcc.set(k, cur);
    }
    for (const b of buckets) b.amount = Math.round(b.amount * 100) / 100;
    return { serverTime: new Date().toISOString(), buckets, total: Math.round(buckets.reduce((n, b) => n + b.amount, 0) * 100) / 100, accounts: [...byAcc.values()].map((a) => ({ ...a, amount: Math.round(a.amount * 100) / 100 })).sort((a, b) => b.amount - a.amount).slice(0, 50) };
}

/* ------------------------------ renewal invoice ------------------------------ */

/**
 * The renewal invoice of an outlet at the catalog price of its plan (1 year;
 * same plan as now, or the cheapest plan of its product), issued at once.
 * Used by the 1-day reminder and the outlet's "Pay now" banner.
 */
async function renewalInvoice(hotelId, renewalId, t) {
    const hotel = await Hotel.findOne({ where: { id: hotelId }, transaction: t });
    const link = await CsAccountOutlet.findOne({ where: { hotel_id: hotelId }, raw: true, transaction: t });
    await ensureCatalog();
    const items = await BilItem.findAll({ where: { kind: "plan", active: true, product: hotel.product_plan || "LOCAL_SUITE" }, order: [["price", "ASC"]], raw: true, transaction: t });
    const yearly = items.filter((i) => i.days >= 365);
    const item = yearly.find((i) => link && link.plan_name && i.plan_name === link.plan_name) || yearly[0] || items[0];
    if (!item) throw new RuleError("No plan in the catalog for this outlet.");
    const account = link ? await CsAccount.findOne({ where: { id: link.account_id }, raw: true, transaction: t }) : null;
    const lines = await buildLines(null, [{ itemId: item.id, qty: 1 }], hotel, t);
    const sel = await seller();
    const base = await billTo(hotel, account);
    const supply = supplyState({ gstin: base.bill_gstin, pin: base.pin }, sel.state);
    const tot = calc(lines, 0, supply, sel.state);
    const { pin, ...bill } = base; // eslint-disable-line no-unused-vars
    const fields = { ...bill, supply_state: supply, ...tot };
    delete fields.amounts;
    const inv = await BilInvoice.create({ kind: "invoice", status: "draft", account_id: account ? account.id : null, hotel_id: hotel.id, renewal_id: renewalId, ...fields, note: "Renewal" }, { transaction: t });
    await BilInvoiceLine.bulkCreate(lines.map((l, i) => ({ ...l, invoice_id: inv.id, amount: tot.amounts[i], effect: json(l.effect), sort: i })), { transaction: t });
    await issueIn(null, inv, t, { system: true });
    return inv;
}

/** The owner's login mobile for an outlet (for WhatsApp). */
async function ownerMobileOf(hotelId) {
    const h = await Hotel.findOne({ where: { id: hotelId }, attributes: ["owner_number"], raw: true });
    const m = String(h && h.owner_number ? h.owner_number : "").replace(/\D/g, "").slice(-10);
    return m.length === 10 ? m : "";
}

module.exports = { getInvoice, saveDraft, issueIn, issue, approve, toDraft, cancel, applyPaid, addPaid, list, detail, dues, renewalInvoice, ownerMobileOf, view, lineView, due, periodFor, paidEnd, OPEN };
