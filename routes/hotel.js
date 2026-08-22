const express = require("express")
const router = express.Router()
const { addHotelDetails, getHotel, addTable, getTable, reservedTable, editTable, removeTable, getTableForCaptain, getTableCatagories, getSingleHotel, updateInvoiceFormate, addTableCategory, editTableCatagories, removeTableCatagories, searchByTableCatagories, tableWiseRetrieveOrder, liveTable, jsPrintManager, getHotelId, getTableCatagoriesWise, setDisplay, addEditServiceCharge, editHotelDetails, setMenuShow } = require("../controller/hotel")
const { createAddonSchema, updatedAddonsSchema, printerSchema, printerSchemaEdit, createTableSchema } = require("../validation/validate")
const { validator } = require("../middleware/validator")
const { createUser, getRole, checkHotelLogin, createCaptain, checkCaptainLogin, updateUser, getCaptainUser, userAccess, getImage, getNumberSuggestion, getUserName } = require("../controller/user")
const { createMenu, showMenu, checkTableAvailable, showCatagories, createCatagories, MenuShow, MenuShowByCatagories, searchByCatagories, editMenu, removeMenu, removeCatagories, editCatagories, searchByShortCode, searchBySubCatagories, menuByCategory, uploadMenuFromExcel } = require("../controller/menu")
const upload = require("../middleware/upload")
const { addToCart, getCart, removeCartItems, placeOrder, billData, billDataForAdmin, getOrders, getSingleOrder, getKotOrder, getHoldOrders, getPickupOrder, getDinInOrder, getSingleOrderForAdminCart, deleteOrder, getOrdersByBillNo, getPendingBills, getDueOrders, settleDue, settleAllDuePayment, getTimeLineByOrderId, getOrderTaxDetails, getAllOrderPaginationWise, makeSequenceBillNoOptimized } = require("../controller/order")
const { userLogin, restaurantLogin, captainLogin, restaurantLogout, pdf, pinLogin } = require("../controller/auth")
const isAuth = require("../middleware/auth")
const { adminAuth, mobileAuth, mobileSuperAdminAuth } = require("../middleware/adminAuth")
const { addToCartAdmin, getAdminCart, AdminOrder, removeAdminCartItems, adminBillData, removeAdminAllCart, cancelOrder, kotOrder, holdOrder, test, addToCartForOnClickRetrieveCart, addComment, setPrinter, deletePdf, settleBills, editOrderClick, updateInvoice, rePrintAdminBillData, reprintkot, kotGeneratePdf, invoiceGeneratePdf, getBillViewData, sentEbill, getEbillCredit, creditDebitEbillData, updateOrderToserver, ordertimeOver, ordertimeExtend } = require("../controller/kto")
const CaptainAuth = require("../middleware/captainAuth")
const { salesReport, itemWiseReports, cancelOrderReport, customReportsData, onlineOrderTotalSales } = require("../controller/report")
const { dashBoard, mobileLogin } = require("../controller/mobileController/dashBoard")
const { mobileTable, tableWiseKotRetrive } = require("../controller/mobileController/mobiletables")
const { mobileMenu, mobileCategory } = require("../controller/mobileController/items")
const { mobileKotOrder, mobileHoldOrder, mobilePrintOrder, printBill, mobileRemoveAdminCartItems, mobilePickUp, getAllUserInfoToRestaurantWise, mobileDeleteOrder, updateMobileInvoice, sentEbillMobile, getEbillCreditMobile, getMobileAllPromoCode } = require("../controller/mobileController/kot")
const { mobileSettleBills, mobileAccess, AllInvoice, orderIdWiseOrderGet, getMobilePickupOrders, serviceCharge, getDueOrdersMobile, settleDueMobile, settleAllDueMobilePayment } = require("../controller/mobileController/orders")
const { restaurantDetails, superAdminLogin, checkSuperAdmin, AllInquiry, singleHotelSP, getProductImages } = require("../controller/superAdmin")
const { tableBooking, getBookingData, deleteBookings, getSingleBookingData, updateBooking } = require("../controller/tableBooking")
const { checkDashBoardOnOrNot } = require("../connection/socket")
const { invoiceSetting, headerFooterContent, getFontSizeArray } = require("../controller/incoiceFormate")
const superAdminAuth = require("../middleware/superAdminAuth")
const { setPrinterSetting, getPrinter, EditPrinterSetting, deletedPrinter, setCategoriesForPrinter } = require("../controller/printer_setting")
const { moveKot, moveTable } = require("../controller/table")
const { salesDashBoardData } = require("../controller/dashBoard")
const { offlineMenu, offlineMenuCateg, offlineTable, offlineTableCateg, offlineOrders, offlineOrdersDetails, offlineUser, offlineHotelUser, offlineInvoiceFormate, offlinePrinterSetting, offlineTableBooking, offlineUserAccess, offlineRoles, syncOrderDataWithDataBase, fetchAllData, offlineOnlineOrder, gettingAllRestaurantWhichIsTakenGst } = require("../controller/offline/offline")
const { GetOrderSFromZomoto, orderStatus, items, orderStatusChange, orderStatusChangeFromZomato, getOrderHistory, generateZomatoKot, generateZomatoBill } = require("../controller/zomotoSwiggy")
const { dailySendToClientTotalSales, CustomerFeedBackSendMessage } = require("../controller/smsService")
const { createVariant, getAllVariant, updatedVariant } = require("../controller/Variant/variant")
const { createAddonDepartment, getAllAddons, updatedAddons } = require("../controller/Variant/addon")
const { getMobileTables, gettingMobileAllOrders, gettingMobileMenu, gettingHeaderFooter } = require("../controller/mobileController/offline/gettingData")
const { itemWiseReportMobile, getAllMenuCategory, itemWiseReportMobileDownnloadExel, salesReportDayWiseMobile, salesReportDayWiseMobileDownloadExcel, DiscountedOrdersReportMobile, DiscountedOrdersReportMobileExel } = require("../controller/mobileController/report")
const { uploadSingleTest } = require("../services/upload")


