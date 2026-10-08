const { Op, UniqueConstraintError } = require("sequelize");
const { sequelize, Hotel, OwnerOutletLink, LocalServerRegistration, CsAccount, CsAccountOutlet, CsTask, CsActivity, CrmLeadV2, AdmUser, AdmRole } = require("../../model");
const { RuleError } = require("../../appv1/core");
const { need } = require("../auth");
const audit = require("../audit");
const perms = require("../permissions");
const { notify } = require("../crm/notify");
const { addWorkingMinutes, workingHours } = require("../crm/util");
const onboarding = require("./onboarding");
const { outletRow } = require("./view");
const { mobile10, customerSettings, addActivity, names, parse, txt, moment } = require("./common");

// Customer accounts: one per owner mobile, with all their outlets (and the
// franchise outlets linked to a franchise owner's mobile). Every outlet in
// v2 gets an account by itself (owner 2026-10-08: existing outlets too);
// only outlets newer than `onboardingNewDays` and won customers get the
// onboarding checklist. Each account has a success owner: shared out among
// the people whose role has "customers.manage" (fewest accounts first), or
// the salesperson who won it when nobody has that role.

const NOT_FOUND = "This account does not exist.";
const HOTEL_ATTRS = ["id", "hotel_name", "owner_name", "owner_number", "owner_email_id", "address2", "product_plan", "plan_start_date", "plan_end_date", "active", "createdAt", "hotel_reg_date", "app_device_limit"];

/* ------------------------------ success owners ------------------------------ */

/** Active staff whose role names customers.manage itself (admins with "*" are not in the share-out). */
async function successPeople() {
    const roles = (await AdmRole.findAll({ raw: true })).filter((r) => perms.parse(r.permissions).includes("customers.manage")).map((r) => r.id);
    if (!roles.length) return [];
    return AdmUser.findAll({ where: { role_id: roles, status: "active" }, attributes: ["id", "name"], order: [["id", "ASC"]], raw: true });
}

/** The success person with the fewest accounts; else `fallbackId` (the seller) when still active. */
async function pickSuccessOwner(fallbackId, t) {
    const people = await successPeople();
    if (people.length) {
        const counts = new Map((await CsAccount.findAll({ where: { success_owner_id: people.map((p) => p.id) }, attributes: ["success_owner_id", [sequelize.fn("COUNT", sequelize.col("id")), "n"]], group: ["success_owner_id"], raw: true, transaction: t })).map((r) => [r.success_owner_id, Number(r.n) || 0]));
        let best = null;
        for (const p of people) if (!best || (counts.get(p.id) || 0) < (counts.get(best.id) || 0)) best = p;
        return best.id;
    }
    if (fallbackId) {
        const u = await AdmUser.findOne({ where: { id: fallbackId, status: "active" }, attributes: ["id"], raw: true, transaction: t });
        if (u) return u.id;
    }
    return null;
}

/** Accounts without a success owner get one once somebody can take them. */
async function assignUnowned() {
    if (!(await successPeople()).length) return 0;
    const rows = await CsAccount.findAll({ where: { success_owner_id: null }, limit: 500 });
    for (const acc of rows) {
        await sequelize.transaction(async (t) => {
            const to = await pickSuccessOwner(acc.won_by_id, t);
            if (!to) return;
            await acc.update({ success_owner_id: to }, { transaction: t });
            await stepsFollowOwner(acc.id, to, t);
            await addActivity(acc.id, null, "owner", null, "Success owner given automatically", { to }, t);
            await notify(to, { type: "account.owner", title: `You now look after ${acc.name || acc.owner_mobile}`, body: "New customer account", link: `/accounts/${acc.id}`, ref: `accowner:${acc.id}:${to}` }, { transaction: t });
        });
    }
    return rows.length;
}

/** Open checklist steps with nobody on them follow the account's success owner. */
async function stepsFollowOwner(accountId, ownerId, t) {
    const { CsOnboardingItem } = require("../../model");
    await CsOnboardingItem.update({ owner_id: ownerId }, { where: { account_id: accountId, done_at: null, owner_id: null }, transaction: t });
}

