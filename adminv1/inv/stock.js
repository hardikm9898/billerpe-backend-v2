const { Op } = require("sequelize");
const { sequelize, Hotel, InvItem, InvMove, BilInvoice, CsAccountOutlet, AdmUser } = require("../../model");
const { RuleError } = require("../../appv1/core");
const { need } = require("../auth");
const audit = require("../audit");
const { notify, peopleWith } = require("../crm/notify");
const { addActivity } = require("../cs/common");
const { txt } = require("../crm/util");

// BillerPe's office stock (owner 2026-10-09): ONE stock for the company, any
// item type (printers, rolls, mobile POS later). Every change is a move with
// its proof: stock in (supplier bill), send to an outlet (photo + the post /
// courier number; printers by serial), a return (photo; good back to stock,
// broken kept apart), an adjustment (approvers only, with a reason). Sending
// something free waits for an approver; sold items point at their invoice.

const CATEGORIES = ["printer", "roll", "device", "other"];
const SERIAL_CATEGORIES = new Set(["printer", "device"]);
const CARRIERS = { hand: "By hand", post: "India Post", courier: "Courier" };
const MAX_QTY = 10000;

const int = (v) => (Number.isInteger(Number(v)) ? Number(v) : NaN);
const money = (n) => `Rs ${Math.round(Number(n) || 0).toLocaleString("en-IN")}`;

function qtyOf(v, max = MAX_QTY) {
    const n = int(v);
    if (!(n >= 1 && n <= max)) throw new RuleError(`Write a quantity from 1 to ${max}.`);
    return n;
}

/** "A1, A2\nA3" -> ["A1","A2","A3"] (no repeats). */
function serialList(v) {
    const list = String(v || "").split(/[\s,;]+/).map((x) => x.trim().toUpperCase()).filter(Boolean);
    if (new Set(list).size !== list.length) throw new RuleError("A serial number is written twice.");
    return list;
}

async function proofOf(proof, required, what) {
    const { saveProof } = require("../bil/payments");
    const ref = await saveProof(proof);
    if (!ref && required) throw new RuleError(`Add a photo of ${what}.`);
    return ref;
}

async function lockItem(itemId, t) {
    const item = await InvItem.findOne({ where: { id: Number(itemId) || 0 }, transaction: t, lock: t.LOCK.UPDATE });
    if (!item) throw new RuleError("Choose an item.");
    return item;
}

async function getHotel(hotelId, t) {
    const hotel = await Hotel.findOne({ where: { id: Number(hotelId) || 0 }, attributes: ["id", "hotel_name"], raw: true, transaction: t });
    if (!hotel) throw new RuleError("Choose the outlet.");
    return hotel;
}

async function accountOf(hotelId, t) {
    const link = await CsAccountOutlet.findOne({ where: { hotel_id: hotelId }, attributes: ["account_id"], raw: true, transaction: t });
    return link ? link.account_id : null;
}

/** How many of each item an outlet holds now (done dispatches minus returns), and the serials still with it. */
async function holdings(hotelId, t) {
    const rows = await InvMove.findAll({ where: { hotel_id: hotelId, status: "done", kind: ["dispatch", "return"] }, order: [["id", "ASC"]], raw: true, transaction: t });
    const out = new Map();
    for (const m of rows) {
        const h = out.get(m.item_id) || { qty: 0, serials: [] };
        const list = serialList(m.serials);
        if (m.kind === "dispatch") {
            h.qty += m.qty;
            h.serials.push(...list);
        } else {
            h.qty -= m.qty;
            h.serials = h.serials.filter((x) => !list.includes(x));
        }
        out.set(m.item_id, h);
    }
    return out;
}

/** Applies a move's effect on the item's counts (item row locked by the caller). */
async function apply(item, move, t) {
    const patch = {};
    if (move.kind === "purchase") patch.stock_office = item.stock_office + move.qty;
    else if (move.kind === "dispatch") {
        if (item.stock_office < move.qty) throw new RuleError(`Only ${item.stock_office} ${item.unit} of ${item.name} in the office.`);
        patch.stock_office = item.stock_office - move.qty;
    } else if (move.kind === "return") {
        if (move.bucket === "damaged") patch.stock_damaged = item.stock_damaged + move.qty;
        else patch.stock_office = item.stock_office + move.qty;
    } else if (move.kind === "adjust") {
        const key = move.bucket === "damaged" ? "stock_damaged" : "stock_office";
        if (item[key] + move.qty < 0) throw new RuleError("Stock cannot go below 0.");
        patch[key] = item[key] + move.qty;
    }
    await item.update(patch, { transaction: t });
}

