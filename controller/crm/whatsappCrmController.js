const { Op } = require("sequelize")
const { STATUSCODE, MESSAGE } = require("../../constant/const")
const { error, success } = require("../../responce/res")
const {
    CrmLead,
    CrmWhatsappCampaign,
    CrmCampaignRecipient,
    WaMessage,
    WhatsappTemplate,
} = require("../../model")
const { sendWAMessage } = require("../whatsappAgentController")
const { logActivity } = require("../../services/crm/leadActivityLogger")
const { enqueueCampaign } = require("../../services/crm/campaignQueue")

// ── Part A: Per-lead WhatsApp ─────────────────────────────────────────────────

// POST /crm/leads/:id/whatsapp — send a WhatsApp message to the lead's number
const sendLeadWhatsapp = async (req, res) => {
    try {
        const { id } = req.params
        const { message } = req.body

        if (!message?.trim()) return res.json(error("message is required", STATUSCODE.BAD_REQUEST))

        const lead = await CrmLead.findOne({ where: { id, deleted: false } })
        if (!lead) return res.json(error("Lead Not Found", STATUSCODE.NOT_FOUND))
        if (!lead.phone_number) return res.json(error("This lead has no phone number", STATUSCODE.BAD_REQUEST))

        const finalMessage = message.replace(/\{\{\s*name\s*\}\}/gi, lead.name || "there")
        await sendWAMessage(lead.phone_number, finalMessage)

        await logActivity(lead.id, req.crmProfile?.id || null, req.crmProfile?.isAdmin ? "admin" : "employee", {
            description: `WhatsApp message sent: "${finalMessage.slice(0, 80)}${finalMessage.length > 80 ? "..." : ""}"`,
            activity_type: "whatsapp",
        })

        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { message: "WhatsApp message sent" }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err, "Error::: sendLeadWhatsapp")
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

// GET /crm/leads/:id/whatsapp — fetch WhatsApp message history for the lead's phone number
const getLeadWhatsappHistory = async (req, res) => {
    try {
        const { id } = req.params
        let { limit = 50 } = req.query

        const lead = await CrmLead.findOne({ where: { id, deleted: false }, attributes: ["id", "phone_number"] })
        if (!lead) return res.json(error("Lead Not Found", STATUSCODE.NOT_FOUND))
        if (!lead.phone_number) return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { messages: [] }, STATUSCODE.SUCCESS))

        const messages = await WaMessage.findAll({
            where: { phone: lead.phone_number },
            order: [["ts", "ASC"]],
            limit: Number(limit),
        })

        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { messages }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err, "Error::: getLeadWhatsappHistory")
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

// ── Part B: WhatsApp Campaigns ────────────────────────────────────────────────

