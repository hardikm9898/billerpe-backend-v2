const express = require("express")
const { merchantAuth } = require("../middleware/merchantauth")
const loginLimiter = require("../middleware/loginLimiter")
const { merchantLogin, merchantLogout } = require("../controller/auth")
const { checkMerchant, dashBoard, getHotel, multipleHotelData, merchantMenu, merchantCategory, merchantVarint, merchantAddons, merchantUpdateManualStock, merchantStockInHand, merchantStockInOutHistory, merchantUnitEdit, merchantAddUnit, merchantGetAllUnit, merchantGetAllRawMaterial, merchantAddRawMaterial, merchantEditRawMaterial, merchantGetAllRecipes, merchantGetSingleRecipes, merchantDeleteRecipe, menuForRecipe, merchantGetAllRecipesForMenu, menuDetailsForRecipe, uploadMenuItemImage, getMenuItemAddons, getMenuItemVariants, bulkDeleteMenuItems, bulkDeactivateMenuItems, bulkActivateMenuItems, deleteMenuItem, toggleMenuItemStatus, updateMenuItem, merchantCategoryAll, createMenuItem, setMenuAddons, setMenuVariants, deleteMerchantCategory, createMerchantCategory, updateMerchantCategory, createMerchantVariant, updateMerchantVariant, updateMerchantAddonDepartment, createMerchantAddonDepartment } = require("../controller/merchant/merchant")
const { addRawMaterialSchema, editRawMaterialSchema } = require("../validation/validate")
const { validator } = require("../middleware/validator")
const { getSingleRecipes } = require("../controller/recipes")
const { createAddonDepartment } = require("../controller/Variant/addon")
const router = express.Router()

router.post("/login", loginLimiter, merchantLogin)
router.post("/logout", merchantLogout)
router.get("/checkMerchant", merchantAuth, checkMerchant)
router.get("/merchantHotel", merchantAuth, getHotel)
router.get("/hotelWiseData/:id", merchantAuth, dashBoard)
router.get("/multipleHotelData", merchantAuth, multipleHotelData)

// router.get("/kitchenWiseKot/:id")

router.get("/menu", merchantAuth, merchantMenu)
router.post("/menu", merchantAuth, createMenuItem)
router.put('/menu/:id', merchantAuth, updateMenuItem);            // [4] edit item (inline)
router.patch('/menu/:id/status', merchantAuth, toggleMenuItemStatus);      // [5] toggle active/inactive
router.delete('/menu/:id', merchantAuth, deleteMenuItem);            // [6] soft delete single

// ── BULK OPERATIONS ───────────────────────────────────────────────────────────
// IMPORTANT: bulk routes MUST come before /:id routes to avoid param collision
router.patch('/menu/bulk/activate', merchantAuth, bulkActivateMenuItems);    // [7] bulk activate
router.patch('/menu/bulk/deactivate', merchantAuth, bulkDeactivateMenuItems);  // [8] bulk deactivate
router.delete('/menu/bulk', merchantAuth, bulkDeleteMenuItems);      // [9] bulk soft delete

// ── VARIANTS & ADDONS (modal detail views) ────────────────────────────────────
router.post('/menu/variants', merchantAuth, setMenuVariants);      // [10] variants modal
router.post('/menu/addons', merchantAuth, setMenuAddons);        // [11] addons modal

// ── IMAGE UPLOAD ──────────────────────────────────────────────────────────────
// router.post('/menu/:id/image',    upload.single('image'), uploadMenuItemImage); // [12]

router.get("/category", merchantAuth, merchantCategory)
router.put("/category/:id", merchantAuth, updateMerchantCategory)
router.post("/category", merchantAuth, createMerchantCategory)
router.delete("/category/:id", merchantAuth, deleteMerchantCategory)
router.get("/categoryAll", merchantAuth, merchantCategoryAll)
router.get("/variant", merchantAuth, merchantVarint)
router.post("/variant", merchantAuth, createMerchantVariant)
router.put("/variant/:id", merchantAuth, updateMerchantVariant)
router.get("/addon", merchantAuth, merchantAddons)
router.post("/addon", merchantAuth, createMerchantAddonDepartment)
router.put("/addon/:id", merchantAuth, updateMerchantAddonDepartment)

router.post("/stock/manualStock", merchantAuth, merchantUpdateManualStock)
router.get("/stock/stockInHand", merchantAuth, merchantStockInHand)
router.get("/stock/stockHistory", merchantAuth, merchantStockInOutHistory)

// unit
router.put("/stock/editunit", merchantAuth, merchantUnitEdit)
router.post("/stock/addUnit", merchantAuth, merchantAddUnit)
router.get("/stock/getAllUnit", merchantAuth, merchantGetAllUnit)

// Raw Material 
router.get("/stock/getAllRawMaterial", merchantAuth, merchantGetAllRawMaterial)
router.post("/stock/addRowMaterial", merchantAuth, validator(addRawMaterialSchema), merchantAddRawMaterial)
router.put("/stock/editRowMaterial", merchantAuth, validator(editRawMaterialSchema), merchantEditRawMaterial)

// Recipes 


router.get("/recipes/getAllRecipes", merchantAuth, merchantGetAllRecipes)
router.get("/recipes/getSingleRecipes", merchantAuth, merchantGetSingleRecipes)
router.delete("/recipes/deleteRecipe", merchantAuth, merchantDeleteRecipe)
router.get("/recipes/menu", merchantAuth, menuForRecipe)
router.get("/recipes/getAllRecipesForMenu", merchantAuth, merchantGetAllRecipesForMenu)
router.get("/recipes/menu_details", merchantAuth, menuDetailsForRecipe)



module.exports = router