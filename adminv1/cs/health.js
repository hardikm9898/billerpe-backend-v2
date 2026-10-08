const { Op, QueryTypes } = require("sequelize");
const { sequelize, Hotel, Order, LocalServerRegistration, ExeRelease, AppDevice, RaiseTicket, EBillCredit, EBillCreditDebit, CsAccount, CsAccountOutlet, CsOutletDay, CsOnboardingItem, CsTask, AdmSetting } = require("../../model");
const worker = require("../../services/admin/worker");
const { notify } = require("../crm/notify");
const { workingHours, addWorkingMinutes } = require("../crm/util");
const accounts = require("./accounts");
const onboarding = require("./onboarding");
const { worse, cmpVersion, customerSettings, addActivity, todayStr, daysBetween, json, parse, moment, TZ } = require("./common");

// Customer health (design doc "After the sale"): green / amber / red for
// every outlet and account, from the outlet's real data - bills against its
// own 4-week normal, the outlet PC's heartbeat, exe version and update,
// upload backlog, open tickets, plan end date, e-bill credits, late
// onboarding steps. Runs every 15 minutes in the admin worker; once a day it
// first stores yesterday's bills per outlet (cs_outlet_days), which is where
// the normal comes from. A move to red makes a follow-up task for the
// account's success owner; leaving red closes it.

const table = (Model) => {
    const n = Model.getTableName();
    return typeof n === "string" ? n : n.tableName;
};

async function tolerant(sql, replacements = {}) {
    try {
        return await sequelize.query(sql, { replacements, type: QueryTypes.SELECT });
    } catch {
        return null;
    }
}

/* ------------------------------ daily bills ------------------------------ */

/**
 * Bills and sales per outlet per day for the last `days` full days (India
 * dates) into cs_outlet_days. The first run fills 4 weeks; later runs redo
 * the last 3 days, which also picks up bills a PC uploaded late.
 */
async function snapshot({ days = null, now = new Date() } = {}) {
    const today = todayStr(now);
    const have = await CsOutletDay.count();
    const n = days || (have ? 3 : 29);
    const from = moment.tz(today, TZ).subtract(n, "days").format("YYYY-MM-DD");
    const rows = await Order.findAll({
        where: { business_date: { [Op.gte]: from, [Op.lt]: today }, payment: "success", deleted: false },
        attributes: ["hotel_id", "business_date", [sequelize.fn("COUNT", sequelize.col("id")), "n"], [sequelize.fn("SUM", sequelize.col("grandAmount")), "sales"]],
        group: ["hotel_id", "business_date"],
        raw: true,
    });
    const list = rows.filter((r) => r.hotel_id).map((r) => ({ hotel_id: r.hotel_id, day: String(r.business_date).slice(0, 10), bills: Number(r.n) || 0, sales: Math.round((Number(r.sales) || 0) * 100) / 100 }));
    for (let i = 0; i < list.length; i += 500) await CsOutletDay.bulkCreate(list.slice(i, i + 500), { updateOnDuplicate: ["bills", "sales", "updatedAt"] });
    const [row] = await AdmSetting.findOrCreate({ where: { setting_key: "cs_snapshot_day" }, defaults: { value: today } });
    if (row.value !== today) await row.update({ value: today });
    return list.length;
}

/* ------------------------------ signals ------------------------------ */