// GET /crm/whatsapp-templates — list active templates for campaign picker
const listTemplates = async (_req, res) => {
    try {
        const templates = await WhatsappTemplate.findAll({
            where: { active: true },
            attributes: ["id", "name", "params", "default_image"],
            order: [["name", "ASC"]],
        })
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { templates }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err, "Error::: listTemplates")
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

// GET /crm/whatsapp-campaigns — list all campaigns
const listCampaigns = async (_req, res) => {
    try {
        const campaigns = await CrmWhatsappCampaign.findAll({ order: [["createdAt", "DESC"]] })
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { campaigns }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err, "Error::: listCampaigns")
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

// POST /crm/whatsapp-campaigns — create a new campaign
const createCampaign = async (req, res) => {
    try {
        const { name, template_id, param_values, lead_filter } = req.body
        if (!name?.trim()) return res.json(error("name is required", STATUSCODE.BAD_REQUEST))
        if (!template_id) return res.json(error("template_id is required — campaigns must use a pre-approved WhatsApp template", STATUSCODE.BAD_REQUEST))

        const template = await WhatsappTemplate.findByPk(template_id, { attributes: ["id", "name", "params", "active"] })
        if (!template || !template.active) return res.json(error("Template not found or inactive", STATUSCODE.BAD_REQUEST))

        if (param_values !== undefined && !Array.isArray(param_values))
            return res.json(error("param_values must be an array", STATUSCODE.BAD_REQUEST))
        if (Array.isArray(param_values) && param_values.length !== template.params.length)
            return res.json(error(`Template "${template.name}" requires ${template.params.length} parameter value(s)`, STATUSCODE.BAD_REQUEST))

        const campaign = await CrmWhatsappCampaign.create({
            name: name.trim(),
            template_id,
            param_values: param_values || template.params.map(() => ""),
            lead_filter: lead_filter || null,
            created_by: req.user?.id || null,
            status: "draft",
        })

        return res.status(STATUSCODE.CREATED).json(success(MESSAGE.SUCCESS, { campaign, message: "Campaign Created Successfully" }, STATUSCODE.CREATED))
    } catch (err) {
        console.log(err, "Error::: createCampaign")
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

// GET /crm/whatsapp-campaigns/:id — campaign detail + recipient breakdown
const getCampaign = async (req, res) => {
    try {
        const { id } = req.params
        let { page = 1, limit = 20 } = req.query
        page = Number(page)
        limit = Number(limit)

        const campaign = await CrmWhatsappCampaign.findByPk(id)
        if (!campaign) return res.json(error("Campaign Not Found", STATUSCODE.NOT_FOUND))

        const { rows: recipients, count } = await CrmCampaignRecipient.findAndCountAll({
            where: { campaign_id: id },
            include: [{ model: CrmLead, attributes: ["id", "name", "phone_number"] }],
            limit,
            offset: (page - 1) * limit,
            order: [["createdAt", "ASC"]],
        })

        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { campaign, recipients, page, totalRecords: count }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err, "Error::: getCampaign")
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

// POST /crm/whatsapp-campaigns/:id/send — resolve leads, create recipient rows, enqueue
const sendCampaign = async (req, res) => {
    try {
        const { id } = req.params

        const campaign = await CrmWhatsappCampaign.findByPk(id)
        if (!campaign) return res.json(error("Campaign Not Found", STATUSCODE.NOT_FOUND))
        if (campaign.status === "running") return res.json(error("Campaign is already running", STATUSCODE.BAD_REQUEST))
        if (campaign.status === "completed") return res.json(error("Campaign has already been sent", STATUSCODE.BAD_REQUEST))

        // Build lead filter from campaign.lead_filter
        const filter = campaign.lead_filter || {}
        const where = { deleted: false, phone_number: { [Op.ne]: null } }
        if (filter.lead_ids?.length) where.id = { [Op.in]: filter.lead_ids }
        if (filter.status?.length) where.status = { [Op.in]: filter.status }
        if (filter.source?.length) where.source = { [Op.in]: filter.source }
        if (filter.priority?.length) where.priority = { [Op.in]: filter.priority }
        if (filter.assigned_to?.length) where.assigned_to = { [Op.in]: filter.assigned_to }

        // Safety: require at least one filter condition so we never silently blast all leads
        const hasFilter = filter.lead_ids?.length || filter.status?.length || filter.source?.length || filter.priority?.length || filter.assigned_to?.length
        if (!hasFilter) return res.json(error("Campaign lead_filter is empty — provide lead_ids, status, source, priority, or assigned_to to target specific leads", STATUSCODE.BAD_REQUEST))

        const leads = await CrmLead.findAll({ where, attributes: ["id", "phone_number"] })
        if (!leads.length) return res.json(error("No leads match the campaign filter", STATUSCODE.BAD_REQUEST))

        // Dedupe: skip leads already in this campaign
        const existing = await CrmCampaignRecipient.findAll({ where: { campaign_id: id }, attributes: ["lead_id"] })
        const existingIds = new Set(existing.map((r) => r.lead_id))
        const newLeads = leads.filter((l) => !existingIds.has(l.id))

        if (newLeads.length) {
            await CrmCampaignRecipient.bulkCreate(
                newLeads.map((l) => ({ campaign_id: Number(id), lead_id: l.id, phone_number: l.phone_number, status: "queued" }))
            )
        }

        const totalRecipients = existingIds.size + newLeads.length
        await campaign.update({ status: "draft", total_recipients: totalRecipients })

        // Ack immediately, enqueue in background
        res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { message: `Campaign queued — ${totalRecipients} recipient(s)` }, STATUSCODE.SUCCESS))

        enqueueCampaign(Number(id))
    } catch (err) {
        console.log(err, "Error::: sendCampaign")
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

module.exports = { sendLeadWhatsapp, getLeadWhatsappHistory, listTemplates, listCampaigns, createCampaign, getCampaign, sendCampaign }
