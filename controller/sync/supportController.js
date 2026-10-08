// Support tickets raised from an outlet's Web POS. The browser only talks to
// the local exe, so the exe forwards them here under its device token
// (routes/sync.js). Since SuperAdmin phase 7 they go into the support queue
// (adminv1/sup): timers, an owner, and support's replies come back in the
// list below (and on WhatsApp).
const { STATUSCODE, MESSAGE } = require("../../constant/const");
const { RuleError } = require("../../appv1/core");
const { error, success } = require("../../responce/res");
const { Hotel } = require("../../model");
const outlet = require("../../adminv1/sup/outlet");
const { sendAdminNotifications } = require("../webiste/user");

const PRIORITIES = ["low", "medium", "high"];
// The Web POS form's own categories -> the support queue's (Settings > Support).
const CATEGORY = { Billing: "Billing and printing", Printer: "Printer", "Sync / Offline": "Outlet PC and sync", Stock: "Stock", Reports: "Reports", Other: "Other" };

const fail = (res, err, where) => {
    if (err instanceof RuleError) return res.json(error(err.message, STATUSCODE.BAD_REQUEST));
    console.error(`[support] ${where} error:`, err);
    return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
};

const createTicket = async (req, res) => {
    try {
        const { subject, details, category, priority, raised_by } = req.body || {};
        const cleanSubject = String(subject ?? "").trim();
        const cleanDetails = String(details ?? "").trim();
        if (!cleanSubject) return res.json(error("Subject is required", STATUSCODE.BAD_REQUEST));
        if (!cleanDetails) return res.json(error("Describe what happened", STATUSCODE.BAD_REQUEST));
        if (cleanSubject.length > 150) return res.json(error("Subject can be at most 150 characters", STATUSCODE.BAD_REQUEST));
        if (cleanDetails.length > 4000) return res.json(error("Description can be at most 4000 characters", STATUSCODE.BAD_REQUEST));
        const by = String(raised_by ?? "").trim();
        const ticket = await outlet.raise(req.user, {
            subject: cleanSubject,
            details: cleanDetails,
            category: CATEGORY[String(category ?? "").trim()] || String(category ?? "Other").trim().slice(0, 60) || "Other",
            priority: PRIORITIES.includes(priority) ? priority : "low",
            raisedBy: by,
            contactName: by.split("·")[0].trim(),
        }, "webpos");
        // The sales numbers' WhatsApp ping, as before the support queue.
        const hotel = await Hotel.findByPk(req.user);
        sendAdminNotifications("Customer Ticket Generated", hotel?.owner_number || "", hotel?.hotel_name || "", `issue - ${cleanSubject}`);
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { message: "Ticket raised", ticket }, STATUSCODE.SUCCESS));
    } catch (err) {
        return fail(res, err, "createTicket");
    }
};

// This outlet's own tickets, newest first, with support's replies - without
// internal notes or which BillerPe person picked it up.
const listTickets = async (req, res) => {
    try {
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, await outlet.list(req.user, req.query.page), STATUSCODE.SUCCESS));
    } catch (err) {
        return fail(res, err, "listTickets");
    }
};

// The outlet answers support from the Web POS (exe 1.1.7+).
const replyTicket = async (req, res) => {
    try {
        const { text, by } = req.body || {};
        await outlet.reply(req.user, req.params.id, text, { by: String(by ?? "").slice(0, 120), channel: "webpos" });
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { message: "Reply sent" }, STATUSCODE.SUCCESS));
    } catch (err) {
        return fail(res, err, "replyTicket");
    }
};

module.exports = { createTicket, listTickets, replyTicket };
