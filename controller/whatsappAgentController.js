const axios = require('axios')
const { success, error } = require('../responce/res')
const { STATUSCODE } = require('../constant/const')
const WaConversation  = require('../model/waConversation')
const WaMessage       = require('../model/waMessage')
const WhatsappTemplate = require('../model/whatsappTemplate')

// ─── In-memory cache ──────────────────────────────────────────────────────────
// Populated from DB on startup. All writes go to DB + this map simultaneously.
// Shape: { [phone]: { phone, name, profilePic, messages[], status, unread, lastMessageTime, isManual } }
const conversations = {}

let autoReplyConfig = {
    enabled: false,
    message: 'Hello! 👋 Thanks for reaching out. An agent will get back to you shortly.',
}

const TOKEN           = process.env.WHATSAPPTOKEN
const PHONE_NUMBER_ID = process.env.WHATSAPPPHONEID
const VERIFY_TOKEN    = process.env.WA_VERIFY_TOKEN

// ─── Load from DB into memory (called once at startup) ────────────────────────
const initStore = async () => {
    try {
        const [convRows, msgRows] = await Promise.all([
            WaConversation.findAll({ raw: true }),
            WaMessage.findAll({ raw: true, order: [['ts', 'ASC']] }),
        ])

        const msgsByPhone = {}
        msgRows.forEach(m => {
            if (!msgsByPhone[m.phone]) msgsByPhone[m.phone] = []
            msgsByPhone[m.phone].push({
                id:        m.messageId,
                text:      m.text,
                direction: m.direction,
                ts:        Number(m.ts),
                status:    m.status,
                type:      m.type || 'text',
            })
        })

        convRows.forEach(c => {
            conversations[c.phone] = {
                phone:           c.phone,
                name:            c.name,
                profilePic:      c.profilePic || null,
                status:          c.status,
                unread:          c.unread,
                lastMessageTime: Number(c.lastMessageTime),
                isManual:        c.isManual,
                messages:        msgsByPhone[c.phone] || [],
            }
        })

        console.log(`[WA Agent] Loaded ${convRows.length} conversations from DB`)
    } catch (err) {
        console.error('[WA Agent] Failed to load from DB:', err.message)
    }
}

// Run on module load — by the time any request arrives the DB will be ready
initStore()

// ─── Internal helpers ─────────────────────────────────────────────────────────

const emitToAll = (event, data) => {
    if (global.io) global.io.emit(event, data)
}

const sendWAMessage = async (phone, message) => {
    const response = await axios.post(
        `https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`,
        {
            messaging_product: 'whatsapp',
            to:   phone,
            type: 'text',
            text: { body: message },
        },
        {
            headers: {
                'Content-Type': 'application/json',
                Authorization:  `Bearer ${TOKEN}`,
            },
        }
    )
    return response.data?.messages?.[0]?.id || `local-${Date.now()}`
}

const saveConvToDB = async (conv) => {
    try {
        await WaConversation.upsert({
            phone:           conv.phone,
            name:            conv.name   || conv.phone,
            profilePic:      conv.profilePic  || null,
            status:          conv.status || 'open',
            unread:          conv.unread || 0,
            lastMessageTime: conv.lastMessageTime || 0,
            isManual:        conv.isManual || false,
        })
    } catch (e) {
        console.error('[WA Agent] saveConvToDB error:', e.message)
    }
}

const saveMsgToDB = async (phone, msg) => {
    try {
        await WaMessage.create({
            messageId: msg.id,
            phone,
            text:      msg.text      || '',
            direction: msg.direction || 'inbound',
            ts:        msg.ts        || Date.now(),
            status:    msg.status    || null,
            type:      msg.type      || 'text',
        })
    } catch (e) {
        // Ignore duplicate message inserts
        if (!e.message?.includes('Duplicate')) {
            console.error('[WA Agent] saveMsgToDB error:', e.message)
        }
    }
}

// ─── GET /superAdmin/whatsapp-agent/conversations ────────────────────────────
const getConversations = (_req, res) => {
    const list = Object.values(conversations).sort(
        (a, b) => (b.lastMessageTime || 0) - (a.lastMessageTime || 0)
    )
    return res.json(success('Success', list, STATUSCODE.SUCCESS))
}

// ─── GET /superAdmin/whatsapp-agent/webhook  (Meta verification) ─────────────
const handleWebhookVerify = (req, res) => {
    const mode      = req.query['hub.mode']
    const token     = req.query['hub.verify_token']
    const challenge = req.query['hub.challenge']
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
        return res.status(200).send(challenge)
    }
    return res.status(403).send('Forbidden')
}

