const { CrmWhatsappCampaign, CrmCampaignRecipient, CrmLead, WhatsappTemplate } = require("../../model")
const { sendWATemplate } = require("./waSender")
const { logActivity } = require("./leadActivityLogger")

// ── In-process campaign queue ─────────────────────────────────────────────────
// Campaigns are enqueued here and dispatched one message at a time in the
// background so POST /campaigns/:id/send can ack immediately.
// 300ms gap between sends reduces the risk of hitting WhatsApp rate limits.

const SEND_INTERVAL_MS = 300

let running = false
const queue = []

const enqueueCampaign = (campaignId) => {
    if (!queue.includes(campaignId)) queue.push(campaignId)
    if (!running) processNext()
}

const processNext = async () => {
    if (queue.length === 0) { running = false; return }
    running = true
    const campaignId = queue.shift()
    try {
        await runCampaign(campaignId)
    } catch (err) {
        console.error(`[CampaignQueue] campaign #${campaignId} failed:`, err.message)
    }
    setImmediate(processNext)
}

const runCampaign = async (campaignId) => {
    const campaign = await CrmWhatsappCampaign.findByPk(campaignId)
    if (!campaign || campaign.status === "completed") return

    if (!campaign.template_id) {
        console.error(`[CampaignQueue] campaign #${campaignId} has no template_id — cannot send`)
        await campaign.update({ status: "completed" })
        return
    }

    const template = await WhatsappTemplate.findByPk(campaign.template_id)
    if (!template || !template.active) {
        console.error(`[CampaignQueue] campaign #${campaignId} template not found or inactive`)
        await campaign.update({ status: "completed" })
        return
    }

    await campaign.update({ status: "running" })

    const recipients = await CrmCampaignRecipient.findAll({
        where: { campaign_id: campaignId, status: "queued" },
        include: [{ model: CrmLead, attributes: ["id", "name", "phone_number", "email"] }],
    })

    let sent = 0
    let failed = 0

    for (const recipient of recipients) {
        const phone = recipient.phone_number || recipient.crm_lead_mst?.phone_number
        if (!phone) {
            await recipient.update({ status: "failed", error_message: "No phone number" })
            failed++
            continue
        }

        const lead = recipient.crm_lead_mst || {}
        try {
            await sendWATemplate(phone, template, campaign.param_values || [], lead)
            await recipient.update({ status: "sent", sent_at: new Date() })
            await logActivity(recipient.lead_id, null, "system", {
                description: `WhatsApp campaign "${campaign.name}" template sent`,
                metadata: { campaign_id: campaignId, template: template.name },
                activity_type: "whatsapp",
            })
            sent++
        } catch (err) {
            const errMsg = err.response?.data?.error?.message || err.message
            await recipient.update({ status: "failed", error_message: errMsg })
            failed++
        }

        await new Promise((resolve) => setTimeout(resolve, SEND_INTERVAL_MS))
    }

    await campaign.update({
        status: "completed",
        sent_count: (campaign.sent_count || 0) + sent,
        failed_count: (campaign.failed_count || 0) + failed,
    })
}

module.exports = { enqueueCampaign }
