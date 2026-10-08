const { Op } = require("sequelize");
const { sequelize, RaiseTicket, SupTicket, SupTicketMessage, Hotel, CsAccount, CsAccountOutlet, LocalServerRegistration, CrmWaChat, CrmWaTemplate } = require("../../model");
const { RuleError } = require("../../appv1/core");
const queue = require("../../services/admin/queue");
const audit = require("../audit");
const { need } = require("../auth");
const { notify, peopleWith } = require("../crm/notify");
const { txt, parse } = require("../crm/util");
const { names, mobile10 } = require("../cs/common");
const { outletRow } = require("../cs/view");
const C = require("./common");

// Support tickets (phase 7, owner 2026-10-08). Tickets come from the POS
// (Web POS through the outlet PC, POS App, Owner App) and from staff (phone,
// email, WhatsApp). Each gets timers by priority, an owner by round-robin
// among support staff, an internal/public conversation, and a 1-tap rating
// on WhatsApp after closing. Replies reach the customer on WhatsApp and in
// the apps' ticket lists (sup/outlet.js).

const NOT_FOUND = "Ticket not found.";

/* ------------------------------ loading ------------------------------ */

async function getSup(ticketId, t, lock = false) {
    const sup = await SupTicket.findOne({ where: { ticket_id: Number(ticketId) || 0 }, transaction: t, ...(lock && t ? { lock: t.LOCK.UPDATE } : {}) });
    if (!sup) throw new RuleError(NOT_FOUND);
    return sup;
}

async function addMessage(ticketId, fields, t) {
    return SupTicketMessage.create({ ticket_id: ticketId, at: fields.at || new Date(), author_name: "", via: "panel", ...fields, body: String(fields.body || "").slice(0, 8000) }, { transaction: t });
}

/** Keeps the old table's status in step (older screens, the outlet health check). */
async function syncLegacy(sup, t) {
    await RaiseTicket.update({ status: C.legacyStatus(sup.state), priority: sup.priority }, { where: { id: sup.ticket_id }, transaction: t });
}

/* ------------------------------ opening ------------------------------ */

/**
 * A new ticket from anywhere. input: hotelId, subject, details, category,
 * priority, channel, raisedBy, contactName, contactMobile, createdBy (staff
 * id), assigneeId (staff choice), waChatId, files, via (first message),
 * legacyType (the old ticket_type the POS App reads: plan-change | renewal).
 */
async function open(input, now = new Date()) {
    const cfg = await C.supportSettings();
    const subject = txt(input.subject, 160);
    const details = String(input.details ?? "").trim().slice(0, 4000);
    if (!subject) throw new RuleError("Write what the problem is (subject).");
    if (!details) throw new RuleError("Describe what happened.");
    const channel = C.CHANNELS[input.channel] ? input.channel : "staff";
    const priority = C.PRIORITIES.includes(input.priority) ? input.priority : "medium";
    const category = cfg.categories.includes(input.category) ? input.category : txt(input.category, 40) || "Other";
    const hotelId = Number(input.hotelId) || null;
    const hotel = hotelId ? await Hotel.findOne({ where: { id: hotelId }, attributes: ["id", "hotel_name", "owner_number", "owner_name"], raw: true }) : null;
    if (hotelId && !hotel) throw new RuleError("Outlet not found.");
    const link = hotel ? await CsAccountOutlet.findOne({ where: { hotel_id: hotel.id }, raw: true }) : null;
    const contactMobile = mobile10(input.contactMobile) || C.mobileIn(input.raisedBy) || (hotel ? mobile10(hotel.owner_number) : "");
    const assignee = input.assigneeId ? { id: Number(input.assigneeId), reason: "Chosen when the ticket was made" } : await C.pickAssignee(now);

    const sup = await sequelize.transaction(async (t) => {
        const raise = await RaiseTicket.create({ issue: `${subject}\n\n${details}${input.raisedBy ? `\n\nRaised by: ${txt(input.raisedBy, 160)}` : ""}`, ticket_type: txt(input.legacyType, 40) || category, priority, hotel_id: hotel ? hotel.id : null, status: "new" }, { transaction: t });
        const row = SupTicket.build({
            ticket_id: raise.id, hotel_id: hotel ? hotel.id : null, account_id: link ? link.account_id : null, subject, category, priority, channel, state: "new",
            assignee_id: assignee ? assignee.id : null, assigned_at: assignee ? now : null, raised_by: txt(input.raisedBy, 160), contact_name: txt(input.contactName, 120) || (hotel ? txt(hotel.owner_name, 120) : ""),
            contact_mobile: contactMobile, wa_chat_id: input.waChatId || null, created_by: input.createdBy || null, opened_at: now, last_customer_at: now,
        });
        Object.assign(row, await C.dueTimes(row, cfg));
        await row.save({ transaction: t });
        const files = Array.isArray(input.files) && input.files.length ? JSON.stringify(input.files.slice(0, 5)) : null;
        await addMessage(raise.id, { kind: "customer", author_name: txt(input.contactName || input.raisedBy, 120) || (hotel ? hotel.hotel_name : "Customer"), via: input.via || channel, body: details, files, at: now }, t);
        if (assignee) await addMessage(raise.id, { kind: "system", body: `Given to ${assignee.name || "a support person"} · ${assignee.reason}`, at: now }, t);
        await queue.emit({ type: "ticket.opened", entity: "sup_ticket", entityId: raise.id, data: { hotelId: hotel ? hotel.id : null, channel, priority }, actorId: input.createdBy || null }, { transaction: t });
        return row;
    });
    await tellNew(sup, hotel);
    return sup;
}

