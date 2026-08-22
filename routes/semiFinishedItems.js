const express = require("express")
const router = express.Router()
const { adminAuth } = require("../middleware/adminAuth")
const {
    getAllSemiFinishedItems,
    getSingleSemiFinishedItem,
    addSemiFinishedItem,
    editSemiFinishedItem,
    deleteSemiFinishedItem,
    recordProduction,
    getSFIStockLevels,
    getAllSFINames
} = require("../controller/semiFinishedItems")

router.get("/all", adminAuth, getAllSemiFinishedItems)
router.get("/single", adminAuth, getSingleSemiFinishedItem)
router.get("/names", adminAuth, getAllSFINames)
router.get("/stockLevels", adminAuth, getSFIStockLevels)
router.post("/add", adminAuth, addSemiFinishedItem)
router.put("/edit", adminAuth, editSemiFinishedItem)
router.delete("/delete", adminAuth, deleteSemiFinishedItem)
router.post("/production", adminAuth, recordProduction)

module.exports = router
