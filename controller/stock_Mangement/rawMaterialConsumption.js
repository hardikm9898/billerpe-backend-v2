const { MESSAGE, STATUSCODE } = require("../../constant/const");
const Hotel = require("../../model/hotel");
const RawMaterial = require("../../model/rawItem");
const RawMaterialConsumption = require("../../model/Inventory/RawMaterialcon");
const StockInHand = require("../../model/stockInHand");
const Unit = require("../../model/unit");
const { error, success } = require("../../responce/res");
const { Op } = require("sequelize");

const sequelize = require("../../connection/connect");
const RestaurantSetting = require("../../model/restaurantSetting");
const { getBusinessDate, getShiftedDateRange } = require("../../utils/dateUtils");

/**
 * Record consumption of raw materials
 * This can be used for recipes, waste tracking, or any other consumption
 */

const recordConsumption = async (req, res) => {
    try {
        const hotel = await Hotel.findOne({ where: { id: req.user } });
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST));

        const {
            raw_material_id,
            qty,
            purpose,
            order_id,
            reference_type,
            notes,
            unit_id
        } = req.body;

        // Validate raw material
        const rawMaterial = await RawMaterial.findOne({
            where: { id: raw_material_id, hotel_id: req.user }
        });
        if (!rawMaterial) return res.json(error("Raw Material Not Found", STATUSCODE.BAD_REQUEST));

        // Validate unit
        const unit = await Unit.findByPk(unit_id);
        if (!unit) return res.json(error("Unit Not Found", STATUSCODE.BAD_REQUEST));

        // Check stock availability
        const stockInHand = await StockInHand.findOne({
            where: { raw_material_id, hotel_id: req.user, deleted: false }
        });
        if (!stockInHand) return res.json(error("This Item Is Not In Stock", STATUSCODE.BAD_REQUEST));

        // Convert qty if units are different
        let consumptionQty = qty;
        if (unit_id !== rawMaterial.consumption_unit) {
            // Implement conversion logic based on your unit system
            // This is a simplified example
            if (unit_id === rawMaterial.unit_id) {
                consumptionQty = qty * rawMaterial.conversion_qty;
            } else {
                return res.json(error("Unit conversion not supported", STATUSCODE.BAD_REQUEST));
            }
        }

        // Check if enough stock is available
        if (consumptionQty > stockInHand.qty) {
            return res.json(error("Not enough stock available", STATUSCODE.BAD_REQUEST));
        }

        // Calculate cost based on average price
        const cost = (stockInHand.average_price * consumptionQty).toFixed(2);

        const setting = await RestaurantSetting.findOne({ where: { hotel_id: req.user } });
        const timeZone = setting?.timeZone || 'Asia/Kolkata';
        const businessStartTime = setting?.business_day_start_time || '00:01:00';
        const business_date = getBusinessDate(timeZone, businessStartTime);

        // Record consumption
        await RawMaterialConsumption.create({
            business_date,
            raw_material_id,
            qty: consumptionQty,
            purpose,
            reference_id,
            reference_type,
            notes,
            cost,
            unit_id,
            hotel_id: req.user,
            user_id: req.userId
        });

        // Update stock in hand
        if (stockInHand.qty === consumptionQty) {
            await StockInHand.destroy({ where: { id: stockInHand.id } });
        } else {
            await StockInHand.update(
                {
                    qty: stockInHand.qty - consumptionQty,
                    total_amount: (stockInHand.qty - consumptionQty) * stockInHand.average_price
                },
                { where: { id: stockInHand.id } }
            );
        }

        return res.status(STATUSCODE.SUCCESS).json(
            success("Consumption Recorded Successfully", { message: "Consumption Recorded" }, STATUSCODE.SUCCESS)
        );
    } catch (err) {
        console.log(err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

/**
 * Get consumption history for a specific date range
 */
const getConsumptionHistory = async (req, res) => {
    try {
        const hotel = await Hotel.findOne({ where: { id: req.user } });
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST));


        const { startDate, endDate, search } = req.query;

        // Build query conditions
        const whereConditions = {
            hotel_id: req.user,
            deleted_status: false
        };

        let { startD, endD } = await getShiftedDateRange(startDate, endDate, req.user);

        whereConditions.business_date = { [Op.between]: [startD, endD] };



        // Get consumption history grouped by raw material
        const records = await RawMaterialConsumption.findAll({
            where: whereConditions,
            attributes: [
                'raw_material_id',
                [sequelize.fn('SUM', sequelize.col('consumed_qty')), 'total_consumption'],
                [sequelize.fn('SUM', sequelize.col('cost')), 'total_cost']
            ],
            include: [
                {
                    model: RawMaterial,
                    where: search ? { raw_material_name: { [Op.like]: `%${search}%` } } : {},
                    required: true,
                    as: "rawMaterial",
                    attributes: ['raw_material_name', 'conversion_qty'],
                    include: [
                        { model: Unit, as: "purchaseUnit", attributes: ['unit_name', 'shortName'] },
                        { model: Unit, as: "consumptionUnit", attributes: ['unit_name', 'shortName'] }
                    ]
                }
            ],
            group: [
                'raw_material_id',
                'rawMaterial.id',
                'rawMaterial.purchaseUnit.id',
                'rawMaterial.consumptionUnit.id'
            ],
            order: [[sequelize.literal('total_consumption'), 'DESC']]
        });


        // Format result
        const result = records.map(rec => {
            const rawMaterialName = rec.rawMaterial?.raw_material_name || "Unknown";
            const conversion_qty = rec.rawMaterial?.conversion_qty || "Unknown";
            const purchaseUnit = rec.rawMaterial?.purchaseUnit?.unit_name || "Unknown";
            const purchaseUnitShortName = rec.rawMaterial?.purchaseUnit?.shortName || "Unknown";
            const consumptionUnit = rec.rawMaterial?.consumptionUnit?.unit_name || "Unknown";
            const consumptionUnitShortName = rec.rawMaterial?.consumptionUnit?.shortName || "Unknown";
            const totalConsumption = parseFloat(rec.dataValues.total_consumption).toFixed(2);
            const totalCost = parseFloat(rec.dataValues.total_cost).toFixed(2);

            return {
                raw_material_name: rawMaterialName,
                total_consumption: totalConsumption,
                total_cost: totalCost,
                conversion_qty,
                purchase_unit: purchaseUnit,
                purchase_unit_short_name: purchaseUnitShortName,
                consumption_unit: consumptionUnit,
                consumption_unit_short_name: consumptionUnitShortName
            };
        });

        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { consumptionHistory: result }, STATUSCODE.SUCCESS));
    } catch (err) {
        console.log(err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

/**
 * Get consumption summary by purpose
 */
const getConsumptionSummaryByPurpose = async (req, res) => {
    try {
        const hotel = await Hotel.findOne({ where: { id: req.user } });
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST));

        const { startDate, endDate } = req.query;

        // Build query conditions
        const whereConditions = {
            hotel_id: req.user,
            deleted_status: false
        };

        // Add date range if provided
        if (startDate && endDate) {
            const startD = new Date(startDate);
            const endD = new Date(endDate);
            whereConditions.createdAt = { [Op.between]: [startD, endD] };
        }

        // Get consumption data
        const consumptionData = await RawMaterialConsumption.findAll({
            where: whereConditions,
            attributes: [
                'purpose',
                [sequelize.fn('SUM', sequelize.col('qty')), 'total_qty'],
                [sequelize.fn('SUM', sequelize.col('cost')), 'total_cost']
            ],
            group: ['purpose'],
            order: [[sequelize.literal('total_cost'), 'DESC']]
        });

        return res.status(STATUSCODE.SUCCESS).json(
            success("Consumption Summary Fetched Successfully", { consumptionData }, STATUSCODE.SUCCESS)
        );
    } catch (err) {
        console.log(err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

/**
 * Get consumption summary by raw material
 */
const getConsumptionSummaryByRawMaterial = async (req, res) => {
    try {
        const hotel = await Hotel.findOne({ where: { id: req.user } });
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST));

        const { startDate, endDate, purpose } = req.query;

        // Build query conditions
        const whereConditions = {
            hotel_id: req.user,
            deleted_status: false
        };

        // Add date range if provided
        if (startDate && endDate) {
            const startD = new Date(startDate);
            const endD = new Date(endDate);
            whereConditions.createdAt = { [Op.between]: [startD, endD] };
        }

        // Add purpose filter if provided
        if (purpose) {
            whereConditions.purpose = purpose;
        }

        // Get consumption data
        const consumptionData = await RawMaterialConsumption.findAll({
            where: whereConditions,
            attributes: [
                'raw_material_id',
                [sequelize.fn('SUM', sequelize.col('qty')), 'total_qty'],
                [sequelize.fn('SUM', sequelize.col('cost')), 'total_cost']
            ],
            include: [{
                model: RawMaterial,
                as: "rawMaterial",
                attributes: ['raw_material_name'],
                include: [{ model: Unit, as: "consumptionUnit", attributes: ['unit_name', 'shortName'] }]
            }],
            group: ['raw_material_id', 'rawMaterial.id', 'rawMaterial.consumptionUnit.id'],
            order: [[sequelize.literal('total_cost'), 'DESC']]
        });

        return res.status(STATUSCODE.SUCCESS).json(
            success("Consumption Summary Fetched Successfully", { consumptionData }, STATUSCODE.SUCCESS)
        );
    } catch (err) {
        console.log(err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

module.exports = {
    recordConsumption,
    getConsumptionHistory,
    getConsumptionSummaryByPurpose,
    getConsumptionSummaryByRawMaterial
};