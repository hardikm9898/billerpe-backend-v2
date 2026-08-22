/**
 * Global controller mocks applied to EVERY test file via setupFilesAfterEnv.
 * These prevent "Route requires a callback function" errors when routes/index.js
 * loads all route files at testApp creation time.
 * Individual test files can override these with their own jest.mock() calls.
 */

/* eslint-disable */

// R() creates a stub that actually responds to Express — prevents request timeouts in tests
const R = () => jest.fn((req, res) => res && res.json && res.json({ error: false, results: {}, code: 200 }));
const fn = () => jest.fn();

// Bypass Joi validation for all integration tests (validation is unit-tested separately)
jest.mock("../../middleware/validator", () => ({
  validator: () => (req, res, next) => next(),
  queryValidator: () => (req, res, next) => next(),
}));

// ─── KDS ──────────────────────────────────────────────────────────────────────
jest.mock("../../controller/kds/kds", () => ({
  sendKotToAllKdsClient: R(), orderCompletedSendtoKdsCLient: R(),
  otherkot: R(), removeKotItemFromKds: R(), descriseKotQtyItemFromKDS: R(),
  recallKot: R(), deleteKitchen: R(), getKitchenDataById: R(),
  setCategoryForKitchen: R(), createKitchen: R(), getAllKitchen: R(),
  getLiveOrders: R(), markItemReady: R(),
}));

// ─── Recipes ──────────────────────────────────────────────────────────────────
jest.mock("../../controller/recipes", () => ({
  checkRawMaterialAvailableOrNot: R().mockResolvedValue(true),
  addRecipes: R(), editRecipes: R(), getAllRecipes: R(),
  getSingleRecipes: R(), deleteRecipe: R(),
  getAllRecipesForMenu: R(), convertMenuWise: R(),
}));

// ─── Stock Management ─────────────────────────────────────────────────────────
jest.mock("../../controller/stock_Mangement", () => ({
  addRawMaterial: R(), editRawMaterial: R(), getAllRawMaterial: R(),
  addUnit: R(), editUnit: R(), getAllUnit: R(),
  stockInHand: R(), stockIn: R(), stockOut: R(),
  StockInOutHistory: R(), deleteStockHistory: R(), editStockHistory: R(),
  createPurchaseOrder: R(), editPurchaseOrder: R(), deletePurchaseorder: R(),
  recordConsumption: R(), getConsumptionHistory: R(),
  getConsumptionSummaryByPurpose: R(), getConsumptionSummaryByRawMaterial: R(),
  paymentDone: R(), updateManualStock: R(), adjustManualAveragePrice: R(),
}));
jest.mock("../../controller/stock_Mangement/rawMaterial", () => ({
  getAllRawMaterialName: R(), checkStockLevel: R(), checkStockLevelMobile: R(),
}));
jest.mock("../../controller/stock_Mangement/purchaseOrder", () => ({
  getPurchaseOrders: R(), createSupplier: R(), getSupplier: R(),
  getMaxPo: R(), getSupplierWisePurchaseOrder: R(),
  orderWiserConsumptionReports: R(), getRawMaterialWisePurchaseOrder: R(),
  editSupplier: R(),
}));
jest.mock("../../controller/stock_Mangement/westage", () => ({
  createRawMaterialWastage: R(), getWastageRecords: R(),
  deleteWastageRecord: R(), getWastageRecordsExcel: R(),
}));

// ─── Expense ──────────────────────────────────────────────────────────────────
jest.mock("../../controller/expence/expence", () => ({
  addExpenseHead: R(), getAllExpenseHead: R(), editExpenseHead: R(),
  addExpense: R(), allEntry: R(), editExpense: R(), deleteExpense: R(),
  deleteExpenseMobile: R(), editExpenseMobile: R(), allEntryMobile: R(),
  addExpenseMobile: R(), editExpenseHeadMobile: R(),
  getAllExpenseHeadMobile: R(), addExpenseHeadMobile: R(),
  allEntryMobileExcel: R(),
}));