/* ------------------------------ accounts for every outlet ------------------------------ */

/**
 * Every outlet (not marked testing) gets an account: by its franchise
 * owner's mobile when linked, else its owner_number. A won lead with that
 * mobile (won in the last 90 days, no outlet yet) is linked to it. New
 * outlets (and won ones) start onboarding. `only` = these hotel ids.
 */
async function ensureAccounts({ only = null } = {}) {
    const hotels = await Hotel.findAll({ where: { testing: { [Op.not]: true }, ...(only ? { id: only } : {}) }, attributes: HOTEL_ATTRS, raw: true });
    const linked = new Set((await CsAccountOutlet.findAll({ where: { hotel_id: hotels.map((h) => h.id) }, attributes: ["hotel_id"], raw: true })).map((r) => r.hotel_id));
    const todo = hotels.filter((h) => !linked.has(h.id));
    if (!todo.length) return { created: 0, linked: 0 };
    let franchise = new Map();
    try {
        franchise = new Map((await OwnerOutletLink.findAll({ where: { hotel_id: todo.map((h) => h.id) }, attributes: ["hotel_id", "owner_mobile"], raw: true })).map((r) => [r.hotel_id, mobile10(r.owner_mobile)]));
    } catch {
        // no franchise table on this server yet
    }
    const cfg = await customerSettings();
    const now = new Date();
    const newSince = moment(now).subtract(cfg.onboardingNewDays, "days").toDate();
    const out = { created: 0, linked: 0 };
    for (const h of todo) {
        const key = franchise.get(h.id) || mobile10(h.owner_number) || `h${h.id}`;
        const made = h.hotel_reg_date ? new Date(h.hotel_reg_date) : new Date(h.createdAt);
        const isNew = made >= newSince;
        try {
            await sequelize.transaction(async (t) => {
                let acc = await CsAccount.findOne({ where: { owner_mobile: key }, transaction: t, lock: t.LOCK.UPDATE });
                const lead = /^\d{10}$/.test(key)
                    ? await CrmLeadV2.findOne({ where: { phone_key: key, hotel_id: null, deleted_at: null, merged_into_id: null, won_at: { [Op.gte]: moment(now).subtract(90, "days").toDate() } }, order: [["won_at", "DESC"]], transaction: t })
                    : null;
                if (!acc) {
                    acc = await CsAccount.create({
                        name: txt(h.owner_name || h.hotel_name, 120),
                        owner_mobile: key,
                        owner_name: txt(h.owner_name, 120),
                        email: txt(h.owner_email_id, 120),
                        city: txt(h.address2, 60),
                        origin: lead ? "won" : isNew ? "outlet" : "existing",
                        customer_since: lead ? lead.won_at : made,
                        lead_id: lead ? lead.id : null,
                        won_by_id: lead ? lead.owner_id : null,
                        success_owner_id: await pickSuccessOwner(lead ? lead.owner_id : null, t),
                    }, { transaction: t });
                    await addActivity(acc.id, h.id, "created", null, lead ? `Customer account made from the won lead ${lead.name || lead.phone}` : isNew ? "Customer account made for a new outlet" : "Customer account made for an outlet that was live before the CRM", null, t);
                    out.created += 1;
                    if (acc.success_owner_id) await notify(acc.success_owner_id, { type: "account.new", title: `New customer: ${acc.name || key}`, body: h.hotel_name, link: `/accounts/${acc.id}`, ref: `accnew:${acc.id}` }, { transaction: t });
                } else if (lead && !acc.lead_id) {
                    await acc.update({ lead_id: lead.id, won_by_id: lead.owner_id }, { transaction: t });
                }
                const link = await CsAccountOutlet.create({ account_id: acc.id, hotel_id: h.id }, { transaction: t });
                await addActivity(acc.id, h.id, "link", null, `Outlet ${h.hotel_name} (#${h.id}) is in this account`, null, t);
                if (lead) {
                    await lead.update({ hotel_id: h.id }, { transaction: t });
                    await require("../crm/leads").activity(lead.id, "system", null, `Customer account: outlet ${h.hotel_name} (#${h.id})`, { accountId: acc.id, hotelId: h.id }, t);
                }
                // Due dates count from today: the CRM sees the outlet now, not when it was made.
                if ((isNew || lead) && h.active !== false && h.active !== 0) await onboarding.start(link, { ownerId: acc.success_owner_id, at: now }, t);
                out.linked += 1;
            });
        } catch (e) {
            if (!(e instanceof UniqueConstraintError)) throw e;
            // another run linked it at the same moment
        }
    }
    return out;
}

