const { Op } = require("sequelize");
const { sequelize, Hotel, BilInvoice, CsAccount, CsAccountOutlet, CsRenewal, CsTask, CrmWaTemplate, AdmUser } = require("../../model");
const { RuleError } = require("../../appv1/core");
const worker = require("../../services/admin/worker");
const { need } = require("../auth");
const audit = require("../audit");
const { notify } = require("../crm/notify");
const { workingHours, addWorkingMinutes } = require("../crm/util");
const { addActivity } = require("../cs/common");
const invoices = require("./invoices");
const { billingSettings, money, moment, TZ, txt } = require("./common");

// Renewals and the plan lock (owner 2026-10-08):
//   - every outlet whose plan ends within 30 days gets a renewal (stages
//     upcoming -> contacted -> invoiced -> paid, or churned with a reason);
//   - ONE reminder, exactly 1 day before the end: the renewal invoice and
//     its PhonePe link on WhatsApp (template), or a task for the success
//     owner when WhatsApp cannot send it;
//   - at the end the software locks at once. The banner offers "Extend 1
//     day" once per renewal (the plan end moves to now + 24 h); after that
//     only paying unlocks it. Paying runs the plan on from the paid-up end
//     (or today, when that has passed) - the grace day is not counted twice.

const STAGES = ["upcoming", "contacted", "invoiced", "paid", "churned"];
const OPEN = ["upcoming", "contacted", "invoiced"];

/** The renewal reminder template the owner submits to Meta (Settings shows it). */
const TEMPLATE_TEXT = "Hello {{1}}, your BillerPe plan for {{2}} ends on {{3}}. Renew now for {{4}} (incl. GST) with this payment link: {{5}} . If the plan ends, the software locks until it is renewed.";

/* ------------------------------ renewals for outlets ------------------------------ */

/** Opens the renewal of every outlet whose plan ends within 30 days (or ended within 60) and has none open. */
async function ensure({ only = null, now = new Date() } = {}) {
    const where = { testing: { [Op.not]: true }, active: { [Op.not]: false }, plan_end_date: { [Op.between]: [moment(now).subtract(60, "days").toDate(), moment(now).add(30, "days").toDate()] }, ...(only ? { id: only } : {}) };
    const hotels = await Hotel.findAll({ where, attributes: ["id", "hotel_name", "plan_end_date"], raw: true });
    let made = 0;
    let moved = 0;
    for (const h of hotels) {
        const open = await CsRenewal.findOne({ where: { hotel_id: h.id, stage: OPEN }, order: [["ends_on", "DESC"]] });
        if (open) {
            // The plan was extended some other way (old renewal screen, date changed by hand): this renewal is done.
            if (new Date(h.plan_end_date) > moment(open.ends_on).add(2, "days").toDate() && !open.grace_used_at) {
                await open.update({ stage: "paid", paid_at: now, note: "Plan end moved outside billing" });
                moved += 1;
            }
            continue;
        }
        if (await CsRenewal.findOne({ where: { hotel_id: h.id, ends_on: h.plan_end_date } })) continue;
        const link = await CsAccountOutlet.findOne({ where: { hotel_id: h.id }, raw: true });
        const acc = link ? await CsAccount.findOne({ where: { id: link.account_id }, attributes: ["id", "success_owner_id"], raw: true }) : null;
        await CsRenewal.create({ hotel_id: h.id, account_id: acc ? acc.id : null, ends_on: h.plan_end_date, owner_id: acc ? acc.success_owner_id : null, stage: "upcoming" });
        if (acc) await addActivity(acc.id, h.id, "renewal", null, `Renewal opened: ${h.hotel_name}'s plan ends on ${moment(h.plan_end_date).tz(TZ).format("D MMM YYYY")}`, null);
        made += 1;
    }
    return { made, moved };
}

