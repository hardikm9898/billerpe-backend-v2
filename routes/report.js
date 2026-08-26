const express = require("express")
const router = express.Router()

const { adminAuth } = require("../middleware/adminAuth")
const { validator } = require("../middleware/validator")

const { expenseReportsSchema } = require("../validation/report")
const { expenseEntryReports, expenseByReports } = require("../controller/reports/expenseRelated")
const { dayWiseGrowthReport, posCollectionReport, ExecutiveSalesReportSummary, DiscountedOrdersReport, AllOrderTypeWise, userWiseOrderGet, kotReport } = require("../controller/reports/orderRelated")
const { itemTextReports, itemReportDayWise, HighestSellingReports } = require("../controller/reports/itemRelated")
const { duePaymentReceiveReports } = require("../controller/reports/other")
const { consumptionReport, itemWiseConsiompsion } = require("../controller/reports/inventoryRelated")

router.post("/expenseReports", adminAuth, validator(expenseReportsSchema), expenseEntryReports)
router.get("/expenseByReports", adminAuth, expenseByReports)
router.get("/order-aggregation", adminAuth, dayWiseGrowthReport)
router.get("/posCollection", adminAuth, posCollectionReport)
router.get("/executiveReport", adminAuth, ExecutiveSalesReportSummary)
router.get("/discountedReports", adminAuth, DiscountedOrdersReport)
router.get("/userWiseOrder", adminAuth, userWiseOrderGet)
router.get("/kotReport", adminAuth, kotReport)

//item related Reports 
router.get("/itemTextReports", adminAuth, itemTextReports)
router.get("/itemReportDayWise", adminAuth, itemReportDayWise)
router.get("/highestSelling", adminAuth, HighestSellingReports)


// Other

router.get("/duePaymentReceive", adminAuth, duePaymentReceiveReports)
router.get("/consumptionReport", adminAuth, consumptionReport)
router.get("/itemWiseConsiompsion", adminAuth, itemWiseConsiompsion)
router.get("/AllOrderTypeWise", adminAuth, AllOrderTypeWise)


module.exports = router