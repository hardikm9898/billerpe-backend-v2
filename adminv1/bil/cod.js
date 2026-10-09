const { Op } = require("sequelize");
const { sequelize, BilCodParcel, BilCodRemit, BilInvoice, BilPayment, AdmUser, Hotel } = require("../../model");
const { RuleError } = require("../../appv1/core");
const { need } = require("../auth");
const audit = require("../audit");
const { notify, peopleWith } = require("../crm/notify");
const { addActivity } = require("../cs/common");
const { money, moment, TZ, txt } = require("./common");

// India Post cash on delivery (owner 2026-10-09). The sales team sends
// printers and rolls (with their invoice) by India Post COD; the post office
// collects from each restaurant and later pays BillerPe ONE cheque for many
// parcels, less its charges. Here: book a COD parcel against an invoice;
// when the cheque comes, record it with the parcels it covers (the
// difference is the post office's charges) and send it for approval; on
// approval every invoice gets its COD payment in full - nothing stays hidden.

const MAX_CHARGES_PCT = 20;
const CONSIGNMENT = /^[A-Z0-9-]{6,40}$/;
const OPEN = ["issued", "part_paid"];

const day = (v, label) => {
    const d = v ? moment.tz(String(v).slice(0, 10), "YYYY-MM-DD", true, TZ) : moment().tz(TZ);
    if (!d.isValid() || d.isAfter(moment().tz(TZ).endOf("day"))) throw new RuleError(`${label}: choose a day (not in the future).`);
    return d.format("YYYY-MM-DD");
};

/** What is still open for COD on an invoice: due minus parcels already on their way. */
async function openForCod(inv, t) {
    const booked = Number((await BilCodParcel.sum("amount", { where: { invoice_id: inv.id, status: ["booked", "remitting"] }, transaction: t })) || 0);
    return Math.max(0, Math.round((Number(inv.total) - Number(inv.paid) - booked) * 100) / 100);
}

/** Books a COD parcel inside a transaction (also used when stock goes out by India Post COD). */
async function bookIn(s, input, t) {
    const inv = await BilInvoice.findOne({ where: { id: Number(input.invoiceId) || 0, kind: "invoice" }, transaction: t, lock: t.LOCK.UPDATE });
    if (!inv || !OPEN.includes(inv.status)) throw new RuleError("Choose an issued invoice that is still waiting for payment.");
    const consignment = String(input.consignment || "").toUpperCase().replace(/\s+/g, "");
    if (!CONSIGNMENT.test(consignment)) throw new RuleError("Write the India Post consignment number (letters and digits).");
    if (await BilCodParcel.findOne({ where: { consignment }, transaction: t })) throw new RuleError(`Consignment ${consignment} is already booked.`);
    const left = await openForCod(inv, t);
    const amount = input.amount === undefined || input.amount === null || input.amount === "" ? left : Math.round(Number(input.amount) * 100) / 100;
    if (!(amount > 0)) throw new RuleError(left > 0 ? "Write the amount the post office collects." : "Nothing is left to collect on this invoice.");
    if (amount > left + 0.005) throw new RuleError(`More than is left to collect on ${inv.number}: ${money(left)}.`);
    const p = await BilCodParcel.create({ invoice_id: inv.id, hotel_id: inv.hotel_id, consignment, amount, booked_on: day(input.bookedOn, "Booked on"), move_id: input.moveId || null, note: txt(input.note, 300), created_by: s.user.id }, { transaction: t });
    if (inv.account_id) await addActivity(inv.account_id, inv.hotel_id, "invoice", s.user.id, `India Post COD ${consignment}: ${money(amount)} to collect for ${inv.number}`, { invoiceId: inv.id, parcelId: p.id }, t);
    await audit.write(s, { action: "cod.book", entity: "bil_invoice", entityId: inv.id, summary: `COD parcel ${consignment} for ${money(amount)}` }, { transaction: t });
    return p;
}

