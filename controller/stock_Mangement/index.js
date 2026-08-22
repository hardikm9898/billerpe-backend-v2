const { addRawMaterial, editRawMaterial, getAllRawMaterial } = require("./rawMaterial")
const { stockIn, stockInHand, stockOut, StockInOutHistory, deleteStockHistory, editStockHistory, updateManualStock, adjustManualAveragePrice } = require("./stockInOut")
const { addUnit, editUnit, getAllUnit } = require("./unit")
const { createPurchaseOrder, editPurchaseOrder, deletePurchaseorder, paymentDone, getSupplierWisePurchaseOrder, createSupplier, getSupplier, getMaxPo, orderWiserConsumptionReports, getRawMaterialWisePurchaseOrder } = require("./purchaseOrder")
const {
    recordConsumption,
    getConsumptionHistory,
    getConsumptionSummaryByPurpose,
    getConsumptionSummaryByRawMaterial
} = require("./rawMaterialConsumption")

module.exports = {
    getRawMaterialWisePurchaseOrder,
    // Raw Material Consumption Schemas
    adjustManualAveragePrice,
    orderWiserConsumptionReports,
    getSupplierWisePurchaseOrder,

    // Supplier Management
    createSupplier,
    getSupplier,
    getMaxPo,

    // Raw Material Management
    addRawMaterial,
    editRawMaterial,
    getAllRawMaterial,

    // Stock Operations
    stockIn,
    stockInHand,
    stockOut,
    StockInOutHistory,
    deleteStockHistory,
    editStockHistory,

    // Unit Management
    addUnit,
    editUnit,
    getAllUnit,

    // Purchase Order Management
    createPurchaseOrder,
    editPurchaseOrder,
    deletePurchaseorder,

    // Raw Material Consumption
    recordConsumption,
    getConsumptionHistory,
    getConsumptionSummaryByPurpose,
    getConsumptionSummaryByRawMaterial,
    updateManualStock,
    paymentDone
}