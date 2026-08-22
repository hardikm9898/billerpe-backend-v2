const { STATUSCODE, MESSAGE } = require("../../constant/const")
const { error, success } = require("../../responce/res")
const { CrmLead, CrmCallLog } = require("../../model")
const { buildLeadScope } = require("../../services/crm/leadScopeFilter")
const { logActivity } = require("../../services/crm/leadActivityLogger")

const CALL_DIRECTIONS = ["outbound", "inbound"]
const CALL_OUTCOMES = ["connected", "no_answer", "busy", "wrong_number", "call_back_requested"]

// POST /crm/leads/:id/calls — manual call log entry.
// provider/provider_call_id/recording_url stay null until a telephony integration is wired up;
// this endpoint lets executives record calls made through any external phone today.
const logCall = async (req, res) => {
    try {
        const { id } = req.params
        const { direction, outcome, duration_seconds, notes, called_at, task_id } = req.body

        if (!CALL_DIRECTIONS.includes(direction)) return res.json(error("Invalid direction value", STATUSCODE.BAD_REQUEST))
        if (outcome && !CALL_OUTCOMES.includes(outcome)) return res.json(error("Invalid outcome value", STATUSCODE.BAD_REQUEST))

        const scope = await buildLeadScope(req.crmProfile)
        const lead = await CrmLead.findOne({ where: { id, ...scope } })
        if (!lead || lead.deleted) return res.json(error("Lead Not Found", STATUSCODE.NOT_FOUND))

        const callerId = req.crmProfile.isAdmin ? null : req.crmProfile.id
        const call = await CrmCallLog.create({
            lead_id: id,
            task_id: task_id || null,
            caller_id: callerId,
            direction,
            outcome,
            duration_seconds,
            notes,
            called_at: called_at || new Date(),
        })

        await logActivity(lead.id, callerId, "call", { newValue: outcome || direction, description: notes })

        return res.status(STATUSCODE.CREATED).json(success(MESSAGE.SUCCESS, { call, message: "Call Logged Successfully" }, STATUSCODE.CREATED))
    } catch (err) {
        console.log(err, "Error::: logCall")
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

// GET /crm/leads/:id/calls — call history for a lead
const getCallHistory = async (req, res) => {
    try {
        const { id } = req.params
        const scope = await buildLeadScope(req.crmProfile)
        const lead = await CrmLead.findOne({ where: { id, ...scope } })
        if (!lead) return res.json(error("Lead Not Found", STATUSCODE.NOT_FOUND))

        const calls = await CrmCallLog.findAll({ where: { lead_id: id }, order: [["called_at", "DESC"]] })

        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { calls }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err, "Error::: getCallHistory")
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

module.exports = { logCall, getCallHistory, CALL_DIRECTIONS, CALL_OUTCOMES }