/** Everything the rules need, for every outlet in an account (or `only`). */
async function collect(now = new Date(), only = null) {
    const links = await CsAccountOutlet.findAll({ where: only ? { hotel_id: only } : {}, raw: true });
    const ids = links.map((l) => l.hotel_id);
    if (!ids.length) return { links: [], data: new Map() };
    const today = todayStr(now);
    const yesterday = moment.tz(today, TZ).subtract(1, "day").format("YYYY-MM-DD");
    const since = moment.tz(today, TZ).subtract(28, "days").format("YYYY-MM-DD");

    const hotels = new Map((await Hotel.findAll({ where: { id: ids }, attributes: ["id", "hotel_name", "product_plan", "plan_end_date", "active", "testing", "createdAt", "hotel_reg_date", "app_device_limit"], raw: true })).map((h) => [h.id, h]));
    const todayRows = await Order.findAll({ where: { hotel_id: ids, business_date: today, payment: "success", deleted: false }, attributes: ["hotel_id", [sequelize.fn("COUNT", sequelize.col("id")), "n"], [sequelize.fn("SUM", sequelize.col("grandAmount")), "sales"]], group: ["hotel_id"], raw: true });
    const billsToday = new Map(todayRows.map((r) => [r.hotel_id, { n: Number(r.n) || 0, sales: Number(r.sales) || 0 }]));
    const dayRows = await CsOutletDay.findAll({ where: { hotel_id: ids, day: { [Op.gte]: since, [Op.lt]: today } }, attributes: ["hotel_id", "day", "bills"], raw: true });
    const days = new Map();
    for (const r of dayRows) {
        if (!days.has(r.hotel_id)) days.set(r.hotel_id, []);
        days.get(r.hotel_id).push({ day: String(r.day).slice(0, 10), bills: r.bills });
    }
    // Last bill for outlets with none in the last 4 weeks (one grouped read, only those outlets).
    const quiet = ids.filter((id) => !(days.get(id) || []).some((d) => d.bills > 0) && !billsToday.get(id));
    const lastOld = new Map();
    if (quiet.length) {
        for (const r of await Order.findAll({ where: { hotel_id: quiet, payment: "success", deleted: false }, attributes: ["hotel_id", [sequelize.fn("MAX", sequelize.col("business_date")), "last"]], group: ["hotel_id"], raw: true })) {
            if (r.last) lastOld.set(r.hotel_id, String(r.last).slice(0, 10));
        }
    }
    const regs = new Map((await LocalServerRegistration.findAll({ where: { hotel_id: ids, status: "active" }, raw: true })).map((r) => [r.hotel_id, r]));
    const backlog = new Map(((await tolerant("SELECT hotel_id, pending_orders, last_push_at FROM local_server_registrations WHERE status = 'active'")) || []).map((r) => [r.hotel_id, r]));
    const releases = (await ExeRelease.findAll({ where: { active: true }, attributes: ["version"], raw: true })).map((r) => r.version);
    const latest = releases.reduce((a, v) => (!a || cmpVersion(v, a) > 0 ? v : a), null);
    const devices = new Map((await AppDevice.findAll({ where: { hotel_id: ids, status: "active" }, attributes: ["hotel_id", [sequelize.fn("COUNT", sequelize.col("id")), "n"]], group: ["hotel_id"], raw: true })).map((r) => [r.hotel_id, Number(r.n) || 0]));
    const tickets = new Map((await RaiseTicket.findAll({ where: { hotel_id: ids, status: ["new", "open"] }, attributes: ["hotel_id", [sequelize.fn("COUNT", sequelize.col("id")), "n"], [sequelize.fn("MIN", sequelize.col("createdAt")), "oldest"]], group: ["hotel_id"], raw: true })).map((r) => [r.hotel_id, { open: Number(r.n) || 0, oldestAt: r.oldest }]));
    const credits = new Map(((await tolerant(`SELECT hotel_id, MAX(credit) AS credit FROM \`${table(EBillCredit)}\` WHERE hotel_id IN (:ids) GROUP BY hotel_id`, { ids })) || []).map((r) => [r.hotel_id, Number(r.credit) || 0]));
    const used = new Map(((await tolerant(`SELECT hotel_id, COUNT(*) AS n FROM \`${table(EBillCreditDebit)}\` WHERE debit = 1 AND hotel_id IN (:ids) AND createdAt >= :since GROUP BY hotel_id`, { ids, since: moment(now).subtract(30, "days").toDate() })) || []).map((r) => [r.hotel_id, Number(r.n) || 0]));
    const late = await CsOnboardingItem.findAll({ where: { hotel_id: ids, done_at: null, due_at: { [Op.lt]: now } }, attributes: ["hotel_id", "title", "due_at"], order: [["due_at", "ASC"]], raw: true });

    const data = new Map();
    for (const l of links) {
        const h = hotels.get(l.hotel_id);
        if (!h) continue;
        const hist = (days.get(h.id) || []).sort((a, b) => (a.day < b.day ? -1 : 1));
        const firstDay = hist.find((d) => d.bills > 0)?.day || null;
        const historyDays = firstDay ? daysBetween(firstDay, today) : 0;
        const total = firstDay ? hist.filter((d) => d.day >= firstDay).reduce((n, d) => n + d.bills, 0) : 0;
        const tday = billsToday.get(h.id);
        const lastDay = tday && tday.n ? today : [...hist].reverse().find((d) => d.bills > 0)?.day || lastOld.get(h.id) || null;
        const reg = regs.get(h.id);
        const bl = backlog.get(h.id);
        data.set(h.id, {
            hotel: h,
            link: l,
            billsToday: tday ? tday.n : 0,
            salesToday: tday ? Math.round(tday.sales) : 0,
            billsYesterday: hist.find((d) => d.day === yesterday)?.bills || 0,
            normal: historyDays ? Math.round((total / historyDays) * 10) / 10 : null,
            historyDays,
            lastBillDay: lastDay,
            daysSinceBill: lastDay ? daysBetween(lastDay, today) : null,
            reg: reg || null,
            backlog: bl && bl.pending_orders ? { pending: Number(bl.pending_orders) || 0, since: bl.last_push_at || null } : null,
            latest,
            behind: reg && reg.app_version && latest ? releases.filter((v) => cmpVersion(v, reg.app_version) > 0).length : null,
            devices: devices.get(h.id) || 0,
            tickets: tickets.get(h.id) || { open: 0, oldestAt: null },
            ebill: credits.has(h.id) ? { credits: credits.get(h.id), used30: used.get(h.id) || 0 } : null,
            late: late.filter((x) => x.hotel_id === h.id),
        });
    }
    return { links, data };
}

