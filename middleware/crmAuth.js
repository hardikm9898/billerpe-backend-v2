const { STATUSCODE, MESSAGE } = require("../constant/const")
const { error } = require("../responce/res")
const { superAdminModel, CrmEmployeeProfile } = require("../model")

// Runs after superAdminAuth (which sets req.user = hms_superAdmin_users.id).
// Attaches req.crmProfile so controllers can scope data by role:
//   - role "Admin" on the superAdmin account -> full CRM access, no profile required
//   - role "User" -> must have an active CrmEmployeeProfile to use any /crm route
const loadCrmProfile = async (req, res, next) => {
    try {
        const admin = await superAdminModel.findOne({ where: { id: req.user } })
        if (!admin) return res.json(error(MESSAGE.NOT_AUTHORIZE, STATUSCODE.FORBIDDEN))

        if (admin.role === "Admin") {
            req.crmProfile = { isAdmin: true, employee_type: "admin" }
            return next()
        }

        const profile = await CrmEmployeeProfile.findOne({ where: { superAdmin_user_id: req.user, is_active: true } })
        if (!profile) return res.json(error("CRM access is not configured for this user", STATUSCODE.FORBIDDEN))

        req.crmProfile = {
            isAdmin: false,
            id: profile.id,
            employee_type: profile.employee_type,
            manager_id: profile.manager_id,
        }
        next()
    } catch (err) {
        console.log(err, "Error::: loadCrmProfile")
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

// Restricts a route to Admins plus the given CRM employee_types (e.g. "manager").
const requireCrmRole = (...allowedTypes) => (req, res, next) => {
    if (req.crmProfile?.isAdmin || allowedTypes.includes(req.crmProfile?.employee_type)) {
        return next()
    }
    return res.json(error(MESSAGE.NOT_ACCESS, STATUSCODE.FORBIDDEN))
}

module.exports = { loadCrmProfile, requireCrmRole }