const { STATUSCODE } = require("../constant/const")
const { error } = require("../responce/res")
const { storeWebsiteUserData } = require("../controller/webiste/user")
const loginLimiter = require("../middleware/loginLimiter")
const requireAccess = require("../middleware/requireAccess")

// ! Socket Connection 

router.get("/hotelId", adminAuth, getHotelId)
router.get('/sms', dailySendToClientTotalSales)
router.get('/feedback', CustomerFeedBackSendMessage)

// ? hotels routes

router.post('/getBillDetails', getBillViewData)
router.get("/hotel", superAdminAuth, getHotel)
router.post("/setDisplay", adminAuth, setDisplay)
router.post("/setMenuShow", adminAuth, setMenuShow)
router.get("/jspm", jsPrintManager)
router.get("/singleHotel", adminAuth, getSingleHotel)
router.post("/updateInvoiceFormate", adminAuth, updateInvoiceFormate)
router.post("/invoiceSetting", adminAuth, invoiceSetting)
router.get("/getFontSizeArray", adminAuth, getFontSizeArray)
router.get("/headerFooter", adminAuth, headerFooterContent)
router.post("/hotel", superAdminAuth, upload.fields([
    { name: "hotel_logo", maxCount: 1 },
    { name: "payment_image", maxCount: 1 }
]), addHotelDetails)
router.post("/hoteledit", superAdminAuth, upload.single('hotel_logo'), editHotelDetails)
router.post("/service_charge", adminAuth, addEditServiceCharge)
router.get("/number_suggestion/:search", adminAuth, getNumberSuggestion)


//? superAdmin 
// router.post("/superAdmin", superAdminAuth, restaurantDetails)
// router.post("/singleHotelSP", superAdminAuth, singleHotelSP)
// router.get("/superAdminInquiry", AllInquiry)
// router.post("/superAdmin/login", superAdminLogin)
// router.get("/checkSuperAdmin", superAdminAuth, checkSuperAdmin)


// ? table
router.get("/table", adminAuth, requireAccess("Table", "read"), getTable)
router.get("/getTableCatagoriesWise", adminAuth, requireAccess("Table", "read"), getTableCatagoriesWise)
router.post("/table", adminAuth, requireAccess("Table", "create"), validator(createTableSchema), addTable)
router.post("/reserved", adminAuth, reservedTable)
router.post("/removeTable", adminAuth, requireAccess("Table", "delete"), removeTable)
router.post("/editTable", adminAuth, requireAccess("Table", "edit"), editTable)
router.get("/liveTable/:key", adminAuth, liveTable)
router.post("/moveTable", adminAuth, moveTable)

// ? User Routes 

router.post("/user", adminAuth, requireAccess("User", "create"), createUser)
router.get("/captain", adminAuth, getCaptainUser)
router.post("/userUpdate", adminAuth, requireAccess("User", "edit"), updateUser)
router.get("/role", isAuth, getRole)
router.get("/getUserAccess", adminAuth, userAccess)
router.get("/getImage", getImage)
router.get("/getUserName", adminAuth, getUserName)