/* ------------------------------ items ------------------------------ */

const itemView = (i, extra = {}) => ({
    id: i.id,
    code: i.code,
    name: i.name,
    category: i.category,
    unit: i.unit,
    price: Number(i.price),
    gstRate: Number(i.gst_rate),
    hsn: i.hsn,
    office: i.stock_office,
    damaged: i.stock_damaged,
    lowAt: i.low_at,
    low: i.low_at > 0 && i.stock_office <= i.low_at,
    serials: SERIAL_CATEGORIES.has(i.category),
    active: !!i.active,
    ...extra,
});

/** Every item with its office, damaged, at-outlets and waiting counts. */
async function items(s) {
    need(s, "inventory.view");
    const rows = await InvItem.findAll({ order: [["active", "DESC"], ["sort", "ASC"], ["name", "ASC"]], raw: true });
    const out = await InvMove.findAll({ where: { status: "done", kind: ["dispatch", "return"] }, attributes: ["item_id", "kind", [sequelize.fn("SUM", sequelize.col("qty")), "n"]], group: ["item_id", "kind"], raw: true });
    const waiting = await InvMove.findAll({ where: { status: "pending" }, attributes: ["item_id", [sequelize.fn("SUM", sequelize.col("qty")), "n"]], group: ["item_id"], raw: true });
    const at = new Map();
    for (const r of out) at.set(r.item_id, (at.get(r.item_id) || 0) + (r.kind === "dispatch" ? 1 : -1) * Number(r.n));
    const wait = new Map(waiting.map((r) => [r.item_id, Number(r.n)]));
    return { items: rows.map((i) => itemView(i, { atOutlets: at.get(i.id) || 0, waiting: wait.get(i.id) || 0 })), categories: CATEGORIES, carriers: CARRIERS };
}

/** Add or edit an item (name, unit, sale price for extras, GST, low-stock level). Stock never changes here. */
async function saveItem(s, input = {}) {
    need(s, "inventory.manage");
    const name = txt(input.name, 80);
    if (name.length < 2) throw new RuleError("Write the item's name.");
    const category = CATEGORIES.includes(input.category) ? input.category : null;
    if (!category) throw new RuleError("Choose the kind of item.");
    const price = Number(input.price ?? 0);
    if (!(price >= 0 && price <= 10000000)) throw new RuleError("Write the price (rupees, before GST).");
    const gst = Number(input.gstRate ?? 18);
    if (![0, 5, 12, 18, 28].includes(gst)) throw new RuleError("GST must be 0, 5, 12, 18 or 28%.");
    const lowAt = int(input.lowAt ?? 0);
    if (!(lowAt >= 0 && lowAt <= MAX_QTY)) throw new RuleError("Low-stock level: 0 to 10,000.");
    const data = { name, category, unit: txt(input.unit, 12) || (category === "roll" ? "rolls" : "pcs"), price, gst_rate: gst, hsn: String(input.hsn || "").replace(/\D/g, "").slice(0, 8), low_at: lowAt, active: input.active !== false };
    return sequelize.transaction(async (t) => {
        if (input.id) {
            const row = await InvItem.findOne({ where: { id: Number(input.id) || 0 }, transaction: t, lock: t.LOCK.UPDATE });
            if (!row) throw new RuleError("This item no longer exists.");
            const before = { name: row.name, price: Number(row.price), gst_rate: Number(row.gst_rate), low_at: row.low_at, active: !!row.active };
            await row.update(data, { transaction: t });
            await audit.write(s, { action: "inventory.item_edit", entity: "inv_item", entityId: row.id, summary: `Edited ${row.name}`, before, after: data }, { transaction: t });
            return { id: row.id };
        }
        const code = (txt(input.code, 30) || name).toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 30);
        if (await InvItem.count({ where: { code }, transaction: t })) throw new RuleError("An item with this code exists. Change the name or code.");
        const max = (await InvItem.max("sort", { transaction: t })) || 0;
        const row = await InvItem.create({ ...data, code, sort: max + 10 }, { transaction: t });
        await audit.write(s, { action: "inventory.item_add", entity: "inv_item", entityId: row.id, summary: `Added item ${name}`, after: data }, { transaction: t });
        return { id: row.id };
    });
}

