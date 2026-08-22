
const { Op } = require("sequelize")
const { error, success, mobileError, mobileSuccess } = require("../../responce/res")
const { STATUSCODE, MESSAGE, EXTRA } = require("../../constant/const")
const Subscription = require("../../model/subscription/subscription")
const Plan = require("../../model/subscription/plan")
const SubscriptionPayment = require("../../model/subscription/subscriptionPayment")
const { verifyPaymentOther } = require("./payment")
const { ErrorValue } = require("exceljs")

const validedSubscription = async (req, res) => {
    try {
        const { date } = req.query
        console.log(date, "Date::")
        const findSubscription = await Subscription.findOne({
            where: { hotel_id: req.user, end_date: { [Op.gt]: new Date(date) } }, include: [{
                model: Plan,
                attributes: ['id', 'name', 'price', 'duration_days']
            }, { model: SubscriptionPayment }]
        })
        if (!findSubscription) {
            return res.json(error("Your Subscription Expire", STATUSCODE.BAD_REQUEST))
        }
        else {
            return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { subscription: findSubscription, message: "Subscription Active" }, STATUSCODE.SUCCESS))
        }

    } catch (err) {
        console.error(err)
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const extentOneDay = async (req, res) => {
    try {
        const { id } = req.body
        const getSubscription = await Subscription.findOne({ where: { id } })
        if (!getSubscription) return res.json(error("Subscription Not Found", STATUSCODE.BAD_REQUEST))
        if (getSubscription.subscription_extend_count >= 1) {
            return res.json(error("You Can't Extend More Than 1 Day", STATUSCODE.BAD_REQUEST))
        }
        const newEndDate = new Date();
        newEndDate.setDate(newEndDate.getDate() + 1);

        await Subscription.update(
            {
                end_date: newEndDate,
                subscription_extend_count: getSubscription.subscription_extend_count + 1
            },
            {
                where: { id }
            }
        );

        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { message: "1 Day Extended" }, STATUSCODE.SUCCESS))

    } catch (err) {
        console.error(err)
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))

    }
}
const renewSubscription = async (req, res) => {
    try {
        const {
            id, // Plan ID
            subTotal,
            discount,
            discountrate,
            discountedvalue,
            gst,
            gst_calculated,
            grandAmount,
            payment_method,
            payment_date,
            amount_paid,
            UTR_No,
            note
        } = req.body;
        console.log(req.body)
        // 1. Check if plan exists
        const plan = await Plan.findOne({ where: { id: +id } });
        if (!plan) {
            return res.json(error("Plan Not Found", STATUSCODE.INTERNAL_SERVER_ERROR));
        }

        // 2. Calculate subscription period
        const startDate = new Date();
        const endDate = new Date();
        endDate.setDate(startDate.getDate() + 365); // Add 365 days
        // try {
        //     const data = await verifyPaymentOther(UTR_No)
        //     console.log(data)
        // } catch (err) {
        //     console.log(err)
        //     return res.json(error("Payment Vefication Failed", STATUSCODE.BAD_REQUEST))
        // }
        // 3. Create Subscription 
        const newSubscription = await Subscription.create({
            discountrate,
            discountedvalue,
            hotel_id: req.user,
            plan_id: id,
            start_date: startDate,
            end_date: endDate,
            subTotal,
            discount,
            gst,
            gst_calculated,
            grandAmount,
            subscription_extend_count: 0
        });

        // 4. Create SubscriptionPayment
        await SubscriptionPayment.create({
            subscription_id: newSubscription.id,
            payment_method,
            payment_date,
            amount_paid: grandAmount,
            UTR_No,
            note, hotel_id: req.user
        });

        return res.json(success(MESSAGE.SUCCESS, { message: "Subscription renewed successfully", newSubscription }, STATUSCODE.SUCCESS));
    } catch (err) {
        console.error("Error in renewSubscription:", err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};
const getActuleSubscriptionData = async (req, res) => {
    try {
        // const { id } = req.body
        // const getSubscription = await Subscription.findOne({ where: { id }, attributes: ['extra_login_web', 'extra_login_mobile'], include: { model: Plan, attributes: ['name', 'price', "duration"] } })
        // if (!getSubscription) return res.json(error("Subscription Not Found", STATUSCODE.INTERNAL_SERVER_ERROR))
        // const extra_login_price = (getSubscription.extra_login_mobile * EXTRA.MOBILE) + (getSubscription.extra_login_web * EXTRA.WEB)
        // const subTotal = (extra_login_price + getSubscription.hms_plan_mst.price)
        // const gst = (subTotal * 18) / 100
        // const grandAmount = subTotal.gst
        // const data = { id, duration: getSubscription.hms_plan_mst.duration_days, gst, extra_login_price, subTotal, grandAmount, plan_name: getSubscription.hms_plan_mst.name, plan_price: getSubscription.hms_plan_mst.price, extra_login_mobile: getSubscription.extra_login_mobile, extra_login_web: getSubscription.extra_login_web }

        // return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { data }, STATUSCODE.SUCCESS))

        const getSubscription = await Subscription.findOne({
            where: { hotel_id: req.user },
            attributes: ['extra_login_web', 'extra_login_mobile', 'id'],
            include: [{
                model: Plan,
                attributes: ['id', 'name', 'price', 'duration_days']
            }],
            order: [['id', 'DESC']]
        });

        if (!getSubscription) return res.json(error("Subscription Not Found", STATUSCODE.BAD_REQUEST))
        console.log(+getSubscription.extra_login_mobile, +EXTRA.MOBILE, +getSubscription.extra_login_web, +EXTRA.WEB)
        const extra_login_price = (+getSubscription.extra_login_mobile * +EXTRA.MOBILE) + (+getSubscription.extra_login_web * +EXTRA.WEB)
        console.log(extra_login_price, "Here::")
        const subTotal = (+extra_login_price + +getSubscription.hms_plan_mst.price)
        console.log(subTotal, "Subtotal")
        const gst = (subTotal * 18) / 100
        const grandAmount = +subTotal + gst
        // const grandAmount = 5
        const data = { id: getSubscription.id, plan_id: getSubscription.hms_plan_mst.id, duration: getSubscription.hms_plan_mst.duration_days, gst, extra_login_price, subTotal, grandAmount, plan_name: getSubscription.hms_plan_mst.name, plan_price: getSubscription.hms_plan_mst.price, extra_login_mobile: getSubscription.extra_login_mobile, extra_login_web: getSubscription.extra_login_web }
        console.log("here:::::::", data)
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { data }, STATUSCODE.SUCCESS))


    } catch (err) {
        console.error(err)
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const getAllPlan = async (req, res) => {
    try {
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

        const responseData = plans.map(plan => {
            console.log(plan.price, "Price::")
            const gstAmount = +(plan.price * 0.18).toFixed(2);
            const discount = "pr";
            const dicountrate = (plan.price + gstAmount) * 0.25;
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

        return res.status(STATUSCODE.SUCCESS).json(
            success(MESSAGE.SUCCESS, { data: responseData }, STATUSCODE.SUCCESS)
        );

    } catch (error) {
        console.error(error, "Error GetAllPlans");
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};
const getAllPlansWithoutDiscount = async (req, res) => {
    try {
        const plans = await Plan.findAll({ where: {} });
        return res.status(STATUSCODE.SUCCESS).json(
            success(MESSAGE.SUCCESS, { data: plans }, STATUSCODE.SUCCESS)
        );
    } catch (err) {
        console.log(err)
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))

    }
}
const extraOneDayForMobile = async (req, res) => {
    try {
        const { id } = req.body
        const getSubscription = await Subscription.findOne({ where: { id } })
        if (!getSubscription) return res.json(mobileError("Subscription Not Found", STATUSCODE.BAD_REQUEST))
        if (getSubscription.subscription_extend_count >= 1) {
            return res.json(mobileError("You Can't Extend More Than 1 Day", STATUSCODE.BAD_REQUEST))
        }
        const newEndDate = new Date();
        newEndDate.setDate(newEndDate.getDate() + 1);

        await Subscription.update(
            {
                end_date: newEndDate,
                subscription_extend_count: getSubscription.subscription_extend_count + 1
            },
            {
                where: { id }
            }
        );

        return res.status(STATUSCODE.SUCCESS).json(mobileSuccess(MESSAGE.SUCCESS, { message: "1 Day Extended" }, "1 Day Extended", STATUSCODE.SUCCESS))

    } catch (err) {
        console.log(err, "Erro:While Extent One day")
        return res.json(mobileError(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
module.exports = { extraOneDayForMobile, getAllPlansWithoutDiscount, getAllPlan, validedSubscription, extentOneDay, renewSubscription, getActuleSubscriptionData }