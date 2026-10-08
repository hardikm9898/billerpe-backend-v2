const { Op } = require("sequelize");
const { sequelize, RaiseTicket, SupTicket, SupTicketMessage, Hotel, CsAccountOutlet } = require("../../model");
const worker = require("../../services/admin/worker");
const { notify } = require("../crm/notify");
const { names, mobile10 } = require("../cs/common");
const { moment, TZ, txt } = require("../crm/util");
const C = require("./common");
const tickets = require("./tickets");

// The support queue's clock (job sup.timers, every minute):
// 1. a ticket made by older code (no sup_tickets row yet) joins the queue;
// 2. a first reply or a fix that is late tells the owner and the support leads, once;
// 3. a ticket waiting on the customer for waitingCloseDays closes itself.

const LEGACY_POS_APP = ["support", "plan-change", "renewal"];

async function adopt(now = new Date()) {
    const rows = await sequelize.query(
        "SELECT r.* FROM hms_raise_ticket_msts r LEFT JOIN sup_tickets s ON s.ticket_id = r.id WHERE s.id IS NULL ORDER BY r.id ASC LIMIT 200",
        { type: sequelize.QueryTypes.SELECT },
    );
    let n = 0;
    const cfg = await C.supportSettings();
    for (const r of rows) {
        const { subject, details, raisedBy } = C.splitIssue(r.issue);
        const hotel = r.hotel_id ? await Hotel.findOne({ where: { id: r.hotel_id }, attributes: ["id", "hotel_name", "owner_number", "owner_name"], raw: true }) : null;
        const link = hotel ? await CsAccountOutlet.findOne({ where: { hotel_id: hotel.id }, raw: true }) : null;
        const state = r.status === "close" ? "closed" : r.status === "open" ? "open" : "new";
        const opened = r.createdAt ? new Date(r.createdAt) : now;
        const assignee = state === "closed" ? null : await C.pickAssignee(now);
        const channel = LEGACY_POS_APP.includes(r.ticket_type) ? "pos_app" : raisedBy ? "webpos" : "old_app";
        try {
            await sequelize.transaction(async (t) => {
                const sup = SupTicket.build({
                    ticket_id: r.id, hotel_id: hotel ? hotel.id : null, account_id: link ? link.account_id : null, subject, category: txt(r.ticket_type, 40) || "Other",
                    priority: C.PRIORITIES.includes(r.priority) ? r.priority : "medium", channel, state, assignee_id: assignee ? assignee.id : null, assigned_at: assignee ? now : null,
                    raised_by: txt(raisedBy, 160), contact_name: hotel ? txt(hotel.owner_name, 120) : "", contact_mobile: C.mobileIn(raisedBy) || (hotel ? mobile10(hotel.owner_number) : ""),
                    opened_at: opened, last_customer_at: opened, closed_at: state === "closed" ? r.updatedAt || now : null, resolution: state === "closed" ? "Closed before the new support queue" : "",
                });
                Object.assign(sup, await C.dueTimes(sup, cfg));
                await sup.save({ transaction: t });
                await tickets.addMessage(r.id, { kind: "customer", author_name: txt(raisedBy, 120) || (hotel ? hotel.hotel_name : "Customer"), via: "old", body: details || subject, at: opened }, t);
                let comments = r.comment;
                if (typeof comments === "string") {
                    try {
                        comments = JSON.parse(comments);
                    } catch {
                        comments = [];
                    }
                }
                for (const c of Array.isArray(comments) ? comments : []) {
                    if (!c || !c.message) continue;
                    await tickets.addMessage(r.id, { kind: "note", author_name: txt(c.name, 120) || "BillerPe", via: "old", body: String(c.message), at: c.date ? new Date(c.date) : opened }, t);
                }
                if (assignee) await tickets.addMessage(r.id, { kind: "system", body: `Joined the support queue · given to ${assignee.name || "a support person"}`, at: now }, t);
            });
            n += 1;
        } catch (e) {
            if (e.name !== "SequelizeUniqueConstraintError") throw e;
        }
    }
    return n;
}

async function lateOnes(now = new Date()) {
    const leads = await tickets.leads();
    const tell = async (sup, what) => {
        const title = `${C.ticketNo(sup.ticket_id)}: ${what}`;
        const people = [sup.assignee_id, ...leads.map((p) => p.id)].filter(Boolean);
        for (const id of [...new Set(people)]) await notify(id, { type: "ticket.late", title, body: sup.subject, link: `/support/${sup.ticket_id}`, ref: `ticket-late:${sup.ticket_id}:${what}:${id}:${sup.reopened}` });
    };
    let n = 0;
    const replies = await SupTicket.findAll({ where: { state: { [Op.ne]: "closed" }, first_reply_at: null, first_reply_due: { [Op.lt]: now }, late_reply_at: null }, limit: 200 });
    for (const sup of replies) {
        await sup.update({ late_reply_at: now });
        await tickets.addMessage(sup.ticket_id, { kind: "system", body: "The first reply is late", at: now });
        await tell(sup, "first reply late");
        n += 1;
    }
    const fixes = await SupTicket.findAll({ where: { state: ["new", "open"], resolve_due: { [Op.lt]: now }, late_fix_at: null }, limit: 200 });
    for (const sup of fixes) {
        await sup.update({ late_fix_at: now });
        await tickets.addMessage(sup.ticket_id, { kind: "system", body: "The fix is late", at: now });
        await tell(sup, "fix late");
        n += 1;
    }
    return n;
}

async function closeWaiting(now = new Date()) {
    const cfg = await C.supportSettings();
    const before = moment(now).tz(TZ).subtract(cfg.waitingCloseDays, "days").toDate();
    const rows = await SupTicket.findAll({ where: { state: "waiting", waiting_since: { [Op.lt]: before } }, limit: 100 });
    for (const sup of rows) {
        await tickets.closeTicket(sup.ticket_id, { resolution: `No reply from the customer for ${cfg.waitingCloseDays} day${cfg.waitingCloseDays === 1 ? "" : "s"}: closed by itself`, now });
    }
    return rows.length;
}

async function run(now = new Date()) {
    const adopted = await adopt(now);
    const late = await lateOnes(now);
    const closed = await closeWaiting(now);
    return `adopted ${adopted}, late ${late}, closed ${closed}`;
}

worker.registerJob("sup.timers", () => run());
worker.registerSchedule("sup.timers", 60);

module.exports = { adopt, lateOnes, closeWaiting, run };
