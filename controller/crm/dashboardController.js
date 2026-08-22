const { Op, fn, col, literal } = require("sequelize")
const { STATUSCODE, MESSAGE } = require("../../constant/const")
const { error, success } = require("../../responce/res")
const {
    CrmLead,
    CrmEmployeeProfile,
    CrmTask,
    CrmDemoSchedule,
    CrmWhatsappCampaign,
    superAdminModel,
} = require("../../model")

// GET /crm/dashboard — aggregated metrics for Admin overview
const getDashboard = async (_req, res) => {
    try {
        const now = new Date()
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
        const startOfWeek = new Date(startOfToday)
        startOfWeek.setDate(startOfToday.getDate() - startOfToday.getDay())

        // ── KPI counts ────────────────────────────────────────────────────────
        const [totalLeads, newToday, newThisWeek, converted, lost] = await Promise.all([
            CrmLead.count({ where: { deleted: false } }),
            CrmLead.count({ where: { deleted: false, createdAt: { [Op.gte]: startOfToday } } }),
            CrmLead.count({ where: { deleted: false, createdAt: { [Op.gte]: startOfWeek } } }),
            CrmLead.count({ where: { deleted: false, status: "CONVERTED" } }),
            CrmLead.count({ where: { deleted: false, status: "LOST" } }),
        ])

        const [openTasks, demosToday] = await Promise.all([
            CrmTask.count({ where: { status: { [Op.notIn]: ["completed", "cancelled"] } } }),
            CrmDemoSchedule.count({
                where: {
                    scheduled_at: { [Op.gte]: startOfToday, [Op.lt]: new Date(startOfToday.getTime() + 86400000) },
                    outcome: null,
                },
            }),
        ])

        // ── Lead funnel: count per status ──────────────────────────────────────
        const funnelRows = await CrmLead.findAll({
            where: { deleted: false },
            attributes: ["status", [fn("COUNT", col("id")), "count"]],
            group: ["status"],
            raw: true,
        })
        const funnel = funnelRows.map((r) => ({ status: r.status, count: Number(r.count) }))

        // ── Source breakdown ────────────────────────────────────────────────────
        const sourceRows = await CrmLead.findAll({
            where: { deleted: false },
            attributes: ["source", [fn("COUNT", col("id")), "count"]],
            group: ["source"],
            raw: true,
        })
        const sources = sourceRows.map((r) => ({ source: r.source, count: Number(r.count) }))

        // ── Priority breakdown (open leads only) ───────────────────────────────
        const priorityRows = await CrmLead.findAll({
            where: { deleted: false, status: { [Op.notIn]: ["CONVERTED", "LOST", "FAKE_LEAD"] } },
            attributes: ["priority", [fn("COUNT", col("id")), "count"]],
            group: ["priority"],
            raw: true,
        })
        const priorities = priorityRows.map((r) => ({ priority: r.priority, count: Number(r.count) }))

        // ── Agent leaderboard ──────────────────────────────────────────────────
        const agents = await CrmEmployeeProfile.findAll({
            where: { is_active: true },
            attributes: ["id", "employee_type"],
            include: [{ model: superAdminModel, as: "user", attributes: ["name"] }],
        })

        const agentLeaderboard = await Promise.all(
            agents.map(async (agent) => {
                const [assigned, convertedCount] = await Promise.all([
                    CrmLead.count({ where: { deleted: false, assigned_to: agent.id } }),
                    CrmLead.count({ where: { deleted: false, assigned_to: agent.id, status: "CONVERTED" } }),
                ])
                return {
                    id: agent.id,
                    name: agent.user?.name || "Unknown",
                    employee_type: agent.employee_type,
                    assigned,
                    converted: convertedCount,
                    conversion_rate: assigned > 0 ? Math.round((convertedCount / assigned) * 100) : 0,
                }
            })
        )
        agentLeaderboard.sort((a, b) => b.converted - a.converted)

        // ── Campaign performance ────────────────────────────────────────────────
        const campaigns = await CrmWhatsappCampaign.findAll({
            attributes: ["id", "name", "status", "total_recipients", "sent_count", "failed_count", "createdAt"],
            order: [["createdAt", "DESC"]],
            limit: 10,
            raw: true,
        })

        return res.status(STATUSCODE.SUCCESS).json(
            success(MESSAGE.SUCCESS, {
                kpi: { totalLeads, newToday, newThisWeek, converted, lost, openTasks, demosToday },
                funnel,
                sources,
                priorities,
                agentLeaderboard,
                campaigns,
            }, STATUSCODE.SUCCESS)
        )
    } catch (err) {
        console.log(err, "Error::: getDashboard")
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

module.exports = { getDashboard }
