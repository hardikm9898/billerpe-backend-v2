const express = require("express")
const { adminAuth, mobileAuth } = require("../middleware/adminAuth")

const router = express.Router()

const { gereratePaymentLink, verifyPaymentGeneratedLink, deactivatePaymentLink, getAllActiveLinkes, createPhonePePayment, verifyPhonePePayment, webHook, generatePaymentHashId, generateMobilePaymentLink, createPhonePePaymentWebSite, verifyPhonePePaymentForWebSite, verifyPhonePePaymentForPrinterRoll, createPhonePePaymentWebSiteFroRll } = require("../controller/Subscription/payment")
const superAdminAuth = require("../middleware/superAdminAuth")
const { webSitePayment } = require("./paymenttest")
const { generateHashId } = require("../controller/kto")
const { create } = require("pdf-creator-node")


//! Expense Routes

router.post("/createOrder", createPhonePePayment)
router.post("/createOrderWebSite", createPhonePePaymentWebSite)
router.post("/createPhonePePaymentWebSiteFroRll", createPhonePePaymentWebSiteFroRll)
router.post("/generatePaymentHashId", adminAuth, generatePaymentHashId)
router.post("/verifyPayment", verifyPhonePePayment)
router.post("/verifyPaymentForWebsite", verifyPhonePePaymentForWebSite)
router.post("/verifyPhonePePaymentForPrinterRoll", verifyPhonePePaymentForPrinterRoll)

router.post("/generatePaymentLink", superAdminAuth, gereratePaymentLink)
// router.post("/generatePaymentLink", gereratePaymentLink)
// router.post("/verifyPaymentGeneratedLink", superAdminAuth, verifyPaymentGeneratedLink)
router.post("/verifyPaymentGeneratedLink", verifyPaymentGeneratedLink)

router.post("/deactivatePaymentLink", superAdminAuth, deactivatePaymentLink)
router.get("/getAllActiveLinkes", superAdminAuth, getAllActiveLinkes)
router.post("/webhook", webHook)
// router.get("/websitePayment", webSitePayment)
router.post("/generateMobilePaymentLink", mobileAuth, generateMobilePaymentLink)

// router.post("/deactivatePaymentLink", deactivatePaymentLink)

module.exports = router