// ─── Semi-Finished Items ───────────────────────────────────────────────────────
jest.mock("../../controller/semiFinishedItems", () => ({
  getAllSemiFinishedItems: R(), getSingleSemiFinishedItem: R(),
  addSemiFinishedItem: R(), editSemiFinishedItem: R(),
  deleteSemiFinishedItem: R(), recordProduction: R(),
  getSFIStockLevels: R(), getAllSFINames: R(),
}));

// ─── Website ──────────────────────────────────────────────────────────────────
jest.mock("../../controller/webiste/user", () => ({
  storeWebsiteUserData: R(),
}));
jest.mock("../../controller/websitePurchase/purchase", () => ({
  createRollAndPrinterPurchase: R(), updateTempRestaurantData: R(),
  createTempRestaurantData: R(), checkCoupenCode: R(),
  genreratePaymentLink: R(), gettingproductsData: R(),
  gettingproductsDataWebSite: R(),
}));

// ─── Reports ──────────────────────────────────────────────────────────────────
jest.mock("../../controller/reports/expenseRelated", () => ({
  expenseEntryReports: R(), expenseByReports: R(),
}));
jest.mock("../../controller/reports/orderRelated", () => ({
  dayWiseGrowthReport: R(), posCollectionReport: R(),
  ExecutiveSalesReportSummary: R(), DiscountedOrdersReport: R(),
  AllOrderTypeWise: R(), userWiseOrderGet: R(),
}));
jest.mock("../../controller/reports/itemRelated", () => ({
  itemTextReports: R(), itemReportDayWise: R(), HighestSellingReports: R(),
}));
jest.mock("../../controller/reports/other", () => ({
  duePaymentReceiveReports: R(),
}));
jest.mock("../../controller/reports/inventoryRelated", () => ({
  consumptionReport: R(), itemWiseConsiompsion: R(),
}));

// ─── Promo Code ───────────────────────────────────────────────────────────────
jest.mock("../../controller/discountPromocode", () => ({
  createPromoCode: R(), updatePromoCode: R(), getAllPromoCode: R(),
}));

// ─── Zomato / Swiggy ──────────────────────────────────────────────────────────
jest.mock("../../controller/zomatoSwigy/zomato", () => ({
  zomatoRiderStatus: R(), zomatoUpdateOrderStatus: R(),
  zomatoPlaceOrder: R(), outletStatus: R(),
  menuSync: R(), zomatoLiveOutlets: R(),
}));

// ─── User / Customer ──────────────────────────────────────────────────────────
jest.mock("../../controller/user", () => ({
  getNumberSuggestion: R(), createCustomerData: R(),
  updateCostumerData: R(), getImage: R(),
}));

// ─── Auth ─────────────────────────────────────────────────────────────────────
jest.mock("../../controller/auth", () => ({
  merchantLogin: R(), merchantLogout: R(), pinLogin: R(),
}));

// ─── Merchant ─────────────────────────────────────────────────────────────────
jest.mock("../../controller/merchant/merchant", () => ({
  checkMerchant: R(), dashBoard: R(), getHotel: R(),
  multipleHotelData: R(), merchantMenu: R(), merchantCategory: R(),
  merchantVarint: R(), merchantAddons: R(), merchantUpdateManualStock: R(),
  merchantStockInHand: R(), merchantStockInOutHistory: R(),
  merchantUnitEdit: R(), merchantAddUnit: R(), merchantGetAllUnit: R(),
  merchantGetAllRawMaterial: R(), merchantAddRawMaterial: R(),
  merchantEditRawMaterial: R(), merchantGetAllRecipes: R(),
  merchantGetSingleRecipes: R(), merchantDeleteRecipe: R(),
  menuForRecipe: R(), merchantGetAllRecipesForMenu: R(),
  menuDetailsForRecipe: R(), uploadMenuItemImage: R(),
  getMenuItemAddons: R(), getMenuItemVariants: R(),
  bulkDeleteMenuItems: R(), bulkDeactivateMenuItems: R(),
  bulkActivateMenuItems: R(), deleteMenuItem: R(),
  toggleMenuItemStatus: R(), updateMenuItem: R(),
  merchantCategoryAll: R(), createMenuItem: R(),
  setMenuAddons: R(), setMenuVariants: R(),
  deleteMerchantCategory: R(), createMerchantCategory: R(),
  updateMerchantCategory: R(), createMerchantVariant: R(),
  updateMerchantVariant: R(), updateMerchantAddonDepartment: R(),
  createMerchantAddonDepartment: R(),
}));

