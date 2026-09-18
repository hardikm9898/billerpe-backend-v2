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
const { getNextBillNo } = require("../../helpers/billNumber");

const UserAccess = require("../../model/userAccess");
const TableBooking = require("../../model/tablebooking");
const EBillCredit = require("../../model/ebillCredit");
const LocalServerRegistration = require("../../model/localServerRegistration");
const Recipes = require("../../model/recipes");
const SemiFinishedItem = require("../../model/semiFinishedItem");
const SemiFinishedRecipe = require("../../model/semiFinishedRecipe");
const ExpenseHead = require("../../model/expenseHead");
const ExpenseEntry = require("../../model/expenseEnty");
const CashSession = require("../../model/cashSession");
const CashMovement = require("../../model/cashMovement");
const PromoCode = require("../../model/promoCode");
const Westage = require("../../model/Inventory/westage");
const PurchaseOrder = require("../../model/Inventory/purchaseOrder");
const PurchaseOrderPayment = require("../../model/Inventory/purchaseOrderPayment");
const Supplier = require("../../model/Inventory/supplyer");
const Unit = require("../../model/unit");
const RawMaterial = require("../../model/rawItem");

const HotelUser = require("../../model/hotelUser");
const Role = require("../../model/role_mst");
const MenuCatalog = require("../../model/menuCatalog");
const PaymentMode = require("../../model/paymentMode");
const BillChargeRule = require("../../model/billChargeRule");
const NotificationSetting = require("../../model/notificationSetting");
const RolePermissionDefault = require("../../model/rolePermissionDefault");

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

        let userAccess = await HotelUser.findOne({
            where: { id: req.userId },
            attributes: { exclude: ["password", "pin", "refresh_token"] },
            include: [{ model: UserAccess }, { model: Role }],
        })


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
        // Was dead code: hardcoded to `[]` with the real query commented out
        // (previously behind a since-removed Redis cache). This meant no
        // Local EXE ever pulled real Role rows down - cloudPull.js's
        // "hotelUser" step then backfilled a placeholder `role_name: "U"`
        // for every role_cd it saw, so every synced HotelUser's real role
        // (e.g. "A"/Admin for a hotel's owner) was silently replaced with
        // "U" on the EXE, regardless of what the cloud actually had.
        const roles = await Role.findAll({ where: { hotel_id: req.user } })
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { roles }, STATUSCODE.SUCCESS))
    } catch (err) {
        //console.log(err)
        createLogFile(req.user, `getting offlineRoles/err Error`, err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
// Pull-down source for cloudPull.js's new "menuCatalogs" step (task 10,
// Multi Menu backend support) - Menu_categ/Variants/AddonDepartment rows
// pulled in the steps right after this one carry a menu_catalog_id that FK-
// references these rows, so this has to run and land locally first, same
// ordering reason offlineRoles runs before the hotelUser pull.
const offlineMenuCatalog = async (req, res) => {
    try {
        const hotel = await Hotel.findOne({ where: { id: req.user } });
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.NOT_FOUND));
        const menuCatalogs = await MenuCatalog.findAll({ where: { hotel_id: req.user, active: true } })
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { menuCatalogs }, STATUSCODE.SUCCESS))
    } catch (err) {
        createLogFile(req.user, `getting offlineMenuCatalog/err Error`, err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
// Pull-down source for cloudPull.js's new "paymentModes" step (Payment
// Modes config backend build).
const offlinePaymentMode = async (req, res) => {
    try {
        const hotel = await Hotel.findOne({ where: { id: req.user } });
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.NOT_FOUND));
        const paymentModes = await PaymentMode.findAll({ where: { hotel_id: req.user } })
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { paymentModes }, STATUSCODE.SUCCESS))
    } catch (err) {
        createLogFile(req.user, `getting offlinePaymentMode/err Error`, err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
// Pull-down source for cloudPull.js's new "billChargeRules" step
// (Delivery/Packaging charge rules backend build).
const offlineBillChargeRule = async (req, res) => {
    try {
        const hotel = await Hotel.findOne({ where: { id: req.user } });
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.NOT_FOUND));
        const rules = await BillChargeRule.findAll({ where: { hotel_id: req.user } })
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { rules }, STATUSCODE.SUCCESS))
    } catch (err) {
        createLogFile(req.user, `getting offlineBillChargeRule/err Error`, err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
// Pull-down source for cloudPull.js's new "notificationSettings" step.
const offlineNotificationSetting = async (req, res) => {
    try {
        const hotel = await Hotel.findOne({ where: { id: req.user } });
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.NOT_FOUND));
        const settings = await NotificationSetting.findAll({ where: { hotel_id: req.user } })
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { settings }, STATUSCODE.SUCCESS))
    } catch (err) {
        createLogFile(req.user, `getting offlineNotificationSetting/err Error`, err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
// Pull-down source for cloudPull.js's new "rolePermissionDefaults" step
// (Rich Permissions role-defaults backend build).
const offlineRolePermissionDefault = async (req, res) => {
    try {
        const hotel = await Hotel.findOne({ where: { id: req.user } });
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.NOT_FOUND));
        const defaults = await RolePermissionDefault.findAll({ where: { hotel_id: req.user } })
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { defaults }, STATUSCODE.SUCCESS))
    } catch (err) {
        createLogFile(req.user, `getting offlineRolePermissionDefault/err Error`, err);
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
        let hotelUsers = await HotelUser.findAll({
            where: { hotel_id: req.user },
            attributes: { exclude: ["password", "pin", "refresh_token"] },
            include: [{ model: Role }, { model: UserAccess }],
        })

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

        // Process all orders. Sequential, NOT Promise.all - a first-time
        // sync now calls getNextBillNo (a plain "max bill_no + 1" SELECT,
        // no row locking/atomic increment) to give the order a real,
        // permanent bill number instead of keeping the exe's "OFF#"
        // placeholder forever. Two orders in the same batch racing that
        // SELECT concurrently could both read the same "current max" and
        // get assigned the SAME real bill number on two different orders -
        // a genuine billing-data-integrity bug, not just a display glitch -
        // so this loop is deliberately one order at a time now.
        const billNoByLocalId = {};
        if (allDataOrderData.length) {
            for (const cur of allDataOrderData) {
                for (const element of cur?.hms_orderDetails) {
                    allOrderDetailsData.push(element)
                }
                const { name, number } = cur.hms_user_master || {};
                const { TableId, UserId, totalAmount, gst, grandAmount, order_type, bill_no, isOffline, payment, status, payment_type = '', cash, upi, card, tip = 0, billPrintCount = 0, service_charge = 0, delivery_charge = 0, packaging_charge = 0, totalsgst = 0, totalcgst = 0, deleted, totalDiscount = 0, } = cur
                let user = await User.findOne({ where: { name: name ? name : '', number: number ? number : '', hotel_id: req.user }, transaction: t });

                if (!user) {
                    user = await User.create({ name: name ? name : '', number: number ? number : '', hotel_id: req.user }, { transaction: t });
                }

                if (cur.bill_no.startsWith('OFF') && cur.isOffline === true) {
                    // Reliable match: this exe's own local Order.id
                    // (cur.id), persisted as local_id on the cloud row the
                    // first time it's seen - see migration
                    // 20260910130000. bill_no can no longer be trusted as
                    // the match key once a first sync is allowed to
                    // replace it with a real number: a retry (or the next
                    // routine sync tick) would still be sending the exe's
                    // OLD "OFF#" value until it learns the new one back,
                    // and matching on that stale value would either miss
                    // the row entirely or, worse, match a DIFFERENT order
                    // that happens to still be numbered that way.
                    //
                    // Falls back to the old bill_no match only for rows
                    // synced before this column existed (local_id is still
                    // NULL on them) - backfills local_id onto them here so
                    // every push after this one matches reliably too,
                    // without silently renumbering a bill already
                    // shown/printed under its original "OFF#".
                    let existing = await Order.findOne({ where: { local_id: cur.id, hotel_id: req.user }, transaction: t });
                    if (!existing) {
                        existing = await Order.findOne({ where: { bill_no: cur.bill_no, hotel_id: req.user }, transaction: t });
                    }

                    if (existing) {
                        // A matched row can still be sitting on its OLD
                        // "OFF#" placeholder here - this branch used to
                        // never touch bill_no at all once a row existed,
                        // permanently stranding it on the placeholder if
                        // the FIRST sync that created it ever failed to
                        // assign a real one (confirmed live: getNextBillNo
                        // not seeing its own in-flight transaction's just-
                        // created rows, fixed above, could hand out that
                        // same stale placeholder-looking state). Give it a
                        // real number now if it still needs one, instead of
                        // carrying the bug forward on every future sync.
                        const needsRealBillNo = existing.bill_no.startsWith('OFF');
                        const realBillNo = needsRealBillNo ? String(await getNextBillNo(req.user, t)) : existing.bill_no;
                        await Order.update({ TableId, UserId: user.id, totalAmount, gst, grandAmount, order_type, payment, status, payment_type, cash, upi, card, tip, billPrintCount, service_charge, delivery_charge, packaging_charge, totalsgst, totalcgst, deleted, totalDiscount, hotel_id: req.user, isOffline: false, local_id: cur.id, ...(needsRealBillNo ? { bill_no: realBillNo } : {}) }, { where: { id: existing.id }, transaction: t });
                        await OrderDetails.destroy({ where: { orderId: existing.id }, transaction: t });
                        orderIds[cur.id] = existing.id;
                        billNoByLocalId[cur.id] = realBillNo;
                    }
                    else {
                        const realBillNo = String(await getNextBillNo(req.user, t));
                        const order = await Order.create({ TableId, UserId: user.id, totalAmount, gst, grandAmount, order_type, bill_no: realBillNo, payment, status, payment_type, cash, upi, card, tip, billPrintCount, service_charge, delivery_charge, packaging_charge, totalsgst, totalcgst, deleted, totalDiscount, hotel_id: req.user, isOffline: false, local_id: cur.id }, { transaction: t });
                        orderIds[cur.id] = order.id;
                        billNoByLocalId[cur.id] = realBillNo;
                    }
                }

                else {
                    // The order already has a real bill_no, meaning some
                    // PRIOR sync already created its row here - but cur.id
                    // is billerpe-local-exe's own LOCAL order id, not this
                    // database's primary key (two separate, unrelated
                    // autoincrement counters, same "local id vs cloud id"
                    // problem the `if` branch above already accounts for
                    // via local_id). This used to do
                    // `where: { id: cur.id }` as if the two ids were
                    // interchangeable - correct only by coincidence, wrong
                    // the rest of the time: the update silently matched
                    // zero rows, then the tax-insert step below tried to
                    // insert hms_order_tax_msts rows referencing an
                    // hmsOrderMstId that doesn't exist in this table,
                    // tripping its foreign key constraint and rolling back
                    // the ENTIRE batch (every other order in the same sync
                    // tick too, since this is all one transaction) -
                    // confirmed live as the actual cause of orders sitting
                    // unsynced for days, which in turn stalled
                    // billerpe-local-exe's own offline-duration clock (it
                    // only resets when a FULL sync tick - push AND pull -
                    // succeeds).
                    let existing = await Order.findOne({ where: { local_id: cur.id, hotel_id: req.user }, transaction: t });
                    if (!existing) {
                        // Rows synced before the local_id column existed
                        // have it NULL - same fallback the `if` branch
                        // above already relies on.
                        existing = await Order.findOne({ where: { id: cur.id, hotel_id: req.user }, transaction: t });
                    }

                    if (existing) {
                        await Order.update({ TableId, UserId: user.id, totalAmount, gst, grandAmount, order_type, bill_no, payment, status, payment_type, cash, upi, card, tip, billPrintCount, service_charge, delivery_charge, packaging_charge, totalsgst, totalcgst, deleted, totalDiscount, hotel_id: req.user, isOffline: false, local_id: cur.id }, { where: { id: existing.id }, transaction: t });
                        await OrderDetails.destroy({ where: { orderId: existing.id }, transaction: t });
                        orderIds[cur.id] = existing.id;
                    } else {
                        // Genuinely never seen before despite already
                        // carrying a real bill_no (shouldn't normally
                        // happen - a real bill_no is only ever first
                        // assigned by the `if` branch above) - create
                        // fresh rather than silently drop the order.
                        const order = await Order.create({ TableId, UserId: user.id, totalAmount, gst, grandAmount, order_type, bill_no, payment, status, payment_type, cash, upi, card, tip, billPrintCount, service_charge, delivery_charge, packaging_charge, totalsgst, totalcgst, deleted, totalDiscount, hotel_id: req.user, isOffline: false, local_id: cur.id }, { transaction: t });
                        orderIds[cur.id] = order.id;
                    }
                    billNoByLocalId[cur.id] = bill_no;
                }
            }
        }
        // Process all order taxes - previously not handled here at all
        // (billerpe-local-exe/services/cloudSync.js's own comment on
        // hms_orderTax explains why: this endpoint had zero tax handling,
        // so an order's taxes never made it to the cloud even once cart.
        // taxes started carrying real values). Destroy-then-recreate per
        // order, same pattern as OrderDetails above and for the same
        // reason - a re-synced order (another KOT round, a re-bill) must
        // not just keep piling up duplicate rows on every push.
        for (const cur of allDataOrderData) {
            const realOrderId = orderIds[cur.id];
            if (!realOrderId) continue;
            await OrderTax.destroy({ where: { hmsOrderMstId: realOrderId, hotel_id: req.user }, transaction: t });
            if (cur.hms_orderTax?.length) {
                await OrderTax.bulkCreate(
                    cur.hms_orderTax.map((tx) => ({
                        amount: tx.amount, tax_type: tx.tax_type, tax_value: tx.tax_value,
                        hmsOrderMstId: realOrderId, hmsTaxTypeMstId: tx.hmsTaxTypeMstId, hotel_id: req.user,
                    })),
                    { transaction: t },
                );
            }
        }

        // //console.log(orderIds, "Orderids--=s skd")
        // Process all order details
        if (allOrderDetailsData.length) {
            const orderDetails = allOrderDetailsData.map(async (cur) => {
                const { orderId, qty, order_type, price, kotNumber, totalDiscount, status, payment_status, UserId, TableId, MenuId } = cur
                // const userId = userMap.get(`${cur.hms_user_master.name}-${cur.hms_user_master.number}`);
                try {
                    await OrderDetails.create({ orderId: orderIds[orderId], qty, order_type, price, kotNumber, totalDiscount, status, payment_status, hotel_id: req.user, TableId, MenuId }, { transaction: t });
                } catch (detailErr) {
                    // A single bad line item used to throw here, rolling
                    // back this WHOLE transaction - every order and every
                    // OTHER order's line items in the same batch, not just
                    // this one bad line. Confirmed live as the actual
                    // mechanism behind "orders stuck on OFF# and not
                    // syncing at all": one order whose MenuId pointed at a
                    // menu item the exe had created locally and offline
                    // poisoned every sync attempt for the whole hotel,
                    // forever, since the same bad line came back in every
                    // retry - Menu/Menu_categ/MenuCatalog had no push-to-
                    // cloud path at all at the time. Task 10 gave the whole
                    // menu domain a real push path (services/
                    // cloudPushOperations.js, exe side) and MenuId now
                    // arrives here already translated to its real cloud id
                    // (services/cloudSync.js#buildSyncPayload) - this
                    // try/catch stays as defense-in-depth (a menu push that
                    // itself failed, a genuinely deleted item, etc.), not
                    // as the primary fix anymore. Skipping just this one
                    // line lets every valid order (bill number included)
                    // still go through; the skipped line stays visible as
                    // a real, loud log entry instead of a silent gap.
                    createLogFile(req.user, `syncOrderDataWithDataBase: skipped one OrderDetails row (orderId=${orderId}, MenuId=${MenuId}) - `, detailErr);
                }
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

        // Device-liveness heartbeat (piggybacked, not a new request): this
        // endpoint already fires every 60s from the exe's own sync tick
        // regardless of whether there's anything to push (confirmed live -
        // most ticks now send 0 orders since the pull-efficiency pass made
        // push incremental too), so it's the natural place to keep
        // LocalServerRegistration.last_seen_at genuinely live instead of
        // frozen at whatever it was at registration time - confirmed that
        // was the ONLY place it ever got touched before this, making every
        // "active" device registration look identical whether the exe was
        // actually running or had been crashed/off for days. Deliberately
        // fire-and-forget (no await on the response) - a heartbeat write
        // failing should never fail the actual sync it's riding along with.
        LocalServerRegistration.update(
            { last_seen_at: new Date() },
            { where: { hotel_id: req.user, status: "active" } },
        ).catch((err) => console.error("[offline] heartbeat update failed:", err.message));

        // Keyed by the exe's own local Order.id (never the cloud's) - see
        // cloudSync.js's own handling of this, which writes the real
        // bill_no back onto the matching local row so the exe stops
        // showing "OFF#" for it on every future screen, not just the
        // cloud's own copy.
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { message: "Data Uploaded", billNumbers: billNoByLocalId }, STATUSCODE.SUCCESS));
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
//                 const { TableId, UserId, totalAmount, gst, grandAmount, order_type, bill_no, isOffline, payment, status, payment_type = '', cash, upi, card, tip = 0, totalsgst = 0, totalcgst = 0, deleted, totalDiscount = 0, } = cur
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

// GET /offlineSyncManifest - one lightweight request the local exe can poll
// instead of blindly calling all ~10 offline* endpoints every tick (each of
// those returns a full, potentially-large row set - confirmed live as real
// per-restaurant request volume that doesn't scale to 1000+ locations on a
// timer). Reports MAX(updatedAt) per entity for this hotel so the exe can
// compare against what it last actually pulled and only call the full
// endpoint for whatever genuinely changed - see billerpe-local-exe's
// services/cloudPull.js for the consuming side.
//
// Deliberately queries live, not the redis cache the full offline* handlers
// use (redisClient.exists/get with a 48h TTL) - a stale cache would make
// "nothing changed" look true for up to 48h after a real edit, exactly the
// kind of missed-update bug this manifest exists to prevent.
//
// Not scoped by the `active`/`hotel_id` filters the real data endpoints
// apply (e.g. offlineMenuCateg's `active: true`) - deactivating the last
// active row is still a real change the exe needs to notice, so every row
// for this hotel counts here regardless of its active flag.
const getOfflineSyncManifest = async (req, res) => {
    try {
        const hotel = await Hotel.findOne({ where: { id: req.user } });
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.NOT_FOUND));

        const maxUpdatedAt = async (Model) => {
            const row = await Model.findOne({
                where: { hotel_id: req.user },
                attributes: [[sequelize.fn("MAX", sequelize.col("updatedAt")), "maxUpdatedAt"]],
                raw: true,
            });
            return row?.maxUpdatedAt || null;
        };

        // CashMovement has no hotel_id of its own (only cashSessionId ->
        // CashSession -> hotel_id) - the only entity here that needs two
        // steps instead of one direct where clause. (A single join+MAX
        // query works too, but MySQL rejects the aggregate column as
        // ambiguous between the two tables' updatedAt no matter how it's
        // qualified in Sequelize's raw/attributes API - a plain subquery
        // sidesteps that entirely instead of fighting the query builder.)
        const maxUpdatedAtViaCashSession = async () => {
            const sessionIds = (await CashSession.findAll({ where: { hotel_id: req.user }, attributes: ["id"], raw: true })).map((s) => s.id);
            if (!sessionIds.length) return null;
            const row = await CashMovement.findOne({
                where: { cashSessionId: { [Op.in]: sessionIds } },
                attributes: [[sequelize.fn("MAX", sequelize.col("updatedAt")), "maxUpdatedAt"]],
                raw: true,
            });
            return row?.maxUpdatedAt || null;
        };

        const [
            menuCateg, menu, tableCateg, table, roles, hotelUser, userAccess, printerSetting, invoiceFormate, ebillCredit,
            units, rawMaterials,
            recipes, semiFinishedItems, semiFinishedRecipes, expenseHeads, expenseEntries,
            cashSessions, cashMovements, promoCodes, wastage, purchaseOrders, purchaseOrderPayments, suppliers,
        ] = await Promise.all([
            maxUpdatedAt(Menu_categ),
            maxUpdatedAt(Menu),
            maxUpdatedAt(TableCatagories),
            maxUpdatedAt(Table),
            maxUpdatedAt(Role),
            maxUpdatedAt(HotelUser),
            maxUpdatedAt(UserAccess),
            maxUpdatedAt(PrinterSetting),
            maxUpdatedAt(InvoiceFormate),
            maxUpdatedAt(EBillCredit),
            // Stock master data (Unit/RawMaterial) - not one of Task 2's
            // named 8 entities, but a real FK dependency discovered by
            // testing: SemiFinishedItem/Recipes/Westage all reference
            // unit_id/raw_material_id, which never had a pull path at all
            // (Task 1 only routed stock's WRITE paths through the exe, it
            // never built pull sync for the master data itself) - without
            // these two, every one of those pulls fails FOREIGN KEY
            // constraint checks the moment the referenced id doesn't
            // already exist locally.
            maxUpdatedAt(Unit),
            maxUpdatedAt(RawMaterial),
            maxUpdatedAt(Recipes),
            maxUpdatedAt(SemiFinishedItem),
            maxUpdatedAt(SemiFinishedRecipe),
            maxUpdatedAt(ExpenseHead),
            maxUpdatedAt(ExpenseEntry),
            maxUpdatedAt(CashSession),
            maxUpdatedAtViaCashSession(),
            maxUpdatedAt(PromoCode),
            maxUpdatedAt(Westage),
            maxUpdatedAt(PurchaseOrder),
            maxUpdatedAt(PurchaseOrderPayment),
            maxUpdatedAt(Supplier),
        ]);

        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, {
            manifest: {
                menuCateg, menu, tableCateg, table, roles, hotelUser, userAccess, printerSetting, invoiceFormate, ebillCredit,
                units, rawMaterials,
                recipes, semiFinishedItems, semiFinishedRecipes, expenseHeads, expenseEntries,
                cashSessions, cashMovements, promoCodesFull: promoCodes, wastage, purchaseOrders, purchaseOrderPayments, suppliers,
            },
        }, STATUSCODE.SUCCESS));
    } catch (err) {
        createLogFile(req.user, `getting offlineSyncManifest/err Error`, err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

module.exports = { gettingAllRestaurantWhichIsTakenGst, offlineOnlineOrder, fetchAllData, syncOrderDataWithDataBase, offlineRoles, offlineMenuCatalog, offlinePaymentMode, offlineBillChargeRule, offlineNotificationSetting, offlineRolePermissionDefault, offlineUserAccess, offlineTableBooking, offlinePrinterSetting, offlineInvoiceFormate, offlineHotelUser, offlineUser, offlineOrdersDetails, offlineOrders, offlineTableCateg, offlineTable, offlineMenuCateg, offlineMenu, getOfflineSyncManifest }