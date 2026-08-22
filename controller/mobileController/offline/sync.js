const { where } = require("sequelize")
const { MESSAGE, STATUSCODE, ORDER_TYPE } = require("../../../constant/const")
const { createLogFile } = require("../../../logs/log")
const AddonDepartment = require("../../../model/addonDepartMent")
const Addons = require("../../../model/addons")
const Hotel = require("../../../model/hotel")
const InvoiceFormate = require("../../../model/invoiceFormate")
const Menu = require("../../../model/menu")
const MenuAddon = require("../../../model/menu_addons")
const Menu_categ = require("../../../model/menu_categ")
const MenuVariants = require("../../../model/menu_variant")
const Order = require("../../../model/order")
const OrderDetails = require("../../../model/order_details")
const Table = require("../../../model/table")
const TableCatagories = require("../../../model/table_catg")
const TimeLine = require("../../../model/timeline")
const User = require("../../../model/user")
const Variants = require("../../../model/variants")
const { mobileError, mobileSuccess } = require("../../../responce/res")
const { MenuShowByCatagories } = require("../../menu")
const { getBusinessDate } = require("../../../utils/dateUtils")
const RestaurantSetting = require("../../../model/restaurantSetting")

function matchDepartmentsAndAddonsById(original, other) {
    if (original.length !== other.length) return false;
    for (let dept of original) {
        const matchingDept = other.find((oDept) => oDept.id === dept.id);

        if (!matchingDept) {

            return false;
        }
        console.log(matchingDept, dept, "both Department -->")

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

async function findExistingUser(input) {
    const { name, number, address, gstin, hotel_id } = input;

    // First handle the case where number exists since it's prioritized
    if (number) {
        return await User.findOne({
            where: {
                hotel_id,
                number
            }
        });
    }

    // Build OR conditions for other fields
    const conditions = [];

    if (name) conditions.push({ name });
    if (address) conditions.push({ address });
    if (gstin) conditions.push({ gstin });

    // If we have any conditions, use OR logic
    if (conditions.length > 0) {
        return await User.findOne({
            where: {
                hotel_id,
                [Op.or]: conditions
            }
        });
    }

    // If no conditions were provided, search with empty fields
    return await User.findOne({
        where: {
            hotel_id,
            name: '',
            number: '',
            gstin: '',
            address: ''
        }
    });
}

// const findAndUpdateUser = async (data) => {

//     const { name, number, address, gstin, hotel_id } = data
//     let user = await findExistingUser({ name, number, address, gstin, hotel_id })
//     if (user) {
//         // Update the existing user
//         await User.update({ name, number, address, gstin }, { where: { id: user.id, hotel_id } });
//         return user
//     } else {
//         // Create a new user
//         return await User.create({ name, number, address, gstin, hotel_id });

//     }
// }

const addToTimeLineMobile = async (timeline, orderId) => {
    console.log(timeline, "TimeLine")
    for (const cur of timeline) {
        if (!cur.is_web) {
            const items = JSON.parse(cur.items)
            delete cur.is_web
            const { gst, grandAmount, discount, creator, order_id, sub_total, order_type, order_status, bill_no, action, device_name, from, created_Date, TableId, hotelUserId, hotel_id } = cur
            await TimeLine.create({ items, gst, grandAmount, discount, creator, order_id, sub_total, order_type, order_status, bill_no, action, device_name, from, created_Date, TableId, hotelUserId, hotel_id, order_id: orderId, event_name: 'sync single order' })
        }

    }

}


const syncSingleOrder = async (data, socket) => {
    try {
        const { orderData, hotelUserId, hotelId } = data;
        const returnData = [];
        // createLogFile(hotelId, `Getting data From Mobile SYNC`, JSON.stringify(orderData));

        for (const el of orderData) {

            const orderDetailsData = el.orderDetail || [];
            const hotel_id = +hotelId;
            const cur = el.order;
            const timeLine = el.timeLine || [];
            //createLogFile(hotelId, `${timeLine[0].device_name} Getting data From Mobile SIngle Order`, JSON.stringify(el));

            // Extract order data
            const { is_web_order, deleted, totalDiscount, totalAmount, due, cash, card, upi,
                status, payment, order_type, grandAmount, gst, UserId, bill_no } = cur;
            let orderId = +cur.id;
            let TableId = +cur.TableId;

            // Handle token generation
            const hotel = await Hotel.findByPk(hotel_id);
            const setting = await RestaurantSetting.findOne({ where: { hotel_id: hotel_id } });
            const timeZone = setting?.timeZone || 'Asia/Kolkata';
            const businessStartTime = setting?.business_day_start_time || '00:01:00';
            const business_date = getBusinessDate(timeZone, businessStartTime);

            let token = 0;
            if (hotel.is_token_on !== "3") {
                if (hotel.is_token_on === '2' ||
                    (hotel.is_token_on === '1' && order_type === 'dinin') ||
                    (hotel.is_token_on === '0' && order_type === 'pickup')) {
                    const { generateToken } = require("../../kto")
                    token = await generateToken(hotel_id);
                }
            }

            // Handle user data
            const { name = "", number = "", address = "", gstin = "" } = cur?.hms_user_master || {};
            const user = await findAndUpdateUser({ name, number, gstin, address, hotel_id });

            // Create or update order

            let order;
            if (!is_web_order) {
                // Handle table for dine-in orders
                if (order_type === ORDER_TYPE.DININ) {
                    const tableRunning = await Order.findOne({
                        where: { TableId, deleted: false, payment: "pending", hotel_id }
                    });

                    if (tableRunning) {
                        TableId = await handleTableConflict(TableId, hotel_id);
                    }

                    const tableStatus = getTableStatus(status, payment);
                    await Table.update({ table_status: tableStatus }, { where: { id: TableId } });
                }

                // Generate bill number
                // const bill_no = await generateBillNumber(hotel_id);

                // Create new order
                order = await Order.create({
                    business_date,
                    hotelUserId: +hotelUserId,
                    token,
                    totalDiscount,
                    totalAmount,
                    due,
                    cash,
                    card,
                    upi,
                    status,
                    payment,
                    bill_no: +bill_no,
                    order_type,
                    grandAmount,
                    gst,
                    hotel_id,
                    TableId: TableId || null,
                    UserId: user.id,
                    isOffline: true,
                    created_from: "mobile"
                });
                await addToTimeLineMobile(timeLine, order.id)
                orderId = order.id;
                // addToTimeLineMobile(timeLine)
            } else {
                // Update existing order
                if (order_type === ORDER_TYPE.DININ) {
                    const tableStatus = getTableStatus(status, payment, deleted);
                    await Table.update({ table_status: tableStatus }, { where: { id: TableId } });
                }

                await Order.update({

                    totalDiscount,
                    UserId: user.id,
                    totalAmount,
                    due,
                    cash,
                    card,
                    upi,
                    status,
                    payment,
                    order_type,
                    grandAmount,
                    gst
                }, { where: { id: orderId, hotel_id } });

                // Fetch the updated order
                await addToTimeLineMobile(timeLine, orderId)
                order = await Order.findByPk(orderId);
            }

            // Make sure order exists before processing order details
            if (!order) {
                throw new Error(`Order not found with ID: ${orderId}`);
            }

            // Handle order details
            await OrderDetails.destroy({ where: { orderId: order.id, hotel_id } });

            for (const detail of orderDetailsData) {
                if (+detail.qty <= 0) continue;

                const orderDetail = {
                    MenuId: +detail.MenuId,
                    qty: detail.qty,
                    price: +detail.price,
                    kotNumber: +detail.kotNumber,
                    order_type: detail.order_type,
                    comment: detail?.comment,
                    payment_status: detail.payment_status,
                    hotel_id: +hotel_id,
                    orderId: order.id,
                    status: detail.status,
                    TableId: TableId || null,
                    addons: detail.addons || [],
                    variant_id: detail?.variant_id || null,
                    variant_name: detail?.variant_name || ""
                };

                await OrderDetails.create(orderDetail);
            }

            const returnTimeline = await TimeLine.findAll({ where: { order_id: order.id, hotel_id } })
            // Prepare response data
            const table = TableId ? await Table.findByPk(TableId) : null;
            const orderDetails = await OrderDetails.findAll({
                where: {
                    hotel_id,
                    orderId: order.id
                }
            });

            const responseData = {
                table,
                hotelUserId,
                order,
                orderDetails,
                oldOrderId: cur.id,
                timeLine: returnTimeline
            };

            returnData.push(responseData);
            // addToTimeLineSync()
            // Emit socket event
            //createLogFile(hotelId, `${timeLine[0].device_name} return Data SYNC single Order`, JSON.stringify(returnData));
            await socket.to(+hotel_id).emit("create_order",
                mobileSuccess("success", responseData, "New Order And Orderdetails", STATUSCODE.SUCCESS)
            );
        }

        // Send final response

        await socket.emit('syncSingleOrder',
            mobileSuccess("success", { returnData }, "New Order And Orderdetails", STATUSCODE.SUCCESS)
        );
        const { updatedPosData, findAndUpdateUser } = require("../kot")
        await updatedPosData(io, +hotelId);

    } catch (err) {
        console.error(err);
        //createLogFile("sync", `Getting Error`, err);
        await socket.emit('syncSingleOrder',
            mobileError(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR)
        );
    }
};

// Helper functions
const getTableStatus = (status, payment, deleted = false) => {
    if (status === "hold" && !deleted) return "H";
    if (status === "hold" && deleted) return "F";
    if (status === ORDER_TYPE.IN_PROGRESS) return "R";
    if (status === ORDER_TYPE.SUCCESS && payment === ORDER_TYPE.SUCCESS) return "F";
    return "P";
};

const generateBillNumber = async (hotel_id) => {
    const allOrderData = await Order.findAll({
        where: { hotel_id, isOffline: false, deleted: false },
        attributes: ['bill_no']
    });

    const maxBillNo = allOrderData.reduce((max, invoice) => {
        const numericValue = parseInt(invoice.bill_no, 10);
        return numericValue > max ? numericValue : max;
    }, 0);

    return maxBillNo + 1;
};

const handleTableConflict = async (TableId, hotel_id) => {
    const table = await Table.findByPk(TableId);
    const { type, table_catag_id, table_name } = table;

    const newTableName = `${table_name}(1)`;
    let newTable = await Table.findOne({
        where: { table_name: newTableName, hotel_id, type, table_catag_id }
    });

    if (!newTable) {
        newTable = await Table.create({
            type,
            hotel_id,
            table_catag_id,
            table_name: newTableName
        });
    } else {
        await Table.update({ active: true }, { where: { id: newTable.id } });
    }

    return newTable.id;
};

// const syncSingleOrder = async (data, socket) => {
//     try {

//         const { orderData, hotelUserId, hotelId } = data
//         const returnData = []
//       //createLogFile("sync", `Getting data From Mobile`, JSON.stringify(orderData));
//         for (const el of orderData) {
//             const orderDetailsData = el.orderDetail || []
//             const hotel_id = +hotelId

//             // console.log(req.body, "bosy data--")
//             const cur = el.order

//             const { is_web_order, deleted, totalDiscount, totalAmount, due, cash, card, upi, status, payment, order_type, grandAmount, gst, UserId } = cur
//             let orderId = +cur.id
//             let TableId = +cur.TableId
//             // console.log(, "Order Data")
//             let table = {}

//             const hotel = await Hotel.findByPk(hotel_id)
//             let token = 0

//             if (hotel.is_token_on !== "3") {
//                 if (hotel.is_token_on === '2') {
//                     token = await generateToken(hotel_id)
//                 }
//                 if (hotel.is_token_on === '1' && order_type === 'dinin' || hotel.is_token_on === '0' && order_type === 'pickup') {
//                     token = await generateToken(hotel_id)
//                 }
//             }
//             const { name, number, address, gstin } = cur?.hms_user_master ? cur.hms_user_master : { name: "", number: "", address: "", gstin: "" }

//             // const user = await findAndUpdateUser({ name, number, address, gstin, hotel_id: req.user })
//             const user = await findAndUpdateUser({ name: name ? name : "", number: number ? number : "", gstin: gstin ? gstin : "", address: address ? address : "", hotel_id })
//             // console.log(orderData, is_web_order===, "OrderData---->")
//             if (!is_web_order) {

//                 if (order_type === ORDER_TYPE.DININ) {

//                     const tableRunning = await Order.findOne({ where: { TableId, deleted: false, payment: "pending", hotel_id } });

//                     if (tableRunning) {
//                         const table1 = await Table.findByPk(TableId)
//                         const { type, hotel_id, table_catag_id, table_name } = table1
//                         const findExistingTable = await Table.findOne({ where: { table_name: `${table_name}(1)`, hotel_id, type, table_catag_id } })
//                         if (!findExistingTable) {
//                             const updateTable = await Table.create({ type, hotel_id, table_catag_id, table_name: `${table_name}(1)` })
//                             TableId = updateTable.id
//                         } else {
//                             const updateTable = await Table.update({ active: true }, { where: { id: findExistingTable.id } })
//                             TableId = findExistingTable.id
//                         }

//                         table = await Table.findByPk(TableId)
//                     }
//                     const tableStatus = status === "hold" ? "H" : status === ORDER_TYPE.IN_PROGRESS ? "R" : (status === ORDER_TYPE.SUCCESS) && (payment === ORDER_TYPE.SUCCESS) ? "F" : "P"
//                     await Table.update({ table_status: tableStatus }, { where: { id: TableId } })



//                 }

//                 const allOrderData = await Order.findAll({ where: { hotel_id, isOffline: false, deleted: false }, attributes: ['bill_no'] });
//                 const bill_no = allOrderData.reduce((max, invoice) => {
//                     const numericValue = parseInt(invoice.bill_no, 10);
//                     return numericValue > max ? numericValue : max;
//                 }, 0);
//                 console.log(+bill_no + 1, "Bill No")
//                 const order = await Order.create({ hotelUserId: +hotelUserId, token, totalDiscount, totalAmount, due, cash, card, upi, status, payment, bill_no: +bill_no + 1, order_type, grandAmount, gst, hotel_id, TableId: TableId ? TableId : null, UserId: user.id, hotelUserId: +hotelUserId })
//                 orderId = order.id

//                 for (const cur of orderDetailsData) {
//                     if (!+cur.qty) {
//                         // return res.mobileError(MESSAGE.QTY_MUST_BE_GREATER_THAN_ZERO, STATUSCODE.VALIDATION_ERROR)
//                     } else {

//                         let condition = { orderId: order.id, MenuId: +cur.MenuId, price: cur.price, hotel_id }
//                         if (cur.variant_id) {
//                             condition = { orderId: order.id, variant_id: cur.variant_id, MenuId: +cur.MenuId, price: cur.price, hotel_id }
//                         }
//                         const OrderDetailsAvailable = await OrderDetails.findOne({ where: { ...condition } })
//                         let result = false
//                         let addons = []
//                         if (cur?.addons?.length) {
//                             addons = cur.addons
//                         }
//                         if (OrderDetailsAvailable) {
//                             if (addons?.length) {
//                                 const data = matchDepartmentsAndAddonsById(OrderDetailsAvailable.addons, cur.addons)
//                                 if (!data) {
//                                     result = false
//                                 } else {
//                                     result = true
//                                 }
//                             }
//                             else {
//                                 result = true
//                             }
//                         }

//                         if (result) {
//                             await OrderDetails.update({ totalDiscount: cur.discount, qty: +cur.qty + OrderDetailsAvailable.qty, order_type, payment_status: cur.payment_status }, { where: { id: OrderDetailsAvailable.id, hotel_id: +hotel_id } })
//                         }
//                         else {
//                             let modifiedCartForOrderDetails = { MenuId: "", hotel_id: "", qty: "", orderId: "" };
//                             modifiedCartForOrderDetails.MenuId = +cur.MenuId
//                             modifiedCartForOrderDetails.qty = cur.qty
//                             modifiedCartForOrderDetails.price = +cur.price
//                             modifiedCartForOrderDetails.kotNumber = +cur.kotNumber
//                             modifiedCartForOrderDetails.order_type = cur.order_type
//                             modifiedCartForOrderDetails.comment = cur?.comment
//                             modifiedCartForOrderDetails.payment_status = cur.payment_status
//                             modifiedCartForOrderDetails.hotel_id = +hotel_id
//                             modifiedCartForOrderDetails.orderId = order.id
//                             modifiedCartForOrderDetails.status = cur.status
//                             modifiedCartForOrderDetails.TableId = TableId ? +TableId : null
//                             modifiedCartForOrderDetails.addons = cur.addons
//                             modifiedCartForOrderDetails.variant_id = cur?.variant_id ? cur.variant_id : null
//                             modifiedCartForOrderDetails.variant_name = cur?.variant_name ? cur.variant_name : ""
//                             await OrderDetails.create(modifiedCartForOrderDetails)
//                         }
//                     }
//                 }

//             }
//             else {
//                 if (order_type === ORDER_TYPE.DININ) {
//                     const tableStatus = (status === "hold") && (deleted === false) ? "H" : (status === "hold") && (deleted === true) ? "F" : status === ORDER_TYPE.IN_PROGRESS ? "R" : (status === ORDER_TYPE.SUCCESS) && (payment === ORDER_TYPE.SUCCESS) ? "F" : "P"
//                     await Table.update({ table_status: tableStatus }, { where: { id: TableId } })
//                 }
//                 console.log(payment, status, "paymetnt status-->")

//                 await Order.update({ deleted, totalDiscount, UserId: user.id, totalAmount, due, cash, card, upi, status, payment, order_type, grandAmount, gst }, { where: { id: cur.id, hotel_id } })
//                 await OrderDetails.destroy({ where: { orderId: cur.id, hotel_id } })

//                 for (const cur of orderDetailsData) {
//                     if (!+cur.qty) {

//                         // return res.mobileError(MESSAGE.QTY_MUST_BE_GREATER_THAN_ZERO, STATUSCODE.VALIDATION_ERROR)
//                     } else {
//                         let condition = { orderId: cur.id, MenuId: +cur.MenuId, price: cur.price, hotel_id }
//                         if (cur.variant_id) {
//                             condition = { orderId: cur.id, variant_id: cur.variant_id, MenuId: +cur.MenuId, price: cur.price, hotel_id }
//                         }
//                         const OrderDetailsAvailable = await OrderDetails.findOne({ where: { ...condition } })
//                         let result = false
//                         let addons = []
//                         if (cur?.addons?.length) {
//                             addons = cur.addons
//                         }
//                         if (OrderDetailsAvailable) {
//                             if (addons?.length) {
//                                 const data = matchDepartmentsAndAddonsById(OrderDetailsAvailable.addons, cur.addons)
//                                 if (!data) {
//                                     result = false
//                                 } else {
//                                     result = true
//                                 }
//                             }
//                             else {
//                                 result = true
//                             }
//                         }

//                         if (result) {
//                             await OrderDetails.update({ totalDiscount: cur.discount, qty: +cur.qty + OrderDetailsAvailable.qty, order_type, payment_status: cur.payment_status }, { where: { id: OrderDetailsAvailable.id, orderId: cur.id, hotel_id } })
//                         }
//                         else {
//                             let modifiedCartForOrderDetails = { MenuId: "", hotel_id: "", qty: "", orderId: "" };
//                             modifiedCartForOrderDetails.MenuId = +cur.MenuId
//                             modifiedCartForOrderDetails.qty = cur.qty
//                             modifiedCartForOrderDetails.price = +cur.price
//                             modifiedCartForOrderDetails.kotNumber = +cur.kotNumber
//                             modifiedCartForOrderDetails.order_type = cur.order_type
//                             modifiedCartForOrderDetails.comment = cur?.comment
//                             modifiedCartForOrderDetails.payment_status = cur.payment_status
//                             modifiedCartForOrderDetails.hotel_id = +hotel_id
//                             modifiedCartForOrderDetails.orderId = +cur.id
//                             modifiedCartForOrderDetails.status = cur.status
//                             modifiedCartForOrderDetails.TableId = TableId ? TableId : null
//                             modifiedCartForOrderDetails.addons = cur.addons
//                             modifiedCartForOrderDetails.variant_id = cur?.variant_id ? cur.variant_id : null
//                             modifiedCartForOrderDetails.variant_name = cur?.variant_name ? cur.variant_name : ""
//                             await OrderDetails.create(modifiedCartForOrderDetails)
//                         }

//                     }
//                 }
//             }
//             console.log(orderId, "orderId -->")
//             const orders = await Order.findOne({ where: { id: orderId, hotel_id }, include: { model: User } })
//             const orderDetails = await OrderDetails.findAll({ where: { hotel_id }, include: { model: Order, as: "order", where: { id: orderId, hotel_id, }, required: true, attributes: [] } })
//             console.log({ table, hotelUserId, order: orders, orderDetails: orderDetails, oldOrderId: cur.id }, "Push Data--?")
//             returnData.push({ table, hotelUserId, order: orders, orderDetails: orderDetails, oldOrderId: cur.id })

//             await socket.to(+hotel_id).emit("create_order", mobileSuccess("success", { table, hotelUserId, order: orders, orderDetails: orderDetails, oldOrderId: cur.id }, "New Order And Orderdetails", STATUSCODE.SUCCESS))
//         }
//       //createLogFile("sync", `return Data`, JSON.stringify(returnData));
//         console.log(returnData, "retu")

//         await socket.emit('syncSingleOrder', mobileSuccess("success", { returnData }, "New Order And Orderdetails", STATUSCODE.SUCCESS))
//         await updatedPosData(io, +hotelId)

//         // return res.status(STATUSCODE.SUCCESS).json(mobileSuccess("success", { table, orders, orderDetails, oldOrderId: orderData.id, }, MESSAGE.USER_LOGIN, STATUSCODE.SUCCESS));
//     } catch (err) {
//         console.log(err)
//       //createLogFile("sync", `Getting Error`, err);
//         await socket.emit('syncSingleOrder', mobileError(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
//     }
// }

module.exports = { syncSingleOrder }