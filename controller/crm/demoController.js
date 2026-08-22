const { Op } = require("sequelize")
const { STATUSCODE, MESSAGE } = require("../../constant/const")
const { error, success } = require("../../responce/res")
const { CrmLead, CrmDemoSchedule, CrmEmployeeProfile, superAdminModel } = require("../../model")
const { buildLeadScope } = require("../../services/crm/leadScopeFilter")
const { logActivity } = require("../../services/crm/leadActivityLogger")
const { notify } = require("../../services/crm/notificationService")

const DEMO_MODES = ["online", "onsite", "call"]
const DEMO_OUTCOMES = ["completed", "missed", "rescheduled"]

// POST /crm/leads/:id/demos — body: { executive_id, scheduled_at, mode, notes }
const scheduleDemo = async (req, res) => {
    try {
        const { id } = req.params
        const { executive_id, scheduled_at, mode, notes } = req.body
        if (!scheduled_at) return res.json(error("scheduled_at is required", STATUSCODE.BAD_REQUEST))
        if (mode && !DEMO_MODES.includes(mode)) return res.json(error("Invalid mode value", STATUSCODE.BAD_REQUEST))

        const scope = await buildLeadScope(req.crmProfile)
        const lead = await CrmLead.findOne({ where: { id, ...scope } })
        if (!lead || lead.deleted) return res.json(error("Lead Not Found", STATUSCODE.NOT_FOUND))

        const demo = await CrmDemoSchedule.create({ lead_id: id, executive_id, scheduled_at, mode, notes })

        await lead.update({ status: "DEMO_SCHEDULED" })

        const actorId = req.crmProfile.isAdmin ? null : req.crmProfile.id
        await logActivity(lead.id, actorId, "demo", { newValue: "scheduled", description: `Demo scheduled for ${scheduled_at}` })

        if (executive_id) {
            await notify(executive_id, "demo_scheduled", "New demo scheduled", { body: lead.name || lead.phone_number, leadId: lead.id })
        }

        return res.status(STATUSCODE.CREATED).json(success(MESSAGE.SUCCESS, { demo, message: "Demo Scheduled Successfully" }, STATUSCODE.CREATED))
    } catch (err) {
        console.log(err, "Error::: scheduleDemo")
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

// PATCH /crm/demos/:id — body: { outcome, notes, reschedule_to }
const updateDemo = async (req, res) => {
    try {
        const { id } = req.params
        const { outcome, notes, reschedule_to } = req.body

        const demo = await CrmDemoSchedule.findByPk(id)
        if (!demo) return res.json(error("Demo Not Found", STATUSCODE.NOT_FOUND))

        if (outcome && !DEMO_OUTCOMES.includes(outcome)) return res.json(error("Invalid outcome value", STATUSCODE.BAD_REQUEST))

        const updates = {}
        if (notes !== undefined) updates.notes = notes
        if (outcome) updates.outcome = outcome
        if (reschedule_to) {
            updates.scheduled_at = reschedule_to
            updates.outcome = "rescheduled"
            updates.reschedule_count = (demo.reschedule_count || 0) + 1
        }

        await demo.update(updates)

        const actorId = req.crmProfile.isAdmin ? null : req.crmProfile.id
        const lead = await CrmLead.findByPk(demo.lead_id)

        if (outcome === "completed") {
            await lead.update({ status: "DEMO_COMPLETED" })
            await logActivity(demo.lead_id, actorId, "demo", { newValue: "completed", description: notes })
        } else if (outcome === "missed") {
            await lead.update({ status: "DEMO_MISSED" })
            await logActivity(demo.lead_id, actorId, "demo", { newValue: "missed", description: notes })
        } else if (reschedule_to) {
            await logActivity(demo.lead_id, actorId, "demo", { newValue: "rescheduled", description: `Rescheduled to ${reschedule_to}` })
        }

        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { demo, message: "Demo Updated Successfully" }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err, "Error::: updateDemo")
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

// GET /crm/demos — list/calendar view, filterable by executive + date range
const listDemos = async (req, res) => {
    try {
        let { executive_id, startDate, endDate, outcome } = req.query
        const where = {}

        if (!req.crmProfile.isAdmin) {
            where.executive_id = req.crmProfile.id
        } else if (executive_id) {
            where.executive_id = executive_id
        }
        if (outcome) where.outcome = outcome
        if (startDate || endDate) {
            where.scheduled_at = {}
            if (startDate) where.scheduled_at[Op.gte] = new Date(startDate)
            if (endDate) where.scheduled_at[Op.lte] = new Date(endDate)
        }

        const demos = await CrmDemoSchedule.findAll({
            where,
            include: [
                { model: CrmLead, attributes: ["id", "name", "phone_number", "status"] },
                { model: CrmEmployeeProfile, as: "executive", attributes: ["id", "employee_type"], include: [{ model: superAdminModel, as: "user", attributes: ["name"] }] },
            ],
            order: [["scheduled_at", "ASC"]],
        })

        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { demos }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err, "Error::: listDemos")
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

module.exports = { scheduleDemo, updateDemo, listDemos, DEMO_MODES, DEMO_OUTCOMES }
