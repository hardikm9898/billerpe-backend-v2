const Order = require("../model/order");
require("dotenv").config()
const Item = require("../model/menu");

const AdminCart = require("../model/adminCart");
const qrcode = require('qrcode');
const path = require("path");

const { STATUSCODE, MESSAGE, STATUS, ORDER_TYPE, ORDER_DETAILS_TYPE, ACTION } = require("../constant/const");

const { error, success } = require("../responce/res");

const Menu = require("../model/menu");
const Table = require("../model/table");
const User = require("../model/user");
const OrderDetails = require("../model/order_details");
const Hotel = require("../model/hotel");
const fs = require("fs");
const moment = require("moment");
const puppeteer = require("puppeteer");
const { Op } = require("sequelize");
const TableCatagories = require("../model/table_catg");
const InvoiceFormate = require("../model/invoiceFormate");
const PrinterSetting = require("../model/printer_setting");
const sequelize = require("../connection/connect");
const Menu_categ = require("../model/menu_categ");
const { checkRawMaterialAvailableOrNot } = require("./recipes");
const Variants = require("../model/variants");
const TimeLine = require("../model/timeline");
const HotelUser = require("../model/hotelUser");
const Hashids = require('hashids/cjs');
const { default: axios } = require("axios");
const { log } = require("console");
const EBillCreditDebit = require("../model/ebillCreditDebit");
const EBillCredit = require("../model/ebillCredit");
const { sendKotToAllKdsClient, orderCompletedSendtoKdsCLient, otherkot, removeKotItemFromKds, descriseKotQtyItemFromKDS } = require("./kds/kds");
const OrderTax = require("../model/orderTax");
const TaxType = require("../model/taxType");
const { updateOrderAppendToRadis, newOrderAppendToRadis, updateTableToRadis, deleteOrderToRedis } = require("./redis/redisCrud");
const { findAndUpdateUser } = require("./user");
const { RestaurantSetting } = require("../model");
const salt = "hellothisisdemoId"
const { getBusinessDate } = require("../utils/dateUtils");
const { getNextBillNo } = require("../helpers/billNumber");

const addOrderTax = async (taxes, orderId, hotel_id) => {
    console.log(taxes, "addOrderTax")
    if (!taxes.length) return;
    // bulkCreate = single INSERT statement instead of N sequential INSERTs
    await OrderTax.bulkCreate(
        taxes.map(el => ({
            amount: el.amount, tax_type: el.tax_value, tax_value: el.tax, hmsOrderMstId: orderId, hmsTaxTypeMstId: el.id, hotel_id
        }))
    );
};

const updateOrderTax = async (taxes, orderId, hotel_id) => {
    if (!taxes.length) return;
    // Promise.all = parallel UPDATEs instead of sequential
    await Promise.all(
        taxes.map(el =>
            OrderTax.update(
                { amount: el.amount, tax_type: el.tax_type, tax_value: el.tax },
                { where: { hotel_id, hmsOrderMstId: orderId, hmsTaxTypeMstId: el.id } }
            )
        )
    );
};
const addToTimeLine = async (id, action, userId, t = false) => {
    try {
        const txOpt = t ? { transaction: t } : {};

        // Run order fetch and user lookup in parallel — they are independent
        const [order, userName] = await Promise.all([
            Order.findOne({
                where: { id, deleted: false },
                include: [
                    { model: OrderDetails, include: [{ model: Menu, include: { model: Menu_categ } }, { model: Variants, as: "variantData" }] },
                    { model: HotelUser, attributes: ['name'] }
                ],
                ...txOpt
            }),
            HotelUser.findByPk(userId, txOpt)
        ]);

        const { totalDiscount: discount, service_charge, grandAmount, gst, id: order_id, totalAmount: sub_total, order_type, bill_no, status: order_status, TableId, hotelUserId, hotel_id } = order;
        const { hms_orderDetails: items } = order;

        await TimeLine.create({
            gst, service_charge, grandAmount, discount,
            creator: userName?.name,
            order_id,
            sub_total: Number(sub_total) - Number(discount),
            order_type, order_status, bill_no, items, action,
            event_name: action, device_name: "web", from: "online",
            created_Date: new Date(), TableId, hotelUserId: userId, hotel_id
        }, txOpt);
        return
    } catch (error) {
        throw new Error(error)
    }
}
const addToFroRemoveTimeLine = async (id, action, userId, detailId) => {
    try {
        const order = await Order.findOne({ where: { id, deleted: false } })
        const { totalDiscount: discount, service_charge, grandAmount, gst, id: order_id, totalAmount: sub_total, order_type, bill_no, status: order_status, TableId, hotelUserId, hotel_id } = order
        let items = []
        const findTimeLine = await TimeLine.findAll({ where: { order_id: id, deleted: false } })
        // console.log(JSON.stringify(findTimeLine[0].items), "original Itmes")
        if (findTimeLine[findTimeLine.length - 1]?.items?.length) {
            for (const element of findTimeLine[findTimeLine.length - 1].items) {
                let data = {}
                if (action === "decrease_kot_qty") {
                    if (element.id === detailId) {
                        data = { ...element, qty: element.qty - 1, updated: true, delete: false }
                    } else {
                        if (!element?.delete) {
                            data = { ...element, updated: false, delete: false }
                        } else {

                        }
                    }
                } else {
                    if (element.id === detailId) {
                        data = { ...element, updated: true, delete: true }
                    } else {
                        if (!element?.delete) {
                            data = { ...element, updated: false, delete: false }
                        } else {

                        }
                    }
                }

                items.push(data)
            }
        }
        // console.log(JSON.stringify(items), "Update Items")
        const userName = await HotelUser.findByPk(userId)
        await TimeLine.create({ gst, service_charge, grandAmount, discount, creator: userName?.name, order_id, sub_total, order_type, order_status, bill_no, items, action, event_name: action, device_name: "web", from: "online", created_Date: new Date(), TableId, hotelUserId: userId, hotel_id })

    } catch (error) {
        throw new Error(error)
    }
}
async function findExistingUser(input, orderId) {
    const { name, number, address, gstin, hotel_id } = input;

    if (orderId) {

        const order = await Order.findByPk(orderId)
        if (order) {
            return await User.findOne({ where: { id: order.UserId } })
        }
        return false
    } else {
        if (number) {
            return await User.findOne({
                where: {
                    hotel_id,
                    number
                }
            });
        }

        // Build OR conditions for other fields
        return false
    }

}
// const findAndUpdateUser = async (data, orderId = false) => {

//     const { name, number, address, gstin, hotel_id } = data
//     let user = await findExistingUser({ name, number, address, gstin, hotel_id }, orderId)
//     // console.log(user, "User::::")
//     if (user) {
//         // Update the existing user
//         if (user.number === "" && user.name === "" && orderId) {
//             const newUser = await User.create({ name, number, address, gstin, hotel_id });
//             // await Order.update({ UserId: newUser.id }, { where: { id: orderId } })
//             return newUser
//         } else {

//             await User.update({ name, number, address, gstin }, { where: { id: user.id, hotel_id } });
//             return user
//         }
//     } else {
//         // Create a new user
//         return await User.create({ name, number, address, gstin, hotel_id });

//     }
// }
const webChange = async (hotelId, io, orderId) => {
    try {
        const order = await Order.findByPk(orderId, { include: { model: OrderTax, include: { model: TaxType } } })
        const orderDetails = await OrderDetails.findAll({ where: { hotel_id: hotelId }, include: [{ model: Order, as: "order", where: { hotel_id: hotelId, id: orderId }, required: true, attributes: [] }, { model: Menu, include: { model: Menu_categ } }] },)
        const timeLine = await TimeLine.findAll({ where: { order_id: order.id, hotel_id: hotelId } })
        // log("TimeLine", timeLine)
        await io.to(hotelId).emit("webChange", { key: "object", order, orderDetails, timeLine })
    } catch (error) {
        console.log(error, "on Web Change")
    }
}
const generateToken = async (hotel_id) => {
    // console.log("genereateToken:::")
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const findMaxToken = await Order.findOne({
        attributes: [[sequelize.fn("MAX", sequelize.col("token")), "token"]],
        where: {
            hotel_id,
            createdAt: {
                [Op.between]: [todayStart, todayEnd], // Filter tokens created today
            },
        },
        raw: true,
    });
    // console.log(findMaxToken, findMaxToken?.token ? parseInt(findMaxToken.token) + 1 : 1, "genereateToken:::")
    return findMaxToken?.token ? parseInt(findMaxToken.token) + 1 : 1;

}

const addToCartAdmin = async (req, res) => {

    try {
        // ! test get tableId and userId and MenuId From body in live api get the table and User form the Order Display 

        const hotel = await Hotel.findOne({ where: { id: req.user } })
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.NOT_FOUND))

        // ! remove table concept in adminSide for pick-Order 

        // ! set default here pick-up  order-type after add DienIn and other option then get order type from query

        const order_type = "pick-up"



        const { MenuId, status } = req.body



        if (status) {
            const alreadyItemAvailable = await AdminCart.findOne({ where: { MenuId, hotel_id: req.user, status: { [Op.ne]: ORDER_DETAILS_TYPE.KOT } } })
            const MenuItem = await Menu.findOne({ where: { id: MenuId, hotel_id: req.user } })

            if (alreadyItemAvailable) {
                //createLogFile(req.user, " ADD TO ADMIN Status Available addToCartAdmin updated Admin Cart ", { qty: +alreadyItemAvailable.qty + 1, totalAmount: +alreadyItemAvailable.totalAmount + +MenuItem.price })
                const updateOrderItems = await AdminCart.update({ qty: +alreadyItemAvailable.qty + 1, totalAmount: +alreadyItemAvailable.totalAmount + +MenuItem.price }, { where: { id: alreadyItemAvailable.id } })

                return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { message: MESSAGE.QTY_AMOUNT_UPDATED }, STATUSCODE.SUCCESS))
            }
            //createLogFile(req.user, "ADD TO ADMIN Status Available addToCartAdmin Add to  Admin Cart ", { MenuId, totalAmount: MenuItem.price, hotel_id: req.user, order_type, status })
            await AdminCart.create({
                MenuId, totalAmount: MenuItem.price, hotel_id: req.user, order_type, status
            })
            return res.status(STATUSCODE.CREATED).json(success(MESSAGE.SUCCESS, { message: MESSAGE.ORDER_CREATE }, STATUSCODE.CREATED))
        }
        const alreadyItemAvailable = await AdminCart.findOne({ where: { MenuId, hotel_id: req.user, status: { [Op.ne]: ORDER_DETAILS_TYPE.KOT } } })
        const MenuItem = await Menu.findOne({ where: { id: MenuId, hotel_id: req.user } })
        if (alreadyItemAvailable) {
            //createLogFile(req.user, " ADD TO ADMIN Status Not Available alreadyItemAvailable AdminCart Update to  Admin Cart ", { qty: +alreadyItemAvailable.qty + 1, totalAmount: +alreadyItemAvailable.totalAmount + +MenuItem.price })
            const updateOrderItems = await AdminCart.update({ qty: +alreadyItemAvailable.qty + 1, totalAmount: +alreadyItemAvailable.totalAmount + +MenuItem.price }, { where: { id: alreadyItemAvailable.id } })

            return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { message: MESSAGE.QTY_AMOUNT_UPDATED }, STATUSCODE.SUCCESS))
        }
        //createLogFile(req.user, " ADD TO ADMIN Status Not Available Not alreadyItemAvailable AdminCart create to  Admin Cart ", { MenuId, totalAmount: MenuItem.price, hotel_id: req.user, order_type, kotNumber: 0 })

        await AdminCart.create({
            MenuId, totalAmount: MenuItem.price, hotel_id: req.user, order_type, kotNumber: 0
        })
        return res.status(STATUSCODE.CREATED).json(success(MESSAGE.SUCCESS, { message: MESSAGE.ORDER_CREATE }, STATUSCODE.CREATED))


    } catch (err) {
        console.log(err, "=====>error")
        //createLogFile(req.user, `addToCartAdmin/err Error`, err)
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

const addToCartForOnClickRetrieveCart = async (req, res) => {
    try {
        // ! test get tableId and userId and MenuId From body in live api get the table and User form the Order Display 

        const hotel = await Hotel.findOne({ where: { id: req.user } })
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.NOT_FOUND))

        // ! remove table concept in adminSide for pick-Order 

        // ! set default here pick-up  order-type after add DienIn and other option then get order type from query

        const order_type = "pick-up"




        const { id } = req.body


        const orderDetails = await OrderDetails.findAll(({ where: { orderId: id, hotel_id: req.user }, include: { model: Menu, include: { model: Menu_categ } } }))

        //createLogFile(req.user, " ADD TO CART FOR RETRIVE DATA  ", orderDetails)

        if (orderDetails.length) {

            return res.status(STATUSCODE.CREATED).json(success(MESSAGE.SUCCESS, { orderDetails }, STATUSCODE.CREATED))

        } else {
            return res.json(error(MESSAGE.FAIL, MESSAGE.ORDER_NOT_FOUND, STATUSCODE.BAD_REQUEST))
        }

    } catch (err) {
        //createLogFile(req.user, `addToCartForOnClickRetrieveCart/err Error`, err)
        console.log(err)
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

const getAdminCart = async (req, res) => {
    try {

        // ! get UserId from req User after completed authentication process



        const hotel = await Hotel.findOne({ where: { id: req.user } })
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.NOT_FOUND))
        const cartData = await AdminCart.findAll({
            where: { hotel_id: req.user }, order: [
                ['id', 'DESC'],

            ]
        });


        const groupedKot = {};






        let modifiedCart = { items: [], totalBill: 0, totalDiscount: 0, totalExcGstAmount: 0, gst: 0 };

        for (const cur of cartData) {

            modifiedCart.totalDiscount += cur.discount

            const menuData = await Menu.findOne({ where: { id: cur.MenuId, hotel_id: req.user } });
            if (menuData.gst_type == "G") {
                modifiedCart.totalExcGstAmount += cur.totalAmount
            }
            modifiedCart.totalBill += cur.totalAmount;
            menuData.dataValues.qty = cur.qty;
            menuData.dataValues.totalAmount = cur.totalAmount
            menuData.dataValues.status = cur.status
            menuData.dataValues.comment = cur.comment
            menuData.dataValues.discount = cur.discount

            if (!groupedKot[`KOT-${cur.kotNumber}`]) {
                groupedKot[`KOT-${cur.kotNumber}`] = [];
            }
            groupedKot[`KOT-${cur.kotNumber}`].push(menuData);

        }


        const resultsArray = Object.keys(groupedKot).map(kotName => {
            return {
                title: kotName,
                status: kotName === "KOT-0" ? "H" : "K",
                menuItems: groupedKot[kotName]
            }
        });

        modifiedCart.items = resultsArray

        if (!hotel.invoiceFormateIncGst) {
            modifiedCart.gst = 0
        } else {
            modifiedCart.gst = (((modifiedCart.totalBill - modifiedCart.totalExcGstAmount) * 5) / 100)
        }


        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { cartData: modifiedCart }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err)
        //createLogFile(req.user, `AdminCart/err Error`, err)
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

const findAndCreateUser = async (userName, mobile, gstin, hotel_id) => {
    try {
        let user
        user = await User.findOne({ where: { name: userName ? userName : "", number: mobile ? mobile : "", gstin: gstin ? gstin : '', hotel_id } })
        if (user) {
            User.update({ name: userName ? userName : "", number: mobile ? mobile : "", gstin: gstin ? gstin : '' }, { where: { id: user.id, hotel_id } })

        } else {
            user = await User.create({ name: userName ? userName : "", number: mobile ? mobile : "", gstin: gstin ? gstin : '', hotel_id })
        }
        return user

    } catch (error) {
        console.log(error, "In  findAndUpdatedUser")
        //createLogFile(req.user, `findAndCreateUser 254 line No /err Error`, error);
    }
}

function matchDepartmentsAndAddonsById(original, other) {
    if (original.length !== other.length) return false;

    for (let dept of original) {
        const matchingDept = other.find((oDept) => oDept.id === dept.id);

        if (!matchingDept) {

            return false;
        }


        const originalAddonIds = dept?.hms_addon_msts?.map((addon) => {
            return { id: addon.id, qty: addon.qty }
        }
        ).sort((a, b) => a.id - b.id);
        const matchingAddonIds = matchingDept?.hms_addon_msts?.map((addon) => {
            return { id: addon.id, qty: addon.qty }
        }
        ).sort((a, b) => a.id - b.id);
        if (
            originalAddonIds?.length !== matchingAddonIds?.length ||
            !originalAddonIds?.every((cur, index) => cur.id === matchingAddonIds[index].id && cur.qty === matchingAddonIds[index].qty)
        ) {
            return false;
        }
    }

    return true; // All department IDs and their respective addons match
}