/** The owner (or, unassigned, the support leads) and the outlet's success owner hear about a new ticket. */
async function tellNew(sup, hotel) {
    const where = hotel ? hotel.hotel_name : sup.contact_name || "No outlet";
    const msg = { type: "ticket.new", title: `${C.ticketNo(sup.ticket_id)} ${sup.subject}`, body: `${where} · ${sup.priority} priority`, link: `/support/${sup.ticket_id}` };
    if (sup.assignee_id && sup.assignee_id !== sup.created_by) await notify(sup.assignee_id, { ...msg, title: `New ticket for you: ${C.ticketNo(sup.ticket_id)}`, body: `${sup.subject} · ${where}`, ref: `ticket-new:${sup.ticket_id}:${sup.assignee_id}` });
    if (!sup.assignee_id) for (const p of await leads()) await notify(p.id, { ...msg, title: `Nobody could take ${C.ticketNo(sup.ticket_id)}`, ref: `ticket-unassigned:${sup.ticket_id}:${p.id}` });
    if (sup.account_id) {
        const acc = await CsAccount.findByPk(sup.account_id, { attributes: ["success_owner_id"], raw: true });
        if (acc && acc.success_owner_id && acc.success_owner_id !== sup.assignee_id && acc.success_owner_id !== sup.created_by) {
            await notify(acc.success_owner_id, { ...msg, title: `Your customer raised ${C.ticketNo(sup.ticket_id)}`, body: `${sup.subject} · ${where}`, ref: `ticket-cs:${sup.ticket_id}` });
        }
    }
}

/** Support leads: people who can assign tickets (told about late and unassigned ones). */
async function leads() {
    return peopleWith("support.manage");
}

/* ------------------------------ the queue ------------------------------ */

const VIEWS = ["open", "mine", "late", "waiting", "unassigned", "closed", "all"];

function viewWhere(s, view, now) {
    switch (view) {
        case "open":
            return { state: ["new", "open"] };
        case "mine":
            return { assignee_id: s.user.id, state: { [Op.ne]: "closed" } };
        case "late":
            return { state: { [Op.ne]: "closed" }, [Op.or]: [{ first_reply_at: null, first_reply_due: { [Op.lt]: now } }, { state: { [Op.ne]: "waiting" }, resolve_due: { [Op.lt]: now } }] };
        case "waiting":
            return { state: "waiting" };
        case "unassigned":
            return { assignee_id: null, state: { [Op.ne]: "closed" } };
        case "closed":
            return { state: "closed" };
        default:
            return {};
    }
}

function timerOf(r, now = Date.now()) {
    if (r.state === "closed") return { kind: "closed", at: r.closed_at, late: false };
    if (!r.first_reply_at) return { kind: "reply", at: r.first_reply_due, late: !!r.first_reply_due && new Date(r.first_reply_due).getTime() < now };
    if (r.state === "waiting") return { kind: "waiting", at: r.waiting_since, late: false };
    return { kind: "fix", at: r.resolve_due, late: !!r.resolve_due && new Date(r.resolve_due).getTime() < now };
}

function rowOf(r, hotels, who, last) {
    const h = r.hotel_id ? hotels.get(r.hotel_id) : null;
    return {
        id: r.ticket_id,
        number: C.ticketNo(r.ticket_id),
        subject: r.subject,
        category: r.category,
        priority: r.priority,
        state: r.state,
        channel: r.channel,
        channelLabel: C.CHANNELS[r.channel] || r.channel,
        outlet: h ? { id: h.id, name: h.hotel_name, city: h.address2 || "" } : null,
        contact: r.contact_name || "",
        assignee: r.assignee_id ? { id: r.assignee_id, name: who.get(r.assignee_id) || "A former staff member" } : null,
        openedAt: r.opened_at,
        timer: timerOf(r),
        // The customer wrote after support's last reply (a new ticket is just "New"):
        // by message order, as times are kept to the second.
        needsReply: r.state !== "closed" && !!r.last_staff_at && !!last && last.kind === "customer",
        rating: r.rating,
        last: last ? { kind: last.kind, body: txt(last.body, 140), at: last.at } : null,
    };
}

