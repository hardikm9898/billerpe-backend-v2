const { Op } = require("sequelize");
const { sequelize, Hotel, HotelUser, Menu, Order, LocalServerRegistration, AppDevice, CsAccountOutlet, CsOnboardingItem, BilInvoice, CrmCall } = require("../../model");
const { RuleError } = require("../../appv1/core");
const { need } = require("../auth");
const { workingHours } = require("../crm/util");
const { customerSettings, addActivity, dueOnDay, mobile10, spellings, txt, moment, TZ } = require("./common");

// An outlet's onboarding checklist (template in Settings > Customers). Steps
// marked auto tick themselves from the outlet's own data - an invoice of the
// outlet paid in full, the outlet and its owner login exist, menu items, the PC registration (Local Suite) or a POS
// App phone (POS App), the first settled bill. The rest are ticked by staff.
// All steps done = onboarding done.
//
// Proof (owner 2026-10-09): nothing is ticked on someone's word. Steps the
// outlet's data proves (outlet, menu, PC, phones, first bill) tick only by
// themselves, with the date. "Payment received" ticks when the outlet's
// invoice is paid in full (by hand only by choosing such a paid invoice).
// Steps done by people need their proof: a photo (printers set up,
// training), a call (from its due day, with what the owner said; a call to
// the owner's mobile in the call log is linked), or a written note.

/** Steps saved before proof kinds existed: the built-in ones keep their sensible proof. */
function defaultProof(key) {
    if (key === "printers" || key === "training") return "photo";
    if (key === "day7" || key === "day30") return "call";
    return "note";
}
const isPayment = (it) => it.auto === "payment" || it.item_key === "payment";
const proofKindOf = (it) => (it.auto || isPayment(it) ? null : it.proof_kind || defaultProof(it.item_key));

/** Makes the checklist for one outlet (once) and ticks what is already true. */
async function start(link, { ownerId = null, at = new Date(), actorId = null } = {}, t) {
    const cfg = await customerSettings();
    const wh = await workingHours();
    const hotel = await Hotel.findOne({ where: { id: link.hotel_id }, attributes: ["id", "product_plan"], raw: true, transaction: t });
    const plan = hotel && hotel.product_plan === "CLOUD_APP" ? "app" : "suite";
    const steps = cfg.onboarding.filter((s) => s.plan === "all" || s.plan === plan);
    let sort = 0;
    for (const s of steps) {
        sort += 1;
        const [row, made] = await CsOnboardingItem.findOrCreate({
            where: { hotel_id: link.hotel_id, item_key: s.key },
            defaults: { account_id: link.account_id, title: s.title, sort, auto: s.key === "payment" ? "payment" : s.auto, proof_kind: s.auto ? null : s.proof || defaultProof(s.key), owner_id: ownerId, due_at: dueOnDay(wh, at, s.dueDays) },
            transaction: t,
        });
        if (!made && row.account_id !== link.account_id) await row.update({ account_id: link.account_id }, { transaction: t });
    }
    await CsAccountOutlet.update({ onboarding: "active", onboarding_started_at: at, onboarding_done_at: null }, { where: { id: link.id }, transaction: t });
    await addActivity(link.account_id, link.hotel_id, "onboarding", actorId, `Onboarding started (${steps.length} steps)`, null, t);
    return steps.length;
}

