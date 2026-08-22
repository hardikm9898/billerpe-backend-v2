
const Merchant = require('../../model/merchant');
const moment = require('moment');
const { Op } = require('sequelize');
const Order = require('../../model/order');
const Table = require('../../model/table');
const Menu = require('../../model/menu');
const Menu_categ = require('../../model/menu_categ');
const Hotel = require('../../model/hotel');
const { error, success } = require('../../responce/res');
const { getBusinessDate } = require("../../utils/dateUtils");
const RestaurantSetting = require("../../model/restaurantSetting");
const sequelize = require('../../connection/connect');
const { MESSAGE, STATUSCODE, STATUS, ORDER_DETAILS_TYPE, ORDER_TYPE } = require('../../constant/const');
const OrderDetails = require('../../model/order_details');
const ExpenseEntry = require('../../model/expenseEnty');
const { Variants, MenuVariants, AddonDepartment, MenuAddon, Addons, StockInHand, RawMaterial, Unit, StockHistory, Recipes } = require('../../model');
const { convertMenuWise } = require('../recipes');
const { updateMenuToForMerchantRadis, newMenuCreatedToRadis, updateMenucategoryToRadis, deleteMenuToradis, deleteAllMenuByMenuCategory, deleteMenucategoryToRadis } = require('../redis/redisCrud');
const { syncMenuVersion, updateViaSocket } = require('../../services/syncIndexdb');

const validateMerchant = async (hotel_id, merchant_id) => {

    return Hotel.findOne({ where: { id: hotel_id, merchant_id } });
};