async function book(s, input = {}) {
    need(s, "billing.manage");
    return sequelize.transaction(async (t) => {
        const p = await bookIn(s, input, t);
        return { id: p.id, consignment: p.consignment, amount: Number(p.amount) };
    });
}

/** The parcel came back unpaid (the restaurant refused it). */
async function returned(s, parcelId, reason) {
    need(s, "billing.manage");
    const why = txt(reason, 200);
    if (why.length < 3) throw new RuleError("Write why it came back.");
    return sequelize.transaction(async (t) => {
        const p = await BilCodParcel.findOne({ where: { id: Number(parcelId) || 0 }, transaction: t, lock: t.LOCK.UPDATE });
        if (!p || p.status !== "booked") throw new RuleError("Only a parcel still on its way can come back.");
        await p.update({ status: "returned", note: txt(`${p.note ? `${p.note} · ` : ""}returned: ${why}`, 300) }, { transaction: t });
        const inv = await BilInvoice.findOne({ where: { id: p.invoice_id }, attributes: ["id", "number", "account_id", "hotel_id"], raw: true, transaction: t });
        if (inv && inv.account_id) await addActivity(inv.account_id, inv.hotel_id, "invoice", s.user.id, `India Post COD ${p.consignment} came back unpaid (${why})`, { invoiceId: inv.id }, t);
        await audit.write(s, { action: "cod.returned", entity: "bil_invoice", entityId: p.invoice_id, summary: `COD parcel ${p.consignment} returned`, reason: why }, { transaction: t });
        return { id: p.id, status: "returned" };
    });
}

/** The post office's cheque: the parcels it pays, its photo; waits for an approver (an approver's own goes at once). */
async function remit(s, input = {}) {
    need(s, "billing.manage");
    const reference = txt(input.reference, 60);
    if (reference.length < 4) throw new RuleError("Write the cheque or transfer number.");
    const receivedOn = day(input.receivedOn, "Received on");
    const amount = Math.round(Number(input.amount) * 100) / 100;
    if (!(amount > 0)) throw new RuleError("Write the amount the post office paid.");
    const ids = [...new Set((Array.isArray(input.parcelIds) ? input.parcelIds : []).map(Number).filter(Boolean))];
    if (!ids.length) throw new RuleError("Tick the parcels this cheque pays.");
    const proof = await require("./payments").saveProof(input.proof);
    if (!proof) throw new RuleError("Add a photo of the cheque or the bank credit.");
    const res = await sequelize.transaction(async (t) => {
        const parcels = await BilCodParcel.findAll({ where: { id: ids }, transaction: t, lock: t.LOCK.UPDATE });
        if (parcels.length !== ids.length) throw new RuleError("A ticked parcel does not exist.");
        const bad = parcels.find((p) => p.status !== "booked");
        if (bad) throw new RuleError(`Parcel ${bad.consignment} is already ${bad.status === "remitting" ? "on another cheque" : bad.status}.`);
        const total = Math.round(parcels.reduce((n, p) => n + Number(p.amount), 0) * 100) / 100;
        if (amount > total + 0.005) throw new RuleError(`The cheque (${money(amount)}) is more than the ticked parcels (${money(total)}). Tick the missing parcels.`);
        const charges = Math.round((total - amount) * 100) / 100;
        if (charges > (total * MAX_CHARGES_PCT) / 100) throw new RuleError(`Post charges of ${money(charges)} are more than ${MAX_CHARGES_PCT}% of ${money(total)}. Check the ticked parcels.`);
        const r = await BilCodRemit.create({ reference, received_on: receivedOn, amount, parcels_total: total, charges, proof, note: txt(input.note, 300), created_by: s.user.id }, { transaction: t });
        await BilCodParcel.update({ status: "remitting", remit_id: r.id }, { where: { id: ids }, transaction: t });
        await audit.write(s, { action: "cod.remit", entity: "bil_cod_remit", entityId: r.id, summary: `India Post cheque ${reference}: ${money(amount)} for ${parcels.length} parcels (${money(charges)} charges)` }, { transaction: t });
        if (!s.can("billing.approve")) {
            for (const p of await peopleWith("billing.approve")) {
                await notify(p.id, { type: "billing.cod", title: `India Post cheque to approve: ${money(amount)}`, body: `${reference} · ${parcels.length} parcels · charges ${money(charges)}`, link: "/billing/cod?tab=cheques", ref: `cod:${r.id}` }, { transaction: t });
            }
        }
        return r;
    });
    if (s.can("billing.approve")) return decide(s, res.id, true);
    return { id: res.id, status: "pending" };
}

