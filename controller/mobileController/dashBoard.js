const Order = require("../../model/order")
const sequelize = require("sequelize")
const { Op } = require("sequelize")
const { STATUSCODE, MESSAGE, STATUS, ORDER_TYPE, ORDER_DETAILS_TYPE } = require("../../constant/const")
const { mobileSuccess, mobileError } = require("../../responce/res")
const Menu = require("../../model/menu")
const Table = require("../../model/table")
const OrderDetails = require("../../model/order_details")
const Hotel = require("../../model/hotel")
const Menu_categ = require("../../model/menu_categ")
const HotelUser = require("../../model/hotelUser")
const jwt = require("jsonwebtoken")
const bcrypt = require("bcrypt")
const { restaurantLogin } = require("../../validation/validate")
const Subscription = require("../../model/subscription/subscription")
const Plan = require("../../model/subscription/plan")
const SubscriptionPayment = require("../../model/subscription/subscriptionPayment")
const { getShiftedDateRange } = require("../../utils/dateUtils")
const moment = require("moment-timezone")

// The mobile app sends dates as "MM/DD/YYYY HH:mm" (e.g. "06/18/2026 23:59"),
// which moment cannot parse and silently falls back to JS Date() (treated as UTC),
// shifting evening times to the next day. The web app sends ISO dates and works fine.
// Normalize to a date-only "YYYY-MM-DD" so getShiftedDateRange parses it reliably
// and applies the hotel's business-day logic (full day, no time filter).
const normalizeMobileDate = (value) => {
    if (!value) return value;
    const parsed = moment(value, ["MM/DD/YYYY HH:mm", "MM/DD/YYYY", moment.ISO_8601], true);
    return parsed.isValid() ? parsed.format("YYYY-MM-DD") : value;
};