/* ------------------------------ list ------------------------------ */

const VIEWS = ["all", "mine", "red", "amber", "onboarding", "unowned"];
const severity = sequelize.literal("FIELD(`cs_account`.`health`, 'red', 'amber', 'green', 'grey')");

async function viewWhere(s, view) {
    switch (view) {
        case "mine":
            return { success_owner_id: s.user.id };
        case "red":
            return { health: "red" };
        case "amber":
            return { health: "amber" };
        case "unowned":
            return { success_owner_id: null };
        case "onboarding": {
            const ids = (await CsAccountOutlet.findAll({ where: { onboarding: "active" }, attributes: ["account_id"], group: ["account_id"], raw: true })).map((r) => r.account_id);
            return { id: ids.length ? ids : [0] };
        }
        default:
            return {};
    }
}

async function list(s, query = {}) {
    need(s, "customers.view");
    const view = VIEWS.includes(query.view) ? query.view : "all";
    const where = await viewWhere(s, view);
    const q = txt(query.q, 60);
    if (q) {
        const like = { [Op.like]: `%${q}%` };
        const hotelIds = (await Hotel.findAll({ where: { [Op.or]: [{ hotel_name: like }, ...(/^\d+$/.test(q) ? [{ id: Number(q) }] : [])] }, attributes: ["id"], limit: 500, raw: true })).map((h) => h.id);
        const viaOutlet = hotelIds.length ? (await CsAccountOutlet.findAll({ where: { hotel_id: hotelIds }, attributes: ["account_id"], raw: true })).map((r) => r.account_id) : [];
        where[Op.and] = [{ [Op.or]: [{ name: like }, { owner_name: like }, { owner_mobile: { [Op.like]: `%${q.replace(/\D/g, "") || q}%` } }, ...(viaOutlet.length ? [{ id: viaOutlet }] : [])] }];
    }
    if (query.ownerId) where.success_owner_id = Number(query.ownerId) || 0;
    const limit = 50;
    const page = Math.max(1, Number(query.page) || 1);
    const total = await CsAccount.count({ where });
    const rows = await CsAccount.findAll({ where, order: [[severity, "ASC"], ["name", "ASC"], ["id", "ASC"]], limit, offset: (page - 1) * limit, raw: true });
    const ids = rows.map((r) => r.id);
    const links = ids.length ? await CsAccountOutlet.findAll({ where: { account_id: ids }, raw: true }) : [];
    const hotels = new Map((links.length ? await Hotel.findAll({ where: { id: links.map((l) => l.hotel_id) }, attributes: ["id", "hotel_name", "product_plan", "plan_end_date", "active"], raw: true }) : []).map((h) => [h.id, h]));
    const tasks = ids.length ? await CsTask.findAll({ where: { account_id: ids, status: "open" }, attributes: ["account_id", [sequelize.fn("MIN", sequelize.col("due_at")), "due"], [sequelize.fn("COUNT", sequelize.col("id")), "n"]], group: ["account_id"], raw: true }) : [];
    const taskBy = new Map(tasks.map((x) => [x.account_id, x]));
    const who = await names(rows.map((r) => r.success_owner_id));
    const counts = {};
    for (const v of VIEWS) counts[v] = await CsAccount.count({ where: await viewWhere(s, v) });
    return {
        serverTime: new Date().toISOString(),
        view,
        total,
        page,
        limit,
        counts,
        accounts: rows.map((a) => {
            const mine = links.filter((l) => l.account_id === a.id);
            const outs = mine.map((l) => hotels.get(l.hotel_id)).filter(Boolean);
            const ends = outs.map((h) => h.plan_end_date).filter(Boolean).map((d) => new Date(d).getTime());
            const tk = taskBy.get(a.id);
            return {
                id: a.id,
                name: a.name,
                mobile: a.owner_mobile,
                ownerName: a.owner_name,
                health: a.health,
                reasons: parse(a.health_reasons) || [],
                outlets: outs.map((h) => ({ id: h.id, name: h.hotel_name, plan: h.product_plan, active: h.active !== false && h.active !== 0 })),
                onboarding: mine.filter((l) => l.onboarding === "active").length,
                successOwner: a.success_owner_id ? { id: a.success_owner_id, name: who.get(a.success_owner_id) || `#${a.success_owner_id}` } : null,
                nextTask: tk ? { due: tk.due, count: Number(tk.n) || 0 } : null,
                planEnds: ends.length ? new Date(Math.min(...ends)).toISOString() : null,
                since: a.customer_since,
                origin: a.origin,
            };
        }),
    };
}

