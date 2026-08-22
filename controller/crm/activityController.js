const { STATUSCODE, MESSAGE } = require("../../constant/const")
const { error, success } = require("../../responce/res")
const { CrmLead, CrmLeadActivity, CrmEmployeeProfile, superAdminModel } = require("../../model")
const { buildLeadScope } = require("../../services/crm/leadScopeFilter")
const { logActivity } = require("../../services/crm/leadActivityLogger")

// GET /crm/leads/:id/activities — paginated timeline, scoped by role
const getActivities = async (req, res) => {
    try {
        const { id } = req.params
        let { page = 1, limit = 30 } = req.query
        page = Number(page)
        limit = Number(limit)

        const scope = await buildLeadScope(req.crmProfile)
        const lead = await CrmLead.findOne({ where: { id, ...scope } })
        if (!lead) return res.json(error("Lead Not Found", STATUSCODE.NOT_FOUND))

        const { rows, count } = await CrmLeadActivity.findAndCountAll({
            where: { lead_id: id },
            include: [{ model: CrmEmployeeProfile, as: "actor", attributes: ["id", "employee_type"], include: [{ model: superAdminModel, as: "user", attributes: ["name"] }] }],
            limit,
            offset: (page - 1) * limit,
            order: [["createdAt", "DESC"]],
        })

        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { activities: rows, page, count: rows.length, totalRecords: count }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err, "Error::: getActivities")
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

// POST /crm/leads/:id/activities — add a manual note to the timeline
const addNote = async (req, res) => {
    try {
        const { id } = req.params
        const { description } = req.body
        if (!description) return res.json(error("description is required", STATUSCODE.BAD_REQUEST))

        const scope = await buildLeadScope(req.crmProfile)
        const lead = await CrmLead.findOne({ where: { id, ...scope } })
        if (!lead) return res.json(error("Lead Not Found", STATUSCODE.NOT_FOUND))

        const actorId = req.crmProfile.isAdmin ? null : req.crmProfile.id
        const activity = await logActivity(lead.id, actorId, "note", { description })

        return res.status(STATUSCODE.CREATED).json(success(MESSAGE.SUCCESS, { activity, message: "Note Added" }, STATUSCODE.CREATED))
    } catch (err) {
        console.log(err, "Error::: addNote")
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

module.exports = { getActivities, addNote }
