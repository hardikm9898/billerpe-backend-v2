const { Op } = require("sequelize");
const { STATUSCODE, MESSAGE } = require("../../constant/const");
const { PurchaseOrder, PurchaseRollsAndPrinter, TempWebsitePurchase, Plan } = require("../../model");
const DiscountCode = require("../../model/discountCoupens");
const HotelUser = require("../../model/hotelUser");
const WebSiteProducts = require("../../model/webSiteProducts");
const { error, success } = require("../../responce/res");
const { encryptObject } = require("../Subscription/payment");

const checkHeader = (req) => {
    const allowedDomains = [
        "https://www.billerpe.com",
        "https://billerpe.com",
        "https://app.billerpe.com",
        "http://localhost:3000",
        "http://127.0.0.1:5505"
    ];

    const origin = req.headers.origin || req.headers.referer || "";

    console.log(origin, "origin");

    const isAllowed = allowedDomains.some(domain =>
        origin.startsWith(domain)
    );

    return isAllowed;
};
const calculateItemData = (items) => {

    let subtotalCheck = 0, grandAmountCheck = 0, gstCheck = 0
    for (const cur of items) {
        subtotalCheck += cur.price * cur.quantity
    }

    gstCheck = (subtotalCheck * 18) / 100
    grandAmountCheck = gstCheck + subtotalCheck

    return { gstCheck: parseFloat(gstCheck.toFixed(2)), subtotalCheck: parseFloat(subtotalCheck.toFixed(2)), grandAmountCheck: parseFloat(grandAmountCheck.toFixed(2)) }


}
const createRollAndPrinterPurchase = async (req, res) => {
    try {
        const checkFor = checkHeader(req)
        if (!checkFor) return res.json(error("ForBidden", STATUSCODE.FORBIDDEN))
        const { name, email, mobile, address1, address2, city, state, Country = "india", pincode, items, subtotal, gst, grandAmount } = req.body
        console.log(req.body, "Body::::")
        const { subtotalCheck, grandAmountCheck, gstCheck } = calculateItemData(items)
        console.log(subtotalCheck, grandAmountCheck, gstCheck)
        if (subtotal !== subtotalCheck || grandAmountCheck !== grandAmount || gstCheck !== gst) {
            return res.json(error("Something went Wrong ", STATUSCODE.BAD_REQUEST))
        }

        const data = await PurchaseRollsAndPrinter.create({ email, name, mobile, address1, address2, city, state, Country, pincode, items, subtotal, gst, grandAmount })
        const hashData = encryptObject({ subtotal, grandAmount, gst, printer_roll_id: data.id, discount: 0, discountType: 'fix', discountValue: 0 })
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { hashData, message: "Order placed" }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err, "Err:WHile Purchasing ROll And Printer")
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }



}
const createTempRestaurantData = async (req, res) => {
    try {
        const checkFor = checkHeader(req)
        if (!checkFor) return res.json(error("ForBidden", STATUSCODE.FORBIDDEN))
        console.log(req.body, "Body::::")
        const { hotel_name="Auto Generated From Website", name, mobile, email, password, pincode="380021", address1="Autogenrated From Website Purchase ", address2="Autogenrated From Website Purchase", plan_id, refer_code } = req.body

        const getAlreadyAvailable = await TempWebsitePurchase.findOne({ where: { mobile: parseInt(mobile) } })
        // if(getAlreadyAvailable) return res.json(error("This Number Already ", STATUSCODE.BAD_REQUEST))
        let data = { hotel_name, name, mobile, email,password:password?password:`${name}@123`, pincode, address1, address2, plan_id, refer_code }
        console.log(data,"Data:::")
        if (getAlreadyAvailable) {
            data = { ...data, id: getAlreadyAvailable.id }
            await TempWebsitePurchase.update({ plan_id, hotel_name, name, mobile, email, password:password?password:`${name}@123`, pincode, address1, address2, refer_code }, { where: { id: getAlreadyAvailable.id } })
        } else {
            data = await TempWebsitePurchase.create({ plan_id, hotel_name, name, mobile, email, password:password?password:`${name}@123`, pincode, address1, address2, refer_code })
        }
        const gettingClientAlreadyRegistered = await HotelUser.findOne({ where: { number: parseInt(mobile) } })
        if (gettingClientAlreadyRegistered) return res.json(error("This Mobile Number Already Registered Please Login", STATUSCODE.BAD_REQUEST))
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { data, message: "Data Added SuccessFully" }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err, "errr: Whiel creating Temp Restuarant::")
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const updateTempRestaurantData = async (req, res) => {
    try {
        const checkFor = checkHeader(req)
        if (!checkFor) return res.json(error("ForBidden", STATUSCODE.FORBIDDEN))
        const { id, hotel_name, name, mobile, email, password, pincode, address1, address2 } = req.body
        await TempWebsitePurchase.update({ hotel_name, name, mobile, email, password, pincode, address1, address2 }, { where: { id } })
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { data: { hotel_name, name, mobile, email, password, pincode, address1, address2 }, message: "Data Updated SuccessFully" }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err, "errr: Whiel creating Temp Restuarant::")
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const checkCoupenCode = async (req, res) => {
    try {
        const checkFor = checkHeader(req)
        if (!checkFor) return res.json(error("ForBidden", STATUSCODE.FORBIDDEN))
        const { code } = req.body
        console.log(req.body, "boady::::")
        if (!code) return res.json(error("Please Enter Coupen Code", STATUSCODE.BAD_REQUEST))
        const checkCoupen = await DiscountCode.findOne({ where: { promo_code_name: code } })
        if (!checkCoupen || !checkCoupen.status) {
            return res.json(error("Counpon Code Expire Or Not Valid", STATUSCODE.BAD_REQUEST))
        }


        return res.status(STATUSCODE.SUCCESS).json(success("Valid Coupon Code", { checkCoupen }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err, "errr: Whiel creating Temp Restuarant::")
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const genreratePaymentLink = async (req, res) => {
    try {
        const checkFor = checkHeader(req)
        if (!checkFor) return res.json(error("ForBidden", STATUSCODE.FORBIDDEN))
        const { plan_id, subtotal, grandAmount, gst, discount, discountType, discountValue, coupenCode, temp_hotel_id } = req.body
        let actuleDiscount = 0
        let actuleDiscountType = 'fix'
        let actuleDiscountValue = 0
        const plan = await Plan.findOne({ where: { id: plan_id } })
        if (!plan) return res.json(error("Plan Not Found", STATUSCODE.BAD_REQUEST))
        const actuleSubtotal = plan.price
        const actuleGst = (plan.price * 18) / 100
        console.log(actuleSubtotal, actuleGst, coupenCode)
        if (coupenCode) {
            const getCFounpenCode = await DiscountCode.findOne({ where: { promo_code_name: coupenCode, status: true } })
            if (!getCFounpenCode) return res.json(error("Not Valid Counpon", STATUSCODE.BAD_REQUEST))
            console.log(getCFounpenCode, "counpem")
            if (getCFounpenCode.discount_type === "pr") {
                console.log(getCFounpenCode.discount_value)
                actuleDiscount = ((actuleGst + actuleSubtotal) * getCFounpenCode.discount_value) / 100
                actuleDiscountType = 'pr'
                actuleDiscountValue = getCFounpenCode.discount_value
            } else {
                actuleDiscount = getCFounpenCode.discount_value
                actuleDiscountType = 'fix'
                actuleDiscountValue = getCFounpenCode.discount_value
            }
        }
        console.log(actuleDiscount)
        const actuleGrandAmount = parseFloat(((actuleGst + actuleSubtotal) - actuleDiscount).toFixed(2))
        console.log(actuleGrandAmount, parseFloat(grandAmount))
        if (actuleGrandAmount !== parseFloat(grandAmount)) return res.json(error("Something Went Wrong", STATUSCODE.BAD_REQUEST))

        // console.log(data, "Data:::")
        const hashData = encryptObject({ plan_id, subtotal, grandAmount, gst, discount: actuleDiscount, discountType: actuleDiscountType, discountValue: actuleDiscountValue, coupenCode, temp_hotel_id })
        console.log(hashData, "hashData::::")

        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { hashData }, STATUSCODE.SUCCESS))

    } catch (err) {
        console.log(err, "error:: While Genrating Payment Link")
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const gettingproductsData = async (req, res) => {
    try {
        // Extract page, limit, and search term from query params
        const page = parseInt(req.query.page, 10) || 1;
        const limit = parseInt(req.query.limit, 10) || 10;
        const search = req.query.search ? req.query.search.trim() : "";

        // Calculate offset
        const offset = (page - 1) * limit;

        // Build search condition
        const whereCondition = {
            status: true,
        };

        if (search) {
            whereCondition.title = { [Op.like]: `%${search}%` };
        }

        // Fetch total count and paginated data
        const { count, rows: data } = await WebSiteProducts.findAndCountAll({
            where: whereCondition,
            limit,
            offset,
            order: [['createdAt', 'DESC']],
        });
        console.log(data, "Data::")
        const totalPages = Math.ceil(count / limit);

        return res.status(STATUSCODE.SUCCESS).json(
            success(
                MESSAGE.SUCCESS,
                {
                    data,
                    pagination: {
                        totalItems: count,
                        totalPages,
                        currentPage: page,
                        pageSize: limit,
                    },
                },
                STATUSCODE.SUCCESS
            )
        );
    } catch (err) {
        console.error("Error: While Getting Products Data", err);
        return res
            .status(STATUSCODE.INTERNAL_SERVER_ERROR)
            .json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};
const gettingproductsDataWebSite = async (req, res) => {
    try {
        const checkFor = checkHeader(req)
        if (!checkFor) return res.json(error("ForBidden", STATUSCODE.FORBIDDEN))
        // Build search condition
        const whereCondition = {
            status: true,
        };



        // Fetch total count and paginated data
        const data = await WebSiteProducts.findAll({
            where: whereCondition,

            order: [['createdAt', 'DESC']],
        })
        console.log(data, "Data::")


        return res.status(STATUSCODE.SUCCESS).json(
            success(
                MESSAGE.SUCCESS,

                data,

                STATUSCODE.SUCCESS
            )
        );
    } catch (err) {
        console.error("Error: While Getting Products Data", err);
        return res
            .status(STATUSCODE.INTERNAL_SERVER_ERROR)
            .json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};


module.exports = { gettingproductsDataWebSite, gettingproductsData, genreratePaymentLink, checkCoupenCode, updateTempRestaurantData, createTempRestaurantData, createRollAndPrinterPurchase }