/** What the auto steps see for these outlets right now. */
async function facts(hotelIds) {
    if (!hotelIds.length) return new Map();
    const hotels = await Hotel.findAll({ where: { id: hotelIds }, attributes: ["id", "owner_number", "product_plan"], raw: true });
    const out = new Map(hotels.map((h) => [h.id, { payment: 0, outlet: false, menu: 0, pc: false, app_devices: 0, first_bill: null }]));
    const owners = await HotelUser.findAll({ where: { hotel_id: hotelIds }, attributes: ["hotel_id", "number", "active"], raw: true });
    for (const h of hotels) {
        const m = mobile10(h.owner_number);
        const f = out.get(h.id);
        f.outlet = !!m && owners.some((u) => u.hotel_id === h.id && spellings(m).includes(String(u.number)) && u.active !== false && u.active !== 0);
    }
    for (const r of await Menu.findAll({ where: { hotel_id: hotelIds, is_deleted: { [Op.not]: true } }, attributes: ["hotel_id", [sequelize.fn("COUNT", sequelize.col("id")), "n"]], group: ["hotel_id"], raw: true })) {
        if (out.has(r.hotel_id)) out.get(r.hotel_id).menu = Number(r.n) || 0;
    }
    for (const r of await LocalServerRegistration.findAll({ where: { hotel_id: hotelIds, status: "active" }, attributes: ["hotel_id"], raw: true })) {
        if (out.has(r.hotel_id)) out.get(r.hotel_id).pc = true;
    }
    for (const r of await AppDevice.findAll({ where: { hotel_id: hotelIds, status: "active" }, attributes: ["hotel_id", [sequelize.fn("COUNT", sequelize.col("id")), "n"]], group: ["hotel_id"], raw: true })) {
        if (out.has(r.hotel_id)) out.get(r.hotel_id).app_devices = Number(r.n) || 0;
    }
    // Payment received = one of the outlet's invoices paid in full (owner 2026-10-09: never a typed note).
    for (const r of await BilInvoice.findAll({ where: { hotel_id: hotelIds, kind: "invoice", status: "paid" }, attributes: ["id", "hotel_id", "number", "total"], order: [["id", "ASC"]], raw: true })) {
        if (out.has(r.hotel_id) && !out.get(r.hotel_id).paidInvoice) out.get(r.hotel_id).paidInvoice = r;
    }
    for (const r of await Order.findAll({ where: { hotel_id: hotelIds, payment: "success", deleted: false }, attributes: ["hotel_id", [sequelize.fn("MIN", sequelize.col("business_date")), "first"]], group: ["hotel_id"], raw: true })) {
        if (out.has(r.hotel_id) && r.first) out.get(r.hotel_id).first_bill = String(r.first).slice(0, 10);
    }
    return out;
}

function autoNote(auto, f) {
    switch (auto) {
        case "payment":
            return f.paidInvoice ? `Invoice ${f.paidInvoice.number} paid (Rs ${Math.round(Number(f.paidInvoice.total)).toLocaleString("en-IN")})` : null;
        case "outlet":
            return f.outlet ? "Owner login works" : null;
        case "menu":
            return f.menu > 0 ? `${f.menu} item${f.menu === 1 ? "" : "s"} on the menu` : null;
        case "pc":
            return f.pc ? "PC registered" : null;
        case "app_devices":
            return f.app_devices > 0 ? `${f.app_devices} phone${f.app_devices === 1 ? "" : "s"} logged in` : null;
        case "first_bill":
            return f.first_bill ? `First bill on ${f.first_bill}` : null;
        default:
            return null;
    }
}

/**
 * Ticks the auto steps that came true (every outlet in onboarding, or `only`
 * hotel ids) and closes finished checklists. Returns how many steps ticked.
 */
async function autoCheck({ only = null } = {}) {
    const where = { onboarding: "active", ...(only ? { hotel_id: only } : {}) };
    const links = await CsAccountOutlet.findAll({ where, raw: true });
    if (!links.length) return 0;
    const f = await facts(links.map((l) => l.hotel_id));
    const open = await CsOnboardingItem.findAll({ where: { hotel_id: links.map((l) => l.hotel_id), done_at: null, auto: { [Op.ne]: null } }, raw: true });
    let ticked = 0;
    for (const it of open) {
        const note = f.has(it.hotel_id) ? autoNote(it.auto, f.get(it.hotel_id)) : null;
        if (!note) continue;
        await sequelize.transaction(async (t) => {
            const paidInv = it.auto === "payment" ? f.get(it.hotel_id).paidInvoice : null;
            const [n] = await CsOnboardingItem.update({ done_at: new Date(), done_by: null, note, ...(paidInv ? { invoice_id: paidInv.id } : {}) }, { where: { id: it.id, done_at: null }, transaction: t });
            if (n) await addActivity(it.account_id, it.hotel_id, "onboarding", null, `${it.title}: done by itself (${note})`, { item: it.item_key }, t);
        });
        ticked += 1;
    }
    for (const l of links) await finishIfDone(l.hotel_id);
    return ticked;
}

async function finishIfDone(hotelId, t) {
    const left = await CsOnboardingItem.count({ where: { hotel_id: hotelId, done_at: null }, transaction: t });
    const total = await CsOnboardingItem.count({ where: { hotel_id: hotelId }, transaction: t });
    if (left || !total) return false;
    const link = await CsAccountOutlet.findOne({ where: { hotel_id: hotelId, onboarding: "active" }, transaction: t });
    if (!link) return false;
    await link.update({ onboarding: "done", onboarding_done_at: new Date() }, { transaction: t });
    await addActivity(link.account_id, hotelId, "onboarding", null, "Onboarding finished: every step is done", null, t);
    return true;
}

