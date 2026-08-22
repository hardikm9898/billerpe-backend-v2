const Order = require("../model/order")
const Item = require("../model/menu")
const Cart = require("../model/cart")
const sequelize = require("sequelize")
const { Op } = require("sequelize")
const { STATUSCODE, MESSAGE, STATUS, ORDER_TYPE, ORDER_DETAILS_TYPE } = require("../constant/const")
const { error, success } = require("../responce/res")
const Menu = require("../model/menu")
const Table = require("../model/table")
const User = require("../model/user")
const OrderDetails = require("../model/order_details")
const Hotel = require("../model/hotel")
const moment = require("moment")
const Menu_categ = require("../model/menu_categ")
const TableCatagories = require("../model/table_catg")
const OnlineOrders = require("../model/onlineOrder")
const { Variants } = require("../model")

const { getShiftedDateRange } = require("../utils/dateUtils");

const salesReport = async (req, res) => {
    try {
        const { start, end, orderType = null, paymentMethod = "" } = req.body;
        // Helper function to set date range
        const { startD, endD, previousStartD, businessStartDate, businessEndDate, previousBusinessStartDate, previousBusinessEndDate, hasTimeFilter, createdAtStart, createdAtEnd } = await getShiftedDateRange(start, end, req.user);
        console.log(startD, endD, "Start Date EndDate:::")
        // Helper function for sum and count queries
        const sumField = async (field, conditions) => {
            return await Order.sum(field, { where: { ...conditions, deleted: false } });
        };

        const countField = async (conditions) => {
            return await Order.count({ where: { ...conditions, deleted: false } });
        };

        // Helper function for calculating percentage change
        const calculatePercentageChange = (current, previous) => {
            if (previous !== 0) {
                return ((current - previous) / previous) * 100;
            }
            return current !== 0 ? 100 : 0; // Handle division by zero case
        };

        // Common conditions
        const commonConditions = {
            payment: STATUS.SUCCESS,
            deleted: false,
            hotel_id: req.user,
            business_date: { [Op.between]: [businessStartDate, businessEndDate] },
            ...(hasTimeFilter && { createdAt: { [Op.between]: [createdAtStart, createdAtEnd] } }),
        };

        // Add order type filter if provided
        let extendedConditions = orderType ? { ...commonConditions, order_type: orderType } : { ...commonConditions };

        // 🔹 Add payment method filter
        if (paymentMethod) {
            if (paymentMethod === "cash") {
                extendedConditions = { ...extendedConditions, cash: { [Op.gt]: 0 } };
            } else if (paymentMethod === "card") {
                extendedConditions = { ...extendedConditions, card: { [Op.gt]: 0 } };
            } else if (paymentMethod === "upi") {
                extendedConditions = { ...extendedConditions, upi: { [Op.gt]: 0 } };
            } else if (paymentMethod === "due") {
                extendedConditions = { ...extendedConditions, due: { [Op.gt]: 0 } };
            }
            // if paymentMethod == "" → no filter applied
        }


        // ✅ Current & previous period calculations
        const totalSale = await sumField("grandAmount", extendedConditions);

        const previousTotalSale = await sumField("grandAmount", {
            ...commonConditions,
            business_date: { [Op.between]: [previousBusinessStartDate, previousBusinessEndDate] },
        });

        const totalSalePercentageChange = calculatePercentageChange(totalSale, previousTotalSale);

        const totalInvoice = await countField(extendedConditions);
        const previousInvoice = await countField({
            ...commonConditions,
            business_date: { [Op.between]: [previousBusinessStartDate, previousBusinessEndDate] },
        });
        const totalInvoicePercentageChange = calculatePercentageChange(totalInvoice, previousInvoice);

        // Specific order type sales
        const totalDinInSale = await sumField("grandAmount", { ...commonConditions, order_type: "dinin" });
        const previousDinInSale = await sumField("grandAmount", {
            ...commonConditions,
            order_type: "dinin",
            business_date: { [Op.between]: [previousBusinessStartDate, previousBusinessEndDate] },
        });
        const totalDinInPercentageChange = calculatePercentageChange(totalDinInSale, previousDinInSale);

        const totalPickupSale = await sumField("grandAmount", { ...commonConditions, order_type: "pickup" });
        const previousPickupSale = await sumField("grandAmount", {
            ...commonConditions,
            order_type: "pickup",
            business_date: { [Op.between]: [previousBusinessStartDate, previousBusinessEndDate] },
        });
        const totalPickupPercentageChange = calculatePercentageChange(totalPickupSale, previousPickupSale);

        // Payment method breakdown
        const totalCardPayment = await sumField("card", extendedConditions);
        const previousCardPayment = await sumField("card", {
            ...commonConditions,
            business_date: { [Op.between]: [previousBusinessStartDate, previousBusinessEndDate] },
        });
        const totalCardPercentageChange = calculatePercentageChange(totalCardPayment, previousCardPayment);

        const totalCashPayment = await sumField("cash", extendedConditions);
        const previousCashPayment = await sumField("cash", {
            ...commonConditions,
            business_date: { [Op.between]: [previousBusinessStartDate, previousBusinessEndDate] },
        });
        const totalCashPercentageChange = calculatePercentageChange(totalCashPayment, previousCashPayment);

        const totalUpiPayment = await sumField("upi", extendedConditions);
        const previousUpiPayment = await sumField("upi", {
            ...commonConditions,
            business_date: { [Op.between]: [previousBusinessStartDate, previousBusinessEndDate] },
        });
        const totalUpiPercentageChange = calculatePercentageChange(totalUpiPayment, previousUpiPayment);

        const totalDuePayment = await sumField("due", extendedConditions);
        const totalGivenDiscount = await sumField("totalDiscount", extendedConditions);

        // totalAmount = sub-total after discount, BEFORE tax (the "without tax" value)
        const totalWithoutTax = await sumField("totalAmount", extendedConditions);
        const totalGst = await sumField("gst", extendedConditions);
        const totalServiceCharge = await sumField("service_charge", extendedConditions);

        // Report Data
        const reportTotalAmounts = {
            totalSale,
            totalSalePercentageChange,
            totalInvoice,
            totalInvoicePercentageChange,
            totalDinInSale,
            totalDinInPercentageChange,
            totalPickupSale,
            totalPickupPercentageChange,
            totalCardPayment,
            totalCardPercentageChange,
            totalCashPayment,
            totalCashPercentageChange,
            totalUpiPayment,
            totalUpiPercentageChange,
            totalDuePayment,
            totalGivenDiscount,
            totalWithoutTax,      // SUM(totalAmount) — sub-total after discount, before tax
            totalGst,             // SUM(gst) — total tax collected
            totalServiceCharge,   // SUM(service_charge)
        };

        // Detailed order data
        const orderData = await Order.findAll({
            where: extendedConditions,
            include: [
                { model: User },
                { model: Table, include: { model: TableCatagories } }
            ],
            order: [["id", "DESC"]],
        });

        return res.json(success(MESSAGE.SUCCESS, { order: orderData, reportTotalAmounts }, STATUSCODE.SUCCESS));

    } catch (err) {
        console.error(err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};
const itemWiseReports = async (req, res) => {
    try {
        const { start, end } = req.body;

        const { startD, endD } = await getShiftedDateRange(start, end, req.user);
        console.log(startD, endD, "Start D EndD")

        let totalItemsSale = await OrderDetails.findAll({
            where: {
                hotel_id: req.user,
                status: ORDER_DETAILS_TYPE.DELIVERED,
                payment_status: STATUS.SUCCESS,
                createdAt: { [Op.between]: [startD, endD] }
            },
            attributes: [
                "MenuId",
                "price",
                [sequelize.fn('IFNULL', sequelize.col('hms_orderDetails.variant_id'), 0), 'variant_id'],
                [
                    sequelize.fn("SUM", sequelize.col("hms_orderDetails.qty")),
                    "totalQty"
                ],
                [
                    sequelize.literal(
                        "SUM(`hms_orderDetails`.`qty` * `hms_orderDetails`.`price`)"
                    ),
                    "totalSale"
                ]
            ],
            group: [
                "hms_orderDetails.MenuId",
                "hms_orderDetails.price",
                sequelize.fn('IFNULL', sequelize.col('hms_orderDetails.variant_id'), 0),
                "hms_menu_mst.id",
                "variantData.id"
            ],
            include: [
                {
                    model: Menu,
                    attributes: ["item_name"],
                    include: [
                        {
                            model: Menu_categ,
                            attributes: ["menu_categ_nm"]
                        }
                    ]
                },
                {
                    model: Variants,
                    as: "variantData",
                    attributes: ["variants_name"]
                }
            ],
            order: [[sequelize.literal("totalQty"), "DESC"]]
        });

        totalItemsSale = JSON.parse(JSON.stringify(totalItemsSale));

        const data = totalItemsSale.map(el => {
            const itemName = el.hms_menu_mst?.item_name || "";
            const variantName = el.variantData?.variants_name;

            return {
                item_name: variantName
                    ? `${itemName} (${variantName})`
                    : itemName,
                category: el.hms_menu_mst?.hms_menu_categ?.menu_categ_nm || "",
                price: Number(el.price),
                totalQty: Number(el.totalQty),
                totalSale: Number(el.totalSale)
            };
        });

        return res.json(
            success(MESSAGE.SUCCESS, data, STATUSCODE.SUCCESS)
        );

    } catch (err) {
        console.log(err);
        return res.json(
            error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR)
        );
    }
};
const onlineOrderTotalSales = async (req, res) => {
    try {
        const { start, end } = req.body
        const { startD, endD } = await getShiftedDateRange(start, end, req.user);


        const zomatoTotalSale = await OnlineOrders.sum("sub_total", {
            where: {
                status: 'DELIVERED', hotel_id: req.user,
                createdAt: {
                    [Op.between]: [startD, endD]
                }

            }
        })
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { zomatoTotalSale }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err)
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const customReportsData = async (req, res) => {
    try {
        const { start, end } = req.body
        const { startD, endD, businessStartDate, businessEndDate } = await getShiftedDateRange(start, end, req.user);

        const orders = await Order.findAll({
            where: {
                business_date: {
                    [Op.between]: [businessStartDate, businessEndDate]
                },
                hotel_id: req.user
            },
            raw: true
        });

        const groupedOrders = orders.reduce((acc, order) => {
            const date = moment(order.createdAt).format("DD/MM/YYYY");
            if (!acc[date]) {
                acc[date] = { startBill_no: order.bill_no, cash: 0, upi: 0, grandAmount: 0, card: 0 };
            }
            acc[date].cash += order.cash
            acc[date].upi += order.upi
            acc[date].card += order.card
            acc[date].grandAmount += order.grandAmount
            acc[date].endBill_no = order.bill_no
            return acc;
        }, {});

        return res.json(success(MESSAGE.SUCCESS, { groupedOrders }, STATUSCODE.SUCCESS))



    } catch (err) {
        console.log(err)
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const cancelOrderReport = async (req, res) => {
    try {

        const { orderType } = req.query
        const hotel = await Hotel.findOne({ where: { id: req.user } })
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST,))
        let orderAll
        if (orderType === "allOrder") {
            orderAll = await Order.findAll({
                where: {
                    hotel_id: hotel.id, deleted: true, payment: STATUS.SUCCESS, status: ORDER_TYPE.SUCCESS
                }, include: [
                    {
                        model: User,
                    },
                    {
                        model: Table, include: { model: TableCatagories }
                    }
                ],
                order: [
                    ['id', 'DESC'],
                ],
            });

        } else {
            orderAll = await Order.findAll({
                where: {
                    hotel_id: hotel.id, order_type: orderType, deleted: true, payment: STATUS.SUCCESS, status: ORDER_TYPE.SUCCESS
                }, include: [
                    {
                        model: User,
                    },
                    {
                        model: Table, include: { model: TableCatagories }
                    }
                ],
                order: [
                    ['id', 'DESC'],
                ],
            });
        }
        if (!orderAll) {
            return res.json(success(MESSAGE.ORDER_NOT_FOUND, STATUSCODE.NOT_FOUND))
        }
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { order: orderAll }, STATUSCODE.SUCCESS))
    } catch (err) {
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
module.exports = { onlineOrderTotalSales, customReportsData, salesReport, itemWiseReports, cancelOrderReport }