const dashBoard = async (req, res) => {
    const start = normalizeMobileDate(req.body.startDate)
    const end = normalizeMobileDate(req.body.endDate)
    try {
        const hotel = await Hotel.findOne({ where: { id: req.user } })
        console.log(req.body,"Body Data Comming:::")

        if (!hotel) return res.json(mobileError(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST,))

        const {
            startD, endD,
            businessStartDate, businessEndDate,
            previousBusinessStartDate, previousBusinessEndDate,
            hasTimeFilter, createdAtStart, createdAtEnd,
        } = await getShiftedDateRange(start, end, req.user);

        const timeFilter = hasTimeFilter ? { createdAt: { [Op.between]: [createdAtStart, createdAtEnd] } } : {};

        const baseWhere = (extra = {}) => ({
            payment: STATUS.SUCCESS,
            hotel_id: req.user,
            deleted: false,
            business_date: { [Op.between]: [businessStartDate, businessEndDate] },
            ...timeFilter,
            ...extra
        });
        const prevWhere = (extra = {}) => ({
            payment: STATUS.SUCCESS,
            hotel_id: req.user,
            deleted: false,
            business_date: { [Op.between]: [previousBusinessStartDate, previousBusinessEndDate] },
            ...extra
        });
        const pctChange = (current, previous) => {
            if (previous !== 0) return ((current - previous) / previous) * 100;
            return current !== 0 ? current : 0;
        };

        const [
            totalSale, previousTotalSale,
            totalInvoice, previousInvoice,
            totalDinInSale, previousTotalDinInSale,
            totalPickUpSale, previousTotalPickUpSale,
            totalCardPayment, previousTotalCardPayment,
            totalCashPayment, previousTotalCashPayment,
            totalUpiPayment, previousTotalUpiPayment,
            totalDuePayment, previousTotalDuePayment,
            totalGivenDiscount,
            liveTables, order, totalItemsSale
        ] = await Promise.all([
            Order.sum("grandAmount", { where: baseWhere() }),
            Order.sum("grandAmount", { where: prevWhere() }),
            Order.count({ where: baseWhere() }),
            Order.count({ where: prevWhere() }),
            Order.sum("grandAmount", { where: baseWhere({ order_type: "dinin" }) }),
            Order.sum("grandAmount", { where: prevWhere({ order_type: "dinin" }) }),
            Order.sum("grandAmount", { where: baseWhere({ order_type: "pickup" }) }),
            Order.sum("grandAmount", { where: prevWhere({ order_type: "pickup" }) }),
            Order.sum("card", { where: baseWhere() }),
            Order.sum("card", { where: prevWhere() }),
            Order.sum("cash", { where: baseWhere() }),
            Order.sum("cash", { where: prevWhere() }),
            Order.sum("upi", { where: baseWhere() }),
            Order.sum("upi", { where: prevWhere() }),
            Order.sum("due", { where: baseWhere() }),
            Order.sum("due", { where: prevWhere() }),
            Order.sum("totalDiscount", { where: baseWhere() }),
            Table.count({ where: { hotel_id: req.user, active: true, [Op.or]: [{ table_status: "P" }, { table_status: "R" }, { table_status: "H" }] } }),
            Order.count({ where: { hotel_id: req.user, status: { [Op.ne]: ORDER_TYPE.SUCCESS }, payment: "pending", deleted: false } }),
            OrderDetails.findAll({
                where: { hotel_id: req.user, status: ORDER_DETAILS_TYPE.DELIVERED, payment_status: STATUS.SUCCESS, createdAt: { [Op.between]: [startD, endD] } },
                attributes: ["MenuId", [sequelize.fn("sum", sequelize.col("qty")), "totalQty"]],
                group: "MenuId",
                include: {
                    model: Menu,
                    group: "menu_categ_id",
                    include: {
                        model: Menu_categ,
                        attributes: ["menu_categ_nm"],
                    },

                },
                order: [[sequelize.literal("totalQty"), "DESC"]],
                limit: 10
            })
        ]);

        let state = "Active"
        let action = "No_Action"
        let currentPlan = {}
        const findSubscription = await Subscription.findOne({
            where: { hotel_id: req.user, end_date: { [Op.gt]: new Date() } }, include: [{
                model: Plan,
                attributes: ['id', 'name', 'price', 'duration_days']
            }, { model: SubscriptionPayment }]
        })

        const getSubscription = await Subscription.findOne({
            where: { hotel_id: req.user },
            attributes: ['id'],
            include: [{
                model: Plan,
                attributes: ['id', 'name', 'price', 'duration_days']
            }],
            order: [['id', 'DESC']]
        });

        if (!getSubscription) {

            currentPlan = {}

        } else {

            const subTotal = getSubscription.hms_plan_mst.price
            const gst = (subTotal * 18) / 100
            const grandAmount = +subTotal + gst
            currentPlan = { id: getSubscription.id, plan_id: getSubscription.hms_plan_mst.id, duration: getSubscription.hms_plan_mst.duration_days, gst, subTotal, grandAmount, plan_name: getSubscription.hms_plan_mst.name, plan_price: getSubscription.hms_plan_mst.price, extra_login_mobile: getSubscription.extra_login_mobile, extra_login_web: getSubscription.extra_login_web }
        }
        const plans = await Plan.findAll({ where: {} });

        const featureMap = {
            1: [
                "Basic features",
                "Standard support",
                "Web Login Access",
                "Expense Management",
                "Kitchen Display System",
                "Token Management",
                "E-Bill",
                "Two Display Access KeyBorad and Touch",
                "Inventory Management",
                "All Report Access",
                "Due Payment Management"
            ],
            2: [
                "Basic features",
                "Standard support",
                "Web Login Access + Mobile Login Access",
                "Expense Management",
                "Kitchen Display System",
                "Token Management",
                "E-Bill",
                "Two Display Access KeyBorad and Touch",
                "Inventory Management",
                "All Report Access",
                "Due Payment Management",
                "Unlimited Captain App User Access",
                "Manage Expense From Mobile",
                "Report Access From Mobile",
                "Due Payment Management From Mobile App"
            ]
            // You can add more mappings for id: 3, 4, etc. if needed.
        };

        let AllPlans = plans.map(plan => {

            const gstAmount = +(plan.price * 0.18).toFixed(2);

            const discount = "pr";

            const dicountrate = (plan.price) * 0.25;

            const totalCostWithGst = +(plan.price + gstAmount - dicountrate).toFixed(2);

            return {
                dicountrate: 25,
                discount,
                discountedvalue: dicountrate,
                id: plan.id,
                name: plan.name,
                price: plan.price,
                gst: gstAmount,
                grandAmount: totalCostWithGst,
                // grandAmount: 1,
                duration_days: plan.duration_days,
                featureList: featureMap[plan.id] || []
            };
        });
        // console.log(currentPlan, "Curerent Plan:::")
        // console.log(AllPlans, "AllPlans:::")
        AllPlans = AllPlans.filter(el => {
            if (currentPlan) {
                if (currentPlan?.plan_id === 2 && el.id === 2) {
                    return el
                } else if (currentPlan?.plan_id === 1) {
                    return el
                }
            } else {
                return el
            }
        })
        if (!findSubscription) {
            state = "Expired"
            action = "Renew"
        }
        else {
            state = "Active"
        }

        const dashBoardData = {
            subscription: {
                AllPlans, currentPlan, action, state
            },
            totalSalePercentageChange: pctChange(totalSale, previousTotalSale)?.toFixed(2) || 0,
            totalInvoicePercentageChange: pctChange(totalInvoice, previousInvoice)?.toFixed(2) || 0,
            totalDinInPercentageChange: pctChange(totalDinInSale, previousTotalDinInSale)?.toFixed(2) || 0,
            totalCardPercentageChange: pctChange(totalCardPayment, previousTotalCardPayment)?.toFixed(2) || 0,
            totalDuePercentageChange: pctChange(totalDuePayment, previousTotalDuePayment)?.toFixed(2) || 0,
            totalCashPercentageChange: pctChange(totalCashPayment, previousTotalCashPayment)?.toFixed(2) || 0,
            totalUpiPercentageChange: pctChange(totalUpiPayment, previousTotalUpiPayment)?.toFixed(2) || 0,
            totalPickUpPercentageChange: pctChange(totalPickUpSale, previousTotalPickUpSale)?.toFixed(2) || 0,
            totalGivenDiscount,
            totalSale,
            totalInvoice,
            totalDinInSale,
            totalPickUpSale,
            totalCardPayment,
            totalDuePayment,
            totalCashPayment,
            totalUpiPayment,
            liveTotalNoOfOrders: order, liveTables,
            totalItemsSale,

        }
        return res.json(mobileSuccess(MESSAGE.SUCCESS, dashBoardData, "", STATUSCODE.SUCCESS))

    }
    catch (err) {

        console.log(err)
        //createLogFile(req.user, `Getting DashBoard From Mobile /err Error`, err);
        return res.json(mobileError(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

const mobileLogin = async (req, res) => {
    try {
        const { password, mobile } = req.body
        const { device_id } = req.headers


        const err = restaurantLogin.validate({ mobile, password }).error
        const valid = err == null
        if (valid) {
        }
        else {
            console.log(err, "error==>")
            const message = err.details.map((detail) => detail.message).join(",");
            return res.json(mobileError(message, STATUSCODE.VALIDATION_ERROR))
        }

        const user = await HotelUser.findOne({ where: { number: mobile, active: true } })

        if (!user) {
            return res.json(mobileError(MESSAGE.USER_NOT_FOUND, STATUSCODE.VALIDATION_ERROR));
        }
        // if (user.device_id !== device_id) {
        await HotelUser.update({ device_id }, { where: { id: user.id } })
        // }
        const validPassword = await bcrypt.compare(password, user.password)
        if (!validPassword) {
            return res.json(mobileError(MESSAGE.CREDENTIAL_FALSE, STATUSCODE.VALIDATION_ERROR));
        }
        const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET_KEY_ADMIN, {
            expiresIn: "7d",
        });
        const refreshToken = jwt.sign({ id: user.id }, process.env.JWT_SECRET_KEY_ADMIN, { expiresIn: "7d" })
        res.cookie("token", token, {
            httpOnly: true, maxAge: 1000 * 60 * 14,
            sameSite: 'lax'
        })
        delete user.password,
            res.cookie("refreshToken", refreshToken, { httpOnly: true, maxAge: 604800000, sameSite: 'lax' })
        return res.status(STATUSCODE.SUCCESS).json(mobileSuccess("success", { token, user }, MESSAGE.USER_LOGIN, STATUSCODE.SUCCESS));
    } catch (err) {
        console.log(err)
        //createLogFile(req.user, `MobileLogin From Mobile /err Error`, err);
        return res.status(STATUSCODE.INTERNAL_SERVER_ERROR).json(mobileError(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
module.exports = { dashBoard, mobileLogin }