/* ------------------------------ moves ------------------------------ */

/** Stock bought (or received) into the office, with the supplier's bill number. */
async function stockIn(s, input = {}) {
    need(s, "inventory.manage");
    const qty = qtyOf(input.qty);
    const ref = txt(input.ref, 80);
    if (ref.length < 2) throw new RuleError("Write the supplier's bill or challan number.");
    const cost = input.unitCost === undefined || input.unitCost === "" || input.unitCost === null ? null : Number(input.unitCost);
    if (cost !== null && !(cost >= 0 && cost <= 10000000)) throw new RuleError("Write the cost per piece in rupees.");
    const proof = await proofOf(input.proof, false);
    return sequelize.transaction(async (t) => {
        const item = await lockItem(input.itemId, t);
        const serials = SERIAL_CATEGORIES.has(item.category) ? serialList(input.serials) : [];
        if (serials.length && serials.length !== qty) throw new RuleError(`Write ${qty} serial number${qty === 1 ? "" : "s"}, or none.`);
        const move = await InvMove.create({ item_id: item.id, kind: "purchase", qty, ref, unit_cost: cost, serials: serials.join(", "), proof, note: txt(input.note, 300), created_by: s.user.id }, { transaction: t });
        await apply(item, move, t);
        await audit.write(s, { action: "inventory.stock_in", entity: "inv_move", entityId: move.id, summary: `${qty} ${item.unit} of ${item.name} into stock (${ref})` }, { transaction: t });
        return { id: move.id, office: item.stock_office };
    });
}

/**
 * Sends items to an outlet. basis: "invoice" (sold on that outlet's invoice),
 * "plan" (what the outlet's setup includes - outlet setup), "free" (waits
 * for an approver unless one sends it). A photo is always needed; post and
 * courier need the consignment number; printers and devices go by serial.
 */
