const { Op } = require("sequelize");
const { sequelize, Hotel, HotelUser, Menu, Order, LocalServerRegistration, AppDevice, SubscriptionPayment, CsAccountOutlet, CsOnboardingItem } = require("../../model");
const { RuleError } = require("../../appv1/core");
const { need } = require("../auth");
const { workingHours } = require("../crm/util");
const { customerSettings, addActivity, dueOnDay, mobile10, spellings, txt } = require("./common");

// An outlet's onboarding checklist (template in Settings > Customers). Steps
// marked auto tick themselves from the outlet's own data - a payment recorded
// with the outlet (the old add-restaurant call), the outlet and its owner login exist, menu items, the PC registration (Local Suite) or a POS
// App phone (POS App), the first settled bill. The rest are ticked by staff.
// All steps done = onboarding done.

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
            defaults: { account_id: link.account_id, title: s.title, sort, auto: s.auto, owner_id: ownerId, due_at: dueOnDay(wh, at, s.dueDays) },
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
    for (const r of await SubscriptionPayment.findAll({ where: { hotel_id: hotelIds }, attributes: ["hotel_id", [sequelize.fn("SUM", sequelize.col("amount_paid")), "paid"]], group: ["hotel_id"], raw: true })) {
        if (out.has(r.hotel_id)) out.get(r.hotel_id).payment = Number(r.paid) || 0;
    }
    for (const r of await Order.findAll({ where: { hotel_id: hotelIds, payment: "success", deleted: false }, attributes: ["hotel_id", [sequelize.fn("MIN", sequelize.col("business_date")), "first"]], group: ["hotel_id"], raw: true })) {
        if (out.has(r.hotel_id) && r.first) out.get(r.hotel_id).first_bill = String(r.first).slice(0, 10);
    }
    return out;
}

function autoNote(auto, f) {
    switch (auto) {
        case "payment":
            return f.payment > 0 ? `Rs ${Math.round(f.payment).toLocaleString("en-IN")} recorded with the outlet` : null;
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
            const [n] = await CsOnboardingItem.update({ done_at: new Date(), done_by: null, note }, { where: { id: it.id, done_at: null }, transaction: t });
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
});

/** Staff tick (or untick) a step; an auto step can be ticked by hand too. */
async function tick(s, itemId, done, note) {
    need(s, "customers.manage");
    return sequelize.transaction(async (t) => {
        const it = await CsOnboardingItem.findOne({ where: { id: Number(itemId) || 0 }, transaction: t, lock: t.LOCK.UPDATE });
        if (!it) throw new RuleError("This step does not exist.");
        if (done) {
            if (it.done_at) throw new RuleError("This step is already done.");
            await it.update({ done_at: new Date(), done_by: s.user.id, note: txt(note, 300) }, { transaction: t });
            await addActivity(it.account_id, it.hotel_id, "onboarding", s.user.id, `${it.title}: done${note ? ` (${txt(note, 200)})` : ""}`, { item: it.item_key }, t);
            await finishIfDone(it.hotel_id, t);
        } else {
            if (!it.done_at) throw new RuleError("This step is not done yet.");
            await it.update({ done_at: null, done_by: null, note: "" }, { transaction: t });
            await CsAccountOutlet.update({ onboarding: "active", onboarding_done_at: null }, { where: { hotel_id: it.hotel_id, onboarding: "done" }, transaction: t });
            await addActivity(it.account_id, it.hotel_id, "onboarding", s.user.id, `${it.title}: marked not done`, { item: it.item_key }, t);
        }
        return { id: it.id };
    });
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

module.exports = { start, autoCheck, itemsFor, view, tick, setItem, startFor, facts };
