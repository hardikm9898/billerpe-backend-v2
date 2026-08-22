


const { MESSAGE, STATUSCODE } = require("../../constant/const")
const StockInHand = require("../../model/stockInHand")

const { error, success } = require("../../responce/res")
const StockHistory = require("../../model/stockHistory")

const RawMaterial = require("../../model/rawItem")
const Unit = require("../../model/unit")
const { Op } = require("sequelize")
const { getBusinessDate } = require("../../utils/dateUtils")
const RestaurantSetting = require("../../model/restaurantSetting")


const stockInFunction = async (data, res) => {
    try {

        const { qty, raw_material_id, price, hotel_id, userId } = data
        const checkRawMaterial = await RawMaterial.findOne({ where: { id: raw_material_id, hotel_id }, })
        if (!checkRawMaterial) return res.json(error("Raw materiale Not Found", STATUSCODE.BAD_REQUEST))
        const purchase_price = checkRawMaterial.purchase_price
        const findMaterial = await StockInHand.findOne({ where: { raw_material_id, hotel_id, deleted: false }, include: { model: RawMaterial } })
        let available_stock_Consiompsion_qty = 1

        if (checkRawMaterial.unit !== checkRawMaterial.consumption_unit) {
            available_stock_Consiompsion_qty = checkRawMaterial.conversion_qty * qty
        }
        if (findMaterial) {
            const average_price = ((price * qty) + (findMaterial.average_price * findMaterial.qty)) / (findMaterial.qty + qty).toFixed(2)
            const available_stock_Consiompsion_qty = ((findMaterial.qty + qty) * findMaterial.hms_rawMaterial_mst.conversion_qty)
            const updatedQty = findMaterial.qty + qty
            const total_amount = `${(average_price * updatedQty)}`

            await StockInHand.update({ available_stock_Consiompsion_qty, qty: updatedQty, total_amount, average_price }, { where: { raw_material_id, hotel_id, deleted: false } })
        } else {
            await StockInHand.create({ average_price: price, available_stock_Consiompsion_qty, qty: qty, total_amount: `${(price * qty)}`, price, hotel_id, raw_material_id })
        }
        const setting = await RestaurantSetting.findOne({ where: { hotel_id: hotel_id } });
        const timeZone = setting?.timeZone || 'Asia/Kolkata';
        const businessStartTime = setting?.business_day_start_time || '00:01:00';
        const business_date = getBusinessDate(timeZone, businessStartTime);

        await StockHistory.create({ business_date, price: price, total_amount: `${qty * price}`, qty, raw_material_id, stock_in: true, hotel_id, user_id: userId })
    } catch (error) {
        throw new Error(error)
    }
}

