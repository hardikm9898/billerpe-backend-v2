const crypto = require("crypto")
const { CrmLead, CrmMetaLeadSyncLog } = require("../../model")
const { logActivity } = require("../../services/crm/leadActivityLogger")
const { fetchLeadData, mapFieldData } = require("../../services/crm/metaGraphApi")

const VERIFY_TOKEN = process.env.META_VERIFY_TOKEN
const APP_SECRET = process.env.META_APP_SECRET

// ─── GET /crm/meta/webhook  (Meta verification handshake) ───────────────────
const verifyWebhook = (req, res) => {
    const mode = req.query["hub.mode"]
    const token = req.query["hub.verify_token"]
    const challenge = req.query["hub.challenge"]
    if (mode === "subscribe" && token === VERIFY_TOKEN) {
        return res.status(200).send(challenge)
    }
    return res.status(403).send("Forbidden")
}

// Meta signs every POST body with the App Secret — reject anything that doesn't match
// so randoms can't forge lead-creation requests against this public endpoint.
const isValidSignature = (req) => {
    if (!APP_SECRET) return true // signature checking is opt-in until the secret is configured
    const signature = req.get("x-hub-signature-256") || ""
    const expected = "sha256=" + crypto.createHmac("sha256", APP_SECRET).update(req.rawBody || Buffer.alloc(0)).digest("hex")
    if (signature.length !== expected.length) return false
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
}

// Processes a single `leadgen` change entry: dedupe -> fetch full lead data -> create CRM lead.
const processLeadgenChange = async (change, pageId) => {
    const leadgenId = String(change.value?.leadgen_id || "")
    if (!leadgenId) return

    const [syncLog, created] = await CrmMetaLeadSyncLog.findOrCreate({
        where: { meta_lead_id: leadgenId },
        defaults: {
            meta_lead_id: leadgenId,
            page_id: pageId || change.value?.page_id || null,
            form_id: change.value?.form_id || null,
            ad_id: change.value?.ad_id || null,
            raw_payload: change,
            received_at: new Date(),
        },
    })

    // Meta retries webhook deliveries — skip anything we've already turned into a lead.
    if (!created && syncLog.processed) return

    const leadData = await fetchLeadData(leadgenId)
    const { name, phone_number, email } = mapFieldData(leadData.field_data)
    if (!phone_number) return // CrmLead requires phone_number; nothing usable to create

    const lead = await CrmLead.create({
        name,
        phone_number,
        email,
        source: leadData.platform === "instagram" ? "meta_instagram" : "meta_facebook",
        campaign_name: leadData.campaign_name || null,
        adset_name: leadData.adset_name || null,
        ad_name: leadData.ad_name || null,
        lead_form_name: leadData.form_id || null,
        source_lead_id: leadgenId,
        status: "NEW",
        priority: "P3",
    })

    await syncLog.update({
        page_id: pageId || syncLog.page_id,
        form_id: leadData.form_id || syncLog.form_id,
        campaign_id: leadData.campaign_id || syncLog.campaign_id,
        adset_id: leadData.adset_id || syncLog.adset_id,
        ad_id: leadData.ad_id || syncLog.ad_id,
        raw_payload: { ...change, leadData },
        processed: true,
        crm_lead_id: lead.id,
    })

    await logActivity(lead.id, null, "system", { description: "Lead received from Meta Ads", metadata: { leadgen_id: leadgenId, source: lead.source } })
}

// ─── POST /crm/meta/webhook  (Incoming leadgen notifications from Meta) ─────
const receiveLeadEvent = (req, res) => {
    res.sendStatus(200) // acknowledge immediately — Meta retries on slow/non-200 responses

    if (!isValidSignature(req)) {
        console.error("[Meta Webhook] Invalid signature — ignoring payload")
        return
    }

    const body = req.body
    if (body?.object !== "page") return

    for (const entry of body.entry || []) {
        for (const change of entry.changes || []) {
            if (change.field !== "leadgen") continue
            processLeadgenChange(change, entry.id).catch((err) => {
                const leadgenId = change.value?.leadgen_id
                // axios errors from the Graph API hide the real reason (bad/expired token,
                // missing permission, lead too old, ...) inside err.response.data.error —
                // err.message alone is just "Request failed with status code 400".
                if (err.response) {
                    console.error(`[Meta Webhook] processLeadgenChange error (leadgen_id=${leadgenId}) — Graph API responded ${err.response.status}:`)
                    console.error(JSON.stringify(err.response.data, null, 2))
                    console.error(`URL: ${err.config?.method?.toUpperCase()} ${err.config?.url}`)
                } else {
                    console.error(`[Meta Webhook] processLeadgenChange error (leadgen_id=${leadgenId}):`, err.message)
                    console.error(err.stack)
                }
            })
        }
    }
}

module.exports = { verifyWebhook, receiveLeadEvent }
