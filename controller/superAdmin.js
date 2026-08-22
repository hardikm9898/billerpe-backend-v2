const Hotel = require("../model/hotel")
const Table = require("../model/table")
const { Op, fn, col, literal } = require("sequelize");

const { MESSAGE, STATUSCODE, USER_ROLE, ORDER_TYPE, STATUS } = require("../constant/const")
const { success, error } = require("../responce/res")

const Order = require("../model/order")

const Sequelize = require('sequelize');
const Role = require("../model/role_mst")


const moment = require("moment")
const HotelUser = require("../model/hotelUser")
const jwt = require("jsonwebtoken")
const bcrypt = require("bcrypt")

const webSiteUserData = require("../model/webSiteUserData")

const SuperAdminUser = require("../model/superAdminModel")
const SubscriptionPayment = require("../model/subscription/subscriptionPayment")

const Subscription = require("../model/subscription/subscription");
const AdminAddRestoSave = require("../model/adminAddRestoSave");
const Plan = require("../model/subscription/plan");
const sequelize = require("../connection/connect");
const { PurchaseRollsAndPrinter, websiteProducts, Images, User, superAdminModel } = require("../model");
const { sendShippedMail } = require("../services/sendMail");
const WebSiteProducts = require("../model/webSiteProducts");
const path = require("path");
const RaiseTicket = require("../model/raiseTicket");
const xlsx = require("xlsx");
const fs = require("fs");
const Menu = require("../model/menu");
const Menu_categ = require("../model/menu_categ");
const Variants = require("../model/variants");
const AddonDepartment = require("../model/addonDepartMent");
const MenuAddon = require("../model/menu_addons");
const Addons = require("../model/addons");
const redisClient = require("../connection/redis");
const EBillCredit = require("../model/ebillCredit");
const EBillCreditDebit = require("../model/ebillCreditDebit");