async function rowsOut(rows) {
    const hotels = new Map((await Hotel.findAll({ where: { id: [...new Set(rows.map((r) => r.hotel_id).filter(Boolean))] }, attributes: ["id", "hotel_name", "address2"], raw: true })).map((h) => [h.id, h]));
    const who = await names(rows.map((r) => r.assignee_id));
    const ids = rows.map((r) => r.ticket_id);
    const lastIds = ids.length ? await SupTicketMessage.findAll({ where: { ticket_id: ids, kind: ["customer", "staff"] }, attributes: ["ticket_id", [sequelize.fn("MAX", sequelize.col("id")), "id"]], group: ["ticket_id"], raw: true }) : [];
    const lasts = lastIds.length ? new Map((await SupTicketMessage.findAll({ where: { id: lastIds.map((x) => x.id) }, raw: true })).map((m) => [m.ticket_id, m])) : new Map();
    return rows.map((r) => rowOf(r, hotels, who, lasts.get(r.ticket_id)));
}

async function list(s, query = {}) {
    need(s, "support.use");
    const now = new Date();
    const view = VIEWS.includes(query.view) ? query.view : "open";
    const where = { ...viewWhere(s, view, now) };
    const and = [];
    if (query.priority && C.PRIORITIES.includes(query.priority)) where.priority = query.priority;
    if (query.category) where.category = txt(query.category, 40);
    if (query.assigneeId === "none") where.assignee_id = null;
    else if (query.assigneeId) where.assignee_id = Number(query.assigneeId) || 0;
    if (query.hotelId) where.hotel_id = Number(query.hotelId) || 0;
    if (query.accountId) where.account_id = Number(query.accountId) || 0;
    const q = txt(query.q, 60);
    if (/^t-?\d+$/i.test(q)) where.ticket_id = Number(q.replace(/^t-?/i, ""));
    else if (q) {
        const num = q.replace(/^t-?/i, "");
        const hotelIds = (await Hotel.findAll({ where: { hotel_name: { [Op.like]: `%${q}%` } }, attributes: ["id"], limit: 50, raw: true })).map((h) => h.id);
        and.push({ [Op.or]: [{ subject: { [Op.like]: `%${q}%` } }, { contact_name: { [Op.like]: `%${q}%` } }, { contact_mobile: { [Op.like]: `%${q.replace(/\D/g, "") || q}%` } }, ...(/^\d+$/.test(num) ? [{ ticket_id: Number(num) }] : []), ...(hotelIds.length ? [{ hotel_id: hotelIds }] : [])] });
    }
    if (and.length) where[Op.and] = and;
    const limit = Math.min(100, Math.max(10, Number(query.limit) || 50));
    const page = Math.max(1, Number(query.page) || 1);
    const order = view === "closed" ? [["closed_at", "DESC"]] : view === "all" ? [["opened_at", "DESC"]] : [[sequelize.literal("first_reply_at IS NULL"), "DESC"], [sequelize.literal("CASE WHEN first_reply_at IS NULL THEN first_reply_due ELSE resolve_due END"), "ASC"]];
    const { rows, count } = await SupTicket.findAndCountAll({ where, order: [...order, ["id", "DESC"]], limit, offset: (page - 1) * limit, raw: true });
    const counts = {};
    for (const v of ["open", "mine", "late", "waiting", "unassigned"]) counts[v] = await SupTicket.count({ where: viewWhere(s, v, now) });
    const cfg = await C.supportSettings();
    return { serverTime: now.toISOString(), view, total: count, page, limit, counts, categories: cfg.categories, tickets: await rowsOut(rows) };
}

/** The nav badge: open tickets and mine. */
async function counts(s) {
    if (!s.can("support.use")) return { open: 0, mine: 0, late: 0 };
    const now = new Date();
    return {
        open: await SupTicket.count({ where: viewWhere(s, "open", now) }),
        mine: await SupTicket.count({ where: viewWhere(s, "mine", now) }),
        late: await SupTicket.count({ where: viewWhere(s, "late", now) }),
    };
}

/** An account's or outlet's tickets (account and outlet pages). */
async function forCustomer(s, { accountId, hotelId } = {}) {
    if (!s.can("support.use")) need(s, "customers.view");
    const where = accountId ? { account_id: Number(accountId) || 0 } : { hotel_id: Number(hotelId) || 0 };
    const rows = await SupTicket.findAll({ where, order: [["opened_at", "DESC"]], limit: 30, raw: true });
    return { tickets: await rowsOut(rows), open: rows.filter((r) => r.state !== "closed").length };
}

/* ------------------------------ one ticket ------------------------------ */

function messageOut(m, who) {
    return {
        id: m.id,
        kind: m.kind,
        author: m.author_id ? who.get(m.author_id) || m.author_name : m.author_name,
        via: m.via,
        body: m.body,
        files: parse(m.files) || [],
        at: m.at,
        whatsapp: m.wa_status ? { status: m.wa_status, note: m.wa_note || "" } : null,
    };
}

