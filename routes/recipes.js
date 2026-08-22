const express = require("express")
const router = express.Router()
const { validator, queryValidator } = require("../middleware/validator")
const { adminAuth } = require("../middleware/adminAuth")
const { addRecipes, editRecipes, getAllRecipes, getSingleRecipes, deleteRecipe, getAllRecipesForMenu } = require("../controller/recipes")
const { addRecipeSchema } = require("../validation/validate")

router.post("/addRecipe", adminAuth, addRecipes)
router.put("/editRecipe", adminAuth, editRecipes)
router.delete("/deleteRecipe", adminAuth, deleteRecipe)
router.get("/getAllRecipes", adminAuth, getAllRecipes)
router.get("/getAllRecipesForMenu", adminAuth, getAllRecipesForMenu)
router.get("/getSingleRecipes", adminAuth, getSingleRecipes)

module.exports = router