// ? captain routes
router.get("/checkCaptainLogin", CaptainAuth, checkCaptainLogin)
router.get("/captainTable", CaptainAuth, getTableForCaptain)
router.post("/addCaptain", adminAuth, createCaptain)
router.post("/captainLogin", loginLimiter, captainLogin)
router.get("/getTableCatagories", adminAuth, requireAccess("Table", "read"), getTableCatagories)
router.post("/addTableCatagories", adminAuth, requireAccess("Table", "create"), addTableCategory)
router.post("/editTableCatagories", adminAuth, requireAccess("Table", "edit"), editTableCatagories)
router.post("/removeTableCatagories", adminAuth, requireAccess("Table", "delete"), removeTableCatagories)

//? Menu & catage Routes && Variant\

router.post('/variant', adminAuth, createVariant)
router.put('/variant', adminAuth, updatedVariant)
router.post('/addon', adminAuth, validator(createAddonSchema), createAddonDepartment)
router.put('/addon', adminAuth, validator(updatedAddonsSchema), updatedAddons)
router.get('/addon', adminAuth, getAllAddons)
router.get('/variant', adminAuth, getAllVariant)

router.post("/menuRemove", adminAuth, requireAccess("Menu", "delete"), removeMenu)
router.post("/catagoriesRemove", adminAuth, requireAccess("Menu", "delete"), removeCatagories)
router.post("/menu", adminAuth, requireAccess("Menu", "create"), createMenu)
router.get("/getProductImages/:search?", adminAuth, getProductImages)
router.post("/uploadExcel", adminAuth, upload.single('file'), uploadMenuFromExcel)
router.post("/menuEdit", adminAuth, requireAccess("Menu", "edit"), editMenu)
router.post("/catagoriesEdit", adminAuth, requireAccess("Menu", "edit"), editCatagories)
router.post("/catagories", adminAuth, requireAccess("Menu", "create"), createCatagories)
router.get("/menu", isAuth, showMenu)
router.get("/catagories/:key", adminAuth, requireAccess("Menu", "read"), showCatagories)
router.get("/searchByCatagories/:key", adminAuth, searchByCatagories)
router.get("/searchByTableCatagories/:key", adminAuth, searchByTableCatagories)
router.get("/searchBySubCatagories/:key", adminAuth, searchBySubCatagories)
router.get("/menuShowByCatagories", adminAuth, MenuShowByCatagories)
router.get("/menuShow/:key", adminAuth, MenuShow)

router.post("/checkTableAvailable", adminAuth, checkTableAvailable)
router.get("/searchByShortCode/:key", adminAuth, searchByShortCode)

// ? Cart
router.post("/cart", isAuth, addToCart)
router.get("/cart", isAuth, getCart)
router.post("/removeCart", isAuth, removeCartItems)
router.get("/billData", isAuth, billData)
router.get("/billDataForAdmin/:tableId", adminAuth, billDataForAdmin)

// ? order
router.get("/makeSequenceBillNo", adminAuth, makeSequenceBillNoOptimized)
router.post("/order", isAuth, placeOrder)
router.get("/paginateOrder", adminAuth, getAllOrderPaginationWise)
router.get("/getTimelineByOrderId", adminAuth, getTimeLineByOrderId)
// router.post("/test", gettingTemplates)

router.get("/order", adminAuth, getOrders)
router.get("/kotOrder", adminAuth, getKotOrder)          // ! change the logic when need this routes first checkout it 
router.post("/generateKotPdf", adminAuth, kotGeneratePdf)
router.post("/generateInvoicePdf", adminAuth, invoiceGeneratePdf)
router.get("/holdOrder", adminAuth, getHoldOrders)   // ! change the logic when need this routes first checkout it 
router.get("/pickupOrder", adminAuth, getPickupOrder)
router.get("/dininOrder", adminAuth, getDinInOrder)
router.get("/searchOrder/:key", adminAuth, getOrdersByBillNo)
router.get("/order/:id", adminAuth, getSingleOrder)
router.get("/orderAdminCart/:id", adminAuth, getSingleOrderForAdminCart)
router.get("/settlePendingBill", adminAuth, getPendingBills)
router.post("/tableWiseRetrieveOrder", adminAuth, tableWiseRetrieveOrder)
router.post("/getDueOrders", adminAuth, getDueOrders)
router.post("/settleDue", adminAuth, settleDue)
router.post("/allSettleDue", adminAuth, settleAllDuePayment)
router.post("/updateOrderToserver", adminAuth, updateOrderToserver)

