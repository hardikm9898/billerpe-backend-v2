const { STATUSCODE, MESSAGE, STATUS } = require("../../constant/const");
const ExpenseEntry = require("../../model/expenseEnty")
const moment = require("moment")
const { error, success } = require("../../responce/res");
// const { Op, Model, where } = require("sequelize");
const Order = require("../../model/order");
const ExpenseHead = require("../../model/expenseHead");
const { getShiftedDateRange } = require("../../utils/dateUtils");
const OrderDetails = require("../../model/order_details");
const Menu = require("../../model/menu");
const Recipes = require("../../model/recipes");
const RawMaterial = require("../../model/rawItem");
const Unit = require("../../model/unit");
const { Json } = require("sequelize/lib/utils");
const sequelize = require("../../connection/connect");
const { Op, fn, col, literal } = require('sequelize');
const consumptionReport = async (req, res) => {
    try {
        const { startDate, endDate } = req.query
        const { startD, endD, businessStartDate, businessEndDate } = await getShiftedDateRange(startDate, endDate, req.user);
        let orderDetails = await Order.findAll({

            where: { hotel_id: req.user, status: STATUS.SUCCESS, payment: STATUS.SUCCESS, business_date: { [Op.between]: [businessStartDate, businessEndDate] } },
            include: {
                model: OrderDetails, where: {
                    hotel_id: req.user,
                    status: STATUS.DELIVERED,
                    payment_status: STATUS.SUCCESS,
                },
                attributes: ["qty", "price", "status", "MenuId", "payment_status", "status"],
                include: {
                    model: Menu, where: { stockTrack: true }, attributes: ["stockTrack", "item_name"], include: { model: Recipes, as: "menu", attributes: ['consumption_qty', "raw_material_id"], include: { model: RawMaterial, as: "rawMaterial", include: [{ model: Unit, as: "consumptionUnit", attributes: ["shortName", "unit_name"] }, { model: Unit, as: "purchaseUnit", attributes: ["shortName", "unit_name"] }], attributes: ["id", "raw_material_name", "purchase_price", "conversion_qty"] } }, required: true
                }, required: true
            }
            , attributes: ["totalAmount",
                "gst",
                "grandAmount",
                "order_type",
                "bill_no", "totalDiscount", "createdAt", "cash", "upi", "card", "due"]
        })

        const orders = []

        orderDetails = JSON.stringify(orderDetails)
        orderDetails = await JSON.parse(orderDetails)
        for (const cur of orderDetails) {

            const { totalAmount,
                gst,
                grandAmount,
                order_type,
                bill_no, totalDiscount, createdAt, cash, upi, card, due } = cur

            const orderData = {
                totalAmount,
                gst,
                grandAmount,
                order_type,
                bill_no, totalDiscount, createdAt, cash, upi, card, due, items: [], raw_materials: []
            }

            for (const itemDetails of cur?.hms_orderDetails) {
                const { price, status, MenuId, qty, payment_status } = itemDetails
                orderData.items.push({
                    qty,
                    price,
                    status,
                    MenuId,
                    payment_status, item_name: itemDetails?.hms_menu_mst?.item_name
                })
                console.log(itemDetails, "Details--->")
                for (const raw_material of itemDetails?.hms_menu_mst?.menu) {
                    const find_raw_material = orderData.raw_materials.findIndex(el => el.raw_material_id === raw_material.raw_material_id)
                    if (find_raw_material > -1) {
                        const data = { ...orderData.raw_materials[find_raw_material], consumption_qty: +orderData.raw_materials[find_raw_material].consumption_qty + (raw_material.consumption_qty * qty) }
                        orderData.raw_materials[find_raw_material] = data
                    }
                    else {
                        orderData.raw_materials.push({ ...raw_material, consumption_qty: raw_material.consumption_qty * qty })
                    }

                }

            }
            orders.push(orderData)

        }
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { orders }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err)
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

const itemWiseConsiompsion = async (req, res) => {
    try {
        const { startDate, endDate, raw_material_id = 0, period = 'daily' } = req.query;

        // Validate the period
        if (!['daily', 'monthly', 'yearly'].includes(period)) {
            return res.json(error(MESSAGE.INVALID_PARAMETER, STATUSCODE.BAD_REQUEST));
        }

        // Get the date range
        const { startD, endD, businessStartDate, businessEndDate } = await getShiftedDateRange(startDate, endDate, req.user);

        // Dynamic date grouping
        const dateGrouping = {
            daily: literal('business_date'),
            monthly: literal('DATE_FORMAT(business_date, "%Y-%m-01")'),
            yearly: literal('DATE_FORMAT(business_date, "%Y-01-01")'),
        }[period];

        // Prepare where conditions
        const whereConditions = {
            hotel_id: req.user,
            status: STATUS.SUCCESS,
            payment: STATUS.SUCCESS,
            business_date: { [Op.between]: [businessStartDate, businessEndDate] }
        };

        // Fetch raw material IDs if not provided
        let rawMaterialIds = [];
        console.log(raw_material_id)
        if (raw_material_id != 0) {
            rawMaterialIds = [parseInt(raw_material_id)];
        } else {
            rawMaterialIds = (await RawMaterial.findAll({
                where: { hotel_id: req.user },
                attributes: ['id'],
                raw: true,
            })).map(rm => rm.id);
        }
        console.log(rawMaterialIds)
        // Fetch orders
        let orders = await Order.findAll({
            where: whereConditions,
            attributes: [
                [dateGrouping, 'period'],
                "id"
            ],
        });
        orders = JSON.stringify(orders)
        orders = JSON.parse(orders)
        // Fetch order details
        let orderDetails = await OrderDetails.findAll({
            where: {
                hotel_id: req.user,
                status: STATUS.DELIVERED,
                payment_status: STATUS.SUCCESS
            },
            attributes: ['orderId', 'qty'],
            include: [
                {
                    model: Menu,
                    attributes: ['item_name', "id"],
                    where: { stockTrack: true },
                    include: [
                        {
                            model: Recipes,
                            as: 'menu',
                            attributes: ['consumption_qty'],
                            where: { raw_material_id: { [Op.in]: rawMaterialIds } },
                            include: [
                                {
                                    model: RawMaterial,
                                    as: 'rawMaterial',
                                    attributes: ['id', 'raw_material_name', "conversion_qty"],
                                    include: [
                                        {
                                            model: Unit,
                                            as: 'consumptionUnit',
                                            attributes: ['shortName', 'unit_name']
                                        },
                                        {
                                            model: Unit,
                                            as: 'purchaseUnit',
                                            attributes: ['shortName', 'unit_name']
                                        }
                                    ]
                                }
                            ]
                        }
                    ]
                }
            ],
        });
        orderDetails = JSON.stringify(orderDetails)
        orderDetails = JSON.parse(orderDetails)
        // Aggregation logic for raw material-wise consumption report
        const rawMaterialConsumptionReport = {};

        for (const order of orders) {
            // console.log(order, "ooo")
            const periodKey = order.period;

            // Find details matching the current order (orderId)
            const relevantDetails = orderDetails.filter(detail => detail.orderId === order.id);

            for (const detail of relevantDetails) {
                const itemQty = detail.qty;

                for (const recipe of detail['hms_menu_mst'].menu) {
                    const rawMaterial = recipe.rawMaterial;
                    const consumptionQty = recipe.consumption_qty * itemQty;

                    if (!rawMaterialConsumptionReport[periodKey]) {
                        rawMaterialConsumptionReport[periodKey] = {
                            period: periodKey,
                            raw_materials: {}
                        };
                    }

                    if (!rawMaterialConsumptionReport[periodKey].raw_materials[rawMaterial.raw_material_name]) {
                        rawMaterialConsumptionReport[periodKey].raw_materials[rawMaterial.raw_material_name] = {
                            raw_material_name: rawMaterial.raw_material_name,
                            raw_material_id: rawMaterial.id,
                            conversion_qty: rawMaterial.conversion_qty,
                            total_consumption: 0,
                            consumption_unit: rawMaterial.consumptionUnit.unit_name,
                            purchase_unit: rawMaterial.purchaseUnit.unit_name,

                        };
                    }

                    rawMaterialConsumptionReport[periodKey].raw_materials[rawMaterial.raw_material_name].total_consumption += consumptionQty;
                }
            }
        }

        // Formatting the report
        const formattedReport = Object.entries(rawMaterialConsumptionReport).map(([periodKey, data]) => ({
            period: periodKey,
            raw_materials: Object.values(data.raw_materials)
        }));

        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, {
            raw_material_wise_consumption: formattedReport
        }, STATUSCODE.SUCCESS));

    } catch (err) {
        console.error(err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }


}

module.exports = { consumptionReport, itemWiseConsiompsion }