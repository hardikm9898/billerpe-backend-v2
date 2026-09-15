const express = require("express")
const router = express.Router()
const { addEbillCreditBySuperAdmin, getEbillCreditHistory, uploadMenuFromExcelBySuperAdmin, restaurantDetails, singleHotelSP, AllInquiry, superAdminLogin, checkSuperAdmin, superAdminDashBoardData, gettingupcomingRenuale, superAdminNewClientGraph, superAdminLogOut, saveAndNext, gettingPeddingAddRestoDetails, makePayment, deleteAddAdminResto, menuUploadedAndTrainingStatus, gettingPrinterRollOrders, updateOrderStatus, addProduct, editProduct, addImage, updateInqueryStatus, gettingSuperAdminUserList } = require("../controller/superAdmin")
const superAdminAuth = require("../middleware/superAdminAuth")
const { releaseLocalServer, listActiveLocalServers } = require("../controller/localServerRegistration")
const path = require("path")
const loginLimiter = require("../middleware/loginLimiter")
const upload = require("../middleware/upload")
const { uploadMultipleTest, uploadSingleTest, uploadWhatsAppTemplateImage } = require("../services/upload")
const { getImage, updateCostumerData } = require("../controller/user")
const { adminAuth } = require("../middleware/adminAuth")
const { generateTicketFromSuperAdmin } = require("../controller/TicketManagemnt/ticketManage")
const { sendWhatsappMessage, createWhatsAppTemplate, updateWhatsAppTemplate, sendBulkWhatsappMessage, getAllWhatsappTemplates, downloadSampleExcel } = require("../controller/smsService")

//! Expense Routes

// Architecture memo §7: only a SuperAdmin can release a restaurant's
// registered local server - restaurant users have no route to this at all.
router.post("/device/release", superAdminAuth, releaseLocalServer)
router.get("/device/list", superAdminAuth, listActiveLocalServers)

// Standalone utility page - no dedicated SuperAdmin frontend exists in this
// workspace (same situation as the Captain App), so this small
// self-contained page IS the actual release control for now. NOT gated by
// superAdminAuth itself (a static page load can't carry a useful error back
// to the browser the way an API call can) - the page's own JS calls the
// gated APIs above and shows a login form first if those calls come back
// unauthenticated, exactly like visiting it cold would require anyway.
router.get("/deviceAdmin", (_req, res) => {
    res.sendFile(path.join(__dirname, "..", "public", "device-admin.html"))
})

router.post("/superAdmin", superAdminAuth, restaurantDetails)
router.post("/gettingPrinterRollOrders", superAdminAuth, gettingPrinterRollOrders)
router.post("/updateOrderStatus", superAdminAuth, updateOrderStatus)
router.post("/menuStatusUpdate", superAdminAuth, menuUploadedAndTrainingStatus)
router.post("/singleHotelSP", superAdminAuth, singleHotelSP)
router.post("/superAdminInquiry", AllInquiry)
router.post("/updateInquiry", updateInqueryStatus)
router.post("/login", loginLimiter, superAdminLogin)
router.post("/logout", superAdminAuth, superAdminLogOut)
router.get("/checkSuperAdmin", superAdminAuth, checkSuperAdmin)
router.post("/superAdminDashBoardData", superAdminAuth, superAdminDashBoardData)
router.post("/superAdminNewClientGraph", superAdminAuth, superAdminNewClientGraph)
router.post("/gettingupcomingRenuale", superAdminAuth, gettingupcomingRenuale)
router.post("/saveandnext", superAdminAuth, saveAndNext)
router.get("/gettingPeddingAddRestoDetails", superAdminAuth, gettingPeddingAddRestoDetails)
router.post("/makePayment", superAdminAuth, upload.single('payment_image'), makePayment)
router.get("/deleteAddAdminResto", superAdminAuth, deleteAddAdminResto)
router.post("/product", superAdminAuth, uploadMultipleTest('images'), addProduct)
router.put("/product", superAdminAuth, uploadMultipleTest('images'), editProduct)
router.post("/image", uploadSingleTest('images'), addImage)
router.get("/list", superAdminAuth, gettingSuperAdminUserList)
router.post("/genererateTicket", superAdminAuth, generateTicketFromSuperAdmin)

router.post("/whatsapp/sendSingle", superAdminAuth, sendWhatsappMessage)
router.get("/whatsapp/tempate", superAdminAuth, getAllWhatsappTemplates)
// router.post("/whatsapp/template", superAdminAuth, uploadWhatsAppTemplateImage('image'), createWhatsAppTemplate)
router.post("/whatsapp/template", superAdminAuth, upload.single('image'), createWhatsAppTemplate)
router.post("/whatsapp/download/template", superAdminAuth, downloadSampleExcel)
// router.put("/whatsapp/template", superAdminAuth, uploadWhatsAppTemplateImage('image'), updateWhatsAppTemplate)
router.put("/whatsapp/template", superAdminAuth, upload.single('image'), updateWhatsAppTemplate)
router.post("/whatsapp/bulkmessage", superAdminAuth, upload.single("file"), sendBulkWhatsappMessage)
router.post("/uploadMenuFromExcel", superAdminAuth, upload.single("file"), uploadMenuFromExcelBySuperAdmin)
router.post("/ebillCredit", superAdminAuth, upload.single("payment_screenshot"), addEbillCreditBySuperAdmin)
router.get("/ebillCreditHistory", superAdminAuth, getEbillCreditHistory)

// ── WhatsApp Agent Dashboard ──────────────────────────────────────────────────
const { getConversations, handleWebhookVerify, handleWebhookMessage, sendAgentMessage, sendTemplateFromAgent, bulkSend, addManualContact, deleteContact, updateConvStatus, markConvRead, getAutoReply, setAutoReply } = require("../controller/whatsappAgentController")

// Public — Meta calls these (no auth)
router.get("/whatsapp-agent/webhook", handleWebhookVerify)
router.post("/whatsapp-agent/webhook", handleWebhookMessage)

// Authenticated — agent dashboard calls these
router.get("/whatsapp-agent/conversations", superAdminAuth, getConversations)
router.post("/whatsapp-agent/send", superAdminAuth, sendAgentMessage)
router.post("/whatsapp-agent/send-template", superAdminAuth, sendTemplateFromAgent)
router.post("/whatsapp-agent/bulk-send", superAdminAuth, bulkSend)
router.patch("/whatsapp-agent/conversations/:phone/status", superAdminAuth, updateConvStatus)
router.post("/whatsapp-agent/conversations/:phone/read", superAdminAuth, markConvRead)
router.get("/whatsapp-agent/auto-reply", superAdminAuth, getAutoReply)
router.post("/whatsapp-agent/auto-reply", superAdminAuth, setAutoReply)
router.post("/whatsapp-agent/contacts", superAdminAuth, addManualContact)
router.delete("/whatsapp-agent/contacts/:phone", superAdminAuth, deleteContact)


module.exports = router