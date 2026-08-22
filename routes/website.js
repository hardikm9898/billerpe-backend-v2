const express = require("express")
const router = express.Router()


const { validator } = require("../middleware/validator")
const { websiteUserSchema, purchaseValidationSchema, websitePurchasevalidation, websitePurchaseUpdateValidation, planPurchaseValidation, websitePurchasevalidation1 } = require("../validation/validate")
const { storeWebsiteUserData } = require("../controller/webiste/user")
const { createRollAndPrinterPurchase, updateTempRestaurantData, createTempRestaurantData, checkCoupenCode, genreratePaymentLink, gettingproductsData, gettingproductsDataWebSite } = require("../controller/websitePurchase/purchase")
const superAdminAuth = require("../middleware/superAdminAuth")

router.post("/websiteUser", validator(websiteUserSchema), storeWebsiteUserData)

router.post("/rollPrinter", validator(purchaseValidationSchema), createRollAndPrinterPurchase)
router.post("/buyplan", validator(websitePurchasevalidation), createTempRestaurantData)
router.post("/buyplan1", validator(websitePurchasevalidation1), createTempRestaurantData)
router.put("/buyPlan", validator(websitePurchaseUpdateValidation), updateTempRestaurantData)
router.post("/checkCoupenCode", checkCoupenCode)
router.post("/generatePaymentLink", validator(planPurchaseValidation), genreratePaymentLink)
router.get("/gettingPtoducts-website", gettingproductsDataWebSite)
router.get("/gettingPtoducts", superAdminAuth, gettingproductsData)

module.exports = router