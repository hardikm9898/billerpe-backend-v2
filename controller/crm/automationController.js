const { STATUSCODE, MESSAGE } = require("../../constant/const")
const { error, success } = require("../../responce/res")
const { CrmAutomationRule, CrmAutomationLog, CrmLead } = require("../../model")

const TRIGGER_TYPES = ["lead_not_contacted", "demo_no_response", "payment_pending_reminder"]
const ACTION_TYPES = ["notify_manager", "create_task", "send_whatsapp", "change_priority"]

// GET /crm/automation-rules — Admin only
const listAutomationRules = async (_req, res) => {
    try {
        const rules = await CrmAutomationRule.findAll({ order: [["createdAt", "DESC"]] })
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { rules }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err, "Error::: listAutomationRules")
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

// POST /crm/automation-rules — Admin only — body: { name, trigger_type, trigger_condition, action_type, action_config, is_active }
const createAutomationRule = async (req, res) => {
    try {
        const { name, trigger_type, trigger_condition, action_type, action_config, is_active } = req.body

        if (!name || !trigger_type || !action_type) return res.json(error("name, trigger_type and action_type are required", STATUSCODE.BAD_REQUEST))
        if (!TRIGGER_TYPES.includes(trigger_type)) return res.json(error("Invalid trigger_type value", STATUSCODE.BAD_REQUEST))
        if (!ACTION_TYPES.includes(action_type)) return res.json(error("Invalid action_type value", STATUSCODE.BAD_REQUEST))

        const rule = await CrmAutomationRule.create({
            name,
            trigger_type,
            trigger_condition: trigger_condition || {},
            action_type,
            action_config: action_config || {},
            is_active: is_active !== false,
        })

        return res.status(STATUSCODE.CREATED).json(success(MESSAGE.SUCCESS, { rule, message: "Automation Rule Created Successfully" }, STATUSCODE.CREATED))
    } catch (err) {
        console.log(err, "Error::: createAutomationRule")
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

// PUT /crm/automation-rules/:id — Admin only
const updateAutomationRule = async (req, res) => {
    try {
        const { id } = req.params
        const { name, trigger_type, trigger_condition, action_type, action_config, is_active } = req.body

        if (trigger_type && !TRIGGER_TYPES.includes(trigger_type)) return res.json(error("Invalid trigger_type value", STATUSCODE.BAD_REQUEST))
        if (action_type && !ACTION_TYPES.includes(action_type)) return res.json(error("Invalid action_type value", STATUSCODE.BAD_REQUEST))

        const rule = await CrmAutomationRule.findByPk(id)
        if (!rule) return res.json(error("Automation Rule Not Found", STATUSCODE.NOT_FOUND))

        await rule.update({ name, trigger_type, trigger_condition, action_type, action_config, is_active })

        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { rule, message: "Automation Rule Updated Successfully" }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err, "Error::: updateAutomationRule")
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

// GET /crm/automation-rules/:id/logs — Admin only
const getAutomationLogs = async (req, res) => {
    try {
        const { id } = req.params
        let { page = 1, limit = 20 } = req.query
        page = Number(page)
        limit = Number(limit)

        const rule = await CrmAutomationRule.findByPk(id)
        if (!rule) return res.json(error("Automation Rule Not Found", STATUSCODE.NOT_FOUND))

        const { rows, count } = await CrmAutomationLog.findAndCountAll({
            where: { rule_id: id },
            include: [{ model: CrmLead, attributes: ["id", "name", "phone_number"] }],
            limit,
            offset: (page - 1) * limit,
            order: [["executed_at", "DESC"]],
        })

        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { logs: rows, page, count: rows.length, totalRecords: count }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err, "Error::: getAutomationLogs")
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

module.exports = { listAutomationRules, createAutomationRule, updateAutomationRule, getAutomationLogs, TRIGGER_TYPES, ACTION_TYPES }