const restaurantDetails = async (req, res) => {
    try {
        const { endDate, startDate } = req.body
        // const currentDayStart = moment().startOf()
        // const currentDayEnd = moment().endOf()
        const start = moment(startDate)
        const end = moment(endDate)
        start.set('hour', 0)
        start.set('minute', 0)
        start.set('second', 0)
        end.set('hour', 23)
        end.set('minute', 59)
        end.set('second', 59)
        const startD = new Date(start)
        const endD = new Date(end)
        const restaurants = await Hotel.findAll({
            attributes: [
                "hotel_name",
                "hotel_logo",
                [
                    Sequelize.literal(`
                        SUM(CASE 
                            WHEN hms_order_msts.payment = 'success' 
                            AND hms_order_msts.status = 'success' 
                            THEN hms_order_msts.grandAmount 
                            ELSE 0 
                        END)
                    `),
                    "totalSale",
                ],
                [
                    Sequelize.fn("COUNT", Sequelize.col("hms_order_msts.id")),
                    "totalInvoice",
                ],
                [
                    Sequelize.literal(`
                        SUM(CASE 
                            WHEN hms_order_msts.payment = 'pending' 
                            THEN 1 
                            ELSE 0 
                        END)
                    `),
                    "liveTable",
                ],
            ],
            include: [
                {
                    model: Order,
                    attributes: [],
                    where: {
                        createdAt: {
                            [Op.between]: [startD, endD],
                        },
                        deleted: false,
                    },
                },
                {
                    model: HotelUser,
                    attributes: ["number", "password"],
                    include: [
                        {
                            model: Role,
                            attributes: ["role_name"],
                            where: { role_name: "A" },
                        },
                    ],
                },
            ],
            group: ["hotel_registration.id", "hotel_registration.hotel_name", "hotel_registration.hotel_logo", "hms_hotelUser_masters.id"],

        });


        return res.json(success(MESSAGE.SUCCESS, { restaurants }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err)
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const singleHotelSP = async (req, res) => {
    try {
        const { id } = req.body
        if (!id) {
            return res.json(error("Please Provide Required Field", STATUSCODE.BAD_REQUEST))
        }
        const restaurants = await Hotel.findOne({ where: { id }, include: { model: HotelUser, include: { model: Role, where: { role_name: "A" } } } })
        console.log(restaurants, "Single Hotel::")
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, restaurants, STATUSCODE.SUCCESS))
    } catch (err) {
        //createLogFile(req.user, ` getSingleHotel/err Error`, err);
        return res.status(STATUSCODE.INTERNAL_SERVER_ERROR).json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const superAdminLogin = async (req, res) => {
    try {
        const { password, mobile } = req.body
        const hotelUser = await SuperAdminUser.findOne({ where: { number: mobile } })

        // NOTE: this previously also checked `hotelUser?.hms_role_mst?.role_name == "S"`,
        // but SuperAdminUser has no `hms_role_mst` association (its own role field is a
        // plain "Admin"/"User" enum, no "S" value) - that clause always evaluated to a
        // no-op due to operator precedence too, so effectively only existence was ever
        // checked. Preserved that existence-only behavior here; restricting by `role`
        // (e.g. to "Admin") is a product decision, not made here.
        if (!hotelUser) {
            return res.json(error(MESSAGE.USER_NOT_FOUND, STATUSCODE.VALIDATION_ERROR));
        }

        const validPassword = await bcrypt.compare(password, hotelUser.password)
        if (!validPassword) {
            return res.json(error(MESSAGE.CREDENTIAL_FALSE, STATUSCODE.UNAUTHORIZED));
        }
        const demo = jwt.sign({ id: hotelUser.id }, process.env.JWT_SECRET_KEY_SUPER_ADMIN, {
            expiresIn: "24h",
        });
        const demo2 = jwt.sign({ id: hotelUser.id }, process.env.JWT_SECRET_KEY_SUPER_ADMIN, { expiresIn: "7d" })

        await res.cookie("demo", demo, {
            httpOnly: true, maxAge: 1000 * 60 * 14,
            // expires works the same as the maxAge
            sameSite: 'lax'
        })
        await res.cookie("demo2", demo2, { httpOnly: true, maxAge: 604800000, sameSite: 'lax' })
        return res.json(success("success", { message: { token: demo, message: "Login SuccessFully" } }, res.statusCode));

    } catch (err) {
        console.log(err)
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }

}
const superAdminLogOut = async (req, res) => {
    try {

        const { token, refreshToken } = req.cookies;

        res.setHeader('Set-Cookie', cookie.serialize('demo', '', {
            expires: new Date(0),
            path: '/',
        }));
        res.setHeader('Set-Cookie', cookie.serialize('demo2', '', {
            expires: new Date(0),
            path: '/',
        }));

        return res
            .status(STATUSCODE.SUCCESS)
            .json(success("success", { message: "LogOut Successfully" }, res.statusCode));
    } catch (err) {
        console.log(err)
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }

}
const checkSuperAdmin = async (req, res) => {
    try {
        const id = req.user
        const user = await SuperAdminUser.findOne({ where: { id } })
        if (user) {
            return res.json(success(MESSAGE.SUCCESS, { message: "Login", user: { id: user.id, role: user.role, name: user.name } }, STATUSCODE.SUCCESS))
        }
        return res.json(error(MESSAGE.USER_NOT_FOUND, STATUSCODE.NOT_FOUND))
    } catch (err) {
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const getDateRange = (start, end) => {
    const startDate = start ? moment(start).startOf('day') : moment().startOf('day');
    const endDate = end ? moment(end).endOf('day') : moment().endOf('day');
    const previousStartDate = moment(startDate).subtract(1, 'days');
    return [new Date(startDate), new Date(endDate), new Date(previousStartDate)];
};
const AllInquiry = async (req, res) => {
    try {

        const { startDate, endDate } = req.body
        const startD = startDate ? new Date(moment(startDate).startOf('day')) : new Date(moment().startOf('day'));
        const endD = endDate ? new Date(moment(endDate).endOf('day')) : new Date(moment().endOf('day'));
        const allInquiry = await webSiteUserData.findAll(
            {
                where: {
                    createdAt: {
                        [Op.between]: [startD, endD]
                    }
                },
                attributes: ['id', 'name', 'email', "phone_number", "createdAt", "status", "taken_by"],
                order: [['id', 'DESC']],
                limit: 500
            }
        )

        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { allInquiry }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err)
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const updateInqueryStatus = async (req, res) => {
    try {

        const { id, takenBy } = req.body

        if (!id) {
            return res.json(error("id Required", STATUSCODE.BAD_REQUEST))
        }
        await webSiteUserData.update({ status: true, taken_by: takenBy }, { where: { id }, })
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { message: "Status Updated" }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err)
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

const superAdminDashBoardData = async (req, res) => {
    try {
        const { startDate, endDate } = req.body;
        const startD = moment(startDate).startOf("day").toDate();
        const endD = moment(endDate).endOf("day").toDate();

        if (moment(endD).diff(moment(startD), "days") > 60) {
            return res.json(
                error("Date range cannot exceed 60 days", STATUSCODE.BAD_REQUEST)
            );
        }
        // Previous period
        const diffMs = endD.getTime() - startD.getTime();
        const prevStart = new Date(startD.getTime() - diffMs);
        const prevEnd = new Date(startD.getTime() - 1);

        /* --------------------------------
           Utility
        --------------------------------- */
        const calcChange = (current = 0, previous = 0) => {
            if (!previous) return { change: "+0%", trending: "up" };
            const diff = current - previous;
            return {
                change: `${diff >= 0 ? "+" : ""}${(
                    (diff / previous) *
                    100
                ).toFixed(1)}%`,
                trending: diff >= 0 ? "up" : "down",
            };
        };

        /* --------------------------------
           Parallel Metrics Queries
        --------------------------------- */

        const [
            totalCustomer,
            newClient,
            activeRestaurant,
            totalRevenue,
            prevNewClient,
            prevActiveRestaurant,
            prevTotalRevenue,
            myClient,
            prevMyClient,
            user,
        ] = await Promise.all([
            Hotel.count(),
            Hotel.count({ where: { createdAt: { [Op.between]: [startD, endD] } } }),
            Hotel.count({
                distinct: true,
                col: "id",
                include: [
                    {
                        model: Order,
                        where: { createdAt: { [Op.between]: [startD, endD] } },
                        required: true,
                    },
                ],
            }),
            SubscriptionPayment.sum("amount_paid", {
                where: { createdAt: { [Op.between]: [startD, endD] } },
            }),
            Hotel.count({ where: { createdAt: { [Op.between]: [prevStart, prevEnd] } } }),
            Hotel.count({
                distinct: true,
                col: "id",
                include: [
                    {
                        model: Order,
                        where: { createdAt: { [Op.between]: [prevStart, prevEnd] } },
                        required: true,
                    },
                ],
            }),
            SubscriptionPayment.sum("amount_paid", {
                where: { createdAt: { [Op.between]: [prevStart, prevEnd] } },
            }),
            Hotel.count({
                where: {
                    created_by: req.user,
                    createdAt: { [Op.between]: [startD, endD] },
                },
            }),
            Hotel.count({
                where: {
                    created_by: req.user,
                    createdAt: { [Op.between]: [prevStart, prevEnd] },
                },
            }),
            SuperAdminUser.findByPk(req.user),
        ]);

        const hotels = await Hotel.findAll({
            where: { active: true },
            attributes: [
                "id",
                "hotel_name",
                "owner_name",
                "owner_number",
                "hotel_logo",
            ],
            order: [["id", "DESC"]],
            raw: true,
        });
        const lastOrders = await Order.findAll({
            attributes: [
                "hotel_id",
                [sequelize.fn("MAX", sequelize.col("createdAt")), "lastActiveDate"],
            ],
            group: ["hotel_id"],
            raw: true,
        });
        console.log(lastOrders.length, "Data:::")


        const lastOrderMap = Object.fromEntries(
            lastOrders.map(o => [o.hotel_id, o.lastActiveDate])
        );

        const inactiveRestaurant = hotels
            .map(hotel => {
                const lastActive = lastOrderMap[`${hotel.id}`];

                return {
                    ...hotel,
                    lastActiveDate: lastActive
                        ? moment(lastActive).format("DD/MM/YYYY")
                        : "No Active",
                };
            })
            .filter(h => h.lastActiveDate !== moment(new Date()).format("DD/MM/YYYY"))
            .sort((a, b) => {
                if (a.lastActiveDate === "No Active") return -1;
                if (b.lastActiveDate === "No Active") return 1;
                return (
                    moment(b.lastActiveDate, "DD/MM/YYYY") -
                    moment(a.lastActiveDate, "DD/MM/YYYY")
                );
            });

        /* --------------------------------
           Due Payment Query (Reusable)
        --------------------------------- */
        const getDuePayments = async (userId = null) => {
            return sequelize.query(
                `
        SELECT 
          hr.hotel_logo, hr.hotel_name, hr.id,
          hr.owner_name, hr.owner_number, hr.createdAt,
          sub_data.grandAmount,
          COALESCE(p.total_paid, 0) AS total_paid,
          (sub_data.grandAmount - COALESCE(p.total_paid, 0)) AS duePayment
        FROM hotel_registrations hr
        INNER JOIN (
          SELECT hotel_id, grandAmount, id AS subscription_id,
          ROW_NUMBER() OVER (PARTITION BY hotel_id ORDER BY createdAt DESC) rn
          FROM hms_subscription_msts
        ) sub_data ON hr.id = sub_data.hotel_id AND rn = 1
        LEFT JOIN (
          SELECT subscription_id, SUM(amount_paid) total_paid
          FROM hms_subscription_payments
          GROUP BY subscription_id
        ) p ON p.subscription_id = sub_data.subscription_id
        WHERE hr.active = 1
        ${userId ? "AND hr.created_by = :userId" : ""}
        AND (sub_data.grandAmount - COALESCE(p.total_paid, 0)) > 0
      `,
                {
                    replacements: { userId },
                    type: sequelize.QueryTypes.SELECT,
                }
            );
        };

        const dueData = await getDuePayments(
            user.role === "Admin" ? null : req.user
        );

        const duePaymentData = {
            totalDue: dueData.reduce((s, r) => s + Number(r.duePayment || 0), 0),
            dueData,
        };

        /* --------------------------------
           Tickets
        --------------------------------- */
        const ticketData = {
            totalNewTickets:
                user.role === "Admin"
                    ? await RaiseTicket.count({ where: { status: "new" } })
                    : 0,
            totalOpenTickets: await RaiseTicket.count({
                where:
                    user.role === "Admin"
                        ? { status: "open" }
                        : { status: "open", super_id: req.user },
            }),
        };

        /* --------------------------------
           Metrics
        --------------------------------- */
        const metrics = [
            {
                title: "Total Customers",
                value: totalCustomer.toLocaleString(),
                change: "+0%",
                trending: "up",
                icon: "Users",
                color: "super-admin-metric-icon--blue",
            },
            {
                title: "New Client",
                value: newClient.toLocaleString(),
                ...calcChange(newClient, prevNewClient),
                icon: "UserPlus",
                color: "super-admin-metric-icon--green",
            },
            ...(user.role !== "Admin"
                ? [
                    {
                        title: "Your New Client",
                        value: myClient.toLocaleString(),
                        ...calcChange(myClient, prevMyClient),
                        icon: "UserPlus",
                        color: "super-admin-metric-icon--green",
                    },
                ]
                : []),
            {
                title: "Active Restaurants",
                value: activeRestaurant.toLocaleString(),
                ...calcChange(activeRestaurant, prevActiveRestaurant),
                icon: "Store",
                color: "super-admin-metric-icon--purple",
            },
            ...(user.role === "Admin"
                ? [
                    {
                        title: "Total Revenue",
                        value: (totalRevenue || 0).toLocaleString(),
                        ...calcChange(totalRevenue || 0, prevTotalRevenue || 0),
                        icon: "ShoppingBag",
                        color: "super-admin-metric-icon--orange",
                    },
                ]
                : []),
        ];

        return res.status(STATUSCODE.SUCCESS).json(
            success(
                MESSAGE.SUCCESS,
                {
                    ticketData,
                    inactiveRestaurantData: {
                        inactiveRestaurant,
                        inactiveRestaurantCount: inactiveRestaurant.length,
                    },
                    metrics,
                    duePaymentData,
                },
                STATUSCODE.SUCCESS
            )
        );
    } catch (err) {
        console.error("Super Admin Dashboard Error:", err);
        return res.json(
            error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR)
        );
    }
};

const superAdminNewClientGraph = async (req, res) => {
    try {
        let { startDate, endDate, type } = req.body;

        if (!startDate || !endDate) {
            return res.status(400).json({ success: false, message: "Start and End date required" });
        }
        const getuser = await SuperAdminUser.findOne({ where: { id: req.user } })
        if (!getuser) return res.json(error("Not Authorized User", STATUSCODE.UNAUTHORIZED))
        startDate = moment(startDate).startOf("day").toDate();
        endDate = moment(endDate).endOf("day").toDate();
        if (moment(endDate).startOf("day").diff(moment(startDate).startOf("day"), "days") > 60) {
            return res.json(error("Date range cannot exceed 60 days", STATUSCODE.BAD_REQUEST))

        }

        const whereCondition = getuser.role === "Admin" ? { createdAt: { [Op.between]: [startDate, endDate] } } : { created_by: req.user, createdAt: { [Op.between]: [startDate, endDate] } }
        const rawResults = await Hotel.findAll({
            attributes: [
                [fn("DATE", col("createdAt")), "day"],
                [fn("COUNT", col("id")), "count"]
            ],
            where: { ...whereCondition },
            group: ["day"],
            order: [[literal("day"), "ASC"]]
        });

        // Convert results to { "YYYY-MM-DD": count }
        const mappedResults = rawResults.reduce((acc, r) => {
            acc[moment(r.get("day")).format("YYYY-MM-DD")] = parseInt(r.get("count"));
            return acc;
        }, {});

        // Generate all dates between startDate & endDate
        const fullDates = [];
        let current = moment(startDate);
        while (current.isSameOrBefore(endDate)) {
            fullDates.push(current.format("YYYY-MM-DD"));
            current.add(1, "day");
        }

        // Fill missing days with 0
        results = fullDates.map(date => ({
            day: date,
            count: mappedResults[date] || 0
        }));

        // console.log(results, "Data::")
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, results, STATUSCODE.SUCCESS))

    } catch (err) {
        console.log(err, "Error superAdmin Client Graph");
        return res.status(500).json({ success: false, message: "Internal server error" });
    }
};
const gettingupcomingRenuale = async (req, res) => {
    try {
        const { startDate, endDate } = req.body
        console.log(startDate, endDate)
        const data = await Subscription.findAll({ where: { end_date: { [Op.between]: [startDate, endDate] } }, attributes: ['end_date'], include: { model: Hotel, attributes: ['hotel_name', 'hotel_logo'] } })

        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, data, STATUSCODE.SUCCESS))

    } catch (err) {
        console.log(err, "eerr:While GFetting Upcomming Reneuale::")
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const saveAndNext = async (req, res) => {
    try {
        const data = req.body

        const { hotel_name,
            owner_name,
            owner_number,
            owner_email_id,
            address1,
            address2,
            pinCode,
            contact1,
            contact2,
            email_id,
            gst_no,
            gst_reg_name,
            hotel_logo,
            fssai_no,
            hotel_reg_date,
            password,
            plan_id,
            name, planData,
            payment_info
        } = req.body
        // console.log(req.body, "req Body::")

        const gettingPrevious = await AdminAddRestoSave.findOne({ where: { userId: req.user } })

        if (gettingPrevious) {
            await AdminAddRestoSave.update({
                hotel_name,
                owner_name,
                owner_number,
                owner_email_id,
                address1,
                address2,
                pinCode,
                contact1,
                contact2,
                email_id,
                gst_no,
                gst_reg_name,

                fssai_no,
                hotel_reg_date,
                password,
                plan_id,
                name,
                ...planData,
                ...payment_info
            }, { where: { userId: req.user } })
        } else {
            [
                await AdminAddRestoSave.create({
                    hotel_name,
                    owner_name,
                    owner_number,
                    owner_email_id,
                    address1,
                    address2,
                    pinCode,
                    contact1,
                    contact2,
                    email_id,
                    gst_no,
                    gst_reg_name,

                    fssai_no,
                    hotel_reg_date,
                    password,
                    plan_id,
                    name,
                    ...planData,
                    ...payment_info, userId: req.user
                })
            ]
        }
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { message: "Data Saved" }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err, "Error while save and next")
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const gettingPeddingAddRestoDetails = async (req, res) => {
    try {

        const userId = req.user

        const data = await AdminAddRestoSave.findOne({ where: { userId } })
        // console.log(data, "Data::")
        if (!data) {
            return res.json(error("No Data Found", STATUSCODE.BAD_REQUEST))
        }
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { data }, STATUSCODE.SUCCESS))

    } catch (err) {
        console.log(err, "Error::while getting")

    }

}
const makePayment = async (req, res) => {
    try {
        const { payment_method, subscription_id, UTR_No, payment_date, amount_paid, hotel_id } = JSON.parse(req?.body?.documents)
        // const userId = req.user
        // if()
        await SubscriptionPayment.create({ hotel_id, payment_method, amount_paid: +amount_paid, subscription_id, UTR_No, payment_date, payment_image: req?.file?.filename })
        // return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
        // const data = await AdminAddRestoSave.findOne({ where: { userId } })
        // console.log(data, "Data::")
        // if (!data) {
        //     return res.json(error("No Data Found", STATUSCODE.BAD_REQUEST))
        // }
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, {}, STATUSCODE.SUCCESS))

    } catch (err) {
        console.log(err, "Error::while getting")
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }

}
const renewAdminSubscription = async (req, res) => {
    try {
        const { payment_method, subscription_id, UTR_No, payment_date, amount_paid } = JSON.parse(req?.body?.documents)
        console.log(req.file, "File::")
        // const userId = req.user
        // if()
        console.log(JSON.parse(req?.body?.documents))
        await SubscriptionPayment.create({ payment_method, amount_paid: +amount_paid, subscription_id, UTR_No, payment_date, payment_image: req?.file?.filename })
        // return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
        // const data = await AdminAddRestoSave.findOne({ where: { userId } })
        // if (!data) {
        //     return res.json(error("No Data Found", STATUSCODE.BAD_REQUEST))
        // }
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, {}, STATUSCODE.SUCCESS))

    } catch (err) {
        console.log(err, "Error::while getting")
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }

}
const deleteAddAdminResto = async (req, res) => {
    try {
        await AdminAddRestoSave.destroy({ where: { userId: req.user } })
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, {}, STATUSCODE.SUCCESS))

    } catch (err) {
        console.log(err, "Error::while getting")
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }

}
const menuUploadedAndTrainingStatus = async (req, res) => {
    try {
        const { key = "menu", hotelId } = req.body

        const gettingPrevious = await Hotel.findOne({ where: { id: hotelId } })
        if (!gettingPrevious) {
            return res.json(error("No Data Found", STATUSCODE.BAD_REQUEST))
        }
        if (key === "menu") {

            await Hotel.update({ menu_uploaded: true, menu_uploaded_date: new Date() }, { where: { id: hotelId } })
        } else {
            await Hotel.update({ traningCompleted: true, traningCompleted_date: new Date() }, { where: { id: hotelId } })
        }
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { message: "Status Updated" }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err, "Error::while getting")
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const gettingPrinterRollOrders = async (req, res) => {
    try {
        const { type, search, page } = req.body
        const limit = 10
        const offset = (page - 1) * limit
        let whereCondition = {}
        if (type && type === "pending") {
            whereCondition.payment_status = "pending"
            whereCondition.order_status = "pending"
            whereCondition.order_approval_status = "pending"
        } else if (type && type === "completed") {
            whereCondition.payment_status = "completed"
            whereCondition.order_status = { [Op.ne]: "delivered" }
        } else if (type && type === "delivered") {
            whereCondition.payment_status = "completed"
            whereCondition.order_status = "delivered"
        }


        const rawSearch = (search || "").toString().trim();
        if (rawSearch) {
            const sequelize = PurchaseRollsAndPrinter.sequelize;
            const dialect = sequelize.getDialect(); // 'postgres' or 'mysql', etc.

            const escapedLike = sequelize.escape(`%${rawSearch}%`);

            const orConditions = [];


            orConditions.push({ name: { [Op.like]: `%${rawSearch}%` } });


            if (/^\d+$/.test(rawSearch)) {
                orConditions.push({ id: Number(rawSearch) });
            }


            if (dialect === "postgres") {

                orConditions.push(sequelize.literal(`mobile::text ILIKE ${escapedLike}`));
            } else {

                orConditions.push(sequelize.literal(`CAST(mobile AS CHAR) LIKE ${escapedLike}`));
            }


            whereCondition[Op.or] = orConditions;
        }
        const { rows, count } = await PurchaseRollsAndPrinter.findAndCountAll({

            where: whereCondition,
            limit,
            offset,
            order: [['id', 'DESC']]
        })
        const pagination = { totalPages: Math.ceil(count / limit), currentPage: page, totalRecords: count }
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { data: rows, pagination }, STATUSCODE.SUCCESS))

    } catch (err) {
        console.log(err, "error:whilte getting Printer Roll Orders")
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))

    }
}
const updateOrderStatus = async (req, res) => {
    try {
        const { order_status, id, order_approval_status, reject_reason, order_tracking_id } = req.body
        if (order_status) {
            if (!['shipped', 'delivered'].includes(order_status)) {
                return res.json(error("Please provide a valid order status", STATUSCODE.BAD_REQUEST))
            }
            if (order_status === "shipped" && !order_tracking_id) {
                return res.json(error("Please provide order tracking id", STATUSCODE.BAD_REQUEST))
            }
            const updateData = { order_status }
            if (order_status === "shipped") {
                updateData.order_tracking_id = order_tracking_id
                const mailData = await PurchaseRollsAndPrinter.findByPk(id)
                sendShippedMail(mailData.email, { ...mailData, orderId: mailData.id, order_tracking_id })
            }
            await PurchaseRollsAndPrinter.update(updateData, { where: { id } })
        }
        if (order_approval_status) {
            const updateData = {}
            if (!['approved', 'rejected'].includes(order_approval_status)) {
                return res.json(error("Please provide a valid order approval status", STATUSCODE.BAD_REQUEST))
            }
            if (order_approval_status === "rejected" && !reject_reason) {
                return res.json(error("Please provide reject reason for rejection", STATUSCODE.BAD_REQUEST))
            }
            if (order_approval_status === "rejected") {
                updateData.reject_reason = reject_reason
            }
            await PurchaseRollsAndPrinter.update({ order_approval_status, ...updateData }, { where: { id } })
        }
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { message: "Order Status Updated" }, STATUSCODE.SUCCESS))

    } catch (err) {
        console.log(err, "error whilte updating Status")
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

function parseExistingImages(existingImages) {
    try {
        if (!existingImages) return [];
        if (typeof existingImages === "string") {
            return JSON.parse(existingImages);
        }
        if (Array.isArray(existingImages)) {
            return existingImages;
        }
        return [];
    } catch {
        return [];
    }
}

// Dummy image processor (replace with your actual S3 handler or resize logic)
async function processImages(files) {
    return files.map((file) => file.location || "");
}

const addProduct = async (req, res) => {
    try {
        const { name, keyFeatures, price } = req.body;
        const files = req.fileList || []; // always safe

        // ✅ Validate required fields
        if (!name || !price) {
            return res.json(error("Name and price are required", STATUSCODE.BAD_REQUEST));
        }

        // ✅ Parse keyFeatures safely
        let parsedKeyFeatures = [];
        if (keyFeatures) {
            try {
                parsedKeyFeatures =
                    typeof keyFeatures === "string"
                        ? JSON.parse(keyFeatures)
                        : keyFeatures;
            } catch {
                return res.json(error("Invalid keyFeatures format", STATUSCODE.BAD_REQUEST));
            }
        }

        // ✅ Check duplicate name
        const existingProduct = await WebSiteProducts.findOne({ where: { title: name } });
        if (existingProduct) {
            return res.json(error("Product name already exists", STATUSCODE.BAD_REQUEST));
        }

        // ✅ Validate images
        if (!files.length) {
            return res.json(error("At least one product image is required", STATUSCODE.BAD_REQUEST));
        }

        // ✅ Process uploaded images
        let imageUrls = [];
        try {
            imageUrls = await processImages(files);
        } catch (imgError) {
            return res.json(error(imgError.message, STATUSCODE.BAD_REQUEST));
        }

        // ✅ Create product
        const product = await WebSiteProducts.create({
            title: name,
            keyFeatures: parsedKeyFeatures,
            price: parseFloat(price),
            images: imageUrls,
        });

        return res.status(STATUSCODE.SUCCESS).json(
            success(
                MESSAGE.SUCCESS,
                {
                    message: "Product Added Successfully",
                    product: {
                        id: product.id,
                        name: product.name,
                        price: product.price,
                        keyFeatures: product.keyFeatures,
                        images: product.images,
                    },
                },
                STATUSCODE.SUCCESS
            )
        );
    } catch (err) {
        console.error("Error: While Creating Product", err);
        return res.json(
            error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR)
        );
    }
};