/** The open renewal for an outlet's current plan end (made when missing). */
async function openFor(hotelId, t) {
    const open = await CsRenewal.findOne({ where: { hotel_id: hotelId, stage: OPEN }, order: [["ends_on", "DESC"]], transaction: t, lock: t ? t.LOCK.UPDATE : undefined });
    if (open) return open;
    const h = await Hotel.findOne({ where: { id: hotelId }, attributes: ["id", "plan_end_date"], raw: true, transaction: t });
    if (!h || !h.plan_end_date) return null;
    const link = await CsAccountOutlet.findOne({ where: { hotel_id: hotelId }, raw: true, transaction: t });
    const acc = link ? await CsAccount.findOne({ where: { id: link.account_id }, attributes: ["id", "success_owner_id"], raw: true, transaction: t }) : null;
    const [row] = await CsRenewal.findOrCreate({ where: { hotel_id: hotelId, ends_on: h.plan_end_date }, defaults: { account_id: acc ? acc.id : null, owner_id: acc ? acc.success_owner_id : null, stage: "upcoming" }, transaction: t });
    return row;
}

/** The renewal's open invoice, issued at the catalog price when there is none. */
async function invoiceFor(renewal, t) {
    if (renewal.invoice_id) {
        const inv = await BilInvoice.findOne({ where: { id: renewal.invoice_id }, transaction: t });
        if (inv && invoices.OPEN.includes(inv.status)) return inv;
    }
    const existing = await BilInvoice.findOne({ where: { renewal_id: renewal.id, kind: "invoice", status: invoices.OPEN }, order: [["id", "DESC"]], transaction: t });
    if (existing) return existing;
    const inv = await invoices.renewalInvoice(renewal.hotel_id, renewal.id, t);
    await renewal.update({ invoice_id: inv.id, stage: renewal.stage === "paid" ? "paid" : "invoiced" }, { transaction: t });
    return inv;
}

/* ------------------------------ the one reminder ------------------------------ */

/** Job: renewals whose plan ends within the next 24 hours, not reminded yet. */
async function remind({ only = null, now = new Date() } = {}) {
    const rows = await CsRenewal.findAll({ where: { stage: OPEN, reminded_at: null, ends_on: { [Op.gt]: now, [Op.lte]: moment(now).add(24, "hours").toDate() }, ...(only ? { hotel_id: only } : {}) } });
    const cfg = await billingSettings();
    const tpl = await CrmWaTemplate.findOne({ where: { name: cfg.reminderTemplate, active: true } });
    const wh = await workingHours();
    let wa = 0;
    let tasks = 0;
    for (const r of rows) {
        const h = await Hotel.findOne({ where: { id: r.hotel_id }, attributes: ["id", "hotel_name", "owner_name", "plan_end_date"], raw: true });
        if (!h) continue;
        const inv = await sequelize.transaction((t) => invoiceFor(r, t));
        const link = await require("./payments").linkFor(inv.id);
        const mobile = await invoices.ownerMobileOf(h.id);
        let how = "task";
        if (tpl && mobile) {
            try {
                const chat = await require("../crm/wa").chatFor(mobile, { name: h.owner_name || "" });
                const res = await require("../crm/wa").sendTemplate(chat, tpl, [String(h.owner_name || "there").split(/\s+/)[0], h.hotel_name, moment(r.ends_on).tz(TZ).format("D MMM YYYY"), money(inv.total), payUrl(link)], { sender: "system" });
                if (!res || !res.skipped) how = "whatsapp";
            } catch (e) {
                console.error("[renewals] reminder WhatsApp:", e && e.message);
            }
        }
        await sequelize.transaction(async (t) => {
            await CsRenewal.update({ reminded_at: now, remind_how: how }, { where: { id: r.id }, transaction: t });
            if (how === "task" && r.owner_id) {
                await CsTask.findOrCreate({
                    where: { ref: `renew-remind:${r.id}` },
                    defaults: { account_id: r.account_id || 0, hotel_id: r.hotel_id, owner_id: r.owner_id, type: "call", note: `Plan ends tomorrow: send ${h.hotel_name} the payment link (${money(inv.total)})`, due_at: addWorkingMinutes(wh, now, 0), origin: "rule" },
                    transaction: t,
                });
                tasks += 1;
            } else if (how === "whatsapp") wa += 1;
            if (r.account_id) await addActivity(r.account_id, r.hotel_id, "renewal", null, how === "whatsapp" ? `Renewal reminder sent on WhatsApp with the payment link (${money(inv.total)})` : "Renewal reminder: WhatsApp could not send it, the success owner has a task", { invoiceId: inv.id }, t);
        });
    }
    return `${rows.length} due, ${wa} on WhatsApp, ${tasks} tasks`;
}

