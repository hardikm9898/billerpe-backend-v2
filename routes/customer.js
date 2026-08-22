const express = require("express")
const router = express.Router()

const { adminAuth } = require("../middleware/adminAuth")

const { createPromoCode, updatePromoCode, getAllPromoCode } = require("../controller/discountPromocode")
const { getNumberSuggestion, createCustomerData, updateCostumerData } = require("../controller/user")


router.post("/create", adminAuth, createCustomerData)
router.put("/update", adminAuth, updateCostumerData)
router.get("/getAll", adminAuth, getNumberSuggestion)

module.exports = router