/** Checklist rows for an outlet (account page). */
async function itemsFor(hotelIds) {
    if (!hotelIds.length) return [];
    return CsOnboardingItem.findAll({ where: { hotel_id: hotelIds }, order: [["hotel_id", "ASC"], ["sort", "ASC"], ["id", "ASC"]], raw: true });
}

const view = (it, who) => ({
    id: it.id,
    hotelId: it.hotel_id,
    key: it.item_key,
    title: it.title,
    auto: it.auto,
    owner: it.owner_id ? { id: it.owner_id, name: who.get(it.owner_id) || `#${it.owner_id}` } : null,
    dueAt: it.due_at,
    doneAt: it.done_at,
    doneBy: it.done_at ? (it.done_by ? who.get(it.done_by) || `#${it.done_by}` : "auto") : null,
    note: it.note,
    proofKind: proofKindOf(it),
    hasProof: !!it.proof,
    invoiceId: it.invoice_id || null,
    // A call step opens on its due day (India time); before that it cannot be ticked.
    opensAt: proofKindOf(it) === "call" && it.due_at ? moment(it.due_at).tz(TZ).startOf("day").toISOString() : null,
});

/**
 * Staff tick (or untick) a step, with its proof. extra: { proof (photo:
 * { name, mime, data }), invoiceId (Payment received) }. Steps the outlet's
 * data proves cannot be ticked or unticked by hand ("Check now" re-reads them).
 */
async function tick(s, itemId, done, note, extra = {}) {
    need(s, "customers.manage");
    const it0 = await CsOnboardingItem.findOne({ where: { id: Number(itemId) || 0 }, raw: true });
    if (!it0) throw new RuleError("This step does not exist.");
    const kind = proofKindOf(it0);
    const text = txt(note, 300);
    let proof = null;
    let invoiceId = null;
    let callNote = "";
    if (done) {
        if (it0.done_at) throw new RuleError("This step is already done.");
        if (isPayment(it0)) {
            const inv = await BilInvoice.findOne({ where: { id: Number(extra.invoiceId) || 0, hotel_id: it0.hotel_id, kind: "invoice" }, attributes: ["id", "number", "status"], raw: true });
            if (!inv) throw new RuleError("Choose the outlet's invoice that was paid.");
            if (inv.status !== "paid") throw new RuleError(`Invoice ${inv.number} is not paid in full yet. This step ticks itself when it is.`);
            invoiceId = inv.id;
        } else if (it0.auto) {
            throw new RuleError("This step ticks itself from the outlet's own data. Use Check now after the outlet has done it.");
        } else if (kind === "photo") {
            proof = await require("../bil/payments").saveProof(extra.proof);
            if (!proof) throw new RuleError("Add a photo that shows it is done.");
        } else if (kind === "call") {
            const opens = it0.due_at ? moment(it0.due_at).tz(TZ).startOf("day") : null;
            if (opens && moment().tz(TZ).isBefore(opens)) throw new RuleError(`This call is due on ${opens.format("D MMM")}. It can be marked done from that day, after the call.`);
            if (text.length < 10) throw new RuleError("Write what the owner said on the call.");
            callNote = await callFound(it0.hotel_id, opens);
        } else if (text.length < 5) {
            throw new RuleError("Write what was done (a few words).");
        }
    } else {
        if (!it0.done_at) throw new RuleError("This step is not done yet.");
        if (it0.auto && !isPayment(it0)) throw new RuleError("This step follows the outlet's own data and cannot be unticked by hand.");
        if (isPayment(it0) && !s.can("billing.approve")) throw new RuleError("Only an approver can untick a payment step.");
        if (text.length < 5) throw new RuleError("Write why it is not done after all.");
    }
    return sequelize.transaction(async (t) => {
        const it = await CsOnboardingItem.findOne({ where: { id: it0.id }, transaction: t, lock: t.LOCK.UPDATE });
        if (done) {
            if (it.done_at) throw new RuleError("This step is already done.");
            const saved = [text, callNote, invoiceId ? `invoice paid` : ""].filter(Boolean).join(" · ").slice(0, 300);
            await it.update({ done_at: new Date(), done_by: s.user.id, note: saved, proof, invoice_id: invoiceId }, { transaction: t });
            await addActivity(it.account_id, it.hotel_id, "onboarding", s.user.id, `${it.title}: done${saved ? ` (${saved})` : ""}${proof ? " - photo added" : ""}`, { item: it.item_key }, t);
            await finishIfDone(it.hotel_id, t);
        } else {
            if (!it.done_at) throw new RuleError("This step is not done yet.");
            await it.update({ done_at: null, done_by: null, note: "", proof: null, invoice_id: null }, { transaction: t });
            await CsAccountOutlet.update({ onboarding: "active", onboarding_done_at: null }, { where: { hotel_id: it.hotel_id, onboarding: "done" }, transaction: t });
            await addActivity(it.account_id, it.hotel_id, "onboarding", s.user.id, `${it.title}: marked not done (${text})`, { item: it.item_key }, t);
        }
        return { id: it.id };
    });
}

