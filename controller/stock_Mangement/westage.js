const { raw } = require("body-parser")
const { MESSAGE, STATUSCODE } = require("../../constant/const")
const Westage = require("../../model/Inventory/westage")
const { error, success } = require("../../responce/res");
const { StockInHand, RawMaterial, Unit, HotelUser, Hotel, sequelize, RestaurantSetting } = require("../../model");
const { getShiftedDateRange, getBusinessDate } = require("../../utils/dateUtils");

const moment = require("moment");
const { Op } = require("sequelize");

const createRawMaterialWastage = async (req, res) => {
    const transaction = await sequelize.transaction();

    try {
        const hotel_id = req.user;
        const user_id = req.userId;

        const hotel = await Hotel.findOne({ where: { id: req.user }, raw: true });

        const setting = await RestaurantSetting.findOne({ where: { hotel_id } });
        const timezone = setting.timezone;
        const business_day_start_time = setting.business_day_start_time
        const business_date = getBusinessDate(timezone, business_day_start_time);

        const wastageItems = req.body;   // array

        for (const item of wastageItems) {

            const { raw_material_id, qty, unit_id, reason, notes } = item;

            const rawMaterial = await RawMaterial.findOne({ where: { id: raw_material_id, hotel_id } });
            if (!rawMaterial) {
                return res.json(error("Raw material not found", STATUSCODE.INTERNAL_SERVER_ERROR))
                // throw new Error("Raw material not found");
            }

            const stock = await StockInHand.findOne({ where: { raw_material_id, hotel_id } });
            if (!stock) {
                return res.json(error("Stock not found for this material", STATUSCODE.INTERNAL_SERVER_ERROR))
                // throw new Error("Stock not found for this material");
            }

            let wastageInConsumptionQty = 0;

            // unit conversion handle
            if (+unit_id === rawMaterial.consumption_unit || rawMaterial.consumption_unit === rawMaterial.unit_id) {
                wastageInConsumptionQty = qty;
            }
            else if (+unit_id === rawMaterial.unit_id) {
                wastageInConsumptionQty = qty * rawMaterial.conversion_qty;
            }
            else {
                return res.json(error("Invalid unit selected", STATUSCODE.INTERNAL_SERVER_ERROR))


            }

            const updatedAvailableConsumptionQty = stock.available_stock_Consiompsion_qty - wastageInConsumptionQty;

            let updatedQty = 0;
            if (rawMaterial.consumption_unit === rawMaterial.unit_id) {
                updatedQty = updatedAvailableConsumptionQty;
            } else {
                updatedQty = updatedAvailableConsumptionQty / rawMaterial.conversion_qty;
            }

            const total_amount = updatedQty * stock.average_price;

            await StockInHand.update({
                available_stock_Consiompsion_qty: updatedAvailableConsumptionQty,
                qty: updatedQty,
                total_amount
            }, { where: { id: stock.id }, transaction });

            const wastagePurchaseQty = wastageInConsumptionQty / rawMaterial.conversion_qty;
            const wastageAmount = wastagePurchaseQty * stock.average_price;

            await Westage.create({

                hotel_id,
                raw_material_id,
                user_id,
                unit_id,
                average_price: parseFloat(wastageAmount.toFixed(2)),
                qty,
                reason,
                notes,
                business_date
            }, { transaction });
        }

        await transaction.commit();
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { message: "Wastage recorded successfully" }, STATUSCODE.SUCCESS));

    } catch (err) {
        console.error(err)
        await transaction.rollback();
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

const getWastageRecords = async (req, res) => {
    try {

        const { page = 1, limit = 10 } = req.query
        const offset = (page - 1) * limit
        const hotel_id = req.user
        console.log("Get Wastage Records Called", req.query)
        const { startDate, endDate } = req.query;
        const { businessStartDate: startD, businessEndDate: endD } = await getShiftedDateRange(startDate, endDate, req.user);

        const wastageRecords = await Westage.findAndCountAll({
            where: { deleted_status: false, hotel_id, business_date: { [Op.between]: [startD, endD] } },
            include: [RawMaterial, Unit, HotelUser],
            limit: parseInt(limit),
            offset: parseInt(offset),
            order: [['createdAt', 'DESC']]
        });
        const totalCost = await Westage.sum('average_price', { where: { deleted_status: false, hotel_id, business_date: { [Op.between]: [startD, endD] } } });
        const pagination = {
            totalItems: wastageRecords.count,
            totalPages: Math.ceil(wastageRecords.count / limit),
            currentPage: parseInt(page)
        };
        console.log("Wastage Records Fetched:", wastageRecords.rows)
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { totalCost, data: wastageRecords.rows, pagination }, STATUSCODE.SUCCESS))

    } catch (err) {
        console.error("Get Wastage Records Error:", err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))

    }
}
const getWastageRecordsExcel = async (req, res) => {
    try {
        const { startDate, endDate } = req.query;
        const { businessStartDate: startD, businessEndDate: endD } = await getShiftedDateRange(startDate, endDate, req.user);

        const wastageRecords = await Westage.findAll({
            where: { hotel_id: req.user, deleted_status: false, business_date: { [Op.between]: [startD, endD] } },
            include: [RawMaterial, Unit, HotelUser],
            order: [['createdAt', 'DESC']]
        });


        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { data: wastageRecords }, STATUSCODE.SUCCESS))

    } catch (err) {
        console.error("Get Wastage Records Error:", err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))

    }
}
const deleteWastageRecord = async (req, res) => {
    const transaction = await sequelize.transaction();
    try {
        const { wastage_id } = req.params;
        const hotel_id = req.user;

        const wastageRecord = await Westage.findOne({ where: { id: wastage_id, hotel_id } });
        if (!wastageRecord) return res.json(error("Wastage record not found", STATUSCODE.INTERNAL_SERVER_ERROR));

        const rawMaterial = await RawMaterial.findOne({ where: { id: wastageRecord.raw_material_id, hotel_id } });
        if (!rawMaterial) return res.json(error("Raw material not found", STATUSCODE.INTERNAL_SERVER_ERROR));

        const stock = await StockInHand.findOne({ where: { raw_material_id: wastageRecord.raw_material_id, hotel_id } });
        if (!stock) return res.json(error("Stock record not found for this raw material", STATUSCODE.INTERNAL_SERVER_ERROR));

        // convert wastage qty back to consumption qty based on what unit user selected
        let revertConsumptionQty = 0;

        if (+wastageRecord.unit_id === rawMaterial.consumption_unit) {
            revertConsumptionQty = wastageRecord.qty;
        } else if (+wastageRecord.unit_id === rawMaterial.unit_id) {
            revertConsumptionQty = wastageRecord.qty * rawMaterial.conversion_qty;
        } else {
            return res.json(error("Stored unit invalid configuration", STATUSCODE.INTERNAL_SERVER_ERROR));
        }

        // revert stock now
        const revertedAvailableConsQty = stock.available_stock_Consiompsion_qty + revertConsumptionQty;
        const revertedQty = revertedAvailableConsQty / rawMaterial.conversion_qty;
        const total_amount = revertedQty * stock.average_price;

        await StockInHand.update(
            {
                available_stock_Consiompsion_qty: revertedAvailableConsQty,
                qty: revertedQty,
                total_amount,
            },
            { where: { id: stock.id }, transaction }
        );

        // soft delete wastage record
        await Westage.update({ deleted_status: true }, { where: { id: wastage_id, hotel_id }, transaction });

        await transaction.commit();
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { message: "Wastage record deleted successfully" }, STATUSCODE.SUCCESS));
    } catch (err) {
        console.log("Delete Wastage Error", err);
        await transaction.rollback();
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};
module.exports = {
    getWastageRecordsExcel,
    deleteWastageRecord,
    createRawMaterialWastage,
    getWastageRecords
}