/** An approver decides a cheque: approved = every parcel's invoice gets its COD payment. */
async function decide(s, remitId, ok, reason) {
    need(s, "billing.approve");
    const payments = require("./payments");
    const invoices = require("./invoices");
    return sequelize.transaction(async (t) => {
        const r = await BilCodRemit.findOne({ where: { id: Number(remitId) || 0 }, transaction: t, lock: t.LOCK.UPDATE });
        if (!r || r.status !== "pending") throw new RuleError("This cheque is already decided.");
        const parcels = await BilCodParcel.findAll({ where: { remit_id: r.id, status: "remitting" }, transaction: t, lock: t.LOCK.UPDATE });
        if (!ok) {
            const why = txt(reason, 200);
            if (why.length < 3) throw new RuleError("Write why it is refused.");
            await r.update({ status: "rejected", decided_by: s.user.id, decided_at: new Date(), reject_reason: why }, { transaction: t });
            await BilCodParcel.update({ status: "booked", remit_id: null }, { where: { remit_id: r.id }, transaction: t });
            if (r.created_by && r.created_by !== s.user.id) await notify(r.created_by, { type: "billing.cod", title: `India Post cheque refused: ${r.reference}`, body: why, link: "/billing/cod?tab=cheques", ref: `codno:${r.id}` }, { transaction: t });
            await audit.write(s, { action: "cod.reject", entity: "bil_cod_remit", entityId: r.id, summary: `Refused India Post cheque ${r.reference}`, reason: why }, { transaction: t });
            return { id: r.id, status: "rejected" };
        }
        for (const p of parcels) {
            const inv = await invoices.getInvoice(p.invoice_id, t, true);
            if (!invoices.OPEN.includes(inv.status)) throw new RuleError(`Invoice ${inv.number} (parcel ${p.consignment}) is ${inv.status.replace("_", " ")} now. Take that parcel off the cheque first.`);
            if (Number(p.amount) > invoices.due(inv) + 0.005) throw new RuleError(`Parcel ${p.consignment} is more than is still due on ${inv.number}.`);
            const pay = await BilPayment.create({ invoice_id: inv.id, account_id: inv.account_id, method: "cod", amount: p.amount, reference: `COD ${p.consignment}`, proof: r.proof, status: "pending", received_on: r.received_on, note: `India Post cheque ${r.reference}`, created_by: r.created_by }, { transaction: t });
            await payments.approveIn(pay, inv, t, s.user.id);
            await audit.write(s, { action: "payment.record", entity: "bil_payment", entityId: pay.id, summary: `${money(p.amount)} by India Post COD ${p.consignment} for ${inv.number} (cheque ${r.reference})` }, { transaction: t });
            await p.update({ status: "remitted" }, { transaction: t });
        }
        await r.update({ status: "approved", decided_by: s.user.id, decided_at: new Date() }, { transaction: t });
        if (r.created_by && r.created_by !== s.user.id) await notify(r.created_by, { type: "billing.cod", title: `India Post cheque approved: ${r.reference}`, body: `${parcels.length} invoices paid`, link: "/billing/cod?tab=cheques", ref: `codok:${r.id}` }, { transaction: t });
        await audit.write(s, { action: "cod.approve", entity: "bil_cod_remit", entityId: r.id, summary: `Approved India Post cheque ${r.reference}: ${parcels.length} invoices paid, ${money(r.charges)} post charges` }, { transaction: t });
        return { id: r.id, status: "approved", invoices: parcels.length };
    });
}

