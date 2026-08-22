const Order = require("../../model/order")
const Item = require("../../model/menu")
const Cart = require("../../model/cart")
const sequelize = require("sequelize")
const { Op } = require("sequelize")
const { STATUSCODE, MESSAGE, STATUS, ORDER_TYPE, ORDER_DETAILS_TYPE } = require("../../constant/const")
const { success, mobileSuccess, mobileError } = require("../../responce/res")
const Menu = require("../../model/menu")
const TableCatagories = require("../../model/table_catg")
const Table = require("../../model/table")
const User = require("../../model/user")
const OrderDetails = require("../../model/order_details")
const Hotel = require("../../model/hotel")
const moment = require("moment")
const Menu_categ = require("../../model/menu_categ")
const HotelUser = require("../../model/hotelUser")
const UserAccess = require("../../model/userAccess")
const Role = require("../../model/role_mst")
const AppUpdate = require("../../model/updateApp")
const { createLogFile } = require("../../logs/log")
const { number } = require("joi")
const Variants = require("../../model/variants")
const AddonDepartment = require("../../model/addonDepartMent")
const Addons = require("../../model/addons")
const ServiceCharge = require("../../model/serviceCharge")
const { Sequelize } = require("sequelize")
const DuePaymentReceive = require("../../model/duePayment")
const EBillCredit = require("../../model/ebillCredit")
const TaxType = require("../../model/taxType")
const { updateOrderAppendToRadis, deleteOrderToRedis, updateTableToRadis } = require("../redis/redisCrud")
const OrderTax = require("../../model/orderTax")
const { getBusinessDate } = require("../../utils/dateUtils")
const RestaurantSetting = require("../../model/restaurantSetting")