async function detail(s, ticketId) {
    if (!s.can("support.use")) need(s, "customers.view");
    const sup = await getSup(ticketId);
    const r = sup.get({ plain: true });
    const msgs = await SupTicketMessage.findAll({ where: { ticket_id: r.ticket_id }, order: [["at", "ASC"], ["id", "ASC"]], raw: true });
    const who = await names([r.assignee_id, r.created_by, r.closed_by, ...msgs.map((m) => m.author_id)]);
    let outlet = null;
    if (r.hotel_id) {
        const hotel = await Hotel.findOne({ where: { id: r.hotel_id }, attributes: ["id", "hotel_name", "address2", "active", "product_plan", "plan_end_date", "app_device_limit", "owner_name", "owner_number"], raw: true });
        if (hotel) {
            const link = await CsAccountOutlet.findOne({ where: { hotel_id: hotel.id }, raw: true });
            const acc = link ? await CsAccount.findByPk(link.account_id, { raw: true }) : null;
            const reg = await LocalServerRegistration.findOne({ where: { hotel_id: hotel.id, status: "active" }, raw: true });
            outlet = { ...outletRow(link, hotel, reg, Date.now(), acc), ownerName: hotel.owner_name || "", ownerMobile: mobile10(hotel.owner_number), successOwner: acc && acc.success_owner_id ? (await names([acc.success_owner_id])).get(acc.success_owner_id) || "" : "" };
        }
    }
    const chat = r.wa_chat_id ? await CrmWaChat.findByPk(r.wa_chat_id, { attributes: ["id", "last_in_at"], raw: true }) : null;
    const others = r.hotel_id ? await SupTicket.findAll({ where: { hotel_id: r.hotel_id, ticket_id: { [Op.ne]: r.ticket_id } }, order: [["opened_at", "DESC"]], limit: 5, raw: true }) : [];
    const cfg = await C.supportSettings();
    return {
        serverTime: new Date().toISOString(),
        ticket: {
            ...rowOf(r, new Map(outlet ? [[r.hotel_id, { id: r.hotel_id, hotel_name: outlet.name, address2: outlet.city }]] : []), who, null),
            raisedBy: r.raised_by,
            contactMobile: r.contact_mobile,
            createdBy: r.created_by ? who.get(r.created_by) || "" : "",
            firstReplyDue: r.first_reply_due,
            firstReplyAt: r.first_reply_at,
            resolveDue: r.resolve_due,
            pausedMinutes: r.paused_minutes,
            waitingSince: r.waiting_since,
            closedAt: r.closed_at,
            closedBy: r.closed_by ? who.get(r.closed_by) || "" : "",
            resolution: r.resolution,
            reopened: r.reopened,
            ratingAskedAt: r.rating_asked_at,
            ratedAt: r.rated_at,
            ratingLabel: r.rating ? C.RATING[r.rating] || String(r.rating) : null,
            whatsappWindow: chat ? !!chat.last_in_at && Date.now() - new Date(chat.last_in_at).getTime() < 24 * 3600000 : false,
            chatId: r.wa_chat_id,
        },
        messages: msgs.map((m) => messageOut(m, who)),
        outlet,
        others: (await rowsOut(others)).map((o) => ({ id: o.id, number: o.number, subject: o.subject, state: o.state, openedAt: o.openedAt })),
        categories: cfg.categories,
        can: { reply: s.can("support.use"), assignOthers: s.can("support.manage") },
    };
}

/* ------------------------------ replying ------------------------------ */

/**
 * A staff reply to the customer on WhatsApp: free text inside the 24-hour
 * window, else the ticket_update template (when it is set up). Either way
 * the customer also sees it in the app's ticket list.
 */
async function deliverReply(sup, text, userId) {
    const wa = require("../crm/wa");
    if (!sup.contact_mobile) return { wa_status: "not_sent", wa_note: "No mobile number on the ticket: the customer sees the reply in the app." };
    let chat;
    try {
        chat = sup.wa_chat_id ? await CrmWaChat.findByPk(sup.wa_chat_id) : null;
        if (!chat) chat = await wa.chatFor(sup.contact_mobile, { name: sup.contact_name });
    } catch (e) {
        return { wa_status: "not_sent", wa_note: txt(e.message, 200) };
    }
    if (sup.wa_chat_id !== chat.id) await SupTicket.update({ wa_chat_id: chat.id }, { where: { id: sup.id } });
    if (wa.windowOpen(chat)) {
        const m = await wa.sendText(chat, `BillerPe support · ${C.ticketNo(sup.ticket_id)}\n${text}`, { sender: "user", userId });
        return { wa_status: m.status === "failed" ? "failed" : m.status, wa_note: m.status === "failed" ? txt(m.error, 200) : null, wa_message_id: m.id };
    }
    const cfg = await C.supportSettings();
    const tpl = cfg.updateTemplate ? await CrmWaTemplate.findOne({ where: { name: cfg.updateTemplate, active: true } }) : null;
    if (!tpl) return { wa_status: "not_sent", wa_note: "WhatsApp: they have not written in 24 hours and the ticket update template is not set up. The customer sees it in the app." };
    const defs = parse(tpl.params) || [];
    const values = [C.ticketNo(sup.ticket_id), txt(text.replace(/\s+/g, " "), 180)].slice(0, defs.length);
    while (values.length < defs.length) values.push("-");
    try {
        const r = await wa.sendTemplate(chat, tpl, values, { sender: "user", userId });
        const m = r && r.message;
        return { wa_status: !m ? "not_sent" : m.status === "failed" ? "failed" : "template", wa_note: m && m.status === "failed" ? txt(m.error, 200) : null, wa_message_id: m ? m.id : null };
    } catch (e) {
        return { wa_status: "not_sent", wa_note: txt(e.message, 200) };
    }
}

