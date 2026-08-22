const express = require("express")
const router = express.Router()
const { zomatoRiderStatus, zomatoUpdateOrderStatus, zomatoPlaceOrder, outletStatus, menuSync, zomatoLiveOutlets } = require("../controller/zomatoSwigy/zomato")
const { validateSignature } = require("../middleware/zomato")


router.post("/riderStatus", validateSignature, zomatoRiderStatus)
router.post("/updatedOrderStatus", validateSignature, zomatoUpdateOrderStatus)
router.post("/placeOrder", validateSignature, zomatoPlaceOrder)
router.post("/outletStatus", validateSignature, outletStatus)
router.post("/menuSync", validateSignature, menuSync)
router.post("/liveOutlets", validateSignature, zomatoLiveOutlets)

module.exports = router