const { STATUSCODE, MESSAGE } = require("../../constant/const")
const { error, success } = require("../../responce/res")
const { CrmLead, CrmPaymentTracking } = require("../../model")
const { buildLeadScope } = require("../../services/crm/leadScopeFilter")
const { logActivity } = require("../../services/crm/leadActivityLogger")

const PAYMENT_STAGES = ["proposal_sent", "negotiation", "approval_pending", "payment_pending", "paid"]

const STAGE_TO_LEAD_STATUS = {
    proposal_sent: "PROPOSAL_SENT",
    negotiation: "NEGOTIATION",
    approval_pending: "APPROVAL_PENDING",
    payment_pending: "PAYMENT_PENDING",
    paid: "CONVERTED",
}

// GET /crm/leads/:id/payment
const getPayment = async (req, res) => {
    try {
        const { id } = req.params
        const scope = await buildLeadScope(req.crmProfile)
        const lead = await CrmLead.findOne({ where: { id, ...scope } })
        if (!lead) return res.json(error("Lead Not Found", STATUSCODE.NOT_FOUND))

        const payment = await CrmPaymentTracking.findOne({ where: { lead_id: id } })

        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { payment }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err, "Error::: getPayment")
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

// PUT /crm/leads/:id/payment — body: { proposal_amount, final_amount, stage, due_date, payment_reference }
// Creates the tracking row on first call, updates it thereafter (1:1 with lead).
const upsertPayment = async (req, res) => {
    try {
        const { id } = req.params
        const { proposal_amount, final_amount, stage, due_date, payment_reference } = req.body

        if (stage && !PAYMENT_STAGES.includes(stage)) return res.json(error("Invalid stage value", STATUSCODE.BAD_REQUEST))

        const scope = await buildLeadScope(req.crmProfile)
        const lead = await CrmLead.findOne({ where: { id, ...scope } })
        if (!lead || lead.deleted) return res.json(error("Lead Not Found", STATUSCODE.NOT_FOUND))

        let payment = await CrmPaymentTracking.findOne({ where: { lead_id: id } })
        const oldStage = payment?.stage || null

        const updates = { proposal_amount, final_amount, stage, due_date, payment_reference }
        if (stage === "paid" && oldStage !== "paid") updates.paid_at = new Date()

        if (!payment) {
            payment = await CrmPaymentTracking.create({ lead_id: id, ...updates })
        } else {
            await payment.update(updates)
        }

        const actorId = req.crmProfile.isAdmin ? null : req.crmProfile.id

        if (stage && stage !== oldStage) {
            await logActivity(lead.id, actorId, "payment", { oldValue: oldStage, newValue: stage, description: "Payment stage updated" })
            await lead.update({ status: STAGE_TO_LEAD_STATUS[stage] || lead.status })
        }

        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { payment, message: "Payment Info Updated" }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err, "Error::: upsertPayment")
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

module.exports = { getPayment, upsertPayment, PAYMENT_STAGES }