const stockIn = async (req, res) => {
    try {
        const { qty, raw_material_id, price } = req.body
        console.log(req.body)

        await stockInFunction({ qty, raw_material_id, price, hotel_id: req.user, userId: req.userId }, res)
        // const checkRawMaterial = await RawMaterial.findOne({ where: { id: raw_material_id, hotel_id: req.user }, })
        // if (!checkRawMaterial) return res.json(error("Raw materiale Not Found", STATUSCODE.BAD_REQUEST))
        // const purchase_price = checkRawMaterial.purchase_price
        // const findMaterial = await StockInHand.findOne({ where: { raw_material_id, hotel_id: req.user, deleted: false }, include: { model: RawMaterial } })
        // let available_stock_Consiompsion_qty = 1

        // if (checkRawMaterial.unit !== checkRawMaterial.consumption_unit) {
        //     available_stock_Consiompsion_qty = checkRawMaterial.conversion_qty * qty
        // }
        // if (findMaterial) {
        //     const average_price = ((price * qty) + (findMaterial.average_price * findMaterial.qty)) / (findMaterial.qty + qty).toFixed(2)
        //     const available_stock_Consiompsion_qty = ((findMaterial.qty + qty) * findMaterial.hms_rawMaterial_mst.conversion_qty)
        //     const updatedQty = findMaterial.qty + qty
        //     const total_amount = `${(average_price * updatedQty)}`

        //     await StockInHand.update({ available_stock_Consiompsion_qty, qty: updatedQty, total_amount, average_price }, { where: { raw_material_id, hotel_id: req.user, deleted: false } })
        // } else {
        //     await StockInHand.create({ average_price: price, available_stock_Consiompsion_qty, qty: qty, total_amount: `${(price * qty)}`, price, hotel_id: req.user, raw_material_id })
        // }
        // // if (qty > findMaterial.qty) return res.json(error("Please Enter Qty Less Than Or Equal To In-Hand Stock ", STATUSCODE.BAD_REQUEST))
        // await StockHistory.create({ price: price, total_amount: `${qty * price}`, qty, raw_material_id, stock_in: true, hotel_id: req.user, user_id: req.userId })



        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { message: "Stock Added Successfully" }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err)
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const stockOut = async (req, res) => {
    try {
        const { qty, raw_material_id } = req.body
        console.log(req.body, "Data-->")
        const findMaterial = await StockInHand.findOne({ where: { raw_material_id, hotel_id: req.user, deleted: false }, include: { model: RawMaterial } })
        if (!findMaterial) return res.json(error("This Items Is Not In Stock", STATUSCODE.BAD_REQUEST))
        const average_price = findMaterial.average_price
        const available_stock_Consiompsion_qty = 1
        if (findMaterial.unit !== findMaterial.consumption_unit) {
            available_stock_Consiompsion_qty = findMaterial.conversion_qty * qty
        }
        if (qty > findMaterial.qty) return res.json(error("Please Enter Qty Less Than Or Equal To In-Hand Stock ", STATUSCODE.BAD_REQUEST))
        if (qty == findMaterial.qty) {
            await StockInHand.destroy({ where: { raw_material_id, hotel_id: req.user } })
        } else {
            await StockInHand.update({ available_stock_Consiompsion_qty: ((findMaterial.qty - qty) * findMaterial.hms_rawMaterial_mst.conversion_qty), qty: +findMaterial.qty - qty, total_amount: `${(+findMaterial.average_price * (+findMaterial.qty - qty))}` }, { where: { deleted: false, raw_material_id, hotel_id: req.user } })
        }

        const setting = await RestaurantSetting.findOne({ where: { hotel_id: req.user } });
        const timeZone = setting?.timeZone || 'Asia/Kolkata';
        const businessStartTime = setting?.business_day_start_time || '00:01:00';
        const business_date = getBusinessDate(timeZone, businessStartTime);

        await StockHistory.create({ business_date, price: `${average_price}`, total_amount: `${qty * average_price}`, qty, stock_in: false, raw_material_id, hotel_id: req.user, user_id: req.userId })
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { message: "Stock Out Successfully" }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err)
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const stockInHand = async (req, res) => {
    try {
        const { search } = req.query
        console.log(req.params)

        const whereCondition = { hotel_id: req.user }
        if (search) {
            whereCondition.raw_material_name = { [Op.like]: `%${search}%` }
        }

        const stockInHand = await StockInHand.findAll({ where: { hotel_id: req.user, deleted: false }, include: { model: RawMaterial, where: { ...whereCondition }, required: true, include: [{ model: Unit, as: "purchaseUnit" }, { model: Unit, as: "consumptionUnit" }] } })
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { stockInHand }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err)
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const StockInOutHistory = async (req, res) => {
    try {
        const { startDate, endDate } = req.query
        const startD = new Date(startDate)
        const endD = new Date(endDate)
        const stockInOutHistory = await StockHistory.findAll({ where: { hotel_id: req.user, deleted: false, createdAt: { [Op.between]: [startD, endD] } }, include: { model: RawMaterial, include: [{ model: Unit, as: "purchaseUnit" }, { model: Unit, as: "consumptionUnit" }] } })
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { stockInOutHistory }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err)
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const editStockHistory = async (req, res) => {
    try {

        const { qty, raw_material_id, id } = req.body;

        // Find the stock history entry by ID

        const findStockHistory = await StockHistory.findOne({ where: { id, deleted: false } });
        if (!findStockHistory) {
            return res.json(error("Stock History Not Found", STATUSCODE.BAD_REQUEST));
        }

        // Check if the raw material is available in stock
        const checkQtyAvailableInStock = await StockInHand.findOne({
            where: { raw_material_id, hotel_id: req.user, deleted: false }
        });
        if (!checkQtyAvailableInStock) {

            if (!findStockHistory.stock_in && findStockHistory.qty > qty) {
                const { price, hotel_id, raw_material_id } = findStockHistory
                const rawMaterial = await RawMaterial.findOne({ where: { id: raw_material_id } })
                await StockInHand.create({ total_amount: (findStockHistory.qty - qty) * price, available_stock_Consiompsion_qty: rawMaterial.conversion_qty * qty, qty: (findStockHistory.qty - qty), price, hotel_id, raw_material_id })
                await StockHistory.update(
                    { qty, raw_material_id, total_amount: qty * findStockHistory.price },
                    { where: { id } }
                );
                return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { message: "Stock Updated" }, STATUSCODE.SUCCESS))
            }
            else if (!findStockHistory.stock_in && findStockHistory.qty === qty) {
                return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { message: "Stock Updated" }, STATUSCODE.SUCCESS))
            }
            else {

                return res.json(error("This Item Is Not In Stock", STATUSCODE.BAD_REQUEST));
            }
        }

        // Handle the quantity change logic
        const qtyDifference = qty - findStockHistory.qty;
        console.log(qtyDifference, "QTY Diference--------->>>>>>>")
        if (qtyDifference > 0) {
            // Case: New quantity is greater than old quantity
            if (!findStockHistory.stock_in) {
                if (checkQtyAvailableInStock.qty < qtyDifference) {
                    console.log("step-------------8")
                    return res.json(error("Please Enter Qty Less Than Or Equal To In-Hand Stock", STATUSCODE.INTERNAL_SERVER_ERROR));
                }

                if (checkQtyAvailableInStock.qty === qtyDifference) {
                    console.log("step-------------1")
                    // All stock used, destroy the stock entry
                    await StockInHand.destroy({ where: { raw_material_id, hotel_id: req.user } });
                } else {
                    console.log("step-------------2")
                    if (checkQtyAvailableInStock.qty < qtyDifference) {
                        console.log("step-------------8")
                        return res.json(error("Please Enter Qty Less Than Or Equal To In-Hand Stock", STATUSCODE.INTERNAL_SERVER_ERROR));
                    }
                    // Deduct the difference from available stock
                    await StockInHand.update(
                        { qty: checkQtyAvailableInStock.qty - qtyDifference, total_amount: (checkQtyAvailableInStock.qty - qtyDifference) * checkQtyAvailableInStock.price },
                        { where: { deleted: false, raw_material_id, hotel_id: req.user } }
                    );
                }
            } else {
                // If stock is being added
                console.log("step-------------3")
                await StockInHand.update(
                    { qty: checkQtyAvailableInStock.qty + qtyDifference, total_amount: (checkQtyAvailableInStock.qty + qtyDifference) * checkQtyAvailableInStock.price },
                    { where: { deleted: false, raw_material_id, hotel_id: req.user } }
                );
            }
        } else if (qtyDifference < 0) {
            // Case: New quantity is less than old quantity
            const absoluteQtyDiff = Math.abs(qtyDifference);

            if (!findStockHistory.stock_in) {

                console.log("step-------------6")
                await StockInHand.update(
                    { qty: checkQtyAvailableInStock.qty + absoluteQtyDiff, total_amount: (checkQtyAvailableInStock.qty + absoluteQtyDiff) * checkQtyAvailableInStock.price },
                    { where: { deleted: false, raw_material_id, hotel_id: req.user } }
                );
                // }
            } else {
                console.log("step-------------7")

                if (checkQtyAvailableInStock.qty < absoluteQtyDiff) {
                    console.log("step-------------4")
                    return res.json(error("Please Enter Qty Less Than Or Equal To In-Hand Stock", STATUSCODE.INTERNAL_SERVER_ERROR));
                }
                if (checkQtyAvailableInStock.qty === absoluteQtyDiff) {
                    // All stock used, destroy the stock entry
                    console.log("step-------------5")
                    await StockInHand.destroy({ where: { raw_material_id, hotel_id: req.user } });
                } else {
                    await StockInHand.update(
                        { qty: checkQtyAvailableInStock.qty - absoluteQtyDiff, total_amount: (checkQtyAvailableInStock.qty - absoluteQtyDiff) * checkQtyAvailableInStock.price },
                        { where: { deleted: false, raw_material_id, hotel_id: req.user } }
                    );
                }
            }
        }
        await StockHistory.update(
            { qty, raw_material_id, total_amount: qty * findStockHistory.price },
            { where: { id } }
        );

        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { message: "Stock Updated" }, STATUSCODE.SUCCESS));
    } catch (err) {
        console.error(err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

const deleteStockHistory = async (req, res) => {
    try {
        const { id } = req.query
        const findHistory = await StockHistory.findOne({ where: { id, deleted: false } })
        if (!findHistory) return res.json(error("Stock History Not Found", STATUSCODE.BAD_REQUEST))
        const findStockInHand = await StockInHand.findOne({ where: { deleted: false, hotel_id: req.user, raw_material_id: findHistory.raw_material_id } })
        if (!findStockInHand) {
            if (!findHistory.stock_in) {
                const { qty, total_amount, price, hotel_id, raw_material_id } = findHistory
                const rawMaterial = await RawMaterial.findOne({ where: { id: raw_material_id } })
                await StockInHand.create({ total_amount, available_stock_Consiompsion_qty: rawMaterial.conversion_qty * qty, qty, price, hotel_id, raw_material_id })
                await StockHistory.update({ deleted: true }, { where: { id } })

                return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { message: "Stock Deleted Successfully" }, STATUSCODE.SUCCESS))
            }
            else {

                return res.json(error("You can't Delete, In-Hand Stock Not Available", STATUSCODE.BAD_REQUEST))
            }
        }

        if (findHistory.stock_in) {
            if (findStockInHand.qty < findHistory.qty) return res.json(error("You can't Delete, In-Hand Stock Not Available", STATUSCODE.BAD_REQUEST))
            if (findStockInHand.qty === findHistory.qty) {
                await StockInHand.destroy({ where: { id: findStockInHand.id, deleted: false } })
            } else {
                await StockInHand.update({ qty: findStockInHand.qty - findHistory.qty, total_amount: (findStockInHand.qty - findHistory.qty) * findStockInHand.price }, { where: { id: findStockInHand.id } })
            }

        } else {
            await StockInHand.update({ qty: findStockInHand.qty + findHistory.qty, total_amount: (findStockInHand.qty + findHistory.qty) * findHistory.price }, { where: { id: findStockInHand.id } })
        }
        await StockHistory.update({ deleted: true }, { where: { id } })
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { message: "Stock Deleted Successfully" }, STATUSCODE.SUCCESS))

    } catch (err) {
        console.log(err)
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const updateManualStock = async (req, res) => {
    try {
        const { manualStockData } = req.body
        for (const cur of manualStockData) {
            let available_stock_Consiompsion_qty = 0
            let qty = 0

            if (cur.conversion_qty === 1) {
                qty = cur.purchase_stock
                available_stock_Consiompsion_qty = cur.purchase_stock
            }
            else {
                console.log("here")
                if (cur.consumption_stock) {

                    console.log(cur, "here insdie consumption")
                    if (cur.purchase_stock) {
                        qty = (cur.purchase_stock + (+cur.consumption_stock / +cur.conversion_qty)).toFixed(2)
                        available_stock_Consiompsion_qty = (+cur.purchase_stock * +cur.conversion_qty) + cur.consumption_stock
                    }
                    else {
                        qty = +(+cur.consumption_stock / +cur.conversion_qty).toFixed(2)
                        available_stock_Consiompsion_qty = cur.consumption_stock
                    }

                    console.log(qty, "qty", available_stock_Consiompsion_qty, "available consumption Qty", cur.consumption_stock, "consumtion stock", cur.conversion_qty, "conversiont qty", cur.purchase_stock, "purchase Stock")
                } else {
                    console.log("here insdie purhase")
                    qty = Number((cur.purchase_stock).toFixed(2))
                    available_stock_Consiompsion_qty = (+cur.purchase_stock * +cur.conversion_qty)
                }
            }

            const getCurrentStockInHand = await StockInHand.findByPk(cur.id)
            console.log(getCurrentStockInHand, "Surrent stock")
            if (getCurrentStockInHand) {
                let stock_in = true
                let difference = 0
                console.log(getCurrentStockInHand.qty)
                if (qty > getCurrentStockInHand.qty) {
                    difference = qty - getCurrentStockInHand.qty
                }
                else {
                    stock_in = false
                    difference = getCurrentStockInHand.qty - qty
                }
                console.log(difference, "Difference-->")
                if (difference !== 0) {

                    const setting = await RestaurantSetting.findOne({ where: { hotel_id: req.user } });
                    const timeZone = setting?.timeZone || 'Asia/Kolkata';
                    const businessStartTime = setting?.business_day_start_time || '00:01:00';
                    const business_date = getBusinessDate(timeZone, businessStartTime);

                    await StockHistory.create({ business_date, qty: +(difference).toFixed(2), price: getCurrentStockInHand.average_price, total_amount: +(difference * getCurrentStockInHand.average_price).toFixed(2), stock_in, raw_material_id: getCurrentStockInHand.raw_material_id, hotel_id: req.user, user_id: req.userId })

                    await StockInHand.update({ available_stock_Consiompsion_qty, qty }, { where: { id: cur.id } })
                }

            }


        }
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { message: "Stock Updated" }, STATUSCODE.SUCCESS))

    } catch (err) {
        console.log(err)
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const adjustManualAveragePrice = async (req, res) => {
    try {
        const { manualStockData } = req.body
        for (const cur of manualStockData) {
            const getCurrentStockInHand = await StockInHand.findByPk(cur.id)
            if (getCurrentStockInHand) {
                await StockInHand.update({ average_price: cur.average_price }, { where: { id: cur.id } })
            }
        }
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { message: "Average Price Updated" }, STATUSCODE.SUCCESS))

    } catch (err) {
        console.log(err)
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
module.exports = { adjustManualAveragePrice, updateManualStock, stockInFunction, editStockHistory, deleteStockHistory, stockIn, stockInHand, stockOut, StockInOutHistory }