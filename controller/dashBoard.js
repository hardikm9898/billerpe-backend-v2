const Order = require("../model/order");
const sequelize = require("sequelize");
const { Op } = require("sequelize");
const { STATUSCODE, MESSAGE, STATUS, ORDER_DETAILS_TYPE } = require("../constant/const");
const { error, success } = require("../responce/res");
const Menu = require("../model/menu");
const OrderDetails = require("../model/order_details");
const moment = require("moment-timezone");
const Menu_categ = require("../model/menu_categ");
const ExpenseEntry = require("../model/expenseEnty");
const { getShiftedDateRange, getBusinessDate } = require("../utils/dateUtils");
const { laterDuePaymentsOnBills, dueReceivedOn, asBilled } = require("../utils/dueReceipts");

// ─────────────────────────────────────────────────────────────────────────────
// HELPER
// ─────────────────────────────────────────────────────────────────────────────

const pctChange = (current, previous) => {
    if (previous !== 0) return ((current - previous) / previous) * 100;
    return current !== 0 ? current : 0;
};

// ─────────────────────────────────────────────────────────────────────────────
// SALES DASHBOARD  (all 16 queries run in parallel via Promise.all)
// ─────────────────────────────────────────────────────────────────────────────

const salesDashBoardData = async (req, res) => {
    try {
        const { start, end, orderType } = req.body;

        const {
            startD, endD,
            businessStartDate, businessEndDate,
            previousBusinessStartDate, previousBusinessEndDate,
            timezone, businessStartTime,
            hasTimeFilter, createdAtStart, createdAtEnd
        } = await getShiftedDateRange(start, end, req.user);

        const tz = timezone || "Asia/Kolkata";
        const currentDateTz = getBusinessDate(tz, businessStartTime);
        const todayBusinessDate = currentDateTz;
        const yesterdayBusinessDate = moment(todayBusinessDate).subtract(1, "days").format("YYYY-MM-DD");

        const timeFilter = hasTimeFilter ? { createdAt: { [Op.between]: [createdAtStart, createdAtEnd] } } : {};

        // Shared condition builders
        const base = (extra = {}) => ({
            payment: STATUS.SUCCESS,
            hotel_id: req.user,
            deleted: false,
            business_date: { [Op.between]: [businessStartDate, businessEndDate] },
            ...timeFilter,
            ...extra
        });
        const prev = (extra = {}) => ({
            payment: STATUS.SUCCESS,
            hotel_id: req.user,
            deleted: false,
            business_date: { [Op.between]: [previousBusinessStartDate, previousBusinessEndDate] },
            ...extra
        });
        const sum = (field, where) => Order.sum(field, { where });
        const cnt = (where) => Order.count({ where });

        // ── Run all independent DB queries in parallel ──────────────────────
        let [
            totalSale,            previousTotalSale,
            totalInvoice,         previousInvoice,
            totalDinInSale,       previousTotalDinInSale,
            totalPickupSale,      previousTotalPickupSale,
            totalCardPayment,     previousTotalCardPayment,
            totalCashPayment,     previousTotalCashPayment,
            totalUpiPayment,      previousTotalUpiPayment,
            totalDuePayment,      previousTotalDuePayment,
            totalGivenDiscount,
            // balance-related (always today / yesterday)
            prevSaleYesterday,    prevExpenseYesterday,    prevMoneyInYesterday,
            totalSaleToday,       totalExpenseToday,       totalMoneyInToday
        ] = await Promise.all([
            sum("grandAmount", base()),               prev && sum("grandAmount", prev()),
            cnt(base()),                              cnt(prev()),
            sum("grandAmount", base({ order_type: "dinin" })),   sum("grandAmount", prev({ order_type: "dinin" })),
            sum("grandAmount", base({ order_type: "pickup" })),  sum("grandAmount", prev({ order_type: "pickup" })),
            sum("card", base()),                      sum("card", prev()),
            sum("cash", base()),                      sum("cash", prev()),
            sum("upi", base()),                       sum("upi", prev()),
            sum("due", base()),                       sum("due", prev()),
            sum("totalDiscount", base()),

            // Opening / Closing balance queries (always yesterday vs today)
            Order.sum("grandAmount", { where: { payment: STATUS.SUCCESS, hotel_id: req.user, business_date: yesterdayBusinessDate, deleted: false } }),
            ExpenseEntry.sum("amount", { where: { hotel_id: req.user, addExpense: true,  business_date: yesterdayBusinessDate, deleted: false } }),
            ExpenseEntry.sum("amount", { where: { hotel_id: req.user, addExpense: false, business_date: yesterdayBusinessDate, deleted: false } }),
            Order.sum("grandAmount", { where: { payment: STATUS.SUCCESS, hotel_id: req.user, business_date: todayBusinessDate, deleted: false } }),
            ExpenseEntry.sum("amount", { where: { hotel_id: req.user, addExpense: true,  business_date: todayBusinessDate, deleted: false } }),
            ExpenseEntry.sum("amount", { where: { hotel_id: req.user, addExpense: false, business_date: todayBusinessDate, deleted: false } }),
        ]);

        // ── Due money counts on the day it was collected (utils/dueReceipts.js)
        // The bills' cash / upi / card / due as they were settled - not
        // including dues paid on a later day - and the dues paid in this
        // range as "Due received". Otherwise a day's figures changed every
        // time one of its dues was collected, and stopped matching the
        // WhatsApp summary sent when it closed.
        const [laterOnCurrent, laterOnPrevious, totalDueReceived] = await Promise.all([
            laterDuePaymentsOnBills(req.user, base()),
            laterDuePaymentsOnBills(req.user, prev()),
            dueReceivedOn(req.user, { [Op.between]: [businessStartDate, businessEndDate] }),
        ]);
        const billed = asBilled({ cash: totalCashPayment, upi: totalUpiPayment, card: totalCardPayment, due: totalDuePayment }, laterOnCurrent);
        const previousBilled = asBilled({ cash: previousTotalCashPayment, upi: previousTotalUpiPayment, card: previousTotalCardPayment, due: previousTotalDuePayment }, laterOnPrevious);
        totalCashPayment = billed.cash;
        totalUpiPayment = billed.upi;
        totalCardPayment = billed.card;
        totalDuePayment = billed.due;
        previousTotalCashPayment = previousBilled.cash;
        previousTotalUpiPayment = previousBilled.upi;
        previousTotalCardPayment = previousBilled.card;
        previousTotalDuePayment = previousBilled.due;

        // ── Balance calculation ─────────────────────────────────────────────
        const openingBalance = (prevSaleYesterday || 0) - (prevExpenseYesterday || 0) + (prevMoneyInYesterday || 0);
        const closingBalance = openingBalance + (totalSaleToday || 0) - (totalExpenseToday || 0) + (totalMoneyInToday || 0);

        const dataConductedInfo = {
            message: "Data is filtered based on the hotel's timezone and business start time.",
            timezone: tz,
            currentDateInTimezone: currentDateTz,
            hotelBusinessStartTime: businessStartTime,
            conductedStartDate: businessStartDate,
            conductedEndDate: businessEndDate,
            filterStartTime: moment(startD).tz(tz).format("YYYY-MM-DD hh:mm:ss A"),
            filterEndTime: moment(endD).tz(tz).format("YYYY-MM-DD hh:mm:ss A")
        };

        const reportTotalAmounts = {
            previousTotalDuePayment,
            totalSalePercentageChange:    pctChange(totalSale, previousTotalSale),
            totalInvoicePercentageChange: pctChange(totalInvoice, previousInvoice),
            totalDinInPercentageChange:   pctChange(totalDinInSale, previousTotalDinInSale),
            totalPickUpPercentageChange:  pctChange(totalPickupSale, previousTotalPickupSale),
            totalCardPercentageChange:    pctChange(totalCardPayment, previousTotalCardPayment),
            totalCashPercentageChange:    pctChange(totalCashPayment, previousTotalCashPayment),
            totalUpiPercentageChange:     pctChange(totalUpiPayment, previousTotalUpiPayment),
            totalDuePercentageChange:     pctChange(totalDuePayment, previousTotalDuePayment),
            totalGivenDiscount,
            totalSale,
            totalInvoice,
            totalDinInSale,
            totalPickupSale,
            totalCardPayment,
            totalCashPayment,
            totalUpiPayment,
            totalDuePayment,
            // Dues of any day's bills collected in this range.
            totalDueReceived
        };

        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, {
            reportTotalAmounts,
            openingBalance,
            closingBalance,
            dataConductedInfo
        }, STATUSCODE.SUCCESS));

    } catch (err) {
        console.error(err);
        return res.status(STATUSCODE.INTERNAL_SERVER_ERROR).json(
            error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR)
        );
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// ITEM-WISE DASHBOARD  (unchanged logic)
// ─────────────────────────────────────────────────────────────────────────────