/* ------------------------------ detail ------------------------------ */

async function getAccount(id, t, lock = false) {
    const acc = await CsAccount.findOne({ where: { id: Number(id) || 0 }, transaction: t, ...(lock && t ? { lock: t.LOCK.UPDATE } : {}) });
    if (!acc) throw new RuleError(NOT_FOUND);
    return acc;
}

async function detail(s, id) {
    need(s, "customers.view");
    const acc = await getAccount(id);
    const links = await CsAccountOutlet.findAll({ where: { account_id: acc.id }, order: [["id", "ASC"]], raw: true });
    const hotelIds = links.map((l) => l.hotel_id);
    const hotels = new Map((hotelIds.length ? await Hotel.findAll({ where: { id: hotelIds }, attributes: [...HOTEL_ATTRS, "address1", "contact1", "gst_no"], raw: true }) : []).map((h) => [h.id, h]));
    const regs = new Map((hotelIds.length ? await LocalServerRegistration.findAll({ where: { hotel_id: hotelIds, status: "active" }, raw: true }) : []).map((r) => [r.hotel_id, r]));
    const items = await onboarding.itemsFor(hotelIds);
    const tasks = await CsTask.findAll({ where: { account_id: acc.id, [Op.or]: [{ status: "open" }, { done_at: { [Op.gte]: moment().subtract(14, "days").toDate() } }] }, order: [["status", "DESC"], ["due_at", "ASC"]], limit: 60, raw: true });
    const acts = await CsActivity.findAll({ where: { account_id: acc.id }, order: [["at", "DESC"], ["id", "DESC"]], limit: 80, raw: true });
    const lead = acc.lead_id ? await CrmLeadV2.findOne({ where: { id: acc.lead_id }, attributes: ["id", "name", "phone", "owner_id", "won_at", "source"], raw: true }) : null;
    const who = await names([acc.success_owner_id, acc.won_by_id, lead && lead.owner_id, ...items.flatMap((i) => [i.owner_id, i.done_by]), ...tasks.flatMap((x) => [x.owner_id, x.done_by]), ...acts.map((a) => a.actor_id)]);
    const now = Date.now();
    const outlets = links.filter((l) => hotels.has(l.hotel_id)).map((l) => outletRow(l, hotels.get(l.hotel_id), regs.get(l.hotel_id), now, acc));
    const ends = outlets.map((o) => o.planEnd).filter(Boolean).map((d) => new Date(d).getTime());
    const credits = outlets.reduce((n, o) => n + (o.ebill ? Number(o.ebill.credits) || 0 : 0), 0);
    return {
        serverTime: new Date().toISOString(),
        account: {
            id: acc.id,
            name: acc.name,
            mobile: acc.owner_mobile,
            ownerName: acc.owner_name,
            email: acc.email,
            city: acc.city,
            note: acc.note,
            origin: acc.origin,
            since: acc.customer_since,
            health: acc.health,
            reasons: parse(acc.health_reasons) || [],
            healthAt: acc.health_at,
            successOwner: acc.success_owner_id ? { id: acc.success_owner_id, name: who.get(acc.success_owner_id) || `#${acc.success_owner_id}` } : null,
            wonBy: acc.won_by_id ? { id: acc.won_by_id, name: who.get(acc.won_by_id) || `#${acc.won_by_id}` } : null,
            lead: lead ? { id: lead.id, name: lead.name, phone: lead.phone, source: lead.source, wonAt: lead.won_at } : null,
        },
        outlets,
        onboarding: items.map((i) => onboarding.view(i, who)),
        tasks: tasks.map((x) => ({ id: x.id, hotelId: x.hotel_id, type: x.type, note: x.note, dueAt: x.due_at, status: x.status, origin: x.origin, owner: x.owner_id ? { id: x.owner_id, name: who.get(x.owner_id) || `#${x.owner_id}` } : null, doneAt: x.done_at, doneBy: x.done_by ? who.get(x.done_by) || `#${x.done_by}` : null, result: x.result })),
        activity: acts.map((a) => ({ id: a.id, type: a.type, hotelId: a.hotel_id, actor: a.actor_id ? who.get(a.actor_id) || `#${a.actor_id}` : null, body: a.body, at: a.at })),
        money: { planEnds: ends.length ? new Date(Math.min(...ends)).toISOString() : null, ebillCredits: outlets.some((o) => o.ebill) ? credits : null, ...(await moneyOf(acc.id)) },
        people: (await successPeople()).map((p) => ({ id: p.id, name: p.name })),
    };
}