const editProduct = async (req, res) => {
    try {
        const { name, keyFeatures, price, id, existingImages } = req.body;
        const files = req.fileList || []; // Always defined from middleware

        // ✅ Validate product ID
        if (!id) {
            return res.json(error("Product ID is required", STATUSCODE.BAD_REQUEST));
        }

        // ✅ Fetch product
        const product = await WebSiteProducts.findByPk(id);
        if (!product) {
            return res.json(error("Product Not Found", STATUSCODE.BAD_REQUEST));
        }

        // ✅ Parse key features
        let parsedKeyFeatures = [];
        if (keyFeatures) {
            try {
                parsedKeyFeatures =
                    typeof keyFeatures === "string"
                        ? JSON.parse(keyFeatures)
                        : keyFeatures;
            } catch {
                return res.json(error("Invalid keyFeatures format", STATUSCODE.BAD_REQUEST));
            }
        }

        // ✅ Handle existing images
        const existingImageUrls = parseExistingImages(existingImages || product.images || []);
        let finalImageUrls = [...existingImageUrls];

        // ✅ Add newly uploaded images (if any)
        if (files.length > 0) {
            const newImages = await processImages(files);
            finalImageUrls.push(...newImages);
        }

        // ✅ Ensure at least one image remains
        if (finalImageUrls.length === 0) {
            return res.json(error("At least one product image is required", STATUSCODE.BAD_REQUEST));
        }

        // ✅ Prepare update data
        const updateData = {
            images: finalImageUrls,
        };

        if (name) updateData.title = name;
        if (parsedKeyFeatures.length > 0) updateData.keyFeatures = parsedKeyFeatures;
        if (price) updateData.price = parseFloat(price);

        // ✅ Update product
        await WebSiteProducts.update(updateData, { where: { id } });

        // ✅ Fetch updated record
        const updatedProduct = await WebSiteProducts.findByPk(id);

        return res.status(STATUSCODE.SUCCESS).json(
            success(
                MESSAGE.SUCCESS,
                {
                    message: "Product Updated Successfully",
                    product: {
                        id: updatedProduct.id,
                        name: updatedProduct.name,
                        price: updatedProduct.price,
                        keyFeatures: updatedProduct.keyFeatures,
                        images: updatedProduct.images,
                    },
                },
                STATUSCODE.SUCCESS
            )
        );
    } catch (err) {
        console.error("Error while updating product:", err);
        return res.json(
            error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR)
        );
    }
};
const addImage = async (req, res) => {
    try {
        // await ensureUploadDir();
        console.log("here")
        const { name } = req.body;
        const url = req.fileUrl;

        // Validate required fields
        if (!name && url) {
            return res.json(error("name required ID file is required", STATUSCODE.BAD_REQUEST));
        }

        // Find existing product
        const product = await Images.findOne({ where: { name } });
        if (product) {
            return res.json(error("This Image Name Already Available Not Found", STATUSCODE.BAD_REQUEST));
        }
        await Images.create({ name, url })

        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { message: "Image Added Successfully" }, STATUSCODE.SUCCESS))


    } catch (err) {
        console.error(err, "Error: While Updating Product");
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};
const getProductImages = async (req, res) => {
    try {

        // Extract page, limit, and search term from query params
        const page = parseInt(req.query.page, 10) || 1;
        const limit = parseInt(req.query.limit, 10) || 20;
        const search = req.params.search ? req.params.search.trim() : "";
        // Calculate offset
        const offset = (page - 1) * limit;

        // Build search condition
        const whereCondition = {

        };

        if (search) {
            whereCondition.name = { [Op.like]: `%${search}%` };
        }
        // Fetch total count and paginated data
        const { count, rows: data } = await Images.findAndCountAll({
            where: whereCondition,
            limit,
            offset,
            order: [['createdAt', 'DESC']],
        });
        // console.log(data, "Data::")
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
        console.error("Error: While Getting Images Data", err);
        return res
            .status(STATUSCODE.INTERNAL_SERVER_ERROR)
            .json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
}

const gettingSuperAdminUserList = async (req, res) => {
    try {
        const admin_id = req.user
        console.log(admin_id, "Admin")
        const getData = await superAdminModel.findOne({ where: { id: admin_id, role: "Admin" } })
        console.log(getData, "dta::::::")
        if (!getData) return res.json(error("Not Authorised User", STATUSCODE.UNAUTHORIZED))
        const list = await superAdminModel.findAll({ where: { role: "User" }, attributes: ['name', 'id'] })
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { list }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err, "whitel getting user list")
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

const addWhatsAppTempate = async (req, res) => {
    try {
        const { template_name, language, category, components } = req.body

        await WhatsAppTemplate.create({ template_name, language, category, components: JSON.stringify(components) })
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { message: "Template Added Successfully" }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err, "Error while adding WhatsApp Template")
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
};


const addEbillCreditBySuperAdmin = async (req, res) => {
    try {
        const admin_id = req.user;
        const { hotel_id, credit_type, ebill_count, discount } = req.body;

        if (!hotel_id || !credit_type || !ebill_count) {
            return res.json(error("hotel_id, credit_type and ebill_count are required", STATUSCODE.BAD_REQUEST));
        }

        if (!["paid", "free"].includes(credit_type)) {
            return res.json(error("credit_type must be 'paid' or 'free'", STATUSCODE.BAD_REQUEST));
        }

        const count = parseInt(ebill_count);
        if (isNaN(count) || count <= 0) {
            return res.json(error("ebill_count must be a positive number", STATUSCODE.BAD_REQUEST));
        }

        if (credit_type === "paid" && !req.file) {
            return res.json(error("Payment screenshot is required for paid credit", STATUSCODE.BAD_REQUEST));
        }

        const hotel = await Hotel.findOne({ where: { id: hotel_id } });
        if (!hotel) {
            return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST));
        }

        const rupeeValue = count * 0.25;
        const payment_screenshot = req.file ? req.file.filename : null;

        const existingCredit = await EBillCredit.findOne({ where: { hotel_id } });
        if (existingCredit) {
            await EBillCredit.update(
                { credit: existingCredit.credit + count },
                { where: { hotel_id } }
            );
        } else {
            await EBillCredit.create({ hotel_id, credit: count });
        }

        await EBillCreditDebit.create({
            hotel_id,
            credit: true,
            debit: false,
            amount: rupeeValue,
            credit_type,
            ebill_count: count,
            discount: parseFloat(discount) || 0,
            payment_screenshot,
            added_by: admin_id,
            business_date: new Date()
        });

        return res.status(STATUSCODE.SUCCESS).json(
            success(MESSAGE.SUCCESS, { message: `${count} e-bill credits added successfully` }, STATUSCODE.SUCCESS)
        );
    } catch (err) {
        console.error(err, "Error: addEbillCreditBySuperAdmin");
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

const getEbillCreditHistory = async (req, res) => {
    try {
        const { page = 1, limit = 10 } = req.query;
        const offset = (parseInt(page) - 1) * parseInt(limit);

        const { count, rows } = await EBillCreditDebit.findAndCountAll({
            where: { credit: true },
            order: [["createdAt", "DESC"]],
            limit: parseInt(limit),
            offset,
            attributes: [
                "id", "hotel_id", "credit_type", "ebill_count",
                "discount", "payment_screenshot", "amount",
                "added_by", "business_date", "createdAt"
            ]
        });

        const hotelIds = [...new Set(rows.map(r => r.hotel_id))];
        const adminIds = [...new Set(rows.map(r => r.added_by).filter(Boolean))];

        const [hotels, admins] = await Promise.all([
            Hotel.findAll({ where: { id: hotelIds }, attributes: ["id", "hotel_name", "owner_name"] }),
            SuperAdminUser.findAll({ where: { id: adminIds }, attributes: ["id", "name"] })
        ]);

        const hotelMap = Object.fromEntries(hotels.map(h => [h.id, h]));
        const adminMap = Object.fromEntries(admins.map(a => [a.id, a]));

        const data = rows.map(row => ({
            id: row.id,
            hotel_id: row.hotel_id,
            restaurant_name: hotelMap[row.hotel_id]?.hotel_name || null,
            owner_name: hotelMap[row.hotel_id]?.owner_name || null,
            credit_type: row.credit_type,
            ebill_count: row.ebill_count,
            amount: row.amount,
            discount: row.discount,
            payment_screenshot: row.payment_screenshot,
            added_by_id: row.added_by,
            added_by_name: adminMap[row.added_by]?.name || null,
            business_date: row.business_date,
            createdAt: row.createdAt
        }));

        const pagination = {
            totalRecords: count,
            totalPages: Math.ceil(count / parseInt(limit)),
            currentPage: parseInt(page)
        };

        return res.status(STATUSCODE.SUCCESS).json(
            success(MESSAGE.SUCCESS, { data, pagination }, STATUSCODE.SUCCESS)
        );
    } catch (err) {
        console.error(err, "Error: getEbillCreditHistory");
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

const uploadMenuFromExcelBySuperAdmin = async (req, res) => {
    const t = await sequelize.transaction();
    try {
        if (!req.file || !req.file.path) {
            await t.rollback();
            return res.status(400).json({ error: "No file uploaded" });
        }

        const { hotel_id } = req.body;
        if (!hotel_id) {
            await t.rollback();
            return res.status(400).json({ error: "hotel_id is required" });
        }

        const hotel = await Hotel.findOne({ where: { id: hotel_id } });
        if (!hotel) {
            await t.rollback();
            return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST));
        }

        const filePath = path.join(__dirname, "..", req.file.path);
        const fileBuffer = fs.readFileSync(filePath);

        const workbook = xlsx.read(fileBuffer, { type: "buffer" });
        const sheetName = workbook.SheetNames[0];

        const sheetData = xlsx.utils.sheet_to_json(
            workbook.Sheets[sheetName],
            { header: 1, defval: "" }
        );

        if (!sheetData.length) {
            await t.rollback();
            fs.unlinkSync(filePath);
            return res.status(400).json({ error: "Excel file is empty" });
        }

        const headers = sheetData[0];
        const rows = sheetData.slice(1);

        const jsonData = rows
            .map(row => {
                let obj = {};
                headers.forEach((key, index) => { obj[key] = row[index] || ""; });
                return obj;
            })
            .filter(row => row.category_name || row.item_name || row.price || row.shortCode);

        for (const row of jsonData) {
            const { category_name, item_name, price, shortCode, barcode_value } = row;

            if (!category_name || !item_name || !price || !shortCode) {
                await t.rollback();
                fs.unlinkSync(filePath);
                return res.status(400).json({ error: "Missing required fields" });
            }

            let category = await Menu_categ.findOne({
                where: { menu_categ_nm: category_name, hotel_id, active: true },
                transaction: t
            });

            if (!category) {
                category = await Menu_categ.create(
                    { menu_categ_nm: category_name, hotel_id },
                    { transaction: t }
                );
            }

            const itemShortCode = await Menu.findOne({
                where: { shortCode, hotel_id, active: true },
                transaction: t
            });
            if (itemShortCode) {
                await t.rollback();
                fs.unlinkSync(filePath);
                return res.status(400).json({ error: "Item ShortCode Must Be Unique" });
            }

            const itemName = await Menu.findOne({
                where: { item_name, hotel_id, active: true, menu_categ_id: category.id },
                transaction: t
            });
            if(barcode_value){

                const checkkBarcode = await Menu.findOne({where: { barcode_value:barcode_value, hotel_id },
                    transaction: t})
                    if(checkkBarcode){
                    await t.rollback();
                    fs.unlinkSync(filePath);
                    return res.status(400).json({ error: `Barcode Value must be Unique` });
                    }
            }
            if (itemName ) {
                await t.rollback();
                fs.unlinkSync(filePath);
                return res.status(400).json({ error: `Item ${itemName.item_name} Already Available` });
            }

            await Menu.create(
                {
                    item_name,barcode_value:barcode_value??"",
                    price,
                    shortCode,
                    menu_categ_id: category.id,
                    description: item_name,
                    gst_type: "S",
                    sub_categories: "regular",
                    hotel_id
                },
                { transaction: t }
            );
        }

        await t.commit();
        fs.unlinkSync(filePath);
        await Hotel.update({ menu_uploaded: true }, { where: { id: hotel_id } });

        const menuKey = `hotel:${hotel_id}:menu`;
        const categoryKey = `hotel:${hotel_id}:menu_category`;

        await redisClient.del(menuKey);
        await redisClient.del(categoryKey);

        const menuByCategorys = await Menu_categ.findAll({
            where: { hotel_id, active: true }
        });

        const menus = await Menu.findAll({
            where: { hotel_id, active: true },
            include: [
                { model: Menu_categ },
                { model: Variants, as: "variantData", where: { active: true }, required: false },
                { model: AddonDepartment, as: "addonDepartmentData", include: { model: Addons } }
            ]
        });

        await redisClient.set(categoryKey, JSON.stringify(menuByCategorys), { EX: 172800 });
        await redisClient.set(menuKey, JSON.stringify(menus), { EX: 172800 });

        return res.status(STATUSCODE.SUCCESS).json(
            success(MESSAGE.SUCCESS, { message: "Menu uploaded & cache refreshed successfully" }, STATUSCODE.SUCCESS)
        );

    } catch (err) {
        console.error(err);
        await t.rollback();
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

module.exports = { addEbillCreditBySuperAdmin, getEbillCreditHistory, uploadMenuFromExcelBySuperAdmin, gettingSuperAdminUserList, updateInqueryStatus, addImage, getProductImages, editProduct, addProduct, gettingPrinterRollOrders, updateOrderStatus, menuUploadedAndTrainingStatus, deleteAddAdminResto, renewAdminSubscription, makePayment, gettingPeddingAddRestoDetails, saveAndNext, superAdminLogOut, superAdminDashBoardData, superAdminNewClientGraph, gettingupcomingRenuale, singleHotelSP, AllInquiry, restaurantDetails, superAdminLogin, checkSuperAdmin }