/** Plans that ended unpaid: one task for the success owner (the outlet is locked now). */
async function expiredTasks(now = new Date()) {
    const rows = await CsRenewal.findAll({ where: { stage: OPEN, ends_on: { [Op.lt]: now, [Op.gt]: moment(now).subtract(30, "days").toDate() } } });
    const wh = await workingHours();
    for (const r of rows) {
        if (!r.owner_id) continue;
        const h = await Hotel.findOne({ where: { id: r.hotel_id }, attributes: ["hotel_name", "plan_end_date"], raw: true });
        if (!h || new Date(h.plan_end_date) > now) continue;
        await CsTask.findOrCreate({ where: { ref: `renew-expired:${r.id}` }, defaults: { account_id: r.account_id || 0, hotel_id: r.hotel_id, owner_id: r.owner_id, type: "call", note: `${h.hotel_name}: plan ended, software locked - get the renewal paid`, due_at: addWorkingMinutes(wh, now, 0), origin: "rule" } });
    }
}

const payUrl = (link) => (link.url.startsWith("sim:") ? `https://pay.example.test/${link.url.slice(4)}` : link.url);

/* ------------------------------ the plan lock ------------------------------ */

/**
 * What the outlet's software shows: locked or not, the end, whether the
 * one "Extend 1 day" is still there. Every app (POS App, Owner App, the
 * outlet PC) asks this.
 */
async function planState(hotelId, now = new Date()) {
    const h = await Hotel.findOne({ where: { id: hotelId }, attributes: ["id", "hotel_name", "plan_end_date", "active", "testing"], raw: true });
    if (!h) return null;
    const end = h.plan_end_date ? new Date(h.plan_end_date) : null;
    const expired = !!end && end <= now;
    const r = await CsRenewal.findOne({ where: { hotel_id: hotelId, stage: OPEN }, order: [["ends_on", "DESC"]], raw: true });
    const graceUsed = !!(r && r.grace_used_at);
    return {
        hotelId: h.id,
        outlet: h.hotel_name,
        endsAt: end ? end.toISOString() : null,
        paidUntil: r && r.grace_used_at ? new Date(r.ends_on).toISOString() : end ? end.toISOString() : null,
        expired,
        inGrace: graceUsed && !expired,
        graceUsed,
        canExtend: expired && !graceUsed,
        daysLeft: end ? Math.floor((end.getTime() - now.getTime()) / 86400000) : null,
        message: !expired
            ? graceUsed
                ? `Extended by 1 day until ${moment(end).tz(TZ).format("D MMM, h:mm A")}. Renew now to keep using BillerPe.`
                : null
            : graceUsed
              ? "The 1-day extension is used. Renew with the payment link to unlock the software."
              : "The software is locked until the plan is renewed. Renew now, or extend it once by 1 day.",
    };
}

/**
 * "Extend 1 day" on the banner: once per renewal, only after the plan has
 * ended. usedAt = when it was pressed on an outlet PC that was offline then
 * (owner 2026-10-08: it works offline once; the PC reports it later) - the
 * day counts from that moment, not from the report.
 */
async function extendOneDay(hotelId, by = "outlet", now = new Date(), usedAt = null) {
    const pressed = usedAt ? new Date(usedAt) : null;
    const start = pressed && !Number.isNaN(pressed.getTime()) && pressed <= now && now - pressed < 48 * 3600000 ? pressed : now;
    return sequelize.transaction(async (t) => {
        const hotel = await Hotel.findOne({ where: { id: hotelId }, transaction: t, lock: t.LOCK.UPDATE });
        if (!hotel) throw new RuleError("Outlet not found.");
        if (!hotel.plan_end_date || new Date(hotel.plan_end_date) > start) throw new RuleError("The plan has not ended: nothing to extend.");
        const r = await openFor(hotel.id, t);
        if (!r) throw new RuleError("The plan has not ended: nothing to extend.");
        if (r.grace_used_at) throw new RuleError("The 1-day extension was already used. Renew with the payment link to unlock the software.");
        const until = new Date(start.getTime() + 24 * 3600000);
        await hotel.update({ plan_end_date: until }, { transaction: t });
        await r.update({ grace_used_at: start, grace_by: txt(by, 40) }, { transaction: t });
        if (r.account_id) await addActivity(r.account_id, hotel.id, "renewal", null, `${hotel.hotel_name}: extended by 1 day from the lock banner (${txt(by, 40)}) - locks again ${moment(until).tz(TZ).format("D MMM, h:mm A")}`, null, t);
        if (r.owner_id) await notify(r.owner_id, { type: "renewal.grace", title: `${hotel.hotel_name} used its 1-day extension`, body: "The plan ended unpaid. It locks again in 24 hours.", link: `/billing/renewals`, ref: `grace:${r.id}` }, { transaction: t });
        return { until: until.toISOString() };
    }).then(async (r) => ({ ...r, state: await planState(hotelId) }));
}

