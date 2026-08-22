const { CrmNotification } = require("../../model")

// Creates an in-app CRM notification for a CrmEmployeeProfile.
// recipientProfileId must be a crm_employee_profile_msts id (not a superAdmin user id).
const notify = (recipientProfileId, type, title, { body = null, leadId = null, link = null } = {}) => {
    if (!recipientProfileId) return null
    return CrmNotification.create({
        recipient_id: recipientProfileId,
        type,
        title,
        body,
        link,
        lead_id: leadId,
    })
}

module.exports = { notify }
