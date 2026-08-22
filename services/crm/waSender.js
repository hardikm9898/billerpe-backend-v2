const axios = require("axios")
const WaMessage = require("../../model/waMessage")
const WaConversation = require("../../model/waConversation")

// Pure helpers for sending WhatsApp messages from background services
// (automation engine, campaign queue) without depending on the HTTP-layer
// controller. Reads credentials from process.env at call time (no caching)
// so env changes are picked up without restarts.

const apiBase = () => `https://graph.facebook.com/v22.0/${process.env.WHATSAPPPHONEID}/messages`
const authHeader = () => ({ Authorization: `Bearer ${process.env.WHATSAPPTOKEN}`, "Content-Type": "application/json" })

const persistOutbound = async (phone, text, messageId) => {
    const ts = Date.now()
    const msg = { id: messageId, text, direction: "outbound", ts, status: "sent", type: "template" }
    try {
        await WaConversation.upsert({ phone, name: phone, status: "open", unread: 0, lastMessageTime: ts, isManual: false })
        await WaMessage.create({ messageId, phone, text, direction: "outbound", ts, status: "sent", type: "template" })
    } catch (err) {
        console.error("[waSender] DB persist error:", err.message)
    }
    if (global.io) global.io.emit("wa_conversations_update", [])
    return msg
}

// resolveValue resolves a param_value entry against a lead row.
// Anything inside {{ }} is treated as a lead field name; everything else is literal.
// e.g. "{{name}}" → lead.name, "BillerPe" → "BillerPe"
const resolveValue = (template, lead) => {
    if (!template) return ""
    return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, field) => lead[field] ?? "")
}

// Send a pre-approved WhatsApp template message to a phone number.
// template    — WhatsappTemplate model instance (name, params, default_image)
// paramValues — array of value templates, one per template.params slot (e.g. ["{{name}}", "BillerPe"])
// lead        — CrmLead instance (used to resolve {{field}} tokens in paramValues)
const sendWATemplate = async (phone, template, paramValues = [], lead = {}) => {
    const resolvedValues = template.params.map((_, i) => resolveValue(paramValues[i] ?? "", lead))

    const bodyParameters = resolvedValues.map((val, i) => ({
        type: template.params[i]?.type || "text",
        text: String(val),
    }))

    const components = [{ type: "body", parameters: bodyParameters }]
    if (template.default_image) {
        components.unshift({
            type: "header",
            parameters: [{ type: "image", image: { link: template.default_image } }],
        })
    }

    const payload = {
        messaging_product: "whatsapp",
        to: phone,
        type: "template",
        template: {
            name: template.name,
            language: { code: "en" },
            components,
        },
    }

    const res = await axios.post(apiBase(), payload, { headers: authHeader() })
    const messageId = res.data?.messages?.[0]?.id || `local-${Date.now()}`

    const previewText = `[Template: ${template.name}]${resolvedValues.length ? " — " + resolvedValues.join(", ") : ""}`
    await persistOutbound(phone, previewText, messageId)
    return messageId
}

module.exports = { sendWATemplate, resolveValue }