/** A call to the outlet owner's mobile on or after the due day, from the call log ("" when none). */
async function callFound(hotelId, from) {
    const h = await Hotel.findOne({ where: { id: hotelId }, attributes: ["owner_number"], raw: true });
    const m = h ? String(h.owner_number || "").slice(-10) : "";
    if (m.length !== 10) return "";
    const c = await CrmCall.findOne({ where: { phone: { [Op.like]: `%${m}` }, ...(from ? { started_at: { [Op.gte]: from.toDate() } } : {}) }, order: [["started_at", "DESC"]], raw: true });
    if (!c) return "";
    const mins = Math.max(1, Math.round((c.duration_seconds || 0) / 60));
    return `call in the log: ${c.answered ? `${mins} min` : "not answered"} on ${moment(c.started_at).tz(TZ).format("D MMM")}`;
}

/** The photo behind a step. */
async function proofLink(s, itemId) {
    need(s, "customers.view");
    const it = await CsOnboardingItem.findOne({ where: { id: Number(itemId) || 0 }, attributes: ["proof"], raw: true });
    if (!it || !it.proof) throw new RuleError("No photo for this step.");
    return { url: await require("../bil/payments").store.link(it.proof) };
}

/** "Check now": re-reads the outlet's data for the steps it proves. */
async function checkNow(s, hotelId) {
    need(s, "customers.manage");
    return { ticked: await autoCheck({ only: [Number(hotelId) || 0] }) };
}

/** Who does a step and by when. */
async function setItem(s, itemId, input = {}) {
    need(s, "customers.manage");
    const it = await CsOnboardingItem.findOne({ where: { id: Number(itemId) || 0 } });
    if (!it) throw new RuleError("This step does not exist.");
    const patch = {};
    if (input.ownerId !== undefined) patch.owner_id = input.ownerId ? Number(input.ownerId) || null : null;
    if (input.dueAt !== undefined) {
        const d = new Date(input.dueAt);
        if (Number.isNaN(d.getTime())) throw new RuleError("Choose a due date.");
        patch.due_at = d;
    }
    if (!Object.keys(patch).length) throw new RuleError("Nothing to change.");
    await it.update(patch);
    return { id: it.id };
}

/** "Start onboarding" for an outlet that has no checklist (an older outlet that needs help). */
async function startFor(s, hotelId) {
    need(s, "customers.manage");
    const { CsAccount } = require("../../model");
    return sequelize.transaction(async (t) => {
        const link = await CsAccountOutlet.findOne({ where: { hotel_id: Number(hotelId) || 0 }, transaction: t, lock: t.LOCK.UPDATE });
        if (!link) throw new RuleError("This outlet is not in an account yet.");
        if (link.onboarding === "active") throw new RuleError("Onboarding is already running for this outlet.");
        const acc = await CsAccount.findOne({ where: { id: link.account_id }, attributes: ["success_owner_id"], raw: true, transaction: t });
        const n = await start(link, { ownerId: acc ? acc.success_owner_id : null, actorId: s.user.id }, t);
        return { steps: n };
    }).then(async (r) => {
        await autoCheck({ only: [Number(hotelId)] });
        return r;
    });
}

/** "Payment received" not done yet: how much of the outlet's first invoice is paid (part payments show). */
async function withProgress(views) {
    const freeze = require("./freeze");
    for (const v of views) {
        if (v.key !== "payment" || v.doneAt) continue;
        const st = await freeze.state(v.hotelId);
        if (st) v.progress = { paid: st.paid, total: st.total, invoice: st.invoice, payBy: st.payBy, frozen: st.frozen };
    }
    return views;
}

module.exports = { start, autoCheck, itemsFor, view, tick, setItem, startFor, facts, proofLink, checkNow, withProgress };
