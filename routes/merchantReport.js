const express = require("express");
const router = express.Router();

const { merchantReportAuth } = require("../middleware/merchantReportAuth");
const { validator } = require("../middleware/validator");
const { expenseReportsSchema } = require("../validation/report");

// Reuse the exact same controller functions as POS report routes.
// They work unchanged because merchantReportAuth sets req.user = hotel_id.
const { expenseEntryReports, expenseByReports } = require("../controller/reports/expenseRelated");
const {
    dayWiseGrowthReport,
    posCollectionReport,
    ExecutiveSalesReportSummary,
    DiscountedOrdersReport,
    AllOrderTypeWise,
    userWiseOrderGet,
} = require("../controller/reports/orderRelated");
const { itemTextReports, itemReportDayWise, HighestSellingReports } = require("../controller/reports/itemRelated");
const { duePaymentReceiveReports } = require("../controller/reports/other");
const { consumptionReport, itemWiseConsiompsion } = require("../controller/reports/inventoryRelated");
const { getDueOrders } = require("../controller/order");
const { salesReport } = require("../controller/report");
const { getAllRawMaterialName } = require("../controller/stock_Mangement/rawMaterial");

// Sales reports
router.post("/salesReports",     merchantReportAuth, salesReport);
router.get("/order-aggregation", merchantReportAuth, dayWiseGrowthReport);
router.get("/posCollection",     merchantReportAuth, posCollectionReport);
router.get("/executiveReport",   merchantReportAuth, ExecutiveSalesReportSummary);
router.get("/userWiseOrder",     merchantReportAuth, userWiseOrderGet);
router.get("/AllOrderTypeWise",  merchantReportAuth, AllOrderTypeWise);

// Item reports
router.get("/itemTextReports",   merchantReportAuth, itemTextReports);
router.get("/itemReportDayWise", merchantReportAuth, itemReportDayWise);
router.get("/highestSelling",    merchantReportAuth, HighestSellingReports);

// Discount / payment
router.get("/discountedReports",  merchantReportAuth, DiscountedOrdersReport);
router.get("/duePaymentReceive",  merchantReportAuth, duePaymentReceiveReports);
router.post("/getDueOrders",      merchantReportAuth, getDueOrders);

// Stock / inventory
router.get("/itemWiseConsiompsion",   merchantReportAuth, itemWiseConsiompsion);
router.get("/consumptionReport",      merchantReportAuth, consumptionReport);
router.get("/getAllRawMaterialName",   merchantReportAuth, getAllRawMaterialName);

// Expense
router.post("/expenseReports",    merchantReportAuth, validator(expenseReportsSchema), expenseEntryReports);
router.get("/expenseByReports",   merchantReportAuth, expenseByReports);

module.exports = router;
