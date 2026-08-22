const express = require("express")
const router = express.Router()

const { adminAuth } = require("../middleware/adminAuth")

const { createPromoCode, updatePromoCode, getAllPromoCode } = require("../controller/discountPromocode")


router.post("/create", adminAuth, createPromoCode)
router.put("/update", adminAuth, updatePromoCode)
router.get("/getAll", adminAuth, getAllPromoCode)

module.exports = router