/**
 * A reply to the customer. via: panel (sent on WhatsApp + app) | phone
 * (they were called: logged) | email (answered by email: logged). Any of
 * them is the first reply. wait: true = now waiting on the customer.
 */
async function reply(s, ticketId, input = {}) {
    need(s, "support.use");
    const body = String(input.text ?? "").trim().slice(0, 4000);
    if (!body) throw new RuleError("Type the reply first.");
    const via = ["panel", "phone", "email"].includes(input.via) ? input.via : "panel";
    const now = new Date();
    const { sup, msg } = await sequelize.transaction(async (t) => {
        const sup = await getSup(ticketId, t, true);
        if (sup.state === "closed") throw new RuleError("This ticket is closed. Reopen it first.");
        const msg = await addMessage(sup.ticket_id, { kind: "staff", author_id: s.user.id, author_name: s.user.name, via, body, at: now }, t);
        const patch = { last_staff_at: now, first_reply_at: sup.first_reply_at || now };
        if (!sup.assignee_id) Object.assign(patch, { assignee_id: s.user.id, assigned_at: now });
        if (input.wait) Object.assign(patch, { state: "waiting", waiting_since: sup.state === "waiting" ? sup.waiting_since : now });
        else if (sup.state === "new") patch.state = "open";
        await sup.update(patch, { transaction: t });
        await syncLegacy(sup, t);
        return { sup, msg };
    });
    if (via === "panel") {
        const d = await deliverReply(sup, body, s.user.id);
        await msg.update(d);
    }
    return detail(s, sup.ticket_id);
}

async function note(s, ticketId, text) {
    need(s, "support.use");
    const body = String(text ?? "").trim().slice(0, 4000);
    if (!body) throw new RuleError("Type the note first.");
    const sup = await getSup(ticketId);
    await addMessage(sup.ticket_id, { kind: "note", author_id: s.user.id, author_name: s.user.name, body });
    return detail(s, sup.ticket_id);
}

/** Waiting on the customer (the fix timer pauses) or back to open. */
async function setWaiting(s, ticketId, on) {
    need(s, "support.use");
    const now = new Date();
    await sequelize.transaction(async (t) => {
        const sup = await getSup(ticketId, t, true);
        if (sup.state === "closed") throw new RuleError("This ticket is closed.");
        if (on && sup.state !== "waiting") {
            await sup.update({ state: "waiting", waiting_since: now }, { transaction: t });
            await addMessage(sup.ticket_id, { kind: "system", body: `${s.user.name}: waiting on the customer (the fix timer is paused)`, at: now }, t);
        } else if (!on && sup.state === "waiting") {
            await resume(sup, now, t);
            await addMessage(sup.ticket_id, { kind: "system", body: `${s.user.name}: no longer waiting on the customer`, at: now }, t);
        }
        await syncLegacy(sup, t);
    });
    return detail(s, ticketId);
}

/** Out of waiting: the time it waited moves the fix timer on. */
async function resume(sup, now, t) {
    const paused = (sup.paused_minutes || 0) + (await C.pausedSince(sup.waiting_since, now));
    sup.paused_minutes = paused;
    const due = await C.dueTimes(sup);
    await sup.update({ state: sup.first_reply_at ? "open" : "new", waiting_since: null, paused_minutes: paused, resolve_due: due.resolve_due, late_fix_at: null }, { transaction: t });
}

async function assign(s, ticketId, toId) {
    need(s, "support.use");
    const to = toId ? Number(toId) : null;
    if (to !== s.user.id) need(s, "support.manage");
    if (to) {
        const ok = (await C.supportPeople()).some((p) => p.id === to) || (await peopleWith("support.use")).some((p) => p.id === to);
        if (!ok) throw new RuleError("That person cannot answer tickets.");
    }
    const now = new Date();
    const sup = await sequelize.transaction(async (t) => {
        const sup = await getSup(ticketId, t, true);
        if (sup.assignee_id === to) return sup;
        const who = await names([sup.assignee_id, to]);
        await sup.update({ assignee_id: to, assigned_at: to ? now : sup.assigned_at }, { transaction: t });
        await addMessage(sup.ticket_id, { kind: "system", body: to === s.user.id ? `${s.user.name} took the ticket` : to ? `${s.user.name} gave the ticket to ${who.get(to) || "someone"}` : `${s.user.name} left the ticket unassigned`, at: now }, t);
        if (to && to !== s.user.id) await notify(to, { type: "ticket.assigned", title: `${C.ticketNo(sup.ticket_id)} is yours now`, body: `${sup.subject} · from ${s.user.name}`, link: `/support/${sup.ticket_id}`, ref: `ticket-assign:${sup.ticket_id}:${to}:${now.getTime()}` }, { transaction: t });
        await audit.write(s, { action: "ticket.assign", entity: "sup_ticket", entityId: sup.ticket_id, summary: `Ticket ${C.ticketNo(sup.ticket_id)} → ${to ? who.get(to) || to : "nobody"}` }, { transaction: t });
        return sup;
    });
    return detail(s, sup.ticket_id);
}