// ? kot Orders 

router.post("/adminCart", adminAuth, addToCartAdmin)
router.post("/settleBills", adminAuth, settleBills)
router.post("/addToCartForRetrieveData", adminAuth, addToCartForOnClickRetrieveCart)
router.get("/adminCart", adminAuth, getAdminCart)
router.post("/sentEbill", adminAuth, sentEbill)
router.get("/getEbillCredit", adminAuth, getEbillCredit)
router.get("/creditDebitEbillData", adminAuth, creditDebitEbillData)
router.post("/adminOrder", adminAuth, AdminOrder)
router.post("/addComment", adminAuth, addComment)
router.post("/kotOrder", adminAuth, kotOrder)
router.post("/ordertimeOver", adminAuth, ordertimeOver)
router.post("/ordertimeExtend", adminAuth, ordertimeExtend)
router.post("/orderRemove", adminAuth, deleteOrder)
router.post("/holdOrder", adminAuth, holdOrder)
router.post("/removeAdminCart", adminAuth, removeAdminCartItems)
router.post("/removeAdminAllCart", adminAuth, removeAdminAllCart)
router.post("/adminBillData", adminAuth, adminBillData)
router.post("/rePrintAdminBillData", adminAuth, rePrintAdminBillData)
router.post("/cancelOrder", adminAuth, cancelOrder)
router.post("/editOrderClick", adminAuth, editOrderClick)
router.post("/updateInvoice", adminAuth, updateInvoice)
router.post("/logout", adminAuth, restaurantLogout)
router.post("/deletepdf/:fileName", adminAuth, deletePdf)
router.post("/moveKot", adminAuth, moveKot)
// router.get("/any", adminAuth, pdf)


// ? Table Booking 

router.post("/tableBooking", adminAuth, tableBooking)
router.get("/getBookingData", adminAuth, getBookingData)
router.post("/deleteBooking", adminAuth, deleteBookings)
router.post("/updatedBooking/:id", adminAuth, updateBooking)
router.get("/singleBookingData/:id", adminAuth, getSingleBookingData)

//? login
router.post("/userLogin", loginLimiter, userLogin)
router.post("/restaurantLogin", loginLimiter, restaurantLogin)
router.post("/pinLogin", loginLimiter, pinLogin)

router.get("/checkHotelLogin", adminAuth, checkHotelLogin)


// ? printer 

router.post("/setPrinter", adminAuth, validator(printerSchema), setPrinterSetting)
router.post("/EditPrinter", adminAuth, validator(printerSchemaEdit), EditPrinterSetting)
router.post("/deletePrinter", adminAuth, deletedPrinter)
router.post("/setCategoriesForPrinter", adminAuth, setCategoriesForPrinter)
router.get("/printer", adminAuth, getPrinter)
router.post("/reprintKot", adminAuth, reprintkot)

//? Reports
router.post("/salesReports", adminAuth, salesReport)
router.post("/onlineOrderTotalSales", adminAuth, onlineOrderTotalSales)
router.post("/customReport", adminAuth, customReportsData)
router.post("/dashBoardData", adminAuth, salesDashBoardData)
router.post("/itemWiseReports", adminAuth, itemWiseReports)
router.get("/cancelOrderReport", adminAuth, cancelOrderReport)

//! mobile routes
router.post("/mobileLogin", loginLimiter, mobileLogin)
router.post("/dashBoard", mobileAuth, dashBoard)
router.get("/mobileTables", mobileAuth, mobileTable)
router.get("/mobileMenu/:key", mobileAuth, mobileMenu)
router.get("/mobileCategory", mobileAuth, mobileCategory)
router.get("/mobileUserAccess", mobileAuth, mobileAccess)

router.post('/allInvoice', mobileAuth, AllInvoice)
router.get('/userInfo', mobileAuth, getAllUserInfoToRestaurantWise)
router.post("/orderIdWiseGetOrderDetails", mobileAuth, orderIdWiseOrderGet)
router.get("/getMobileTimelineByOrderId", mobileAuth, getTimeLineByOrderId)

