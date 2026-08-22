const { Op } = require("sequelize")
const { STATUSCODE, MESSAGE } = require("../../constant/const")
const { error, success } = require("../../responce/res")
const { CrmLead, CrmEmployeeProfile, CrmTask, CrmCallLog, CrmDemoSchedule, superAdminModel } = require("../../model")
const { buildLeadScope } = require("../../services/crm/leadScopeFilter")
const { logActivity } = require("../../services/crm/leadActivityLogger")

const LEAD_STATUSES = ["NEW", "ASSIGNED", "CONTACT_ATTEMPTED", "NO_ANSWER", "BUSY", "CALLBACK_REQUESTED", "WRONG_NUMBER", "FAKE_LEAD", "INTERESTED", "SEMI_INTERESTED", "NOT_INTERESTED", "DEMO_SCHEDULED", "DEMO_COMPLETED", "DEMO_MISSED", "PROPOSAL_SENT", "NEGOTIATION", "APPROVAL_PENDING", "PAYMENT_PENDING", "CONVERTED", "LOST", "REOPENED"]
const LEAD_PRIORITIES = ["P1", "P2", "P3", "P4"]

const employeeWithUser = (as) => ({
    model: CrmEmployeeProfile,
    as,
    attributes: ["id", "employee_type"],
    include: [{ model: superAdminModel, as: "user", attributes: ["name", "number"] }],
})

// GET /crm/leads — paginated, filterable, scoped by role
const listLeads = async (req, res) => {
    try {
        let { page = 1, limit = 20, status, priority, source, assigned_to, search, startDate, endDate } = req.query
        page = Number(page)
        limit = Number(limit)

        const scope = await buildLeadScope(req.crmProfile)
        const where = { ...scope, deleted: false }

        if (status) where.status = status
        if (priority) where.priority = priority
        if (source) where.source = source
        if (assigned_to) where.assigned_to = assigned_to
        if (search) {
            where[Op.or] = [
                { name: { [Op.like]: `%${search}%` } },
                { phone_number: { [Op.like]: `%${search}%` } },
                { email: { [Op.like]: `%${search}%` } },
            ]
        }
        if (startDate || endDate) {
            where.createdAt = {}
            if (startDate) where.createdAt[Op.gte] = new Date(startDate)
            if (endDate) where.createdAt[Op.lte] = new Date(endDate)
        }

        const { rows, count } = await CrmLead.findAndCountAll({
            where,
            include: [employeeWithUser("assignee")],
            limit,
            offset: (page - 1) * limit,
            order: [["createdAt", "DESC"]],
            distinct: true,
        })

        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { leads: rows, page, count: rows.length, totalRecords: count }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err, "Error::: listLeads")
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

// GET /crm/leads/:id — full detail with related records, scoped by role
const getLeadDetail = async (req, res) => {
    try {
        const { id } = req.params
        const scope = await buildLeadScope(req.crmProfile)

        const lead = await CrmLead.findOne({
            where: { id, ...scope },
            include: [
                employeeWithUser("assignee"),
                employeeWithUser("assigner"),
                { model: CrmTask, as: "tasks", separate: true, limit: 20, order: [["createdAt", "DESC"]] },
                { model: CrmCallLog, as: "callLogs", separate: true, limit: 20, order: [["createdAt", "DESC"]] },
                { model: CrmDemoSchedule, as: "demoSchedules", separate: true, limit: 10, order: [["scheduled_at", "DESC"]] },
                { association: "paymentTracking" },
                {
                    association: "activities",
                    separate: true,
                    limit: 50,
                    order: [["createdAt", "DESC"]],
                    include: [employeeWithUser("actor")],
                },
            ],
        })

        if (!lead) return res.json(error("Lead Not Found", STATUSCODE.NOT_FOUND))

        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { lead }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err, "Error::: getLeadDetail")
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

// POST /crm/leads — manual lead creation
const createLead = async (req, res) => {
    try {
        const { name, phone_number, email, message, priority } = req.body
        if (!phone_number) return res.json(error("phone_number is required", STATUSCODE.BAD_REQUEST))

        const lead = await CrmLead.create({
            name,
            phone_number,
            email,
            message,
            source: "manual",
            priority: LEAD_PRIORITIES.includes(priority) ? priority : "P3",
        })

        const actorId = req.crmProfile.isAdmin ? null : req.crmProfile.id
        await logActivity(lead.id, actorId, "system", { description: "Lead created manually" })

        return res.status(STATUSCODE.CREATED).json(success(MESSAGE.SUCCESS, { lead, message: "Lead Created Successfully" }, STATUSCODE.CREATED))
    } catch (err) {
        console.log(err, "Error::: createLead")
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

// PUT /crm/leads/:id — update editable lead fields
const updateLead = async (req, res) => {
    try {
        const { id } = req.params
        const { name, email, message, campaign_name, adset_name, ad_name, lead_form_name } = req.body

        const lead = await CrmLead.findByPk(id)
        if (!lead || lead.deleted) return res.json(error("Lead Not Found", STATUSCODE.NOT_FOUND))

        await lead.update({ name, email, message, campaign_name, adset_name, ad_name, lead_form_name })

        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { lead, message: "Lead Updated Successfully" }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err, "Error::: updateLead")
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

// PATCH /crm/leads/:id/status — change lead status (logs to timeline)
const changeStatus = async (req, res) => {
    try {
        const { id } = req.params
        const { status, note } = req.body

        if (!LEAD_STATUSES.includes(status)) return res.json(error("Invalid status value", STATUSCODE.BAD_REQUEST))

        const lead = await CrmLead.findByPk(id)
        if (!lead || lead.deleted) return res.json(error("Lead Not Found", STATUSCODE.NOT_FOUND))

        const oldStatus = lead.status
        await lead.update({ status })

        const actorId = req.crmProfile.isAdmin ? null : req.crmProfile.id
        await logActivity(lead.id, actorId, "status_change", { oldValue: oldStatus, newValue: status, description: note })

        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { lead, message: "Status Updated" }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err, "Error::: changeStatus")
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

// PATCH /crm/leads/:id/priority — change lead priority (logs to timeline)
const changePriority = async (req, res) => {
    try {
        const { id } = req.params
        const { priority } = req.body

        if (!LEAD_PRIORITIES.includes(priority)) return res.json(error("Invalid priority value", STATUSCODE.BAD_REQUEST))

        const lead = await CrmLead.findByPk(id)
        if (!lead || lead.deleted) return res.json(error("Lead Not Found", STATUSCODE.NOT_FOUND))

        const oldPriority = lead.priority
        await lead.update({ priority })

        const actorId = req.crmProfile.isAdmin ? null : req.crmProfile.id
        await logActivity(lead.id, actorId, "status_change", { oldValue: oldPriority, newValue: priority, description: "Priority changed" })

        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { lead, message: "Priority Updated" }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err, "Error::: changePriority")
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

// DELETE /crm/leads/:id — soft delete
const softDeleteLead = async (req, res) => {
    try {
        const { id } = req.params
        const lead = await CrmLead.findByPk(id)
        if (!lead || lead.deleted) return res.json(error("Lead Not Found", STATUSCODE.NOT_FOUND))

        await lead.update({ deleted: true })

        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { message: "Lead Deleted Successfully" }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err, "Error::: softDeleteLead")
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

module.exports = { listLeads, getLeadDetail, createLead, updateLead, changeStatus, changePriority, softDeleteLead, LEAD_STATUSES, LEAD_PRIORITIES }
