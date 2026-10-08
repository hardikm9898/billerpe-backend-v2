const { Op } = require("sequelize");
const { sequelize, RaiseTicket, SupTicket, SupTicketMessage } = require("../../model");
const { RuleError } = require("../../appv1/core");
const { notify } = require("../crm/notify");
const { txt, parse } = require("../crm/util");
const C = require("./common");
const tickets = require("./tickets");

// An outlet's own tickets, as its apps show them (owner 2026-10-08: support's
// replies reach the customer on WhatsApp AND in the apps' ticket lists).
// Used by the Web POS (through the outlet PC: /sync/support/*), the POS App
// (appv1) and the Owner App / Owner Dashboard (ownerv1). Internal notes and
// who in BillerPe answered stay out.

const LABEL = { new: "Sent to BillerPe", open: "BillerPe is on it", waiting: "Waiting for your reply", closed: "Closed" };

/** A ticket from an outlet app. channel: webpos | pos_app | owner_app. */
async function raise(hotelId, input = {}, channel) {
    const sup = await tickets.open({
        hotelId,
        subject: input.subject,
        details: input.details,
        category: input.category,
        priority: input.priority,
        channel,
        raisedBy: input.raisedBy,
        contactName: input.contactName,
        contactMobile: input.contactMobile,
        via: channel,
        legacyType: input.legacyType,
    });
    return { id: sup.ticket_id, number: C.ticketNo(sup.ticket_id) };
}

function messageOut(m) {
    return { id: m.id, from: m.kind === "customer" ? "you" : "billerpe", body: m.body, at: m.at, via: m.via, files: parse(m.files) || [] };
}

/**
 * Newest first, 20 a page, each with its conversation. The old fields
 * (issue, ticket_type, priority, status, createdAt) stay for apps that
 * only know those.
 */
async function list(hotelId, page = 1) {
    const p = Math.max(1, Number(page) || 1);
    const limit = 20;
    const { rows, count } = await RaiseTicket.findAndCountAll({
        where: { hotel_id: hotelId },
        attributes: ["id", "issue", "ticket_type", "priority", "status", "createdAt", "updatedAt"],
        order: [["createdAt", "DESC"], ["id", "DESC"]],
        limit,
        offset: (p - 1) * limit,
        raw: true,
    });
    const ids = rows.map((r) => r.id);
    const sups = new Map((ids.length ? await SupTicket.findAll({ where: { ticket_id: ids }, raw: true }) : []).map((s) => [s.ticket_id, s]));
    const msgs = ids.length ? await SupTicketMessage.findAll({ where: { ticket_id: ids, kind: ["customer", "staff"] }, order: [["at", "ASC"], ["id", "ASC"]], raw: true }) : [];
    const byTicket = new Map();
    for (const m of msgs) {
        if (!byTicket.has(m.ticket_id)) byTicket.set(m.ticket_id, []);
        byTicket.get(m.ticket_id).push(messageOut(m));
    }
    return {
        tickets: rows.map((r) => {
            const s = sups.get(r.id);
            const parts = C.splitIssue(r.issue);
            const thread = byTicket.get(r.id) || [{ id: 0, from: "you", body: parts.details || parts.subject, at: r.createdAt, via: "old", files: [] }];
            const lastBillerpe = [...thread].reverse().find((m) => m.from === "billerpe");
            const state = s ? s.state : r.status === "close" ? "closed" : r.status === "open" ? "open" : "new";
            return {
                ...r,
                number: C.ticketNo(r.id),
                subject: s ? s.subject : parts.subject,
                category: s ? s.category : r.ticket_type,
                state,
                stateLabel: LABEL[state],
                closedAt: s ? s.closed_at : null,
                resolution: s ? s.resolution : "",
                rating: s ? s.rating : null,
                canReply: state !== "closed",
                messages: thread,
                replies: thread.filter((m) => m.from === "billerpe").length,
                lastReplyAt: lastBillerpe ? lastBillerpe.at : null,
            };
        }),
        page: p,
        totalRecords: count,
    };
}

/** The customer answers from the app: added to the ticket (ends "waiting"). */
async function reply(hotelId, ticketId, text, { by = "", channel = "webpos" } = {}) {
    const body = String(text ?? "").trim().slice(0, 4000);
    if (!body) throw new RuleError("Type your reply first.");
    const now = new Date();
    const sup = await sequelize.transaction(async (t) => {
        const sup = await SupTicket.findOne({ where: { ticket_id: Number(ticketId) || 0, hotel_id: hotelId }, transaction: t, lock: t.LOCK.UPDATE });
        if (!sup) throw new RuleError("Ticket not found.");
        if (sup.state === "closed") throw new RuleError("This ticket is closed. Raise a new ticket if the problem is back.");
        await tickets.addMessage(sup.ticket_id, { kind: "customer", author_name: txt(by, 120) || "Outlet", via: channel, body, at: now }, t);
        if (sup.state === "waiting") await tickets.resume(sup, now, t);
        await sup.update({ last_customer_at: now }, { transaction: t });
        await tickets.syncLegacy(sup, t);
        return sup;
    });
    if (sup.assignee_id) await notify(sup.assignee_id, { type: "ticket.reply", title: `Customer replied on ${C.ticketNo(sup.ticket_id)}`, body: txt(body, 160), link: `/support/${sup.ticket_id}`, ref: `ticket-app:${sup.ticket_id}:${now.getTime()}` });
    return { ok: true };
}

/** Open tickets an outlet has (badges). */
async function openCount(hotelId) {
    return SupTicket.count({ where: { hotel_id: hotelId, state: { [Op.ne]: "closed" } } });
}

module.exports = { raise, list, reply, openCount, LABEL };