// ─── POST /superAdmin/whatsapp-agent/webhook  (Incoming from Meta) ───────────
const handleWebhookMessage = (req, res) => {
    res.sendStatus(200) // always acknowledge immediately

    try {
        const body = req.body
        if (body.object !== 'whatsapp_business_account') return

        const value = body.entry?.[0]?.changes?.[0]?.value
        if (!value) return

        // ── Message status updates (ticks) ──────────────────────────────────
        if (value.statuses?.length) {
            const st    = value.statuses[0]
            const phone = st.recipient_id
            if (conversations[phone]) {
                const msg = conversations[phone].messages.find(m => m.id === st.id)
                if (msg) {
                    msg.status = st.status
                    // Persist status update
                    WaMessage.update({ status: st.status }, { where: { messageId: st.id, phone } })
                        .catch(e => console.error('[WA Agent] status update error:', e.message))
                    emitToAll('wa_message_status', { phone, messageId: st.id, status: st.status })
                }
            }
            return
        }

        // ── Incoming messages ───────────────────────────────────────────────
        if (value.messages?.length) {
            const msg         = value.messages[0]
            const phone       = msg.from
            const contact     = value.contacts?.[0]
            const contactName = contact?.profile?.name || phone
            const profilePic  = contact?.profile?.picture_url || null
            const ts          = parseInt(msg.timestamp) * 1000

            let text = '[non-text message]'
            if (msg.type === 'text')     text = msg.text?.body?.trim()       || ''
            if (msg.type === 'image')    text = '[Image]'    + (msg.image?.caption    ? ` — ${msg.image.caption}`    : '')
            if (msg.type === 'document') text = '[Document]' + (msg.document?.filename ? ` — ${msg.document.filename}` : '')
            if (msg.type === 'audio')    text = '[Voice message]'
            if (msg.type === 'video')    text = '[Video]'    + (msg.video?.caption    ? ` — ${msg.video.caption}`    : '')
            if (msg.type === 'location') text = '[Location shared]'
            if (msg.type === 'sticker')  text = '[Sticker]'
            if (msg.type === 'reaction') text = `Reacted: ${msg.reaction?.emoji || '?'}`

            const isNew = !conversations[phone]

            if (isNew) {
                conversations[phone] = {
                    phone,
                    name:            contactName,
                    profilePic:      profilePic,
                    messages:        [],
                    status:          'open',
                    unread:          0,
                    lastMessageTime: ts,
                    isManual:        false,
                }
            }

            const conv = conversations[phone]
            if (profilePic)  conv.profilePic      = profilePic
            conv.name            = contactName
            conv.lastMessageTime = ts
            conv.unread          = (conv.unread || 0) + 1

            const newMsg = { id: msg.id, text, direction: 'inbound', ts, status: null, type: msg.type }
            conv.messages.push(newMsg)

            // Persist to DB (async, non-blocking)
            saveConvToDB(conv)
            saveMsgToDB(phone, newMsg)

            emitToAll('wa_new_message', { phone, name: contactName, profilePic, message: newMsg })
            emitToAll('wa_conversations_update', Object.values(conversations))

            // ── Auto-reply for brand-new conversations ──────────────────────
            if (isNew && autoReplyConfig.enabled && autoReplyConfig.message?.trim()) {
                setTimeout(async () => {
                    try {
                        const msgId = await sendWAMessage(phone, autoReplyConfig.message)
                        const autoMsg = {
                            id:        msgId,
                            text:      autoReplyConfig.message,
                            direction: 'outbound',
                            ts:        Date.now(),
                            status:    'sent',
                        }
                        if (conversations[phone]) {
                            conversations[phone].messages.push(autoMsg)
                            conversations[phone].lastMessageTime = autoMsg.ts
                            saveConvToDB(conversations[phone])
                            saveMsgToDB(phone, autoMsg)
                        }
                        emitToAll('wa_conversations_update', Object.values(conversations))
                    } catch (err) {
                        console.error('Auto-reply failed:', err.message)
                    }
                }, 1500)
            }
        }
    } catch (err) {
        console.error('WhatsApp webhook error:', err.message)
    }
}