async function dispatch(s, input = {}) {
    need(s, "inventory.manage");
    const qty = qtyOf(input.qty, 500);
    const basis = ["invoice", "plan", "free"].includes(input.basis) ? input.basis : null;
    if (!basis) throw new RuleError("Choose why it is sent: sold on an invoice, part of the plan, or free.");
    const carrier = CARRIERS[input.carrier] ? input.carrier : null;
    if (!carrier) throw new RuleError("Choose how it goes: by hand, India Post or courier.");
    const ref = txt(input.ref, 80);
    if (carrier !== "hand" && ref.length < 4) throw new RuleError(`Write the ${CARRIERS[carrier]} consignment number.`);
    const note = txt(input.note, 300);
    if (basis === "free" && note.length < 5) throw new RuleError("Write why it is given free.");
    const proof = await proofOf(input.proof, true, carrier === "hand" ? "the items handed over" : "the parcel or its booking receipt");
    const result = await sequelize.transaction(async (t) => {
        const hotel = await getHotel(input.hotelId, t);
        const item = await lockItem(input.itemId, t);
        if (!item.active) throw new RuleError("This item is switched off.");
        const serials = SERIAL_CATEGORIES.has(item.category) ? serialList(input.serials) : [];
        if (SERIAL_CATEGORIES.has(item.category) && serials.length !== qty) throw new RuleError(`Write the serial number of each ${item.name} (${qty}).`);
        if (serials.length) {
            const out = await InvMove.findAll({ where: { item_id: item.id, kind: "dispatch", status: ["done", "pending"] }, attributes: ["hotel_id", "serials"], raw: true, transaction: t });
            const back = await InvMove.findAll({ where: { item_id: item.id, kind: "return", status: "done" }, attributes: ["serials"], raw: true, transaction: t });
            const away = new Set(out.flatMap((m) => serialList(m.serials)));
            for (const b of back) for (const x of serialList(b.serials)) away.delete(x);
            const clash = serials.find((x) => away.has(x));
            if (clash) throw new RuleError(`Serial ${clash} is already at an outlet (or waiting to go).`);
        }
        let invoiceId = null;
        if (basis === "invoice") {
            const inv = await BilInvoice.findOne({ where: { id: Number(input.invoiceId) || 0, hotel_id: hotel.id, kind: "invoice" }, attributes: ["id", "number", "status"], raw: true, transaction: t });
            if (!inv || !["issued", "part_paid", "paid"].includes(inv.status)) throw new RuleError("Choose an issued invoice of this outlet that sells it.");
            invoiceId = inv.id;
        }
        if (basis === "plan") {
            const allow = await require("./allowance").remaining(hotel.id, item.id, t);
            if (allow < qty) throw new RuleError(allow > 0 ? `The outlet's plan includes only ${allow} more ${item.unit} of ${item.name}.` : `The outlet's plan includes no ${item.name}. Sell it on an invoice or send it free (needs approval).`);
        }
        const approved = basis !== "free" || s.can("billing.approve");
        const move = await InvMove.create({ item_id: item.id, kind: "dispatch", qty, hotel_id: hotel.id, invoice_id: invoiceId, setup_id: null, basis, carrier, ref, serials: serials.join(", "), proof, note, status: approved ? "done" : "pending", created_by: s.user.id, ...(approved && basis === "free" ? { decided_by: s.user.id, decided_at: new Date() } : {}) }, { transaction: t });
        if (approved) await apply(item, move, t);
        else if (item.stock_office < qty) throw new RuleError(`Only ${item.stock_office} ${item.unit} of ${item.name} in the office.`);
        const what = `${qty} ${item.unit} of ${item.name}${serials.length ? ` (${serials.join(", ")})` : ""}`;
        const accountId = await accountOf(hotel.id, t);
        if (approved) {
            if (accountId) await addActivity(accountId, hotel.id, "inventory", s.user.id, `Sent ${what} - ${CARRIERS[carrier]}${ref ? ` ${ref}` : ""}`, { moveId: move.id }, t);
        } else {
            for (const p of await peopleWith("billing.approve")) await notify(p.id, { type: "inventory.approval", title: `Free items to approve: ${item.name}`, body: `${hotel.hotel_name}: ${what} (${note})`, link: "/inventory?tab=approvals", ref: `inv:${move.id}` }, { transaction: t });
        }
        await audit.write(s, { action: approved ? "inventory.dispatch" : "inventory.dispatch_ask", entity: "inv_move", entityId: move.id, summary: `${approved ? "Sent" : "Asked to send"} ${what} to ${hotel.hotel_name} (${basis})`, after: { hotelId: hotel.id, carrier, ref, invoiceId }, reason: note }, { transaction: t });
        return { id: move.id, status: move.status, office: item.stock_office, accountId, hotelId: hotel.id };
    });
    return { id: result.id, status: result.status, office: result.office };
}

/** Items come back from an outlet: good ones into the office, broken ones kept apart. */
async function takeReturn(s, input = {}) {
    need(s, "inventory.manage");
    const qty = qtyOf(input.qty, 500);
    const condition = input.condition === "damaged" ? "damaged" : input.condition === "good" ? "good" : null;
    if (!condition) throw new RuleError("Say whether it came back working or damaged.");
    const note = txt(input.note, 300);
    if (note.length < 3) throw new RuleError("Write why it came back.");
    const proof = await proofOf(input.proof, true, "what came back");
    return sequelize.transaction(async (t) => {
        const hotel = await getHotel(input.hotelId, t);
        const item = await lockItem(input.itemId, t);
        const held = (await holdings(hotel.id, t)).get(item.id) || { qty: 0, serials: [] };
        if (held.qty < qty) throw new RuleError(held.qty ? `${hotel.hotel_name} holds only ${held.qty} ${item.unit} of ${item.name}.` : `${hotel.hotel_name} holds no ${item.name} from us.`);
        const serials = SERIAL_CATEGORIES.has(item.category) ? serialList(input.serials) : [];
        if (SERIAL_CATEGORIES.has(item.category)) {
            if (serials.length !== qty) throw new RuleError(`Write the serial number of each ${item.name} that came back (${qty}).`);
            const wrong = serials.find((x) => !held.serials.includes(x));
            if (wrong) throw new RuleError(`Serial ${wrong} was not sent to ${hotel.hotel_name}.`);
        }
        const move = await InvMove.create({ item_id: item.id, kind: "return", qty, bucket: condition === "damaged" ? "damaged" : "office", hotel_id: hotel.id, carrier: CARRIERS[input.carrier] ? input.carrier : "", ref: txt(input.ref, 80), serials: serials.join(", "), proof, note, created_by: s.user.id }, { transaction: t });
        await apply(item, move, t);
        const what = `${qty} ${item.unit} of ${item.name}${serials.length ? ` (${serials.join(", ")})` : ""}`;
        const accountId = await accountOf(hotel.id, t);
        if (accountId) await addActivity(accountId, hotel.id, "inventory", s.user.id, `Returned ${what}, ${condition} (${note})`, { moveId: move.id }, t);
        await audit.write(s, { action: "inventory.return", entity: "inv_move", entityId: move.id, summary: `${what} back from ${hotel.hotel_name} (${condition})`, reason: note }, { transaction: t });
        return { id: move.id, office: item.stock_office, damaged: item.stock_damaged };
    });
}