router.post("/mobileKot", mobileAuth, mobileKotOrder)
router.post("/mobileHold", mobileAuth, mobileHoldOrder)
router.post("/mobilepickup", mobileAuth, mobilePickUp)
router.post("/mobileAdminOrder", mobileAuth, mobilePrintOrder)
router.post("/mobileUpdateOrder", mobileAuth, updateMobileInvoice)
router.post("/mobileSettleBills", mobileAuth, mobileSettleBills)
router.post("/mobilePrintBill", mobileAuth, printBill)
router.post("/tableWiseKotRetrive", mobileAuth, tableWiseKotRetrive)
router.get("/dashBoardConnected", mobileAuth, checkDashBoardOnOrNot)
router.post("/mobileRemoveAdminCartItems", mobileAuth, mobileRemoveAdminCartItems)
router.post("/mobileDeleteOrder", mobileAuth, mobileDeleteOrder)
router.get("/pickupRunningOrder", mobileAuth, getMobilePickupOrders)
router.post("/getDueOrdersMobile", mobileAuth, getDueOrdersMobile)
router.post("/settleDueMobile", mobileAuth, settleDueMobile)
router.post("/settleDueAllMobile", mobileAuth, settleAllDueMobilePayment)
router.post("/sentMobileEbill", mobileAuth, sentEbillMobile)
router.get("/getEbillCreditMobile", mobileAuth, getEbillCreditMobile)
router.get("/getmobilePromoCode", mobileAuth, getMobileAllPromoCode)
router.post("/getMobileOrderTax", mobileAuth, getOrderTaxDetails)

//Offline 
router.get("/mobileGetTables", mobileAuth, getMobileTables)
router.get("/gettingMobileAllOrders", mobileAuth, gettingMobileAllOrders)
router.get("/gettingMobileMenu", mobileAuth, gettingMobileMenu)
router.get("/gettingHeaderFooter", mobileAuth, gettingHeaderFooter)
router.post('/itemWisereport', mobileAuth, itemWiseReportMobile)
router.get('/getAllMenuCategory', mobileAuth, getAllMenuCategory)
router.post('/itemWiseReportMobileDownnloadExel', mobileAuth, itemWiseReportMobileDownnloadExel)
router.post('/salesReportDayWiseMobile', mobileAuth, salesReportDayWiseMobile)
router.post('/salesReportDayWiseMobileDownloadExcel', mobileAuth, salesReportDayWiseMobileDownloadExcel)
router.post('/discountedOrdersReportMobile', mobileAuth, DiscountedOrdersReportMobile)
router.post('/discountedOrdersReportMobileExel', mobileAuth, DiscountedOrdersReportMobileExel)
router.get('/serviceCharge', mobileAuth, serviceCharge)
// router.post("/syncSingleOrder", syncSingleOrder)


// router.post("/mobile/liveRestaurant", mobileSuperAdminAuth, liveRestaurant)
// router.post("/mobile/superAdmin/login", mobileSuperAdminLogin)

// //! mobile Menu website

router.get("/menuByCategory/:key", menuByCategory)


//!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!! offline Data Get ????????????????????????????????????????????????? //

router.get('/offlineMenu', adminAuth, offlineMenu)
router.get('/offlineMenuCateg', adminAuth, offlineMenuCateg)
router.get('/offlineTable', adminAuth, offlineTable)
router.get('/offlineTableCateg', adminAuth, offlineTableCateg)
router.post('/offlineOrders', adminAuth, offlineOrders)
router.get('/offlineOrdersDetails', adminAuth, offlineOrdersDetails)
router.get('/offlineUser', adminAuth, offlineUser)
router.get('/offlineHotelUser', adminAuth, offlineHotelUser)
router.get('/offlineRoles', adminAuth, offlineRoles)
router.get('/offlineInvoiceFormate', adminAuth, offlineInvoiceFormate)
router.get('/offlinePrinterSetting', adminAuth, offlinePrinterSetting)
router.get('/offlineTableBooking', adminAuth, offlineTableBooking)
router.get('/offlineUserAccess', adminAuth, offlineUserAccess)
router.get('/offlineOnlineOrders', adminAuth, offlineOnlineOrder)

router.post('/syncOrderData', adminAuth, upload.single("foodImage"), syncOrderDataWithDataBase)
router.get('/fetchAll', adminAuth, fetchAllData)




//! swiggy Zomoto 

router.post('/orders', GetOrderSFromZomoto)

router.get('/:id/orders/status', orderStatus)
router.get('/:id/items', items)
router.post('/order/status', adminAuth, orderStatusChange)
router.post('/orders/:orderId/status', orderStatusChangeFromZomato)
router.post('/:resId/orders/history', getOrderHistory)
router.post('/generateZomatoKot', adminAuth, generateZomatoKot)
router.post('/generateZomatoBill', adminAuth, generateZomatoBill)


// ! stock Management 

module.exports = router