/** "Pay now" on the banner: the renewal invoice's payment link. */
async function payLink(hotelId) {
    const inv = await sequelize.transaction(async (t) => {
        const r = await openFor(hotelId, t);
        if (!r) throw new RuleError("Nothing to pay now. Call BillerPe if you want to renew early.");
        return invoiceFor(r, t);
    });
    const link = await require("./payments").linkFor(inv.id);
    return { url: payUrl(link), amount: Number(link.amount), invoice: inv.number, simulated: link.url.startsWith("sim:") };
}

/* ------------------------------ the renewals screen ------------------------------ */

const VIEWS = ["upcoming", "tomorrow", "expired", "invoiced", "mine", "paid", "churned"];

function viewWhere(s, view, now = new Date()) {
    switch (view) {
        case "tomorrow":
            return { stage: OPEN, ends_on: { [Op.gt]: now, [Op.lte]: moment(now).add(48, "hours").toDate() } };
        case "expired":
            return { stage: OPEN, ends_on: { [Op.lte]: now } };
        case "invoiced":
            return { stage: "invoiced" };
        case "mine":
            return { stage: OPEN, owner_id: s.user.id };
        case "paid":
            return { stage: "paid", paid_at: { [Op.gte]: moment(now).subtract(60, "days").toDate() } };
        case "churned":
            return { stage: "churned" };
        default:
            return { stage: OPEN };
    }
}

async function list(s, query = {}) {
    need(s, "customers.view");
    const view = VIEWS.includes(query.view) ? query.view : "upcoming";
    const rows = await CsRenewal.findAll({ where: viewWhere(s, view), order: [["ends_on", view === "paid" || view === "churned" ? "DESC" : "ASC"]], limit: 300, raw: true });
    const hotels = new Map((rows.length ? await Hotel.findAll({ where: { id: rows.map((r) => r.hotel_id) }, attributes: ["id", "hotel_name", "plan_end_date", "product_plan"], raw: true }) : []).map((h) => [h.id, h]));
    const links = new Map((rows.length ? await CsAccountOutlet.findAll({ where: { hotel_id: rows.map((r) => r.hotel_id) }, attributes: ["hotel_id", "plan_name"], raw: true }) : []).map((l) => [l.hotel_id, l]));
    const accs = new Map((rows.length ? await CsAccount.findAll({ where: { id: [...new Set(rows.map((r) => r.account_id).filter(Boolean))] }, attributes: ["id", "name", "owner_mobile"], raw: true }) : []).map((a) => [a.id, a]));
    const invs = new Map((rows.length ? await BilInvoice.findAll({ where: { id: rows.map((r) => r.invoice_id).filter(Boolean) }, raw: true }) : []).map((i) => [i.id, i]));
    const names = new Map((await AdmUser.findAll({ where: { id: [...new Set(rows.map((r) => r.owner_id).filter(Boolean))] }, attributes: ["id", "name"], raw: true })).map((u) => [u.id, u.name]));
    const counts = {};
    for (const v of VIEWS) counts[v] = await CsRenewal.count({ where: viewWhere(s, v) });
    const now = Date.now();
    return {
        serverTime: new Date().toISOString(),
        view,
        counts,
        renewals: rows.map((r) => {
            const h = hotels.get(r.hotel_id) || {};
            const a = accs.get(r.account_id);
            const inv = invs.get(r.invoice_id);
            return {
                id: r.id,
                hotelId: r.hotel_id,
                outlet: h.hotel_name || `#${r.hotel_id}`,
                planName: (links.get(r.hotel_id) || {}).plan_name || "",
                product: h.product_plan || "",
                account: a ? { id: a.id, name: a.name, mobile: a.owner_mobile } : null,
                endsOn: r.ends_on,
                planEnd: h.plan_end_date || null,
                locked: !!h.plan_end_date && new Date(h.plan_end_date).getTime() <= now,
                stage: r.stage,
                owner: r.owner_id ? { id: r.owner_id, name: names.get(r.owner_id) || `#${r.owner_id}` } : null,
                invoice: inv ? { id: inv.id, number: inv.number, status: inv.status, total: Number(inv.total), due: invoices.due(inv) } : null,
                remindedAt: r.reminded_at,
                remindHow: r.remind_how,
                graceUsedAt: r.grace_used_at,
                paidAt: r.paid_at,
                churnReason: r.churn_reason,
                note: r.note,
            };
        }),
    };
}