// ─── Variant / Addon ──────────────────────────────────────────────────────────
jest.mock("../../controller/Variant/addon", () => ({
  createAddonDepartment: R(), getAllAddons: R(), updatedAddons: R(),
}));

// ─── Variant / Variant ────────────────────────────────────────────────────────
jest.mock("../../controller/Variant/variant", () => ({
  createVariant: R(), getAllVariant: R(), updatedVariant: R(),
}));

// ─── Ticket ───────────────────────────────────────────────────────────────────
jest.mock("../../controller/TicketManagemnt/ticketManage", () => ({
  getSingleTicketData: R(), hotelWiseTicketGetting: R(),
  startUpdate: R(), addComment: R(), ticketStatusUpdate: R(),
  getTicketRoleWise: R(), genrerateTicket: R(),
  generateTicketFromSuperAdmin: R(),
}));

// ─── Franchise ────────────────────────────────────────────────────────────────
jest.mock("../../controller/franchise/franchise", () => ({
  createFranchiseOrder: R(), getFranchiseOrders: R(),
  getOrderById: R(), updateOrderStatus: R(), adjustOrderQty: R(),
  deliverOrder: R(), deleteFranchiseOrder: R(), editFranchiseOrder: R(),
  getFranchiseOrdersForOutlet: R(), getRawMaterials: R(), getOrderStats: R(),
}));

// ─── Subscription ─────────────────────────────────────────────────────────────
jest.mock("../../controller/Subscription/subscription", () => ({
  getActuleSubscriptionData: R(), extentOneDay: R(),
  validedSubscription: R(), getAllPlan: R(),
  renewSubscription: R(), getAllPlansWithoutDiscount: R(),
  extraOneDayForMobile: R(),
}));
jest.mock("../../controller/Subscription/payment", () => ({
  getPreviousPlan: R(), adminRenewSubscription: R(),
  gereratePaymentLink: R(), verifyPaymentGeneratedLink: R(),
  deactivatePaymentLink: R(), getAllActiveLinkes: R(),
  createPhonePePayment: R(), verifyPhonePePayment: R(),
  webHook: R(), generatePaymentHashId: R(),
  generateMobilePaymentLink: R(), createPhonePePaymentWebSite: R(),
  verifyPhonePePaymentForWebSite: R(), verifyPhonePePaymentForPrinterRoll: R(),
  createPhonePePaymentWebSiteFroRll: R(),
}));

// ─── Tax ──────────────────────────────────────────────────────────────────────
jest.mock("../../controller/tax", () => ({
  getTaxtType: R(), createTaxType: R(), editTaxType: R(),
}));

// ─── KTO (payment hash) ───────────────────────────────────────────────────────
jest.mock("../../controller/kto", () => ({
  generateHashId: R(),
  kotOrder: R(), getOrderByTable: R(), getRunningOrder: R(),
  addCartItem: R(), removeCartItem: R(), updateCartItemQty: R(),
  removeTable: R(), settleOrder: R(), cancelOrder: R(),
  moveTable: R(), holdOrder: R(), retrieveHeldOrder: R(),
  paginateOrder: R(), getOrderById: R(), updateOrder: R(),
  addNewItem: R(), cancelItem: R(), getDashboardData: R(),
}));

