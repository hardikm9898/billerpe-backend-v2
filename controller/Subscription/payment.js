const crypto = require('crypto');
const { Cashfree, CFEnvironment } = require('cashfree-pg');
const { error } = require('console');
const { MESSAGE, STATUSCODE, USER_ROLE } = require('../../constant/const');
const Hotel = require('../../model/hotel');
const { success, mobileError, mobileSuccess } = require('../../responce/res');
const Subscription = require('../../model/subscription/subscription');
const Plan = require('../../model/subscription/plan');
const SubscriptionPayment = require('../../model/subscription/subscriptionPayment');
require('dotenv').config();
const moment = require('moment');
const { Op } = require('sequelize');

const sequelize = require('../../connection/connect');

const { StandardCheckoutClient, Env, StandardCheckoutPayRequest } = require('pg-sdk-node');

const PhonePayPaymentLink = require('../../model/paymentLink');
const { TempWebsitePurchase, UserAccess, Role, PurchaseRollsAndPrinter, SuperAdminUser, superAdminModel } = require('../../model');
const HotelUser = require('../../model/hotelUser');
const { send } = require('process');
const { sendWelcomeEmail, sendPurchaseOrderEmail } = require('../../services/sendMail');

const clientId = process.env.PHONEPE_MERCHANT_ID;
const clientSecret = process.env.PHONEPE_SECRET_KEY;
const clientVersion = '1';  //insert your client version here
const env = Env.PRODUCTION;      //change to Env.PRODUCTION when you go live

const client = StandardCheckoutClient.getInstance(clientId, clientSecret, clientVersion, env);


const algorithm = 'aes-256-cbc';
const key = crypto.createHash('sha256').update("hellothisisdemoId").digest();
const iv = crypto.randomBytes(16);

// Encrypt function
function encryptObject(obj) {
    const iv = crypto.randomBytes(16); // generate a random IV
    const cipher = crypto.createCipheriv(algorithm, key, iv);
    const jsonString = JSON.stringify(obj);
    let encrypted = cipher.update(jsonString, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    // Combine IV and encrypted data into one string (hex encoded)
    return iv.toString('hex') + ':' + encrypted;
}

// Decrypt the single string back into an object
function decryptObject(encryptedString) {
    const parts = encryptedString.split(':');
    const iv = Buffer.from(parts[0], 'hex');
    const encryptedData = parts[1];
    const decipher = crypto.createDecipheriv(algorithm, key, iv);
    let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return JSON.parse(decrypted);
}



function generateTransactionId() {
    const timestamp = Date.now(); // milliseconds since epoch
    const randomPart = Math.random().toString(36).substr(2, 8).toUpperCase();
    return `Bill${timestamp}${randomPart}`;
}
const createPhonePePayment = async (req, res) => {
    try {

        const { hashData } = req.body;
        console.log(decryptObject(hashData), "HasData::::")
        const { id, amount, subTotal, discount, gst, grandAmount, discountrate, discountedvalue, hotel_id, mobile } = decryptObject(hashData)
        // const amountdata = decodeHashId(hashData)
        console.log(client, "CLient::::")

        const transactionId = generateTransactionId();

        const hotel = await Hotel.findOne({ where: { id: hotel_id } })
        let amountData = amount * 100
        if (!amountData || !transactionId || !hotel.owner_number || !hotel.owner_name) {
            return res.status(400).json({ message: "Missing required fields" });
        }

        const redirectUrlMerchant = `${process.env.SOCKET_URL}/#/paymentStatus/${transactionId}?mobile=${mobile}`;
        const metaInfo = {
            customerPhone: hotel.owner_number,
            customerName: hotel.owner_name,
            website: false,
            rollPrinter: false
        };


        const request = StandardCheckoutPayRequest.builder()
            .merchantOrderId(transactionId)
            .amount(amountData)
            .redirectUrl(redirectUrlMerchant)
            .metaInfo(metaInfo)
            .build();

        console.log(request, "Request URL::")
        const ress = await client.pay(request)
        const { orderId, redirectUrl, state, expireAt } = ress
        console.log(expireAt, "ExireAt::")
        await PhonePayPaymentLink.create({ merchantOrderId: transactionId, orderId, redirectUrl, state, expireAt: new Date(expireAt), metaInfo, hotel_id, plan_id: id, subTotal, discount, gst, grandAmount, discountrate, discountedvalue })


        console.log(ress, "Responce")
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, ress, STATUSCODE.SUCCESS))
        //   const checkoutPageUrl = response.redirectUrl;
    } catch (err) {
        console.error("PhonePe Create Payment Error:", err);
        return res.status(500).json({ message: "Internal server error", error: err.message });
    }
};