// ─── POST /superAdmin/whatsapp-agent/send ────────────────────────────────────
const sendAgentMessage = async (req, res) => {
    try {
        const { phone, message } = req.body
        if (!phone || !message) {
            return res.json(error('phone and message are required', STATUSCODE.VALIDATION_ERROR))
        }

        const messageId = await sendWAMessage(phone, message)
        const ts        = Date.now()

        if (!conversations[phone]) {
            conversations[phone] = {
                phone, name: phone, profilePic: null,
                messages: [], status: 'open', unread: 0, lastMessageTime: ts, isManual: false,
            }
        }

        const newMsg = { id: messageId, text: message, direction: 'outbound', ts, status: 'sent' }
        conversations[phone].messages.push(newMsg)
        conversations[phone].lastMessageTime = ts

        // Persist
        saveConvToDB(conversations[phone])
        saveMsgToDB(phone, newMsg)

        emitToAll('wa_conversations_update', Object.values(conversations))
        return res.json(success('Success', { messageId, message: newMsg }, STATUSCODE.SUCCESS))
    } catch (err) {
        const waErr = err.response?.data?.error?.message || err.message
        console.error('Send error:', waErr)
        return res.json(error(waErr || 'Failed to send', STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

// ─── POST /superAdmin/whatsapp-agent/send-template ──────────────────────────
// Used when the contact has not sent a message in the last 24 hours.
// Free-form session messages are blocked by WhatsApp in that case;
// only pre-approved templates can open (or re-open) the conversation.
const sendTemplateFromAgent = async (req, res) => {
    try {
        const { phone, template_id, values } = req.body
        if (!phone || !template_id || !Array.isArray(values)) {
            return res.json(error('phone, template_id and values[] are required', STATUSCODE.VALIDATION_ERROR))
        }

        const template = await WhatsappTemplate.findByPk(template_id)
        if (!template || !template.active) {
            return res.json(error('Template not found or inactive', STATUSCODE.VALIDATION_ERROR))
        }
        if (values.length !== template.params.length) {
            return res.json(error(
                `Template requires ${template.params.length} parameter(s)`,
                STATUSCODE.VALIDATION_ERROR
            ))
        }

        const bodyParameters = values.map((val, i) => ({
            type: template.params[i]?.type || 'text',
            text: String(val),
        }))

        let headerComponent = { type: 'header', parameters: [] }
        if (template.default_image) {
            headerComponent = {
                type: 'header',
                parameters: [{ type: 'image', image: { link: template.default_image } }],
            }
        }

        const waPayload = {
            messaging_product: 'whatsapp',
            to: phone,
            type: 'template',
            template: {
                name: template.name,
                language: { code: 'en' },
                components: [
                    headerComponent,
                    { type: 'body', parameters: bodyParameters },
                ],
            },
        }

        const waRes = await axios.post(
            `https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`,
            waPayload,
            {
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${TOKEN}`,
                },
            }
        )

        const messageId = waRes.data?.messages?.[0]?.id || `local-${Date.now()}`
        const ts = Date.now()

        // Build a readable text preview of the template for the conversation
        let previewText = `[Template: ${template.name}]`
        if (values.length) {
            previewText += ` — ${values.join(', ')}`
        }

        if (!conversations[phone]) {
            conversations[phone] = {
                phone, name: phone, profilePic: null,
                messages: [], status: 'open', unread: 0, lastMessageTime: ts, isManual: false,
            }
        }

        const newMsg = { id: messageId, text: previewText, direction: 'outbound', ts, status: 'sent', type: 'template' }
        conversations[phone].messages.push(newMsg)
        conversations[phone].lastMessageTime = ts

        saveConvToDB(conversations[phone])
        saveMsgToDB(phone, newMsg)
        emitToAll('wa_conversations_update', Object.values(conversations))

        return res.json(success('Template sent', { messageId, message: newMsg }, STATUSCODE.SUCCESS))
    } catch (err) {
        const waErr = err.response?.data?.error?.message || err.message
        console.error('Template send error:', waErr)
        return res.json(error(waErr || 'Failed to send template', STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

// ─── POST /superAdmin/whatsapp-agent/bulk-send ───────────────────────────────
const bulkSend = async (req, res) => {
    try {
        const { phones, message } = req.body
        if (!Array.isArray(phones) || !phones.length || !message) {
            return res.json(error('phones array and message are required', STATUSCODE.VALIDATION_ERROR))
        }

        const results = []

        for (const phone of phones) {
            try {
                const msgId = await sendWAMessage(phone, message)
                const ts = Date.now()

                if (!conversations[phone]) {
                    conversations[phone] = {
                        phone, name: phone, profilePic: null,
                        messages: [], status: 'open', unread: 0, lastMessageTime: ts, isManual: false,
                    }
                }
                const newMsg = { id: msgId, text: message, direction: 'outbound', ts, status: 'sent' }
                conversations[phone].messages.push(newMsg)
                conversations[phone].lastMessageTime = ts

                saveConvToDB(conversations[phone])
                saveMsgToDB(phone, newMsg)

                results.push({ phone, success: true })
                await new Promise(r => setTimeout(r, 250))
            } catch (err) {
                results.push({
                    phone,
                    success: false,
                    error:   err.response?.data?.error?.message || err.message,
                })
            }
        }

        emitToAll('wa_conversations_update', Object.values(conversations))

        const sent   = results.filter(r => r.success).length
        const failed = results.filter(r => !r.success).length
        return res.json(success('Success', { results, sent, failed }, STATUSCODE.SUCCESS))
    } catch (err) {
        return res.json(error(err.message || 'Bulk send failed', STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

// ─── POST /superAdmin/whatsapp-agent/contacts  (add manual contact) ──────────
const addManualContact = async (req, res) => {
    try {
        const { phone, name } = req.body
        if (!phone) {
            return res.json(error('phone is required', STATUSCODE.VALIDATION_ERROR))
        }

        // Normalise: strip spaces, dashes, parens (keep leading +)
        const cleanPhone = phone.replace(/[\s\-\(\)]/g, '')
        if (!/^\+?\d{7,15}$/.test(cleanPhone)) {
            return res.json(error('Invalid phone number format', STATUSCODE.VALIDATION_ERROR))
        }

        if (conversations[cleanPhone]) {
            return res.json(error('Contact already exists', STATUSCODE.CONFLICT))
        }

        const ts          = Date.now()
        const contactName = (name || '').trim() || cleanPhone

        const newConv = {
            phone:           cleanPhone,
            name:            contactName,
            profilePic:      null,
            messages:        [],
            status:          'open',
            unread:          0,
            lastMessageTime: ts,
            isManual:        true,
        }

        // Persist to DB first
        await WaConversation.create({
            phone:           cleanPhone,
            name:            contactName,
            status:          'open',
            unread:          0,
            lastMessageTime: ts,
            isManual:        true,
        })

        conversations[cleanPhone] = newConv
        emitToAll('wa_conversations_update', Object.values(conversations))

        return res.json(success('Contact added', newConv, STATUSCODE.CREATED))
    } catch (err) {
        if (err.name === 'SequelizeUniqueConstraintError') {
            return res.json(error('Contact already exists', STATUSCODE.CONFLICT))
        }
        return res.json(error(err.message || 'Failed to add contact', STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

// ─── DELETE /superAdmin/whatsapp-agent/contacts/:phone ───────────────────────
const deleteContact = async (req, res) => {
    try {
        const { phone } = req.params

        if (!conversations[phone]) {
            return res.json(error('Contact not found', STATUSCODE.NOT_FOUND))
        }

        // Delete from DB
        await WaConversation.destroy({ where: { phone } })
        await WaMessage.destroy({ where: { phone } })

        delete conversations[phone]
        emitToAll('wa_conversations_update', Object.values(conversations))

        return res.json(success('Contact deleted', { phone }, STATUSCODE.SUCCESS))
    } catch (err) {
        return res.json(error(err.message || 'Failed to delete', STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

// ─── PATCH /superAdmin/whatsapp-agent/conversations/:phone/status ────────────
const updateConvStatus = (req, res) => {
    const { phone }             = req.params
    const { status: newStatus } = req.body
    const allowed = ['open', 'pending', 'resolved']

    if (!allowed.includes(newStatus)) {
        return res.json(error('Status must be open, pending, or resolved', STATUSCODE.VALIDATION_ERROR))
    }
    if (!conversations[phone]) {
        return res.json(error('Conversation not found', STATUSCODE.NOT_FOUND))
    }
    conversations[phone].status = newStatus

    WaConversation.update({ status: newStatus }, { where: { phone } })
        .catch(e => console.error('[WA Agent] status update error:', e.message))

    emitToAll('wa_conversations_update', Object.values(conversations))
    return res.json(success('Success', { phone, status: newStatus }, STATUSCODE.SUCCESS))
}

// ─── POST /superAdmin/whatsapp-agent/conversations/:phone/read ───────────────
const markConvRead = (req, res) => {
    const { phone } = req.params
    if (conversations[phone]) {
        conversations[phone].unread = 0
        WaConversation.update({ unread: 0 }, { where: { phone } })
            .catch(e => console.error('[WA Agent] markRead error:', e.message))
    }
    emitToAll('wa_conversations_update', Object.values(conversations))
    return res.json(success('Success', { phone }, STATUSCODE.SUCCESS))
}

// ─── GET /superAdmin/whatsapp-agent/auto-reply ───────────────────────────────
const getAutoReply = (_req, res) => {
    return res.json(success('Success', autoReplyConfig, STATUSCODE.SUCCESS))
}

// ─── POST /superAdmin/whatsapp-agent/auto-reply ──────────────────────────────
const setAutoReply = (req, res) => {
    const { enabled, message } = req.body
    if (typeof enabled === 'boolean') autoReplyConfig.enabled = enabled
    if (typeof message === 'string')  autoReplyConfig.message = message
    return res.json(success('Success', autoReplyConfig, STATUSCODE.SUCCESS))
}

module.exports = {
    getConversations,
    handleWebhookVerify,
    handleWebhookMessage,
    sendAgentMessage,
    sendTemplateFromAgent,
    bulkSend,
    addManualContact,
    deleteContact,
    updateConvStatus,
    markConvRead,
    getAutoReply,
    setAutoReply,
    sendWAMessage,
}
