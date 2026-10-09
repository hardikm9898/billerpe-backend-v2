const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const { Op } = require("sequelize");
const { sequelize, BilInvoice, BilPayment, BilPayLink, AdmUser } = require("../../model");
const { RuleError } = require("../../appv1/core");
const worker = require("../../services/admin/worker");
const { need } = require("../auth");
const audit = require("../audit");
const { notify, peopleWith } = require("../crm/notify");
const invoices = require("./invoices");
const { nextNumber, seller, money, moment, TZ, txt, json, parse } = require("./common");

// Money in (design doc "Billing for BillerPe itself"):
//   manual - UPI, bank transfer, cash or card, with a screenshot; it counts
//     once someone with "approve payments" approves it (an approver who
//     records it approves it at once);
//   PhonePe - a payment link for the invoice. A link is NEVER marked paid
//     from a callback alone: its order is read back from PhonePe first (the
//     shared /payment/webhook hands our "BPE..." orders here, and a job
//     checks open links every 5 minutes in case a callback is lost).
// Live PhonePe only with ADMIN_PAY_LIVE=1; otherwise links are simulated
// (test servers), and only simulated links can be "paid" from the panel.

const METHODS = ["upi", "bank", "cash", "card", "cheque"];
const live = () => process.env.ADMIN_PAY_LIVE === "1";

/* ------------------------------ proof files ------------------------------ */

const store = {
    async put(buffer, mime) {
        const ext = { "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "application/pdf": ".pdf" }[mime] || ".bin";
        const key = `bil-proofs/${moment().tz(TZ).format("YYYY/MM")}/${Date.now()}-${crypto.randomBytes(6).toString("hex")}${ext}`;
        if (process.env.ADMIN_FILES_LIVE === "1" || live()) {
            const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
            await new S3Client({ region: process.env.ADMIN_FILES_REGION || "ap-south-1" }).send(new PutObjectCommand({ Bucket: process.env.ADMIN_FILES_BUCKET || "bpe-upload-data", Key: key, Body: buffer, ContentType: mime }));
            return `s3:${key}`;
        }
        const file = path.join(__dirname, "../../public", key);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, buffer);
        return `/${key}`;
    },
    async link(ref) {
        if (!ref || !ref.startsWith("s3:")) return ref;
        const { S3Client, GetObjectCommand } = require("@aws-sdk/client-s3");
        const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
        return getSignedUrl(new S3Client({ region: process.env.ADMIN_FILES_REGION || "ap-south-1" }), new GetObjectCommand({ Bucket: process.env.ADMIN_FILES_BUCKET || "bpe-upload-data", Key: ref.slice(3) }), { expiresIn: 900 });
    },
};

/** { name, mime, data (base64) } -> stored ref, at most 4 MB of image or PDF. */
async function saveProof(proof) {
    if (!proof || !proof.data) return null;
    const mime = String(proof.mime || "");
    if (!["image/png", "image/jpeg", "image/webp", "application/pdf"].includes(mime)) throw new RuleError("The proof must be a photo (PNG, JPG, WebP) or a PDF.");
    const buffer = Buffer.from(String(proof.data).replace(/^data:[^,]+,/, ""), "base64");
    if (!buffer.length || buffer.length > 4 * 1024 * 1024) throw new RuleError("The proof file must be under 4 MB.");
    return store.put(buffer, mime);
}

/* ------------------------------ reversing ------------------------------ */

/**
 * Money recorded by mistake (owner 2026-10-09: only staff with the edit
 * right, with a reason, in the invoice's history). An approved payment comes
 * off the invoice; once the invoice was paid in full and took effect (plan,
 * devices, credits) it cannot be reversed here - cancel it with a credit note.
 */