// ─── Super Admin ──────────────────────────────────────────────────────────────
jest.mock("../../controller/superAdmin", () => ({
  addEbillCreditBySuperAdmin: R(), getEbillCreditHistory: R(),
  uploadMenuFromExcelBySuperAdmin: R(), restaurantDetails: R(),
  singleHotelSP: R(), AllInquiry: R(), superAdminLogin: R(),
  checkSuperAdmin: R(), superAdminDashBoardData: R(),
  gettingupcomingRenuale: R(), superAdminNewClientGraph: R(),
  superAdminLogOut: R(), saveAndNext: R(),
  gettingPeddingAddRestoDetails: R(), makePayment: R(),
  deleteAddAdminResto: R(), menuUploadedAndTrainingStatus: R(),
  gettingPrinterRollOrders: R(), updateOrderStatus: R(),
  addProduct: R(), editProduct: R(), addImage: R(),
  updateInqueryStatus: R(), gettingSuperAdminUserList: R(),
}));

// ─── SMS Service ──────────────────────────────────────────────────────────────
jest.mock("../../controller/smsService", () => ({
  sendWhatsappMessage: R(), createWhatsAppTemplate: R(),
  updateWhatsAppTemplate: R(), sendBulkWhatsappMessage: R(),
  getAllWhatsappTemplates: R(), downloadSampleExcel: R(),
  dailySendToClientTotalSales: R(), CustomerFeedBackSendMessage: R(),
  sendMessageToNajeria: R(), checkAndSendClosingSummaries: R(),
}));

// ─── Hotel (main routes controller) ──────────────────────────────────────────
jest.mock("../../controller/hotel", () => ({
  insertDefaultRestaurantSettings: R(), setMenuShow: R(),
  editHotelDetails: R(), addEditServiceCharge: R(), setDisplay: R(),
  getTableCatagoriesWise: R(), getHotelId: R(), jsPrintManager: R(),
  liveTable: R(), tableWiseRetrieveOrder: R(), searchByTableCatagories: R(),
  removeTableCatagories: R(), editTableCatagories: R(), addTableCategory: R(),
  updateInvoiceFormate: R(), getSingleHotel: R(), getTableCatagories: R(),
  getTableForCaptain: R(), addHotelDetails: R(), getHotel: R(),
  addTable: R(), getTable: R(), reservedTable: R(),
  removeTable: R(), editTable: R(),
}));

// ─── User / Customer (extended) ───────────────────────────────────────────────
jest.mock("../../controller/user", () => ({
  findAndUpdateUser: R(), getUserName: R(), generateHotelActivityExcel: R(),
  createCustomerData: R(), updateCostumerData: R(),
  getNumberSuggestion: R(), getImage: R(), userAccess: R(),
  getCaptainUser: R(), updateUser: R(), createCaptain: R(),
  createUser: R(), getRole: R(), checkHotelLogin: R(),
  checkCaptainLogin: R(),
}));

// ─── Menu Controller ──────────────────────────────────────────────────────────
jest.mock("../../controller/menu", () => ({
  uploadMenuFromExcel: R(), menuByCategory: R(),
  searchBySubCatagories: R(), editCatagories: R(),
  searchByShortCode: R(), createMenu: R(), removeCatagories: R(),
  removeMenu: R(), createCatagories: R(), editMenu: R(),
  showCatagories: R(), showMenu: R(), MenuShow: R(),
  checkTableAvailable: R(), searchByCatagories: R(), MenuShowByCatagories: R(),
}));

// ─── Order Controller ─────────────────────────────────────────────────────────
jest.mock("../../controller/order", () => ({
  makeSequenceBillNoOptimized: R(), getAllOrderPaginationWise: R(),
  getOrderTaxDetails: R(), getTimeLineByOrderId: R(),
  settleAllDuePayment: R(), settleDue: R(), getDueOrders: R(),
  getPendingBills: R(), getOrdersByBillNo: R(),
  getSingleOrderForAdminCart: R(), deleteOrder: R(),
  getKotOrder: R(), getDinInOrder: R(), getPickupOrder: R(),
  getHoldOrders: R(), addToCart: R(), getCart: R(),
  removeCartItems: R(), placeOrder: R(), billData: R(),
  billDataForAdmin: R(), getOrders: R(), getSingleOrder: R(),
}));

