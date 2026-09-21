// Support tickets raised from an outlet's Web POS. The browser only talks to
// the local exe, so the exe forwards them here under its device token
// (routes/sync.js). They land in the same hms_raise_ticket_msts table the
// SuperAdmin ticket screens already read, and ping the sales numbers the
// same way a ticket from the owner app does.
const { STATUSCODE, MESSAGE } = require("../../constant/const");
const { Hotel } = require("../../model");
const RaiseTicket = require("../../model/raiseTicket");
const { error, success } = require("../../responce/res");
const { sendAdminNotifications } = require("../webiste/user");

const PRIORITIES = ["low", "medium", "high"];

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
        const issue = `${cleanSubject}\n\n${cleanDetails}${by ? `\n\nRaised by: ${by}` : ""}`;
        const ticket = await RaiseTicket.create({
            issue,
            ticket_type: String(category ?? "Other").trim().slice(0, 60) || "Other",
            priority: PRIORITIES.includes(priority) ? priority : "low",
            hotel_id: req.user,
        });

        const hotel = await Hotel.findByPk(req.user);
        sendAdminNotifications(
            "Customer Ticket Generated",
            hotel?.owner_number || "",
            hotel?.hotel_name || "",
            `issue - ${cleanSubject}`,
        );
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { message: "Ticket raised", ticket }, STATUSCODE.SUCCESS));
    } catch (err) {
        console.error("[support] createTicket error:", err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

// This outlet's own tickets, newest first - without the internal comment
// thread or which sales person picked it up.
const listTickets = async (req, res) => {
    try {
        const page = Math.max(1, Number(req.query.page) || 1);
        const limit = 20;
        const { rows, count } = await RaiseTicket.findAndCountAll({
            where: { hotel_id: req.user },
            attributes: ["id", "issue", "ticket_type", "priority", "status", "createdAt", "updatedAt"],
            order: [["createdAt", "DESC"]],
            limit,
            offset: (page - 1) * limit,
        });
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { tickets: rows, page, totalRecords: count }, STATUSCODE.SUCCESS));
    } catch (err) {
        console.error("[support] listTickets error:", err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

module.exports = { createTicket, listTickets };