/** Subject, category, priority (moves the timers), outlet. */
async function update(s, ticketId, input = {}) {
    need(s, "support.use");
    const cfg = await C.supportSettings();
    await sequelize.transaction(async (t) => {
        const sup = await getSup(ticketId, t, true);
        const patch = {};
        const said = [];
        if (input.subject !== undefined) {
            const v = txt(input.subject, 160);
            if (!v) throw new RuleError("The subject cannot be empty.");
            if (v !== sup.subject) (patch.subject = v), said.push("subject");
        }
        if (input.category !== undefined && input.category !== sup.category) {
            if (!cfg.categories.includes(input.category)) throw new RuleError("Choose one of the categories.");
            patch.category = input.category;
            said.push(`category: ${input.category}`);
        }
        if (input.priority !== undefined && input.priority !== sup.priority) {
            if (!C.PRIORITIES.includes(input.priority)) throw new RuleError("Choose high, medium or low.");
            patch.priority = input.priority;
            said.push(`priority: ${input.priority}`);
        }
        if (input.hotelId !== undefined && (Number(input.hotelId) || null) !== sup.hotel_id) {
            const h = input.hotelId ? await Hotel.findOne({ where: { id: Number(input.hotelId) || 0 }, attributes: ["id", "hotel_name", "owner_number"], raw: true, transaction: t }) : null;
            if (input.hotelId && !h) throw new RuleError("Outlet not found.");
            const link = h ? await CsAccountOutlet.findOne({ where: { hotel_id: h.id }, raw: true, transaction: t }) : null;
            Object.assign(patch, { hotel_id: h ? h.id : null, account_id: link ? link.account_id : null });
            if (!sup.contact_mobile && h) patch.contact_mobile = mobile10(h.owner_number);
            said.push(h ? `outlet: ${h.hotel_name}` : "no outlet");
        }
        if (!said.length) return;
        Object.assign(sup, patch);
        if (patch.priority) {
            const due = await C.dueTimes(sup, cfg);
            if (!sup.first_reply_at) Object.assign(patch, { first_reply_due: due.first_reply_due, late_reply_at: null });
            Object.assign(patch, { resolve_due: due.resolve_due, late_fix_at: null });
        }
        await sup.update(patch, { transaction: t });
        await RaiseTicket.update({ hotel_id: sup.hotel_id }, { where: { id: sup.ticket_id }, transaction: t });
        await syncLegacy(sup, t);
        await addMessage(sup.ticket_id, { kind: "system", body: `${s.user.name} changed ${said.join(", ")}` }, t);
    });
    return detail(s, ticketId);
}

/* ------------------------------ closing ------------------------------ */

async function close(s, ticketId, resolution) {
    need(s, "support.use");
    const why = txt(resolution, 500);
    if (why.length < 5) throw new RuleError("Write how it was solved (a few words).");
    const sup = await closeTicket(ticketId, { byId: s.user.id, byName: s.user.name, resolution: why });
    await askRating(sup, s.user.id);
    return detail(s, ticketId);
}

async function closeTicket(ticketId, { byId = null, byName = "", resolution = "", now = new Date() } = {}) {
    return sequelize.transaction(async (t) => {
        const sup = await getSup(ticketId, t, true);
        if (sup.state === "closed") throw new RuleError("This ticket is already closed.");
        const extra = sup.state === "waiting" ? { paused_minutes: (sup.paused_minutes || 0) + (await C.pausedSince(sup.waiting_since, now)), waiting_since: null } : {};
        await sup.update({ state: "closed", closed_at: now, closed_by: byId, resolution, ...extra }, { transaction: t });
        await syncLegacy(sup, t);
        await addMessage(sup.ticket_id, { kind: "staff", author_id: byId, author_name: byName || "BillerPe", via: "panel", body: `Closed: ${resolution}`, at: now }, t);
        await queue.emit({ type: "ticket.closed", entity: "sup_ticket", entityId: sup.ticket_id, data: { byId }, actorId: byId }, { transaction: t });
        return sup;
    });
}

/**
 * The 1-tap rating on WhatsApp after closing: buttons inside the 24-hour
 * window, else the rating template (when set up), else nothing.
 */
async function askRating(sup, userId = null) {
    const cfg = await C.supportSettings();
    if (!cfg.askRating || !sup.contact_mobile) return null;
    const wa = require("../crm/wa");
    let chat;
    try {
        chat = sup.wa_chat_id ? await CrmWaChat.findByPk(sup.wa_chat_id) : null;
        if (!chat) chat = await wa.chatFor(sup.contact_mobile, { name: sup.contact_name });
    } catch {
        return null;
    }
    let status = null;
    if (wa.windowOpen(chat)) {
        const text = `BillerPe support · ${C.ticketNo(sup.ticket_id)} is closed: ${txt(sup.resolution, 300)}\nHow did we do?`;
        const m = await wa.sendButtons(chat, text, [5, 3, 1].map((n) => ({ id: `rate:${sup.ticket_id}:${n}`, title: C.RATING[n] })), { sender: "user", userId });
        status = m.status;
    } else if (cfg.ratingTemplate) {
        const tpl = await CrmWaTemplate.findOne({ where: { name: cfg.ratingTemplate, active: true } });
        if (tpl) {
            const defs = parse(tpl.params) || [];
            const values = [C.ticketNo(sup.ticket_id), txt(sup.resolution.replace(/\s+/g, " "), 180)].slice(0, defs.length);
            while (values.length < defs.length) values.push("-");
            const r = await wa.sendTemplate(chat, tpl, values, { sender: "user", userId }).catch(() => null);
            status = r && r.message ? r.message.status : null;
        }
    }
    if (status && status !== "failed") await SupTicket.update({ rating_asked_at: new Date(), wa_chat_id: chat.id }, { where: { id: sup.id } });
    return status;
}

