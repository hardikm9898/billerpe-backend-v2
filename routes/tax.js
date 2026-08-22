const express = require("express")
const router = express.Router()

const { adminAuth } = require("../middleware/adminAuth")
const { validator } = require("../middleware/validator")

const { expenseReportsSchema } = require("../validation/report")
const { getTaxtType, createTaxType, editTaxType } = require("../controller/tax")
const { taxTypeCreateValidation, taxTypeEditValidation } = require("../validation/validate")

router.get("/tax", adminAuth, getTaxtType)
router.post("/tax", adminAuth, validator(taxTypeCreateValidation), createTaxType)
router.put("/tax", adminAuth, validator(taxTypeEditValidation), editTaxType)


module.exports = router