/* ------------------------------ rules ------------------------------ */

const hours = (ms) => Math.floor(ms / 3600000);
const ago = (ms) => (ms >= 48 * 3600000 ? `${Math.floor(ms / 86400000)} days` : `${hours(ms)} h`);

/** -> { level, reasons: [{ key, level, text }] } for one outlet. */
function judge(d, cfg, now = new Date()) {
    const h = cfg.health;
    const reasons = [];
    const add = (key, level, text) => reasons.push({ key, level, text });
    const hotel = d.hotel;
    if (hotel.active === false || hotel.active === 0) return { level: "grey", reasons: [{ key: "off", level: "grey", text: "Outlet switched off" }] };
    const inOnboarding = d.link.onboarding === "active";
    const madeAt = new Date(hotel.hotel_reg_date || hotel.createdAt).getTime();
    const ageDays = Math.floor((now.getTime() - madeAt) / 86400000);

    // Billing activity: days without bills, or far below its own normal.
    if (!inOnboarding) {
        if (!d.lastBillDay) {
            if (ageDays > 7) add("billing", "red", "No bill made yet");
        } else if (d.daysSinceBill >= h.noBillsDays) {
            add("billing", "red", `No bills for ${d.daysSinceBill} days`);
        } else if (d.daysSinceBill === h.noBillsDays - 1 && d.daysSinceBill > 0) {
            add("billing", "amber", `No bills for ${d.daysSinceBill} day${d.daysSinceBill === 1 ? "" : "s"}`);
        } else if (d.normal !== null && d.normal >= h.minNormalBills && d.historyDays >= 7 && d.billsYesterday > 0) {
            const pct = (d.billsYesterday / d.normal) * 100;
            if (pct < h.lowBillsPct) add("billing", "red", `${d.billsYesterday} bills yesterday, normal ${Math.round(d.normal)}`);
            else if (pct < h.dipBillsPct) add("billing", "amber", `${d.billsYesterday} bills yesterday, normal ${Math.round(d.normal)}`);
        }
    }

    if (hotel.product_plan === "CLOUD_APP") {
        if (!inOnboarding && !d.devices) add("devices", "amber", "No POS App phone logged in");
    } else if (!d.reg) {
        if (!inOnboarding) add("pc", "amber", "No outlet PC registered");
    } else {
        const off = d.reg.last_seen_at ? now.getTime() - new Date(d.reg.last_seen_at).getTime() : Infinity;
        if (off >= h.pcOfflineHours * 3600000) add("pc", "red", d.reg.last_seen_at ? `Outlet PC offline ${ago(off)}` : "Outlet PC never connected");
        else if (off >= h.pcAmberHours * 3600000) add("pc", "amber", `Outlet PC offline ${ago(off)}`);
        if (/fail/i.test(d.reg.update_status || "")) add("version", "red", `Update failed: ${String(d.reg.update_status).slice(0, 80)}`);
        else if (d.behind >= h.versionsBehind) add("version", "red", `Exe ${d.reg.app_version}, ${d.behind} versions behind`);
        else if (d.behind >= 1) add("version", "amber", `Exe ${d.reg.app_version}, ${d.latest} is out`);
        // A backlog only means something while the PC still talks to us.
        if (d.backlog && d.backlog.pending > 0 && d.backlog.since && off < 3600000) {
            const age = now.getTime() - new Date(d.backlog.since).getTime();
            if (age >= h.backlogHours * 3600000) add("backlog", "red", `${d.backlog.pending} bills waiting to upload for ${ago(age)}`);
            else if (age >= 3600000) add("backlog", "amber", `${d.backlog.pending} bills waiting to upload for ${ago(age)}`);
        }
    }

    if (d.tickets.open && d.tickets.oldestAt && now.getTime() - new Date(d.tickets.oldestAt).getTime() >= h.ticketDays * 86400000) {
        add("tickets", "amber", `${d.tickets.open} open ticket${d.tickets.open === 1 ? "" : "s"}, oldest ${Math.floor((now.getTime() - new Date(d.tickets.oldestAt).getTime()) / 86400000)} days`);
    }

    if (hotel.plan_end_date) {
        const left = new Date(hotel.plan_end_date).getTime() - now.getTime();
        const date = moment(hotel.plan_end_date).tz(TZ).format("D MMM YYYY");
        if (left < 0) add("plan", "red", `Plan ended on ${date}`);
        else if (left < h.planWarnDays * 86400000) add("plan", "amber", `Plan ends on ${date}`);
    }

    if (d.ebill && d.ebill.used30 > 0) {
        if (d.ebill.credits <= 0) add("ebill", "red", "E-bill credits finished");
        else if (d.ebill.credits < h.ebillLow) add("ebill", "amber", `${Math.floor(d.ebill.credits)} e-bill credits left`);
    }

    const lateSteps = d.late.filter((x) => now.getTime() - new Date(x.due_at).getTime() >= h.onboardingLateDays * 86400000);
    if (lateSteps.length) {
        const first = lateSteps[0];
        const by = Math.max(1, Math.floor((now.getTime() - new Date(first.due_at).getTime()) / 86400000));
        add("onboarding", "amber", `Onboarding: ${first.title} ${by} day${by === 1 ? "" : "s"} late${lateSteps.length > 1 ? ` (+${lateSteps.length - 1} more)` : ""}`);
    }

    const level = reasons.reduce((lv, r) => worse(lv, r.level), "green");
    reasons.sort((a, b) => (a.level === b.level ? 0 : a.level === "red" ? -1 : b.level === "red" ? 1 : 0));
    return { level, reasons };
}