async function getRenewal(id, t) {
    const r = await CsRenewal.findOne({ where: { id: Number(id) || 0 }, transaction: t, lock: t ? t.LOCK.UPDATE : undefined });
    if (!r) throw new RuleError("This renewal does not exist.");
    return r;
}

async function setStage(s, id, stage, note) {
    need(s, "customers.manage");
    if (!["upcoming", "contacted"].includes(stage)) throw new RuleError("Use Make invoice, a payment or Churned for the other stages.");
    return sequelize.transaction(async (t) => {
        const r = await getRenewal(id, t);
        if (!OPEN.includes(r.stage)) throw new RuleError("This renewal is closed.");
        await r.update({ stage, note: txt(note, 300) || r.note }, { transaction: t });
        if (r.account_id) await addActivity(r.account_id, r.hotel_id, "renewal", s.user.id, `Renewal: ${stage}${note ? ` (${txt(note, 200)})` : ""}`, null, t);
        return { id: r.id };
    });
}

async function makeInvoice(s, id) {
    need(s, "billing.manage");
    return sequelize.transaction(async (t) => {
        const r = await getRenewal(id, t);
        if (!OPEN.includes(r.stage)) throw new RuleError("This renewal is closed.");
        const inv = await invoiceFor(r, t);
        await audit.write(s, { action: "renewal.invoice", entity: "cs_renewal", entityId: r.id, summary: `Renewal invoice ${inv.number} (${money(inv.total)})` }, { transaction: t });
        return { invoiceId: inv.id, number: inv.number };
    });
}

async function churn(s, id, reason) {
    need(s, "customers.manage");
    const why = txt(reason, 200);
    if (why.length < 3) throw new RuleError("Choose or write why they did not renew.");
    return sequelize.transaction(async (t) => {
        const r = await getRenewal(id, t);
        if (!OPEN.includes(r.stage)) throw new RuleError("This renewal is closed.");
        await r.update({ stage: "churned", churned_at: new Date(), churn_reason: why }, { transaction: t });
        if (r.invoice_id) {
            const inv = await BilInvoice.findOne({ where: { id: r.invoice_id }, transaction: t });
            if (inv && invoices.OPEN.includes(inv.status) && Number(inv.paid) === 0) await invoices.cancel(s, inv.id, `Not renewed: ${why}`).catch(() => {});
        }
        if (r.account_id) await addActivity(r.account_id, r.hotel_id, "renewal", s.user.id, `Did not renew: ${why}`, null, t);
        await audit.write(s, { action: "renewal.churn", entity: "cs_renewal", entityId: r.id, summary: "Marked as not renewed", reason: why }, { transaction: t });
        return { id: r.id };
    });
}

/** Staff can give the 1-day extension too (from the outlet's renewal), with a reason. */
async function staffExtend(s, id, reason) {
    need(s, "customers.manage");
    const why = txt(reason, 200);
    if (why.length < 5) throw new RuleError("Write why (at least a few words).");
    const r = await getRenewal(id);
    const out = await extendOneDay(r.hotel_id, `staff: ${s.user.name}`);
    await audit.write(s, { action: "renewal.extend", entity: "cs_renewal", entityId: r.id, summary: "Gave the 1-day extension", reason: why });
    return out;
}

worker.registerJob("bil.renewals", async () => {
    const e = await ensure();
    const r = await remind();
    await expiredTasks();
    return `opened ${e.made}, closed ${e.moved}; reminders: ${r}`;
});
worker.registerSchedule("bil.renewals", 900);

module.exports = { ensure, remind, expiredTasks, openFor, invoiceFor, planState, extendOneDay, payLink, list, setStage, makeInvoice, churn, staffExtend, TEMPLATE_TEXT, STAGES };