async function reopen(s, ticketId, reason) {
    need(s, "support.use");
    const why = txt(reason, 300);
    if (why.length < 3) throw new RuleError("Write why it is reopened.");
    await reopenTicket(ticketId, `${s.user.name} reopened it: ${why}`);
    return detail(s, ticketId);
}

/** Back to open with a fresh fix time from now. */
async function reopenTicket(ticketId, text, now = new Date(), t0 = null) {
    const run = async (t) => {
        const sup = await getSup(ticketId, t, true);
        if (sup.state !== "closed") return sup;
        const cfg = await C.supportSettings();
        const timers = cfg.timers[sup.priority] || cfg.timers.medium;
        const { workingHours, addWorkingMinutes } = require("../crm/util");
        await sup.update({ state: "open", closed_at: null, closed_by: null, reopened: sup.reopened + 1, resolve_due: addWorkingMinutes(await workingHours(), now, timers.fixMinutes), late_fix_at: null, rating_asked_at: null, rating: null, rated_at: null }, { transaction: t });
        await syncLegacy(sup, t);
        await addMessage(sup.ticket_id, { kind: "system", body: text, at: now }, t);
        if (sup.assignee_id) await notify(sup.assignee_id, { type: "ticket.reopened", title: `${C.ticketNo(sup.ticket_id)} reopened`, body: txt(text, 200), link: `/support/${sup.ticket_id}`, ref: `ticket-reopen:${sup.ticket_id}:${sup.reopened}` }, { transaction: t });
        return sup;
    };
    return t0 ? run(t0) : sequelize.transaction(run);
}

/* ------------------------------ staff-made tickets ------------------------------ */

/** A ticket staff write down (phone call, email, WhatsApp, or found themselves). */
async function create(s, input = {}) {
    need(s, "support.use");
    const channel = C.STAFF_CHANNELS.includes(input.channel) ? input.channel : "phone";
    if (input.assigneeId && input.assigneeId !== "me" && Number(input.assigneeId) !== s.user.id) need(s, "support.manage");
    const sup = await open({
        hotelId: input.hotelId, subject: input.subject, details: input.details, category: input.category, priority: input.priority, channel,
        contactName: input.contactName, contactMobile: input.contactMobile, raisedBy: input.contactName ? `${txt(input.contactName, 60)} (${C.CHANNELS[channel]})` : C.CHANNELS[channel],
        createdBy: s.user.id, assigneeId: input.assigneeId === "me" ? s.user.id : input.assigneeId || null, via: channel === "staff" ? "panel" : channel,
    });
    await audit.write(s, { action: "ticket.create", entity: "sup_ticket", entityId: sup.ticket_id, summary: `Ticket ${C.ticketNo(sup.ticket_id)}: ${sup.subject}` });
    return { id: sup.ticket_id };
}

/** "Make ticket" in the WhatsApp inbox: the chat's latest messages become the ticket. */
async function fromChat(s, chatId, input = {}) {
    need(s, "support.use");
    const { CrmWaMessage } = require("../../model");
    const chat = await CrmWaChat.findByPk(Number(chatId) || 0);
    if (!chat) throw new RuleError("Chat not found.");
    const recent = await CrmWaMessage.findAll({ where: { chat_id: chat.id, direction: "in" }, order: [["at", "DESC"], ["id", "DESC"]], limit: 5, raw: true });
    const details = txt(input.details, 4000) || recent.reverse().map((m) => m.body || `[${m.kind}]`).join("\n") || "(from WhatsApp)";
    const sup = await open({
        hotelId: input.hotelId || chat.hotel_id, subject: input.subject, details, category: input.category, priority: input.priority, channel: "whatsapp",
        contactName: chat.name, contactMobile: chat.phone_key, raisedBy: `${chat.name || `+${chat.phone}`} (WhatsApp)`, createdBy: s.user.id, waChatId: chat.id,
        assigneeId: input.assigneeId === "me" ? s.user.id : null, via: "whatsapp",
    });
    const wa = require("../crm/wa");
    await chat.update({ needs_reply: false });
    await wa.note(chat, `${s.user.name} made ticket ${C.ticketNo(sup.ticket_id)}: ${sup.subject}`);
    return { id: sup.ticket_id };
}

/* ------------------------------ WhatsApp in ------------------------------ */

