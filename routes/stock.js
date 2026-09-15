const express = require("express")
const router = express.Router()
const { validator, queryValidator } = require("../middleware/validator")
const { adminAuth, mobileAuth } = require("../middleware/adminAuth")
const {
    // Raw Material Management
    addRawMaterial,
    editRawMaterial,
    getAllRawMaterial,

    // Unit Management
    addUnit,
    editUnit,
    getAllUnit,

    // Stock Operations
    stockInHand,
    stockIn,
    stockOut,
    StockInOutHistory,
    deleteStockHistory,
    editStockHistory,

    // Purchase Order Management
    createPurchaseOrder,
    editPurchaseOrder,
    deletePurchaseorder,

    // Raw Material Consumption
    recordConsumption,
    getConsumptionHistory,
    getConsumptionSummaryByPurpose,
    getConsumptionSummaryByRawMaterial,
    paymentDone, updateManualStock,
    adjustManualAveragePrice
} = require("../controller/stock_Mangement")
const {
    // Raw Material Consumption Schemas
    recordConsumptionSchema,
    consumptionHistoryQuerySchema,
    consumptionSummaryQuerySchema,

    // Purchase Order Schemas
    createPurchaseOrderSchema,
    updatePurchaseOrderSchema,
    deletePurchaseOrderSchema,

    // Other Schemas
    hotelSchema,
    userSchema,
    tableSchema,
    menuSchema,
    bookTable,
    addRawMaterialSchema,
    addUnitSchema,
    editUnitSchema,
    editRawMaterialSchema,
    deleteStockHiStorySchema,
    editStockHistorySchema,
    inOutStockSchema,
    outStockSchema,
    paymentDoneSchema,
    westageCreateValidaionSchema
} = require("../validation/validate")
const { getAllRawMaterialName, checkStockLevel, checkStockLevelMobile } = require("../controller/stock_Mangement/rawMaterial")
const { getPurchaseOrders, createSupplier, getSupplier, getMaxPo, getSupplierWisePurchaseOrder, orderWiserConsumptionReports, getRawMaterialWisePurchaseOrder, editSupplier } = require("../controller/stock_Mangement/purchaseOrder")
const { get } = require("https")
const { createRawMaterialWastage, getWastageRecords, deleteWastageRecord, getWastageRecordsExcel } = require("../controller/stock_Mangement/westage")
const {
    getRequisitions, createRequisition, setRequisitionStatus,
    setRequisitionItemQty, removeRequisition, fulfilRequisition,
} = require("../controller/requisition")

// Purchase Order Routes
router.post("/purchaseOrder", adminAuth, validator(createPurchaseOrderSchema), createPurchaseOrder)
router.put("/purchaseOrder", adminAuth, validator(updatePurchaseOrderSchema), editPurchaseOrder)
router.delete("/purchaseOrder", adminAuth, validator(deletePurchaseOrderSchema), deletePurchaseorder)
router.get("/purchaseOrder", adminAuth, getPurchaseOrders)
router.post("/payment", adminAuth, validator(paymentDoneSchema), paymentDone)
router.post("/manualStock", adminAuth, updateManualStock)
router.post("/manualAveragePrice", adminAuth, adjustManualAveragePrice)

// Supplier Routes
router.post("/supplier", adminAuth, createSupplier)
router.put("/supplier", adminAuth, editSupplier)
router.get("/supplier", adminAuth, getSupplier)
router.get("/supplierWisePurchaseOrder", adminAuth, getSupplierWisePurchaseOrder)
router.get("/rawMaterialWisePurchase", adminAuth, getRawMaterialWisePurchaseOrder)
router.get("/maxPo", adminAuth, getMaxPo)

// Requisition Routes
router.get("/requisition", adminAuth, getRequisitions)
router.post("/requisition", adminAuth, createRequisition)
router.post("/requisitionStatus", adminAuth, setRequisitionStatus)
router.post("/requisitionItemQty", adminAuth, setRequisitionItemQty)
router.post("/requisitionRemove", adminAuth, removeRequisition)
router.post("/requisitionFulfil", adminAuth, fulfilRequisition)


// Raw Material Consumption Routes
router.post("/consumption", adminAuth, validator(recordConsumptionSchema), recordConsumption)
router.get("/orderWiseConsumption", adminAuth, orderWiserConsumptionReports)
router.get("/consumption", adminAuth, queryValidator(consumptionHistoryQuerySchema), getConsumptionHistory)
router.get("/consumption/summary/purpose", adminAuth, queryValidator(consumptionSummaryQuerySchema), getConsumptionSummaryByPurpose)
router.get("/consumption/summary/material", adminAuth, queryValidator(consumptionSummaryQuerySchema), getConsumptionSummaryByRawMaterial)
router.post("/addRowMaterial", adminAuth, validator(addRawMaterialSchema), addRawMaterial)
router.put("/editRowMaterial", adminAuth, validator(editRawMaterialSchema), editRawMaterial)
router.get("/getAllRawMaterial", adminAuth, getAllRawMaterial)
router.get("/getAllRawMaterialName", adminAuth, getAllRawMaterialName)
router.post("/addUnit", adminAuth, validator(addUnitSchema), addUnit)
router.put("/editUnit", adminAuth, validator(editUnitSchema), editUnit)
router.get("/getAllUnit", adminAuth, getAllUnit)
router.get("/stockInHand", adminAuth, stockInHand)
router.post("/stockIn", adminAuth, validator(inOutStockSchema), stockIn)
router.post("/stockOut", adminAuth, validator(outStockSchema), stockOut)
router.get("/stockHistory", adminAuth, StockInOutHistory)
router.delete("/stockHistory", adminAuth, queryValidator(deleteStockHiStorySchema), deleteStockHistory)
router.put("/stockHistory", adminAuth, validator(editStockHistorySchema), editStockHistory)
router.post("/checkStockLevel", adminAuth, checkStockLevel)
router.post("/checkStockLevelMobile", mobileAuth, checkStockLevelMobile)



//Wastage Routes

router.post("/wastage", adminAuth, validator(westageCreateValidaionSchema), createRawMaterialWastage)
router.get("/wastage", adminAuth, getWastageRecords)
router.delete("/wastage/:wastage_id", adminAuth, deleteWastageRecord)
router.get("/wastageExcel", adminAuth, getWastageRecordsExcel)


module.exports = router