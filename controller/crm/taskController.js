const { Op } = require("sequelize")
const { STATUSCODE, MESSAGE } = require("../../constant/const")
const { error, success } = require("../../responce/res")
const { CrmTask, CrmLead, CrmEmployeeProfile, superAdminModel } = require("../../model")
const { logActivity } = require("../../services/crm/leadActivityLogger")
const { notify } = require("../../services/crm/notificationService")

const TASK_TYPES = ["call", "demo", "followup", "payment_reminder", "onboarding"]
const TASK_STATUSES = ["pending", "in_progress", "completed", "missed"]

const employeeWithUser = (as) => ({
    model: CrmEmployeeProfile,
    as,
    attributes: ["id", "employee_type"],
    include: [{ model: superAdminModel, as: "user", attributes: ["name"] }],
})

// Builds the `where` for task lists according to role:
//   Admin -> all, Manager -> own + direct reports', others -> only their own
const buildTaskScopeWhere = async (crmProfile) => {
    if (crmProfile.isAdmin) return {}
    if (crmProfile.employee_type === "manager") {
        const reports = await CrmEmployeeProfile.findAll({ where: { manager_id: crmProfile.id }, attributes: ["id"] })
        return { assigned_to: { [Op.in]: [crmProfile.id, ...reports.map((r) => r.id)] } }
    }
    return { assigned_to: crmProfile.id }
}

// GET /crm/tasks — filterable list, scoped by role
const listTasks = async (req, res) => {
    try {
        let { page = 1, limit = 20, status, task_type, assigned_to, dueBefore, dueAfter } = req.query
        page = Number(page)
        limit = Number(limit)

        const where = { ...(await buildTaskScopeWhere(req.crmProfile)) }
        if (status) where.status = status
        if (task_type) where.task_type = task_type
        if (assigned_to) where.assigned_to = assigned_to
        if (dueBefore || dueAfter) {
            where.due_at = {}
            if (dueAfter) where.due_at[Op.gte] = new Date(dueAfter)
            if (dueBefore) where.due_at[Op.lte] = new Date(dueBefore)
        }

        const { rows, count } = await CrmTask.findAndCountAll({
            where,
            include: [employeeWithUser("assignee"), { model: CrmLead, attributes: ["id", "name", "phone_number", "status"] }],
            limit,
            offset: (page - 1) * limit,
            order: [["due_at", "ASC"]],
            distinct: true,
        })

        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { tasks: rows, page, count: rows.length, totalRecords: count }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err, "Error::: listTasks")
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

// GET /crm/tasks/my — current user's tasks
const myTasks = async (req, res) => {
    try {
        if (req.crmProfile.isAdmin) return res.json(error("Admins have no personal task queue", STATUSCODE.BAD_REQUEST))

        let { status } = req.query
        const where = { assigned_to: req.crmProfile.id }
        if (status) where.status = status

        const tasks = await CrmTask.findAll({
            where,
            include: [{ model: CrmLead, attributes: ["id", "name", "phone_number", "status"] }],
            order: [["due_at", "ASC"]],
        })

        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { tasks }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err, "Error::: myTasks")
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

// POST /crm/tasks — body: { lead_id, assigned_to, task_type, due_at, notes }
const createTask = async (req, res) => {
    try {
        const { lead_id, assigned_to, task_type, due_at, notes } = req.body
        if (!lead_id || !task_type) return res.json(error("lead_id and task_type are required", STATUSCODE.BAD_REQUEST))
        if (!TASK_TYPES.includes(task_type)) return res.json(error("Invalid task_type value", STATUSCODE.BAD_REQUEST))

        const lead = await CrmLead.findByPk(lead_id)
        if (!lead || lead.deleted) return res.json(error("Lead Not Found", STATUSCODE.NOT_FOUND))

        const createdBy = req.crmProfile.isAdmin ? null : req.crmProfile.id
        const task = await CrmTask.create({ lead_id, assigned_to, task_type, due_at, notes, created_by: createdBy })

        await logActivity(lead.id, createdBy, "task", { newValue: task_type, description: `Task created: ${task_type}` })

        if (assigned_to) {
            await notify(assigned_to, "task_assigned", "New task assigned to you", { body: notes || task_type, leadId: lead.id })
        }

        return res.status(STATUSCODE.CREATED).json(success(MESSAGE.SUCCESS, { task, message: "Task Created Successfully" }, STATUSCODE.CREATED))
    } catch (err) {
        console.log(err, "Error::: createTask")
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

// PATCH /crm/tasks/:id — body: { status, notes }
const updateTask = async (req, res) => {
    try {
        const { id } = req.params
        const { status, notes } = req.body

        const task = await CrmTask.findByPk(id)
        if (!task) return res.json(error("Task Not Found", STATUSCODE.NOT_FOUND))

        if (status && !TASK_STATUSES.includes(status)) return res.json(error("Invalid status value", STATUSCODE.BAD_REQUEST))

        const updates = {}
        if (status) {
            updates.status = status
            if (status === "completed") updates.completed_at = new Date()
        }
        if (notes !== undefined) updates.notes = notes

        await task.update(updates)

        if (status) {
            const actorId = req.crmProfile.isAdmin ? null : req.crmProfile.id
            await logActivity(task.lead_id, actorId, "task", { newValue: status, description: `Task ${status}` })
        }

        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { task, message: "Task Updated Successfully" }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err, "Error::: updateTask")
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

module.exports = { listTasks, myTasks, createTask, updateTask, TASK_TYPES, TASK_STATUSES }