async function reverse(s, paymentId, reason) {
    need(s, "billing.edit");
    const why = txt(reason, 200);
    if (why.length < 5) throw new RuleError("Write why the payment is reversed.");
    return sequelize.transaction(async (t) => {
        const pay = await BilPayment.findOne({ where: { id: Number(paymentId) || 0 }, transaction: t, lock: t.LOCK.UPDATE });
        if (!pay || !["approved", "pending"].includes(pay.status)) throw new RuleError("Only a recorded or approved payment can be reversed.");
        const inv = await invoices.getInvoice(pay.invoice_id, t, true);
        if (pay.status === "approved") {
            if (inv.applied_at) throw new RuleError("This invoice was paid in full and took effect. Cancel it with a credit note instead.");
            const paid = Math.max(0, Math.round((Number(inv.paid) - Number(pay.amount)) * 100) / 100);
            await inv.update({ paid, status: paid > 0.005 ? "part_paid" : "issued", paid_at: null }, { transaction: t });
        }
        await pay.update({ status: "reversed", reject_reason: why, decided_by: s.user.id, decided_at: new Date() }, { transaction: t });
        // A new outlet's token that is taken back freezes it, as a rejected one does.
        await require("../cs/freeze").onTokenRejected(pay.id, t);
        await audit.write(s, { action: "payment.reverse", entity: "bil_payment", entityId: pay.id, summary: `Reversed ${money(pay.amount)} (${pay.method.toUpperCase()} ${pay.reference || ""}) on ${inv.number}`, reason: why }, { transaction: t });
        if (inv.account_id) await require("../cs/common").addActivity(inv.account_id, inv.hotel_id, "invoice", s.user.id, `${s.user.name} reversed ${money(pay.amount)} on ${inv.number} (${why})`, { invoiceId: inv.id }, t);
        if (pay.created_by && pay.created_by !== s.user.id) await notify(pay.created_by, { type: "billing.reversed", title: `Payment reversed: ${money(pay.amount)}`, body: `${inv.number}: ${why}`, link: `/billing/invoices/${inv.id}`, ref: `rev:${pay.id}` }, { transaction: t });
        return { id: pay.id, status: "reversed" };
    });
}

/* ------------------------------ approving ------------------------------ */

async function approveIn(pay, inv, t, actorId) {
    const sel = await seller();
    const number = await nextNumber("receipt", sel.prefixes.receipt || "BPR", t);
    await pay.update({ status: "approved", number, decided_by: actorId, decided_at: new Date() }, { transaction: t });
    return invoices.addPaid(inv, pay.amount, t, actorId);
}

/** A hand payment's fields, checked before any write. proofRef = a proof stored earlier (outlet setup). */
async function cleanPayment(s, input = {}, { proofRef = null, payer = s } = {}) {
    const method = METHODS.includes(input.method) ? input.method : null;
    if (!method) throw new RuleError("Choose how it was paid.");
    const amount = Math.round(Number(input.amount) * 100) / 100;
    if (!(amount > 0)) throw new RuleError("Write the amount received.");
    const reference = txt(input.reference, 80);
    if (["upi", "bank", "cheque"].includes(method) && reference.length < 4) throw new RuleError("Write the UTR / transaction or cheque number.");
    const on = input.receivedOn ? moment.tz(String(input.receivedOn).slice(0, 10), "YYYY-MM-DD", true, TZ) : moment().tz(TZ);
    if (!on.isValid() || on.isAfter(moment().tz(TZ).endOf("day"))) throw new RuleError("Choose the day it was received (not in the future).");
    const proof = proofRef || (await saveProof(input.proof));
    if (["upi", "bank"].includes(method) && !proof && !payer.can("billing.approve")) throw new RuleError("Attach the payment screenshot.");
    return { method, amount, reference, receivedOn: on.format("YYYY-MM-DD"), proof, note: txt(input.note, 300) };
}

/**
 * Writes a checked payment against a locked invoice. createdBy = who took
 * the money (outlet setup: the salesperson, also when an approver approves
 * the setup later); an approver's own entry is approved at once.
 */
async function recordIn(s, inv, v, t, { createdBy = s.user.id } = {}) {
    if (inv.kind !== "invoice" || !invoices.OPEN.includes(inv.status)) throw new RuleError("This invoice is not waiting for payment.");
    const pending = Number((await BilPayment.sum("amount", { where: { invoice_id: inv.id, status: "pending" }, transaction: t })) || 0);
    if (v.amount > invoices.due(inv) - pending + 0.005) throw new RuleError(`More than is due: ${money(invoices.due(inv) - pending)}.`);
    if (v.reference && (await BilPayment.findOne({ where: { reference: v.reference, method: v.method, status: { [Op.notIn]: ["rejected", "reversed"] } }, transaction: t }))) throw new RuleError("A payment with this reference is already recorded.");
    const pay = await BilPayment.create({ invoice_id: inv.id, account_id: inv.account_id, method: v.method, amount: v.amount, reference: v.reference, proof: v.proof, status: "pending", received_on: v.receivedOn, note: v.note, created_by: createdBy }, { transaction: t });
    let done = [];
    if (s.can("billing.approve")) done = await approveIn(pay, inv, t, s.user.id);
    else {
        for (const p of await peopleWith("billing.approve")) {
            await notify(p.id, { type: "billing.payment", title: `Payment to approve: ${money(v.amount)}`, body: `${inv.bill_name} · ${inv.number} · ${v.method.toUpperCase()} ${v.reference}`, link: `/billing/payments`, ref: `pay:${pay.id}` }, { transaction: t });
        }
    }
    await audit.write(s, { action: "payment.record", entity: "bil_payment", entityId: pay.id, summary: `${money(v.amount)} by ${v.method} for ${inv.number}${pay.status === "approved" ? " (approved)" : ""}`, after: { reference: v.reference, amount: v.amount } }, { transaction: t });
    return { id: pay.id, status: pay.status, number: pay.number, effects: done };
}

