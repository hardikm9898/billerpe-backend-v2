const { CrmLeadActivity } = require("../../model")

// Single funnel for writing to the lead activity timeline (crm_lead_activity_msts).
// Status changes, assignments, notes, calls, demos, and payment updates all log
// through here so the timeline stays complete and consistently shaped.
const logActivity = (leadId, actorId, activityType, { oldValue = null, newValue = null, description = null, metadata = {} } = {}) => {
    return CrmLeadActivity.create({
        lead_id: leadId,
        actor_id: actorId,
        activity_type: activityType,
        old_value: oldValue,
        new_value: newValue,
        description,
        metadata,
    })
}

module.exports = { logActivity }
