const express = require("express")
const { addExpenseHead, getAllExpenseHead, editExpenseHead, addExpense, allEntry, editExpense, deleteExpense, deleteExpenseMobile, editExpenseMobile, allEntryMobile, addExpenseMobile, editExpenseHeadMobile, getAllExpenseHeadMobile, addExpenseHeadMobile, allEntryMobileExcel } = require("../controller/expence/expence")
const { adminAuth, mobileAuth } = require("../middleware/adminAuth")
const { addExpenseSchema, editExpenseSchema, deleteExpenseSchema, allEntrySchema } = require("../validation/validate")
const router = express.Router()
const { validator, queryValidator } = require("../middleware/validator")

router.post("/addExpenseHead", adminAuth, addExpenseHead)
router.get("/getAllExpenseHead", adminAuth, getAllExpenseHead)
router.put("/editExpenseHead", adminAuth, editExpenseHead)

//! Expense Routes

router.post("/addExpense", adminAuth, validator(addExpenseSchema), addExpense)
router.get("/allEntry", adminAuth, queryValidator(allEntrySchema), allEntry)
router.put("/editExpense", validator(editExpenseSchema), adminAuth, editExpense)
router.delete("/deleteExpense", validator(deleteExpenseSchema), adminAuth, deleteExpense)

router.post("/addExpenseHeadMobile", mobileAuth, addExpenseHeadMobile)
router.get("/getAllExpenseHeadMobile", mobileAuth, getAllExpenseHeadMobile)
router.post("/editExpenseHeadMobile", mobileAuth, editExpenseHeadMobile)

//! Expense Routes

router.post("/addExpenseMobile", mobileAuth, validator(addExpenseSchema), addExpenseMobile)
router.post("/allEntryMobile", mobileAuth, validator(allEntrySchema), allEntryMobile)
router.post("/editExpenseMobile", validator(editExpenseSchema), mobileAuth, editExpenseMobile)
router.post("/deleteExpenseMobile", validator(deleteExpenseSchema), mobileAuth, deleteExpenseMobile)
router.post("/allEntryMobileExcel", validator(allEntrySchema), mobileAuth, allEntryMobileExcel)

module.exports = router