/** Records money received by hand. */
async function record(s, invoiceId, input = {}) {
    need(s, "billing.manage");
    const v = await cleanPayment(s, input);
    return sequelize.transaction(async (t) => recordIn(s, await invoices.getInvoice(invoiceId, t, true), v, t));
}

async function decide(s, paymentId, ok, reason) {
    need(s, "billing.approve");
    return sequelize.transaction(async (t) => {
        const pay = await BilPayment.findOne({ where: { id: Number(paymentId) || 0 }, transaction: t, lock: t.LOCK.UPDATE });
        if (!pay || pay.status !== "pending") throw new RuleError("This payment is not waiting for approval.");
        const inv = await invoices.getInvoice(pay.invoice_id, t, true);
        let done = [];
        if (ok) {
            if (!invoices.OPEN.includes(inv.status)) throw new RuleError("The invoice is no longer waiting for payment.");
            if (Number(pay.amount) > invoices.due(inv) + 0.005) throw new RuleError("This is more than is still due.");
            done = await approveIn(pay, inv, t, s.user.id);
        } else {
            const why = txt(reason, 200);
            if (why.length < 3) throw new RuleError("Write why it is rejected.");
            await pay.update({ status: "rejected", reject_reason: why, decided_by: s.user.id, decided_at: new Date() }, { transaction: t });
            // A new outlet's token that turns out false: the outlet freezes at once (owner 2026-10-09).
            await require("../cs/freeze").onTokenRejected(pay.id, t);
        }
        if (pay.created_by && pay.created_by !== s.user.id) await notify(pay.created_by, { type: "billing.decided", title: ok ? `Payment approved: ${money(pay.amount)}` : `Payment rejected: ${money(pay.amount)}`, body: ok ? `${inv.bill_name} · ${inv.number}` : txt(reason, 200), link: `/billing/invoices/${inv.id}`, ref: `paydec:${pay.id}` }, { transaction: t });
        await audit.write(s, { action: ok ? "payment.approve" : "payment.reject", entity: "bil_payment", entityId: pay.id, summary: `${ok ? "Approved" : "Rejected"} ${money(pay.amount)} for ${inv.number}`, reason: txt(reason, 300) }, { transaction: t });
        return { id: pay.id, status: pay.status, number: pay.number, effects: done };
    });
}

async function pendingList(s) {
    need(s, "billing.view");
    const rows = await BilPayment.findAll({ where: { status: "pending" }, order: [["id", "ASC"]], raw: true });
    const invs = new Map((rows.length ? await BilInvoice.findAll({ where: { id: rows.map((r) => r.invoice_id) }, raw: true }) : []).map((i) => [i.id, i]));
    const names = new Map((await AdmUser.findAll({ where: { id: [...new Set(rows.map((r) => r.created_by).filter(Boolean))] }, attributes: ["id", "name"], raw: true })).map((u) => [u.id, u.name]));
    const recent = await BilPayment.findAll({ where: { status: { [Op.ne]: "pending" } }, order: [["id", "DESC"]], limit: 30, raw: true });
    const rInvs = new Map((recent.length ? await BilInvoice.findAll({ where: { id: recent.map((r) => r.invoice_id) }, attributes: ["id", "number", "bill_name"], raw: true }) : []).map((i) => [i.id, i]));
    const row = (p, inv) => ({ id: p.id, number: p.number, method: p.method, amount: Number(p.amount), reference: p.reference, hasProof: !!p.proof, status: p.status, receivedOn: p.received_on, note: p.note, rejectReason: p.reject_reason, by: p.created_by ? names.get(p.created_by) || `#${p.created_by}` : "PhonePe", invoice: inv ? { id: inv.id, number: inv.number, billName: inv.bill_name, total: Number(inv.total || 0), due: inv.total !== undefined ? invoices.due(inv) : null } : null });
    return { serverTime: new Date().toISOString(), pending: rows.map((p) => row(p, invs.get(p.invoice_id))), recent: recent.map((p) => row(p, rInvs.get(p.invoice_id))) };
}