/** Paid this financial year (approved payments), due now, and the latest invoices (phase 6). */
async function moneyOf(accountId) {
    try {
        const { BilInvoice, BilPayment } = require("../../model");
        const { fyOf } = require("../bil/common");
        const fy = fyOf();
        const fyStart = moment.tz(`20${fy.slice(0, 2)}-04-01`, "YYYY-MM-DD", "Asia/Kolkata").toDate();
        const paid = Number((await BilPayment.sum("amount", { where: { account_id: accountId, status: "approved", createdAt: { [Op.gte]: fyStart } } })) || 0);
        const open = await BilInvoice.findAll({ where: { account_id: accountId, kind: "invoice", status: ["issued", "part_paid"] }, attributes: ["total", "paid"], raw: true });
        const due = open.reduce((n, i) => n + Number(i.total) - Number(i.paid), 0);
        const recent = await BilInvoice.findAll({ where: { account_id: accountId, status: { [Op.ne]: "draft" } }, order: [["id", "DESC"]], limit: 6, attributes: ["id", "number", "kind", "status", "total", "paid", "issued_at"], raw: true });
        return { paidThisYear: Math.round(paid * 100) / 100, due: Math.round(due * 100) / 100, invoices: recent.map((i) => ({ id: i.id, number: i.number, kind: i.kind, status: i.status, total: Number(i.total), due: Math.max(0, Number(i.total) - Number(i.paid)), issuedAt: i.issued_at })) };
    } catch {
        // billing tables not migrated yet
        return { paidThisYear: null, due: null, invoices: [] };
    }
}

/* ------------------------------ changes ------------------------------ */

async function update(s, id, input = {}) {
    need(s, "customers.manage");
    return sequelize.transaction(async (t) => {
        const acc = await getAccount(id, t, true);
        const before = acc.get({ plain: true });
        const patch = {};
        if (input.name !== undefined) {
            patch.name = txt(input.name, 120);
            if (!patch.name) throw new RuleError("Write the account's name.");
        }
        if (input.ownerName !== undefined) patch.owner_name = txt(input.ownerName, 120);
        if (input.email !== undefined) patch.email = txt(input.email, 120);
        if (input.city !== undefined) patch.city = txt(input.city, 60);
        if (input.note !== undefined) patch.note = txt(input.note, 500);
        if (!Object.keys(patch).length) throw new RuleError("Nothing to change.");
        await acc.update(patch, { transaction: t });
        await audit.write(s, { action: "account.update", entity: "cs_account", entityId: acc.id, summary: `Edited account ${acc.name}`, before, after: acc }, { transaction: t });
        return { id: acc.id };
    });
}

