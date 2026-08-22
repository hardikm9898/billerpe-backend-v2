const express = require("express")
const { mobileAuth } = require("../middleware/adminAuth")
const { moveMobileKot, moveMobileTable } = require("../controller/mobileController/mobiletables")
const { updateOrder, deleteOrder } = require("../controller/mobileController/orders")
const router = express.Router()



router.post("/movekot", mobileAuth, moveMobileKot)
router.post("/movetable", mobileAuth, moveMobileTable)
router.post("/updateOrder", mobileAuth, updateOrder)
router.post("/deleteOrder", mobileAuth, deleteOrder)


module.exports = router