const dashBoard = async (req, res) => {
    // const { startDate, endDate } = req.body;
    let { id: hotel_id } = req.params;
    let { startDate, endDate } = req.query;
    hotel_id = Number(hotel_id)
    try {
        const merchant = await Merchant.findOne({ where: { id: req.user } });
        if (!merchant) return res.json(error("Not Found", STATUSCODE.BAD_REQUEST));
        const hotel = await Hotel.findOne({ where: { id: hotel_id, merchant_id: merchant.id }, attributes: ['id'] })
        if (!hotel) return res.json(error("Not Found", STATUSCODE.BAD_REQUEST));
        const start = startDate ? moment(startDate) : moment().startOf('day');
        const end = endDate ? moment(endDate) : moment().endOf('day');
        const startD = start.toDate();
        const endD = end.toDate();
        const dayDifference = end.diff(start, 'days');
        const timeDeference = new Date(moment(start).subtract(dayDifference, 'days'));

        const totalSale = await Order.sum("grandAmount", {
            where: {
                payment: STATUS.SUCCESS,
                hotel_id,
                createdAt: { [Op.between]: [startD, endD] },
                deleted: false
            }
        });

        const previousTotalSale = await Order.sum("grandAmount", {
            where: {
                payment: STATUS.SUCCESS,
                hotel_id,
                createdAt: { [Op.between]: [timeDeference, startD] },
                deleted: false
            }
        });

        let totalSalePercentageChange = 0;
        if (previousTotalSale !== 0) {
            totalSalePercentageChange = ((totalSale - previousTotalSale) / previousTotalSale) * 100;
            if (!isFinite(totalSalePercentageChange)) totalSalePercentageChange = totalSale;
        } else {
            totalSalePercentageChange = totalSale !== 0 ? totalSale : 0;
        }

        const totalInvoice = await Order.count({
            where: {
                payment: STATUS.SUCCESS,
                hotel_id,
                createdAt: { [Op.between]: [startD, endD] },
                deleted: false
            }
        });

        const previousInvoice = await Order.count({
            where: {
                payment: STATUS.SUCCESS,
                hotel_id,
                createdAt: { [Op.between]: [timeDeference, startD] },
                deleted: false
            }
        });

        let totalInvoicePercentageChange = 0;
        if (previousInvoice !== 0) {
            totalInvoicePercentageChange = ((totalInvoice - previousInvoice) / previousInvoice) * 100;
            if (!isFinite(totalInvoicePercentageChange)) totalInvoicePercentageChange = totalInvoice;
        } else {
            totalInvoicePercentageChange = totalInvoice !== 0 ? totalInvoice : 0;
        }

        const totalDinInSale = await Order.sum("grandAmount", {
            where: {
                payment: STATUS.SUCCESS,
                hotel_id,
                order_type: 'dinin',
                createdAt: { [Op.between]: [startD, endD] },
                deleted: false
            }
        });

        const previousTotalDinInSale = await Order.sum("grandAmount", {
            where: {
                payment: STATUS.SUCCESS,
                hotel_id,
                order_type: 'dinin',
                createdAt: { [Op.between]: [timeDeference, startD] },
                deleted: false
            }
        });

        let totalDinInPercentageChange = 0;
        if (previousTotalDinInSale !== 0) {
            totalDinInPercentageChange = ((totalDinInSale - previousTotalDinInSale) / previousTotalDinInSale) * 100;
            if (!isFinite(totalDinInPercentageChange)) totalDinInPercentageChange = totalDinInSale;
        } else {
            totalDinInPercentageChange = totalDinInSale !== 0 ? totalDinInSale : 0;
        }

        const totalPickUpSale = await Order.sum("grandAmount", {
            where: {
                payment: STATUS.SUCCESS,
                hotel_id,
                order_type: 'pickup',
                createdAt: { [Op.between]: [startD, endD] },
                deleted: false
            }
        });

        const previousTotalPickUpSale = await Order.sum("grandAmount", {
            where: {
                payment: STATUS.SUCCESS,
                hotel_id,
                order_type: 'pickup',
                createdAt: { [Op.between]: [timeDeference, startD] },
                deleted: false
            }
        });

        let totalPickUpPercentageChange = 0;
        if (previousTotalPickUpSale !== 0) {
            totalPickUpPercentageChange = ((totalPickUpSale - previousTotalPickUpSale) / previousTotalPickUpSale) * 100;
            if (!isFinite(totalPickUpPercentageChange)) totalPickUpPercentageChange = totalPickUpSale;
        } else {
            totalPickUpPercentageChange = totalPickUpSale !== 0 ? totalPickUpSale : 0;
        }

        const totalCardPayment = await Order.sum("card", {
            where: {
                payment: STATUS.SUCCESS,
                hotel_id,
                createdAt: { [Op.between]: [startD, endD] },
                deleted: false
            }
        });

        const previousTotalCardPayment = await Order.sum("card", {
            where: {
                payment: STATUS.SUCCESS,
                hotel_id,
                createdAt: { [Op.between]: [timeDeference, startD] },
                deleted: false
            }
        });

        let totalCardPercentageChange = 0;
        if (previousTotalCardPayment !== 0) {
            totalCardPercentageChange = ((totalCardPayment - previousTotalCardPayment) / previousTotalCardPayment) * 100;
            if (!isFinite(totalCardPercentageChange)) totalCardPercentageChange = totalCardPayment;
        } else {
            totalCardPercentageChange = totalCardPayment !== 0 ? totalCardPayment : 0;
        }

        const totalDuePayment = await Order.sum("due", {
            where: {
                payment: STATUS.SUCCESS,
                hotel_id,
                createdAt: { [Op.between]: [startD, endD] },
                deleted: false
            }
        });

        const previousTotalDuePayment = await Order.sum("due", {
            where: {
                payment: STATUS.SUCCESS,
                hotel_id,
                createdAt: { [Op.between]: [timeDeference, startD] },
                deleted: false
            }
        });

        let totalDuePercentageChange = 0;
        if (previousTotalDuePayment !== 0) {
            totalDuePercentageChange = ((totalDuePayment - previousTotalDuePayment) / previousTotalDuePayment) * 100;
            if (!isFinite(totalDuePercentageChange)) totalDuePercentageChange = totalDuePayment;
        } else {
            totalDuePercentageChange = totalDuePayment !== 0 ? totalDuePayment : 0;
        }

        const totalCashPayment = await Order.sum("cash", {
            where: {
                payment: STATUS.SUCCESS,
                hotel_id,
                createdAt: { [Op.between]: [startD, endD] },
                deleted: false
            }
        });

        const previousTotalCashPayment = await Order.sum("cash", {
            where: {
                payment: STATUS.SUCCESS,
                hotel_id,
                createdAt: { [Op.between]: [timeDeference, startD] },
                deleted: false
            }
        });

        let totalCashPercentageChange = 0;
        if (previousTotalCashPayment !== 0) {
            totalCashPercentageChange = ((totalCashPayment - previousTotalCashPayment) / previousTotalCashPayment) * 100;
            if (!isFinite(totalCashPercentageChange)) totalCashPercentageChange = totalCashPayment;
        } else {
            totalCashPercentageChange = totalCashPayment !== 0 ? totalCashPayment : 0;
        }

        const totalUpiPayment = await Order.sum("upi", {
            where: {
                payment: STATUS.SUCCESS,
                hotel_id,
                createdAt: { [Op.between]: [startD, endD] },
                deleted: false
            }
        });

        const previousTotalUpiPayment = await Order.sum("upi", {
            where: {
                payment: STATUS.SUCCESS,
                hotel_id,
                createdAt: { [Op.between]: [timeDeference, startD] },
                deleted: false
            }
        });

        let totalUpiPercentageChange = 0;
        if (previousTotalUpiPayment !== 0) {
            totalUpiPercentageChange = ((totalUpiPayment - previousTotalUpiPayment) / previousTotalUpiPayment) * 100;
            if (!isFinite(totalUpiPercentageChange)) totalUpiPercentageChange = totalUpiPayment;
        } else {
            totalUpiPercentageChange = totalUpiPayment !== 0 ? totalUpiPayment : 0;
        }

        const totalGivenDiscount = await Order.sum("totalDiscount", {
            where: {
                payment: STATUS.SUCCESS,
                hotel_id,
                createdAt: { [Op.between]: [startD, endD] },
                deleted: false
            }
        });

        const liveTables = await Table.count({
            where: {
                hotel_id,
                active: true,
                [Op.or]: [
                    { table_status: "P" },
                    { table_status: "R" },
                    { table_status: "H" }
                ]
            }
        });

        let order = await Order.count({
            where: {
                hotel_id,
                status: { [Op.ne]: ORDER_TYPE.SUCCESS },
                payment: "pending",
                deleted: false
            }
        });
        let pickupOrders = await Order.count({ where: { order_type: "pickup", status: { [Op.ne]: STATUS.SUCCESS }, deleted: false, hotel_id } });
        let dineOrders = await Order.count({ where: { order_type: "dinin", status: { [Op.ne]: STATUS.SUCCESS }, deleted: false, hotel_id } });

        let totalItemsSale = await OrderDetails.findAll({
            where: {
                hotel_id,
                status: ORDER_DETAILS_TYPE.DELIVERED,
                payment_status: STATUS.SUCCESS,
                createdAt: { [Op.between]: [startD, endD] }
            },
            attributes: ["MenuId", [sequelize.fn("sum", sequelize.col("qty")), "totalQty",]],
            group: "MenuId",
            include: {
                model: Menu,
                group: "menu_categ_id",
                include: {
                    model: Menu_categ,
                    attributes: ["menu_categ_nm"]
                },
                attributes: ["item_name"]
            },
            order: [[sequelize.literal("totalQty"), "DESC"]],
            limit: 10,

        });

        totalItemsSale = JSON.parse(JSON.stringify(totalItemsSale))
        totalItemsSale = totalItemsSale.map(el => {
            const data = {
                item_name: "", MenuId: el.MenuId,
                totalQty: el.totalQty,
            }
            data.item_name = el.hms_menu_mst.item_name
            // delete el.hms_menu_msts
            return data
        })


        // const entry = await ExpenseEntry.findAll({ where: { hotel_id, deleted: false, createdAt: { [Op.between]: [startD, endD] } }, include: { model: ExpenseHead } })
        const totalExpense = await ExpenseEntry.sum("amount", { where: { hotel_id, addExpense: true, deleted: false, createdAt: { [Op.between]: [startD, endD] } } })
        const totalMoneyIn = await ExpenseEntry.sum("amount", { where: { hotel_id, addExpense: false, deleted: false, createdAt: { [Op.between]: [startD, endD] } } })

        const dashBoardData = {
            totalMoneyIn: totalMoneyIn ? totalMoneyIn : 0, totalExpense: totalExpense ? totalExpense : 0, totalSale: totalSale ? totalSale : 0, remainingAmount: (totalSale - +totalExpense) + totalMoneyIn,
            pickupOrders, dineOrders,

            totalGivenDiscount,
            totalSale,
            totalInvoice,
            totalDinInSale,
            totalPickUpSale,
            totalCardPayment,
            totalDuePayment,
            totalCashPayment,
            totalUpiPayment,
            liveTotalNoOfOrders: order,
            liveTables,
            totalItemsSale
        };

        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { dashBoardData }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log("dashBoard:::", err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};
const multipleHotelData = async (req, res) => {
    // Get hotelIds from query params and convert to array of numbers
    let { hotelIds, startDate, endDate } = req.query;
    console.log("hotelIds::::", startDate, endDate, hotelIds);
    // Convert comma-separated string to array of numbers
    if (!hotelIds) return res.json(error("Please Reselect Restaurant", STATUSCODE.BAD_REQUEST))
    try {
        const merchant = await Merchant.findOne({ where: { id: req.user } });
        if (!merchant) return res.json(error("Not Found", STATUSCODE.BAD_REQUEST));

        // Verify all hotels belong to the merchant
        const hotels = await Hotel.findOne({
            where: {
                id: +hotelIds,
                merchant_id: merchant.id
            },
            attributes: ['id']
        });

        // Extract verified hotel IDs
        const verifiedHotelIds = hotels ? [hotels.id] : [];
        console.log("Verified Hotel IDs::::", verifiedHotelIds);
        if (verifiedHotelIds.length === 0) {
            return res.json(error("No valid hotels found", STATUSCODE.BAD_REQUEST));
        }

        const start = startDate ? moment(startDate) : moment().startOf('day');
        const end = endDate ? moment(endDate) : moment().endOf('day');
        const startD = start.toISOString();
        const endD = end.toISOString();
        const dayDifference = end.diff(start, 'days');
        const timeDeference = new Date(moment(start).subtract(dayDifference, 'days'));
        console.log("Start end", startD, endD);
        // Modify all queries to use verifiedHotelIds array instead of single hotel_id
        const totalSale = await Order.sum("grandAmount", {
            where: {
                payment: STATUS.SUCCESS,
                hotel_id: { [Op.in]: verifiedHotelIds },
                createdAt: { [Op.between]: [startD, endD] },
                deleted: false
            }
        });

        const previousTotalSale = await Order.sum("grandAmount", {
            where: {
                payment: STATUS.SUCCESS,
                hotel_id: { [Op.in]: verifiedHotelIds },
                createdAt: { [Op.between]: [timeDeference, startD] },
                deleted: false
            }
        });

        let totalSalePercentageChange = 0;
        if (previousTotalSale !== 0) {
            totalSalePercentageChange = ((totalSale - previousTotalSale) / previousTotalSale) * 100;
            if (!isFinite(totalSalePercentageChange)) totalSalePercentageChange = totalSale;
        } else {
            totalSalePercentageChange = totalSale !== 0 ? totalSale : 0;
        }

        const totalInvoice = await Order.count({
            where: {
                payment: STATUS.SUCCESS,
                hotel_id: { [Op.in]: verifiedHotelIds },
                createdAt: { [Op.between]: [startD, endD] },
                deleted: false
            }
        });

        const previousInvoice = await Order.count({
            where: {
                payment: STATUS.SUCCESS,
                hotel_id: { [Op.in]: verifiedHotelIds },
                createdAt: { [Op.between]: [timeDeference, startD] },
                deleted: false
            }
        });

        let totalInvoicePercentageChange = 0;
        if (previousInvoice !== 0) {
            totalInvoicePercentageChange = ((totalInvoice - previousInvoice) / previousInvoice) * 100;
            if (!isFinite(totalInvoicePercentageChange)) totalInvoicePercentageChange = totalInvoice;
        } else {
            totalInvoicePercentageChange = totalInvoice !== 0 ? totalInvoice : 0;
        }

        const totalDinInSale = await Order.sum("grandAmount", {
            where: {
                payment: STATUS.SUCCESS,
                hotel_id: { [Op.in]: verifiedHotelIds },
                order_type: 'dinin',
                createdAt: { [Op.between]: [startD, endD] },
                deleted: false
            }
        });

        const previousTotalDinInSale = await Order.sum("grandAmount", {
            where: {
                payment: STATUS.SUCCESS,
                hotel_id: { [Op.in]: verifiedHotelIds },
                order_type: 'dinin',
                createdAt: { [Op.between]: [timeDeference, startD] },
                deleted: false
            }
        });

        let totalDinInPercentageChange = 0;
        if (previousTotalDinInSale !== 0) {
            totalDinInPercentageChange = ((totalDinInSale - previousTotalDinInSale) / previousTotalDinInSale) * 100;
            if (!isFinite(totalDinInPercentageChange)) totalDinInPercentageChange = totalDinInSale;
        } else {
            totalDinInPercentageChange = totalDinInSale !== 0 ? totalDinInSale : 0;
        }

        const totalPickUpSale = await Order.sum("grandAmount", {
            where: {
                payment: STATUS.SUCCESS,
                hotel_id: { [Op.in]: verifiedHotelIds },
                order_type: 'pickup',
                createdAt: { [Op.between]: [startD, endD] },
                deleted: false
            }
        });

        const previousTotalPickUpSale = await Order.sum("grandAmount", {
            where: {
                payment: STATUS.SUCCESS,
                hotel_id: { [Op.in]: verifiedHotelIds },
                order_type: 'pickup',
                createdAt: { [Op.between]: [timeDeference, startD] },
                deleted: false
            }
        });

        let totalPickUpPercentageChange = 0;
        if (previousTotalPickUpSale !== 0) {
            totalPickUpPercentageChange = ((totalPickUpSale - previousTotalPickUpSale) / previousTotalPickUpSale) * 100;
            if (!isFinite(totalPickUpPercentageChange)) totalPickUpPercentageChange = totalPickUpSale;
        } else {
            totalPickUpPercentageChange = totalPickUpSale !== 0 ? totalPickUpSale : 0;
        }

        const totalCardPayment = await Order.sum("card", {
            where: {
                payment: STATUS.SUCCESS,
                hotel_id: { [Op.in]: verifiedHotelIds },
                createdAt: { [Op.between]: [startD, endD] },
                deleted: false
            }
        });

        const previousTotalCardPayment = await Order.sum("card", {
            where: {
                payment: STATUS.SUCCESS,
                hotel_id: { [Op.in]: verifiedHotelIds },
                createdAt: { [Op.between]: [timeDeference, startD] },
                deleted: false
            }
        });

        let totalCardPercentageChange = 0;
        if (previousTotalCardPayment !== 0) {
            totalCardPercentageChange = ((totalCardPayment - previousTotalCardPayment) / previousTotalCardPayment) * 100;
            if (!isFinite(totalCardPercentageChange)) totalCardPercentageChange = totalCardPayment;
        } else {
            totalCardPercentageChange = totalCardPayment !== 0 ? totalCardPayment : 0;
        }

        const totalDuePayment = await Order.sum("due", {
            where: {
                payment: STATUS.SUCCESS,
                hotel_id: { [Op.in]: verifiedHotelIds },
                createdAt: { [Op.between]: [startD, endD] },
                deleted: false
            }
        });

        const previousTotalDuePayment = await Order.sum("due", {
            where: {
                payment: STATUS.SUCCESS,
                hotel_id: { [Op.in]: verifiedHotelIds },
                createdAt: { [Op.between]: [timeDeference, startD] },
                deleted: false
            }
        });

        let totalDuePercentageChange = 0;
        if (previousTotalDuePayment !== 0) {
            totalDuePercentageChange = ((totalDuePayment - previousTotalDuePayment) / previousTotalDuePayment) * 100;
            if (!isFinite(totalDuePercentageChange)) totalDuePercentageChange = totalDuePayment;
        } else {
            totalDuePercentageChange = totalDuePayment !== 0 ? totalDuePayment : 0;
        }

        const totalCashPayment = await Order.sum("cash", {
            where: {
                payment: STATUS.SUCCESS,
                hotel_id: { [Op.in]: verifiedHotelIds },
                createdAt: { [Op.between]: [startD, endD] },
                deleted: false
            }
        });

        const previousTotalCashPayment = await Order.sum("cash", {
            where: {
                payment: STATUS.SUCCESS,
                hotel_id: { [Op.in]: verifiedHotelIds },
                createdAt: { [Op.between]: [timeDeference, startD] },
                deleted: false
            }
        });

        let totalCashPercentageChange = 0;
        if (previousTotalCashPayment !== 0) {
            totalCashPercentageChange = ((totalCashPayment - previousTotalCashPayment) / previousTotalCashPayment) * 100;
            if (!isFinite(totalCashPercentageChange)) totalCashPercentageChange = totalCashPayment;
        } else {
            totalCashPercentageChange = totalCashPayment !== 0 ? totalCashPayment : 0;
        }

        const totalUpiPayment = await Order.sum("upi", {
            where: {
                payment: STATUS.SUCCESS,
                hotel_id: { [Op.in]: verifiedHotelIds },
                createdAt: { [Op.between]: [startD, endD] },
                deleted: false
            }
        });

        const previousTotalUpiPayment = await Order.sum("upi", {
            where: {
                payment: STATUS.SUCCESS,
                hotel_id: { [Op.in]: verifiedHotelIds },
                createdAt: { [Op.between]: [timeDeference, startD] },
                deleted: false
            }
        });

        let totalUpiPercentageChange = 0;
        if (previousTotalUpiPayment !== 0) {
            totalUpiPercentageChange = ((totalUpiPayment - previousTotalUpiPayment) / previousTotalUpiPayment) * 100;
            if (!isFinite(totalUpiPercentageChange)) totalUpiPercentageChange = totalUpiPayment;
        } else {
            totalUpiPercentageChange = totalUpiPayment !== 0 ? totalUpiPayment : 0;
        }

        const totalGivenDiscount = await Order.sum("totalDiscount", {
            where: {
                payment: STATUS.SUCCESS,
                hotel_id: { [Op.in]: verifiedHotelIds },
                createdAt: { [Op.between]: [startD, endD] },
                deleted: false
            }
        });

        // For live tables, get total across all selected hotels
        const liveTables = await Table.count({
            where: {
                hotel_id: { [Op.in]: verifiedHotelIds },
                active: true,
                [Op.or]: [
                    { table_status: "P" },
                    { table_status: "R" },
                    { table_status: "H" }
                ]
            }
        });

        // Count pending orders across all selected hotels
        let order = await Order.count({
            where: {
                hotel_id: { [Op.in]: verifiedHotelIds },
                status: { [Op.ne]: ORDER_TYPE.SUCCESS },
                payment: "pending",
                deleted: false
            }
        });

        // Count pickup and dine-in orders separately
        let pickupOrders = await Order.count({
            where: {
                order_type: "pickup",
                status: { [Op.ne]: STATUS.SUCCESS },
                deleted: false,
                hotel_id: +hotelIds
            }
        });


        let dineOrders = await Order.count({
            where: {
                order_type: "dinin",
                status: { [Op.ne]: STATUS.SUCCESS },
                deleted: false,
                hotel_id: +hotelIds
            }
        });

        let pickup = await Order.findAll({
            where: {
                order_type: "pickup",
                status: { [Op.ne]: STATUS.SUCCESS },
                deleted: false,
                hotel_id: +hotelIds
            }
            , attributes: ['id']
        });
        let dineIn = await Order.findAll({
            where: {
                order_type: "dinin",
                status: { [Op.ne]: STATUS.SUCCESS },
                deleted: false,
                hotel_id: +hotelIds
            },
            attributes: ['id']
        });

        let totalItemsSale = await OrderDetails.findAll({
            where: {
                hotel_id: hotelIds,
                status: ORDER_DETAILS_TYPE.DELIVERED,
                payment_status: STATUS.SUCCESS,
                createdAt: { [Op.between]: [startD, endD] }
            },
            attributes: [
                "MenuId",
                "price",
                "variant_id",
                [sequelize.fn("SUM", sequelize.col("hms_orderDetails.qty")), "totalQty"],
                [
                    sequelize.literal(
                        "SUM(`hms_orderDetails`.`qty` * `hms_orderDetails`.`price`)"
                    ),
                    "totalSale"
                ]
            ],
            group: [
                "hms_orderDetails.variant_id",
                "hms_orderDetails.MenuId",
                "hms_orderDetails.price",
                "hms_menu_mst.id",
                "variantData.id"
            ],
            include: [
                {
                    model: Menu,
                    required: true,
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
            order: [[sequelize.literal("totalQty"), "DESC"]],
            limit: 10
        });
        totalItemsSale = JSON.parse(JSON.stringify(totalItemsSale));
        totalItemsSale = totalItemsSale.map(el => {
            const itemName = el.hms_menu_mst?.item_name || "";
            const variantName = el.variantData?.variants_name;

            return {
                item_name: variantName
                    ? `${itemName} (${variantName})`
                    : itemName,
                category: el.hms_menu_mst?.hms_menu_categ?.menu_categ_nm || "",
                variant_name: variantName || null,
                price: Number(el.price),
                totalQty: Number(el.totalQty),
                totalSale: Number(el.totalSale)
            };
        });
        // Calculate expenses and money in for all selected hotels
        const totalExpense = await ExpenseEntry.sum("amount", {
            where: {
                hotel_id: { [Op.in]: verifiedHotelIds },
                addExpense: true,
                deleted: false,
                createdAt: { [Op.between]: [startD, endD] }
            }
        });

        const totalMoneyIn = await ExpenseEntry.sum("amount", {
            where: {
                hotel_id: { [Op.in]: verifiedHotelIds },
                addExpense: false,
                deleted: false,
                createdAt: { [Op.between]: [startD, endD] }
            }
        });

        console.log(pickupOrders,
            dineOrders, "Orders picuk And Dinine")

        // Compose final dashboard data
        const dashBoardData = {
            totalMoneyIn: totalMoneyIn || 0,
            totalExpense: totalExpense || 0,
            totalSale: totalSale || 0,
            remainingAmount: ((totalSale || 0) - (totalExpense || 0)) + (totalMoneyIn || 0),
            pickupOrders,
            dineOrders,
            totalSalePercentageChange,
            totalInvoicePercentageChange,
            totalDinInPercentageChange,
            totalCardPercentageChange,
            totalDuePercentageChange,
            totalCashPercentageChange,
            totalUpiPercentageChange,
            totalPickUpPercentageChange,
            totalGivenDiscount: totalGivenDiscount || 0,
            totalSale: totalSale || 0,
            totalInvoice: totalInvoice || 0,
            totalDinInSale: totalDinInSale || 0,
            totalPickUpSale: totalPickUpSale || 0,
            totalCardPayment: totalCardPayment || 0,
            totalDuePayment: totalDuePayment || 0,
            totalCashPayment: totalCashPayment || 0,
            totalUpiPayment: totalUpiPayment || 0,
            liveTotalNoOfOrders: order || 0,
            liveTables: liveTables || 0,
            totalItemsSale,
            // Include the list of hotels that were processed
            processedHotels: verifiedHotelIds
        };

        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { dashBoardData }, STATUSCODE.SUCCESS));
    } catch (err) {
        console.log("multipleHotelData:::", err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};
const getHotel = async (req, res) => {
    try {
        const hotels = await Hotel.findAll({ where: { merchant_id: req.user }, attributes: ['id', "hotel_name", "currency"] })
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { hotels }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log("getting hotels Error:::", err)
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const checkMerchant = async (req, res) => {
    try {
        console.log("Merchant Login req comming")
        const id = req.user
        const user = await Merchant.findOne({ where: { id } })

        if (user) {
            return res.json(success(MESSAGE.SUCCESS, { message: "Login" }, STATUSCODE.SUCCESS))
        }
        return res.json(error(MESSAGE.USER_NOT_FOUND, STATUSCODE.NOT_FOUND))
    } catch (err) {
        // console.log(err.message)
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

const merchantMenu = async (req, res) => {
    try {
        const {
            hotel_id,
            page = 1,
            searchName = "",
            searchCode = "",
            categoryId = 0,
            foodType = "All",
            status = "All"
        } = req.query;

        const limit = 5;
        const offset = (Number(page) - 1) * limit;

        // ✅ Validate merchant
        const checkItsValidMerchant = await Hotel.findOne({
            where: { id: hotel_id, merchant_id: req.user }
        });

        if (!checkItsValidMerchant) {
            return res.json(error("Not Valid Merchant", STATUSCODE.BAD_REQUEST));
        }

        // ✅ Build dynamic where condition
        const whereCondition = {
            hotel_id,
            is_deleted: false
        };

        // 🔎 Search by item name
        if (searchName) {
            whereCondition.item_name = {
                [Op.like]: `%${searchName}%` // Use Op.like if MySQL
            };
        }

        // 🔎 Search by short code
        if (searchCode) {
            whereCondition.shortCode = {
                [Op.like]: `%${searchCode}%`
            };
        }

        // 🏷 Category filter
        if (Number(categoryId) !== 0) {
            whereCondition.menu_categ_id = Number(categoryId);
        }

        // 🥗 Food type filter
        if (foodType !== "All") {
            whereCondition.sub_categories = foodType === "Veg" ? "regular" : foodType;
        }

        // 📌 Status filter
        if (status !== "All") {

            whereCondition.active = status === "Active";
        }

        // ✅ Fetch paginated + filtered data
        const { rows, count } = await Menu.findAndCountAll({
            where: whereCondition,
            limit,
            offset,
            distinct: true,
            attributes: [
                'id',
                'hotel_id',
                'menu_categ_id',
                'item_name',
                'price',
                'foodImage',
                'description',
                'active',
                'shortCode',
                'gst_type',
                'sub_categories',
                'favorite',"barcode_value"
            ],
            include: [
                {
                    model: Menu_categ,
                    where: { active: true },
                    attributes: ['id', 'menu_categ_nm'],
                    required: true
                },
                {
                    model: Variants,
                    as: "variantData",
                    where: { active: true },
                    attributes: ['variants_name', 'id'],
                    through: { attributes: ['variant_price'] },
                    required: false
                },
                {
                    model: AddonDepartment,
                    as: "addonDepartmentData",
                    attributes: ['department_name', 'id'],
                    through: { attributes: ['menu_id', 'addon_department_id'] },
                    include: {
                        model: Addons,
                        attributes: ['addon_name', 'price']
                    }
                }
            ],
            order: [['shortCode', 'DESC']]
        });

        return res.status(STATUSCODE.SUCCESS).json(
            success(MESSAGE.SUCCESS, {
                data: rows,
                pagination: {
                    totalRecords: count,
                    totalPages: Math.ceil(count / limit),
                    page: Number(page),
                }
            }, STATUSCODE.SUCCESS)
        );

    } catch (err) {
        console.error(err, "Merchant Menu");
        return res.json(
            error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR)
        );
    }
};
const merchantCategory = async (req, res) => {
    try {
        const { hotel_id, page = 1, search } = req.query;

        const limit = 10;
        const pageNumber = Number(page) || 1;
        const offset = (pageNumber - 1) * limit;
        const hotelId = Number(hotel_id);

        if (!hotelId) {
            return res
                .status(STATUSCODE.BAD_REQUEST)
                .json(error("Invalid hotel_id", STATUSCODE.BAD_REQUEST));
        }

        const checkItsValidMerchant = await Hotel.findOne({
            where: { id: hotelId, merchant_id: req.user }
        });

        if (!checkItsValidMerchant) {
            return res
                .status(STATUSCODE.BAD_REQUEST)
                .json(error("Not Valid Merchant", STATUSCODE.BAD_REQUEST));
        }

        const searchValue = search?.trim();

        const whereCondition = {
            hotel_id: hotelId,
            active: true,
            ...(searchValue && {
                menu_categ_nm: { [Op.like]: `%${searchValue}%` }
            })
        };

        const { rows, count } = await Menu_categ.findAndCountAll({
            where: whereCondition,
            distinct: true,
            limit,
            offset,
            attributes: ['active', 'id', 'menu_categ_nm', 'rank'],
            order: [['rank', 'ASC']]
        });

        return res.status(STATUSCODE.SUCCESS).json(
            success(MESSAGE.SUCCESS, {
                data: rows,
                pagination: {
                    totalItems: count,
                    totalPages: Math.ceil(count / limit),
                    currentPage: pageNumber,
                    limit
                }
            }, STATUSCODE.SUCCESS)
        );

    } catch (err) {
        console.log(err, "Merchant Category");
        return res
            .status(STATUSCODE.INTERNAL_SERVER_ERROR)
            .json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};
const merchantCategoryAll = async (req, res) => {
    try {

        const { hotel_id } = req.query
        console.log(req.query, req.params)
        const checkItsValidMerchant = await Hotel.findOne({
            where: { id: hotel_id, merchant_id: req.user }
        });

        if (!checkItsValidMerchant) {
            return res.json(error("Not Valid Merchant", STATUSCODE.BAD_REQUEST));
        }

        const rows = await Menu_categ.findAll(
            {
                where: {
                    hotel_id,
                    active: true
                },
                attributes: ['active', 'id', "menu_categ_nm", "rank"],
                order: [['rank', 'ASC']]
            })
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, {
            data: rows,
        }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err, "Merchant Category")
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const deleteMerchantCategory = async (req, res) => {
    try {
        const { id } = req.params;
        const { hotel_id } = req.body;
        const valid = await validateMerchant(hotel_id, req.user);
        if (!valid) return res.json(error("Not Valid Merchant", STATUSCODE.BAD_REQUEST));
        if (!id) return res.json(error("Id Required", STATUSCODE.BAD_REQUEST));
        const category = await Menu_categ.findOne({ where: { id, hotel_id } });
        if (!category) return res.json(error("Category not found", STATUSCODE.BAD_REQUEST));
        await category.update({ active: false });

        await deleteMenucategoryToRadis(id, hotel_id);
        await deleteAllMenuByMenuCategory(id, hotel_id);
        //   }
        await syncMenuVersion({ hotel_id, type: 'menu_categ', action: 'increment' })
        await syncMenuVersion({ hotel_id, type: 'menu', action: 'increment' })
        updateViaSocket(hotel_id)
        return res.status(STATUSCODE.SUCCESS).json(success("Category deleted", { data: category }, STATUSCODE.SUCCESS));
    } catch (err) {
        console.log(err, "Delete Merchant Category")
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const createMerchantCategory = async (req, res) => {
    try {

        const { hotel_id, menu_categ_nm } = req?.body?.payload || req.body;
        const valid = await validateMerchant(hotel_id, req.user);
        if (!valid) return res.json(error("Not Valid Merchant", STATUSCODE.BAD_REQUEST));
        const existing = await Menu_categ.findOne({ where: { hotel_id, menu_categ_nm } });
        if (existing) return res.json(error("Category name already exists", STATUSCODE.BAD_REQUEST));
        const findMaxRank = await Menu_categ.max('rank', { where: { hotel_id: req.user, active: true } })

        const catagories = {
            menu_categ_nm,
            hotel_id,
            rank: findMaxRank + 1,
            active: true
        }

        const category = await Menu_categ.create({ ...catagories });
        await newMenuCreatedToRadis(category.id, hotel_id);

        //   }
        await syncMenuVersion({ hotel_id, type: 'menu_categ', action: 'increment' })
        updateViaSocket(hotel_id)
        return res.status(STATUSCODE.SUCCESS).json(success("Category created", { data: category }, STATUSCODE.SUCCESS));
    } catch (err) {
        console.log(err, "Create Merchant Category")
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

const updateMerchantCategory = async (req, res) => {
    try {
        console.log("Update Merchant Category Req:::", req.params, req.body)
        const { id } = req.params;
        const { hotel_id, menu_categ_nm, rank } = req?.body?.payload || req.body;
        const valid = await validateMerchant(hotel_id, req.user);
        if (!valid) return res.json(error("Not Valid Merchant", STATUSCODE.BAD_REQUEST));
        const category = await Menu_categ.findOne({ where: { id, hotel_id } });
        if (!category) return res.json(error("Category not found", STATUSCODE.BAD_REQUEST));
        if (menu_categ_nm && menu_categ_nm !== category.menu_categ_nm) {
            const existing = await Menu_categ.findOne({ where: { hotel_id, menu_categ_nm, id: { [Op.ne]: id } } });
            if (existing) return res.json(error("Category name already exists", STATUSCODE.BAD_REQUEST));
        }
        await category.update({ menu_categ_nm, rank });
        await updateMenucategoryToRadis(id, hotel_id);

        //   }
        await syncMenuVersion({ hotel_id, type: 'menu_categ', action: 'increment' })
        updateViaSocket(hotel_id)
        return res.status(STATUSCODE.SUCCESS).json(success("Category updated", { data: category }, STATUSCODE.SUCCESS));
    } catch (err) {
        console.log(err, "Update Merchant Category")
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}


const createMenuItem = async (req, res) => {
    try {
        const {
            hotel_id, item_name, price, description, shortCode,
            menu_categ_id, sub_categories, gst_type, foodImage, favorite,barcode_value
        } = req.body;
        console.log("Create Menu Item Req:::", req.body)
        const valid = await validateMerchant(hotel_id, req.user);
        if (!valid) return res.json(error("Not Valid Merchant", STATUSCODE.BAD_REQUEST));

        // Check shortCode uniqueness within the hotel
        const existing = await Menu.findOne({ where: { hotel_id, shortCode } });
        if (existing) return res.json(error("Short Code already exists", STATUSCODE.BAD_REQUEST));
        if(barcode_value){
            const existing = await Menu.findOne({ where: { hotel_id, barcode_value } });
if(existing){
     if (existing) return res.json(error("Barcode already exists", STATUSCODE.BAD_REQUEST));
}
        }
        const item = await Menu.create({barcode_value:barcode_value??"",
            hotel_id, item_name, price, description, shortCode,
            menu_categ_id, sub_categories, gst_type,
            foodImage: foodImage || null,
            favorite: favorite || false,
            active: true
        });
        await newMenuCreatedToRadis(item.id, hotel_id);

        //   }
        await syncMenuVersion({ hotel_id, type: 'menu', action: 'increment' })
        updateViaSocket(hotel_id)
        return res.status(STATUSCODE.SUCCESS).json(
            success("Menu item created", { data: item }, STATUSCODE.SUCCESS)
        );

    } catch (err) {
        console.error(err, "createMenuItem");
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// [4] NEW — UPDATE MENU ITEM (inline edit: price, description, name, etc.)
//     PUT /merchant/menu/:id
//     Body: { hotel_id, ...fields to update }
// ─────────────────────────────────────────────────────────────────────────────

const updateMenuItem = async (req, res) => {
    try {
        const { id } = req.params;
        const {
            hotel_id, item_name, price, description, shortCode,
            menu_categ_id, sub_categories, gst_type, foodImage, favorite,barcode_value,
        } = req.body;
        console.log("Update Menu Item Req:::", req.params, req.body)
        const valid = await validateMerchant(hotel_id, req.user);
        if (!valid) return res.json(error("Not Valid Merchant", STATUSCODE.BAD_REQUEST));

        const item = await Menu.findOne({ where: { id, hotel_id } });
        if (!item) return res.json(error("Menu item not found", STATUSCODE.BAD_REQUEST));

        // Check shortCode uniqueness (exclude current item)
        if (shortCode && shortCode !== item.shortCode) {
            const existing = await Menu.findOne({
                where: { hotel_id, shortCode, id: { [Op.ne]: id } }
            });
            if (existing) return res.json(error("Short Code already exists", STATUSCODE.BAD_REQUEST));
        }
        if (barcode_value && barcode_value !== item.barcode_value) {
            const existing = await Menu.findOne({
                where: { hotel_id, barcode_value, id: { [Op.ne]: id } }
            });
            if (existing) return res.json(error("Barcode already exists", STATUSCODE.BAD_REQUEST));
        }

        await item.update({
            barcode_value:barcode_value??item.barcode_value,
            item_name: item_name ?? item.item_name,
            price: price ?? item.price,
            description: description ?? item.description,
            shortCode: shortCode ?? item.shortCode,
            menu_categ_id: menu_categ_id ?? item.menu_categ_id,
            sub_categories: sub_categories ?? item.sub_categories,
            gst_type: gst_type ?? item.gst_type,
            foodImage: foodImage ?? item.foodImage,
            favorite: favorite ?? item.favorite,
        });
        await updateMenuToForMerchantRadis(id, hotel_id);

        //   }
        await syncMenuVersion({ hotel_id, type: 'menu', action: 'increment' })
        updateViaSocket(hotel_id)
        return res.status(STATUSCODE.SUCCESS).json(
            success("Menu item updated", { data: item }, STATUSCODE.SUCCESS)
        );

    } catch (err) {
        console.error(err, "updateMenuItem");
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// [5] NEW — TOGGLE STATUS (single item Active / Inactive)
//     PATCH /merchant/menu/:id/status
//     Body: { hotel_id, active: true|false }
// ─────────────────────────────────────────────────────────────────────────────

const toggleMenuItemStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { hotel_id, active } = req.body;
        // console.log("Toggle Status Req:::", req.params, req.body)
        const valid = await validateMerchant(hotel_id, req.user);
        if (!valid) return res.json(error("Not Valid Merchant", STATUSCODE.BAD_REQUEST));

        const item = await Menu.findOne({ where: { id, hotel_id } });
        if (!item) return res.json(error("Menu item not found", STATUSCODE.BAD_REQUEST));

        await item.update({ active: Boolean(active) });
        await updateMenuToForMerchantRadis(id, hotel_id);
        await syncMenuVersion({ hotel_id, type: 'menu', action: 'increment' })
        updateViaSocket(hotel_id)
        //  syncMenuVersion(hotel_id,'menu_categ','increment')
        return res.status(STATUSCODE.SUCCESS).json(
            success(`Menu item ${active ? 'activated' : 'deactivated'}`, { data: item }, STATUSCODE.SUCCESS)
        );

    } catch (err) {
        console.error(err, "toggleMenuItemStatus");
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// [6] NEW — SOFT DELETE (single item)
//     DELETE /merchant/menu/:id
//     Body: { hotel_id }
// ─────────────────────────────────────────────────────────────────────────────

const deleteMenuItem = async (req, res) => {
    try {
        const { id } = req.params;
        const { hotel_id } = req.body;

        const valid = await validateMerchant(hotel_id, req.user);
        if (!valid) return res.json(error("Not Valid Merchant", STATUSCODE.BAD_REQUEST));

        const item = await Menu.findOne({ where: { id, hotel_id } });
        if (!item) return res.json(error("Menu item not found", STATUSCODE.BAD_REQUEST));

        // Soft delete: set active = false
        await item.update({ is_deleted: true });

        // for (const cur of ids) {
        await deleteMenuToradis(id, hotel_id);

        //   }
        await syncMenuVersion({ hotel_id, type: 'menu', action: 'increment' })
        updateViaSocket(hotel_id)
        return res.status(STATUSCODE.SUCCESS).json(
            success("Menu item deleted", {}, STATUSCODE.SUCCESS)
        );

    } catch (err) {
        console.error(err, "deleteMenuItem");
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// [7] NEW — BULK ACTIVATE (multiple items) ← CORE FOR BULK BAR
//     PATCH /merchant/menu/bulk/activate
//     Body: { hotel_id, ids: [1, 2, 3] }
// ─────────────────────────────────────────────────────────────────────────────
const bulkActivateMenuItems = async (req, res) => {
    try {
        const { hotel_id, ids } = req.body;

        if (!Array.isArray(ids) || ids.length === 0)
            return res.json(error("ids array is required", STATUSCODE.BAD_REQUEST));

        const valid = await validateMerchant(hotel_id, req.user);
        if (!valid) return res.json(error("Not Valid Merchant", STATUSCODE.BAD_REQUEST));

        const [affectedCount] = await Menu.update(
            { active: true },
            { where: { id: { [Op.in]: ids }, hotel_id } }
        );

        for (const cur of ids) {
            updateMenuToForMerchantRadis(cur, hotel_id);

        }
        await syncMenuVersion({ hotel_id, type: 'menu', action: 'increment' })
        updateViaSocket(hotel_id)
        return res.status(STATUSCODE.SUCCESS).json(
            success(`${affectedCount} item(s) activated`, { affectedCount }, STATUSCODE.SUCCESS)
        );

    } catch (err) {
        console.error(err, "bulkActivateMenuItems");
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// [8] NEW — BULK DEACTIVATE (multiple items) ← CORE FOR BULK BAR
//     PATCH /merchant/menu/bulk/deactivate
//     Body: { hotel_id, ids: [1, 2, 3] }
// ─────────────────────────────────────────────────────────────────────────────
const bulkDeactivateMenuItems = async (req, res) => {
    try {
        const { hotel_id, ids } = req.body;

        if (!Array.isArray(ids) || ids.length === 0)
            return res.json(error("ids array is required", STATUSCODE.BAD_REQUEST));

        const valid = await validateMerchant(hotel_id, req.user);
        if (!valid) return res.json(error("Not Valid Merchant", STATUSCODE.BAD_REQUEST));

        const [affectedCount] = await Menu.update(
            { active: false },
            { where: { id: { [Op.in]: ids }, hotel_id } }
        );

        for (const cur of ids) {
            updateMenuToForMerchantRadis(cur, hotel_id);

        }
        await syncMenuVersion({ hotel_id, type: 'menu', action: 'increment' })
        updateViaSocket(hotel_id)
        return res.status(STATUSCODE.SUCCESS).json(
            success(`${affectedCount} item(s) deactivated`, { affectedCount }, STATUSCODE.SUCCESS)
        );

    } catch (err) {
        console.error(err, "bulkDeactivateMenuItems");
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// [9] NEW — BULK DELETE (soft delete multiple) ← CORE FOR BULK BAR
//     DELETE /merchant/menu/bulk
//     Body: { hotel_id, ids: [1, 2, 3] }
// ─────────────────────────────────────────────────────────────────────────────
const bulkDeleteMenuItems = async (req, res) => {
    try {
        const { hotel_id, ids } = req.body;

        if (!Array.isArray(ids) || ids.length === 0)
            return res.json(error("ids array is required", STATUSCODE.BAD_REQUEST));

        const valid = await validateMerchant(hotel_id, req.user);
        if (!valid) return res.json(error("Not Valid Merchant", STATUSCODE.BAD_REQUEST));

        const [affectedCount] = await Menu.update(
            { active: false },
            { where: { id: { [Op.in]: ids }, hotel_id } }
        );

        for (const cur of ids) {
            updateMenuToForMerchantRadis(cur, hotel_id);

        }
        await syncMenuVersion({ hotel_id, type: 'menu', action: 'increment' })
        updateViaSocket(hotel_id)
        return res.status(STATUSCODE.SUCCESS).json(
            success(`${affectedCount} item(s) deleted`, { affectedCount }, STATUSCODE.SUCCESS)
        );

    } catch (err) {
        console.error(err, "bulkDeleteMenuItems");
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// [10] NEW — GET VARIANTS for a menu item (Manage Variants modal)
//      GET /merchant/menu/:id/variants?hotel_id=1
// ─────────────────────────────────────────────────────────────────────────────

const extractNumericArray = (payload) => {
    return Object.keys(payload)
        .filter(k => !isNaN(k))   // only 0,1,2...
        .sort((a, b) => a - b)
        .map(k => payload[k]);
};
const setMenuVariants = async (req, res) => {
    const t = await sequelize.transaction();

    try {
        console.log("Set Menu Variants Req:::", req.body);

        const payload = req.body.payload || {};

        const menu_id = payload.menu_id;
        const hotel_id = payload.hotel_id;

        const variants = extractNumericArray(payload); // ← IMPORTANT

        if (!menu_id || !hotel_id) {
            await t.rollback();
            return res.json(error("menu_id & hotel_id required", STATUSCODE.BAD_REQUEST));
        }

        const menu = await Menu.findOne({
            where: { id: menu_id, hotel_id },
            transaction: t
        });

        if (!menu) {
            await t.rollback();
            return res.json(error("Menu Item Not Found", STATUSCODE.NOT_FOUND));
        }

        const variantIds = variants.map(v => v.variant_id);

        if (!variantIds.length) {
            await MenuVariants.destroy({ where: { menu_id }, transaction: t });
            await t.commit();
            await updateMenuToForMerchantRadis(menu_id, hotel_id);
            return res.json(success("All variants removed", {}, STATUSCODE.SUCCESS));
        }

        const validVariants = await Variants.findAll({
            where: {
                id: variantIds,
                hotel_id,
                active: true
            },
            transaction: t
        });

        if (validVariants.length !== variantIds.length) {
            await t.rollback();
            return res.json(error("Invalid variants selected", STATUSCODE.BAD_REQUEST));
        }

        await MenuVariants.destroy({
            where: {
                menu_id,
                variant_id: { [Op.notIn]: variantIds }
            },
            transaction: t
        });

        for (const v of variants) {
            const { variant_id, price } = v;

            const existing = await MenuVariants.findOne({
                where: { menu_id, variant_id },
                transaction: t
            });

            if (existing) {
                await existing.update(
                    { variant_price: price },
                    { transaction: t }
                );
            } else {
                await MenuVariants.create({
                    menu_id,
                    variant_id,
                    variant_price: price,
                    hotel_id,
                    active: true
                }, { transaction: t });
            }
        }

        await t.commit();

        await updateMenuToForMerchantRadis(menu_id, hotel_id);

        await syncMenuVersion({ hotel_id, type: 'menu', action: 'increment' })
        updateViaSocket(hotel_id)
        //  syncMenuVersion(hotel_id,'menu_categ','increment')

        return res.json(success("Variants Updated", {}, STATUSCODE.SUCCESS));

    } catch (err) {
        console.log(err, "setMenuVariants");
        await t.rollback();
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// [11] NEW — GET ADDONS for a menu item (Manage Addons modal)
//      GET /merchant/menu/:id/addons?hotel_id=1
// ─────────────────────────────────────────────────────────────────────────────

const setMenuAddons = async (req, res) => {
    const t = await sequelize.transaction();

    try {
        console.log("Set Menu Addons Req:::", req.body);

        const payload = req.body.payload || {};

        const menu_id = payload.menu_id;
        const hotel_id = payload.hotel_id;

        const addons = extractNumericArray(payload); // ← IMPORTANT

        if (!menu_id || !hotel_id) {
            await t.rollback();
            return res.json(error("menu_id & hotel_id required", STATUSCODE.BAD_REQUEST));
        }

        const menu = await Menu.findOne({
            where: { id: menu_id, hotel_id },
            transaction: t
        });

        if (!menu) {
            await t.rollback();
            return res.json(error("Menu Item Not Found", STATUSCODE.NOT_FOUND));
        }

        const addonIds = addons.map(Number);

        // Empty → remove all
        if (!addonIds.length) {
            await MenuAddon.destroy({ where: { menu_id }, transaction: t });
            await t.commit();
            await updateMenuToForMerchantRadis(menu_id, hotel_id);
            return res.json(success("All addons removed", {}, STATUSCODE.SUCCESS));
        }

        const validDepartments = await AddonDepartment.findAll({
            where: {
                id: addonIds,
                hotel_id,
                active: true
            },
            transaction: t
        });

        if (validDepartments.length !== addonIds.length) {
            await t.rollback();
            return res.json(error("Invalid addon department selected", STATUSCODE.BAD_REQUEST));
        }

        await MenuAddon.destroy({
            where: {
                menu_id,
                addon_department_id: { [Op.notIn]: addonIds }
            },
            transaction: t
        });

        for (const addon_department_id of addonIds) {
            const exists = await MenuAddon.findOne({
                where: { menu_id, addon_department_id },
                transaction: t
            });

            if (!exists) {
                await MenuAddon.create({
                    menu_id,
                    addon_department_id,
                    hotel_id,
                    active: true
                }, { transaction: t });
            }
        }

        await t.commit();

        await updateMenuToForMerchantRadis(menu_id, hotel_id);

        await syncMenuVersion({ hotel_id, type: 'menu', action: 'increment' })
        updateViaSocket(hotel_id)
        return res.json(success("Addons Updated", {}, STATUSCODE.SUCCESS));

    } catch (err) {
        console.log(err, "setMenuAddons");
        await t.rollback();
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// [12] NEW — UPLOAD FOOD IMAGE
//      POST /merchant/menu/:id/image
//      Multipart form-data: { hotel_id, image }
//      (wire up multer / cloudinary / s3 middleware before this)
// ─────────────────────────────────────────────────────────────────────────────
const uploadMenuItemImage = async (req, res) => {
    try {
        const { id } = req.params;
        const { hotel_id } = req.body;
        const imageUrl = req.file?.path || req.file?.location; // depends on storage engine

        if (!imageUrl) return res.json(error("Image upload failed", STATUSCODE.BAD_REQUEST));

        const valid = await validateMerchant(hotel_id, req.user);
        if (!valid) return res.json(error("Not Valid Merchant", STATUSCODE.BAD_REQUEST));

        const item = await Menu.findOne({ where: { id, hotel_id } });
        if (!item) return res.json(error("Menu item not found", STATUSCODE.BAD_REQUEST));

        await item.update({ foodImage: imageUrl });

        return res.status(STATUSCODE.SUCCESS).json(
            success("Image uploaded", { imageUrl }, STATUSCODE.SUCCESS)
        );

    } catch (err) {
        console.error(err, "uploadMenuItemImage");
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};
const merchantVarint = async (req, res) => {
    try {
        const { hotel_id, page = 1, all = false, search } = req.query;

        const limit = 10;
        const pageNumber = Math.max(Number(page), 1);
        const offset = (pageNumber - 1) * limit;

        const checkItsValidMerchant = await Hotel.findOne({
            where: { id: hotel_id, merchant_id: req.user }
        });

        if (!checkItsValidMerchant) {
            return res.json(error("Not Valid Merchant", STATUSCODE.BAD_REQUEST));
        }

        let rows = [];
        let count = 0;

        const isAll = all === "true" || all === true;

        if (isAll) {

            rows = await Variants.findAll({
                where: {
                    hotel_id,
                    active: true
                },
                attributes: ['variants_name', 'id', 'active'],
                order: [['id', 'DESC']]
            });

            count = rows.length;

        } else {

            const result = await Variants.findAndCountAll({
                where: {
                    hotel_id,
                    active: true,
                    ...(search && { variants_name: { [Op.like]: `%${search}%` } })
                },
                limit,
                offset,
                attributes: ['variants_name', 'id', 'active'],
                order: [['id', 'DESC']]
            });

            rows = result.rows;
            count = result.count;
        }

        return res.status(STATUSCODE.SUCCESS).json(
            success(MESSAGE.SUCCESS, {
                data: rows,
                pagination: {
                    totalItems: count,
                    totalPages: isAll ? 1 : Math.ceil(count / limit),
                    currentPage: pageNumber,
                    limit: isAll ? count : limit
                }
            }, STATUSCODE.SUCCESS)
        );

    } catch (err) {
        console.log(err, "Merchant Variant");
        return res.json(
            error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR)
        );
    }
};
const updateMerchantVariant = async (req, res) => {
    try {
        const { id } = req.params;
        const { variants_name, active, hotel_id } = req.body;
        const checkItsValidMerchant = await Hotel.findOne({
            where: { id: hotel_id, merchant_id: req.user }
        });

        if (!checkItsValidMerchant) {
            return res.json(error("Not Valid Merchant", STATUSCODE.BAD_REQUEST));
        }
        const variant = await Variants.findOne({ where: { id, hotel_id } });
        if (!variant) {
            return res.json(error("Variant not found", STATUSCODE.BAD_REQUEST));
        }
        await variant.update({ variants_name, active });
        return res.status(STATUSCODE.SUCCESS).json(success("Variant updated", { data: variant }, STATUSCODE.SUCCESS));
    } catch (err) {
        console.log(err, "Update Merchant Variant");
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};
const createMerchantVariant = async (req, res) => {
    try {
        const { variants_name, hotel_id } = req.body;
        const checkItsValidMerchant = await Hotel.findOne({
            where: { id: hotel_id, merchant_id: req.user }
        });

        if (!checkItsValidMerchant) {
            return res.json(error("Not Valid Merchant", STATUSCODE.BAD_REQUEST));
        }
        const existingVariant = await Variants.findOne({ where: { variants_name, hotel_id } });
        if (existingVariant) {
            return res.json(error("Variant name already exists", STATUSCODE.BAD_REQUEST));
        }
        const variant = await Variants.create({ variants_name, hotel_id, active: true });
        return res.status(STATUSCODE.SUCCESS).json(success("Variant created", { data: variant }, STATUSCODE.SUCCESS));
    } catch (err) {
        console.log(err, "Create Merchant Variant");
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};




const merchantAddons = async (req, res) => {
    try {
        const { hotel_id, page = 1, all = false, search } = req.query;

        const limit = 10;
        const offset = (Number(page) - 1) * limit;

        const checkItsValidMerchant = await Hotel.findOne({
            where: { id: hotel_id, merchant_id: req.user }
        });

        if (!checkItsValidMerchant) {
            return res.json(error("Not Valid Merchant", STATUSCODE.BAD_REQUEST));
        }

        let rows = [];
        let count = 0;

        if (all === "true" || all === true) {

            rows = await AddonDepartment.findAll({
                where: { hotel_id, active: true },
                attributes: [
                    'id',
                    'department_name',
                    'maximum_allowed_addon',
                    'singleSelection',
                    'minimum_allowed_addon'
                ],
                include: {
                    model: Addons,
                    attributes: ['id', 'addon_name', 'price', 'attributes']
                },
                order: [['id', 'DESC']]
            });

            count = rows.length;

        } else {

            const result = await AddonDepartment.findAndCountAll({
                where: {
                    hotel_id, active: true
                    , ...(search && { department_name: { [Op.like]: `%${search}%` } })
                },
                distinct: true,
                limit,
                offset,
                attributes: [
                    'id',
                    'department_name',
                    'maximum_allowed_addon',
                    'singleSelection',
                    'minimum_allowed_addon'
                ],
                include: {
                    model: Addons,
                    attributes: ['id', 'addon_name', 'price', 'attributes']
                },
                order: [['id', 'DESC']]
            });

            rows = result.rows;
            count = result.count;
        }

        return res.status(STATUSCODE.SUCCESS).json(
            success(MESSAGE.SUCCESS, {
                data: rows,
                pagination: {
                    totalItems: count,
                    totalPages: Math.ceil(count / limit),
                    currentPage: Number(page),
                    limit
                }
            }, STATUSCODE.SUCCESS)
        );

    } catch (err) {
        console.log(err, "Merchant Addons");
        return res.json(
            error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR)
        );
    }
};
const createMerchantAddonDepartment = async (req, res) => {
    const t = await sequelize.transaction();

    try {
        let {
            department_name,
            hotel_id,
            maximum_allowed_addon,
            minimum_allowed_addon,
            singleSelection,
            addons = []
        } = req.body;
        // console.log("Create Addon Department Req:::", req.body)
        // return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
        const hotelId = Number(hotel_id);
        maximum_allowed_addon = Number(maximum_allowed_addon);
        minimum_allowed_addon = Number(minimum_allowed_addon);

        if (!hotelId) {
            await t.rollback();
            return res
                .json(error("Invalid hotel_id", STATUSCODE.BAD_REQUEST));
        }

        if (!department_name?.trim()) {
            await t.rollback();
            return res
                .json(error("Department name required", STATUSCODE.BAD_REQUEST));
        }

        if (maximum_allowed_addon < minimum_allowed_addon) {
            await t.rollback();
            return res
                .json(error("Minimum cannot exceed Maximum", STATUSCODE.BAD_REQUEST));
        }

        if (addons.length < minimum_allowed_addon) {
            await t.rollback();
            return res
                .json(error("Not enough addons for minimum requirement", STATUSCODE.BAD_REQUEST));
        }

        const checkItsValidMerchant = await Hotel.findOne({
            where: { id: hotelId, merchant_id: req.user },
            transaction: t
        });

        if (!checkItsValidMerchant) {
            await t.rollback();
            return res
                .json(error("Not Valid Merchant", STATUSCODE.BAD_REQUEST));
        }

        const existingDepartment = await AddonDepartment.findOne({
            where: { department_name, hotel_id: hotelId },
            transaction: t
        });

        if (existingDepartment) {
            await t.rollback();
            return res
                .json(error("Department name already exists", STATUSCODE.BAD_REQUEST));
        }

        const department = await AddonDepartment.create({
            department_name,
            hotel_id: hotelId,
            maximum_allowed_addon,
            minimum_allowed_addon,
            singleSelection,
            active: true
        }, { transaction: t });

        if (!addons.length) {
            await t.rollback();
            return res
                .json(error("Please add addon items", STATUSCODE.BAD_REQUEST));
        }

        const addonData = addons.map(cur => ({
            addon_name: cur.addon_name,
            price: cur.price,
            attributes: cur.attributes || "veg",
            department_id: department.id,
            hotel_id: hotelId
        }));

        await Addons.bulkCreate(addonData, { transaction: t });

        await t.commit();

        return res.status(STATUSCODE.SUCCESS).json(
            success("Addon Department created successfully", { data: department }, STATUSCODE.CREATED)
        );

    } catch (err) {
        await t.rollback();
        console.log(err, "Create Merchant Addon Department");
        return res
            .json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};
const updateMerchantAddonDepartment = async (req, res) => {
    const t = await sequelize.transaction();

    try {
        const { id } = req.params;

        let {
            department_name,
            hotel_id,
            maximum_allowed_addon,
            minimum_allowed_addon,
            singleSelection,
            active,
            addons = []
        } = req.body;
        console.log("Update Addon Department Req:::", req.params, req.body)
        // return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
        const hotelId = Number(hotel_id);
        maximum_allowed_addon = Number(maximum_allowed_addon);
        minimum_allowed_addon = Number(minimum_allowed_addon);

        if (!hotelId) {
            await t.rollback();
            return res
                .json(error("Invalid hotel_id", STATUSCODE.BAD_REQUEST));
        }

        if (maximum_allowed_addon < minimum_allowed_addon) {
            await t.rollback();
            return res
                .json(error("Minimum cannot exceed Maximum", STATUSCODE.BAD_REQUEST));
        }

        const checkItsValidMerchant = await Hotel.findOne({
            where: { id: hotelId, merchant_id: req.user },
            transaction: t
        });

        if (!checkItsValidMerchant) {
            await t.rollback();
            return res
                .json(error("Not Valid Merchant", STATUSCODE.BAD_REQUEST));
        }

        const department = await AddonDepartment.findOne({
            where: { id, hotel_id: hotelId },
            transaction: t
        });

        if (!department) {
            await t.rollback();
            return res
                .json(error("Addon Department not found", STATUSCODE.BAD_REQUEST));
        }

        if (department_name && department_name !== department.department_name) {
            const existingDepartment = await AddonDepartment.findOne({
                where: {
                    department_name,
                    hotel_id: hotelId,
                    id: { [Op.ne]: id }
                },
                transaction: t
            });

            if (existingDepartment) {
                await t.rollback();
                return res
                    .json(error("Department name already exists", STATUSCODE.BAD_REQUEST));
            }
        }

        await department.update({
            department_name,
            maximum_allowed_addon,
            minimum_allowed_addon,
            singleSelection,
            active
        }, { transaction: t });

        if (addons.length) {
            await Addons.destroy({
                where: { department_id: id, hotel_id: hotelId },
                transaction: t
            });

            const addonData = addons.map(cur => ({
                addon_name: cur.addon_name,
                price: cur.price,
                attributes: cur.attributes || "veg",
                department_id: id,
                hotel_id: hotelId
            }));

            await Addons.bulkCreate(addonData, { transaction: t });
        }

        await t.commit();

        return res.status(STATUSCODE.SUCCESS).json(
            success("Addon Department updated successfully", { data: department }, STATUSCODE.SUCCESS)
        );

    } catch (err) {
        await t.rollback();
        console.log(err, "Update Merchant Addon Department");
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};











const merchantUpdateManualStock = async (req, res) => {
    try {
        const { manualStockData, hotel_id } = req.body
        const checkItsValidMerchant = await Hotel.findOne({
            where: { id: hotel_id, merchant_id: req.user }
        });

        if (!checkItsValidMerchant) {
            return res.json(error("Not Valid Merchant", STATUSCODE.BAD_REQUEST));
        }

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

                    // console.log(cur, "here insdie consumption")
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
                    const setting = await RestaurantSetting.findOne({ where: { hotel_id } });
                    const timeZone = setting?.timeZone || 'Asia/Kolkata';
                    const businessStartTime = setting?.business_day_start_time || '00:01:00';
                    const business_date = getBusinessDate(timeZone, businessStartTime);

                    await StockHistory.create({ business_date, qty: +(difference).toFixed(2), price: getCurrentStockInHand.average_price, total_amount: +(difference * getCurrentStockInHand.average_price).toFixed(2), stock_in, raw_material_id: getCurrentStockInHand.raw_material_id, hotel_id, })

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
const merchantStockInHand = async (req, res) => {
    try {
        const { search, hotel_id } = req.query
        console.log(req.params)
        const checkItsValidMerchant = await Hotel.findOne({
            where: { id: hotel_id, merchant_id: req.user }
        });

        if (!checkItsValidMerchant) {
            return res.json(error("Not Valid Merchant", STATUSCODE.BAD_REQUEST));
        }

        const whereCondition = { hotel_id: +hotel_id }
        if (search) {
            whereCondition.raw_material_name = { [Op.like]: `%${search}%` }
        }

        const stockInHand = await StockInHand.findAll({ where: { hotel_id: +hotel_id, deleted: false }, include: { model: RawMaterial, where: { ...whereCondition }, required: true, include: [{ model: Unit, as: "purchaseUnit" }, { model: Unit, as: "consumptionUnit" }] } })
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { stockInHand }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err)
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const merchantStockInOutHistory = async (req, res) => {
    try {
        const { startDate, endDate, hotel_id } = req.query
        const checkItsValidMerchant = await Hotel.findOne({
            where: { id: hotel_id, merchant_id: req.user }
        });

        if (!checkItsValidMerchant) {
            return res.json(error("Not Valid Merchant", STATUSCODE.BAD_REQUEST));
        }

        const startD = new Date(startDate)
        const endD = new Date(endDate)
        const stockInOutHistory = await StockHistory.findAll({ where: { hotel_id, deleted: false, createdAt: { [Op.between]: [startD, endD] } }, include: { model: RawMaterial, include: [{ model: Unit, as: "purchaseUnit" }, { model: Unit, as: "consumptionUnit" }] } })
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { stockInOutHistory }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err)
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

const merchantUnitEdit = async (req, res) => {
    try {




        const { unitName: unit_name, shortName, id, hotel_id } = req.body
        const checkItsValidMerchant = await Hotel.findOne({
            where: { id: hotel_id, merchant_id: req.user }
        });

        if (!checkItsValidMerchant) {
            return res.json(error("Not Valid Merchant", STATUSCODE.BAD_REQUEST));
        }
        const unit = await Unit.findOne({ where: { id } })
        if (!unit) return res.json(error("Unit Not Found", STATUSCODE.BAD_REQUEST))
        await Unit.update({ unit_name, shortName, hotel_id }, { where: { id } })
        const units = await Unit.findAll({ where: { hotel_id } })
        return res.status(STATUSCODE.SUCCESS).json(success("Unit Updated Successfully", { units }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err)
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const merchantAddUnit = async (req, res) => {
    try {

        const { unitName: unit_name, shortName, hotel_id } = req.body
        const checkItsValidMerchant = await Hotel.findOne({
            where: { id: hotel_id, merchant_id: req.user }
        });

        if (!checkItsValidMerchant) {
            return res.json(error("Not Valid Merchant", STATUSCODE.BAD_REQUEST));
        }
        console.log(req.body)
        console.log(unit_name, shortName, "dattat-->")
        const unit = await Unit.findOne({ where: { unit_name, hotel_id } })
        console.log(unit, "Unit--->")
        if (unit) return res.json(error("Unit Name Has Already Taken", STATUSCODE.BAD_REQUEST))
        await Unit.create({ unit_name, shortName, hotel_id })
        const units = await Unit.findAll({ where: { hotel_id } })
        return res.status(STATUSCODE.CREATED).json(success("Unit Created", { units }, STATUSCODE.CREATED))
    } catch (err) {
        console.log(err)
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const merchantGetAllUnit = async (req, res) => {
    try {
        console.log(req.query, req.params)
        const { hotel_id } = req.query
        const checkItsValidMerchant = await Hotel.findOne({
            where: { id: hotel_id, merchant_id: req.user }
        });

        if (!checkItsValidMerchant) {
            return res.json(error("Not Valid Merchant", STATUSCODE.BAD_REQUEST));
        }
        const hotel = await Hotel.findOne({ where: { id: +hotel_id } })
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST))
        const units = await Unit.findAll({ where: { hotel_id: +hotel_id } })
        return res.status(STATUSCODE.SUCCESS).json(success("Unit Fetch Successfully", { units }, STATUSCODE.SUCCESS))
    } catch (err) {
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

// Raw Material 

const merchantGetAllRawMaterial = async (req, res) => {
    try {
        const { search, hotel_id } = req.query

        const whereCondition = { hotel_id: +hotel_id }
        if (search) {
            whereCondition.raw_material_name = { [Op.like]: `%${search}%` }
        }

        const checkItsValidMerchant = await Hotel.findOne({
            where: { id: hotel_id, merchant_id: req.user }
        });

        if (!checkItsValidMerchant) {
            return res.json(error("Not Valid Merchant", STATUSCODE.BAD_REQUEST));
        }
        const rawMaterials = await RawMaterial.findAll({ where: { ...whereCondition }, include: [{ model: Unit, as: "purchaseUnit" }, { model: Unit, as: "consumptionUnit" }] })
        // const rawMaterials = await RawMaterial.findAll({ where: { hotel_id: req.user }, include: [{ model: Unit, as: "purchaseUnit" }, { model: Unit, as: "consumptionUnit" }] })
        return res.status(STATUSCODE.SUCCESS).json(success("RawMaterial Fetch SuccessFully", { rawMaterials }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err)
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const merchantAddRawMaterial = async (req, res) => {
    try {

        const { hotel_id, raw_material_name, purchase_price, unit: unit_id, consumption_unit, conversion_qty, mini_stock_level, mini_stock_level_qty } = req.body
        const checkItsValidMerchant = await Hotel.findOne({
            where: { id: hotel_id, merchant_id: req.user }
        });

        if (!checkItsValidMerchant) {
            return res.json(error("Not Valid Merchant", STATUSCODE.BAD_REQUEST));
        }
        const rawMaterial = await RawMaterial.findOne({ where: { raw_material_name, hotel_id: +hotel_id } })
        if (rawMaterial) return res.json(error("RawMaterial Name Has Already Taken", STATUSCODE.BAD_REQUEST))
        const findUnit = await Unit.findByPk(unit_id)
        const find2Unit = await Unit.findByPk(consumption_unit)
        if (!findUnit || !find2Unit) return res.json(error("Unit Not Found", STATUSCODE.BAD_REQUEST))
        await RawMaterial.create({ mini_stock_level, mini_stock_level_qty, raw_material_name, purchase_price, unit_id, hotel_id: +hotel_id, consumption_unit, conversion_qty })
        const rawMaterials = await RawMaterial.findAll({ where: { hotel_id: +hotel_id }, include: [{ model: Unit, as: "purchaseUnit" }, { model: Unit, as: "consumptionUnit" }] })
        return res.status(STATUSCODE.CREATED).json(success("RawMaterial Created", { rawMaterials }, STATUSCODE.CREATED))
    } catch (err) {
        console.log(err)
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

const merchantEditRawMaterial = async (req, res) => {
    try {


        const { hotel_id, raw_material_name, purchase_price, unit: unit_id, id, consumption_unit, conversion_qty, mini_stock_level, mini_stock_level_qty, } = req.body
        const checkItsValidMerchant = await Hotel.findOne({
            where: { id: hotel_id, merchant_id: req.user }
        });

        if (!checkItsValidMerchant) {
            return res.json(error("Not Valid Merchant", STATUSCODE.BAD_REQUEST));
        }
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

//Recipes 

const merchantGetAllRecipes = async (req, res) => {
    try {

        const { hotel_id } = req.query
        const checkItsValidMerchant = await Hotel.findOne({
            where: { id: hotel_id, merchant_id: req.user }
        });

        if (!checkItsValidMerchant) {
            return res.json(error("Not Valid Merchant", STATUSCODE.BAD_REQUEST));
        }
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { recipes: await convertMenuWise(hotel_id) }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err)
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

const merchantGetSingleRecipes = async (req, res) => {
    try {

        const { menu_id, hotel_id } = req.query;
        const checkItsValidMerchant = await Hotel.findOne({
            where: { id: hotel_id, merchant_id: req.user }
        });

        if (!checkItsValidMerchant) {
            return res.json(error("Not Valid Merchant", STATUSCODE.BAD_REQUEST));
        }
        if (!menu_id) {
            return res.status(400).json(
                error("menu_id is required", 400)
            );
        }

        const recipes = await Recipes.findAll({
            where: { menu_id, hotel_id },
            include: [
                {
                    model: RawMaterial,
                    as: "rawMaterial",
                    attributes: [
                        'id',
                        'raw_material_name',
                        'purchase_price',
                        'conversion_qty'
                    ],
                    include: [
                        {
                            model: Unit,
                            as: "consumptionUnit",
                            attributes: ['unit_name']
                        }
                    ]
                },
                {
                    model: Menu,
                    as: "menu",
                    attributes: ['id', 'item_name']
                },
                {
                    model: Variants,
                    as: "variant",
                    attributes: ['id', 'variants_name'],
                    required: false
                },
                {
                    model: Addons,
                    as: "addon",
                    attributes: ['id', 'addon_name'],
                    required: false
                }
            ],
            order: [['id', 'ASC']]
        });

        if (!recipes.length) {
            return res.status(404).json(
                error("No recipes found", 404)
            );
        }

        // ===============================
        // 🔁 GROUPING LOGIC
        // ===============================
        const variantMap = {};
        console.log("recipes", recipes);
        recipes.forEach(r => {
            const variantKey = r.variant_id || 'NO_VARIANT';

            if (!variantMap[variantKey]) {
                variantMap[variantKey] = {
                    variant_id: r.variant_id,
                    variant_name: r.variant?.variants_name || null,
                    estimatedCost: 0,
                    raw_materials: [],
                    addons: {}
                };
            }

            const unitCost = r.rawMaterial?.purchase_price
                ? (
                    (parseFloat(r.consumption_qty) /
                        parseFloat(r.rawMaterial.conversion_qty)) *
                    parseFloat(r.rawMaterial.purchase_price)
                )
                : 0;

            const rawMaterialObj = {
                raw_material_id: r.rawMaterial.id,
                raw_material_name: r.rawMaterial.raw_material_name,
                consumption_qty: parseFloat(r.consumption_qty),
                consumption_unit: r.rawMaterial?.consumptionUnit?.unit_name,
                unit_cost: parseFloat(unitCost.toFixed(2))
            };

            // 👉 ADDON LEVEL
            if (r.addon_id) {
                if (!variantMap[variantKey].addons[r.addon_id]) {
                    variantMap[variantKey].addons[r.addon_id] = {
                        addon_id: r.addon_id,
                        addon_name: r.addon?.addon_name,
                        estimatedCost: 0,
                        raw_materials: []
                    };
                }

                variantMap[variantKey].addons[r.addon_id].raw_materials.push(rawMaterialObj);
                variantMap[variantKey].addons[r.addon_id].estimatedCost += unitCost;
            }
            // 👉 BASE VARIANT / MENU
            else {
                variantMap[variantKey].raw_materials.push(rawMaterialObj);
                variantMap[variantKey].estimatedCost += unitCost;
            }
        });

        // ===============================
        // 🧹 FINAL CLEANUP
        // ===============================
        const variants = Object.values(variantMap).map(v => ({
            ...v,
            estimatedCost: parseFloat(v.estimatedCost.toFixed(2)),
            addons: Object.values(v.addons).map(a => ({
                ...a,
                estimatedCost: parseFloat(a.estimatedCost.toFixed(2))
            }))
        }));

        const responseData = {
            menu_id: recipes[0].menu.id,
            item_name: recipes[0].menu.item_name,
            has_variants: variants.some(v => v.variant_id !== null),
            variants
        };
        console.log("responseData", responseData);
        return res.status(200).json(
            success("Recipe fetched successfully", responseData, 200)
        );

    } catch (err) {
        console.error("getSingleRecipes error:", err);
        return res.status(500).json(
            error("Internal server error", 500)
        );
    }
};

const merchantDeleteRecipe = async (req, res) => {
    const transaction = await sequelize.transaction();

    try {

        const { menu_id, hotel_id } = req.query;
        console.log(req.query, "Query::::")
        console.log("menu_id", menu_id);
        const checkItsValidMerchant = await Hotel.findOne({
            where: { id: +hotel_id, merchant_id: req.user }
        });

        if (!checkItsValidMerchant) {
            return res.json(error("Not Valid Merchant", STATUSCODE.BAD_REQUEST));
        }
        if (!menu_id) {
            await transaction.rollback();
            return res.status(400).json(
                error("menu_id is required", 400)
            );
        }

        // Check if recipes exist
        const existingRecipes = await Recipes.findAll({
            where: {
                hotel_id: +hotel_id,
                menu_id,
            },
            transaction
        });

        if (!existingRecipes || existingRecipes.length === 0) {
            await transaction.rollback();
            return res.status(404).json(
                error("No recipes found for this combination", 404)
            );
        }

        // Delete recipes
        const deletedCount = await Recipes.destroy({
            where: {
                hotel_id: +hotel_id,
                menu_id,

            },
            transaction
        });

        // Check if this was the last recipe for this menu
        const remainingRecipes = await Recipes.count({
            where: { menu_id, hotel_id: +hotel_id },
            transaction
        });

        // If no recipes left, disable stock tracking
        if (remainingRecipes === 0) {
            await Menu.update(
                { stockTrack: false },
                { where: { id: menu_id, hotel_id: +hotel_id }, transaction }
            );
        }

        await transaction.commit();

        // Update Redis cache
        await updateMenuToForMerchantRadis(menu_id, +hotel_id);

        return res.status(200).json(
            success("Recipe deleted successfully", {
                deleted_items: deletedCount,
                remaining_recipes: remainingRecipes
            }, 200)
        );

    } catch (err) {
        await transaction.rollback();
        console.error("Error in deleteRecipes:", err);
        return res.status(500).json(
            error("Internal server error", 500)
        );
    }
};
const menuForRecipe = async (req, res) => {
    try {
        const { hotel_id } = req.query;

        const checkItsValidMerchant = await Hotel.findOne({
            where: { id: hotel_id, merchant_id: req.user }
        });

        if (!checkItsValidMerchant) {
            return res.json(error("Not Valid Merchant", STATUSCODE.BAD_REQUEST));
        }

        const menus = await Menu.findAll({
            where: {
                hotel_id,
                active: true
            },
            attributes: [
                "id",
                "item_name",
                "shortCode"
            ],
            order: [["shortCode", "DESC"]]
        });

        return res.status(STATUSCODE.SUCCESS).json(
            success(MESSAGE.SUCCESS, menus, STATUSCODE.SUCCESS)
        );

    } catch (err) {
        console.error(err, "menuForRecipe");
        return res.json(
            error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR)
        );
    }
};
const merchantGetAllRecipesForMenu = async (req, res) => {
    try {

        const { menu_id, hotel_id } = req.query;

        if (!menu_id) {
            return res.status(400).json(
                error("menu_id is required", 400)
            );
        }

        // Fetch all recipes for this menu
        const recipes = await Recipes.findAll({
            where: { menu_id, hotel_id },
            include: [
                {
                    model: RawMaterial,
                    as: "rawMaterial",
                    attributes: ['id', 'raw_material_name', 'purchase_price', 'conversion_qty'],
                    include: [
                        {
                            model: Unit,
                            as: "consumptionUnit",
                            attributes: ['unit_name']
                        }
                    ]
                },
                {
                    model: Menu,
                    as: "menu",
                    attributes: ['id', 'item_name']
                }
            ],
            order: [['variant_id', 'ASC'], ['addon_id', 'ASC'], ['id', 'ASC']]
        });

        if (!recipes || recipes.length === 0) {
            return res.status(404).json(
                error("No recipes found for this menu", 404)
            );
        }

        // Group by variant_id and addon_id
        const groupedRecipes = {};

        recipes.forEach(recipe => {
            const key = `v${recipe.variant_id || 'null'}_a${recipe.addon_id || 'null'}`;

            if (!groupedRecipes[key]) {
                groupedRecipes[key] = {
                    variant_id: recipe.variant_id,
                    addon_id: recipe.addon_id,
                    raw_materials: []
                };
            }

            groupedRecipes[key].raw_materials.push({
                id: recipe.id,
                raw_material_id: recipe.rawMaterial?.id,
                raw_material_name: recipe.rawMaterial?.raw_material_name,
                consumption_qty: parseFloat(recipe.consumption_qty),
                consumption_unit: recipe.rawMaterial?.consumptionUnit?.unit_name
            });
        });

        const responseData = {
            menu_id: recipes[0].menu?.id,
            item_name: recipes[0].menu?.item_name,
            recipes: Object.values(groupedRecipes)
        };

        return res.status(200).json(
            success("Recipes fetched successfully", responseData, 200)
        );

    } catch (err) {
        console.error("Error in getAllRecipesForMenu:", err);
        return res.status(500).json(
            error("Internal server error", 500)
        );
    }
};
const menuDetailsForRecipe = async (req, res) => {
    try {
        const { menu_id, hotel_id } = req.query;

        // Validate merchant ownership
        const checkItsValidMerchant = await Hotel.findOne({
            where: { id: hotel_id, merchant_id: req.user }
        });

        if (!checkItsValidMerchant) {
            return res.json(error("Not Valid Merchant", STATUSCODE.BAD_REQUEST));
        }

        const menu = await Menu.findOne({
            where: {
                id: menu_id,
                hotel_id,
                active: true
            },
            attributes: [
                "id",
                "item_name",
                "price",
                "description",
                "gst_type"
            ],
            include: [
                {
                    model: Variants,
                    as: "variantData",
                    where: { active: true },
                    required: false,
                    attributes: ["id", "variants_name"],
                    through: { attributes: ["variant_price"] }
                },
                {
                    model: AddonDepartment,
                    as: "addonDepartmentData",
                    required: false,
                    attributes: ["id", "department_name"],
                    through: { attributes: ["menu_id", "addon_department_id"] },
                    include: {
                        model: Addons,
                        attributes: ["id", "addon_name", "price"]
                    }
                }
            ]
        });

        if (!menu) {
            return res.json(error("Menu not found", STATUSCODE.NOT_FOUND));
        }

        return res.status(STATUSCODE.SUCCESS).json(
            success(MESSAGE.SUCCESS, menu, STATUSCODE.SUCCESS)
        );

    } catch (err) {
        console.error(err, "menuDetailsForRecipe");
        return res.json(
            error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR)
        );
    }
};

module.exports = {
    updateMerchantAddonDepartment, createMerchantAddonDepartment,
    updateMerchantVariant, createMerchantVariant,
    createMerchantCategory,
    updateMerchantCategory,
    deleteMerchantCategory,
    merchantCategoryAll,
    menuDetailsForRecipe,
    merchantGetAllRecipesForMenu,
    menuForRecipe,
    merchantDeleteRecipe,
    merchantGetSingleRecipes,
    merchantGetAllRecipes,
    merchantEditRawMaterial,
    merchantAddRawMaterial,
    merchantGetAllRawMaterial,
    merchantGetAllUnit,
    merchantAddUnit,
    merchantUnitEdit,
    merchantStockInOutHistory,
    merchantStockInHand,
    merchantUpdateManualStock,
    merchantMenu, merchantCategory, merchantVarint, merchantAddons,
    dashBoard, getHotel, checkMerchant, multipleHotelData,
    createMenuItem,          // [3]
    updateMenuItem,          // [4]
    toggleMenuItemStatus,    // [5]
    deleteMenuItem,          // [6]
    bulkActivateMenuItems,   // [7]
    bulkDeactivateMenuItems, // [8]
    bulkDeleteMenuItems,     // [9]
    setMenuVariants,     // [10]
    setMenuAddons,       // [11]
    uploadMenuItemImage,
};