function signalsOf(d) {
    return {
        billsToday: d.billsToday,
        salesToday: d.salesToday,
        billsYesterday: d.billsYesterday,
        normal: d.normal,
        historyDays: d.historyDays,
        lastBillDay: d.lastBillDay,
        daysSinceBill: d.daysSinceBill,
        backlog: d.backlog,
        latest: d.latest,
        behind: d.behind,
        devices: d.devices,
        tickets: d.tickets,
        ebill: d.ebill,
    };
}

/* ------------------------------ the run ------------------------------ */

/**
 * Accounts for new outlets, onboarding auto-ticks, then every outlet's
 * health and its account's. `only` (tests) = these hotel ids.
 */
async function run({ only = null, now = new Date() } = {}) {
    const snap = await AdmSetting.findOne({ where: { setting_key: "cs_snapshot_day" }, raw: true });
    if (!snap || snap.value !== todayStr(now)) await snapshot({ now });
    await accounts.ensureAccounts({ only });
    await accounts.assignUnowned();
    await onboarding.autoCheck({ only });
    const cfg = await customerSettings();
    const wh = await workingHours();
    const { data } = await collect(now, only);
    const changed = new Set();
    let reds = 0;
    for (const d of data.values()) {
        const { level, reasons } = judge(d, cfg, now);
        const l = d.link;
        const was = l.health;
        const patch = { health: level, health_reasons: json(reasons), health_at: now, signals: json(signalsOf(d)) };
        if (was !== level) patch.health_since = now;
        await sequelize.transaction(async (t) => {
            await CsAccountOutlet.update(patch, { where: { id: l.id }, transaction: t });
            if (was === level) return;
            changed.add(l.account_id);
            const why = reasons.filter((r) => r.level === level).map((r) => r.text).join(" · ");
            const first = !l.health_at;
            // The first check of a healthy outlet is not news.
            if (!(first && (level === "green" || level === "grey"))) {
                await addActivity(l.account_id, l.hotel_id, "health", null, `${d.hotel.hotel_name}: ${first ? "" : `${was} -> `}${level}${why ? ` (${why})` : ""}`, { from: was, to: level }, t);
            }
            const day = todayStr(now);
            if (level === "red") {
                reds += 1;
                const acc = await CsAccount.findOne({ where: { id: l.account_id }, attributes: ["id", "name", "success_owner_id"], raw: true, transaction: t });
                const note = `${d.hotel.hotel_name}: ${why}`.slice(0, 300);
                // ref: one task per outlet per red spell (per day it started).
                const [task, made] = await CsTask.findOrCreate({
                    where: { ref: `health:${l.hotel_id}:${day}` },
                    defaults: { account_id: l.account_id, hotel_id: l.hotel_id, owner_id: acc ? acc.success_owner_id : null, type: "call", note, due_at: addWorkingMinutes(wh, now, 0), origin: "health" },
                    transaction: t,
                });
                if (made && acc && acc.success_owner_id) await notify(acc.success_owner_id, { type: "account.red", title: `${d.hotel.hotel_name} turned red`, body: why, link: `/accounts/${l.account_id}`, ref: `red:${l.hotel_id}:${day}` }, { transaction: t });
                if (!made && task.status !== "open") await task.update({ status: "open", done_at: null, done_by: null, result: "" }, { transaction: t });
            } else if (was === "red") {
                await CsTask.update({ status: "done", done_at: now, done_by: null, result: `Back to ${level} by itself` }, { where: { hotel_id: l.hotel_id, origin: "health", status: "open" }, transaction: t });
            }
        });
    }
    // Accounts: the worst of their outlets (switched-off outlets do not count).
    const accIds = only ? [...new Set([...data.values()].map((d) => d.link.account_id))] : null;
    const allLinks = await CsAccountOutlet.findAll({ where: accIds ? { account_id: accIds } : {}, attributes: ["account_id", "hotel_id", "health", "health_reasons"], raw: true });
    const byAcc = new Map();
    for (const l of allLinks) {
        if (!byAcc.has(l.account_id)) byAcc.set(l.account_id, []);
        byAcc.get(l.account_id).push(l);
    }
    const names = new Map([...data.values()].map((d) => [d.hotel.id, d.hotel.hotel_name]));
    const missing = allLinks.filter((l) => !names.has(l.hotel_id)).map((l) => l.hotel_id);
    if (missing.length) for (const h of await Hotel.findAll({ where: { id: missing }, attributes: ["id", "hotel_name"], raw: true })) names.set(h.id, h.hotel_name);
    for (const [accId, ls] of byAcc) {
        const level = ls.reduce((lv, l) => (l.health === "grey" ? lv : worse(lv, l.health)), "grey");
        const reasons = ls.flatMap((l) => (parse(l.health_reasons) || []).filter((r) => r.level === "red" || r.level === "amber").map((r) => ({ hotelId: l.hotel_id, outlet: names.get(l.hotel_id) || `#${l.hotel_id}`, level: r.level, text: r.text })));
        reasons.sort((a, b) => (a.level === b.level ? 0 : a.level === "red" ? -1 : 1));
        await CsAccount.update({ health: level, health_reasons: json(reasons.slice(0, 20)), health_at: now }, { where: { id: accId } });
    }
    return `outlets ${data.size}, changed accounts ${changed.size}, new red ${reds}`;
}

/** Yesterday's row keeps the colour the outlet ended the day with (for trends); runs once after midnight. */
async function stampDay(now = new Date()) {
    const yesterday = moment.tz(todayStr(now), TZ).subtract(1, "day").format("YYYY-MM-DD");
    const links = await CsAccountOutlet.findAll({ attributes: ["hotel_id", "health", "health_reasons"], raw: true });
    for (const l of links) {
        const [row] = await CsOutletDay.findOrCreate({ where: { hotel_id: l.hotel_id, day: yesterday }, defaults: { bills: 0, sales: 0 } });
        if (!row.health) await row.update({ health: l.health, reasons: l.health_reasons });
    }
}

worker.registerJob("cs.health", async () => {
    const snap = await AdmSetting.findOne({ where: { setting_key: "cs_snapshot_day" }, raw: true });
    const newDay = !snap || snap.value !== todayStr();
    if (newDay && snap) await stampDay();
    return run();
});
worker.registerSchedule("cs.health", 900);

module.exports = { snapshot, collect, judge, run, stampDay };