/** A count correction or a write-off (approvers only, with a reason). qty is signed. */
async function adjust(s, input = {}) {
    need(s, "billing.approve");
    const qty = int(input.qty);
    if (!qty || Math.abs(qty) > MAX_QTY) throw new RuleError("Write how many to add (+) or remove (-).");
    const bucket = input.bucket === "damaged" ? "damaged" : "office";
    const why = txt(input.reason, 200);
    if (why.length < 5) throw new RuleError("Write why the stock changes.");
    return sequelize.transaction(async (t) => {
        const item = await lockItem(input.itemId, t);
        const move = await InvMove.create({ item_id: item.id, kind: "adjust", qty, bucket, note: why, created_by: s.user.id, decided_by: s.user.id, decided_at: new Date() }, { transaction: t });
        await apply(item, move, t);
        await audit.write(s, { action: "inventory.adjust", entity: "inv_move", entityId: move.id, summary: `${qty > 0 ? "+" : ""}${qty} ${item.unit} of ${item.name} (${bucket})`, reason: why }, { transaction: t });
        return { id: move.id, office: item.stock_office, damaged: item.stock_damaged };
    });
}

/** An approver decides a free dispatch. */
async function decide(s, moveId, ok, reason) {
    need(s, "billing.approve");
    return sequelize.transaction(async (t) => {
        const move = await InvMove.findOne({ where: { id: Number(moveId) || 0 }, transaction: t, lock: t.LOCK.UPDATE });
        if (!move || move.status !== "pending") throw new RuleError("This request is already decided.");
        const item = await lockItem(move.item_id, t);
        const hotel = await getHotel(move.hotel_id, t);
        const what = `${move.qty} ${item.unit} of ${item.name}`;
        if (ok) {
            await move.update({ status: "done", decided_by: s.user.id, decided_at: new Date() }, { transaction: t });
            await apply(item, move, t);
            const accountId = await accountOf(hotel.id, t);
            if (accountId) await addActivity(accountId, hotel.id, "inventory", s.user.id, `Sent ${what} free - approved by ${s.user.name} (${move.note})`, { moveId: move.id }, t);
        } else {
            const why = txt(reason, 200);
            if (why.length < 3) throw new RuleError("Write why it is refused.");
            await move.update({ status: "rejected", decided_by: s.user.id, decided_at: new Date(), reject_reason: why }, { transaction: t });
        }
        if (move.created_by && move.created_by !== s.user.id) await notify(move.created_by, { type: ok ? "inventory.approved" : "inventory.refused", title: `${ok ? "Approved" : "Not approved"}: ${what} for ${hotel.hotel_name}`, body: ok ? "Send it now." : txt(reason, 200), link: "/inventory?tab=moves", ref: `invd:${move.id}` }, { transaction: t });
        await audit.write(s, { action: ok ? "inventory.approve" : "inventory.reject", entity: "inv_move", entityId: move.id, summary: `${ok ? "Approved" : "Refused"} ${what} free for ${hotel.hotel_name}`, reason: ok ? move.note : txt(reason, 200) }, { transaction: t });
        return { id: move.id, status: move.status };
    });
}

/* ------------------------------ lists ------------------------------ */

