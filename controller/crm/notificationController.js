const { STATUSCODE, MESSAGE } = require("../../constant/const")
const { error, success } = require("../../responce/res")
const { CrmNotification } = require("../../model")

// GET /crm/notifications — current user's notifications (Admins have no personal queue)
const listNotifications = async (req, res) => {
    try {
        if (req.crmProfile.isAdmin) return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { notifications: [] }, STATUSCODE.SUCCESS))

        let { page = 1, limit = 20, unreadOnly } = req.query
        page = Number(page)
        limit = Number(limit)

        const where = { recipient_id: req.crmProfile.id }
        if (unreadOnly === "true") where.is_read = false

        const { rows, count } = await CrmNotification.findAndCountAll({
            where,
            limit,
            offset: (page - 1) * limit,
            order: [["createdAt", "DESC"]],
        })

        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { notifications: rows, page, count: rows.length, totalRecords: count }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err, "Error::: listNotifications")
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

// PATCH /crm/notifications/:id/read
const markRead = async (req, res) => {
    try {
        const { id } = req.params
        const notification = await CrmNotification.findOne({ where: { id, recipient_id: req.crmProfile.id } })
        if (!notification) return res.json(error("Notification Not Found", STATUSCODE.NOT_FOUND))

        await notification.update({ is_read: true })

        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { notification, message: "Notification Marked As Read" }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err, "Error::: markRead")
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

// PATCH /crm/notifications/read-all
const markAllRead = async (req, res) => {
    try {
        await CrmNotification.update({ is_read: true }, { where: { recipient_id: req.crmProfile.id, is_read: false } })

        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { message: "All Notifications Marked As Read" }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err, "Error::: markAllRead")
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

// GET /crm/notifications/unread-count — lightweight badge counter
const getUnreadCount = async (req, res) => {
    try {
        if (req.crmProfile.isAdmin) return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { count: 0 }, STATUSCODE.SUCCESS))
        const count = await CrmNotification.count({ where: { recipient_id: req.crmProfile.id, is_read: false } })
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { count }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err, "Error::: getUnreadCount")
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

module.exports = { listNotifications, markRead, markAllRead, getUnreadCount }