const mobileAccess = async (req, res) => {
    try {
        const { device_id } = req.headers

        console.log(req.user, req.userId)
        const hotel = await Hotel.findOne({ where: { id: req.user } })
        // console.log(hotel)
        if (!hotel) return res.json(mobileError(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST))
        const userAccess = await HotelUser.findOne({ where: { id: req.userId }, include: [{ model: UserAccess }, { model: Role }] })
        const taxes = await TaxType.findAll({ where: { hotel_id: req.user, active: true } })

        if (device_id !== userAccess.device_id) {

            return res.json(mobileError(MESSAGE.NOT_AUTHORIZE, STATUSCODE.VALIDATION_ERROR))

        }
        // console.log(userAccess)
        userAccess.dataValues.gst = hotel.invoiceFormateIncGst

        const updateApp = await AppUpdate.findOne({})
        userAccess.dataValues.update = updateApp.dataValues

        const credit = await EBillCredit.findOne({ where: { hotel_id: req.user } })
        // if (!credit) {
        //     return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { credit: 50 }, STATUSCODE.SUCCESS))
        // } else {
        //     return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { credit: credit?.credit || 0 }, STATUSCODE.SUCCESS))
        // }

        let tempCredit = 0
        if (!credit) {
            tempCredit = 50
            // return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { credit: 50 }, STATUSCODE.SUCCESS))
        } else {
            tempCredit = credit?.credit || 0
            // return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { credit: credit?.credit || 0 }, STATUSCODE.SUCCESS))
        }
        console.log("Mobile Access Fetched Successfully", hotel.support_number)
        return res.json(mobileSuccess(MESSAGE.SUCCESS, { taxes, currency: hotel?.currency || "₹", access: userAccess, restaurant_name: hotel.hotel_name, support_number: hotel.support_number, res_id: hotel.id, credit: tempCredit }, "", STATUSCODE.SUCCESS))


    } catch (err) {
        console.log(err)
        //createLogFile(req.user, `Getting mobileAccess MoBile /err Error`, err);

        return res.json(mobileError(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

const mobileSettleBills = async (req, res) => {
    try {
        // console.log(req.query, "query =====>")
        const { id, cash = 0, card = 0, upi = 0, due = 0, mobile } = req.body
        console.log(req.body)

        if (cash || card || upi || due) {
            const hotel = await Hotel.findOne({ where: { id: req.user } })
            if (!hotel) return res.json(mobileError(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST))

            if (due > 0) {
                if (!mobile) {
                    return res.json(mobileError("Mobile Require On Due Payment", STATUSCODE.BAD_REQUEST))
                } else {
                    let user = await User.findOne({ where: { hotel_id: req.user, number: mobile } })
                    if (!user) {
                        user = await User.create({ number: mobile, hotel_id: req.user })
                    }
                    await Order.update({ UserId: user.id }, { where: { id, hotel_id: req.user } })

                }

            }

            let order = await Order.findOne({
                where: { id, hotel_id: req.user, order_type: ORDER_TYPE.DININ, payment: "pending", deleted: false }
            });
            if (!order) return res.json(mobileError(MESSAGE.ORDER_NOT_FOUND, STATUSCODE.NOT_FOUND))
            if (order.order_type == "dinin") {
                await Table.update({ table_status: "F" }, { where: { id: order.TableId, hotel_id: req.user } })

            }

            await Order.update({

                cash, upi, card, due, payment: STATUS.SUCCESS

            }, { where: { hotel_id: req.user, id } })
            const orderDetails = await OrderDetails.findAll({ where: { orderId: id, hotel_id: req.user } })

            for (const iterator of orderDetails) {
                await OrderDetails.update({ payment_status: STATUS.SUCCESS }, { where: { id: iterator.id, hotel_id: req.user, orderId: id } })
            }
            await io.to(hotel.id).emit("printBill", { print: false })

            return res.status(STATUSCODE.SUCCESS).json(mobileSuccess(MESSAGE.SUCCESS, {}, MESSAGE.ORDER_SETTLE, STATUSCODE.SUCCESS))
        } else {
            return res.json(error(MESSAGE.PAYMENT_MODE_NOT_SELECTED, STATUSCODE.BAD_REQUEST))
        }

    } catch (err) {
        console.log(err)
        //createLogFile(req.user, ` mobileSettleBills MoBile /err Error`, err);

        return res.json(mobileError(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const AllInvoice = async (req, res) => {
    try {
        const { endDate, startDate } = req.body
        const start = startDate ? moment(startDate) : moment().startOf('day');
        const end = endDate ? moment(endDate) : moment().endOf('day');
        const startD = start.toDate();
        const endD = end.toDate();

        console.log(startD, endD)
        const hotel = await Hotel.findOne({ where: { id: req.user } })
        if (!hotel) return res.json(mobileError(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST))
        let order = await Order.findAll({
            where: {
                hotel_id: req.user, deleted: false, payment: STATUS.SUCCESS, status: ORDER_TYPE.SUCCESS, createdAt: {
                    [Op.between]: [startD, endD]
                },
            },
            include:
                [
                    { model: OrderDetails, include: [{ model: Menu, include: { model: Menu_categ } }, { model: Variants, as: "variantData" }] 
                },
                { model: User },
                { model: Table, include: [{ model: TableCatagories }] }
                ]
            ,
            order: [
                ['createdAt', 'DESC'],
            ],

        });
        return res.status(STATUSCODE.SUCCESS).json(mobileSuccess(MESSAGE.SUCCESS, { invoices: order }, '', STATUSCODE.SUCCESS))
    }

    catch (error) {
        console.log(error)
        //createLogFile(req.user, `Getting AllInvoice MoBile /err Error`, error);

        return res.json(mobileError(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const orderIdWiseOrderGet = async (req, res) => {
    try {
        const { order_id } = req.body
        const hotel = await Hotel.findOne({ where: { id: req.user } })
        if (!hotel) return res.json(mobileError(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST))
        const orderDetails = await OrderDetails.findAll({ where: { hotel_id: req.user, orderId: order_id },  include: [{ model: Menu, include: [{ model: Variants, as: "variantData", where: { active: true }, required: false }, { model: AddonDepartment, as: "addonDepartmentData", include: { model: Addons } }] }, { model: Variants, as: "variantData" }] })
console.log(orderDetails,"Order details:::")       
        if (!orderDetails.length) return res.json(mobileError(MESSAGE.ORDER_NOT_FOUND, STATUSCODE.BAD_REQUEST))
        return res.status(STATUSCODE.SUCCESS).json(mobileSuccess(MESSAGE.SUCCESS, { orderDetails }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err)


        //createLogFile(req.user, `orderIdWiseOrderGet /err Error`, err);

        return res.json(mobileError(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))

    }
}
const getMobilePickupOrders = async (req, res) => {
    try {
        const hotel = await Hotel.findOne({ where: { id: req.user } })
        if (!hotel) return res.json(mobileError(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST))
        let order = await Order.findAll({
            where: {
                hotel_id: req.user, deleted: false, payment: STATUS.PENDING, status: { [Op.ne]: ORDER_TYPE.SUCCESS }, order_type: ORDER_TYPE.PICKUP
            },
            include:
                [
                    { model: User },
                    {
                        model: OrderDetails, include: [{ model: Menu, include: [{ model: Variants, as: "variantData", where: { active: true }, required: false }, { model: AddonDepartment, as: "addonDepartmentData", include: { model: Addons } }] }, { model: Variants, as: "variantData" }]
                    }
                ]
            ,
            order: [
                ['createdAt', 'DESC'],
            ],

        });
        return res.status(STATUSCODE.SUCCESS).json(mobileSuccess(MESSAGE.SUCCESS, { invoices: order }, '', STATUSCODE.SUCCESS))



    } catch (error) {
        console.log(error)
        //createLogFile(req.user, `Getting mobileAccess MoBile /err Error`, error);

        return res.json(mobileError(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

const serviceCharge = async (req, res) => {
    try {

        const serviceCharge = await ServiceCharge.findOne({ where: { hotel_id: req.user } })
        // console.log("Charge::", serviceCharge)
        if (!serviceCharge) return res.status(STATUSCODE.SUCCESS).json(mobileSuccess(MESSAGE.SUCCESS, {
            serviceCharge: {
                active: false, service_charge_type: "percentage",
                calculation_on: 'core',
                service_charge_value: 0,
                service_charge_automatic: [],
                calculation_on_tax: false,
                greater_less: '1',
                greater_less_amount: 0
            }
        }, "fetch Service Charge", STATUSCODE.SUCCESS))
        return res.status(STATUSCODE.SUCCESS).json(mobileSuccess(MESSAGE.SUCCESS, { serviceCharge }, "fetch Service Charge", STATUSCODE.SUCCESS))


    } catch (error) {
        console.log(error)
        return res.json(mobileError(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const getDueOrdersFunction = async (data, hotel_id) => {
    try {
        const { bill_no, number } = data

        console.log(data, "SearchData --->")
        let user
        let dueOrders = {
            totalDuePayment: 0,
            orders: []
        }

        if (number) {

            let totalDue = 0
            const orders = await Order.findAll({
                where: {
                    due: {
                        [Op.gt]: 0
                    },
                    hotel_id,
                    deleted: false

                }, include: [{
                    model: User,
                    where: { number },
                    attributes: ['name', 'number'],
                    raw: true
                }],
                attributes: ["id", "bill_no", "due", "createdAt"],
            });
            for (const element of orders) {
                totalDue += element.due
            }
            dueOrders.totalDuePayment = totalDue
            console.log(orders[0])
            dueOrders.orders = orders
        }
        if (bill_no) {
            console.log("here")
            const totalDue = await Order.findOne({
                where: {
                    bill_no: bill_no,
                    due: {
                        [Op.gt]: 0
                    },
                    hotel_id,
                    deleted: false
                },
                attributes: [
                    [sequelize.fn('SUM', Sequelize.col('due')), 'totalDue']
                ],
                raw: true
            });
            console.log(totalDue)
            const orders = await Order.findAll({
                where: {
                    hotel_id: hotel_id,
                    bill_no: bill_no,
                    due: {
                        [Op.gt]: 0
                    },

                }, include: { model: User },

            });
            dueOrders.totalDuePayment = totalDue?.totalDue
            dueOrders.orders = orders
        }
        return dueOrders
    } catch (err) {
        console.log(err)
        throw new Error(err)
        // return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const getDueOrdersDateWiseFunction = async (startDate, endDate, hotel_id) => {
    try {
        let dueOrders = {
            totalDuePayment: 0,
            orders: []
        }
        console.log(startDate, endDate, "Start End Date-->")
        const totalDue = await Order.findOne({
            where: {
                createdAt: { [Op.between]: [startDate, endDate] },
                due: {
                    [Op.gt]: 0
                },
                hotel_id,
                deleted: false
            },
            attributes: [
                [Sequelize.fn('SUM', Sequelize.col('due')), 'totalDue']
            ],
            raw: true
        });
        const orders = await Order.findAll({
            where: {
                createdAt: { [Op.between]: [startDate, endDate] },
                due: {
                    [Op.gt]: 0
                },
                hotel_id, deleted: false

            }, include: { model: User },

        });
        dueOrders.totalDuePayment = totalDue?.totalDue
        dueOrders.orders = orders
        return dueOrders
    } catch (err) {
        console.log(err)
        throw new Error(err)
        // return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const getDueOrdersMobile = async (req, res) => {
    try {
        const { searchData, startDate, endDate } = req.body
        let dueOrders
        console.log(req.body)
        if (searchData?.bill_no || searchData?.number) {
            dueOrders = await getDueOrdersFunction(searchData, req.user)
        } else {
            dueOrders = await getDueOrdersDateWiseFunction(startDate, endDate, req.user)
        }
        return res.status(STATUSCODE.SUCCESS).json(mobileSuccess(MESSAGE.SUCCESS, { dueOrders }, "Due Order fecth Sussefully", STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err)
        return res.json(mobileError(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const settleDueMobile = async (req, res) => {
    try {

        const { id, mode, receive } = req?.body
        console.log(req?.body, "Body Data ---->")

        const findOrder = await Order.findOne({ where: { id } })
        if (Number(receive) <= 0) return res.json(mobileError("Amount Must Be Greater Than 0", STATUSCODE.BAD_REQUEST))


        console.log(findOrder, +receive)
        if (findOrder.due < receive) return res.json(mobileError("Amount Must Be Less Than Or Equal Remaining Amount", STATUSCODE.BAD_REQUEST))
        let cash = findOrder.cash
        let upi = findOrder.upi
        let card = findOrder.card

        if (mode === "cash") {
            cash += +receive
        } if (mode === 'upi') {
            upi += +receive
        }
        if (mode === 'card') {
            card += +receive
        }

        const setting = await RestaurantSetting.findOne({ where: { hotel_id: req.user } });
        const timeZone = setting?.timeZone || 'Asia/Kolkata';
        const businessStartTime = setting?.business_day_start_time || '00:01:00';
        const business_date = getBusinessDate(timeZone, businessStartTime);

        await DuePaymentReceive.create({ business_date, user_id: findOrder.UserId, order_id: findOrder.id, hotel_id: req.user, settle_by: req.userId, amount: receive, bill_no: findOrder.bill_no, payment_mode: mode })
        await Order.update({ card, upi, cash, due: findOrder.due - receive }, { where: { id } })

        // setImmediate(() => {

        await updateOrderAppendToRadis(id, req.user)

        // });
        const updatedOrder = await Order.findOne({ where: { id }, include: { model: User } })
        return res.status(STATUSCODE.SUCCESS).json(mobileSuccess(MESSAGE.SUCCESS, { updatedOrder }, "Due Order Settle Successfully", STATUSCODE.SUCCESS))

    } catch (err) {
        console.log(err)
        return res.json(mobileError(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const settleAllDueMobilePayment = async (req, res) => {
    try {

        const { idArray, mode } = req.body

        const updatedOrderIds = []

        const setting = await RestaurantSetting.findOne({ where: { hotel_id: req.user } });
        const timeZone = setting?.timeZone || 'Asia/Kolkata';
        const businessStartTime = setting?.business_day_start_time || '00:01:00';
        const business_date = getBusinessDate(timeZone, businessStartTime);

        for (const id of idArray) {
            const findOrder = await Order.findOne({ where: { id } })
            if (!findOrder) continue
            // if (Number(receive) <= 0) return res.json(error("Amount Must Be Greater Than 0", STATUSCODE.BAD_REQUEST))
            // console.log(findOrder, +receive)
            // if (findOrder.due < receive) return res.json(error("Amount Must Be Less Than Or Equal Remaining Amount", STATUSCODE.BAD_REQUEST))
            let cash = findOrder.cash
            let upi = findOrder.upi
            let card = findOrder.card

            if (mode === "cash") {
                cash += +findOrder.due
            } if (mode === 'upi') {
                upi += +findOrder.due
            }
            if (mode === 'card') {
                card += +findOrder.due
            }

            await DuePaymentReceive.create({ business_date, user_id: findOrder.UserId, order_id: findOrder.id, hotel_id: req.user, settle_by: req.userId, amount: findOrder.due, bill_no: findOrder.bill_no, payment_mode: mode })
            await Order.update({ card, upi, cash, due: 0 }, { where: { id } })
            // setImmediate(() => {

            await updateOrderAppendToRadis(id, req.user)
            // });
            updatedOrderIds.push(id)
        }
        const updatedOrder = await Order.findAll({ where: { id: { [Op.in]: [...updatedOrderIds] }, hotel_id: req.user } })
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { message: "Due Settle Success", updatedOrder, }, STATUSCODE.SUCCESS))


    } catch (err) {
        console.log(err)
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

const updateOrder = async (req, res) => {
    try {
        const {
            order_id,
            orderDetails = [],
            order_type,
            totalAmount,
            grandAmount,
            gst,
            totalDiscount,
            discount_type,
            discount_value,
            service_charge,
            tax_details = [],
            cash,
            card,
            upi,
            due,
            payment,
            payment_type,
            status,
            name = "",
            number = "",
            gstin = "",
            address = ""
        } = req.body

        const hotel_id = req.user

        // Validate hotel
        const hotel = await Hotel.findOne({ where: { id: hotel_id } })
        if (!hotel) return res.json(mobileError(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST))

        // Find order
        if (!order_id) return res.json(mobileError("Order ID is required", STATUSCODE.BAD_REQUEST))

        const findOrder = await Order.findOne({ where: { id: order_id, hotel_id, deleted: false } })
        if (!findOrder) return res.json(mobileError(MESSAGE.ORDER_NOT_FOUND, STATUSCODE.NOT_FOUND))

        // Find or create user
        let user = await User.findOne({ where: { id: findOrder.UserId } })
        if (!user) {
            user = await User.create({ name, number, gstin, address, hotel_id })
        } else {
            await User.update({ name, number, gstin, address }, { where: { id: findOrder.UserId, hotel_id } })
        }

        // Build the update object for Order master
        const orderUpdateData = {
            totalAmount: totalAmount !== undefined ? totalAmount : findOrder.totalAmount,
            grandAmount: grandAmount !== undefined ? grandAmount : findOrder.grandAmount,
            gst: gst !== undefined ? gst : findOrder.gst,
            totalDiscount: totalDiscount !== undefined ? totalDiscount : findOrder.totalDiscount,
            discount_type: discount_type || findOrder.discount_type,
            discount_value: discount_value !== undefined ? discount_value : findOrder.discount_value,
            service_charge: service_charge !== undefined ? (+service_charge || 0).toFixed(2) : findOrder.service_charge,
            UserId: user.id
        }

        // Payment mode fields
        if (cash !== undefined) orderUpdateData.cash = +cash
        if (card !== undefined) orderUpdateData.card = +card
        if (upi !== undefined) orderUpdateData.upi = +upi
        if (due !== undefined) orderUpdateData.due = +due
        if (payment) orderUpdateData.payment = payment
        if (payment_type) orderUpdateData.payment_type = payment_type
        if (status) orderUpdateData.status = status
        if (order_type) orderUpdateData.order_type = order_type

        await Order.update(orderUpdateData, { where: { id: order_id, hotel_id } })

        // If order is settled and dine-in, update table status
        if (status === ORDER_TYPE.SUCCESS && payment === STATUS.SUCCESS && findOrder.order_type === ORDER_TYPE.DININ && findOrder.TableId) {
            await Table.update({ table_status: "F" }, { where: { id: findOrder.TableId, hotel_id } })
            await updateTableToRadis(findOrder.TableId, hotel_id)
        }

        // Update order taxes — destroy old and recreate
        if (tax_details.length) {
            await OrderTax.destroy({ where: { hmsOrderMstId: order_id, hotel_id } })
            for (const el of tax_details) {
                await OrderTax.create({
                    amount: el.amount,
                    tax_type: el.tax_value,
                    tax_value: el.tax,
                    hmsOrderMstId: order_id,
                    hmsTaxTypeMstId: el.id,
                    hotel_id
                })
            }
        }

        // Rebuild order details: destroy ALL existing items and recreate from request
        if (orderDetails.length) {
            await OrderDetails.destroy({ where: { orderId: order_id, hotel_id } })

            for (const cur of orderDetails) {
                if (!+cur.qty) continue // skip zero-qty items

                const itemStatus = cur.status || ORDER_DETAILS_TYPE.IN_PROGRESS
                const itemPaymentStatus = cur.payment_status || (payment === STATUS.SUCCESS ? STATUS.SUCCESS : STATUS.PENDING)

                let modifiedCartForOrderDetails = {
                    MenuId: +cur.MenuId,
                    qty: +cur.qty,
                    price: +cur.price,
                    kotNumber: +cur.kotNumber || 0,
                    order_type: cur.order_type || order_type || findOrder.order_type,
                    comment: cur.comment || null,
                    payment_status: itemPaymentStatus,
                    hotel_id: hotel_id,
                    orderId: +order_id,
                    status: itemStatus,
                    TableId: cur.TableId ? +cur.TableId : findOrder.TableId,
                    addons: cur.addons || [],
                    variant_id: cur.variant_id ? +cur.variant_id : null,
                    variant_name: cur.variant_name || null
                }
                await OrderDetails.create(modifiedCartForOrderDetails)
            }
        }

        // Sync Redis
        await updateOrderAppendToRadis(order_id, hotel_id)

        // Fetch updated order & details for response
        const updatedOrder = await Order.findByPk(order_id, {
            include: [
                { model: User },
                { model: OrderDetails, include: [{ model: Menu, include: { model: Menu_categ } }, { model: Variants, as: "variantData" }] },
                { model: Table, include: { model: TableCatagories } }
            ]
        })

        return res.status(STATUSCODE.SUCCESS).json(
            mobileSuccess(MESSAGE.SUCCESS, { order: updatedOrder }, MESSAGE.ORDER_EDITED_SUCCESSFULLY, STATUSCODE.SUCCESS)
        )

    } catch (error) {
        console.log(error, "Error While Updating Order::")
        createLogFile(req.user, "Error in updateOrder API", error)
        return res.json(mobileError(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

const deleteOrder = async (req, res) => {
    try {
        const { order_id } = req.body
        const hotel_id = req.user

        // Validate hotel
        const hotel = await Hotel.findOne({ where: { id: hotel_id } })
        if (!hotel) return res.json(mobileError(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST))

        // Validate order_id
        if (!order_id) return res.json(mobileError("Order ID is required", STATUSCODE.BAD_REQUEST))

        const findOrder = await Order.findOne({ where: { id: order_id, hotel_id, deleted: false } })
        if (!findOrder) return res.json(mobileError(MESSAGE.ORDER_NOT_FOUND, STATUSCODE.NOT_FOUND))

        // Do not allow deleting a completed & paid order


        // Soft-delete the order
        await Order.update({ deleted: true }, { where: { id: order_id, hotel_id } })

        // If dine-in order, free the table
        if (findOrder.order_type === ORDER_TYPE.DININ && findOrder.TableId) {
            await Table.update({ table_status: "F" }, { where: { id: findOrder.TableId, hotel_id } })
            await updateTableToRadis(findOrder.TableId, hotel_id)
        }

        // Remove from Redis cache
        await deleteOrderToRedis(order_id, hotel_id)

        return res.status(STATUSCODE.SUCCESS).json(
            mobileSuccess(MESSAGE.SUCCESS, {}, MESSAGE.ORDER_DELETED, STATUSCODE.SUCCESS)
        )

    } catch (error) {
        console.log(error, "Error While Deleting Order::")
        createLogFile(req.user, "Error in deleteOrder API", error)
        return res.json(mobileError(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
module.exports = { updateOrder, deleteOrder, settleAllDueMobilePayment, settleDueMobile, getDueOrdersMobile, serviceCharge, orderIdWiseOrderGet, mobileSettleBills, mobileAccess, AllInvoice, getMobilePickupOrders }