async function setOwner(s, id, ownerId, reason) {
    need(s, "customers.manage");
    const to = Number(ownerId) || null;
    return sequelize.transaction(async (t) => {
        const acc = await getAccount(id, t, true);
        if (to) {
            const u = await AdmUser.findOne({ where: { id: to, status: "active" }, attributes: ["id", "name"], raw: true, transaction: t });
            if (!u) throw new RuleError("Choose an active person.");
        }
        if (acc.success_owner_id === to) throw new RuleError("This person already looks after the account.");
        const from = acc.success_owner_id;
        await acc.update({ success_owner_id: to }, { transaction: t });
        const { CsOnboardingItem } = require("../../model");
        await CsOnboardingItem.update({ owner_id: to }, { where: { account_id: acc.id, done_at: null, owner_id: from }, transaction: t });
        await CsTask.update({ owner_id: to }, { where: { account_id: acc.id, status: "open", owner_id: from }, transaction: t });
        const who = await names([from, to]);
        await addActivity(acc.id, null, "owner", s.user.id, `Success owner: ${from ? who.get(from) : "nobody"} -> ${to ? who.get(to) : "nobody"}${reason ? ` (${txt(reason, 200)})` : ""}`, { from, to }, t);
        await audit.write(s, { action: "account.owner", entity: "cs_account", entityId: acc.id, summary: `Success owner of ${acc.name} changed`, before: { success_owner_id: from }, after: { success_owner_id: to }, reason: txt(reason, 300) }, { transaction: t });
        if (to && to !== s.user.id) await notify(to, { type: "account.owner", title: `You now look after ${acc.name}`, body: `Given by ${s.user.name}`, link: `/accounts/${acc.id}`, ref: `accowner:${acc.id}:${to}:${Date.now()}` }, { transaction: t });
        return { id: acc.id };
    });
}

async function addNote(s, id, text) {
    need(s, "customers.manage");
    const body = txt(text, 1000);
    if (!body) throw new RuleError("Write the note.");
    const acc = await getAccount(id);
    await addActivity(acc.id, null, "note", s.user.id, body, null);
    return { id: acc.id };
}

/* ------------------------------ tasks ------------------------------ */

const TASK_TYPES = ["call", "whatsapp", "visit", "training", "other"];

async function taskAdd(s, accountId, input = {}) {
    need(s, "customers.manage");
    const acc = await getAccount(accountId);
    const type = TASK_TYPES.includes(input.type) ? input.type : "call";
    const due = input.dueAt ? new Date(input.dueAt) : addWorkingMinutes(await workingHours(), new Date(), 60);
    if (Number.isNaN(due.getTime())) throw new RuleError("Choose when it is due.");
    const hotelId = input.hotelId ? Number(input.hotelId) || null : null;
    if (hotelId && !(await CsAccountOutlet.findOne({ where: { account_id: acc.id, hotel_id: hotelId }, raw: true }))) throw new RuleError("That outlet is not in this account.");
    const owner = input.ownerId ? Number(input.ownerId) || null : acc.success_owner_id || s.user.id;
    return sequelize.transaction(async (t) => {
        const task = await CsTask.create({ account_id: acc.id, hotel_id: hotelId, owner_id: owner, type, note: txt(input.note, 300), due_at: due, origin: "manual", created_by: s.user.id }, { transaction: t });
        await addActivity(acc.id, hotelId, "task", s.user.id, `Next action: ${type}${input.note ? ` - ${txt(input.note, 200)}` : ""}`, { taskId: task.id, due }, t);
        if (owner && owner !== s.user.id) await notify(owner, { type: "account.task", title: `New task for ${acc.name}`, body: txt(input.note, 200) || type, link: `/accounts/${acc.id}`, ref: `cstask:${task.id}` }, { transaction: t });
        return { id: task.id };
    });
}