async function moveViews(rows) {
    const items = new Map((await InvItem.findAll({ where: { id: [...new Set(rows.map((r) => r.item_id))] }, raw: true })).map((i) => [i.id, i]));
    const hotels = new Map((await Hotel.findAll({ where: { id: [...new Set(rows.map((r) => r.hotel_id).filter(Boolean))] }, attributes: ["id", "hotel_name"], raw: true })).map((h) => [h.id, h.hotel_name]));
    const people = new Map((await AdmUser.findAll({ where: { id: [...new Set(rows.flatMap((r) => [r.created_by, r.decided_by]).filter(Boolean))] }, attributes: ["id", "name"], raw: true })).map((u) => [u.id, u.name]));
    const invs = new Map((await BilInvoice.findAll({ where: { id: [...new Set(rows.map((r) => r.invoice_id).filter(Boolean))] }, attributes: ["id", "number"], raw: true })).map((i) => [i.id, i.number]));
    return rows.map((m) => {
        const it = items.get(m.item_id) || {};
        return {
            id: m.id,
            at: m.createdAt,
            kind: m.kind,
            qty: m.qty,
            bucket: m.bucket,
            item: { id: m.item_id, name: it.name || `#${m.item_id}`, unit: it.unit || "" },
            outlet: m.hotel_id ? { id: m.hotel_id, name: hotels.get(m.hotel_id) || `#${m.hotel_id}` } : null,
            invoice: m.invoice_id ? { id: m.invoice_id, number: invs.get(m.invoice_id) || "" } : null,
            basis: m.basis,
            carrier: m.carrier,
            carrierLabel: CARRIERS[m.carrier] || "",
            ref: m.ref,
            serials: m.serials,
            unitCost: m.unit_cost === null ? null : Number(m.unit_cost),
            hasProof: !!m.proof,
            note: m.note,
            status: m.status,
            by: m.created_by ? people.get(m.created_by) || `#${m.created_by}` : "",
            decidedBy: m.decided_by ? people.get(m.decided_by) || `#${m.decided_by}` : "",
            rejectReason: m.reject_reason,
        };
    });
}

/** The ledger: newest first, filtered by item, outlet, kind or status. */
async function moves(s, query = {}) {
    need(s, "inventory.view");
    const where = {};
    if (query.itemId) where.item_id = Number(query.itemId) || 0;
    if (query.hotelId) where.hotel_id = Number(query.hotelId) || 0;
    if (["purchase", "dispatch", "return", "adjust"].includes(query.kind)) where.kind = query.kind;
    if (["done", "pending", "rejected"].includes(query.status)) where.status = query.status;
    const page = Math.max(1, Number(query.page) || 1);
    const { rows, count } = await InvMove.findAndCountAll({ where, order: [["id", "DESC"]], limit: 50, offset: (page - 1) * 50, raw: true });
    return { moves: await moveViews(rows), total: count, page, pending: await InvMove.count({ where: { status: "pending" } }) };
}

/** What one outlet holds from BillerPe, and its moves. */
async function outlet(s, hotelId) {
    need(s, "inventory.view");
    const hotel = await getHotel(hotelId);
    const held = await holdings(hotel.id);
    const items = await InvItem.findAll({ where: { id: [...held.keys()] }, raw: true });
    const rows = await InvMove.findAll({ where: { hotel_id: hotel.id }, order: [["id", "DESC"]], limit: 100, raw: true });
    return {
        outlet: { id: hotel.id, name: hotel.hotel_name },
        holds: items.map((i) => ({ item: { id: i.id, name: i.name, unit: i.unit, category: i.category }, qty: held.get(i.id).qty, serials: held.get(i.id).serials })).filter((h) => h.qty > 0),
        moves: await moveViews(rows),
    };
}

/** A short-lived link to a move's photo. */
async function proofLink(s, moveId) {
    need(s, "inventory.view");
    const m = await InvMove.findOne({ where: { id: Number(moveId) || 0 }, attributes: ["proof"], raw: true });
    if (!m || !m.proof) throw new RuleError("No photo for this entry.");
    return { url: await require("../bil/payments").store.link(m.proof) };
}

module.exports = { items, saveItem, stockIn, dispatch, takeReturn, adjust, decide, moves, outlet, proofLink, holdings, CATEGORIES, CARRIERS };