async function proofLink(s, paymentId) {
    need(s, "billing.view");
    const pay = await BilPayment.findByPk(Number(paymentId) || 0, { raw: true });
    if (!pay || !pay.proof) throw new RuleError("No proof attached.");
    return { url: await store.link(pay.proof) };
}

/* ------------------------------ PhonePe links ------------------------------ */

let client = null;
function phonepe() {
    if (!client) {
        const { StandardCheckoutClient, Env } = require("pg-sdk-node");
        client = StandardCheckoutClient.getInstance(process.env.PHONEPE_MERCHANT_ID, process.env.PHONEPE_SECRET_KEY, 1, Env.PRODUCTION);
    }
    return client;
}

/** The open link for an invoice's due amount, made when there is none. */
async function linkFor(invoiceId, createdBy = null) {
    const inv = await invoices.getInvoice(invoiceId);
    if (inv.kind !== "invoice" || !invoices.OPEN.includes(inv.status)) throw new RuleError("This invoice is not waiting for payment.");
    const amount = invoices.due(inv);
    const open = await BilPayLink.findOne({ where: { invoice_id: inv.id, state: "PENDING", amount, expires_at: { [Op.gt]: new Date(Date.now() + 3600000) } }, order: [["id", "DESC"]] });
    if (open) return open;
    const merchantOrderId = `BPE${inv.id}T${Date.now().toString(36).toUpperCase()}${crypto.randomBytes(2).toString("hex").toUpperCase()}`;
    let fields;
    if (live()) {
        const { StandardCheckoutPayRequest } = require("pg-sdk-node");
        const request = StandardCheckoutPayRequest.builder()
            .merchantOrderId(merchantOrderId)
            .amount(Math.round(amount * 100))
            .metaInfo({ udf1: "billerpe-invoice", udf2: inv.number || "", udf3: String(inv.id) })
            .build();
        const r = await phonepe().pay(request);
        fields = { phonepe_order_id: r.orderId || null, url: r.redirectUrl || "", state: r.state === "PENDING" || !r.state ? "PENDING" : r.state, expires_at: r.expireAt ? new Date(r.expireAt) : moment().add(7, "days").toDate() };
    } else {
        fields = { url: `sim:${merchantOrderId}`, state: "PENDING", expires_at: moment().add(7, "days").toDate() };
    }
    return BilPayLink.create({ invoice_id: inv.id, merchant_order_id: merchantOrderId, amount, created_by: createdBy, ...fields });
}

async function createLink(s, invoiceId) {
    need(s, "billing.manage");
    const l = await linkFor(invoiceId, s.user.id);
    return { id: l.id, url: l.url, amount: Number(l.amount), expiresAt: l.expires_at, simulated: l.url.startsWith("sim:") };
}

/**
 * Reads a link's order from PhonePe (or the simulated state) and records
 * the payment once when it is COMPLETED for the full amount.
 */