const RATE_WORDS = { good: 5, okay: 3, ok: 3, poor: 1, bad: 1 };
/** "Good" / "Okay" / "Poor" (the buttons), or a digit 1-5. */
function ratingOf(text) {
    const w = String(text || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
    if (RATE_WORDS[w]) return RATE_WORDS[w];
    if (/^[1-5]$/.test(w)) return Number(w) >= 4 ? 5 : Number(w) === 3 ? 3 : 1;
    return null;
}

/**
 * A WhatsApp message from someone with a ticket: a rating answer, or a
 * message added to their open ticket (a closed one reopens if it closed
 * within reopenDays). Then it needs no separate reply in the inbox.
 */
async function onWhatsApp(r) {
    const { chat, message } = r || {};
    if (!chat || !message || message.direction !== "in" || !chat.phone_key) return null;
    const cfg = await C.supportSettings();
    const now = message.at ? new Date(message.at) : new Date();
    const since = new Date(now.getTime() - cfg.reopenDays * 86400000);
    const found = await SupTicket.findAll({ where: { [Op.or]: [{ wa_chat_id: chat.id }, { contact_mobile: chat.phone_key }], [Op.and]: [{ [Op.or]: [{ state: { [Op.ne]: "closed" } }, { closed_at: { [Op.gte]: since } }, { rating_asked_at: { [Op.gte]: since } }] }] }, order: [["id", "DESC"]], limit: 20 });
    if (!found.length) return null;
    const time = (d) => (d ? new Date(d).getTime() : 0);
    // A rating word answers the latest rating question; anything else goes to
    // the open ticket support wrote about last, else reopens the latest closed one.
    const rated = ratingOf(message.body);
    const asked = found.filter((x) => x.state === "closed" && x.rating_asked_at && !x.rated_at).sort((a, b) => time(b.rating_asked_at) - time(a.rating_asked_at))[0];
    const open = found.filter((x) => x.state !== "closed").sort((a, b) => time(b.last_staff_at) - time(a.last_staff_at) || b.id - a.id)[0];
    const recent = found.filter((x) => x.state === "closed" && time(x.closed_at) >= since.getTime()).sort((a, b) => time(b.closed_at) - time(a.closed_at))[0];
    const sup = rated && asked ? asked : open || recent;
    if (!sup) return null;
    const wa = require("../crm/wa");
    const body = message.body || `[${message.kind}]`;
    const rating = rated && sup === asked ? rated : null;
    if (rating) {
        await sup.update({ rating, rated_at: now, wa_chat_id: chat.id });
        await addMessage(sup.ticket_id, { kind: "system", body: `The customer rated the help: ${C.RATING[rating]}`, via: "whatsapp", wa_message_id: message.id, at: now });
        await CrmWaChat.update({ needs_reply: false }, { where: { id: chat.id } });
        if (rating === 1) for (const p of [{ id: sup.assignee_id }, ...(await leads())].filter((p) => p.id)) await notify(p.id, { type: "ticket.rating", title: `Poor rating on ${C.ticketNo(sup.ticket_id)}`, body: sup.subject, link: `/support/${sup.ticket_id}`, ref: `ticket-poor:${sup.ticket_id}:${p.id}` });
        return { ticketId: sup.ticket_id, rating };
    }
    if (sup.state === "closed" && !(sup.closed_at && new Date(sup.closed_at) >= since)) return null;
    await sequelize.transaction(async (t) => {
        const row = await getSup(sup.ticket_id, t, true);
        if (row.state === "closed") await reopenTicket(row.ticket_id, "The customer wrote again on WhatsApp: reopened", now, t);
        await row.reload({ transaction: t });
        await addMessage(row.ticket_id, { kind: "customer", author_name: chat.name || `+${chat.phone}`, via: "whatsapp", body, wa_message_id: message.id, at: now }, t);
        if (row.state === "waiting") await resume(row, now, t);
        // When it reached us (WhatsApp times are whole seconds).
        await row.update({ last_customer_at: new Date(Math.max(now.getTime(), Date.now())), wa_chat_id: chat.id }, { transaction: t });
        await syncLegacy(row, t);
    });
    await CrmWaChat.update({ needs_reply: false }, { where: { id: chat.id } });
    await wa.note(chat, `Added to ticket ${C.ticketNo(sup.ticket_id)}`);
    if (sup.assignee_id) await notify(sup.assignee_id, { type: "ticket.reply", title: `Customer wrote on ${C.ticketNo(sup.ticket_id)}`, body: txt(body, 160), link: `/support/${sup.ticket_id}`, ref: `ticket-in:${sup.ticket_id}:${message.id}` });
    return { ticketId: sup.ticket_id };
}

module.exports = { open, list, counts, forCustomer, detail, reply, note, setWaiting, assign, update, close, closeTicket, askRating, reopen, reopenTicket, create, fromChat, onWhatsApp, ratingOf, addMessage, getSup, syncLegacy, resume, rowsOut, leads, VIEWS };

// Customer WhatsApp messages reach their ticket (the webhook runs in the API process).
require("../crm/wa").onInbound(onWhatsApp);
