const express = require("express")
const router = express.Router()

const { adminAuth, mobileAuth } = require("../middleware/adminAuth")

const { getActuleSubscriptionData, extentOneDay, validedSubscription, getAllPlan, renewSubscription, getAllPlansWithoutDiscount, extraOneDayForMobile } = require("../controller/Subscription/subscription")
const { getPreviousPlan, adminRenewSubscription } = require("../controller/Subscription/payment")
const superAdminAuth = require("../middleware/superAdminAuth")
const upload = require("../middleware/upload")

router.get("/getSubscription", adminAuth, getActuleSubscriptionData)
router.post("/extendDay", adminAuth, extentOneDay)
router.post("/extendDayMobile", mobileAuth, extraOneDayForMobile)
router.get("/checkSubscription", adminAuth, validedSubscription)
router.get("/getAllPlan", adminAuth, getAllPlan)
router.get("/getAllPlanWithoutDiscount", getAllPlansWithoutDiscount)
router.post("/renewSubscription", adminAuth, renewSubscription)
router.post("/getPreviousPlan", superAdminAuth, getPreviousPlan)
router.post("/adminRenewSubscription", superAdminAuth, upload.single('payment_image'), adminRenewSubscription)


module.exports = router