// ─── Auth (extended) ──────────────────────────────────────────────────────────
jest.mock("../../controller/auth", () => ({
  merchantLogin: R(), merchantLogout: R(), userLogin: R(),
  pdf: R(), restaurantLogin: R(), captainLogin: R(),
  restaurantLogout: R(), pinLogin: R(),
}));

// ─── KTO (extended) ───────────────────────────────────────────────────────────
jest.mock("../../controller/kto", () => ({
  getBusinessDate: R(), ordertimeExtend: R(), ordertimeOver: R(),
  updateOrderToserver: R(), generateHashId: R(), decodeHashId: R(),
  getEbillCredit: R(), creditDebitEbillData: R(), sentEbill: R(),
  getBillViewData: R(), addToTimeLine: R(), generateToken: R(),
  arranPrintersForKotWithTheseItems: R(), updatedInvoiceItems: R(),
  generateKotPdf: R(), kotGeneratePdf: R(), invoiceGeneratePdf: R(),
  reprintkot: R(), rePrintAdminBillData: R(), editOrderClick: R(),
  updateInvoice: R(), settleBills: R(), setPrinter: R(),
  deletePdf: R(), addComment: R(), addToCartForOnClickRetrieveCart: R(),
  test: R(), holdOrder: R(), addToCartAdmin: R(),
  getAdminCart: R(), AdminOrder: R(), removeAdminCartItems: R(),
  adminBillData: R(), removeAdminAllCart: R(), cancelOrder: R(),
  kotOrder: R(),
}));

// ─── Report Controller ────────────────────────────────────────────────────────
jest.mock("../../controller/report", () => ({
  onlineOrderTotalSales: R(), customReportsData: R(),
  salesReport: R(), itemWiseReports: R(), cancelOrderReport: R(),
}));

// ─── Mobile Controllers ───────────────────────────────────────────────────────
jest.mock("../../controller/mobileController/dashBoard", () => ({
  dashBoard: R(), mobileLogin: R(),
}));
jest.mock("../../controller/mobileController/mobiletables", () => ({
  moveMobileKot: R(), moveMobileTable: R(),
  mobileTable: R(), tableWiseKotRetrive: R(),
}));
jest.mock("../../controller/mobileController/items", () => ({
  mobileMenu: R(), mobileCategory: R(),
}));
jest.mock("../../controller/mobileController/kot", () => ({
  getMobileAllPromoCode: R(), sentEbillMobile: R(),
  findAndUpdateUser: R(), getEbillCreditMobile: R(),
  updatedPosData: R(), updateMobileInvoice: R(),
  mobileDeleteOrder: R(), getAllUserInfoToRestaurantWise: R(),
  mobilePickUp: R(), printBill: R(), mobileKotOrder: R(),
  mobileHoldOrder: R(), mobilePrintOrder: R(),
  mobileRemoveAdminCartItems: R(),
}));
jest.mock("../../controller/mobileController/orders", () => ({
  updateOrder: R(), deleteOrder: R(), settleAllDueMobilePayment: R(),
  settleDueMobile: R(), getDueOrdersMobile: R(), serviceCharge: R(),
  orderIdWiseOrderGet: R(), mobileSettleBills: R(), mobileAccess: R(),
  AllInvoice: R(), getMobilePickupOrders: R(),
}));

// ─── Mobile Offline / Getting Data ───────────────────────────────────────────
jest.mock("../../controller/mobileController/offline/gettingData", () => ({
  getMobileTables: R(), gettingMobileAllOrders: R(),
  gettingMobileMenu: R(), gettingHeaderFooter: R(),
}));

// ─── Mobile Report Controller ─────────────────────────────────────────────────
jest.mock("../../controller/mobileController/report", () => ({
  itemWiseReportMobile: R(), getAllMenuCategory: R(),
  itemWiseReportMobileDownnloadExel: R(), salesReportDayWiseMobile: R(),
  salesReportDayWiseMobileDownloadExcel: R(),
  DiscountedOrdersReportMobile: R(), DiscountedOrdersReportMobileExel: R(),
}));