async function check(merchantOrderId) {
    const link = await BilPayLink.findOne({ where: { merchant_order_id: String(merchantOrderId || "") } });
    if (!link) return { state: "UNKNOWN" };
    let state = link.state;
    let detail = parse(link.detail) || {};
    if (live()) {
        const r = await phonepe().getOrderStatus(link.merchant_order_id);
        state = r.state || state;
        detail = { amount: r.amount, paymentDetails: r.paymentDetails || [] };
    }
    await link.update({ state: state === "COMPLETED" ? "COMPLETED" : state, checked_at: new Date(), detail: json(detail) });
    if (state !== "COMPLETED") return { state };
    const paidPaise = Number(detail.amount ?? Math.round(Number(link.amount) * 100));
    if (Math.abs(paidPaise - Math.round(Number(link.amount) * 100)) > 0) {
        console.error(`[billing] PhonePe ${link.merchant_order_id}: paid ${paidPaise} paise, link was for ${link.amount}`);
        return { state: "AMOUNT_MISMATCH" };
    }
    const txn = (detail.paymentDetails || []).find((p) => p.state === "COMPLETED") || (detail.paymentDetails || [])[0] || {};
    return sequelize.transaction(async (t) => {
        if (await BilPayment.findOne({ where: { link_id: link.id }, transaction: t })) return { state, already: true };
        const inv = await invoices.getInvoice(link.invoice_id, t, true);
        const pay = await BilPayment.create({ invoice_id: inv.id, account_id: inv.account_id, method: "phonepe", amount: link.amount, reference: txt(txn.transactionId || link.merchant_order_id, 80), status: "pending", received_on: moment().tz(TZ).format("YYYY-MM-DD"), link_id: link.id, note: txn.paymentMode ? `PhonePe ${txn.paymentMode}` : "PhonePe" }, { transaction: t });
        // Confirmed by PhonePe: no person needs to approve it. Money for an
        // invoice that is no longer open waits for a person (refund or credit).
        let done = [];
        if (invoices.OPEN.includes(inv.status) && Number(link.amount) <= invoices.due(inv) + 0.005) done = await approveIn(pay, inv, t, null);
        else await pay.update({ note: `${pay.note} - the invoice was ${inv.status} when this came in: refund or credit it` }, { transaction: t });
        const owner = inv.account_id ? await require("../../model").CsAccount.findOne({ where: { id: inv.account_id }, attributes: ["success_owner_id"], raw: true, transaction: t }) : null;
        if (owner && owner.success_owner_id) await notify(owner.success_owner_id, { type: "billing.paid", title: `Paid online: ${money(link.amount)}`, body: `${inv.bill_name} · ${inv.number}${done.length ? ` · ${done.join(", ")}` : ""}`, link: `/billing/invoices/${inv.id}`, ref: `paid:${link.id}` }, { transaction: t });
        return { state, paymentId: pay.id, effects: done };
    });
}

/** Test servers only: the customer "pays" (or abandons) a simulated link. */
async function simulate(s, linkId, state = "COMPLETED") {
    need(s, "billing.approve");
    if (live()) throw new RuleError("Not on a live server.");
    const link = await BilPayLink.findByPk(Number(linkId) || 0);
    if (!link || !link.url.startsWith("sim:")) throw new RuleError("Not a simulated link.");
    // What PhonePe would answer for this order.
    await link.update({ state: state === "FAILED" ? "FAILED" : "COMPLETED", detail: json({ amount: Math.round(Number(link.amount) * 100), paymentDetails: [{ transactionId: `SIM${link.id}`, paymentMode: "UPI_QR", state: state === "FAILED" ? "FAILED" : "COMPLETED" }] }) });
    return check(link.merchant_order_id);
}

/** Job: open links of the last 8 days, read back from PhonePe. */
async function pollLinks() {
    if (!live()) return "not live";
    const rows = await BilPayLink.findAll({ where: { state: "PENDING", createdAt: { [Op.gte]: moment().subtract(8, "days").toDate() } }, order: [["checked_at", "ASC"]], limit: 50 });
    let paid = 0;
    for (const l of rows) {
        try {
            const r = await check(l.merchant_order_id);
            if (r.paymentId) paid += 1;
        } catch (e) {
            console.error(`[billing] PhonePe check ${l.merchant_order_id}:`, e && e.message);
        }
    }
    return `checked ${rows.length}, paid ${paid}`;
}

worker.registerJob("bil.links", pollLinks);
worker.registerSchedule("bil.links", 300);

/**
 * Quick payment link (old panel: Generate Payment Link; owner 2026-10-08:
 * the link makes the invoice). One step: the GST invoice for the outlet or
 * buyer and the lines, issued, and its PhonePe link. A discount above the
 * free limit waits for approval first, and then no link is made yet.
 */
async function quickLink(s, input = {}) {
    need(s, "billing.manage");
    const invoices = require("./invoices");
    const draft = await invoices.saveDraft(s, input);
    const issued = await invoices.issue(s, draft.id);
    if (issued.status !== "issued") return { invoiceId: draft.id, status: issued.status, needsApproval: true };
    const l = await linkFor(draft.id, s.user.id);
    return { invoiceId: draft.id, number: issued.number, status: "issued", url: l.url, amount: Number(l.amount), simulated: l.url.startsWith("sim:") };
}

module.exports = { record, cleanPayment, recordIn, reverse, decide, pendingList, proofLink, linkFor, createLink, check, simulate, pollLinks, live, store, saveProof, METHODS, quickLink };
