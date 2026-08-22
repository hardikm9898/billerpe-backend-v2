const { Op } = require("sequelize")
const { CrmEmployeeProfile } = require("../../model")

// Builds the Sequelize `where` fragment that scopes which leads a CRM user may see:
//   - Admin            -> {} (no restriction)
//   - Manager          -> own assigned leads + leads assigned to direct reports
//   - Other executives -> only their own assigned leads
const buildLeadScope = async (crmProfile) => {
    if (crmProfile.isAdmin) return {}

    if (crmProfile.employee_type === "manager") {
        const reports = await CrmEmployeeProfile.findAll({ where: { manager_id: crmProfile.id }, attributes: ["id"] })
        return { assigned_to: { [Op.in]: [crmProfile.id, ...reports.map((r) => r.id)] } }
    }

    return { assigned_to: crmProfile.id }
}

module.exports = { buildLeadScope }
