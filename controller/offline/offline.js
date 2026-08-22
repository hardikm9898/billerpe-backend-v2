const Order = require("../../model/order");
const Item = require("../../model/menu");
const AdminCart = require("../../model/adminCart");
const path = require("path");

const { STATUSCODE, MESSAGE, STATUS, ORDER_TYPE, ORDER_DETAILS_TYPE } = require("../../constant/const");
const { error, success } = require("../../responce/res");
const Menu = require("../../model/menu")
const Table = require("../../model/table");
const User = require("../../model/user")
const OrderDetails = require("../../model/order_details")
const Hotel = require("../../model/hotel")
const fs = require("fs")
const moment = require("moment")
const puppeteer = require("puppeteer")
const TableCatagories = require("../../model/table_catg");
const { createLogFile } = require("../../logs/log");
const InvoiceFormate = require("../../model/invoiceFormate");
const PrinterSetting = require("../../model/printer_setting");
const sequelize = require("../../connection/connect");
const Menu_categ = require("../../model/menu_categ");

const UserAccess = require("../../model/userAccess");
const TableBooking = require("../../model/tablebooking");

const HotelUser = require("../../model/hotelUser");
const Role = require("../../model/role_mst");

const { Json } = require("sequelize/lib/utils");
const OnlineOrders = require("../../model/onlineOrder");
const OnlineOrderDetails = require("../../model/onlineOrderDetails");
const { Op } = require("sequelize");
const MenuVariants = require("../../model/menu_variant");
const Variants = require("../../model/variants");
const AddonDepartment = require("../../model/addonDepartMent");
const Addons = require("../../model/addons");
const MenuAddon = require("../../model/menu_addons");
const redisClient = require("../../connection/redis");
const TaxType = require("../../model/taxType");
const OrderTax = require("../../model/orderTax");
const Subscription = require("../../model/subscription/subscription");
const SubscriptionPayment = require("../../model/subscription/subscriptionPayment");
const CryptoJS = require("crypto-js");
const dotenv = require("dotenv");

dotenv.config();
const SECRET_KEY = process.env.DESECRET_KEY || "MY_SECRET_KEY";

const encryptData = (data) => {
    return CryptoJS.AES.encrypt(JSON.stringify(data), SECRET_KEY).toString();
};

