const express = require("express")
const router = express.Router()
const { validator, queryValidator } = require("../middleware/validator")
const { adminAuth } = require("../middleware/adminAuth")
const { addRecipes, editRecipes, getAllRecipes, getSingleRecipes, deleteRecipe } = require("../controller/recipes")
const { addRecipeSchema } = require("../validation/validate")
const {
    createKitchen,
    getAllKitchen,
    setCategoryForKitchen,
    getKitchenDataById,
    getLiveOrders,
    markItemReady,
    deleteKitchen,
    recallKot
} = require("../controller/kds/kds")

router.get("/kitchens/:id", adminAuth, getKitchenDataById)
router.get("/kitchens", adminAuth, getAllKitchen)
router.post("/kitchens", adminAuth, createKitchen)
router.post("/setCategoryForKitchen", adminAuth, setCategoryForKitchen)
// router.put("/Kitchen", adminAuth, editRecipes)
router.delete("/deleteKitchen/:id", adminAuth, deleteKitchen)
router.get("/recallKot", adminAuth, recallKot)
// router.get("/kitchenWiseKot/:id")

// KDS specific routes
router.get("/kds/orders/:kitchenId", adminAuth, getLiveOrders)
router.post("/kds/items/ready", adminAuth, markItemReady)

module.exports = router