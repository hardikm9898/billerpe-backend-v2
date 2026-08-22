const { Op } = require("sequelize")
const { STATUSCODE, MESSAGE } = require("../../constant/const")
const { error, success } = require("../../responce/res")
const { CrmLead, CrmEmployeeProfile, CrmAssignmentHistory } = require("../../model")
const { buildLeadScope } = require("../../services/crm/leadScopeFilter")
const { logActivity } = require("../../services/crm/leadActivityLogger")
const { notify } = require("../../services/crm/notificationService")

// Shared by single-assign and bulk-assign — moves a lead to a new assignee,
// records history, logs the timeline entry, and notifies the new assignee.
const performAssignment = async (lead, toEmployeeId, assignedByProfileId, reason) => {
    const fromEmployeeId = lead.assigned_to

    await CrmAssignmentHistory.create({
        lead_id: lead.id,
        from_employee_id: fromEmployeeId,
        to_employee_id: toEmployeeId,
        reason,
        assigned_by: assignedByProfileId,
        assigned_at: new Date(),
    })

    await lead.update({
        assigned_to: toEmployeeId,
        assigned_by: assignedByProfileId,
        status: lead.status === "NEW" ? "ASSIGNED" : lead.status,
    })

    await logActivity(lead.id, assignedByProfileId, "assignment", {
        oldValue: fromEmployeeId ? String(fromEmployeeId) : null,
        newValue: String(toEmployeeId),
        description: reason,
    })

    await notify(toEmployeeId, "lead_assigned", "New lead assigned to you", {
        body: lead.name || lead.phone_number,
        leadId: lead.id,
    })
}

// POST /crm/leads/:id/assign — body: { to_employee_id, reason }
const assignLead = async (req, res) => {
    try {
        const { id } = req.params
        const { to_employee_id, reason } = req.body
        if (!to_employee_id) return res.json(error("to_employee_id is required", STATUSCODE.BAD_REQUEST))

        const targetEmployee = await CrmEmployeeProfile.findOne({ where: { id: to_employee_id, is_active: true } })
        if (!targetEmployee) return res.json(error("Target employee not found or inactive", STATUSCODE.NOT_FOUND))

        // Managers may only assign within their own team
        if (!req.crmProfile.isAdmin && req.crmProfile.employee_type === "manager") {
            const isOwnTeam = targetEmployee.id === req.crmProfile.id || targetEmployee.manager_id === req.crmProfile.id
            if (!isOwnTeam) return res.json(error(MESSAGE.NOT_ACCESS, STATUSCODE.FORBIDDEN))
        } else if (!req.crmProfile.isAdmin) {
            return res.json(error(MESSAGE.NOT_ACCESS, STATUSCODE.FORBIDDEN))
        }

        const lead = await CrmLead.findByPk(id)
        if (!lead || lead.deleted) return res.json(error("Lead Not Found", STATUSCODE.NOT_FOUND))

        const assignedByProfileId = req.crmProfile.isAdmin ? null : req.crmProfile.id
        await performAssignment(lead, to_employee_id, assignedByProfileId, reason)

        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { lead, message: "Lead Assigned Successfully" }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err, "Error::: assignLead")
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

// POST /crm/leads/bulk-assign — body: { lead_ids: [], to_employee_id, reason }
const bulkAssign = async (req, res) => {
    try {
        const { lead_ids, to_employee_id, reason } = req.body
        if (!Array.isArray(lead_ids) || !lead_ids.length || !to_employee_id) {
            return res.json(error("lead_ids[] and to_employee_id are required", STATUSCODE.BAD_REQUEST))
        }

        const targetEmployee = await CrmEmployeeProfile.findOne({ where: { id: to_employee_id, is_active: true } })
        if (!targetEmployee) return res.json(error("Target employee not found or inactive", STATUSCODE.NOT_FOUND))

        if (!req.crmProfile.isAdmin && req.crmProfile.employee_type === "manager") {
            const isOwnTeam = targetEmployee.id === req.crmProfile.id || targetEmployee.manager_id === req.crmProfile.id
            if (!isOwnTeam) return res.json(error(MESSAGE.NOT_ACCESS, STATUSCODE.FORBIDDEN))
        } else if (!req.crmProfile.isAdmin) {
            return res.json(error(MESSAGE.NOT_ACCESS, STATUSCODE.FORBIDDEN))
        }

        const assignedByProfileId = req.crmProfile.isAdmin ? null : req.crmProfile.id
        const leads = await CrmLead.findAll({ where: { id: { [Op.in]: lead_ids }, deleted: false } })

        for (const lead of leads) {
            await performAssignment(lead, to_employee_id, assignedByProfileId, reason)
        }

        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { count: leads.length, message: "Leads Assigned Successfully" }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err, "Error::: bulkAssign")
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

// GET /crm/leads/unassigned
const getUnassignedLeads = async (req, res) => {
    try {
        let { page = 1, limit = 20 } = req.query
        page = Number(page)
        limit = Number(limit)

        const { rows, count } = await CrmLead.findAndCountAll({
            where: { assigned_to: null, deleted: false },
            limit,
            offset: (page - 1) * limit,
            order: [["createdAt", "DESC"]],
        })

        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { leads: rows, page, count: rows.length, totalRecords: count }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err, "Error::: getUnassignedLeads")
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

// GET /crm/leads/:id/assignment-history
const getAssignmentHistory = async (req, res) => {
    try {
        const { id } = req.params
        // from_employee_id / to_employee_id / assigned_by are plain ids (no FK association) —
        // the frontend resolves names via GET /crm/employees.
        const history = await CrmAssignmentHistory.findAll({
            where: { lead_id: id },
            order: [["createdAt", "DESC"]],
        })

        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { history }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err, "Error::: getAssignmentHistory")
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

module.exports = { assignLead, bulkAssign, getUnassignedLeads, getAssignmentHistory }
