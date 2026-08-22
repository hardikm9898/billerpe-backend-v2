const express = require("express")
const router = express.Router()

const superAdminAuth = require("../middleware/superAdminAuth")
const { loadCrmProfile, requireCrmRole } = require("../middleware/crmAuth")

const { listLeads, getLeadDetail, createLead, updateLead, changeStatus, changePriority, softDeleteLead } = require("../controller/crm/leadController")
const { assignLead, bulkAssign, getUnassignedLeads, getAssignmentHistory } = require("../controller/crm/assignmentController")
const { getActivities, addNote } = require("../controller/crm/activityController")
const { listTasks, myTasks, createTask, updateTask } = require("../controller/crm/taskController")
const { logCall, getCallHistory } = require("../controller/crm/callLogController")
const { scheduleDemo, updateDemo, listDemos } = require("../controller/crm/demoController")
const { getPayment, upsertPayment } = require("../controller/crm/paymentController")
const { listEmployees, createEmployeeProfile, updateEmployeeProfile, getTeam } = require("../controller/crm/employeeController")
const { listNotifications, markRead, markAllRead, getUnreadCount } = require("../controller/crm/notificationController")
const { listAutomationRules, createAutomationRule, updateAutomationRule, getAutomationLogs } = require("../controller/crm/automationController")
const { sendLeadWhatsapp, getLeadWhatsappHistory, listTemplates, listCampaigns, createCampaign, getCampaign, sendCampaign } = require("../controller/crm/whatsappCrmController")
const { getDashboard } = require("../controller/crm/dashboardController")

// Every CRM route requires a valid super admin session + an active CRM profile (or Admin role)
router.use(superAdminAuth, loadCrmProfile)

// ── Leads ─────────────────────────────────────────────────────────────────
router.get("/leads/unassigned", getUnassignedLeads)
router.get("/leads/:id/activities", getActivities)
router.post("/leads/:id/activities", addNote)
router.get("/leads/:id/assignment-history", getAssignmentHistory)
router.post("/leads/:id/assign", assignLead)
router.get("/leads/:id/calls", getCallHistory)
router.post("/leads/:id/calls", logCall)
router.post("/leads/:id/demos", scheduleDemo)
router.get("/leads/:id/payment", getPayment)
router.put("/leads/:id/payment", upsertPayment)
router.patch("/leads/:id/status", changeStatus)
router.patch("/leads/:id/priority", changePriority)
router.post("/leads/bulk-assign", bulkAssign)
router.get("/leads", listLeads)
router.post("/leads", createLead)
router.get("/leads/:id", getLeadDetail)
router.put("/leads/:id", updateLead)
router.delete("/leads/:id", softDeleteLead)

// ── Tasks ─────────────────────────────────────────────────────────────────
router.get("/tasks/my", myTasks)
router.get("/tasks", listTasks)
router.post("/tasks", createTask)
router.patch("/tasks/:id", updateTask)

// ── Demos ─────────────────────────────────────────────────────────────────
router.get("/demos", listDemos)
router.patch("/demos/:id", updateDemo)

// ── Employees / Team ──────────────────────────────────────────────────────
// list: Admin sees all, Manager sees own team (enforced inside the controller)
// create/update profile: Admin only · team view: Admin or that manager
router.get("/employees", listEmployees)
router.post("/employees", requireCrmRole(), createEmployeeProfile)
router.put("/employees/:id", requireCrmRole(), updateEmployeeProfile)
router.get("/employees/:id/team", requireCrmRole("manager"), getTeam)

// ── Notifications ─────────────────────────────────────────────────────────
router.get("/notifications/unread-count", getUnreadCount)
router.get("/notifications", listNotifications)
router.patch("/notifications/read-all", markAllRead)
router.patch("/notifications/:id/read", markRead)

// ── Dashboard — Admin only ────────────────────────────────────────────────
router.get("/dashboard", requireCrmRole(), getDashboard)

// ── Automation rules — Admin only ─────────────────────────────────────────
router.get("/automation-rules", requireCrmRole(), listAutomationRules)
router.post("/automation-rules", requireCrmRole(), createAutomationRule)
router.put("/automation-rules/:id", requireCrmRole(), updateAutomationRule)
router.get("/automation-rules/:id/logs", requireCrmRole(), getAutomationLogs)

// ── WhatsApp CRM — per-lead ────────────────────────────────────────────────
router.get("/leads/:id/whatsapp", getLeadWhatsappHistory)
router.post("/leads/:id/whatsapp", sendLeadWhatsapp)

// ── WhatsApp campaigns — Admin only ───────────────────────────────────────
router.get("/whatsapp-templates", requireCrmRole(), listTemplates)
router.get("/whatsapp-campaigns", requireCrmRole(), listCampaigns)
router.post("/whatsapp-campaigns", requireCrmRole(), createCampaign)
router.get("/whatsapp-campaigns/:id", requireCrmRole(), getCampaign)
router.post("/whatsapp-campaigns/:id/send", requireCrmRole(), sendCampaign)

module.exports = router
