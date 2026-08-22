const { Op } = require("sequelize")
const { STATUSCODE, MESSAGE } = require("../../constant/const")
const { error, success } = require("../../responce/res")
const { CrmEmployeeProfile, superAdminModel } = require("../../model")

const EMPLOYEE_TYPES = ["manager", "calling_executive", "demo_executive", "followup_executive", "onboarding_executive", "support_executive"]

const withUser = () => ({ model: superAdminModel, as: "user", attributes: ["id", "name", "number"] })

// GET /crm/employees — Admin sees everyone, Manager sees self + direct reports
const listEmployees = async (req, res) => {
    try {
        const where = {}
        if (!req.crmProfile.isAdmin) {
            if (req.crmProfile.employee_type !== "manager") return res.json(error(MESSAGE.NOT_ACCESS, STATUSCODE.FORBIDDEN))
            where[Op.or] = [{ id: req.crmProfile.id }, { manager_id: req.crmProfile.id }]
        }

        const employees = await CrmEmployeeProfile.findAll({
            where,
            include: [withUser(), { model: CrmEmployeeProfile, as: "manager", attributes: ["id"], include: [withUser()] }],
            order: [["createdAt", "DESC"]],
        })

        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { employees }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err, "Error::: listEmployees")
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

// POST /crm/employees — Admin only — body: { superAdmin_user_id, employee_type, manager_id, daily_capacity }
const createEmployeeProfile = async (req, res) => {
    try {
        const { superAdmin_user_id, employee_type, manager_id, daily_capacity } = req.body

        if (!superAdmin_user_id || !employee_type) return res.json(error("superAdmin_user_id and employee_type are required", STATUSCODE.BAD_REQUEST))
        if (!EMPLOYEE_TYPES.includes(employee_type)) return res.json(error("Invalid employee_type value", STATUSCODE.BAD_REQUEST))

        const userExists = await superAdminModel.findByPk(superAdmin_user_id)
        if (!userExists) return res.json(error("Super admin user not found", STATUSCODE.NOT_FOUND))

        const existingProfile = await CrmEmployeeProfile.findOne({ where: { superAdmin_user_id } })
        if (existingProfile) return res.json(error("This user already has a CRM profile", STATUSCODE.CONFLICT))

        const profile = await CrmEmployeeProfile.create({ superAdmin_user_id, employee_type, manager_id, daily_capacity })

        return res.status(STATUSCODE.CREATED).json(success(MESSAGE.SUCCESS, { profile, message: "CRM Employee Profile Created Successfully" }, STATUSCODE.CREATED))
    } catch (err) {
        console.log(err, "Error::: createEmployeeProfile")
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

// PUT /crm/employees/:id — Admin only — body: { employee_type, manager_id, daily_capacity, is_active }
const updateEmployeeProfile = async (req, res) => {
    try {
        const { id } = req.params
        const { employee_type, manager_id, daily_capacity, is_active } = req.body

        if (employee_type && !EMPLOYEE_TYPES.includes(employee_type)) return res.json(error("Invalid employee_type value", STATUSCODE.BAD_REQUEST))

        const profile = await CrmEmployeeProfile.findByPk(id)
        if (!profile) return res.json(error("CRM Employee Profile Not Found", STATUSCODE.NOT_FOUND))

        await profile.update({ employee_type, manager_id, daily_capacity, is_active })

        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { profile, message: "CRM Employee Profile Updated Successfully" }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err, "Error::: updateEmployeeProfile")
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

// GET /crm/employees/:id/team — direct reports of a manager (Admin or that manager only)
const getTeam = async (req, res) => {
    try {
        const { id } = req.params

        if (!req.crmProfile.isAdmin && Number(id) !== req.crmProfile.id) {
            return res.json(error(MESSAGE.NOT_ACCESS, STATUSCODE.FORBIDDEN))
        }

        const team = await CrmEmployeeProfile.findAll({ where: { manager_id: id }, include: [withUser()], order: [["createdAt", "DESC"]] })

        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { team }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err, "Error::: getTeam")
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

module.exports = { listEmployees, createEmployeeProfile, updateEmployeeProfile, getTeam, EMPLOYEE_TYPES }
