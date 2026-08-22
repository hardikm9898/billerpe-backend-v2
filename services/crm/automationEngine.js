const { Op } = require("sequelize")
const {
    CrmAutomationRule,
    CrmAutomationLog,
    CrmLead,
    CrmDemoSchedule,
    CrmPaymentTracking,
    CrmLeadActivity,
    CrmTask,
    CrmEmployeeProfile,
} = require("../../model")
const { logActivity } = require("./leadActivityLogger")
const { notify } = require("./notificationService")
const { sendWAMessage } = require("../../controller/whatsappAgentController")

const hoursAgo = (h) => new Date(Date.now() - Number(h || 0) * 60 * 60 * 1000)
const daysFromNow = (d) => new Date(Date.now() + Number(d || 0) * 24 * 60 * 60 * 1000)

const leadsById = async (ids) => {
    if (!ids.length) return []
    return CrmLead.findAll({ where: { id: { [Op.in]: [...new Set(ids)] }, deleted: false } })
}

// ── Trigger matchers — each returns the CrmLead rows the rule should act on ─────

// Leads sitting in NEW/ASSIGNED with no call/whatsapp activity logged within `hours`
const matchLeadNotContacted = async (condition) => {
    const cutoff = hoursAgo(condition?.hours ?? 24)
    const staleLeads = await CrmLead.findAll({
        where: { status: { [Op.in]: ["NEW", "ASSIGNED"] }, deleted: false, updatedAt: { [Op.lte]: cutoff } },
        attributes: ["id"],
    })
    if (!staleLeads.length) return []

    const contactedLeadIds = await CrmLeadActivity.findAll({
        where: {
            lead_id: { [Op.in]: staleLeads.map((l) => l.id) },
            activity_type: { [Op.in]: ["call", "whatsapp"] },
            createdAt: { [Op.gte]: cutoff },
        },
        attributes: ["lead_id"],
        group: ["lead_id"],
    })
    const contactedSet = new Set(contactedLeadIds.map((a) => a.lead_id))
    return leadsById(staleLeads.map((l) => l.id).filter((id) => !contactedSet.has(id)))
}

// Leads with a demo scheduled more than `hours` ago that still has no recorded outcome
const matchDemoNoResponse = async (condition) => {
    const cutoff = hoursAgo(condition?.hours ?? 24)
    const demos = await CrmDemoSchedule.findAll({
        where: { scheduled_at: { [Op.lte]: cutoff }, outcome: null },
        attributes: ["lead_id"],
    })
    return leadsById(demos.map((d) => d.lead_id))
}

// Leads whose payment is still pending and due within (or already past) `days`
const matchPaymentPendingReminder = async (condition) => {
    const cutoff = daysFromNow(condition?.days ?? 2)
    const payments = await CrmPaymentTracking.findAll({
        where: {
            stage: { [Op.in]: ["proposal_sent", "negotiation", "approval_pending", "payment_pending"] },
            due_date: { [Op.ne]: null, [Op.lte]: cutoff },
        },
        attributes: ["lead_id"],
    })
    return leadsById(payments.map((p) => p.lead_id))
}

const MATCHERS = {
    lead_not_contacted: matchLeadNotContacted,
    demo_no_response: matchDemoNoResponse,
    payment_pending_reminder: matchPaymentPendingReminder,
}

// ── Action executors — each performs the configured action on a matched lead ────

const actionNotifyManager = async (lead, config) => {
    if (!lead.assigned_to) return "skipped: lead has no assignee"
    const assignee = await CrmEmployeeProfile.findByPk(lead.assigned_to, { attributes: ["manager_id"] })
    const managerId = assignee?.manager_id
    if (!managerId) return "skipped: assignee has no manager"
    await notify(managerId, "automation_alert", config?.title || "Lead needs attention", {
        body: config?.body || `Lead "${lead.name || lead.phone_number}" needs follow-up`,
        leadId: lead.id,
    })
    return `notified manager #${managerId}`
}

const actionCreateTask = async (lead, config) => {
    const dueAt = new Date(Date.now() + Number(config?.due_in_hours ?? 4) * 60 * 60 * 1000)
    const task = await CrmTask.create({
        lead_id: lead.id,
        assigned_to: lead.assigned_to || null,
        task_type: config?.task_type || "followup",
        due_at: dueAt,
        notes: config?.notes || "Auto-created by automation rule",
    })
    if (lead.assigned_to) {
        await notify(lead.assigned_to, "task_assigned", "New automated task assigned to you", { body: task.notes, leadId: lead.id })
    }
    return `created task #${task.id}`
}

const actionSendWhatsapp = async (lead, config) => {
    if (!lead.phone_number) return "skipped: lead has no phone number"
    const message = (config?.message || "Hi {{name}}, just checking in on your enquiry.").replace(/\{\{\s*name\s*\}\}/gi, lead.name || "there")
    await sendWAMessage(lead.phone_number, message)
    return "sent WhatsApp message"
}

const actionChangePriority = async (lead, config) => {
    const priority = config?.priority
    if (!["P1", "P2", "P3", "P4"].includes(priority)) return "skipped: invalid priority in config"
    const old = lead.priority
    await lead.update({ priority })
    return `priority changed ${old} -> ${priority}`
}

const ACTIONS = {
    notify_manager: actionNotifyManager,
    create_task: actionCreateTask,
    send_whatsapp: actionSendWhatsapp,
    change_priority: actionChangePriority,
}

// ── Orchestration ────────────────────────────────────────────────────────────────

// A rule only ever acts on a given lead once — prevents repeat WhatsApp/notification
// spam on every cron tick. Once it has fired for a lead, a human takes over from there.
const alreadyExecuted = async (ruleId, leadId) => {
    const log = await CrmAutomationLog.findOne({ where: { rule_id: ruleId, lead_id: leadId } })
    return !!log
}

const runRule = async (rule) => {
    const matcher = MATCHERS[rule.trigger_type]
    const action = ACTIONS[rule.action_type]
    if (!matcher || !action) return

    const leads = await matcher(rule.trigger_condition)
    for (const lead of leads) {
        if (await alreadyExecuted(rule.id, lead.id)) continue

        let result
        try {
            result = await action(lead, rule.action_config)
            await logActivity(lead.id, null, "system", { description: `Automation "${rule.name}" executed: ${result}` })
        } catch (err) {
            result = `error: ${err.message}`
        }
        await CrmAutomationLog.create({ rule_id: rule.id, lead_id: lead.id, executed_at: new Date(), result, details: { trigger_type: rule.trigger_type, action_type: rule.action_type } })
    }
}

const runAutomationRules = async () => {
    const rules = await CrmAutomationRule.findAll({ where: { is_active: true } })
    for (const rule of rules) {
        try {
            await runRule(rule)
        } catch (err) {
            console.error(`[Automation] rule #${rule.id} (${rule.name}) failed:`, err.message)
        }
    }
}

module.exports = { runAutomationRules }