// ─── Table Booking Controller ─────────────────────────────────────────────────
jest.mock("../../controller/tableBooking", () => ({
  getSingleBookingData: R(), deleteBookings: R(),
  tableBooking: R(), updateBooking: R(), getBookingData: R(),
}));

// ─── Invoice Format Controller ────────────────────────────────────────────────
jest.mock("../../controller/incoiceFormate", () => ({
  getFontSizeArray: R(), invoiceSetting: R(), headerFooterContent: R(),
}));

// ─── Printer Setting Controller ───────────────────────────────────────────────
jest.mock("../../controller/printer_setting", () => ({
  setCategoriesForPrinter: R(), setPrinterSetting: R(),
  deletedPrinter: R(), getPrinter: R(), EditPrinterSetting: R(),
}));

// ─── Table Move Controller ────────────────────────────────────────────────────
jest.mock("../../controller/table", () => ({
  moveKot: R(), moveTable: R(),
}));

// ─── Dashboard Controller ─────────────────────────────────────────────────────
jest.mock("../../controller/dashBoard", () => ({
  salesDashBoardData: R(), itemWiseDashBoardData: R(),
}));

// ─── Offline Controller ───────────────────────────────────────────────────────
jest.mock("../../controller/offline/offline", () => ({
  gettingAllRestaurantWhichIsTakenGst: R(), offlineOnlineOrder: R(),
  fetchAllData: R(), syncOrderDataWithDataBase: R(),
  offlineRoles: R(), offlineUserAccess: R(), offlineTableBooking: R(),
  offlinePrinterSetting: R(), offlineInvoiceFormate: R(),
  offlineHotelUser: R(), offlineUser: R(), offlineOrdersDetails: R(),
  offlineOrders: R(), offlineTableCateg: R(), offlineTable: R(),
  offlineMenuCateg: R(), offlineMenu: R(),
}));

// ─── Zomato/Swiggy Controller ─────────────────────────────────────────────────
jest.mock("../../controller/zomotoSwiggy", () => ({
  generateZomatoKot: R(), generateZomatoBill: R(),
  orderStatusChange: R(), GetOrderSFromZomoto: R(),
  items: R(), orderStatus: R(), getOrderHistory: R(),
  orderStatusChangeFromZomato: R(),
}));

// ─── Upload Service ───────────────────────────────────────────────────────────
// uploadMultipleTest / uploadSingleTest / uploadWhatsAppTemplateImage are called
// as factories that return Express middleware — mock them as factory → no-op middleware.
jest.mock("../../services/upload", () => {
  const mw = (_req, _res, next) => next();
  return {
    uploadSingleTest: jest.fn(() => mw),
    uploadMultipleTest: jest.fn(() => mw),
    uploadWhatsAppTemplateImage: jest.fn(() => mw),
    uploadSingleAttachedment: jest.fn(() => mw),
  };
});

// ─── Super Admin (extended) ───────────────────────────────────────────────────
jest.mock("../../controller/superAdmin", () => ({
  addEbillCreditBySuperAdmin: R(), getEbillCreditHistory: R(),
  uploadMenuFromExcelBySuperAdmin: R(), restaurantDetails: R(),
  singleHotelSP: R(), AllInquiry: R(), superAdminLogin: R(),
  checkSuperAdmin: R(), superAdminDashBoardData: R(),
  gettingupcomingRenuale: R(), superAdminNewClientGraph: R(),
  superAdminLogOut: R(), saveAndNext: R(),
  gettingPeddingAddRestoDetails: R(), makePayment: R(),
  deleteAddAdminResto: R(), menuUploadedAndTrainingStatus: R(),
  gettingPrinterRollOrders: R(), updateOrderStatus: R(),
  addProduct: R(), editProduct: R(), addImage: R(),
  updateInqueryStatus: R(), gettingSuperAdminUserList: R(),
  getProductImages: R(),
}));