/* ------------------------------ lists ------------------------------ */

async function names(ids) {
    return new Map((await AdmUser.findAll({ where: { id: [...new Set(ids.filter(Boolean))] }, attributes: ["id", "name"], raw: true })).map((u) => [u.id, u.name]));
}

async function parcelViews(rows) {
    const invs = new Map((await BilInvoice.findAll({ where: { id: [...new Set(rows.map((p) => p.invoice_id))] }, attributes: ["id", "number", "bill_name", "status"], raw: true })).map((i) => [i.id, i]));
    const who = await names(rows.map((p) => p.created_by));
    return rows.map((p) => ({ id: p.id, consignment: p.consignment, amount: Number(p.amount), bookedOn: p.booked_on, status: p.status, remitId: p.remit_id, note: p.note, invoice: invs.has(p.invoice_id) ? { id: p.invoice_id, number: invs.get(p.invoice_id).number, billName: invs.get(p.invoice_id).bill_name, status: invs.get(p.invoice_id).status } : { id: p.invoice_id }, by: who.get(p.created_by) || "" }));
}

/** COD parcels (default: those whose money is not in yet), oldest first. */
async function parcels(s, query = {}) {
    need(s, "billing.view");
    const status = ["booked", "remitting", "remitted", "returned"].includes(query.status) ? query.status : "booked";
    const where = { status };
    if (query.invoiceId) where.invoice_id = Number(query.invoiceId) || 0;
    const q = txt(query.q, 40).toUpperCase();
    if (q) where.consignment = { [Op.like]: `%${q}%` };
    const rows = await BilCodParcel.findAll({ where, order: status === "booked" ? [["booked_on", "ASC"], ["id", "ASC"]] : [["id", "DESC"]], limit: 300, raw: true });
    const counts = {};
    for (const k of ["booked", "remitting", "remitted", "returned"]) counts[k] = await BilCodParcel.count({ where: { status: k } });
    const waiting = Number((await BilCodParcel.sum("amount", { where: { status: ["booked", "remitting"] } })) || 0);
    return { parcels: await parcelViews(rows), counts, waiting };
}

/** India Post cheques with their parcels. */
async function remits(s, query = {}) {
    need(s, "billing.view");
    const where = ["pending", "approved", "rejected"].includes(query.status) ? { status: query.status } : {};
    const rows = await BilCodRemit.findAll({ where, order: [["id", "DESC"]], limit: 100, raw: true });
    const ps = rows.length ? await BilCodParcel.findAll({ where: { remit_id: rows.map((r) => r.id) }, raw: true }) : [];
    const pv = await parcelViews(ps);
    const who = await names(rows.flatMap((r) => [r.created_by, r.decided_by]));
    return {
        pending: await BilCodRemit.count({ where: { status: "pending" } }),
        remits: rows.map((r) => ({ id: r.id, reference: r.reference, receivedOn: r.received_on, amount: Number(r.amount), parcelsTotal: Number(r.parcels_total), charges: Number(r.charges), note: r.note, status: r.status, by: who.get(r.created_by) || "", decidedBy: r.decided_by ? who.get(r.decided_by) || "" : "", rejectReason: r.reject_reason, parcels: pv.filter((p) => p.remitId === r.id) })),
    };
}

async function proofLink(s, remitId) {
    need(s, "billing.view");
    const r = await BilCodRemit.findOne({ where: { id: Number(remitId) || 0 }, attributes: ["proof"], raw: true });
    if (!r || !r.proof) throw new RuleError("No photo for this cheque.");
    return { url: await require("./payments").store.link(r.proof) };
}

module.exports = { book, bookIn, returned, remit, decide, parcels, remits, proofLink, openForCod };