async function taskDone(s, taskId, result) {
    need(s, "customers.manage");
    return sequelize.transaction(async (t) => {
        const task = await CsTask.findOne({ where: { id: Number(taskId) || 0 }, transaction: t, lock: t.LOCK.UPDATE });
        if (!task) throw new RuleError("This task does not exist.");
        if (task.status !== "open") throw new RuleError("This task is already closed.");
        await task.update({ status: "done", done_at: new Date(), done_by: s.user.id, result: txt(result, 300) }, { transaction: t });
        await addActivity(task.account_id, task.hotel_id, "task", s.user.id, `Done: ${task.note || task.type}${result ? ` - ${txt(result, 300)}` : ""}`, { taskId: task.id }, t);
        return { id: task.id };
    });
}

async function taskMove(s, taskId, dueAt) {
    need(s, "customers.manage");
    const d = new Date(dueAt);
    if (Number.isNaN(d.getTime())) throw new RuleError("Choose when it is due.");
    const [n] = await CsTask.update({ due_at: d }, { where: { id: Number(taskId) || 0, status: "open" } });
    if (!n) throw new RuleError("This task is not open.");
    return { id: Number(taskId) };
}

/** Moves an outlet into another account (a second brand, a franchise, a wrong grouping). */
async function moveOutlet(s, hotelId, toAccountId, reason) {
    need(s, "outlets.manage");
    const why = txt(reason, 300);
    if (why.length < 5) throw new RuleError("Write why (at least a few words).");
    return sequelize.transaction(async (t) => {
        const link = await CsAccountOutlet.findOne({ where: { hotel_id: Number(hotelId) || 0 }, transaction: t, lock: t.LOCK.UPDATE });
        if (!link) throw new RuleError("This outlet is not in an account yet.");
        const to = await getAccount(toAccountId, t, true);
        if (link.account_id === to.id) throw new RuleError("The outlet is already in this account.");
        const from = link.account_id;
        const hotel = await Hotel.findOne({ where: { id: link.hotel_id }, attributes: ["id", "hotel_name"], raw: true, transaction: t });
        await link.update({ account_id: to.id, linked_by: s.user.id }, { transaction: t });
        const { CsOnboardingItem } = require("../../model");
        await CsOnboardingItem.update({ account_id: to.id }, { where: { hotel_id: link.hotel_id }, transaction: t });
        await CsTask.update({ account_id: to.id }, { where: { hotel_id: link.hotel_id, status: "open" }, transaction: t });
        await addActivity(to.id, link.hotel_id, "link", s.user.id, `Outlet ${hotel.hotel_name} moved here (${why})`, { from }, t);
        await addActivity(from, link.hotel_id, "link", s.user.id, `Outlet ${hotel.hotel_name} moved to account ${to.name} (${why})`, { to: to.id }, t);
        await audit.write(s, { action: "outlet.move", entity: "hotel", entityId: link.hotel_id, summary: `Moved ${hotel.hotel_name} to account ${to.name}`, before: { account_id: from }, after: { account_id: to.id }, reason: why }, { transaction: t });
        return { accountId: to.id };
    });
}

/** Accounts to move an outlet into (search by name or mobile). */
async function pick(s, q) {
    need(s, "customers.view");
    const term = txt(q, 60);
    if (term.length < 2) return { accounts: [] };
    const like = { [Op.like]: `%${term}%` };
    const rows = await CsAccount.findAll({ where: { [Op.or]: [{ name: like }, { owner_name: like }, { owner_mobile: like }] }, attributes: ["id", "name", "owner_mobile"], limit: 15, raw: true });
    return { accounts: rows.map((r) => ({ id: r.id, name: r.name, mobile: r.owner_mobile })) };
}

module.exports = { ensureAccounts, assignUnowned, pickSuccessOwner, successPeople, list, detail, update, setOwner, addNote, taskAdd, taskDone, taskMove, moveOutlet, pick, getAccount, HOTEL_ATTRS };
