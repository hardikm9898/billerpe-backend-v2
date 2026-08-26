const express = require("express")
const router = express.Router()

const { adminAuth } = require("../middleware/adminAuth")
const { getCashSessions, openCashSession, addCashMovement, closeCashSession } = require("../controller/cashSession")

router.get("/", adminAuth, getCashSessions)
router.post("/open", adminAuth, openCashSession)
router.post("/movement", adminAuth, addCashMovement)
router.post("/close", adminAuth, closeCashSession)

module.exports = router