const generatePaymentHashId = async (req, res) => {
    try {
        const { data } = req.body
        console.log(data, "Data:::")
        const hashData = encryptObject({ ...data, mobile: false, hotel_id: req.user })
        console.log(hashData, "hashData::::")

        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { hashData }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err, "error::::")
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

const verifyPhonePePayment = async (req, res) => {
    try {
        const { transactionId } = req.body

        // console.log(transactionId)
        const reponce = await client.getOrderStatus(transactionId)

        // const gettingPaymentLink = await PhonePayPaymentLink.findOne({ where: { transactionId } })
        // if(gettingPaymentLink && gettingPaymentLink.hotel_id){
        //     const hotelAlreadyregistor = await Hotel.findOne()
        // }
        // const state = reponce.state;
        console.log(reponce, "responce:::")
        const { state } = reponce
        // COMPLETED PENDING FAILED 
        // const response = await axios.get(url, { headers });
        if (state === "COMPLETED") {

            // return res.status(200).json({ message: "Payment verified", data: reponce.OrderStatusResponse });
            return res.status(STATUSCODE.SUCCESS).json(success("Payment verified", { data: reponce }, STATUSCODE.SUCCESS))
        } else {
            return res.status(STATUSCODE.SUCCESS).json(success("Payment verified Failed", { data: reponce }, STATUSCODE.BAD_REQUEST))
            // return res.status(200).json({ message: "Payment verified Failed", data: reponce.OrderStatusResponse });

        }
        // if (reponce.data && response.data.success) {
        // } else {
        // return res.status(400).json({ message: "Failed to verify payment", data: response });
        // }

    } catch (error) {
        console.error("PhonePe Verify Payment Error:", error.response?.data || error.message);
        return res.status(500).json({ message: "Internal server error", error: error.message });
    }
};



const gereratePaymentLink = async (req, res) => {
    try {

        const { mobile, amount, name } = req.body

        if (!mobile || !amount || !name) {
            return res.json(error("Mobile Amount And Name required", STATUSCODE.BAD_REQUEST))
        }
        if (`${mobile}`.length !== 10) {
            return res.json(error("Please Enter Valid Mobile No.", STATUSCODE.BAD_REQUEST))
        }

        const amountData = amount * 100
        // const redirectUrlMerchant = `${process.env.SOCKET_URL}/#/paymentStatus/${transactionId}?mobile=${false}`;
        const metaInfo = {
            customerPhone: mobile,
            customerName: name,
            website: false,
            rollPrinter: false
        };
        const transactionId = generateTransactionId()

        const request = StandardCheckoutPayRequest.builder()
            .merchantOrderId(transactionId)
            .amount(amountData)
            // .redirectUrl(redirectUrlMerchant)
            .metaInfo(metaInfo)
            .build();

        console.log(request, "Request URL::")
        const ress = await client.pay(request)
        const { orderId, redirectUrl, state, expireAt } = ress
        console.log(redirectUrl, "Url::::")
        // console.log(expireAt, "ExireAt::")
        await PhonePayPaymentLink.create({ merchantOrderId: transactionId, orderId, redirectUrl, state, expireAt: new Date(expireAt), metaInfo, grandAmount: amount })


        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { message: "Payment Link Generated" }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err, "Error:While Genreting Pyament Link")
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const verifyPaymentGeneratedLink = async (req, res) => {
    try {
        const { merchantOrderId } = req.body
        if (!merchantOrderId) return res.json(error("Merchant Order Id Required", STATUSCODE.BAD_REQUEST))

        const data = await PhonePayPaymentLink.findOne({ where: { merchantOrderId } })

        if (!data) return res.json(error("Please Enter Valid MerchantId", STATUSCODE.BAD_REQUEST))

        let message = ""
        if (data.state === "PENDING") {
            message = "Payment is pending or in progress."
        } else if (data.state === "COMPLETED") {
            message = "Payment completed successfully."
        } else {
            message = "Link is expired, cancelled, or invalid.";
        }

        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { message }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err, "Error While VerifyPayment")
    }
}
const deactivatePaymentLink = async (req, res) => {
    try {
        const { merchantOrderId } = req.body;

        if (!merchantOrderId) {
            return res.json(error("Merchant Order ID is required", STATUSCODE.BAD_REQUEST))
        }

        await PhonePayPaymentLink.update({
            state: "FAILED"
        }, {
            where: { merchantOrderId }
        });

        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { message: "Payment Link Deleted" }, STATUSCODE.SUCCESS));

    } catch (err) {
        console.error(err, "Error while deactivating payment link");
        return res.status(STATUSCODE.INTERNAL_SERVER_ERROR).json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};