const itemWiseDashBoardData = async (req, res) => {
    try {
        const { start, end } = req.body;
        const { businessStartDate, businessEndDate } = await getShiftedDateRange(start, end, req.user);

        // By the order's business_date, like the sales figures above. A line's
        // own createdAt is when it reached the cloud: an outlet's server
        // re-sends an order's lines with every push of it
        // (controller/sync/syncController.js#pushOrders), so a bill synced
        // late - or reprinted the next day - moved its items to that day.
        const totalItemsSale = await OrderDetails.findAll({
            where: {
                hotel_id: req.user,
                status: ORDER_DETAILS_TYPE.DELIVERED,
                payment_status: STATUS.SUCCESS,
            },
            attributes: ["MenuId", [sequelize.fn("sum", sequelize.col("qty")), "totalQty"]],
            group: "MenuId",
            include: [{
                model: Order,
                as: "order",
                attributes: [],
                required: true,
                where: {
                    hotel_id: req.user,
                    payment: STATUS.SUCCESS,
                    deleted: false,
                    business_date: { [Op.between]: [businessStartDate, businessEndDate] }
                }
            }, {
                model: Menu,
                group: "menu_categ_id",
                include: {
                    model: Menu_categ,
                    attributes: ["menu_categ_nm"]
                }
            }],
            order: [[sequelize.literal("totalQty"), "DESC"]]
        });

        const data = totalItemsSale.map(el => ({
            item_name: el?.dataValues?.hms_menu_mst?.dataValues?.item_name || el.hms_menu_mst?.item_name,
            catagoriesName: el?.dataValues?.hms_menu_mst?.dataValues?.hms_menu_categ?.dataValues?.menu_categ_nm || el.hms_menu_mst?.hms_menu_categ?.menu_categ_nm,
            totalQty: el.dataValues?.totalQty || el.totalQty,
            totalSale: Math.round((Number(el.dataValues?.totalQty || el.totalQty) || 0) * (Number(el.dataValues?.hms_menu_mst?.dataValues?.price || el.hms_menu_mst?.price) || 0) * 100) / 100
        }));

        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, data, STATUSCODE.SUCCESS));

    } catch (err) {
        console.error(err);
        return res.status(STATUSCODE.INTERNAL_SERVER_ERROR).json(
            error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR)
        );
    }
};

module.exports = { salesDashBoardData, itemWiseDashBoardData };