const offlineUserAccess = async (req, res) => {
    try {

        const hotel = await Hotel.findOne({ where: { id: req.user } });
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.NOT_FOUND));

        let userAccess = await HotelUser.findOne({ where: { id: req.userId }, include: [{ model: UserAccess }, { model: Role }] })


        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { userAccess }, STATUSCODE.SUCCESS))
    } catch (err) {
        //console.log(err)
        createLogFile(req.user, `getting offlineUserAccess/err Error`, err);

        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const offlineRoles = async (req, res) => {
    try {
        const hotel = await Hotel.findOne({ where: { id: req.user } });
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.NOT_FOUND));
        let roles = []
        // const exists = await redisClient.exists(`hotel:${req.user}:role`);
        // // const exists = flase;
        // if (exists) {
        //     //console.log("Redis Data Get,role");
        //     //console.log(new Date(), "start")
        //     const value = await redisClient.get(`hotel:${req.user}:role`);
        //     roles = JSON.parse(value);
        //     //console.log(new Date(), "end")

        // } else {

        //     // userAccess = await HotelUser.findOne({ where: { id: req.userId }, include: [{ model: UserAccess }, { model: Role }] })
        //     roles = await Role.findAll({ where: { hotel_id: req.user } })
        //     await redisClient.set(`hotel:${req.user}:role`, JSON.stringify(roles), { EX: 600 })
        // }
        // //console.log(roles)
        // const userAccess = await UserAccess.findAll({ where: { id: req.userId }, include: [{ model: UserAccess }, { model: Role }] } })
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { roles }, STATUSCODE.SUCCESS))
    } catch (err) {
        //console.log(err)
        createLogFile(req.user, `getting offlineRoles/err Error`, err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const offlineTableBooking = async (req, res) => {
    try {
        const hotel = await Hotel.findOne({ where: { id: req.user } });
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.NOT_FOUND));

        const tableBooking = await TableBooking.findAll({ where: { hotel_id: req.user }, include: [{ model: Table }, { model: User }] })
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { tableBooking }, STATUSCODE.SUCCESS))
    } catch (err) {
        //console.log(err)
        createLogFile(req.user, `getting offlineTableBooking/err Error`, err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const offlinePrinterSetting = async (req, res) => {
    try {
        const hotel = await Hotel.findOne({ where: { id: req.user } });
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.NOT_FOUND));
        let printerSettings = await PrinterSetting.findAll({ where: { hotel_id: req.user } })

        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { printerSettings }, STATUSCODE.SUCCESS))
    } catch (err) {
        //console.log(err)
        createLogFile(req.user, `getting offlinePrinterSetting/err Error`, err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const offlineInvoiceFormate = async (req, res) => {
    try {
        const hotel = await Hotel.findOne({ where: { id: req.user } });
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.NOT_FOUND));
        let invoiceFormate = await InvoiceFormate.findAll({ where: { hotel_id: req.user } })

        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { invoiceFormate }, STATUSCODE.SUCCESS))
    } catch (err) {
        //console.log(err)
        createLogFile(req.user, `getting offlineInvoiceFormate/err Error`, err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

const offlineHotelUser = async (req, res) => {
    try {
        const hotel = await Hotel.findOne({ where: { id: req.user } });
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.NOT_FOUND));
        let hotelUsers = await HotelUser.findAll({ where: { hotel_id: req.user }, include: [{ model: Role }, { model: UserAccess }] })

        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { hotelUsers }, STATUSCODE.SUCCESS))
    } catch (err) {
        //console.log(err)
        createLogFile(req.user, `getting offlineHotelUser/err Error`, err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

const offlineUser = async (req, res) => {
    try {
        const hotel = await Hotel.findOne({ where: { id: req.user } });
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.NOT_FOUND));
        let users = await User.findAll({ where: { hotel_id: req.user } })

        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { users }, STATUSCODE.SUCCESS))
    } catch (err) {
        //console.log(err)
        createLogFile(req.user, `getting offlineUser/err Error`, err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

const offlineOrdersDetails = async (req, res) => {
    try {
        const hotel = await Hotel.findOne({ where: { id: req.user } });
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.NOT_FOUND));
        createLogFile(req.user, "138 On offline.js", { where: { hotel_id: req.user }, include: { model: Menu, include: { model: Menu_categ } } });
        const exists = await redisClient.exists(`hotel:${req.user}:orderDetails`);
        // const exists = flase;
        let orderDetails = []
        if (exists) {
            //  //console.log("Redis Data Get");
            const value = await redisClient.get(`hotel:${req.user}:orderDetails`);
            orderDetails = JSON.parse(value);
        } else {

            orderDetails = await OrderDetails.findAll({ where: { hotel_id: req.user }, include: { model: Menu, include: { model: Menu_categ } } })
            await redisClient.set(`hotel:${req.user}:orderDetails`, JSON.stringify(orderDetails), { EX: 172800 })
        }
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { orderDetails }, STATUSCODE.SUCCESS))

    } catch (err) {
        //console.log(err)
        createLogFile(req.user, `getting offlineOrdersDetails/err Error`, err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

const offlineOrders = async (req, res) => {
    try {
        const { startDate, endDate } = req.body
        const hotel = await Hotel.findOne({ where: { id: req.user } });
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.NOT_FOUND));
        let orders
        const exists = await redisClient.exists(`hotel:${req.user}:orders`);
        // const exists = flase;
        if (exists) {
            //console.log("Redis Data Get order");
            const value = await redisClient.get(`hotel:${req.user}:orders`);
            orders = JSON.parse(value);

        } else {

            orders = await Order.findAll({
                where: {
                    hotel_id: req.user,
                    deleted: false,
                    payment: {
                        [Op.ne]: STATUS.SUCCESS
                    }
                },
                include: [
                    {
                        model: Table, where: { active: true }, required: false,
                        include: { model: TableCatagories, where: { active: true }, required: false }
                    },
                    {
                        model: User
                    },
                    {
                        model: OrderDetails,
                        include: [
                            {
                                model: Menu,
                                include: { model: Menu_categ }
                            },
                            {
                                model: Variants,
                                as: "variantData"
                            }
                        ]
                    }
                ],
                order: [['createdAt', 'DESC']]
            });
            // console.log(orders, "Orders::::")
            // return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
            await redisClient.set(`hotel:${req.user}:orders`, JSON.stringify(orders), { EX: 172800 })
        }
        //console.log(new Date(), "end")
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { orders }, STATUSCODE.SUCCESS))
    } catch (err) {
        //console.log(err)
        createLogFile(req.user, `getting offlineOrders/err Error`, err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

const offlineTableCateg = async (req, res) => {
    try {
        const hotel = await Hotel.findOne({ where: { id: req.user } });
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.NOT_FOUND));

        let tableCatagories = []
        const exists = await redisClient.exists(`hotel:${req.user}:tableCategory`);
        if (exists) {
            //console.log("Redis Data Get table Categ");
            //console.log(new Date(), "start")
            const value = await redisClient.get(`hotel:${req.user}:tableCategory`);
            tableCatagories = JSON.parse(value);
            //console.log(new Date(), "end")

        } else {
            // tableCatagories = await PrinterSetting.findAll({ where: { hotel_id: req.user } })
            tableCatagories = await TableCatagories.findAll({ where: { hotel_id: req.user, active: true }, include: { model: Table, required: false, where: { active: true }, include: { model: TableCatagories, required: false } } })
            await redisClient.set(`hotel:${req.user}:tableCategory`, JSON.stringify(tableCatagories), { EX: 172800 })
        }
        // console.log(tableCatagories.filter(el => el.table_catag_nm === "Outdoor")[0].hms_table_msts.filter(el => el.table_name == '5' || el.table_name === "2"))
        // const categoriies = JSON.parse(JSON.stringify(tableCatagories))
        // for (const element of categoriies) {
        //     // //console.log(element.hms_table_msts)
        // }
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { tableCatagories }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err)
        createLogFile(req.user, `getting offlineTableCateg/err Error`, err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

const offlineTable = async (req, res) => {
    try {
        const hotel = await Hotel.findOne({ where: { id: req.user } });
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.NOT_FOUND));
        let tables = []
        const exists = await redisClient.exists(`hotel:${req.user}:table`);

        if (exists) {
            //console.log("Redis Data Get table");
            //console.log(new Date(), "start")
            const value = await redisClient.get(`hotel:${req.user}:table`);
            tables = JSON.parse(value);
            //console.log(tables, "Updated Data")

        } else {
            // tables = await PrinterSetting.findAll({ where: { hotel_id: req.user } })
            tables = await Table.findAll({ where: { hotel_id: req.user, active: true }, include: { model: TableCatagories, where: { active: true } }, required: true })
            await redisClient.set(`hotel:${req.user}:table`, JSON.stringify(tables), { EX: 172800 })
        }
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { tables }, STATUSCODE.SUCCESS))
    } catch (err) {
        //console.log(err)
        createLogFile(req.user, `getting offlineTable/err Error`, err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

const offlineMenuCateg = async (req, res) => {
    try {
        const hotel = await Hotel.findOne({ where: { id: req.user } });
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.NOT_FOUND));
        let menuByCategorys = []
        const exists = await redisClient.exists(`hotel:${req.user}:menu_category`);

        if (exists) {
            //console.log("Redis Data Get menu categ");
            //console.log(new Date(), "start")
            const value = await redisClient.get(`hotel:${req.user}:menu_category`);
            menuByCategorys = JSON.parse(value);
            //console.log(new Date(), "end")

        } else {
            // printerSettings = await PrinterSetting.findAll({ where: { hotel_id: req.user } })
            menuByCategorys = await Menu_categ.findAll({ where: { hotel_id: req.user, active: true } })
            await redisClient.set(`hotel:${req.user}:menu_category`, JSON.stringify(menuByCategorys), { EX: 172800 })
        }
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { menuByCategorys }, STATUSCODE.SUCCESS))
    } catch (err) {
        //console.log(err)
        createLogFile(req.user, `getting offlineMenuCateg/err Error`, err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}


const offlineMenu = async (req, res) => {
    try {
        const hotel = await Hotel.findOne({ where: { id: req.user } });
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.NOT_FOUND));
        let menus = []
        const exists = await redisClient.exists(`hotel:${req.user}:menu`);

        if (exists) {
            const value = await redisClient.get(`hotel:${req.user}:menu`);
            menus = JSON.parse(value);
        } else {
            // printerSettings = await PrinterSetting.findAll({ where: { hotel_id: req.user } })
            menus = await Menu.findAll({ where: { hotel_id: req.user, active: true }, include: [{ model: Menu_categ }, { model: Variants, as: "variantData", where: { active: true }, required: false }, { model: AddonDepartment, as: "addonDepartmentData", include: { model: Addons } }] })
            await redisClient.set(`hotel:${req.user}:menu`, JSON.stringify(menus), { EX: 172800 })
        }
        const encryptedData = encryptData({
            menus
        });
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { encryptedData }, STATUSCODE.SUCCESS))
    } catch (err) {
        //console.log(err)
        createLogFile(req.user, `getting offlineMenu/err Error`, err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

const offlineOnlineOrder = async (req, res) => {
    try {

        const hotel = await Hotel.findOne({ where: { id: req.user } });
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.NOT_FOUND));
        let onlineOrders = []
        // if (hotel.active_zomato) {
        //     onlineOrders = await OnlineOrders.findAll({ where: { hotel_id: req.user, }, include: { model: OnlineOrderDetails } })
        // }
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { onlineOrders }, STATUSCODE.SUCCESS))

    } catch (err) {
        //console.error(err);
        createLogFile(req.user, `getting offlineOnlineOrder/err Error`, err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
}

const syncOrderDataWithDataBase = async (req, res) => {
    const t = await sequelize.transaction();
    try {
        // //console.log(req.body);

        // //console.log(req.body.data, "req body--------------------------->")
        const { allDataOrderData, allDataTableCategoryData, allDataTableData } = JSON.parse(req.body.data)
        // Create a map to store user IDs
        const allOrderDetailsData = []
        // Create a map to store order IDs
        const orderIds = {};

        // Process all orders
        if (allDataOrderData.length) {
            const users = allDataOrderData.map(async (cur) => {

                for (const element of cur?.hms_orderDetails) {
                    allOrderDetailsData.push(element)
                }
                const { name, number } = cur.hms_user_master || {};
                const { TableId, UserId, totalAmount, gst, grandAmount, order_type, bill_no, isOffline, payment, status, payment_type = '', cash, upi, card, totalsgst = 0, totalcgst = 0, deleted, totalDiscount = 0, } = cur
                let user = await User.findOne({ where: { name: name ? name : '', number: number ? number : '', hotel_id: req.user }, transaction: t });;

                // if (!user) {
                if (!user) {
                    user = await User.create({ name: name ? name : '', number: number ? number : '', hotel_id: req.user }, { transaction: t });
                }
                // userMap.set(`${name}-${number}`, user.id);
                // }

                // const userId = userMap.get(`${name}-${number}`);
                if (cur.bill_no.startsWith('OFF') && cur.isOffline === true) {

                    const findOrderOffBillNo = await Order.findOne({ where: { bill_no: cur.bill_no, hotel_id: req.user } })
                    if (findOrderOffBillNo) {
                        await Order.update({ TableId, UserId: user.id, totalAmount, gst, grandAmount, order_type, bill_no, payment, status, payment_type, cash, upi, card, totalsgst, totalcgst, deleted, totalDiscount, hotel_id: req.user, isOffline: false }, { where: { id: findOrderOffBillNo.id }, transaction: t });

                        await OrderDetails.destroy({ where: { orderId: findOrderOffBillNo.id }, transaction: t });
                        orderIds[cur.id] = findOrderOffBillNo.id;
                    }
                    else {
                        const order = await Order.create({ TableId, UserId: user.id, totalAmount, gst, grandAmount, order_type, bill_no, payment, status, payment_type, cash, upi, card, totalsgst, totalcgst, deleted, totalDiscount, hotel_id: req.user, isOffline: false }, { transaction: t });
                        orderIds[cur.id] = order.id;
                    }
                }

                else {
                    await Order.update({ TableId, UserId: user.id, totalAmount, gst, grandAmount, order_type, bill_no, payment, status, payment_type, cash, upi, card, totalsgst, totalcgst, deleted, totalDiscount, hotel_id: req.user, isOffline: false }, { where: { id: cur.id }, transaction: t });
                    await OrderDetails.destroy({ where: { orderId: cur.id }, transaction: t });
                    orderIds[cur.id] = cur.id;
                }
            });
            await Promise.all(users);
        }
        // //console.log(orderIds, "Orderids--=s skd")
        // Process all order details
        if (allOrderDetailsData.length) {
            const orderDetails = allOrderDetailsData.map(async (cur) => {
                const { orderId, qty, order_type, price, kotNumber, totalDiscount, status, payment_status, UserId, TableId, MenuId } = cur
                // const userId = userMap.get(`${cur.hms_user_master.name}-${cur.hms_user_master.number}`);
                await OrderDetails.create({ orderId: orderIds[orderId], qty, order_type, price, kotNumber, totalDiscount, status, payment_status, hotel_id: req.user, TableId, MenuId }, { transaction: t });

            });
            await Promise.all(orderDetails);
        }

        // Process all table data
        // //console.log(allDataTableData)
        if (allDataTableData.length) {
            const tableUpdates = allDataTableData.map(async (cur) => {
                await Table.update({ table_status: cur.table_status || "F" }, { where: { id: cur.id }, transaction: t });
            });
            await Promise.all(tableUpdates);
        }

        // Process all table category data (if necessary)
        // if (allDataTableCategoryData.length) {
        //     const tableCategoryUpdates = allDataTableCategoryData.map(async (cur) => {
        //         await TableCategories.update(cur, { where: { id: cur.id }, transaction: t });
        //     });
        //     await Promise.all(tableCategoryUpdates);
        // }

        await t.commit();
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { message: "Data Uploaded" }, STATUSCODE.SUCCESS));
    } catch (err) {
        //console.error(err);
        await t.rollback();
        createLogFile(req.user, `getting syncOrderDataWithDataBase/err Error`, err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
}

const fetchAllData = async (req, res) => {
    try {
        const hotel = await Hotel.findOne({ where: { id: req.user } });
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.NOT_FOUND));
        // const startD = new Date(moment().subtract(7, 'days').startOf())
        // const endD = new Date(moment().endOf())
        const tables = await Table.findAll({
            where: {
                hotel_id: req.user, active: true,
            }, include: { model: TableCatagories }
        })

        const orders = await Order.findAll({
            where: {
                hotel_id: req.user, deleted: false
            }, include: [{ model: Table, include: { model: TableCatagories } }, { model: User }, { model: OrderDetails, include: { model: Menu, include: { model: Menu_categ } } }]
        })
        const tableCatagories = await TableCatagories.findAll({ where: { hotel_id: req.user, active: true }, include: { model: Table, required: false, where: { active: true }, include: { model: TableCatagories, required: false } } })
        // //console.log(orders, "All Orders--")
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { tables, tableCatagories, orders }, STATUSCODE.SUCCESS))
    } catch (err) {
        createLogFile(req.user, `getting fetchAllData/err Error`, err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

// const syncOrderDataWithDataBase = async (req, res) => {
//     const t = await sequelize.transaction()
//     try {
//         //console.log(req.body)
//         const { allDataOrderData, allOrderDetailsData, allDataTableCategoryData, allDataTableData } = JSON.parse(req.body.documents)
//         const orderIds = {}
//         const updatedOrderId = {}
//         if (allDataOrderData.length) {
//             for (const cur of allDataOrderData) {
//                 const { TableId, UserId, totalAmount, gst, grandAmount, order_type, bill_no, isOffline, payment, status, payment_type = '', cash, upi, card, totalsgst = 0, totalcgst = 0, deleted, totalDiscount = 0, } = cur
//                 const user = cur.hms_user_master
//                 let findUser = await User.findOne({ where: { name: user.name ? user.name : '', number: user.number ? user.number : '', hotel_id: req.user }, transaction: t })
//                 if (findUser) {

//                 } else {
//                     findUser = await User.create({ name: user.name ? user.name : '', number: user.number ? user.number : '', hotel_id: req.user }, { transaction: t })
//                 }
//                 //console.log({ TableId, UserId, totalAmount, gst, grandAmount, order_type, bill_no, isOffline, payment, status, payment_type, cash, upi, card, totalsgst, totalcgst, deleted, totalDiscount, })
//                 if (cur.bill_no.startsWith('OFF')) {
//                     const order = await Order.create({ TableId, UserId: findUser.dataValues.id, totalAmount, gst, grandAmount, order_type, bill_no, isOffline: false, payment, status, payment_type, cash, upi, card, totalcgst, totalsgst, totalcgst, deleted, totalDiscount, hotel_id: req.user }, { transaction: t })
//                     orderIds[cur.id] = order.id
//                 }
//                 else {
//                     await Order.update({ TableId, UserId: findUser.dataValues.id, totalAmount, gst, grandAmount, order_type, bill_no, isOffline: false, payment, status, payment_type, cash, upi, card, totalcgst, totalsgst, totalcgst, deleted, totalDiscount, hotel_id: req.user }, { where: { id: cur.id }, transaction: t })
//                     await OrderDetails.destroy({ where: { orderId: cur.id } })
//                     orderIds[cur.id] = cur.id
//                 }

//             }
//         }
//         if (allOrderDetailsData.length) {

//             for (const cur of allOrderDetailsData) {
//                 const { orderId, qty, order_type, price, kotNumber, totalDiscount, status: payment_status, UserId, TableId, MenuId } = cur
//                 const user = cur.hms_user_master
//                 let findUser = await User.findOne({ where: { hotel_id: req.user, name: user?.name ? user.name : '', number: user?.number ? user.number : '' }, transaction: t })

//                 if (findUser) {

//                 } else {
//                     findUser = await User.create({ hotel_id: req.user, name: user?.name ? user.name : '', number: user?.number ? user.number : '' }, { transaction: t })
//                 }




//                 const order = await OrderDetails.create({ hotel_id: req.user, orderId: orderIds[orderId], qty, order_type, price, kotNumber, totalDiscount, status: payment_status, TableId, MenuId }, { transaction: t })




//             }
//         }
//         // for (const cur of allDataTableCategoryData) {
//         //     await TableCatagories.update({ where: { id: cur.id } }, { cur })
//         // }
//         //console.log(orderIds, "Order Id ------------->")
//         for (const cur of allDataTableData) {
//             const { table_status } = cur

//             await Table.update({ table_status: table_status ? table_status : "F" }, { where: { id: cur.id }, transaction: t },)
//         }
//         await t.commit()
//         return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { message: "Data Uploaded" }, STATUSCODE.SUCCESS))
//     } catch (err) {
//         //console.log(err)
//         await t.rollback()
//         return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
//     }
// }


const gettingAllRestaurantWhichIsTakenGst = async (req, res) => {
    try {
        // 3. Create Subscription

        const findAllHotel = await Hotel.findAll({
            where: {
                id: 218
            }
        });

        for (const cur of findAllHotel) {

            const startDate = new Date(cur.plan_start_date || new Date());
            let endDate = new Date(cur.plan_end_date || new Date());
            const currentDate = new Date();

            // 🔹 If plan_end_date is already in the past, add 20 days
            if (endDate < currentDate) {
                endDate = new Date(currentDate); // start from today
                endDate.setDate(endDate.getDate() + 365); // add 20 days
            }

            const newSubscription = await Subscription.create({
                discountrate: 0,
                discountedvalue: 0,
                hotel_id: cur.id,
                plan_id: 2,
                start_date: startDate,
                end_date: endDate,
                subTotal: 5999,
                discount: "fix",
                gst: 0,
                gst_calculated: false,
                grandAmount: 5999,
                subscription_extend_count: 0
            });
            await SubscriptionPayment.create({
                subscription_id: newSubscription.id,
                payment_method: "cash",
                payment_date: new Date(),
                amount_paid: 5999,
                UTR_No: 123456789,
                note: "", hotel_id: cur.id
            });
        }


        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { message: "DOne::" }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log("Erro While running Script::::", err)
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }


}

module.exports = { gettingAllRestaurantWhichIsTakenGst, offlineOnlineOrder, fetchAllData, syncOrderDataWithDataBase, offlineRoles, offlineUserAccess, offlineTableBooking, offlinePrinterSetting, offlineInvoiceFormate, offlineHotelUser, offlineUser, offlineOrdersDetails, offlineOrders, offlineTableCateg, offlineTable, offlineMenuCateg, offlineMenu }