const getAllActiveLinkes = async (req, res) => {
    try {

        let { page = 1, limit = 10, search = '' } = req.query;
        page = parseInt(page);
        limit = parseInt(limit);

        const offset = (page - 1) * limit;

        // Build the where condition
        const where = {
            state: "PENDING"
        };
        if (search) {
            where[Op.or] = [
                sequelize.where(
                    sequelize.json('metaInfo.customerPhone'),
                    {
                        [Op.like]: `%${search}%`
                    }
                )
            ];
        }

        // Fetch data with count for pagination
        const { count, rows } = await PhonePayPaymentLink.findAndCountAll({
            where,
            limit,
            offset,
            order: [['id', 'DESC']]
        });

        const totalPages = Math.ceil(count / limit);

        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, {
            pagination: {
                totalItems: count,
                totalPages,
                currentPage: page,
                perPage: limit
            },
            activeLinks: rows
        }, STATUSCODE.SUCCESS));

    } catch (err) {
        console.error(err, "Error while fetching active links");
        return res.status(STATUSCODE.INTERNAL_SERVER_ERROR).json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};
const getPreviousPlan = async (req, res) => {
    try {
        let {
            id
        } = req.body;
        console.log(id, "OrderId")
        if (!id) {
            return res.json(error("Invalid id", STATUSCODE.BAD_REQUEST))
        }
        const subscription = await Subscription.findOne({ where: { hotel_id: id }, include: { model: Plan, attributes: ["id"] }, attributes: ['id'], order: [['id', 'DESC']] })

        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { id: subscription.hms_plan_mst.id }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log("Error :Responce :VeriFy Payment", err)
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const adminRenewSubscription = async (req, res) => {
    try {
        const { hotel_id } = JSON.parse(req.body.documents)
        console.log(JSON.parse(req.body.documents), "Documents:::")
        const pyamentImage = req.file
        const { discountrate, gst, discount, grandAmount, subTotal, plan_id, gst_calculated, plan_start_date, plan_end_date } = JSON.parse(req.body.documents).planData

        console.log(discountrate, gst, discount, grandAmount, subTotal, plan_id, gst_calculated, plan_start_date, plan_end_date, "Plandata::::")

        const findSubscription = await Subscription.findOne({
            where: { hotel_id: hotel_id, end_date: { [Op.gt]: new Date() } }, include: [{
                model: Plan,
                attributes: ['id', 'name', 'price', 'duration_days']
            }, { model: SubscriptionPayment }]
        })
        if (findSubscription) {
            return res.json(error("Your Subscription Already Running", STATUSCODE.BAD_REQUEST))
        }

        const newSubscription = await Subscription.create({
            discountrate: +discountrate,
            hotel_id: hotel_id,
            plan_id: +plan_id,
            start_date: new Date(moment(plan_start_date).startOf('day')),
            end_date: new Date(moment(plan_end_date).endOf('day')),
            subTotal,
            discount,
            gst,
            gst_calculated,
            grandAmount,
            subscription_extend_count: 0
        });
        const { payment_method, payment_date, amount_paid, UTR_NO } = JSON.parse(req.body.documents).payment_info
        console.log(payment_method, payment_date, amount_paid, UTR_NO, "Payment::")
        await SubscriptionPayment.create({
            subscription_id: newSubscription.id,
            payment_method,
            payment_date,
            amount_paid: amount_paid,
            UTR_No: UTR_NO,
            payment_image: pyamentImage.filename,
            note: "", hotel_id: hotel_id
        });

        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { message: "ReNew Successfully" }, STATUSCODE.SUCCESS))

    } catch (err) {
        console.log(err)

    }
}
const webHook = async (req, res) => {
    try {
        const { payload } = req.body
        console.log(payload, "Payload::::")
        if (payload) {

            const { merchantId,
                merchantOrderId,
                orderId,
                state,
                amount,
                expireAt,
                metaInfo,
                paymentDetails } = payload

            console.log(JSON.stringify(paymentDetails), "PaymentDetails:::")
            if (merchantOrderId && state) {
                const getData = await PhonePayPaymentLink.findOne({ where: { merchantOrderId } })
                console.log(getData, "GetData:::")
                if (getData) {
                    const { transactionId: UTR_NO, paymentMode: payment_method } = paymentDetails[0]
                    console.log(UTR_NO, payment_method, "Payment Methos::::")
                    // return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, {}, STATUSCODE.SUCCESS))
                    await PhonePayPaymentLink.update({
                        merchantId,
                        orderId,
                        state,
                        amount: (amount / 100).toFixed(2),
                        expireAt,
                        metaInfo,
                        paymentDetails
                    }, { where: { merchantOrderId } })


                    if (state === "COMPLETED" && metaInfo.website === false && metaInfo.rollPrinter === false) {
                        const {
                            plan_id: id, // Plan ID
                            subTotal,
                            discount,
                            discountrate,
                            discountedvalue,
                            gst,
                            grandAmount,

                            hotel_id
                        } = getData;
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
                            hotel_id,
                            plan_id: id,
                            start_date: startDate,
                            end_date: endDate,
                            subTotal,
                            discount,
                            gst,

                            grandAmount,
                            subscription_extend_count: 0
                        });

                        // 4. Create SubscriptionPayment
                        await SubscriptionPayment.create({
                            subscription_id: newSubscription.id,
                            payment_method,
                            payment_date: new Date(),
                            payment_method,

                            amount_paid: grandAmount,
                            UTR_No: merchantOrderId,
                            note: "phone pay", hotel_id
                        });

                        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, {}, STATUSCODE.SUCCESS))

                    } else if (state === "COMPLETED" && metaInfo.website === true && metaInfo.rollPrinter === false) {

                        const {
                            plan_id: id,
                            subTotal,
                            discount,
                            discountrate,
                            discountedvalue,
                            gst,
                            grandAmount,
                            temp_hotel_id,
                        } = getData;
                        // console.log(req.body)
                        const plan = await Plan.findOne({ where: { id: +id } });
                        if (!plan) {
                            return res.json(error("Plan Not Found", STATUSCODE.INTERNAL_SERVER_ERROR));
                        }
                        const gettingHotelTempData = await TempWebsitePurchase.findOne({ where: { id: temp_hotel_id } })

                        if (gettingHotelTempData) {

                            const CheckHotelAlreadyRegistor = await Hotel.findOne({ where: { owner_number: gettingHotelTempData.mobile } })
                            if (!CheckHotelAlreadyRegistor) {

                                const newHotel = await Hotel.create({
                                    hotel_name: gettingHotelTempData.hotel_name,
                                    owner_name: gettingHotelTempData.name,
                                    owner_number: gettingHotelTempData.mobile,
                                    owner_email_id: gettingHotelTempData.email,
                                    address1: gettingHotelTempData.address1,
                                    address2: gettingHotelTempData.address2,
                                    pincode: gettingHotelTempData.pincode,
                                })

                                const role = await Role.create({ role_name: USER_ROLE.ADMIN, hotel_id: newHotel.id })
                                const user = await HotelUser.create({ created_by: req.user, role_cd: role.role_cd, hotel_id: newHotel.id, email: JSON.parse(req.body.documents).owner_email_id, number: JSON.parse(req.body.documents).owner_number, name: JSON.parse(req.body.documents).owner_name, active: true, password: JSON.parse(req.body.documents).password })

                                const access = [
                                    { access_name: 'Order', read: true, create: true, edit: true, delete: true },
                                    { access_name: 'Table', read: true, create: true, edit: true, delete: true },
                                    { access_name: 'Menu', read: true, create: true, edit: true, delete: true },
                                    { access_name: 'DashBoard', read: true, create: true, edit: true, delete: true },
                                    { access_name: 'Reports', read: true, create: true, edit: true, delete: true },
                                    { access_name: 'Biller', read: true, create: true, edit: true, delete: true },
                                    { access_name: 'User', read: true, create: true, edit: true, delete: true },
                                    { access_name: 'Booking', read: true, create: true, edit: true, delete: true },
                                    { access_name: 'Stock', read: true, create: true, edit: true, delete: true },
                                    { access_name: 'Expense', read: true, create: true, edit: true, delete: true },
                                    { access_name: 'Zomato', read: true, create: true, edit: true, delete: true },
                                ]
                                for (const cur of access) {
                                    await UserAccess.create({ access_name: cur.access_name, read: cur.read, create: cur.create, edit: cur.edit, delete: cur.delete, hotel_id: newHotel.id, hotelUser_id: user.id })
                                }
                                // 2. Calculate subscription period
                                const startDate = new Date();
                                const endDate = new Date();
                                endDate.setDate(startDate.getDate() + 365); // Add 365 days

                                // 3. Create Subscription
                                const newSubscription = await Subscription.create({
                                    discountrate,
                                    discountedvalue,
                                    hotel_id: newHotel.id,
                                    plan_id: id,
                                    start_date: startDate,
                                    end_date: endDate,
                                    subTotal,
                                    discount,
                                    gst,
                                    grandAmount,
                                    subscription_extend_count: 0
                                });
                                // 4. Create SubscriptionPayment
                                await SubscriptionPayment.create({
                                    subscription_id: newSubscription.id,
                                    payment_method: "PhonePe",
                                    payment_date: new Date(),
                                    payment_method,
                                    amount_paid: grandAmount,
                                    UTR_No: transactionId,
                                    note: "phone pay From Website", hotel_id: newHotel.id,
                                });
                            }
                        }
                        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, {}, STATUSCODE.SUCCESS))

                    } else if (state === "COMPLETED" && metaInfo.website === true && metaInfo.rollPrinter === true) {
                        const {
                            grandAmount,
                            printer_roll_id,
                        } = getData;
                        // console.log(req.body)

                        const gettingHotelTempData = await PurchaseRollsAndPrinter.findOne({ where: { id: printer_roll_id } })
                        await PurchaseRollsAndPrinter.update({ payment_status: "completed" }, { where: { id: printer_roll_id } })
                        console.log(gettingHotelTempData, "GettingHotelTempData::")
                        if (gettingHotelTempData) {
                            const gettingPayment = await SubscriptionPayment.findOne({ where: { purchase_printer_id: gettingHotelTempData.id, payment_status: "completed" } })
                            if (gettingPayment) {
                                return res.status(STATUSCODE.SUCCESS).json(success("Payment verified", { data: reponce }, STATUSCODE.SUCCESS))
                            } else {

                                await SubscriptionPayment.create({
                                    purchase_printer_id: gettingHotelTempData.id,
                                    payment_method: "PhonePe",
                                    payment_date: new Date(),
                                    amount_paid: grandAmount,
                                    UTR_No: transactionId,
                                    note: "phone pay From Website Printer Roll",
                                });

                                sendPurchaseOrderEmail(gettingHotelTempData.email, { ...gettingHotelTempData, orderId: gettingHotelTempData.id, date: moment(gettingHotelTempData.createdAt).format("DD/MM/YYYY hh:mm a") })

                            }
                        }

                    } else {
                        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, {}, STATUSCODE.SUCCESS))
                    }
                } else {

                    return res.json(error("Merchat Link Not Found", STATUSCODE.BAD_REQUEST))
                }
            } else {

                return res.json(error("BAD_REQUEST", STATUSCODE.BAD_REQUEST))
            }
        } else {
            return res.json(error("BAD_REQUEST", STATUSCODE.BAD_REQUEST))

        }
    } catch (err) {
        console.log(err, "Error on Web Hook")
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }


}
const generateMobilePaymentLink = async (req, res) => {
    try {
        const { subTotal, discount, gst, grandAmount, id, discountrate, discountedvalue } = req.body
        if (!subTotal || !discount || !gst || !grandAmount || !id || !discountrate || !discountedvalue) {
            return res.json(mobileError("All Fields Required", STATUSCODE.INTERNAL_SERVER_ERROR))
        }
        const planData = await Plan.findOne({ where: { id } })
        if (!planData) return res.json(mobileError("Plan Not Found", STATUSCODE.BAD_REQUEST))
        const hashData = encryptObject({ mobile: true, subTotal, discount, gst, grandAmount, id, discountrate, discountedvalue, amount: grandAmount, hotel_id: req.user })
        const url = `https://billerpe.com/payment.html?hashData=${hashData}`
        return res.status(STATUSCODE.SUCCESS).json(mobileSuccess(MESSAGE.SUCCESS, { url, success_url: `${process.env.SOCKET_URL}/#/payment/success`, fail_url: `${process.env.SOCKET_URL}/#/payment/fail` }, "Payment Link Generated", STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err, "error while generatinf Paymment Link")
        return res.json(mobileError(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const createPhonePePaymentWebSite = async (req, res) => {
    try {
        const { hashData } = req.body;
        console.log(decryptObject(hashData), "HasData::::")
        const { plan_id, subtotal, grandAmount, gst, discount, discountType, discountValue, coupenCode, temp_hotel_id } = decryptObject(hashData)
        // const amountdata = decodeHashId(hashData)
        console.log(client, "CLient::::")

        const transactionId = generateTransactionId();
        console.log(transactionId, "transactionId:")
        const hotel = await TempWebsitePurchase.findOne({ where: { id: temp_hotel_id } })
        console.log(hotel, "Hotel:::")
        let amountData = parseFloat(grandAmount) * 100
        if (!amountData || !transactionId || !hotel.mobile || !hotel.name) {
            return res.status(400).json({ message: "Missing required fields" });
        }
        console.log(hotel, "hotel:")
        const redirectUrlMerchant = `${process.env.WEBSITE_URL}/paymentStatus.html?transactionId=${transactionId}`;
        const metaInfo = {
            customerPhone: hotel.mobile,
            customerName: hotel.name,
            website: true,
            rollPrinter: false
        };


        const request = StandardCheckoutPayRequest.builder()
            .merchantOrderId(transactionId)
            .amount(amountData)
            .redirectUrl(redirectUrlMerchant)
            .metaInfo(metaInfo)
            .build();

        console.log(request, "Request URL::")
        const ress = await client.pay(request)
        const { orderId, redirectUrl, state, expireAt } = ress
        console.log(expireAt, "ExireAt::")
        console.log({ merchantOrderId: transactionId, orderId, redirectUrl, state, expireAt: new Date(expireAt), metaInfo, temp_hotel_id: temp_hotel_id, plan_id, subTotal: subtotal, discount, gst, grandAmount, discountrate: discountType, discountedvalue: discountValue })
        await PhonePayPaymentLink.create({ merchantOrderId: transactionId, orderId, temp_hotel_id: temp_hotel_id, redirectUrl, state, expireAt: new Date(expireAt), metaInfo, plan_id, type: "Website Purchase", subTotal: subtotal, discount: discountType, gst, grandAmount, discountrate: discountValue, discountedvalue: discount })
        console.log(ress, "Responce")
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, ress, STATUSCODE.SUCCESS))
        //   const checkoutPageUrl = response.redirectUrl;
    } catch (err) {
        console.error("PhonePe Create Payment Error:", err);
        return res.status(500).json({ message: "Internal server error", error: err.message });
    }
};
const createPhonePePaymentWebSiteFroRll = async (req, res) => {
    try {
        const { hashData } = req.body;
        // console.log(decryptObject(hashData), "HasData::::")
        const { subtotal, grandAmount, gst, discount, discountType, discountValue, printer_roll_id } = decryptObject(hashData)
        // const amountdata = decodeHashId(hashData)
        console.log(client, "CLient::::")

        const transactionId = generateTransactionId();
        console.log(transactionId, "transactionId:")
        const hotel = await PurchaseRollsAndPrinter.findOne({ where: { id: printer_roll_id } })
        console.log(hotel, "Hotel:::")
        let amountData = parseFloat(grandAmount) * 100
        if (!amountData || !transactionId || !hotel.mobile || !hotel.name) {
            return res.status(400).json({ message: "Missing required fields" });
        }
        // console.log(hotel, "hotel:")
        const redirectUrlMerchant = `${process.env.WEBSITE_URL}/shopPaymentStatus.html?transactionId=${transactionId}`;
        const metaInfo = {
            customerPhone: hotel.mobile,
            customerName: hotel.name,
            website: true,
            rollPrinter: true
        };


        const request = StandardCheckoutPayRequest.builder()
            .merchantOrderId(transactionId)
            .amount(amountData)
            .redirectUrl(redirectUrlMerchant)
            .metaInfo(metaInfo)
            .build();

        console.log(request, "Request URL::")
        const ress = await client.pay(request)
        const { orderId, redirectUrl, state, expireAt } = ress
        console.log(expireAt, "ExireAt::")
        console.log({ merchantOrderId: transactionId, orderId, redirectUrl, state, expireAt: new Date(expireAt), metaInfo, printer_roll_id, type: "PrinterRoll", subTotal: subtotal, discount: discountType, gst, grandAmount, discountrate: discountValue, discountedvalue: discount })
        await PhonePayPaymentLink.create({ merchantOrderId: transactionId, orderId, redirectUrl, state, expireAt: new Date(expireAt), metaInfo, printer_roll_id, type: "PrinterRoll", subTotal: subtotal, discount: discountType, gst, grandAmount, discountrate: discountValue, discountedvalue: discount })
        console.log(ress, "Responce")
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, ress, STATUSCODE.SUCCESS))
        //   const checkoutPageUrl = response.redirectUrl;
    } catch (err) {
        console.error("PhonePe Create Payment Error:", err);
        return res.status(500).json({ message: "Internal server error", error: err.message });
    }
};
const verifyPhonePePaymentForWebSite = async (req, res) => {
    try {
        const { transactionId } = req.body
        const reponce = await client.getOrderStatus(transactionId)
        // const state = reponce.state;
        console.log(reponce, "responce:::")
        const { state } = reponce
        // COMPLETED PENDING FAILED 
        // const response = await axios.get(url, { headers });
        console.log(state, "State::")
        if (state === "COMPLETED") {

            console.log("TransactionId::", transactionId)
            const gettingPaymentLink = await PhonePayPaymentLink.findOne({ where: { merchantOrderId: transactionId } })
            // 1. Check if plan exists
            const {
                plan_id: id, // Plan ID
                subTotal,
                discount,
                discountrate,
                discountedvalue,
                gst,
                grandAmount,
                temp_hotel_id,
            } = gettingPaymentLink;
            // console.log(req.body)

            const gettingHotelTempData = await TempWebsitePurchase.findOne({ where: { id: temp_hotel_id } })
            console.log(gettingHotelTempData, "GettingHotelTempData::")
            if (gettingHotelTempData) {

                const CheckHotelAlreadyRegistor = await Hotel.findOne({ where: { owner_number: gettingHotelTempData.mobile } })
                console.log(CheckHotelAlreadyRegistor, "CheckHotelAlreadyRegistor::")
                if (!CheckHotelAlreadyRegistor) {

                    const gettingReferCode = await superAdminModel.findOne({ where: { referal_code: gettingHotelTempData.refer_code } })
                    console.log(gettingReferCode, "GefereCode Data:::")
                    const newHotel = await Hotel.create({
                        created_by: gettingReferCode ? gettingReferCode.id : 1,
                        hotel_name: gettingHotelTempData.hotel_name,
                        owner_name: gettingHotelTempData.name,
                        owner_number: gettingHotelTempData.mobile,
                        owner_email_id: gettingHotelTempData.email,
                        address1: gettingHotelTempData.address1,
                        address2: gettingHotelTempData.address2,
                        pinCode: gettingHotelTempData.pincode,
                        password: gettingHotelTempData.password,
                        hotel_logo: "default_hotel_logo.png"
                    })

                    const role = await Role.create({ role_name: USER_ROLE.ADMIN, hotel_id: newHotel.id })
                    const user = await HotelUser.create({ created_by: 1, role_cd: role.role_cd, hotel_id: newHotel.id, email: gettingHotelTempData.email, number: gettingHotelTempData.mobile, name: gettingHotelTempData.name, active: true, password: gettingHotelTempData.password })

                    const access = [
                        { access_name: 'Order', read: true, create: true, edit: true, delete: true },
                        { access_name: 'Table', read: true, create: true, edit: true, delete: true },
                        { access_name: 'Menu', read: true, create: true, edit: true, delete: true },
                        { access_name: 'DashBoard', read: true, create: true, edit: true, delete: true },
                        { access_name: 'Reports', read: true, create: true, edit: true, delete: true },
                        { access_name: 'Biller', read: true, create: true, edit: true, delete: true },
                        { access_name: 'User', read: true, create: true, edit: true, delete: true },
                        { access_name: 'Booking', read: true, create: true, edit: true, delete: true },
                        { access_name: 'Stock', read: true, create: true, edit: true, delete: true },
                        { access_name: 'Expense', read: true, create: true, edit: true, delete: true },
                        { access_name: 'Zomato', read: true, create: true, edit: true, delete: true },
                    ]
                    for (const cur of access) {
                        await UserAccess.create({ access_name: cur.access_name, read: cur.read, create: cur.create, edit: cur.edit, delete: cur.delete, hotel_id: newHotel.id, hotelUser_id: user.id })
                    }
                    // 2. Calculate subscription period
                    const startDate = new Date();
                    const endDate = new Date();
                    endDate.setDate(startDate.getDate() + 365); // Add 365 days

                    // 3. Create Subscription
                    const newSubscription = await Subscription.create({
                        discountrate,
                        discountedvalue,
                        hotel_id: newHotel.id,
                        plan_id: id,
                        start_date: startDate,
                        end_date: endDate,
                        subTotal,
                        discount,
                        gst,
                        grandAmount,
                        subscription_extend_count: 0
                    });
                    // 4. Create SubscriptionPayment
                    await SubscriptionPayment.create({
                        subscription_id: newSubscription.id,
                        payment_method: "PhonePe",
                        payment_date: new Date(),

                        amount_paid: grandAmount,
                        UTR_No: transactionId,
                        note: "phone pay From Website", hotel_id: newHotel.id,
                    });
                    sendWelcomeEmail(gettingHotelTempData.email, { email: gettingHotelTempData.email, name: gettingHotelTempData.name, UserID: gettingHotelTempData.mobile, password: gettingHotelTempData.password, phone_no: gettingHotelTempData.mobile, business_name: gettingHotelTempData.hotel_name, pincode: gettingHotelTempData.pincode, address: gettingHotelTempData.address1 })
                }
            }


            // return res.status(200).json({ message: "Payment verified", data: reponce.OrderStatusResponse });
            return res.status(STATUSCODE.SUCCESS).json(success("Payment verified", { data: reponce }, STATUSCODE.SUCCESS))

        } else {
            return res.status(STATUSCODE.SUCCESS).json(success("Payment verified Failed", { data: reponce }, STATUSCODE.BAD_REQUEST))
            // return res.status(200).json({ message: "Payment verified Failed", data: reponce.OrderStatusResponse });

        }
        // if (reponce.data && response.data.success) {
        // } else {
        // return res.status(400).json({ message: "Failed to verify payment", data: response });
        // }

    } catch (error) {
        console.error("PhonePe Verify Payment Error:", error.response?.data || error.message);
        return res.status(500).json({ message: "Internal server error", error: error.message });
    }
};
const verifyPhonePePaymentForPrinterRoll = async (req, res) => {
    try {
        const { transactionId } = req.body
        const reponce = await client.getOrderStatus(transactionId)
        // const state = reponce.state;
        console.log(reponce, "responce:::")
        const { state } = reponce
        // COMPLETED PENDING FAILED 
        // const response = await axios.get(url, { headers });
        console.log(state, "State::")
        if (state === "COMPLETED") {

            console.log("TransactionId::", transactionId)
            const gettingPaymentLink = await PhonePayPaymentLink.findOne({ where: { merchantOrderId: transactionId } })
            // 1. Check if plan exists
            const {
                grandAmount,
                printer_roll_id,
            } = gettingPaymentLink;
            // console.log(req.body)

            const gettingHotelTempData = await PurchaseRollsAndPrinter.findOne({ where: { id: printer_roll_id } })
            await PurchaseRollsAndPrinter.update({ payment_status: "completed" }, { where: { id: printer_roll_id } })
            console.log(gettingHotelTempData, "GettingHotelTempData::")
            if (gettingHotelTempData) {
                const gettingPayment = await SubscriptionPayment.findOne({ where: { purchase_printer_id: gettingHotelTempData.id } })
                if (gettingPayment) {
                    return res.status(STATUSCODE.SUCCESS).json(success("Payment verified", { data: reponce, details: gettingHotelTempData }, STATUSCODE.SUCCESS))
                } else {

                    await SubscriptionPayment.create({
                        purchase_printer_id: gettingHotelTempData.id,
                        payment_method: "PhonePe",
                        payment_date: new Date(),
                        amount_paid: grandAmount,
                        UTR_No: transactionId,
                        note: "phone pay From Website Printer Roll",
                    });

                    sendPurchaseOrderEmail(gettingHotelTempData.email, { ...gettingHotelTempData, orderId: gettingHotelTempData.id, date: moment(gettingHotelTempData.createdAt).format("DD/MM/YYYY hh:mm a") })

                }
                return res.status(STATUSCODE.SUCCESS).json(success("Payment verified", { data: reponce, details: gettingHotelTempData }, STATUSCODE.SUCCESS))
            } else {
                return res.json(error("Data Not Found", STATUSCODE.BAD_REQUEST))
            }


            // return res.status(200).json({ message: "Payment verified", data: reponce.OrderStatusResponse });

        } else {
            return res.status(STATUSCODE.SUCCESS).json(error("Payment verified Failed", STATUSCODE.BAD_REQUEST))
            // return res.status(200).json({ message: "Payment verified Failed", data: reponce.OrderStatusResponse });

        }
        // if (reponce.data && response.data.success) {
        // } else {
        // return res.status(400).json({ message: "Failed to verify payment", data: response });
        // }

    } catch (error) {
        console.error("PhonePe Verify Payment Error:", error.response?.data || error.message);
        return res.status(500).json({ message: "Internal server error", error: error.message });
    }
};
module.exports = { verifyPhonePePaymentForPrinterRoll, createPhonePePaymentWebSiteFroRll, verifyPhonePePaymentForWebSite, createPhonePePaymentWebSite, generateTransactionId, encryptObject, decryptObject, generateMobilePaymentLink, generatePaymentHashId, webHook, verifyPhonePePayment, createPhonePePayment, getAllActiveLinkes, deactivatePaymentLink, verifyPaymentGeneratedLink, gereratePaymentLink, adminRenewSubscription, getPreviousPlan }

