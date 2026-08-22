const { Op } = require("sequelize")
const { MESSAGE, STATUSCODE } = require("../../constant/const")
const Hotel = require("../../model/hotel")
const RawMaterial = require("../../model/rawItem")
const Recipes = require("../../model/recipes")
const Unit = require("../../model/unit")
const { error, success, mobileSuccess, mobileError } = require("../../responce/res")
const Menu = require("../../model/menu")
const StockInHand = require("../../model/stockInHand")
const { raw } = require("mysql2")

const addRawMaterial = async (req, res) => {
    try {
        const hotel = await Hotel.findOne({ where: { id: req.user } })
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST))
        const { raw_material_name, purchase_price, unit: unit_id, consumption_unit, conversion_qty, mini_stock_level, mini_stock_level_qty } = req.body
        const rawMaterial = await RawMaterial.findOne({ where: { raw_material_name, hotel_id: req.user } })
        if (rawMaterial) return res.json(error("RawMaterial Name Has Already Taken", STATUSCODE.BAD_REQUEST))
        const findUnit = await Unit.findByPk(unit_id)
        const find2Unit = await Unit.findByPk(consumption_unit)
        if (!findUnit || !find2Unit) return res.json(error("Unit Not Found", STATUSCODE.BAD_REQUEST))
        await RawMaterial.create({ mini_stock_level, mini_stock_level_qty, raw_material_name, purchase_price, unit_id, hotel_id: req.user, consumption_unit, conversion_qty })
        const rawMaterials = await RawMaterial.findAll({ where: { hotel_id: req.user }, include: [{ model: Unit, as: "purchaseUnit" }, { model: Unit, as: "consumptionUnit" }] })
        return res.status(STATUSCODE.CREATED).json(success("RawMaterial Created", { rawMaterials }, STATUSCODE.CREATED))
    } catch (err) {
        console.log(err)
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const getAllRawMaterial = async (req, res) => {
    try {
        const { search } = req.query
        console.log(req.query, "req.params")
        const whereCondition = { hotel_id: req.user }
        if (search) {
            whereCondition.raw_material_name = { [Op.like]: `%${search}%` }
        }

        const hotel = await Hotel.findOne({ where: { id: req.user } })

        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST))
        const rawMaterials = await RawMaterial.findAll({ where: { ...whereCondition }, include: [{ model: Unit, as: "purchaseUnit" }, { model: Unit, as: "consumptionUnit" }] })
        // const rawMaterials = await RawMaterial.findAll({ where: { hotel_id: req.user }, include: [{ model: Unit, as: "purchaseUnit" }, { model: Unit, as: "consumptionUnit" }] })
        return res.status(STATUSCODE.SUCCESS).json(success("RawMaterial Fetch SuccessFully", { rawMaterials }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err)
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const getAllRawMaterialName = async (req, res) => {
    try {
        const hotel = await Hotel.findOne({ where: { id: req.user } })
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST))
        const rawMaterials = await RawMaterial.findAll({ where: { hotel_id: req.user }, attributes: ["id", "raw_material_name", "purchase_price", "unit_id"] })
        return res.status(STATUSCODE.SUCCESS).json(success("RawMaterial Fetch SuccessFully", { rawMaterials }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err)
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const editRawMaterial = async (req, res) => {
    try {

        const hotel = await Hotel.findOne({ where: { id: req.user } })
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST))
        const { raw_material_name, purchase_price, unit: unit_id, id, consumption_unit, conversion_qty, mini_stock_level, mini_stock_level_qty, } = req.body
        const rawMaterial = await RawMaterial.findOne({ where: { id } })
        if (!rawMaterial) return res.json(error("RawMaterial Not Found", STATUSCODE.BAD_REQUEST))
        const findUnit = await Unit.findByPk(unit_id)
        const fin2Unit = await Unit.findByPk(consumption_unit)
        if (!findUnit || !fin2Unit) return res.json(error("Unit Not Found", STATUSCODE.BAD_REQUEST))

        const check = await StockInHand.findOne({ where: { raw_material_id: id } })
        if (check) {

            if (check.available_stock_Consiompsion_qty > 0 && (rawMaterial.unit_id !== unit_id || rawMaterial.consumption_unit !== consumption_unit || rawMaterial.conversion_qty !== conversion_qty)) {

                if (rawMaterial.unit_id !== unit_id) {
                    return res.json(error("You can't change Purchase Unit of raw material after stock in", STATUSCODE.BAD_REQUEST))
                } if (rawMaterial.consumption_unit !== consumption_unit) {
                    return res.json(error("You can't change Consumption Unit of raw material after stock in", STATUSCODE.BAD_REQUEST))
                }
                if (rawMaterial.conversion_qty !== conversion_qty) {
                    return res.json(error("You can't change Conversion Qty of raw material after stock in", STATUSCODE.BAD_REQUEST))
                }
                // return res.json(error("You can't change Consumption Unit and purchase Unit and Convertion Qty of raw material after stock in", STATUSCODE.BAD_REQUEST))
            }
        }
        await RawMaterial.update({ mini_stock_level, mini_stock_level_qty, raw_material_name, purchase_price, unit_id, consumption_unit, conversion_qty }, { where: { id } })
        const rawMaterials = await RawMaterial.findAll({ where: { hotel_id: req.user }, include: [{ model: Unit, as: "purchaseUnit" }, { model: Unit, as: "consumptionUnit" }] })
        return res.status(STATUSCODE.SUCCESS).json(success("RawMaterial Updated", { rawMaterials }, STATUSCODE.SUCCESS))

    } catch (err) {
        console.log(err)
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const checkStockLevel = async (req, res) => {
    try {
        const { id } = req.body
        const checkStockTrackOn = await Menu.findOne({ where: { id, hotel_id: req.user }, attributes: ['id', 'item_name', 'stockTrack'] });
        if (!checkStockTrackOn || !checkStockTrackOn?.stockTrack) {
            return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { message: "No Stock Found On This Item", popup: false }, STATUSCODE.SUCCESS))
        }
        const recipes = await Recipes.findAll({ where: { menu_id: id } });

        if (!recipes || recipes.length === 0) {
            return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { message: "No Recipes Found For This Menu", popup: false }, STATUSCODE.SUCCESS));
        }

        for (const recipe of recipes) {
            // console.log(recipe, "recipe")
            const rawMaterial = await RawMaterial.findOne({ where: { id: recipe.raw_material_id, hotel_id: req.user }, attributes: ['raw_material_name', 'conversion_qty', 'mini_stock_level_qty', 'mini_stock_level'] });
            console.log(rawMaterial, "stockInHand")
            if (!rawMaterial) continue;
            if (!rawMaterial.mini_stock_level) continue;
            const stockInHand = await StockInHand.findOne({ where: { raw_material_id: recipe.raw_material_id, hotel_id: req.user }, attributes: ["available_stock_Consiompsion_qty"] });
            console.log(stockInHand, "stockInHand")
            if (!stockInHand) continue;
            const currentStock = stockInHand.available_stock_Consiompsion_qty / rawMaterial.conversion_qty;
            console.log(currentStock, "Current Stock-->")
            if (currentStock < rawMaterial.mini_stock_level_qty) {
                return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, {
                    item_name: checkStockTrackOn.item_name,
                    raw_material_name: rawMaterial.raw_material_name,
                    currentStock, popup: true
                }, STATUSCODE.SUCCESS));

            }
        }

        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { message: "This is available to consumption", popup: false }, STATUSCODE.SUCCESS));


    } catch (error) {
        console.log(error)
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const checkStockLevelMobile = async (req, res) => {
    try {
        const { id } = req.body
        const checkStockTrackOn = await Menu.findOne({ where: { id, hotel_id: req.user }, attributes: ['id', 'item_name', 'stockTrack'] });
        if (!checkStockTrackOn || !checkStockTrackOn?.stockTrack) {
            console.log("No Stock Found On This Item")
            return res.status(STATUSCODE.SUCCESS).json(mobileError("No Stock Found On This Item", STATUSCODE.BAD_REQUEST));
            // return res.status(STATUSCODE.SUCCESS).json(mobileSuccess(MESSAGE.SUCCESS, { message: "No Stock Found On This Item", popup: false }, "No Stock Found On This Item", STATUSCODE.SUCCESS))
        }
        const recipes = await Recipes.findAll({ where: { menu_id: id } });

        if (!recipes || recipes.length === 0) {
            console.log("No Recipes Found For This Menu")
            return res.status(STATUSCODE.SUCCESS).json(mobileError("No Recipes Found For This Menu", STATUSCODE.BAD_REQUEST));
        }

        for (const recipe of recipes) {
            // console.log(recipe, "recipe")
            const rawMaterial = await RawMaterial.findOne({ where: { id: recipe.raw_material_id, hotel_id: req.user }, attributes: ['raw_material_name', 'conversion_qty', 'mini_stock_level_qty', 'mini_stock_level'] });
            console.log("RawMaterial")
            if (!rawMaterial) continue;
            console.log("minmumStock Levl", rawMaterial.mini_stock_level)
            if (!rawMaterial.mini_stock_level) continue;
            const stockInHand = await StockInHand.findOne({ where: { raw_material_id: recipe.raw_material_id, hotel_id: req.user }, attributes: ["available_stock_Consiompsion_qty"] });
            console.log("stockInHand")
            if (!stockInHand) continue;
            const currentStock = stockInHand.available_stock_Consiompsion_qty / rawMaterial.conversion_qty;
            console.log("Current Stock-->")
            if (currentStock < rawMaterial.mini_stock_level_qty) {

                return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, {
                    item_name: checkStockTrackOn.item_name,
                    message: `Your Raw Material ${rawMaterial.raw_material_name} is low, Do you want to continue billing with low stock ?`,
                    raw_material_name: rawMaterial.raw_material_name,
                    currentStock, popup: true
                }, STATUSCODE.SUCCESS));



            }
        }
        console.log("responce")

        return res.status(STATUSCODE.SUCCESS).json(mobileSuccess(MESSAGE.SUCCESS, { message: "This is available to consumption", popup: false }, "This is available to consumption", STATUSCODE.SUCCESS));


    } catch (error) {
        console.log(error)
        return res.json(mobileError(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

module.exports = { checkStockLevelMobile, checkStockLevel, addRawMaterial, getAllRawMaterial, editRawMaterial, getAllRawMaterialName }