const AdminOrder = async (req, res) => {
    try {
        // ! for react app 
        const { cart, order_type, order_id, cash, card, upi, userName, address, mobile, gstin, due, table_id } = req.body
        const hotel = await Hotel.findOne({ where: { id: req.user }, attributes: ['hotel_name', 'id', 'is_token_on', "saveBehave"], include: { model: RestaurantSetting, attributes: ["timeZone", "business_day_start_time"] } })
        if (!hotel) {
            return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.NOT_FOUND))
        }
        const timeZone = hotel?.hms_res_setting?.timeZone || "Asia/Kolkata"
        console.log(hotel?.hms_res_setting, "hotel")
        const businessStartTime = hotel?.hms_res_setting?.business_day_start_time || "00:01:00"


        if (!order_type) {
            return res.json(error(MESSAGE.PLEASE_SELECT_ORDER_TYPE, STATUSCODE.BAD_REQUEST))

        }
        if (!cart.items.length) {
            return res.json(error(MESSAGE.CART_NOT_FOUND, STATUSCODE.NOT_FOUND))
        }

        if (order_id) {
            const cartData = cart.items
            if (!cartData.length) {
                return res.json(error(MESSAGE.CART_NOT_FOUND, STATUSCODE.NOT_FOUND))
            }
            const modifiedCart = cart
            const gst = modifiedCart.gst
            const totalDiscount = modifiedCart.totalDiscount
            const { discount_reason, discount_type, discount_value } = modifiedCart
            const totalAmount = modifiedCart.myAmount
            const grandAmount = modifiedCart.grandAmount
            const service_charge = cart.service_charger
            const taxes = cart.taxes

            const orderWithoutupdated = await Order.findOne({ where: { id: order_id, hotel_id: req.user }, attributes: ['order_type', 'id', 'TableId'] })
            await Table.update({ table_status: "P" }, { where: { id: orderWithoutupdated.TableId, hotel_id: req.user } })
            // setImmediate(() => {

            await updateTableToRadis(orderWithoutupdated.TableId, req.user)
            // });
            if (!orderWithoutupdated) {
                // await t.rollback()
                return res.json(error(MESSAGE.ORDER_NOT_FOUND, STATUSCODE.NOT_FOUND))
            }
            let paymentMode = false
            if (cash || upi || card || due) {
                paymentMode = true
            }



            if (orderWithoutupdated.order_type === "pickup") {
                if (!paymentMode && grandAmount > 0) {
                    return res.json(error(MESSAGE.PAYMENT_MODE_NOT_SELECTED, STATUSCODE.NOT_FOUND))
                } if (due > 0 && !mobile) {

                    return res.json(error("Mobile Number Require On Due Payment", STATUSCODE.NOT_FOUND))
                }
            }
            // await AdminCart.destroy({ where: { hotel_id: req.user } })

            let user = await findAndUpdateUser({ name: userName, number: mobile, gstin, hotel_id: req.user, address }, order_id)
            // user = await User.findOne({ where: { name: userName ? userName : "", number: mobile ? mobile : "", gstin: gstin ? gstin : '', hotel_id: req.user } })
            // if (user) {
            // } else {
            //     user = await User.create({ name: userName ? userName : "", number: mobile ? mobile : "", gstin: gstin ? gstin : '', hotel_id: req.user })
            // }

            //createLogFile(req.user, `ADMIN ORDER/${order_id} Order updated`, JSON.stringify({ totalDiscount, status: STATUS.SUCCESS, payment: orderWithoutupdated.order_type == "pickup" ? STATUS.SUCCESS : STATUS.PENDING, cash, card, upi, due, totalAmount, gst, grandAmount, where: { id: order_id, hotel_id: req.user } }))
            const business_date = getBusinessDate(timeZone, businessStartTime)
            const order = await Order.update({ service_charge, UserId: user.id, totalDiscount, discount_reason, discount_type, discount_value, status: STATUS.SUCCESS, payment: orderWithoutupdated.order_type == "pickup" ? STATUS.SUCCESS : STATUS.PENDING, cash, card, upi, due, totalAmount, gst, grandAmount, createdAt: new Date(), business_date }, { where: { id: order_id, hotel_id: req.user } })

            await updateOrderTax(taxes, order_id, req.user)

            //createLogFile(req.user, `ADMIN ORDER/${order_id} OrderDeatils destroy all ${order_id} `, JSON.stringify({ where: { OrderId: order_id, hotel_id: req.user } }))

            await OrderDetails.destroy({ where: { OrderId: order_id, hotel_id: req.user } })
            for (const item of cartData) {
                for (const cur of item.menuItems) {
                    let condition = { price: cur.price, orderId: order_id, MenuId: cur.id, hotel_id: req.user, status: { [Op.eq]: ORDER_DETAILS_TYPE.DELIVERED } }
                    if (cur.variantData?.id) {
                        condition = { price: cur.price, orderId: order_id, variant_id: cur.variantData?.id, MenuId: cur.id, hotel_id: req.user, status: { [Op.eq]: ORDER_DETAILS_TYPE.DELIVERED } }
                    }
                    const OrderDetailsAvailable = await OrderDetails.findOne({ where: { ...condition } })
                    let result = false
                    if (OrderDetailsAvailable) {

                        if (cur?.addons?.length) {
                            const data = matchDepartmentsAndAddonsById(OrderDetailsAvailable.addons, cur.addons)
                            if (!data) {
                                result = false
                            } else {
                                result = true
                            }
                        }
                        else {
                            result = true
                        }
                    }
                    if (result) {
                        //createLogFile(req.user, `ADMIN ORDER/${order_id} OrderDetails OrderDetailsAvailable updated `, JSON.stringify({ totalDiscount: cur.discount + OrderDetailsAvailable.totalDiscount, qty: +cur.qty + OrderDetailsAvailable.qty, price: OrderDetailsAvailable.price, order_type, payment_status: orderWithoutupdated.order_type == "pickup" ? STATUS.SUCCESS : STATUS.PENDING, where: { id: OrderDetailsAvailable.id, hotel_id: req.user } }))
                        await OrderDetails.update({ totalDiscount: cur.discount + OrderDetailsAvailable.totalDiscount, qty: +cur.qty + OrderDetailsAvailable.qty, price: OrderDetailsAvailable.price, order_type, payment_status: orderWithoutupdated.order_type == "pickup" ? STATUS.SUCCESS : STATUS.PENDING, addons: cur?.addons }, { where: { id: OrderDetailsAvailable.id, hotel_id: req.user } })
                    }
                    else {
                        let modifiedCartForOrderDetails = { MenuId: "", hotel_id: "", qty: "", orderId: "" };
                        modifiedCartForOrderDetails.MenuId = cur.id
                        modifiedCartForOrderDetails.variant_id = cur.variantData?.id ? cur.variantData?.id : null
                        modifiedCartForOrderDetails.variant_name = cur.variantData?.variants_name ? cur.variantData?.variants_name : null
                        modifiedCartForOrderDetails.qty = cur.qty
                        modifiedCartForOrderDetails.price = cur.price
                        modifiedCartForOrderDetails.totalDiscount = cur.discount
                        modifiedCartForOrderDetails.order_type = order_type
                        modifiedCartForOrderDetails.payment_status = orderWithoutupdated.order_type == "pickup" ? STATUS.SUCCESS : STATUS.PENDING
                        modifiedCartForOrderDetails.hotel_id = req.user
                        modifiedCartForOrderDetails.orderId = order_id
                        modifiedCartForOrderDetails.TableId = order_type === "dinin" ? table_id : null
                        modifiedCartForOrderDetails.status = ORDER_DETAILS_TYPE.DELIVERED
                        modifiedCartForOrderDetails.addons = cur?.addons ? cur?.addons : []

                        if (cur?.custom) {
                            const { price, item_name } = cur
                            const menu = await Menu.create({ price, item_name, active: false, hotel_id: req.user })
                            modifiedCartForOrderDetails.MenuId = menu.id
                        }
                        //createLogFile(req.user, `ADMIN ORDER/${order_id} OrderDetails created`, JSON.stringify(modifiedCartForOrderDetails))
                        const orderDetails = await OrderDetails.create(modifiedCartForOrderDetails)
                    }
                }
            }
            await OrderDetails.update({ status: ORDER_DETAILS_TYPE.DELIVERED, payment_status: orderWithoutupdated.order_type == "pickup" ? STATUS.SUCCESS : STATUS.PENDING }, { where: { orderId: order_id, hotel_id: req.user } })
            // await t.commit()

            if (order_type === 'pickup') {
                const data = await checkRawMaterialAvailableOrNot(order_id, req.user, req.userId)
                if (!data.error) {

                } else {
                    throw new Error("Error From Stock Update")
                }
            }

            await addToTimeLine(order_id, ACTION.PLACEORDER, req.userId)
            if (order_type === "pickup") {

                await deleteOrderToRedis(order_id, req.user)
            } else {
                await updateOrderAppendToRadis(order_id, req.user)
            }
            await webChange(req.user, io, order_id)
            await orderCompletedSendtoKdsCLient(req.user, order_id)
            // setImmediate(() => {

            // });
            return res.json(success(MESSAGE.CREATED, { message: MESSAGE.ORDER_COMPLETED, orderId: order_id, restaurantName: hotel.hotel_name, saveBehave: hotel?.saveBehave }, STATUSCODE.CREATED))
        }
        else {
            let user = await User.create({
                hotel_id: +req.user,
                name: "",
                number: "",
                address: "",
                gstin: "",
                isPlaceholder: true
            });
            const cartData = cart.items
            if (order_type === "pickup") {

                let table
                let { userName, mobile, gstin, address } = req.body
                let paymentMode = false
                if (cash || upi || card || due) {
                    paymentMode = true
                }
                if (!paymentMode && cart.grandAmount > 0) {
                    // await t.rollback()
                    return res.json(error(MESSAGE.PAYMENT_MODE_NOT_SELECTED, STATUSCODE.NOT_FOUND))
                }





                if (cartData.length) {

                    // ! for postman testing 

                    // const cartDelete = await AdminCart.destroy({ where: { hotel_id: req.user } })
                    const modifiedCart = cart
                    const gst = modifiedCart.gst
                    const totalDiscount = modifiedCart.totalDiscount
                    const { discount_reason, discount_type, discount_value } = modifiedCart
                    const totalAmount = modifiedCart.myAmount
                    const grandAmount = modifiedCart.grandAmount
                    const service_charge = cart.service_charger
                    // const latestOrder = await Order.findOne({
                    //     where: {
                    //         hotel_id: req.user,
                    //         isOffline: false,
                    //         deleted: false
                    //     },
                    //     order: [[sequelize.literal("CAST(bill_no AS UNSIGNED)"), "DESC"]],
                    //     attributes: ["bill_no"]
                    // });

                    const maxOnlineBillNo = await getNextBillNo(req.user);

                    //createLogFile(req.user, `ADMIN ORDER/order_id Not Avaialbe PickUp Order Created`, { bill_no: `${maxOnlineBillNo + 1}`, hotel_id: req.user, UserId: user?.id, status: STATUS.SUCCESS, payment: STATUS.SUCCESS, cash, upi, card, order_type, totalAmount, gst, discount_reason, discount_type, totalDiscount, grandAmount })
                    let token = 0
                    if (hotel.is_token_on !== "3") {
                        if (hotel.is_token_on === '2') {
                            token = await generateToken(req.user)
                        }
                        if (hotel.is_token_on === '1' && order_type === 'dinin' || hotel.is_token_on === '0' && order_type === 'pickup') {
                            token = await generateToken(req.user)
                        }
                    }
                    const business_date = getBusinessDate(timeZone, businessStartTime)
                    const order = await Order.create({ business_date, service_charge, token, hotelUserId: req.userId, bill_no: maxOnlineBillNo, hotel_id: req.user, UserId: user?.id, status: STATUS.SUCCESS, payment: STATUS.SUCCESS, cash, upi, card, due, order_type, totalAmount, gst, discount_reason, discount_type, discount_value, totalDiscount, grandAmount })
                    user = await findAndUpdateUser({ name: userName, number: mobile, gstin, hotel_id: req.user, address }, order.id)

                    await addOrderTax(cart.taxes, order.id, req.user)

                    let orderDetailsForCreate = []
                    for (const item of cartData) {
                        for (const cur of item.menuItems) {

                            let modifiedCartForOrderDetails = { MenuId: "", hotel_id: "", qty: "", orderId: "", totalDiscount: 0 };
                            modifiedCartForOrderDetails.MenuId = cur.id
                            modifiedCartForOrderDetails.variant_id = cur.variantData?.id ? cur.variantData?.id : null
                            modifiedCartForOrderDetails.variant_name = cur.variantData?.variants_name ? cur.variantData?.variants_name : null
                            modifiedCartForOrderDetails.qty = cur.qty
                            modifiedCartForOrderDetails.price = +cur.price
                            modifiedCartForOrderDetails.totalDiscount = cur.discount
                            modifiedCartForOrderDetails.order_type = order_type
                            modifiedCartForOrderDetails.payment_status = STATUS.SUCCESS
                            modifiedCartForOrderDetails.hotel_id = req.user
                            modifiedCartForOrderDetails.orderId = order.id
                            modifiedCartForOrderDetails.status = ORDER_DETAILS_TYPE.DELIVERED
                            modifiedCartForOrderDetails.addons = cur?.addons ? cur?.addons : []
                            if (cur?.custom) {
                                const { price, item_name } = cur
                                const menu = await Menu.create({ price, item_name, active: false, hotel_id: req.user })
                                modifiedCartForOrderDetails.MenuId = menu.id
                            }
                            orderDetailsForCreate.push(modifiedCartForOrderDetails)
                            //createLogFile(req.user, `ADMIN ORDER/order_id Not Avaialbe PickUp Order Created`, modifiedCartForOrderDetails)
                            // const orderDetails = await OrderDetails.create(modifiedCartForOrderDetails, { transaction: t })
                        }

                    }
                    if (orderDetailsForCreate.length) {
                        await OrderDetails.bulkCreate(orderDetailsForCreate)
                    }
                    // if (order_type === 'pickup') {
                    const data = await checkRawMaterialAvailableOrNot(order.id, req.user, req.userId)
                    if (!data.error) {

                    } else {
                        throw new Error("Error From Stock Update")
                    }
                    await addToTimeLine(order.id, "place order", req.userId)
                    await webChange(req.user, io, order.id)

                    return res.json(success(MESSAGE.CREATED, { message: MESSAGE.ORDER_CREATE, orderId: order.id, restaurantName: hotel.hotel_name, saveBehave: hotel?.saveBehave }, STATUSCODE.CREATED))
                }

                return res.json(error(MESSAGE.CART_NOT_FOUND, STATUSCODE.NOT_FOUND))
            }
            if (order_type === "dinin") {

                let table
                let { tableNumber, userName, address, mobile, gstin } = req.body
                // const table_number = tableNumber.split("-")[0]
                // const catagories_name = tableNumber.split("-")[1]

                // const table_catag_id = await TableCatagories.findOne({ where: { table_catag_nm: catagories_name, hotel_id: req.user, active: true }, attributes: ['id'] })
                if (!table_id) return res.json(error(MESSAGE.TABLE_NOT_AVAILABLE, STATUSCODE.BAD_REQUEST));
                table = await Table.findOne({ where: { id: table_id, hotel_id: req.user, active: true }, attributes: ['id'] })

                if (!table) {
                    // await t.rollback()
                    return res.json(error(MESSAGE.TABLE_NOT_AVAILABLE, STATUSCODE.BAD_REQUEST))
                }




                // user = await User.findOne({ where: { name: userName ? userName : "", number: mobile ? mobile : "", gstin: gstin ? gstin : '', hotel_id: req.user } })

                // if (!user) {
                //     user = await User.create({ name: userName ? userName : "", number: mobile ? mobile : "", gstin: gstin ? gstin : '', hotel_id: req.user })
                // }


                const tableRunning = await Order.findOne({ where: { hotel_id: req.user, TableId: table.id, deleted: false, payment: "pending" }, attributes: ['id'] })

                if (tableRunning) {
                    // await t.rollback()
                    return res.json(error(MESSAGE.TABLE_RUNNING, STATUSCODE.BAD_REQUEST))
                }

                const tableupdated = await Table.update({ table_status: "P" }, { where: { id: table.id, hotel_id: req.user, active: true } })
                // setImmediate(() => {

                await updateTableToRadis(table.id, req.user)
                // });
                if (cartData.length) {


                    const modifiedCart = cart
                    const gst = modifiedCart.gst
                    const totalAmount = modifiedCart.myAmount
                    const grandAmount = modifiedCart.grandAmount
                    const service_charge = cart.service_charger
                    const totalDiscount = modifiedCart.totalDiscount
                    const { discount_reason, discount_type, discount_value } = modifiedCart
                    // const latestOrder = await Order.findOne({
                    //     where: {
                    //         hotel_id: req.user,
                    //         isOffline: false,
                    //         deleted: false
                    //     },
                    //     order: [[sequelize.literal("CAST(bill_no AS UNSIGNED)"), "DESC"]],
                    //     attributes: ["bill_no"]
                    // });

                    const maxOnlineBillNo = await getNextBillNo(req.user);

                    let token = 0
                    if (hotel.is_token_on !== "3") {
                        if (hotel.is_token_on === '2') {
                            token = await generateToken(req.user)
                        }
                        if (hotel.is_token_on === '1' && order_type === 'dinin' || hotel.is_token_on === '0' && order_type === 'pickup') {
                            token = await generateToken(req.user)
                        }
                    }
                    //createLogFile(req.user, `ADMIN ORDER/order_id Not Avaialbe DinIn Order Created`, { bill_no: `${maxOnlineBillNo + 1}`, hotel_id: req.user, UserId: user?.dataValues?.id, TableId: table?.id, status: STATUS.SUCCESS, order_type, discount_reason, discount_type, totalDiscount, totalAmount, gst, grandAmount })
                    const business_date = getBusinessDate(timeZone, businessStartTime)
                    const order = await Order.create({ business_date, service_charge, hotelUserId: req.userId, token, bill_no: maxOnlineBillNo, hotel_id: req.user, UserId: user?.dataValues?.id, TableId: table?.id, status: STATUS.SUCCESS, order_type, discount_reason, discount_type, discount_value, totalDiscount, totalAmount, gst, grandAmount })
                    user = await findAndUpdateUser({ name: userName, number: mobile, gstin, hotel_id: req.user, address }, order.id)

                    await addOrderTax(cart.taxes, order.id, req.user)
                    const orderDetailsForCreate = []
                    for (const item of cartData) {
                        for (const cur of item.menuItems) {

                            let modifiedCartForOrderDetails = { MenuId: "", hotel_id: "", qty: "", orderId: "", totalDiscount: 0 };
                            modifiedCartForOrderDetails.MenuId = cur.id
                            modifiedCartForOrderDetails.variant_id = cur.variantData?.id ? cur.variantData?.id : null
                            modifiedCartForOrderDetails.variant_name = cur.variantData?.variants_name ? cur.variantData?.variants_name : null
                            modifiedCartForOrderDetails.qty = cur.qty
                            modifiedCartForOrderDetails.price = cur.price
                            modifiedCartForOrderDetails.order_type = order_type
                            modifiedCartForOrderDetails.totalDiscount = cur.discount
                            modifiedCartForOrderDetails.payment_status = STATUS.PENDING
                            modifiedCartForOrderDetails.TableId = table_id

                            modifiedCartForOrderDetails.hotel_id = req.user
                            modifiedCartForOrderDetails.orderId = order.id
                            modifiedCartForOrderDetails.status = ORDER_DETAILS_TYPE.DELIVERED
                            modifiedCartForOrderDetails.addons = cur?.addons ? cur?.addons : []
                            if (cur?.custom) {
                                const { price, item_name } = cur
                                const menu = await Menu.create({ price, item_name, active: false, hotel_id: req.user })
                                modifiedCartForOrderDetails.MenuId = menu.id
                            }
                            orderDetailsForCreate.push(modifiedCartForOrderDetails)
                            //createLogFile(req.user, `ADMIN ORDER/order_id Not Avaialbe PickUp Order Created`, modifiedCartForOrderDetails)

                        }

                    }
                    if (orderDetailsForCreate.length) {
                        await OrderDetails.bulkCreate(orderDetailsForCreate)
                    }
                    // await t.commit()
                    if (order_type === 'pickup') {
                        const data = await checkRawMaterialAvailableOrNot(order_id, req.user, req.userId)
                        if (!data.error) {

                        } else {
                            throw new Error("Error From Stock Update")
                        }
                    }

                    await newOrderAppendToRadis(order.id, req.user)

                    await addToTimeLine(order.id, ACTION.PLACEORDER, req.userId)
                    await webChange(req.user, io, order.id)
                    return res.json(success(MESSAGE.CREATED, { message: MESSAGE.ORDER_CREATE, orderId: order.id, restaurantName: hotel.hotel_name, saveBehave: hotel?.saveBehave }, STATUSCODE.CREATED))
                } else {
                    // await t.rollback()
                    return res.json(error(MESSAGE.CART_NOT_FOUND, STATUSCODE.NOT_FOUND))
                }

            }
        }
    } catch (err) {
        console.log(err, "err From here --------------->")
        // await t.rollback()
        //createLogFile(req.user, `AdminOrder/err Error`, { err })
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

const generateKotPdf = async (data, outputPath) => {
    let browser = ""
    if (data.origin !== "http://localhost:3000") {
        browser = await puppeteer.launch({
            executablePath: "/usr/bin/google-chrome-stable",
            args: ['--no-sandbox'], headless: true
        });
    } else {
        browser = await puppeteer.launch({ headless: true });     // !local
    }
    const page = await browser.newPage();
    // Construct HTML content dynamically
    const htmlContent = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
         
      <script src="//translate.google.com/translate_a/element.js?cb=googleTranslateElementInit"></script>
        <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+Gujarati:wght@400;600&display=swap" rel="stylesheet">
        <link href="https://fonts.googleapis.com/css2?family=Noto+Sans&display=swap" rel="stylesheet">
        <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+Devanagari:wght@100..900&family=Tiro+Devanagari+Hindi:ital@0;1&display=swap" rel="stylesheet">
            <style>
body{
    margin:0px;
    padding:0px;
 font-family: 'Noto Sans','Noto Sans Gujarati', 'Noto Sans Devanagari',sans-serif;
}
.invoice {
    width:${data.printerSize == 2 ? "182px" : "270px"};

}
.invoice p {
margin-bottom: 5px;
margin-top: 0;
font-weight: 400;
font-size: 13px;
}
.invoice strong {

margin-bottom: 5px;
margin-top: 0;
font-weight: 600;
font-size: 14px;
letter-spacing: 0.5px;
}
.invoice-header {
text-align: center;
border-bottom: 2px dashed #000;
}
.hotel-name {
margin-bottom: 5px;
margin-top: 0;
font-weight: 600 !important; 
font-size: 14px !important; 
}
.custom-table-header {
display: flex;
gap: 35%;
margin-top: 5px;
border-bottom: 2px dashed #000;
}
.invoice-items tr {
border: none;
}
.invoice-items {
width: 100%;
border-collapse: collapse;
margin-top: 5px;
}
.invoice-items th,
.invoice-items td {
vertical-align: top;
padding: 1px;
text-align: left;
border: none;
color: #000;
font-size: 14px;
font-weight: 400;
}
.invoice-items th:nth-child(3),.invoice-items td:nth-child(3){
margin-left:3px;
width: 35%;
}
.invoice-items th {
font-size: 14px !important;
font-weight: 400;
}
.token{
font-size: 18px !important;
font-weight: 600;
}
</style>
</head>
            <body>
                <div class="invoice">
                    <div class="invoice-header">
                        <p class="hotel-name">${data.restaurantName}</p>
                        <p>${data.timeAndDate}</p>
                         <p>KOT - ${data.order_id}</p>
                        <p><strong>${data.order_type}</strong></p>
                        <p><strong>${data.userOrTableNo}</strong></p>
                        ${data.token > 0 ? `
                            <p class='token'><strong>Token No.:${data.token}</strong></p>
                            `: ""}
                    </div>
                    <div class="custom-table-header">
                        <p>Biller : biller </p>
                        <p> status: ${data?.kotNumber === 1 ? "Running" : "New"}
                    </div>
                    <table class="invoice-items">
                        <thead>
                            <tr>
                            <th>Item</th>
                                <th>Qty.</th>
                                <th>Special Note</th>
                            </tr>
                        </thead>
                        <tbody>
                         ${data.items.map((item, index) => `
                                <tr>
                                <td><strong>${item.item_name}</strong> ${item?.variantData?.variants_name ? `(${item?.variantData?.variants_name})` : ""}</td>
                                    <td>${item.qty}</td>
                                        <td>
            ${item?.comment ? item.comment : "--"}
            ${item?.addons?.length ?
            item?.addons.map((el) => `
                    <span>
                        ${el.department_name}:
                        ${el.hms_addon_msts.map((addon, i) =>
                `${addon.addon_name}(${addon.qty})${i < el.hms_addon_msts.length - 1 ? ',' : ''}`
            ).join('')}
                    </span>
                `).join(', ')
            : ""}
        </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </body>
        </html>
        `;
    await page.setContent(htmlContent);
    const pdf = await page.pdf();
    // await browser.close();
    // console.log(pdf, "Pdf buffer------------>")
    await browser.close()
    return pdf
}

const generateTokenPdf = async (data) => {
    let browser = ""
    if (data.origin !== "http://localhost:3000") {
        browser = await puppeteer.launch({
            executablePath: "/usr/bin/google-chrome-stable",
            args: ['--no-sandbox'], headless: true
        });
    } else {
        browser = await puppeteer.launch();     // !local
    }
    const page = await browser.newPage();
    // Construct HTML content dynamically
    const htmlContent = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
        <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+Gujarati:wght@400;600&display=swap" rel="stylesheet">
        <link href="https://fonts.googleapis.com/css2?family=Noto+Sans&display=swap" rel="stylesheet">
        <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+Devanagari:wght@100..900&family=Tiro+Devanagari+Hindi:ital@0;1&display=swap" rel="stylesheet">
            <style>
body{
    margin:0px;
    padding:0px;
 font-family: 'Noto Sans','Noto Sans Gujarati', 'Noto Sans Devanagari',sans-serif;
}
.invoice {
    width:${data.printerSize == 2 ? "182px" : "270px"};

}
p{
text-align:"center";
font-size:"25px";
}
</style>
</head>
            <body>
                <div class="invoice">
        
                   <p>${data}</p>
                   
                </div>
            </body>
        </html>
        `;
    await page.setContent(htmlContent);
    const pdf = await page.pdf();
    // await browser.close();
    // console.log(pdf, "Pdf buffer------------>")
    await browser.close()
    return pdf
}


//! changes required base on requirement both kotOrder and Hold Order
const generateInvoicePDF = async (data, outputPath) => {
    try {
        let browser = ""
        if (data.origin !== "http://localhost:3000") {
            browser = await puppeteer.launch({
                executablePath: "/usr/bin/google-chrome-stable",
                args: ['--no-sandbox'], headless: true
            });
        } else {
            browser = await puppeteer.launch();     // !local
        }

        const page = await browser.newPage();

        // Construct HTML content dynamically

        const htmlContent = `
        <!DOCTYPE html>
        <html lang="en">
       <head>
        <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+Gujarati:wght@400;600&display=swap" rel="stylesheet">
        <link href="https://fonts.googleapis.com/css2?family=Noto+Sans&display=swap" rel="stylesheet">
        <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+Devanagari:wght@100..900&family=Tiro+Devanagari+Hindi:ital@0;1&display=swap" rel="stylesheet">
           <style>
body{
    margin:0px;
    padding:0px;
 font-family: 'Noto Sans','Noto Sans Gujarati', 'Noto Sans Devanagari',sans-serif;
} 
.invoice {
width:${data.printerSize == "2" ? "182px" : "270px"};
}

.hotel-name {
margin-bottom: 5px;
margin-top: 0;
font-weight: 600 !important;
font-size: 15px !important;
}

.hotel-address {
margin: 0 auto;
max-width: 180px;
text-align: center;
}

.invoice p {
margin-bottom: 3px;
margin-top: 0;
font-weight: 500;
font-size: ${data.printerSize == "2" ? "10px" : "12px"};
}

.custom-table-header-name {
padding: 4px 0 4px 0;
border-top: 1px solid #000;
border-bottom: 1px solid #000;
}

.custom-table-header-name p {
margin: 0;
}

.custom-table-header {
display: flex;
margin-top: 4px;
width: 100%;
}

.custom-table-header-details {
width: 55%;
}

.custom-table-header-details-right {
width: 45%;
}

.invoice-header {
text-align: center;
}

.invoice-details {
margin-top: 20px;
margin-bottom: 20px;
}

.invoice-items tr {
border: none;
}

.invoice-items {
width: 100%;
border-collapse: collapse;
margin-top: 4px;
}

.invoice-items thead tr {
border-top: 1px solid #000;
border-bottom: 1px solid #000;
}

.custom-teble-title {
padding-top: 7px;
text-align: center;
}

.invoice-items th {
padding: 4px 0 4px 0 !important;
}

.invoice-items th,
.invoice-items td {
padding: 2px;
text-align: right;
border: none;
color: #000;
font-size: ${data.printerSize == "2" ? "11px" : "13px"};
font-weight: 400;
}

.invoice-items th:nth-child(4),
.invoice-items th:nth-child(3),
.invoice-items td:nth-child(3),
.invoice-items td:nth-child(4) {
width: 15%;
}



.invoice-items th:last-child {
text-align: center;
}

.invoice-items td:first-child,.invoice-items th:first-child {
text-align: left;
width:5%;
}
.invoice-items td:nth-child(2),.invoice-items th:nth-child(2) {
text-align: left;

}

.invoice-items th {
font-size: ${data.printerSize == "2" ? "12px" : "14px"} !important;
font-weight: 400;
}

.invoice-total {
display: flex;
margin-top: 3px;
text-align: right;
align-items: flex-end;
justify-content: flex-end;
border-bottom: 1px solid #000;
gap: 0%;
border-top: 1px solid #000;
padding: 3px 0 3px 0;
}

.invoice-total-one {
display: flex;
text-align: right;
align-items: flex-end;
justify-content: flex-end;
gap: 10%;
border-top: 1px solid #000;
padding: 5px 0 5px 0;
}

.invoice-grand-total {
text-align: center;
padding-bottom: 2px;
}
.invoice-total p strong{
font-size:${data.printerSize == "2" ? "13px" : "15px"};
}

.invoice-footer {
padding-top: 4px;
text-align: center;
}@media print {
  html, body {
    width: 100%;
    height: auto;
  }
  .invoice {
    page-break-inside: avoid;
    break-inside: avoid;
  }
  table, tr, td {
    page-break-inside: avoid !important;
    break-inside: avoid !important;
  }
}

</style>
</head>
            <body>

                <div class="invoice">
                    <div class="invoice-header">
                    ${data?.headerText?.join('')}
                    </div>
                    <div class="custom-table-header-name">
                    <p><strong>${data.tableAndUserInfo}</strong></p>
                     <p> ${data.customerNumber ? ` Number : ${data.customerNumber}` : ""} </p>
                       <p> ${data.customerName ? ` Name : ${data.customerName}` : ""} </p>
                       <p> ${data.address ? `Addr. : ${data.address}` : ""} </p>
                       <p> ${data.gstin ? `GST NO. : ${data.gstin}` : ""} </p>
                    </div>
                    <div class="custom-table-header">

                        <div class="custom-table-header-details">
                            <p>Date : ${data.dateAndTime}</p>
                        </div>
                        <div class="custom-table-header-details-right">
                            <p><strong>${data.type === 'dinin' ? 'Dine In' : 'Pick Up'}</strong></p>
                            <p>Bill No: ${data.orderId}</p>
                        </div>
                        ${data.token > 0 ? `<div class="custom-table-header-details">
                                <p><strong>Token No. : ${data.token} </strong></p>
                            </div>`: ""
            }
                    </div>
                    <table class="invoice-items">
                        <thead>
                            <tr>
                                <th>No.</th>
                                <th>Item</th>
                                <th>Qty.</th>
                                <th>Price</th>
                                <th>Amt</th>
                            </tr>
                        </thead>
                       <tbody>
    ${data.items.map((item, index) => `
        <tr>
            <td>${index + 1}</td>
            <td>${item.item_name} ${item?.variantData?.variants_name ? `(${item.variantData.variants_name})` : ""}</td>
            <td>${item.qty}</td>
            <td>${Number(item.price) % 1 === 0 ? Number(item.price) : Number(item.price).toFixed(2)}</td>
<td>${Number(item.totalAmount) % 1 === 0 ? Number(item.totalAmount) : Number(item.totalAmount).toFixed(2)}</td>

        </tr>
        ${item.addons && item.addons.length ?
                    item.addons.map(el =>
                        el.hms_addon_msts.map(addon => `
                    <tr>
                    <td></td>
                        <td colspan="4">
                            ${el.department_name}: ${addon.addon_name} - ${addon.qty} x ${addon.price} = ${(addon.qty * addon.price).toFixed(2)}
                        </td>
                    </tr>
                `)?.join('')
                    )?.join('')
                    : ""}
    `)?.join('')}
</tbody>
                    </table>

                    <div class="invoice-total-one">
                       
                        <div>
                            <p> Total Qty:${data.totalQty} sub Total: ${(+data.subtotal + data.totalDiscount).toFixed(2)}</p>
                            <p>${data.totalDiscount > 0 ? "Discount:" + " " + data.currency + data.totalDiscount : ""}</p>
                            <p>${data.service_charge > 0 ? "Service Charge :" + data.service_charge : ""} </p>
                            ${data.orderTax.map((tax, index) => `
   <p> ${`${tax?.hms_tax_type_mst?.tax_name} @${tax.amount}${tax.tax_type === 'pr' ? "%" : ""} : ${(+tax.tax_value).toFixed(2)}`}</p>
  
`)?.join('')}

                            
                        </div>
                    </div>
                    <div class="invoice-total">
                        <div>
                      
                            <p> <strong> Grand Total </strong></p>
                        </div>
                        <div>
                   
                            <p><strong>${data.currency} ${data.totalBill}</strong></p>
                        </div>
                    </div>
<div class="invoice-footer">
                    ${data?.footerText?.join('')}
                    </div>
                </div>

            </body>
        </html>
        `;
        // Set content to page
        await page.setContent(htmlContent, { waitUntil: 'networkidle0' });

        // Get the full height of the content
        const scrollHeight = await page.evaluate(() => document.documentElement.scrollHeight);

        // Generate the PDF buffer
        const pdf = await page.pdf({
            width: `${data.printerSize == "2" ? "58mm" : "80mm"}`,
            height: `${scrollHeight}px`,
            printBackground: true,
            margin: { top: 0, right: 0, bottom: 0, left: 0 }
        });
        // const pdf = await page.pdf();

        // Ensure directory exists
        // const pdfDir = path.join(__dirname, 'public', 'images');
        // if (!fs.existsSync(pdfDir)) {
        // fs.mkdirSync(pdfDir, { recursive: true });
        // }

        // File name and full path
        // const fileName = `INV-${data?.invoiceNumber || Date.now()}.pdf`;
        // const pdfPath = path.join(pdfDir, fileName);

        // ✅ Save the PDF buffer to the file
        // fs.writeFileSync(pdfPath, pdf);

        // console.log(`✅ PDF saved at: ${pdfPath}`);


        // console.log(pdf, "Pdf buffer------------>")
        await browser.close()
        return pdf
    } catch (error) {
        //createLogFile(0, `generateInvoicePDF /err Error`, error);
        console.log(error, "Error from pupperter======================>")
        return error
    }
}

const kotOrder = async (req, res) => {
    try {
        const { cart, order_type, order_id, tableTime, userName, address, mobile, gstin } = req.body;

        let hotel = await Hotel.findOne({ where: { id: req.user }, attributes: ['multiLanguage', 'hotel_name', 'is_token_on'], include: [{ model: PrinterSetting }, { model: RestaurantSetting, attributes: ["timeZone", "business_day_start_time"] }] });
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.NOT_FOUND));
        const timeZone = hotel?.hms_res_setting?.timeZone || "Asia/Kolkata"
        const businessStartTime = hotel?.hms_res_setting?.business_day_start_time || "00:01:00"

        hotel = hotel.get({ plain: true })
        const defaultKotPrinter = hotel?.hms_printer_settings?.find(el => el.print_type == "K");


        if (!defaultKotPrinter) return res.json(error("Printer Not Set", STATUSCODE.BAD_REQUEST));

        if (!order_type) return res.json(error(MESSAGE.PLEASE_SELECT_ORDER_TYPE, STATUSCODE.BAD_REQUEST));
        if (!cart.items.length) return res.json(error(MESSAGE.CART_NOT_FOUND, STATUSCODE.NOT_FOUND));

        let user = null;
        let table = null;

        if (order_type === "dinin") {
            const { table_id } = req.body;

            if (!table_id) return res.json(error(MESSAGE.TABLE_NOT_AVAILABLE, STATUSCODE.BAD_REQUEST));
            // const [tableNumberPart, catagoriesName] = tableNumber.split("-");

            // const tableCatag = await TableCatagories.findOne({ where: { table_catag_nm: catagoriesName, hotel_id: req.user, active: true }, attributes: ['id'] });

            // if (!tableCatag) return res.json(error(MESSAGE.TABLE_CATEGORY_NOT_AVAILABLE, STATUSCODE.BAD_REQUEST))
            table = await Table.findOne({ where: { id: table_id, hotel_id: req.user, active: true }, attributes: ['id', "type"] });
            if (!table) return res.json(error(MESSAGE.TABLE_NOT_AVAILABLE, STATUSCODE.BAD_REQUEST));
            // user = await findAndCreateUser(userName, mobile, gstin, req.user)
            // user = await findAndUpdateUser({ name: userName, number: mobile, gstin, hotel_id: req.user, address }, order_id)
        }

        const cartData = cart.items.find(el => el.status === 'H')?.menuItems || [];
        if (!cartData.length) return res.json(error(MESSAGE.CART_NOT_FOUND, STATUSCODE.NOT_FOUND));

        let kotInfo;


        if (order_id) {

            const resw = await createUpdatedOrder(order_id, res, req, cart, cartData, order_type, user, table, hotel, defaultKotPrinter, tableTime);
            user = await findAndUpdateUser({ name: userName, number: mobile, gstin, hotel_id: req.user, address }, order_id)

            if (resw.status === 200) {
                kotInfo = resw
            } else {
                return res.json(error(resw.message, STATUSCODE.BAD_REQUEST))
            }

        } else {
            user = await User.create({
                hotel_id: +req.user,
                name: "",
                number: "",
                address: "",
                gstin: "",
                isPlaceholder: true
            });
            const resw = await createNewOrder(cart, req, res, cartData, order_type, user, table, hotel, defaultKotPrinter, tableTime, timeZone, businessStartTime);
            console.log(resw, "Response from createNewOrder KOT==================>")
            user = await findAndUpdateUser({ name: userName, number: mobile, gstin, hotel_id: req.user, address }, resw.order_id)
            if (resw.status === 200) {
                kotInfo = resw
            } else {
                return res.json(error(resw.message, STATUSCODE.BAD_REQUEST))
            }
        }


        return res.json(success(STATUS.SUCCESS, { message: MESSAGE.KOT_GENERATED, kotInfo }, STATUSCODE.CREATED));
    } catch (err) {
        console.log(err);
        //createLogFile(req.user, `KOT/err Error`, { err });
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

const ordertimeOver = async (req, res) => {
    try {
        const { id } = req.body
        const order = await Order.findByPk(id)
        if (!order) return res.json(error(MESSAGE.ORDER_NOT_FOUND, STATUSCODE.BAD_REQUEST))
        await order.update({ timeOver: true })
        console.log(order, "Order Time Over Updated")
        await updateOrderAppendToRadis(order.id, req.user)
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { message: "TableTime is Over" }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err, "whitel Updatinf TableTime Over")
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))

    }
}

const ordertimeExtend = async (req, res) => {
    try {
        const { id, date } = req.body
        // const order = await Order.findByPk(id)
        const order = await Order.findOne({
            where: {
                hotel_id: req.user,
                deleted: false,
                id
            },
            include: [
                {
                    model: Table, where: { active: true },
                    include: { model: TableCatagories, where: { active: true }, }
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
        });
        if (!order) return res.json(error(MESSAGE.ORDER_NOT_FOUND, STATUSCODE.BAD_REQUEST))
        await order.update({ timeOver: false, tableTime: date })
        console.log(order, "Order Time Over Updated")
        await updateOrderAppendToRadis(order.id, req.user)
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { order, message: "TableTime is Over" }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err, "whitel Updatinf TableTime Over")
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))

    }
}

const arranPrintersForKotWithTheseItems = (printers, items, order_type, table_id) => {


    const filterDataAccordingToTableAndOrderType = printers.filter(el => {
        if ((el.order_type.includes(order_type) || !el.order_type.length)) {
            if (order_type !== 'pickup') {
                if (el.table_ids.includes(table_id) || !el.table_ids.length) {
                    return el
                }
            } else {
                return el
            }
        }
    })

    const result = filterDataAccordingToTableAndOrderType.map((printer) => {
        relevantItems = items.filter((item) => {
            return (
                (printer.menu_categ_ids.includes(+item.menu_categ_id) || !printer.menu_categ_ids.length || !item.menu_categ_id)
            );
        });
        return { printer, printerSize: printer.printer_size, items: relevantItems }
    }).filter(el => el.items.length);
    return result
}

const createUpdatedOrder = async (order_id, res, req, cart, cartData, order_type, user, table, hotel, defaultKotPrinter, tableTime) => {
    console.log(tableTime, "TableTime::::")
    const maxKotNumber = await OrderDetails.max('kotNumber', {
        where: { orderId: order_id, hotel_id: req.user },
        raw: true
    });

    const modifiedCart = cart;
    const gst = modifiedCart.gst;
    const discount_reason = modifiedCart.discount_reason;
    const totalDiscount = modifiedCart.totalDiscount;
    const discount_type = modifiedCart.discount_type;
    const discount_value = modifiedCart.discount_value;
    const grandAmount = modifiedCart.grandAmount;
    const totalAmount = modifiedCart.myAmount;
    const service_charge = cart.service_charger;

    //createLogFile(req.user, `KOT/${order_id} Order Updated`, { discount_reason, discount_type, UserId: user?.id, status: ORDER_TYPE.IN_PROGRESS, order_type, totalAmount, gst, totalDiscount, grandAmount, where: { id: order_id, hotel_id: req.user, deleted: false } });
    let table_time_sated1 = tableTime ? true : false
    let tableTime1 = tableTime ? tableTime : new Date()
    // await Order.findByPk(order_id)
    await Order.update({ tableTime: tableTime1, table_time_sated: table_time_sated1, discount_reason, discount_type, discount_value, service_charge, UserId: user?.id, status: ORDER_TYPE.IN_PROGRESS, order_type, totalAmount, gst, totalDiscount, grandAmount }, { where: { id: order_id, hotel_id: req.user, deleted: false } });
    await updateOrderTax(cart.taxes, order_id, req.user)
    const orderInformation = await Order.findOne({ where: { id: order_id, hotel_id: req.user, deleted: false }, attributes: ['id', 'TableId', 'UserId', 'bill_no', 'token'] });
    if (!orderInformation) return { status: 500, message: MESSAGE.ORDER_NOT_FOUND }
    await Table.update({ table_status: "R" }, { where: { id: orderInformation?.TableId, hotel_id: req.user, active: true } });
    // setImmediate(() => {

    await updateTableToRadis(orderInformation?.TableId, req.user)
    // });
    //createLogFile(req.user, `KOT/${order_id} Order Destroy`, { where: { orderId: order_id, status: ORDER_DETAILS_TYPE.IN_PROGRESS } });

    await OrderDetails.destroy({ where: { orderId: order_id, status: ORDER_DETAILS_TYPE.IN_PROGRESS } });

    const newOrderDetails = []

    for (const cur of cartData) {

        let modifiedCartForOrderDetails = {
            variant_id: cur.variantData?.id ? cur.variantData?.id : null,
            variant_name: cur.variantData?.id ? cur.variantData?.variants_name : null,
            MenuId: cur.id,
            qty: cur.qty,
            price: cur.price,
            totalDiscount: cur.discount,
            kotNumber: maxKotNumber + 1,
            order_type,
            payment_status: STATUS.PENDING,
            TableId: orderInformation?.TableId,
            UserId: orderInformation?.UserId,
            hotel_id: req.user,
            orderId: order_id,
            status: ORDER_DETAILS_TYPE.KOT,
            addons: cur?.addons ? cur.addons : [],
            comment: cur?.comment ? cur.comment : ""
        };
        if (cur?.custom) {
            const { price, item_name } = cur
            const menu = await Menu.create({ price, item_name, active: false, hotel_id: req.user })
            modifiedCartForOrderDetails.MenuId = menu.id
        }
        newOrderDetails.push(modifiedCartForOrderDetails)

    }

    if (newOrderDetails.length) {
        const data = await OrderDetails.bulkCreate(newOrderDetails)
        //createLogFile(req.user, `KOT/${order_id} OrderDetailsAvailable Created`, newOrderDetails);
    }
    const items = cart.items.filter(el => el.status === 'H')[0]?.menuItems || [];
    const type = order_type === "pickup" ? "Pick Up" : "Dine In";
    const checkDefaultPrinterSetting = await PrinterSetting.findAll({ where: { hotel_id: req.user, print_type: "K" } });



    const printerWithThereItems = arranPrintersForKotWithTheseItems(checkDefaultPrinterSetting, items, order_type, orderInformation.TableId)
    const data = []
    for (const element of printerWithThereItems) {
        const printerWiseData = {
            origin: req.headers.origin,
            printerSize: element.printer_size,
            printer: element.printer,
            items: element.items,
            order_type: type,
            order_id: orderInformation.isOffline ? `${orderInformation.bill_no}-OFF` : orderInformation.bill_no,
            restaurantName: hotel.hotel_name,
            userOrTableNo: order_type === "pickup" ? `${user?.name ? `Customer Name :${user?.name}` : ""}` : `${table.type === "R" ? "Room No:" : "Table No:"}${req.body.tableNumber}`,
            timeAndDate: moment().format("DD/MM/YYYY hh:mm a"),
            kotNumber: 1,
            token: orderInformation.token
        };
        data.push(printerWiseData)
    }
    await otherkot(orderInformation.id, req.user)
    await addToTimeLine(orderInformation.id, ACTION.KOT, req.userId)
    // setImmediate(() => {


    await updateOrderAppendToRadis(orderInformation.id, req.user)
    // });
    await webChange(req.user, io, orderInformation.id)
    return { status: 200, data, order_id: orderInformation.id, multi: true, multiLanguage: true };
    // }
};

const createNewOrder = async (cart, req, res, cartData, order_type, user, table, hotel, defaultKotPrinter, tableTime, timeZone, businessStartTime) => {

    // const latestOrder = await Order.findOne({
    //     where: {
    //         hotel_id: req.user,
    //         isOffline: false,
    //         deleted: false
    //     },
    //     order: [[sequelize.literal("CAST(bill_no AS UNSIGNED)"), "DESC"]],
    //     attributes: ["bill_no"]
    // });

    const maxOnlineBillNo = await getNextBillNo(req.user);
    if (order_type === 'dinin') {

        const tableRunning = await Order.findOne({ where: { hotel_id: req.user, TableId: table.id, deleted: false, payment: "pending" } })

        if (tableRunning) {
            return { message: MESSAGE.TABLE_RUNNING, status: STATUSCODE.BAD_REQUEST }
        }
    }
    const {
        gst,
        totalDiscount,
        grandAmount, myAmount, service_charger, discount_reason, discount_type, discount_value, taxes } = cart
    let newOrder
    let token = 0
    if (hotel.is_token_on !== "3") {
        if (hotel.is_token_on === '2') {
            token = await generateToken(req.user)
        }
        if (hotel.is_token_on === '1' && order_type === 'dinin' || hotel.is_token_on === '0' && order_type === 'pickup') {
            token = await generateToken(req.user)
        }
    }
    if (order_type !== 'pickup') {

        let table_time_sated1 = tableTime ? true : false
        const business_date = getBusinessDate(timeZone, businessStartTime)
        newOrder = await Order.create({ business_date, table_time_sated: table_time_sated1, tableTime: tableTime || new Date(), service_charge: service_charger, hotelUserId: req.userId, token, bill_no: maxOnlineBillNo, hotel_id: req.user, TableId: table?.id, UserId: user?.id, totalDiscount, status: ORDER_TYPE.IN_PROGRESS, order_type, totalAmount: myAmount, gst, grandAmount })

        await Table.update({ table_status: "R" }, { where: { id: table?.id, hotel_id: req.user, active: true } });
        // setImmediate(() => {

        await updateTableToRadis(table?.id, req.user)
        // });
    }
    else {
        const business_date = getBusinessDate(timeZone, businessStartTime)

        newOrder = await Order.create({ business_date, service_charge: service_charger, token, bill_no: maxOnlineBillNo, discount_reason, discount_value, discount_type, hotel_id: req.user, UserId: user?.id, totalDiscount, status: ORDER_TYPE.IN_PROGRESS, order_type, totalAmount: myAmount, gst, grandAmount })
    }
    await addOrderTax(taxes, newOrder.id, req.user)
    //     createLogFile(req.user, `KOT/${newOrder.id} Order Created`, {
    //     UserId: user?.id,
    //         status: ORDER_TYPE.IN_PROGRESS,
    //             order_type,
    //             totalAmount: cart.myAmount,
    //                 gst: cart.gst,
    //                     totalDiscount: cart.totalDiscount,
    //                         grandAmount: cart.grandAmount,
    //                             where: { id: newOrder.id, hotel_id: req.user }
    // });
    // console.log("cardt Data:::::", cartData)
    const allOrderDetails = []
    for (const cur of cartData) {
        let itemDetails = {
            variant_id: cur?.variantData?.id ? cur?.variantData?.id : null,
            variant_name: cur.variantData?.id ? cur.variantData?.variants_name : null,
            MenuId: cur.id,
            qty: cur.qty,
            price: cur.price,
            totalDiscount: cur.discount,
            kotNumber: 1,
            order_type,
            payment_status: STATUS.PENDING,
            TableId: table?.id || null,
            UserId: user?.id,
            hotel_id: req.user,
            orderId: newOrder.id,
            status: ORDER_DETAILS_TYPE.KOT,
            addons: cur?.addons ? cur?.addons : [],
            comment: cur?.comment ? cur.comment : ""

        }
        if (cur?.custom) {
            const { price, item_name } = cur
            const menu = await Menu.create({ price, item_name, active: false, hotel_id: req.user })
            itemDetails.MenuId = menu.id
        }
        allOrderDetails.push(itemDetails)

    }

    if (allOrderDetails.length) {

        await OrderDetails.bulkCreate(allOrderDetails)
    }

    const items = cart.items.filter(el => el.status === 'H')[0]?.menuItems || [];
    const type = order_type === "pickup" ? "Pick Up" : "Dine In";
    const checkDefaultPrinterSetting = await PrinterSetting.findAll({ where: { hotel_id: req.user, print_type: "K" } });


    const printerWithThereItems = (arranPrintersForKotWithTheseItems(checkDefaultPrinterSetting, items, order_type, table?.id))

    const data = []
    for (const element of printerWithThereItems) {

        const printerWiseData = {
            origin: req.headers.origin,
            printerSize: element.printer_size,
            printer: element.printer,
            items: element.items,
            order_type: type,
            order_id: newOrder.isOffline ? `${newOrder.bill_no}-OFF` : newOrder.bill_no,
            restaurantName: hotel.hotel_name,
            userOrTableNo: order_type === "pickup" ? `${user?.name ? `Customer Name :${user?.name}` : ""}` : `${table.type === "R" ? "Room No:" : "Table No:"}${req.body.tableNumber}`,
            timeAndDate: moment().format("DD/MM/YYYY hh:mm a"),
            kotNumber: 0,
            token
        };
        data.push(printerWiseData)
    }
    await sendKotToAllKdsClient(newOrder.id, req.user, true)
    await addToTimeLine(newOrder.id, ACTION.KOT, req.userId)

    await newOrderAppendToRadis(newOrder.id, req.user)

    await webChange(req.user, io, newOrder.id)
    // setImmediate(() => {
    // });
    return { status: 200, order_id: newOrder.id, data, multi: true, multiLanguage: true };
};

const generateKotPdfForOrder = async (order, cartData, req, hotel, user) => {
    try {
        // Flatten the items array and map to the required format
        const items = cartData.flatMap(el => el.menuItems);
        const userOrTableNo = order.TableId ? `Table No: ${order.TableId}` : `${user?.name ? `Customer Name :${user?.name}` : ""}`;

        // Prepare KOT information
        const kotInfo = {
            restaurantName: hotel.name,
            timeAndDate: new Date().toLocaleString(),
            order_id: order.bill_no,
            order_type: order.order_type,
            userOrTableNo,
            items: items.map(item => ({
                item_name: item.name,
                qty: item.qty,
                comment: item.comment,
                sub_categories: item.sub_categories || "regular",
            })),
            printerSize: 2
        };
        return kotInfo



    } catch (err) {
        console.error("Error generating KOT PDF:", err);
        res.status(500).json({ message: "Internal Server Error", status: 500 });
    }
};

const holdOrder = async (req, res) => {
    // const t = await sequelize.transaction();
    try {
        const hotel = await Hotel.findByPk(req.user, {
            attributes: ["is_token_on"], include: { model: RestaurantSetting, attributes: ['timeZone', "business_day_start_time"] }
        });
        const timeZone = hotel?.hms_res_setting?.timeZone || "Asia/Kolkata"
        const businessStartTime = hotel?.hms_res_setting?.business_day_start_time || "00:01:00"

        const { cart, order_type, order_id, table_id, userName, address, mobile, gstin } = req.body;

        if (!order_type) {
            // await t.rollback()
            return res.json(error(MESSAGE.PLEASE_SELECT_ORDER_TYPE, STATUSCODE.BAD_REQUEST));
        }

        if (!cart?.items?.length) {
            // await t.rollback()
            return res.json(error(MESSAGE.CART_NOT_FOUND, STATUSCODE.NOT_FOUND));
        }

        let user, table;
        let cartData = cart.items;
        if (order_id) {
            const menuItems = cartData.find(el => el.status === 'H');
            if (!menuItems) {
                // await t.rollback()
                return res.json(error(MESSAGE.CART_NOT_FOUND, STATUSCODE.NOT_FOUND));
            }
            cartData = menuItems.menuItems;
            if (!cartData.length) {
                // await t.rollback()
                return res.json(error(MESSAGE.CART_NOT_FOUND, STATUSCODE.NOT_FOUND));
            }

            const { gst, totalDiscount, grandAmount, myAmount: totalAmount, service_charger, discount_reason, discount_type, discount_value } = cart;
            //createLogFile(req.user, `Hold/${order_id} Order Updated`, { status: ORDER_TYPE.HOLD, order_type, totalDiscount, totalAmount, gst, grandAmount, discount_reason, discount_type, });

            await Order.update({ service_charge: service_charger, status: ORDER_TYPE.HOLD, order_type, totalDiscount, discount_reason, discount_type, discount_value, totalAmount, gst, grandAmount }, { where: { id: order_id, hotel_id: req.user, deleted: false } });
            user = await findAndUpdateUser({ name: userName, number: mobile, gstin, hotel_id: req.user, address }, order_id)
            await updateOrderTax(cart.taxes, order_id, req.user)
            const orderInformation = await Order.findOne({ where: { id: order_id, hotel_id: req.user, deleted: false } });
            await Table.update({ table_status: "H" }, { where: { id: orderInformation?.TableId, hotel_id: req.user, active: true } });
            // setImmediate(() => {

            await updateTableToRadis(orderInformation?.TableId, req.user)
            // });
            await OrderDetails.destroy({ where: { hotel_id: req.user, status: ORDER_DETAILS_TYPE.IN_PROGRESS, orderId: order_id } });

            for (const cur of cartData) {


                let condition = {
                    orderId: order_id, MenuId: cur.id, hotel_id: req.user, payment_status: STATUS.PENDING, status: ORDER_DETAILS_TYPE.IN_PROGRESS
                }
                if (cur?.variantData?.id) {
                    condition = {
                        variant_id: cur.variantData?.id, variant_name: cur.variantData?.id ? cur.variantData?.variants_name : null, orderId: order_id, MenuId: cur.id, hotel_id: req.user, payment_status: STATUS.PENDING, status: ORDER_DETAILS_TYPE.IN_PROGRESS
                    }
                }
                const OrderDetailsAvailable = await OrderDetails.findOne(
                    {
                        where: {
                            ...condition
                        }

                    });
                let result = false
                if (OrderDetailsAvailable) {

                    if (cur?.addons?.length) {
                        const data = matchDepartmentsAndAddonsById(OrderDetailsAvailable.addons, cur.addons)
                        if (!data) {
                            result = false
                        } else {
                            result = true
                        }
                    }
                    else {

                        result = true
                    }

                }

                if (result) {
                    //createLogFile(req.user, `HOLD/${order_id} OrderDetails Updated`, { totalDiscount: cur.discount, qty: +cur.qty, price: +cur.price, order_type, status: ORDER_DETAILS_TYPE.HOLD });

                    await OrderDetails.update({ totalDiscount: cur.discount, qty: +cur.qty, price: +cur.price, order_type, status: ORDER_DETAILS_TYPE.HOLD, addons: cur?.addons ? cur.addons : [] }, { where: { ...condition } });
                } else {

                    let modifiedCartForOrderDetails = {
                        MenuId: cur.id,
                        variant_id: cur?.variantData?.id ? cur?.variantData?.id : null,
                        variant_name: cur.variantData?.id ? cur.variantData?.variants_name : null,
                        qty: +cur.qty,
                        price: +cur.price,
                        totalDiscount: cur.discount,
                        order_type,
                        payment_status: STATUS.PENDING,
                        hotel_id: req.user,
                        orderId: order_id,
                        status: ORDER_DETAILS_TYPE.HOLD,
                        TableId: orderInformation.TableId,
                        addons: cur?.addons ? cur?.addons : []
                    };
                    if (cur?.custom) {
                        const { price, item_name } = cur
                        const menu = await Menu.create({ price, item_name, active: false, hotel_id: req.user })
                        modifiedCartForOrderDetails.MenuId = menu.id
                    }
                    //createLogFile(req.user, `HOLD/${order_id} OrderDetails Created`, modifiedCartForOrderDetails);
                    await OrderDetails.create(modifiedCartForOrderDetails);
                }
            }

            //createLogFile(req.user, `HOLD/${order_id} OrderDetails Hold Successful`, {});
            // await t.commit();
            // setImmediate(() => {
            await updateOrderAppendToRadis(order_id, req.user)

            // });
            await addToTimeLine(order_id, ACTION.HOLD, req.userId)
            await webChange(req.user, io, order_id)
            return res.json(success(MESSAGE.ORDER_HOLD, { message: MESSAGE.ORDER_HOLD, orderId: order_id }, STATUSCODE.CREATED));
        }
        user = await User.create({
            hotel_id: +req.user,
            name: "",
            number: "",
            address: "",
            gstin: "",
            isPlaceholder: true
        });


        if (order_type === "dinin") {
            let { tableNumber, userName, address, mobile, gstin } = req.body;
            const [table_number, catagories_name] = tableNumber.split("-");
            if (!table_id) return res.json(error(MESSAGE.TABLE_NOT_AVAILABLE, STATUSCODE.BAD_REQUEST));
            // const table_catag_id = await TableCatagories.findOne({ where: { table_catag_nm: catagories_name, hotel_id: req.user, active: true } });
            table = await Table.findOne({ where: { id: table_id, hotel_id: req.user, active: true } });
            if (!table) {
                // await t.rollback()
                return res.json(error(MESSAGE.TABLE_NOT_AVAILABLE, STATUSCODE.BAD_REQUEST));
            }
            // user = await findAndUpdateUser({ name: userName, address, number: mobile, gstin, hotel_id: req.user }, order_id)
            // user = await User.findOrCreate({ where: { name: userName || "", number: mobile || "", gstin: gstin || '', hotel_id: req.user }, defaults: { name: userName, number: mobile, gstin } }).then(([user]) => user);
            const tableRunning = await Order.findOne({ where: { TableId: table.id, deleted: false, payment: "pending", hotel_id: req.user } });

            if (tableRunning) {
                // await t.rollback()
                return res.json(error(MESSAGE.TABLE_RUNNING, STATUSCODE.BAD_REQUEST));
            }

            await Table.update({ table_status: "H" }, { where: { id: table.id, hotel_id: req.user, active: true } });
            // setImmediate(() => {

            await updateTableToRadis(table.id, req.user)
            // });
        }

        if (cartData) {
            const { gst, totalDiscount, grandAmount, myAmount: totalAmount, service_charger, discount_reason, discount_type, discount_value } = cart;
            // const latestOrder = await Order.findOne({
            //     where: {
            //         hotel_id: req.user,
            //         isOffline: false,
            //         deleted: false
            //     },
            //     order: [[sequelize.literal("CAST(bill_no AS UNSIGNED)"), "DESC"]],
            //     attributes: ["bill_no"]
            // });

            const maxOnlineBillNo = await getNextBillNo(req.user);
            let token = 0
            if (hotel.is_token_on !== "3") {
                if (hotel.is_token_on === '2') {
                    token = await generateToken(req.user)
                }
                if (hotel.is_token_on === '1' && order_type === 'dinin' || hotel.is_token_on === '0' && order_type === 'pickup') {
                    token = await generateToken(req.user)
                }
            }
            const business_date = getBusinessDate(timeZone, businessStartTime)
            const order = await Order.create({ business_date, service_charge: service_charger, hotelUserId: req.userId, token, bill_no: maxOnlineBillNo, hotel_id: req.user, TableId: table?.id, discount_reason, discount_type, discount_value, totalDiscount, UserId: user?.id, status: ORDER_TYPE.HOLD, order_type, totalAmount, gst, grandAmount });
            user = await findAndUpdateUser({ name: userName, number: mobile, gstin, hotel_id: req.user, address }, order.id)
            await addOrderTax(cart.taxes, order.id, req.user)
            const menuItems = cart.items.find(el => {
                if (el.status === 'H') {
                    return el
                }
            })

            const cartData = menuItems.menuItems
            for (const cur of cartData) {

                let modifiedCartForOrderDetails = {
                    MenuId: cur.id,
                    variant_id: cur.variantData?.id ? cur.variantData?.id : null,
                    variant_name: cur.variantData?.id ? cur.variantData?.variants_name : null,
                    qty: +cur.qty,
                    price: +cur.price,
                    totalDiscount: cur?.discount,
                    TableId: table?.id,
                    UserId: user?.id,
                    order_type,
                    payment_status: STATUS.PENDING,
                    hotel_id: req.user,
                    orderId: order.id,
                    status: ORDER_DETAILS_TYPE.IN_PROGRESS,
                    addons: cur?.addons
                }
                if (cur?.custom) {
                    const { price, item_name } = cur
                    const menu = await Menu.create({ price, item_name, active: false, hotel_id: req.user })
                    modifiedCartForOrderDetails = {
                        MenuId: menu.id,
                        variant_id: cur.variantData?.id ? cur.variantData?.id : null,
                        variant_name: cur.variantData?.id ? cur.variantData?.variants_name : null,
                        qty: +cur.qty,
                        price: +cur.price,
                        totalDiscount: cur?.discount,
                        TableId: table?.id,
                        UserId: user?.id,
                        order_type,
                        payment_status: STATUS.PENDING,
                        hotel_id: req.user,
                        orderId: order.id,
                        status: ORDER_DETAILS_TYPE.IN_PROGRESS,
                        addons: cur?.addons
                    };
                }

                //createLogFile(req.user, `HOLD/OrderId Not Available Create OrderDetails`, modifiedCartForOrderDetails);
                await OrderDetails.create(modifiedCartForOrderDetails);
            }

            // await t.commit();
            // setImmediate(() => {
            await newOrderAppendToRadis(order.id, req.user)

            // });
            await addToTimeLine(order.id, ACTION.HOLD, req.userId)
            await webChange(req.user, io, order.id)
            return res.json(success(MESSAGE.ORDER_HOLD, { message: MESSAGE.ORDER_HOLD, orderId: order.id }, STATUSCODE.CREATED));
        }
        // await t.rollback()
        return res.json(error(MESSAGE.CART_NOT_FOUND, STATUSCODE.NOT_FOUND));
    } catch (err) {
        // await t.rollback();
        console.log(err);
        //createLogFile(req.user, `HOLD/err Error`, { err });
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

const removeAdminCartItems = async (req, res) => {
    try {
        // ! test get tableId and userId and MenuId From body in live api get the table and User form the Order Display 

        const hotel = await Hotel.findOne({ where: { id: req.user } })
        if (!hotel) return res.json(error(MESSAGE.USER_NOT_FOUND, STATUSCODE.NOT_FOUND))

        const { MenuId, orderId, kotNumber, variant_id } = req.body

        if (orderId) {

            let condition = { MenuId, OrderId: orderId, kotNumber, hotel_id: req.user, status: { [Op.ne]: ORDER_DETAILS_TYPE.DELIVERED } }
            if (variant_id) {
                condition = { MenuId, OrderId: orderId, kotNumber, hotel_id: req.user, status: { [Op.ne]: ORDER_DETAILS_TYPE.DELIVERED }, variant_id }
            }
            const alreadyItemAvailable = await OrderDetails.findOne({ where: { ...condition } })
            const MenuItem = await Menu.findOne({ where: { id: MenuId, hotel_id: req.user } })

            if (alreadyItemAvailable) {


                const order = await Order.findOne({ where: { id: orderId, hotel_id: req.user } })
                let gst = 0
                let grandAmount = 0
                let totalAmount = order.totalAmount - alreadyItemAvailable.price
                if (hotel.invoiceFormateIncGst && MenuItem.gst_type === 'S') {
                    gst = (order.gst - ((alreadyItemAvailable.price * 5) / 100))
                    grandAmount = Math.round(order.grandAmount - ((alreadyItemAvailable.price * 5) / 100) - alreadyItemAvailable.price)
                } else {
                    gst = order.gst
                    grandAmount = Math.round(order.grandAmount - alreadyItemAvailable.price)
                }
                //createLogFile(req.user, ` after REMOVEADMINCARTITEMS/${orderId} OrderDetails QTY GRATER THAN 1+ ORDER Updated`, { totalAmount: order.totalAmount - MenuItem.price, gst, grandAmount: Math.round(order.totalAmount - MenuItem.price - gst) }, { where: { id: orderId, hotel_id: req.user } })

                await Order.update({ totalAmount, gst, grandAmount }, { where: { id: orderId, hotel_id: req.user } })

                await OrderDetails.update({ qty: +alreadyItemAvailable.qty - 1, totalAmount: +alreadyItemAvailable.totalAmount - +MenuItem.price }, { where: { id: alreadyItemAvailable.id } })
                await descriseKotQtyItemFromKDS(orderId, req.user, kotNumber, alreadyItemAvailable.id)
                // await addToTimeLine(orderId, ACTION.REMOVEKOT, req.userId)
                await webChange(req.user, io, orderId)
                return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { id: alreadyItemAvailable.id, message: MESSAGE.QTY_AMOUNT_UPDATED }, STATUSCODE.SUCCESS))
            }


            return res.json(error(MESSAGE.CART_ITEM_NOT_AVAILABLE, STATUSCODE.NOT_FOUND))

        }

        return res.json(error(MESSAGE.CART_ITEM_NOT_AVAILABLE, STATUSCODE.NOT_FOUND))

    } catch (err) {
        console.log(err, "=====>error")
        //createLogFile(req.user, `removeAdminCartItems/err Error`, { err })
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

const adminBillData = async (req, res) => {

    try {
        const id = req.user
        const { orderId } = req.body
        const hotel = await Hotel.findOne({ where: { id }, include: { model: InvoiceFormate } })

        if (!hotel) {
            return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.NOT_FOUND))
        }

        const order = await Order.findOne({ where: { hotel_id: req.user, id: orderId }, include: { model: OrderTax, include: { model: TaxType } }, attributes: ['id', 'totalAmount', 'UserId', 'TableId', 'bill_no', 'gst', 'grandAmount', 'totalDiscount', 'order_type', 'createdAt', "token", "service_charge", "isOffline"] })
        if (!order) {
            return res.json(error(MESSAGE.ORDER_NOT_FOUND, STATUSCODE
                .NOT_FOUND))
        }
        // console.log("Order::::", JSON.parse(JSON.stringify(order)))

        const invoicePrinters = JSON.parse(JSON.stringify(await PrinterSetting.findAll({
            where: {
                hotel_id: req.user, print_type: 'I',
            }, attributes: ['number_of_copies', 'printer_name', 'id', 'printer_size', 'order_type', "table_ids"]
        })))


        const printer = []
        for (const element of invoicePrinters) {
            if ((element.order_type.includes(order.order_type) || !element.order_type.length)) {
                if (order.order_type !== "pickup") {
                    if ((element.table_ids.includes(order.TableId) || !element.table_ids.length)) {

                        printer.push(element)
                    }
                } else {
                    printer.push(element)

                }
            }
        }
        // if (!printer.length) {
        //     return res.json(error("Printer Not Set", STATUSCODE.BAD_REQUEST))
        // }


        const orderDetail = await OrderDetails.findAll({ where: { orderId: order?.dataValues.id, hotel_id: req.user }, include: { model: Variants, as: "variantData" }, attributes: ['qty', 'price', 'id', 'MenuId', "addons"] })
        if (!orderDetail.length) {
            // await t.rollback()
            return res.json(error(MESSAGE.ORDERDETAILS_NOT_FOUND, STATUSCODE
                .NOT_FOUND))
        }

        const items = []
        let totalQty = 0;

        for (const cur of orderDetail) {
            const documents = {}
            const menuData = await Menu.findOne({ where: { id: cur.MenuId, hotel_id: req.user }, attributes: ['item_name', 'sub_categories'] })
            documents.item_name = menuData.item_name
            documents.variantData = cur.variantData
            documents.addons = cur.addons
            documents.price = cur.price
            documents.qty = cur.qty
            documents.sub_categories = menuData.sub_categories
            documents.totalAmount = cur.price * cur.qty
            items.push(documents)
            totalQty += cur.qty
        }

        const timeAndDate = moment(order.createdAt).format("DD/MM/YYYY hh:mm a");

        const subtotal = order.totalAmount

        let user = ''
        let table = ''
        let tableAndUserInfo = ''
        if (order.UserId) {
            user = await User.findOne({ where: { id: order.UserId } })
        }
        if (order.TableId) {
            table = await Table.findOne({ where: { id: order?.TableId }, include: { model: TableCatagories } })
            tableAndUserInfo = `${table.type === "T" ? "Table No:" : "Room No:"}  ${table.table_name}-${table?.hms_table_categ?.table_catag_nm}`
        }

        const type = order.order_type

        const headerContent = []
        const footerContent = []
        if (hotel.hms_invoice_formate_mst?.dataValues) {

            for (let key of Object.keys(hotel.hms_invoice_formate_mst?.dataValues)) {
                if (key.includes("header")) {
                    headerContent.push(hotel.hms_invoice_formate_mst?.dataValues[key])
                } if (key.includes("footer")) {
                    footerContent.push(hotel.hms_invoice_formate_mst?.dataValues[key])
                }
            }
        }
        let findHotelLogoInHeader = await headerContent.find(el => el === "hotel_logo")
        let findHotelLogoInfooter = await footerContent.find(el => el === "hotel_logo")
        let footerText
        let headerText
        let logoAvailable = false

        if (findHotelLogoInHeader || findHotelLogoInfooter || hotel.multiLanguage) {
            logoAvailable = true

            const data = await getHearderAndFooterData(hotel, order.grandAmount)

            headerText = data.headerText
            footerText = data.footerText

        } else {

            headerText = headerContent.map(el => {
                let data = ""
                if (el == "marketing_text") {
                    data = hotel.invoiceFormateHeaderText
                    return el ? { title: 'marketing_text', value: data } : ''
                }
                else if (el === 'hotel_logo') {
                    return el ? { title: 'hotel_logo', value: hotel[el] } : ''

                }
                else if (el === 'gst_no') {
                    data = `GSTIN = ${hotel[el]}`
                    return el ? { title: 'gst_no', value: data } : ''

                }
                else if (el === 'upiId') {
                    // data = `GSTIN = ${hotel[el]}`
                    return el ? { title: 'upiId', value: hotel[el] } : ''

                }
                else if (el === 'fssai_no') {
                    data = `FSSAI_No :${hotel[el]} `
                    return el ? { title: 'fssai_no', value: data } : ''

                }
                else if (el === 'restaurant_number') {
                    data = `Mo.${hotel.contact1}`
                    return el ? { title: 'restaurant_number', value: data } : ''

                } else if (el === "address") {
                    data = hotel.address1 + " " + hotel.address2
                    return el ? { title: 'address', value: data } : ''

                } else if (hotel[el]) {
                    data = hotel[el]
                    return el ? { title: el, value: data } : ''

                }
                else {
                    data = el
                    return el ? { title: 'other', value: data } : { title: 'other', value: '' }

                }
            }
            )
            footerText = footerContent.map(el => {
                let data = ""
                if (el == "marketing_text") {
                    data = hotel.invoiceFormateHeaderText
                    return el ? { title: 'marketing_text', value: data } : ''
                }
                else if (el === 'hotel_logo') {
                    return el ? { title: 'hotel_logo', value: hotel[el] } : ''
                    // return el ? hotel[el] : ''
                }
                else if (el === 'upiId') {
                    return el ? { title: 'upiId', value: hotel[el] } : ''
                    // return el ? hotel[el] : ''
                }

                else if (el === 'gst_no') {

                    data = `GSTIN = ${hotel[el]}`

                    return el ? { title: 'gst_no', value: data } : ''
                    // return el ? data : ''
                } else if (el === 'fssai_no') {
                    data = `FSSAI_No :${hotel[el]} `
                    return el ? { title: 'fssai_no', value: data } : ''
                    // return el ? data : ''
                }
                else if (el === 'restaurant_number') {
                    data = `Mo.${hotel.contact1}`
                    return el ? { title: 'restaurant_number', value: data } : ''
                    // return el ? data : ''
                } else if (el === "address") {
                    data = hotel.address1 + " " + hotel.address2
                    return el ? { title: 'address', value: data } : ''
                    // return el ? data : ''
                } else if (hotel[el]) {
                    data = hotel[el]
                    return el ? { title: el, value: data } : ''
                    // return el ? data : ''
                }
                else {
                    data = el
                    return el ? { title: 'other', value: data } : { title: 'other', value: '' }
                    // return el ? data : ''
                }


            })
        }
        const data = []
        const kotData = []
        let kotPrint = false
        if (hotel.bill_with_kot == "2") {
            kotPrint = true
        } else if (hotel.bill_with_kot == "0" && order.order_type === "pickup") {
            kotPrint = true
        } else if (hotel.bill_with_kot == "1" && order.order_type === "dinin") {
            kotPrint = true
        } else {
            kotPrint = false
        }

        for (const element of printer) {
            if (kotPrint) {

                const data = {
                    origin: req.headers.origin,
                    printerSize: printer.printer_size,
                    printer: element,
                    items,
                    order_type: order.order_type,
                    order_id: order.isOffline ? `${order.bill_no}-OFF` : order.bill_no,
                    restaurantName: hotel.hotel_name,
                    userOrTableNo: tableAndUserInfo,

                    timeAndDate,
                    kotNumber: 1,
                    token: order.token
                }
                kotData.push(data)
            }

            const singleData = {
                customerName: user?.name,
                customerNumber: user?.number,
                gstin: user?.gstin,
                address: user.address || "",
                footerText,
                headerText,
                dateAndTime: timeAndDate,
                orderId: order.isOffline ? `${order.bill_no}-OFF` : order.bill_no,
                restaurantName: hotel.hotel_name,
                bottomText: hotel.invoiceFormateBottomText,
                restaurantNumber: hotel.contact1,
                restaurantAddress: `${hotel.address1} ${hotel.address2}`,
                items,
                tableAndUserInfo,
                type,
                printerSize: element.printer_size,
                printer: element,
                // paymentMode: order.payment_type,
                subtotal,
                gst: order.gst,
                orderTax: order.hms_order_tax_msts,
                totalBill: order.grandAmount,
                token: order.token,
                service_charge: order.service_charge,
                totalQty,
                totalDiscount: order.totalDiscount,
                origin: req.headers.origin,

            }
            data.push(singleData)
        }



        //createLogFile(req.user, `ADMIN BillData /Bill Printed `, data)

        // await t.rollback()hotel

        let tokenPrint = 0

        if (order.token > 0) {
            // console.log(hotel.bill_with_token == "2", "2 Token", hotel.bill_with_token == "0" && order.order_type === "pickup", "0 Token", hotel.bill_with_token == "1" && order.order_type === "dinin", "1 Token",)
            if (hotel.bill_with_token == "2") {
                tokenPrint = order.token
            } else if (hotel.bill_with_token == "0" && order.order_type === "pickup") {
                tokenPrint = order.token
            } else if (hotel.bill_with_token == "1" && order.order_type === "dinin") {
                tokenPrint = order.token
            } else {
                tokenPrint = 0
            }
        }

        return res.json(success(MESSAGE.SUCCESS, {
            data, logoAvailable, tokenPrint, kotPrint, kotData,
            multiLanguage: hotel.multiLanguage
        }, STATUSCODE.SUCCESS))
    } catch (err) {
        // await t.rollback()
        console.log(err)
        //createLogFile(req.user, `AdminBillData /err Error`, { err })
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

const getHearderAndFooterData = async (hotel, grandAmount) => {
    const headerContent = []
    const footerContent = []

    const upiId = hotel?.upiId || ""; // Replace with your UPI ID
    const merchantName = encodeURIComponent(hotel?.hotel_name || ""); // Using first line of header as merchant name
    const transactionNote = encodeURIComponent(`Bill Payment - ${0}`);
    const amount = grandAmount;

    // Construct UPI URL
    const upiUrl = `upi://pay?pa=${upiId}&pn=${merchantName}&tn=${transactionNote}&am=${amount}&cu=INR`;

    // Generate QR code as base64
    const qrCodeImage = await qrcode.toDataURL(upiUrl, {
        width: 150,
        margin: 2
    });


    if (hotel.hms_invoice_formate_mst?.dataValues) {

        for (let key of Object.keys(hotel.hms_invoice_formate_mst?.dataValues)) {
            if (key.includes("header")) {
                headerContent.push({ fontSize: hotel.hms_invoice_formate_mst?.dataValues["fontH" + key.split("Line")[1]], value: hotel.hms_invoice_formate_mst?.dataValues[key] })
            } if (key.includes("footer")) {
                footerContent.push({ fontSize: hotel.hms_invoice_formate_mst?.dataValues["fontF" + key.split("Line")[1]], value: hotel.hms_invoice_formate_mst?.dataValues[key] })
            }

        }
    }
    const headerText = headerContent.map((el) => {

        let data = ""
        if (el.value == "marketing_text") {
            data = hotel.invoiceFormateHeaderText
            return el.value ? `<p style="font-size:${el.fontSize ? el.fontSize + " !important" : ""}" class="${el.value === 'hotel_name ' ? 'hotel-name ' : ''}" > ${data} </p>` : ''
        }
        else if (el.value === 'hotel_logo') {
            // const paths = path.join(__dirname, "../", "public", "images")
            return el.value ? `<img style="height:auto; max-width:150px " src="${process.env.SUPER_URL}/images/${hotel[el.value]}"/> ` : ''
        }
        else if (el.value === 'upiId') {

            // const paths = path.join(__dirname, "../", "public", "images")
            return el.value ? `<img style="height:auto; max-width:150px" src="${qrCodeImage}"/> ` : ''
        }

        else if (el.value === 'gst_no') {

            data = `GSTIN = ${hotel[el.value]}`
            return el.value ? `<p style="font-size:${el.fontSize ? el.fontSize + " !important" : ""}" class="${el.value === 'hotel_name' ? 'hotel-name' : ''}"> ${data} </p>` : ''
        } else if (el.value === 'fssai_no') {
            data = `FSSAI_No :${hotel[el.value]} `
            return el.value ? `<p style="font-size:${el.fontSize ? el.fontSize + " !important" : ""}" class="${el.value === 'hotel_name' ? 'hotel-name' : ''}"> ${data} </p>` : ''
        }
        else if (el.value === 'restaurant_number') {
            data = `Mo.${hotel.contact1}`
            return el.value ? `<p style="font-size:${el.fontSize ? el.fontSize + " !important" : ""}"  class="${el.value === 'hotel_name' ? 'hotel-name' : ''}"> ${data} </p>` : ''
        } else if (el.value === "address") {
            data = hotel.address1 + " " + hotel.address2
            return el.value ? `<p style="font-size:${el.fontSize ? el.fontSize + " !important" : ""}" class="${el.value === 'hotel_name' ? 'hotel-name' : ''}"> ${data} </p>` : ''
        } else if (hotel[el.value]) {
            data = hotel[el.value]
            return el.value ? `<p  style="font-size:${el.fontSize ? el.fontSize + " !important" : ""}" class="${el.value === 'hotel_name' ? 'hotel-name' : ''}"> ${data} </p>` : ''
        }
        else {
            data = el.value
            return el.value ? `<p style="font-size:${el.fontSize ? el.fontSize + " !important" : ""}" class="${el.value === 'hotel_name' ? 'hotel-name' : ''}"> ${data} </p>` : ''
        }

    }
    )

    const footerText = footerContent.map((el) => {
        let data = ""
        if (el.value == "marketing_text") {
            data = hotel.invoiceFormateBottomText
            return el.value ? `<p style="font-size:${el.fontSize ? el.fontSize + " !important" : ""}" class="${el.value === 'hotel_name' ? 'hotel-name invoice-grand-total' : 'invoice-grand-total'}"> ${data} </p>` : ''
        }
        else if (el.value === 'hotel_logo') {
            // const paths = path.join(__dirname, "../", "public", "images")
            return el.value ? `<img class="invoice-grand-total" style="height:auto" src="${process.env.SUPER_URL}/images/${hotel[el.value]}"/> ` : ''
        }

        else if (el.value === 'upiId') {

            // const paths = path.join(__dirname, "../", "public", "images")
            return el.value ? `<img style="height:auto; max-width:150px" src="${qrCodeImage}"/> ` : ''
        }
        else if (el.value === 'gst_no') {

            data = `GSTIN = ${hotel[el.value]}`
            return el.value ? `<p style="font-size:${el.fontSize ? el.fontSize + " !important" : ""}" class="${el.value === 'hotel_name' ? 'hotel-name invoice-grand-total' : 'invoice-grand-total'}"> ${data} </p>` : ''
        } else if (el.value === 'fssai_no') {
            data = `FSSAI_No :${hotel[el.value]} `
            return el.value ? `<p style="font-size:${el.fontSize ? el.fontSize + " !important" : ""}" class="${el.value === 'hotel_name' ? 'hotel-name invoice-grand-total' : 'invoice-grand-total'}"> ${data} </p>` : ''
        }
        else if (el.value === 'restaurant_number') {
            data = `Mo.${hotel.contact1}`
            return el.value ? `<p style="font-size:${el.fontSize ? el.fontSize + " !important" : ""}" class="${el.value === 'hotel_name' ? 'hotel-name invoice-grand-total' : 'invoice-grand-total'}"> ${data} </p>` : ''
        } else if (el.value === "address") {
            data = hotel.address1 + " " + hotel.address2
            return el.value ? `<p style="font-size:${el.fontSize ? el.fontSize + " !important" : ""}" class="${el.value === 'hotel_name' ? 'hotel-name invoice-grand-total' : 'invoice-grand-total'}"> ${data} </p>` : ''
        } else if (hotel[el.value]) {
            data = hotel[el.value]
            return el.value ? `<p style="font-size:${el.fontSize ? el.fontSize + " !important" : ""}" class="${el.value === 'hotel_name' ? 'hotel-name invoice-grand-total' : 'invoice-grand-total'}"> ${data} </p>` : ''
        }
        else {
            data = el.value
            return el.value ? `<p style="font-size:${el.fontSize ? el.fontSize + " !important" : ""}" class="${el.value === 'hotel_name' ? 'hotel-name invoice-grand-total' : 'invoice-grand-total'}"> ${data} </p>` : ''
        }
    })
    return { headerText, footerText }
}
const getHearderAndFooterDataBillView = async (hotel, grandAmount) => {
    const headerContent = []
    const footerContent = []

    const upiId = hotel?.upiId || ""; // Replace with your UPI ID
    const merchantName = encodeURIComponent(hotel?.hotel_name || ""); // Using first line of header as merchant name
    const transactionNote = encodeURIComponent(`Bill Payment - ${0}`);
    const amount = grandAmount;

    // Construct UPI URL
    const upiUrl = `upi://pay?pa=${upiId}&pn=${merchantName}&tn=${transactionNote}&am=${amount}&cu=INR`;

    // Generate QR code as base64
    const qrCodeImage = await qrcode.toDataURL(upiUrl, {
        width: 150,
        margin: 2
    });


    if (hotel.hms_invoice_formate_mst?.dataValues) {

        for (let key of Object.keys(hotel.hms_invoice_formate_mst?.dataValues)) {
            if (key.includes("header")) {
                headerContent.push({ value: hotel.hms_invoice_formate_mst?.dataValues[key] })
            } if (key.includes("footer")) {
                footerContent.push({ value: hotel.hms_invoice_formate_mst?.dataValues[key] })
            }

        }
    }
    const headerText = headerContent.map((el) => {

        let data = ""
        if (el.value == "marketing_text") {
            data = hotel.invoiceFormateHeaderText
            return el.value ? `<p style="font-size:${el.fontSize ? el.fontSize + " !important" : ""}" class="${el.value === 'hotel_name ' ? 'hotel-name ' : ''}" > ${data} </p>` : ''
        }
        else if (el.value === 'hotel_logo') {
            // const paths = path.join(__dirname, "../", "public", "images")
            return el.value ? `<img style="height:auto; max-width:150px " src="${process.env.SUPER_URL}/images/${hotel[el.value]}"/> ` : ''
        }
        else if (el.value === 'upiId') {

            // const paths = path.join(__dirname, "../", "public", "images")
            return el.value ? `<img style="height:auto; max-width:150px" src="${qrCodeImage}"/> ` : ''
        }

        else if (el.value === 'gst_no') {

            data = `GSTIN = ${hotel[el.value]}`
            return el.value ? `<p style="font-size:${el.fontSize ? el.fontSize + " !important" : ""}" class="${el.value === 'hotel_name' ? 'hotel-name' : ''}"> ${data} </p>` : ''
        } else if (el.value === 'fssai_no') {
            data = `FSSAI_No :${hotel[el.value]} `
            return el.value ? `<p style="font-size:${el.fontSize ? el.fontSize + " !important" : ""}" class="${el.value === 'hotel_name' ? 'hotel-name' : ''}"> ${data} </p>` : ''
        }
        else if (el.value === 'restaurant_number') {
            data = `Mo.${hotel.contact1}`
            return el.value ? `<p style="font-size:${el.fontSize ? el.fontSize + " !important" : ""}"  class="${el.value === 'hotel_name' ? 'hotel-name' : ''}"> ${data} </p>` : ''
        } else if (el.value === "address") {
            data = hotel.address1 + " " + hotel.address2
            return el.value ? `<p style="font-size:${el.fontSize ? el.fontSize + " !important" : ""}" class="${el.value === 'hotel_name' ? 'hotel-name' : ''}"> ${data} </p>` : ''
        } else if (hotel[el.value]) {
            data = hotel[el.value]
            return el.value ? `<p  style="font-size:${el.fontSize ? el.fontSize + " !important" : ""}" class="${el.value === 'hotel_name' ? 'hotel-name' : ''}"> ${data} </p>` : ''
        }
        else {
            data = el.value
            return el.value ? `<p style="font-size:${el.fontSize ? el.fontSize + " !important" : ""}" class="${el.value === 'hotel_name' ? 'hotel-name' : ''}"> ${data} </p>` : ''
        }

    }
    )

    const footerText = footerContent.map((el) => {
        let data = ""
        if (el.value == "marketing_text") {
            data = hotel.invoiceFormateBottomText
            return el.value ? `<p style="font-size:${el.fontSize ? el.fontSize + " !important" : ""}" class="${el.value === 'hotel_name' ? 'hotel-name invoice-grand-total' : 'invoice-grand-total'}"> ${data} </p>` : ''
        }
        else if (el.value === 'hotel_logo') {
            // const paths = path.join(__dirname, "../", "public", "images")
            return el.value ? `<img class="invoice-grand-total" style="height:auto" src="${process.env.SUPER_URL}/images/${hotel[el.value]}"/> ` : ''
        }

        else if (el.value === 'upiId') {

            // const paths = path.join(__dirname, "../", "public", "images")
            return el.value ? `<img style="height:auto; max-width:150px" src="${qrCodeImage}"/> ` : ''
        }
        else if (el.value === 'gst_no') {

            data = `GSTIN = ${hotel[el.value]}`
            return el.value ? `<p style="font-size:${el.fontSize ? el.fontSize + " !important" : ""}" class="${el.value === 'hotel_name' ? 'hotel-name invoice-grand-total' : 'invoice-grand-total'}"> ${data} </p>` : ''
        } else if (el.value === 'fssai_no') {
            data = `FSSAI_No :${hotel[el.value]} `
            return el.value ? `<p style="font-size:${el.fontSize ? el.fontSize + " !important" : ""}" class="${el.value === 'hotel_name' ? 'hotel-name invoice-grand-total' : 'invoice-grand-total'}"> ${data} </p>` : ''
        }
        else if (el.value === 'restaurant_number') {
            data = `Mo.${hotel.contact1}`
            return el.value ? `<p style="font-size:${el.fontSize ? el.fontSize + " !important" : ""}" class="${el.value === 'hotel_name' ? 'hotel-name invoice-grand-total' : 'invoice-grand-total'}"> ${data} </p>` : ''
        } else if (el.value === "address") {
            data = hotel.address1 + " " + hotel.address2
            return el.value ? `<p style="font-size:${el.fontSize ? el.fontSize + " !important" : ""}" class="${el.value === 'hotel_name' ? 'hotel-name invoice-grand-total' : 'invoice-grand-total'}"> ${data} </p>` : ''
        } else if (hotel[el.value]) {
            data = hotel[el.value]
            return el.value ? `<p style="font-size:${el.fontSize ? el.fontSize + " !important" : ""}" class="${el.value === 'hotel_name' ? 'hotel-name invoice-grand-total' : 'invoice-grand-total'}"> ${data} </p>` : ''
        }
        else {
            data = el.value
            return el.value ? `<p style="font-size:${el.fontSize ? el.fontSize + " !important" : ""}" class="${el.value === 'hotel_name' ? 'hotel-name invoice-grand-total' : 'invoice-grand-total'}"> ${data} </p>` : ''
        }
    })
    return { headerText, footerText }
}
const rePrintAdminBillData = async (req, res) => {
    try {
        const id = req.user

        const { orderId } = req.body

        const hotel = await Hotel.findOne({ where: { id }, include: { model: InvoiceFormate } })
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.NOT_FOUND))

        // const printer = await PrinterSetting.findOne({ where: { default: true, print_type: 'I', hotel_id: req.user } })

        // if (!printer) {
        //     return res.json(error("Printer Not Set", STATUSCODE.BAD_REQUEST))
        // }



        const order = await Order.findOne({ where: { hotel_id: req.user, id: orderId }, include: { model: OrderTax, include: { mode: TaxType } } })

        if (!order) return res.json(error(MESSAGE.ORDER_NOT_FOUND, STATUSCODE
            .NOT_FOUND))
        const invoicePrinters = JSON.parse(JSON.stringify(await PrinterSetting.findAll({
            where: {
                hotel_id: req.user, print_type: 'I',
            }, attributes: ['number_of_copies', 'printer_name', 'id', 'printer_size', 'order_type', "table_ids"]
        })))


        const printer = []
        for (const element of invoicePrinters) {
            if ((element.order_type.includes(order.order_type) || !element.order_type.length)) {
                if (order.order_type !== "pickup") {
                    if ((element.table_ids.includes(order.TableId) || !element.table_ids.length)) {

                        printer.push(element)
                    }
                } else {
                    printer.push(element)

                }
            }
        }
        if (!printer.length) {
            return res.json(error("Printer Not Set", STATUSCODE.BAD_REQUEST))
        }
        if (order.order_type === "dinin") {

            const orderDetails = await OrderDetails.findAll({ where: { orderId: order?.dataValues.id, hotel_id: req.user, status: ORDER_DETAILS_TYPE.DELIVERED, payment_status: STATUS.SUCCESS }, include: { model: Variants, as: "variantData" } })

            if (!orderDetails.length) return res.json(error(MESSAGE.ORDERDETAILS_NOT_FOUND, STATUSCODE
                .NOT_FOUND))



            const items = []
            let totalQty = 0;
            for (const cur of orderDetails) {
                const documents = {}
                const menuData = await Menu.findOne({ where: { id: cur.MenuId, hotel_id: req.user } })
                documents.item_name = menuData.item_name
                documents.variantData = cur.variantData
                documents.addons = cur?.addons?.length ? cur.addons : []
                documents.price = cur.price
                documents.qty = cur.qty
                documents.totalAmount = cur.price * cur.qty
                items.push(documents)
                totalQty += cur.qty
            }
            const currentDate = new Date();
            const timeAndDate = moment(order.createdAt).format("DD/MM/YYYY hh:mm a")
            const subtotal = order.totalAmount
            let user
            let table
            let tableAndUserInfo
            if (order.UserId) {
                user = await User.findOne({ where: { id: order.UserId } })
                tableAndUserInfo = `UserName : ${user.name}`
            }
            if (order.TableId) {
                table = await Table.findOne({ where: { id: order?.TableId } })
                tableAndUserInfo = `${table.type === "T" ? "Table No" : "Room No:"} ${table.table_name}`
            }
            const type = order.order_type = "pickup" ? "Pick Up" : "Dine In";
            const { headerText, footerText } = await getHearderAndFooterData(hotel, order.grandAmount)
            // console.log(headerText, "Header Tax::::")
            const data = {
                customerName: user?.name,
                customerNumber: user?.number,
                addr: user?.address,
                gstin: user?.gstin,
                footerText,
                headerText,
                dateAndTime: timeAndDate,
                orderId: order.isOffline ? `${order.bill_no}-OFF` : order.bill_no,
                restaurantName: hotel.hotel_name,
                restaurantNumber: hotel.contact1,
                restaurantAddress: `${hotel.address1} ${hotel.address2}`,
                bottomText: hotel.invoiceFormateBottomText,
                service_charge: order.service_charger,
                items,
                orderTax: order.hms_order_tax_msts,
                printerSize: printer.printer_size,
                tableAndUserInfo,
                type,
                subtotal,
                gst: order.gst,
                totalBill: order.grandAmount,
                totalQty, totalDiscount: order.totalDiscount,
                origin: req.headers.origin,
                currentcy: hotel.currentcy
            }

            await generateInvoicePDF(data, path.join(__dirname, "../", "public", "pdf", `order${order.id}.pdf`))
            //createLogFile(req.user, `RePrinted BillData /Reprinted Data `, data)

            return res.json(success(MESSAGE.SUCCESS, { printerName: printer.printer_name, orderId: order.id }, STATUSCODE.SUCCESS))

        }

        const orderDetails = await OrderDetails.findAll({ where: { orderId: order?.dataValues.id, hotel_id: req.user, status: ORDER_DETAILS_TYPE.DELIVERED, payment_status: STATUS.SUCCESS }, include: { model: Variants, as: "variantData" } })
        if (!orderDetails.length) return res.json(error(MESSAGE.ORDERDETAILS_NOT_FOUND, STATUSCODE
            .NOT_FOUND))



        const items = []
        let totalQty = 0;
        for (const cur of orderDetails) {
            const documents = {}
            const menuData = await Menu.findOne({ where: { id: cur.MenuId, hotel_id: req.user } })
            documents.item_name = menuData.item_name
            documents.variantData = cur?.variantData
            documents.price = cur.price
            documents.addons = cur?.addons?.length ? cur.addons : []
            documents.qty = cur.qty
            documents.totalAmount = cur.price * cur.qty
            items.push(documents)
            totalQty += cur.qty
        }


        const currentDate = new Date();

        const timeAndDate = moment(order.createdAt).format("DD/MM/YYYY hh:mm a")

        const subtotal = order.totalAmount

        let user
        let table
        let tableAndUserInfo
        if (order.UserId) {
            user = await User.findOne({ where: { id: order.UserId } })
            tableAndUserInfo = `UserName : ${user.name}`
        }
        if (order.TableId) {
            table = await Table.findOne({ where: { id: order?.TableId } })
            tableAndUserInfo = `${table.type === "T" ? "Table No" : "Room No:"} ${table.table_name}`
        }
        const type = order.order_type = "pickup" ? "Pick Up" : "Dine In";
        const { headerText, footerText } = await getHearderAndFooterData(hotel, order.grandAmount)
        const data = []

        for (const element of printer) {

            const printDetials = {
                footerText,
                headerText,
                dateAndTime: timeAndDate,
                orderId: order.isOffline ? `${order.bill_no}-OFF` : order.bill_no,
                restaurantName: hotel.hotel_name,
                restaurantNumber: hotel.contact1,
                restaurantAddress: `${hotel.address1} ${hotel.address2}`, bottomText: hotel.invoiceFormateBottomText,
                items,
                printerSize: element.printer_size,
                printer: element,
                tableAndUserInfo,
                orderTax: order.hms_order_tax_msts,
                customerName: user?.name,
                customerNumber: user?.number,
                gstin: user?.gstin,
                type,
                subtotal,
                gst: order.gst,
                totalBill: order.grandAmount,
                totalQty,
                totalDiscount: order.totalDiscount,
                origin: req.headers.origin
            }
            data.push(printDetials)

        }


        // await generateInvoicePDF(data, path.join(__dirname, "../", "public", "pdf", `order${order.id}.pdf`))
        // createLogFile(req.user, `RePrinted BillData /Reprinted Data `, data)
        await OrderDetails.update({ payment_status: "success" }, { where: { orderId: order.id, hotel_id: req.user, payment_status: "pending" } })
        await Order.update({ payment: "success" }, { where: { id: order.id, hotel_id: req.user, payment: "pending" } })
        // await addToTimeLine(order.id, "re print Bill")
        return res.json(success(MESSAGE.SUCCESS, { data, printerName: printer.printer_name, orderId: order.id }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err)
        //createLogFile(req.user, `rePrintAdminBillData/err Error`, { err })
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

const reprintkot = async (req, res) => {
    try {
        const hotel = await Hotel.findOne({ where: { id: req.user }, include: { model: InvoiceFormate } })

        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.NOT_FOUND))
        const { kotNumber, orderId, items } = req.body


        const itemsdetails = JSON.parse(JSON.stringify(await OrderDetails.findOne({ where: { hotel_id: req.user, kotNumber, orderId }, include: [{ model: Table, include: { model: TableCatagories } }, { model: User }] })))
        // console.log(itemsdetails, "ItemDetaisl-->")
        if (!itemsdetails) return res.json(error(MESSAGE.CART_ITEM_NOT_AVAILABLE, STATUSCODE.BAD_REQUEST))
        let userOrTableNo = itemsdetails.order_type === "pickup" ? `${itemsdetails.hms_user_master?.name ? `Customer Name :${itemsdetails.hms_user_master?.name}` : ""}` : `${itemsdetails.hms_table_mst.type === "T" ? "Table No" : "Room No:"} ${itemsdetails.hms_table_mst.table_name}`
        const timeAndDate = moment().format("DD/MM/YYYY hh:mm a")

        const orderInformation = await Order.findOne({ where: { id: orderId, hotel_id: req.user } })
        if (!orderInformation) return res.json(error(MESSAGE.ORDER_NOT_FOUND, STATUSCODE.BAD_REQUEST))

        const checkDefaultPrinterSetting = await PrinterSetting.findAll({ where: { hotel_id: req.user, print_type: "K" } });

        const printerWithThereItems = arranPrintersForKotWithTheseItems(checkDefaultPrinterSetting, items[0].menuItems, orderInformation.order_type, orderInformation?.TableId)

        // if (checkDefaultPrinterSetting) {
        const data = []
        for (const element of printerWithThereItems) {

            const itemDetails = {
                origin: req.headers.origin,
                printerSize: element.printer_size,
                printer: element.printer,
                items: element.items,
                order_type: orderInformation.order_type,
                order_id: orderInformation.isOffline ? `${orderInformation.bill_no}-OFF` : orderInformation.bill_no,
                restaurantName: hotel.hotel_name,
                userOrTableNo,
                timeAndDate,
                kotNumber: 1
                // status: kotMax === 1 ? "New" : "Running"
            }
            data.push(itemDetails)
        }

        return res.json(success(STATUS.SUCCESS, { message: MESSAGE.KOT_GENERATED, data, orderId: orderInformation.id, printersForPrint: checkDefaultPrinterSetting, multi: false, restaurantName: hotel.hotel_name }, STATUSCODE.SUCCESS))


    } catch (err) {
        console.log(err)
        //createLogFile(req.user, `reprintkot/err Error`, { err })
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

const removeAdminAllCart = async (req, res) => {
    try {

        const hotel = await Hotel.findOne({ where: { id: req.user } })
        if (!hotel) return res.json(error(MESSAGE.USER_NOT_FOUND, STATUSCODE.NOT_FOUND))

        const { MenuId, orderId, kotNumber, variant_id } = req.body

        if (orderId) {
            let condition = { MenuId, OrderId: orderId, hotel_id: req.user, kotNumber, status: ORDER_DETAILS_TYPE.KOT }
            if (variant_id) {
                condition = { MenuId, OrderId: orderId, hotel_id: req.user, kotNumber, status: ORDER_DETAILS_TYPE.KOT, variant_id }
            }
            const alreadyItemAvailable = await OrderDetails.findOne({ where: { ...condition } })

            // await createLogFile(req.user, "nkbdsjkxmnzbm nm===>", alreadyItemAvailable)

            // const MenuItem = await Menu.findOne({ where: { id: MenuId, hotel_id: req.user } })
            if (alreadyItemAvailable) {
                // const order = await Order.findOne({ where: { id: orderId, hotel_id: req.user } })
                // let gst = 0

                // let grandAmount = 0
                // let totalAmount = order.totalAmount - alreadyItemAvailable.qty * alreadyItemAvailable.price
                // if (hotel.invoiceFormateIncGst && MenuItem.gst_type === 'S') {

                //     gst = (order.gst - ((alreadyItemAvailable.qty * alreadyItemAvailable.price * 5) / 100))
                //     grandAmount = Math.round(order.grandAmount - ((alreadyItemAvailable.qty * alreadyItemAvailable.price * 5) / 100) - alreadyItemAvailable.qty * alreadyItemAvailable.price)

                // } else {
                //     gst = order.gst
                //     grandAmount = Math.round(order.grandAmount - alreadyItemAvailable.qty * alreadyItemAvailable.price)
                // }

                // await Order.update({ totalAmount, gst, grandAmount }, { where: { id: orderId, hotel_id: req.user } })
                //createLogFile(req.user, `removeAdminAllCart /  Updated `, { totalAmount, gst, grandAmount, where: { id: orderId, hotel_id: req.user } })
                await OrderDetails.destroy({ where: { id: alreadyItemAvailable.id } })
                //createLogFile(req.user, `removeAdminAllCart /  Destroy `, { where: { id: alreadyItemAvailable.id } })
                await removeKotItemFromKds(orderId, req.user, kotNumber, alreadyItemAvailable.id)
                //createLogFile(req.user, `FindAdminOrder Detials===========>`, alreadyItemAvailable)
                // setImmediate(() => {
                await updateOrderAppendToRadis(orderId, req.user)

                // });
                return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { id: alreadyItemAvailable.id, message: MESSAGE.ITEM_IS_REMOVE_FROM_CART }, STATUSCODE.SUCCESS))
                // return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { message: MESSAGE.ITEM_IS_REMOVE_FROM_CART }, STATUSCODE.SUCCESS))
            }


            return res.json(error(MESSAGE.CART_ITEM_NOT_AVAILABLE, STATUSCODE.NOT_FOUND))
        }

        return res.json(error(MESSAGE.CART_ITEM_NOT_AVAILABLE, STATUSCODE.NOT_FOUND))
    } catch (err) {
        //createLogFile(req.user, `removeAdminAllCart/err Error`, { err })
        console.log(err, "=====>error")
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

const cancelOrder = async (req, res) => {
    try {

        const hotel = await Hotel.findOne({ where: { id: req.user } })
        if (!hotel) return res.json(error(MESSAGE.USER_NOT_FOUND, STATUSCODE.NOT_FOUND))
        // console.log(req.user)
        const h = await AdminCart.destroy({ where: { hotel_id: req.user } })
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { message: MESSAGE.ITEM_IS_REMOVE_FROM_CART }, STATUSCODE.SUCCESS))
        // }
        // return res.json(error(MESSAGE.CART_NOT_FOUND, STATUSCODE.NOT_FOUND))
    } catch (err) {
        // console.log(err)
        //createLogFile(req.user, `cancelOrder/err Error`, err)
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

const addComment = async (req, res) => {
    try {

        const { id, comment, discount } = req.body
        const hotel = await Hotel.findOne({ where: { id: req.user } })
        if (!hotel) return res.json(error(MESSAGE.USER_NOT_FOUND, STATUSCODE.NOT_FOUND))

        const alreadyItemAvailable = await AdminCart.findOne({ where: { MenuId: id, hotel_id: req.user } })
        if (alreadyItemAvailable) {
            await AdminCart.update({ comment, discount }, { where: { MenuId: id, hotel_id: req.user } })
            return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { message: "comment Added" }, STATUSCODE.SUCCESS))
        } else {
            return res.json(error(MESSAGE.CART_ITEM_NOT_AVAILABLE, STATUSCODE.NOT_FOUND))
        }

    } catch (err) {
        // console.log(err)
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

const deletePdf = async (req, res) => {
    try {
        const { fileName } = req.params

        const filePath = path.join(__dirname, "../", "public", "pdf", fileName);
        await fs.unlinkSync(filePath)
        console.log('File deleted successfully');
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { message: "pdf deleted" }, STATUSCODE.SUCCESS));
    } catch (err) {
        console.log(err)
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

const setPrinter = async (req, res) => {
    try {

        const hotel = await Hotel.findOne({ where: { id: req.user } })
        if (!hotel) return res.json(error(MESSAGE.USER_NOT_FOUND, STATUSCODE.NOT_FOUND))

        const { kotPrinter, invoicePrinter } = req.body
        Hotel.update({ kotPrinter, invoicePrinter }, { where: { id: hotel.id } })
        return res.json(success(MESSAGE.SUCCESS, { message: "Printer Set" }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err)
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

const test = async (req, res) => {
    try {
        const { order_id } = req.body
        // console.log(order_id)
        if (order_id) {

            const orders = await Order.findOne({
                where: { id: order_id },
                include: [{ model: OrderDetails, right: true }]
            })
            // console.log(orders.hms_orderDetails)
        }
    } catch (err) {
        // console.log(err)
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}


const settleBills = async (req, res) => {
    try {
        let { id, cash, upi, card, amount, due = 0, mobile } = req.body;

        // ✅ DEFAULT VALUES
        cash = cash || 0;
        upi = upi || 0;
        card = card || 0;

        // ✅ PAYMENT VALIDATION
        if (amount > 0 && !(cash || upi || card || due)) {
            return res.json(error(MESSAGE.PAYMENT_MODE_NOT_SELECTED, STATUSCODE.BAD_REQUEST));
        }

        if (+cash + +upi + +card + +due !== amount) {
            return res.json(error(MESSAGE.A_M_S_P_A, STATUSCODE.INTERNAL_SERVER_ERROR));
        }

        const hotel = await Hotel.findOne({ where: { id: req.user } });
        if (!hotel) {
            return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST));
        }

        const order = await Order.findOne({
            where: {
                id,
                hotel_id: req.user,
                order_type: ORDER_TYPE.DININ,
                payment: "pending",
                deleted: false
            }
        });

        if (!order) {
            return res.json(error("Refresh And Try Again", STATUSCODE.BAD_REQUEST));
        }

        /* =====================================================
           ❌ REMOVED OLD LOGIC (DO NOT USE)
           -----------------------------------------------------
           - Randomly searched user by mobile
           - Reassigned Order.UserId blindly
           - Ignored placeholder user logic
        ====================================================== */

        /*
        ❌ REMOVED:
        let user = await User.findOne({ where: { number: mobile } })
        if (!user) {
            user = await User.create({ number: mobile })
        }
        await Order.update({ UserId: user.id }, { where: { id: order.id } })
        */

        /* =====================================================
           ✅ NEW & UPDATED USER HANDLING (CORRECT)
           -----------------------------------------------------
           RULES:
           - Mobile is entered at settlement
           - Placeholder user → upgraded
           - Real user → number updated
           - Order.UserId is NEVER randomly replaced
        ====================================================== */

        if (due > 0) {

            // ✅ Mobile REQUIRED for due
            if (!mobile || `${mobile}`.length !== 10) {
                return res.json(
                    error("Valid mobile number is required for due payment", STATUSCODE.BAD_REQUEST)
                );
            }

            const orderUser = await User.findOne({
                where: {
                    id: order.UserId,
                    hotel_id: req.user
                }
            });

            if (!orderUser) {
                return res.json(
                    error("Order user not found", STATUSCODE.INTERNAL_SERVER_ERROR)
                );
            }

            // 🟡 CASE 1: Placeholder user → upgrade to real user
            if (orderUser.isPlaceholder) {

                let realUser = await User.findOne({
                    where: {
                        number: mobile,
                        hotel_id: req.user,
                        isPlaceholder: false
                    }
                });

                // ✅ CREATE real user if not exists
                if (!realUser) {
                    realUser = await User.create({
                        number: mobile,
                        hotel_id: req.user,
                        isPlaceholder: false
                    });
                }

                // ✅ REASSIGN ORDER TO REAL USER
                await Order.update(
                    { UserId: realUser.id },
                    { where: { id: order.id } }
                );
            }

            // 🟢 CASE 2: Real user → UPDATE mobile number
            else {
                await User.update(
                    { number: mobile },
                    { where: { id: orderUser.id } }
                );
            }
        }

        /* =====================================================
           ✅ ORDER FINALIZATION
        ====================================================== */

        if (order.order_type === ORDER_TYPE.DININ) {
            await Table.update(
                { table_status: "F" },
                { where: { id: order.TableId, hotel_id: req.user } }
            );
            await updateTableToRadis(order.TableId, req.user);
        }

        // ✅ UPDATE ORDER PAYMENT
        await Order.update(
            { cash, upi, card, due, payment: STATUS.SUCCESS },
            { where: { hotel_id: req.user, id } }
        );

        // ✅ UPDATE ORDER DETAILS
        const orderDetails = await OrderDetails.findAll({
            where: { orderId: id, hotel_id: req.user }
        });

        for (const item of orderDetails) {
            await OrderDetails.update(
                { payment_status: STATUS.SUCCESS },
                { where: { id: item.id } }
            );
        }

        await deleteOrderToRedis(id, req.user);
        await addToTimeLine(id, ACTION.SETTLE, req.userId);
        await webChange(req.user, io, id);

        const stockCheck = await checkRawMaterialAvailableOrNot(
            id,
            req.user,
            req.userId
        );
        console.log(stockCheck, "Stock Check After Settlement")
        if (stockCheck.error) {
            throw new Error("Error From Stock Update");
        }

        return res.status(STATUSCODE.SUCCESS).json(
            success(MESSAGE.SUCCESS, { message: MESSAGE.ORDER_SETTLE }, STATUSCODE.SUCCESS)
        );

    } catch (err) {
        console.log(err);
        return res.json(
            error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR)
        );
    }
};

// TODO need to modify by security

const editOrderClick = async (req, res) => {
    // const t = await sequelize.transaction()
    try {
        //! paymentMode cash Upi Card added require in Edit mode
        const { orderId } = req.body
        // console.log(req.body)
        const order = await Order.findOne({ where: { id: orderId }, include: [{ model: User }, { model: Table, include: { model: TableCatagories } }] })
        if (!order) {
            // await t.rollback()
            return res.json(error(MESSAGE.ORDER_NOT_FOUND, STATUSCODE.NOT_FOUND))
        }
        const orderDetails = await OrderDetails.findAll({ where: { orderId, hotel_id: req.user } })
        // await AdminCart.destroy({ where: { hotel_id: req.user }, transaction: t })
        for (const cur of orderDetails) {

            await AdminCart.create({ MenuId: cur.MenuId, qty: cur.qty, totalAmount: cur.qty * cur.price, status: ORDER_DETAILS_TYPE.IN_PROGRESS, hotel_id: req.user })
        }

        // await t.commit()
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { order, edit: true, cash: order.cash, upi: order.upi, card: order.card }, STATUSCODE.SUCCESS))
    } catch (err) {
        // await t.rollback()
        console.log(err)
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
// TODO need to modify by security
const updateInvoice = async (req, res) => {

    try {
        // console.log(req.body, "query =====>")
        const { orderId, userName, address, mobile, cart, cash = 0, card = 0, upi = 0, due = 0, gstin, addItem } = req.body
        const { grandAmount, totalDiscount, gst, service_charger, discount_reason, discount_type, discount_value, taxes } = cart

        if (due > 0 && !mobile) {

            return res.json(error("Mobile Number Required On Due Payment", STATUSCODE.NOT_FOUND))
        }
        const totalAmount = cart.myAmount
        const order = await Order.findOne({ where: { id: orderId, hotel_id: req.user } })

        if (!order) {

            return res.json(error(MESSAGE.ORDER_NOT_FOUND, STATUSCODE.NOT_FOUND))
        }

        const cartData = cart.items.find(el => el.status === 'D' || el.status === 'H')
        if (!cartData) {

            return res.json(error(MESSAGE.CART_ITEM_NOT_AVAILABLE, STATUSCODE.BAD_REQUEST))
        }
        const AllUpdatedItems = cart.items

        if (!AllUpdatedItems.length) {

            return res.json(error(MESSAGE.CART_ITEM_NOT_AVAILABLE, STATUSCODE.BAD_REQUEST))
        }

        await OrderDetails.destroy({ where: { orderId: order.id, hotel_id: req.user } })


        let user = await findAndUpdateUser({ name: userName, number: mobile, gstin, hotel_id: req.user, address }, orderId)




        let paymentMode = false
        if ((cash || upi || card || due) || (cash + card + upi + due === grandAmount)) {
            paymentMode = true
        }
        if (!paymentMode) {
            if (!addItem) {
                // await t.rollback()
                return res.json(error(MESSAGE.PAYMENT_MODE_NOT_SELECTED, STATUSCODE.BAD_REQUEST))
            }
        }

        const highest = +card + +upi + +cash + +due

        if (highest !== grandAmount && !addItem) {
            // await t.rollback()
            return res.json(error('Please Enter Amount Same As Grand Total'))
        }

        //createLogFile(req.user, `INVOICE UPDATE /Order Updated Data `, JSON.stringify(req.body))

        await Order.update({ service_charge: service_charger, UserId: user?.id, totalAmount, gst, cash, card, upi, due, discount_reason, discount_type, discount_value, totalDiscount, grandAmount }, { where: { id: order.id, hotel_id: req.user } })
        await updateOrderTax(taxes, order.id, req.user)
        await OrderDetails.destroy({ where: { orderId: order.id, hotel_id: req.user } })

        for (const item of AllUpdatedItems) {
            for (const cur of item.menuItems) {
                console.log(cur, "cur--->")
                // console.log(cur?.variantData)
                let condition = { orderId: orderId, price: cur.price, MenuId: cur.id, hotel_id: req.user, status: { [Op.eq]: ORDER_DETAILS_TYPE.DELIVERED } }
                if (cur.variantData?.id) {
                    condition = { orderId: orderId, price: cur.price, variant_id: cur.variantData.id, MenuId: cur.id, hotel_id: req.user, status: { [Op.eq]: ORDER_DETAILS_TYPE.DELIVERED } }
                }

                const OrderDetailsAvailable = await OrderDetails.findOne({ where: { ...condition } })
                let result = false
                if (OrderDetailsAvailable) {

                    if (cur?.addons?.length) {
                        const data = matchDepartmentsAndAddonsById(OrderDetailsAvailable.addons, cur.addons)
                        if (!data) {
                            result = false
                        } else {
                            result = true
                        }
                    }
                    else {
                        result = true
                    }
                }



                // const OrderDetailsAvailable = await OrderDetails.findOne({ where: { orderId: orderId,price:cur.price, MenuId: cur.id, hotel_id: req.user, status: { [Op.eq]: ORDER_DETAILS_TYPE.DELIVERED } }, transaction: t })
                if (result) {
                    //createLogFile(req.user, `Updated ORDER/${orderId} OrderDetails OrderDetailsAvailable updated `, { totalDiscount: cur.discount + OrderDetailsAvailable.totalDiscount, qty: +cur.qty + OrderDetailsAvailable.qty, price: OrderDetailsAvailable.price, order_type: order.order_type, payment_status: order.order_type == "pickup" ? STATUS.SUCCESS : STATUS.PENDING, where: { id: OrderDetailsAvailable.id, hotel_id: req.user } })
                    await OrderDetails.update({ totalDiscount: cur.discount + OrderDetailsAvailable.totalDiscount, qty: +cur.qty + OrderDetailsAvailable.qty, price: OrderDetailsAvailable.price, order_type: order.order_type, payment_status: order.order_type == "pickup" ? STATUS.SUCCESS : STATUS.PENDING }, { where: { id: OrderDetailsAvailable.id, hotel_id: req.user } })
                }
                else {

                    let modifiedCartForOrderDetails = { MenuId: "", hotel_id: "", qty: "", orderId: "" };
                    modifiedCartForOrderDetails.MenuId = cur.id
                    modifiedCartForOrderDetails.qty = cur.qty
                    modifiedCartForOrderDetails.price = cur.price
                    modifiedCartForOrderDetails.totalDiscount = cur.discount
                    modifiedCartForOrderDetails.order_type = order.order_type
                    modifiedCartForOrderDetails.payment_status = order.order_type == "pickup" ? STATUS.SUCCESS : STATUS.PENDING
                    modifiedCartForOrderDetails.hotel_id = cur.hotel_id
                    modifiedCartForOrderDetails.orderId = orderId
                    modifiedCartForOrderDetails.variant_id = cur?.variantData?.id ? cur?.variantData?.id : null
                    modifiedCartForOrderDetails.variant_name = cur?.variantData?.variants_name ? cur?.variantData?.variants_name : null
                    modifiedCartForOrderDetails.addons = cur?.addons?.length ? cur.addons : []
                    modifiedCartForOrderDetails.status = ORDER_DETAILS_TYPE.DELIVERED
                    //createLogFile(req.user, `ADMIN ORDER/${orderId} OrderDetails created`, JSON.stringify(modifiedCartForOrderDetails))
                    if (cur?.custom) {
                        const { price, item_name } = cur
                        const menu = await Menu.create({ price, item_name, active: false, hotel_id: req.user })
                        modifiedCartForOrderDetails = {
                            MenuId: menu.id,
                            variant_id: cur.variantData?.id ? cur.variantData?.id : null,
                            variant_name: cur.variantData?.id ? cur.variantData?.variants_name : null,
                            qty: +cur.qty,
                            price: +cur.price,
                            totalDiscount: cur?.discount,
                            TableId: order?.TableId,
                            UserId: user?.id,
                            order_type: order.order_type,
                            payment_status: STATUS.PENDING,
                            hotel_id: req.user,
                            orderId: order.id,
                            status: ORDER_DETAILS_TYPE.DELIVERED,
                            addons: cur?.addons
                        };
                    }
                    const orderDetails = await OrderDetails.create(modifiedCartForOrderDetails)
                }
            }
        }
        await addToTimeLine(orderId, ACTION.UPDATEORDER, req.userId)
        await webChange(req.user, io, orderId)
        await updateOrderAppendToRadis(orderId, req.user)
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { message: MESSAGE.ORDER_EDITED_SUCCESSFULLY }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err)
        // await t.rollback()
        //createLogFile(req.user, `updateInvoice/err Error`, { err })
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const updatedInvoiceItems = async (req, res) => {
    // const t = await sequelize.transaction()
    try {
        // console.log(req.body, "query =====>")
        const { orderId, userName, address, mobile, cart, gstin } = req.body

        const { grandAmount, totalDiscount, gst, service_charger, discount_reason, discount_type, discount_value } = cart
        const totalAmount = cart.myAmount

        const order = await Order.findOne({ where: { id: orderId, hotel_id: req.user } })
        if (!order) {
            // await t.rollback()
            return res.json(error(MESSAGE.ORDER_NOT_FOUND, STATUSCODE.NOT_FOUND))
        }

        const cartData = cart.items.find(el => el.status === 'D' || el.status === 'H')
        if (!cartData) {
            // await t.rollback()
            return res.json(error(MESSAGE.CART_ITEM_NOT_AVAILABLE, STATUSCODE.BAD_REQUEST))
        }
        const AllUpdatedItems = cart.items

        if (!AllUpdatedItems.length) {
            // await t.rollback()
            return res.json(error(MESSAGE.CART_ITEM_NOT_AVAILABLE, STATUSCODE.BAD_REQUEST))
        }
        //createLogFile(req.user, `INVOICE UPDATE /OrderDetaiils Deletedd  `, { where: { orderId: order.id, hotel_id: req.user } })



        let user = await findAndUpdateUser({ name: userName, number: mobile, gstin, hotel_id: req.user, address }, orderId)



        //createLogFile(req.user, `INVOICE UPDATE /Order Updated Data `, { totalAmount, totalDiscount, gst, grandAmount, discount_reason, discount_type, }, { where: { id: order.id, hotel_id: req.user } })
        await Order.update({ service_charge: service_charger, totalAmount, gst, totalDiscount, grandAmount, UserId: user.id, discount_reason, discount_type, discount_value }, { where: { id: order.id, hotel_id: req.user } })
        await updateOrderTax(cart.taxes, order.id, req.user)
        await OrderDetails.destroy({ where: { orderId: order.id, hotel_id: req.user }, transaction: t })
        for (const item of cartData) {
            for (const cur of item.menuItems) {
                const OrderDetailsAvailable = await OrderDetails.findOne({ where: { orderId: orderId, MenuId: cur.id, hotel_id: req.user, status: { [Op.eq]: ORDER_DETAILS_TYPE.DELIVERED } } })
                if (OrderDetailsAvailable) {
                    //createLogFile(req.user, `Updated ORDER/${orderId} OrderDetails OrderDetailsAvailable updated `, { totalDiscount: cur.discount + OrderDetailsAvailable.totalDiscount, qty: +cur.qty + OrderDetailsAvailable.qty, price: OrderDetailsAvailable.price, order_type: order.order_type, payment_status: order.order_type == "pickup" ? STATUS.SUCCESS : STATUS.PENDING, where: { id: OrderDetailsAvailable.id, hotel_id: req.user } })
                    const updatedOrderDetails = await OrderDetails.update({ totalDiscount: cur.discount + OrderDetailsAvailable.totalDiscount, qty: +cur.qty + OrderDetailsAvailable.qty, price: OrderDetailsAvailable.price, order_type: order.order_type, payment_status: order.order_type == "pickup" ? STATUS.SUCCESS : STATUS.PENDING }, { where: { id: OrderDetailsAvailable.id, hotel_id: req.user } })
                }
                else {
                    let modifiedCartForOrderDetails = { MenuId: "", hotel_id: "", qty: "", orderId: "" };
                    modifiedCartForOrderDetails.MenuId = cur.id
                    modifiedCartForOrderDetails.qty = cur.qty
                    modifiedCartForOrderDetails.price = cur.price
                    modifiedCartForOrderDetails.totalDiscount = cur.discount
                    modifiedCartForOrderDetails.order_type = order.order_type
                    // modifiedCartForOrderDetails.payment_type = orderWithoutupdated.order_type == "pickup" ? paymentMode : ""
                    modifiedCartForOrderDetails.payment_status = orderWithoutupdated.order_type == "pickup" ? STATUS.SUCCESS : STATUS.PENDING
                    // modifiedCartForOrderDetails.UserId = cur.UserId
                    modifiedCartForOrderDetails.hotel_id = cur.hotel_id
                    modifiedCartForOrderDetails.orderId = orderId
                    modifiedCartForOrderDetails.status = ORDER_DETAILS_TYPE.DELIVERED

                    //createLogFile(req.user, `ADMIN ORDER/${orderId} OrderDetails created`, modifiedCartForOrderDetails)
                    if (cur?.custom) {
                        const { price, item_name } = cur
                        const menu = await Menu.create({ price, item_name, active: false, hotel_id: req.user })
                        modifiedCartForOrderDetails = {
                            MenuId: menu.id,
                            variant_id: cur.variantData?.id ? cur.variantData?.id : null,
                            variant_name: cur.variantData?.id ? cur.variantData?.variants_name : null,
                            qty: +cur.qty,
                            price: +cur.price,
                            totalDiscount: cur?.discount,
                            // TableId: table?.id,
                            UserId: user?.id,
                            order_type: order.order_type,
                            payment_status: STATUS.PENDING,
                            hotel_id: req.user,
                            orderId: order.id,
                            status: ORDER_DETAILS_TYPE.DELIVERED,
                            addons: cur?.addons
                        };
                    }
                    const orderDetails = await OrderDetails.create(modifiedCartForOrderDetails)

                }
            }
        }
        // setImmediate(() => {
        await updateOrderAppendToRadis(orderId, req.user)

        // });
        await addToTimeLine(orderId, ACTION.UPDATEORDERITEM, req.userId)
        await webChange(req.user, io, order.id)
        // await t.commit()
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { message: MESSAGE.ORDER_EDITED_SUCCESSFULLY }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err)
        // await t.rollback()
        //createLogFile(req.user, `updateInvoice/err Error`, { err })
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const kotGeneratePdf = async (req, res) => {
    try {
        const {
            order_type,
            order_id,
            restaurantName,
            userOrTableNo,
            timeAndDate, items, printerSize, kotNumber, printer, token } = req.body

        // console.log(req.body, "Body Data--<")
        const hotel = await Hotel.findOne({ where: { id: req.user } })
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST))

        const data = {
            origin: req.headers.origin,
            printerSize: printerSize ? printerSize : printer.printer_size,
            items,
            order_type,
            order_id,
            restaurantName,
            userOrTableNo,
            timeAndDate,
            kotNumber,
            token
            // status: kotNumber === 1 ? "New" : "Running"
        }

        const pdf = await generateKotPdf(data, path.join(__dirname, "../", "public", "pdf", `kot${order_id}.pdf`))

        return res.json(success(STATUS.SUCCESS, { pdf, message: MESSAGE.KOT_GENERATED, }, STATUSCODE.CREATED))

    } catch (err) {

        console.log(err)
        //createLogFile(req.user, `kotGeneratePdf/err Error`, err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

const invoiceGeneratePdf = async (req, res) => {
    try {
        const hotel = await Hotel.findOne({ where: { id: req.user } })
        if (!hotel) return res.json(error(MESSAGE.USER_NOT_FOUND, STATUSCODE.NOT_FOUND))
        const data = req.body
        data.currency = hotel.currency

        data.origin = req.headers.origin
        const pdf = await generateInvoicePDF(data, path.join(__dirname, "../", "public", "pdf", `order${data.orderId}.pdf`))
        return res.json(success(MESSAGE.SUCCESS, { orderId: data.orderId, pdf }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err)
        //createLogFile(req.user, `invoiceGeneratePdf/err Error`, err);

        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

const generateHashId = (id) => {
    const hashids = new Hashids(salt, 10);
    const encoded = hashids.encode(id);
    return encoded

}

const decodeHashId = (id) => {
    const hashids = new Hashids(salt, 10);
    const decoded = hashids.decode(id);
    return decoded

}

const getBillViewData = async (req, res) => {

    try {
        let { id, bill_no: orderId } = req.body
        orderId = decodeHashId(orderId)
        id = decodeHashId(id)
        const hotel = await Hotel.findOne({ where: { id }, include: { model: InvoiceFormate } })
        if (!hotel) {
            return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.NOT_FOUND))
        }
        const order = await Order.findOne({ where: { hotel_id: id, id: orderId }, attributes: ['id', 'totalAmount', 'UserId', 'TableId', 'bill_no', 'gst', 'grandAmount', 'totalDiscount', 'order_type', 'createdAt', "token", "service_charge", "isOffline"] })
        if (!order) {
            return res.json(error(MESSAGE.ORDER_NOT_FOUND, STATUSCODE.NOT_FOUND))
        }
        const orderDetail = await OrderDetails.findAll({ where: { orderId: order?.dataValues.id, hotel_id: id }, include: { model: Variants, as: "variantData" }, attributes: ['qty', 'price', 'id', 'MenuId', "addons"] })
        if (!orderDetail.length) {
            return res.json(error(MESSAGE.ORDERDETAILS_NOT_FOUND, STATUSCODE.NOT_FOUND))
        }
        const items = []
        let totalQty = 0;

        for (const cur of orderDetail) {
            const documents = {}

            const menuData = await Menu.findOne({ where: { id: cur.MenuId, hotel_id: id }, attributes: ['item_name', 'sub_categories'] })
            console.log(cur.addons, "Addons:::")
            documents.item_name = menuData.item_name
            documents.variantData = cur.variantData
            documents.addons = cur.addons
            documents.price = cur.price
            documents.qty = cur.qty
            documents.sub_categories = menuData.sub_categories
            documents.totalAmount = cur.price * cur.qty
            items.push(documents)
            totalQty += cur.qty
        }
        const timeAndDate = moment(order.createdAt).format("DD/MM/YYYY, hh:mm A")
        const subtotal = order.totalAmount
        let user = ''
        let table = ''
        let tableAndUserInfo = ''
        if (order.UserId) {
            user = await User.findOne({ where: { id: order.UserId } })
        }
        if (order.TableId) {
            table = await Table.findOne({ where: { id: order?.TableId }, include: { model: TableCatagories } })
            tableAndUserInfo = `${table.type === "T" ? "Table No:" : "Room No:"}  ${table.table_name}-${table?.hms_table_categ?.table_catag_nm}`
        }
        const type = order.order_type
        const orderTax = await OrderTax.findAll({ where: { hmsOrderMstId: order.id, hotel_id: id }, include: { model: TaxType } })
        const invoicePrinter = await PrinterSetting.findOne({ where: { hotel_id: id, print_type: 'I' } })
        const printerSize = invoicePrinter?.printer_size || "3"
        let tokenPrint = 0
        if (order.token > 0) {
            if (hotel.bill_with_token == "2") {
                tokenPrint = order.token
            } else if (hotel.bill_with_token == "0" && order.order_type === "pickup") {
                tokenPrint = order.token
            } else if (hotel.bill_with_token == "1" && order.order_type === "dinin") {
                tokenPrint = order.token
            }
        }
        const headerFooter = await getHearderAndFooterDataBillView(hotel, order.grandAmount)
        const singleData = {
            customerName: user?.name,
            customerNumber: user?.number,
            gstin: user?.gstin,
            address: user?.address || "",
            footerText: headerFooter.footerText,
            headerText: headerFooter.headerText,
            dateAndTime: timeAndDate,
            orderId: order.isOffline ? `${order.bill_no}-OFF` : order.bill_no,
            restaurantName: hotel.hotel_name,
            bottomText: hotel.invoiceFormateBottomText,
            restaurantNumber: hotel.contact1,
            restaurantAddress: `${hotel.address1} ${hotel.address2}`,
            items,
            tableAndUserInfo,
            type,
            subtotal,
            gst: order.gst,
            totalBill: parseFloat(order.grandAmount || 0).toFixed(2),
            token: tokenPrint,
            service_charge: order.service_charge,
            totalQty,
            totalDiscount: order.totalDiscount,
            orderTax,
            printerSize,
            origin: req.headers.origin,
            currency: hotel?.currency || "₹"
        }
        return res.json(success(MESSAGE.SUCCESS, {
            data: singleData,
        }, STATUSCODE.SUCCESS))

    } catch (err) {
        console.log(err)
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

const sentEbill = async (req, res) => {
    try {
        const { mobile, orderId } = req.body
        const hotel = await Hotel.findByPk(req.user)
        if (!mobile) {
            return res.json(error("Mobile Number requred for Sending E-Bill", STATUSCODE.BAD_REQUEST))
        }

        if (!orderId) {
            return res.json(error("Order Not Found", STATUSCODE.BAD_REQUEST))
        }

        const order = await Order.findByPk(orderId)
        if (!order) {
            return res.json(error("Order Not Found", STATUSCODE.BAD_REQUEST))
        }
        const bill_no = generateHashId(orderId)
        const hotelId = generateHashId(req.user)
        const link = `${process.env.SOCKET_URL}/#/billview?bill_no=${bill_no}&id=${hotelId}`

        const url = `https://graph.facebook.com/v22.0/${process.env.WHATSAPPPHONEID}/messages`;
        const headers = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.WHATSAPPTOKEN}`
        };
        const user = await User.findByPk(order.UserId)
        const body = {
            messaging_product: "whatsapp",
            to: mobile,
            type: "template",
            template: {
                name: "invoice_online",
                language: { code: "en" },
                components: [
                    {
                        type: "body",
                        parameters: [
                            { type: "text", text: user?.name || 'User' },
                            { type: "text", text: hotel?.hotel_name || '' },
                            { type: "text", text: order.grandAmount || "0" },
                            { type: "text", text: `${moment(new Date()).format("DD/MM/YYYY hh:mm a")}` },
                            { type: "text", text: link || "" },

                        ]
                    }
                ]
            }
        };


        const checkUserHaveCredit = await EBillCredit.findOne({ where: { hotel_id: req.user } })

        // console.log("checkUserHaveCredit::::", checkUserHaveCredit)
        if (checkUserHaveCredit && checkUserHaveCredit.credit <= 0) {
            return res.json(error("You Don't Have Enough Credit For Send E-bill, Please Contact Customer Care.", STATUSCODE.BAD_REQUEST))
        }
        axios.post(url, body, { headers })
            .then(async (response) => {
                //createLogFile(req.user, `${mobile} - ${response}`, "E-bill")
                // console.log("responce::", response);
                const checkFirstTime = await EBillCredit.findOne({ where: { hotel_id: req.user } })
                if (!checkFirstTime) {
                    await EBillCredit.create({ hotel_id: req.user, credit: 49 })
                    await EBillCreditDebit.create({ hotel_id: req.user, credit: true, amount: 50, mobile })
                    await EBillCreditDebit.create({ orderId, hotel_id: req.user, debit: true, amount: 1, mobile })
                } else {
                    await EBillCredit.update({ credit: checkFirstTime.credit - 1 }, { where: { hotel_id: req.user } })
                    await EBillCreditDebit.create({ orderId, hotel_id: req.user, debit: true, amount: 1, mobile })
                }
            })
            .catch(error => {
                console.error(error, "Error in sending message");
            });


        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { message: "Invoice send to User Whatsapp" }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err)
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

const getEbillCredit = async (req, res) => {
    try {

        const credit = await EBillCredit.findOne({ where: { hotel_id: req.user } })
        if (!credit) {
            return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { credit: 50 }, STATUSCODE.SUCCESS))
        } else {
            return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { credit: credit?.credit || 0 }, STATUSCODE.SUCCESS))
        }
    } catch (error) {
        log("Error From Get EbillCredit", error)
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

const creditDebitEbillData = async (req, res) => {
    try {

        const credit = await EBillCredit.findOne({ where: { hotel_id: req.user } })
        if (!credit) {
            return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { credit: 50 }, STATUSCODE.SUCCESS))
        } else {
            return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { credit: credit?.credit || 0 }, STATUSCODE.SUCCESS))
        }

    } catch (error) {
        log("Error WHile Getting CreditDebitDta::", error)
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

const updateOrderToserver = async (req, res) => {
    try {

        const { service_charge, taxes, grandAmount, totalDiscount, totalBill, roundof, gst, action, orderId, id } = req.body
        await updateOrderTax(taxes, orderId, req.user)
        await Order.update({ service_charge, gst, grandAmount, totalDiscount, orderId, totalAmount: totalBill, roundof }, { where: { id: orderId } })

        // setImmediate(() => {
        await updateOrderAppendToRadis(orderId, req.user)

        // });
        await addToFroRemoveTimeLine(orderId, action, req.userId, id)
        await webChange(req.user, io, orderId)
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { message: "Success" }, STATUSCODE.SUCCESS))
    } catch (error) {
        console.log("Error While Using :::", error)
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))

    }
}

module.exports = { getBusinessDate, ordertimeExtend, ordertimeOver, updateOrderToserver, generateHashId, decodeHashId, getEbillCredit, creditDebitEbillData, sentEbill, getBillViewData, addToTimeLine, generateToken, arranPrintersForKotWithTheseItems, updatedInvoiceItems, generateKotPdf, kotGeneratePdf, invoiceGeneratePdf, reprintkot, rePrintAdminBillData, editOrderClick, updateInvoice, settleBills, setPrinter, deletePdf, addComment, addToCartForOnClickRetrieveCart, test, holdOrder, addToCartAdmin, getAdminCart, AdminOrder, removeAdminCartItems, adminBillData, removeAdminAllCart, cancelOrder, kotOrder }