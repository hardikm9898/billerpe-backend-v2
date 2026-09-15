const Table = require("../model/table")
const TableCatagories = require("../model/table_catg")
const Order = require("../model/order")
const { error, success } = require("../responce/res")
const { MESSAGE, STATUSCODE, STATUS, ORDER_TYPE, ORDER_DETAILS_TYPE } = require("../constant/const")
const OrderDetails = require("../model/order_details")
const { Op, where } = require("sequelize")
const sequelize = require("../connection/connect")
const Menu = require("../model/menu")
const Hotel = require("../model/hotel")
const { createLogFile } = require("../logs/log")
const { deleteOrderToRedis, updateTableToRadis, updateOrderAppendToRadis, newOrderAppendToRadis, newTableCreatedToRadis } = require("./redis/redisCrud")
const { TimeLine, Menu_categ, TaxType, OrderTax, RestaurantSetting } = require("../model")
const redisClient = require("../connection/redis")

const { getBusinessDate } = require("../utils/dateUtils")
const { getNextBillNo } = require("../helpers/billNumber")
const safeRedisCall = async (promise, label) => {
    try {
        await promise;
    } catch (err) {
        console.error(`Redis error [${label}]:`, err);
    }
};
const webChange = async (hotelId, io, tableId1, tableId2) => {
    try {
        let orders;
        const exists = await redisClient.exists(`hotel:${hotelId}:orders`);
        if (exists) {
            const value = await redisClient.get(`hotel:${hotelId}:orders`);
            orders = JSON.parse(value);
        } else {
            orders = await Order.findAll({
                where: {
                    hotel_id: Number(hotelId),
                    deleted: false,
                    payment: {
                        [Op.ne]: STATUS.SUCCESS
                    }
                },
                include: [
                    { model: Table, include: { model: TableCatagories } }, { model: User }, { model: OrderDetails, include: [{ model: Menu, include: { model: Menu_categ } }, { model: Variants, as: "variantData" }] }
                ],
                order: [['createdAt', 'DESC']]
            });
            await redisClient.set(
                `hotel:${Number(hotelId)}:orders`,
                JSON.stringify(orders),
                { EX: 172800 }
            );
        }
        const tables = await Table.findAll({ where: { hotel_id: Number(hotelId), active: true }, include: { model: TableCatagories, where: { hotel_id: Number(hotelId), active: true }, attributes: [], required: true } })


        await io.to(hotelId).emit("webChange", { key: "move", tableId1, tableId2, orders, tables })
        // log("TimeLine", timeLine)
    } catch (error) {
        console.log(error, "on Web Change")
    }
}
const moveKot = async (req, res) => {
    const t = await sequelize.transaction();
    try {
        const hotel = await Hotel.findOne({ where: { id: req.user }, include: { model: RestaurantSetting, attributes: ['timeZone', 'business_day_start_time'] }, transaction: t });
        if (!hotel) {
            await t.rollback()
            return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.NOT_FOUND))
        };
        const timeZone = hotel?.hms_res_setting?.timeZone || "Asia/Kolkata"
        const businessStartTime = hotel?.hms_res_setting?.business_day_start_time || "00:01:00"

        let orderDeleted = false;
        let createdNewOrder = false
        const { orderId, kotNumber, tableId1, tableId2 } = req.body;

        let newOrderId = orderId;

        const kotAvailable = await OrderDetails.findAll({
            where: {
                hotel_id: req.user,
                orderId,
                kotNumber,
                TableId: tableId1,
                status: ORDER_DETAILS_TYPE.KOT,
                payment_status: STATUS.PENDING
            },
            include: { model: Menu },
            transaction: t
        });

        if (!kotAvailable.length) {
            await t.rollback()
            return res.json(error(MESSAGE.KOT_NOT_FOUND, STATUSCODE.BAD_REQUEST));
        }

        const currentOrder = await Order.findOne({ where: { id: orderId, hotel_id: req.user, deleted: false }, transaction: t });
        if (!currentOrder) {
            await t.rollback()
            return res.json(error(MESSAGE.ORDER_NOT_FOUND, STATUSCODE.BAD_REQUEST));
        }
        // A bill already generated (status "success") is meant to be settled
        // as printed, not have KOT rounds moved off it afterward - see
        // moveTable's own identical guard below.
        if (currentOrder.status === ORDER_TYPE.SUCCESS) {
            await t.rollback()
            return res.json(error("Bill already generated for this order - its KOT rounds can no longer be moved", STATUSCODE.BAD_REQUEST));
        }
        const orderAvailableOnTable2 = await Order.findOne({
            where: {
                hotel_id: req.user,
                TableId: tableId2,
                payment: STATUS.PENDING,
                deleted: false,
                status: { [Op.or]: [ORDER_TYPE.HOLD, ORDER_TYPE.IN_PROGRESS] }
            },
            transaction: t
        });

        let totalAmount = 0;
        let totalGstNotGstAmount = 0;
        let totalDiscount = 0;

        for (const item of kotAvailable) {
            totalAmount += +item.qty * item.price;
            if (item.dataValues.hms_menu_mst.gst_type === 'G') {
                totalGstNotGstAmount += +item.qty * item.price;
            }
            totalDiscount += item.totalDiscount;
        }

        let gst = hotel.invoiceFormateIncGst ? (((totalAmount - totalGstNotGstAmount) * 5) / 100) : 0;

        if (orderAvailableOnTable2) {
            newOrderId = orderAvailableOnTable2.id;

            const findMaxKot = await OrderDetails.max("kotNumber", {
                where: { orderId: orderAvailableOnTable2.id, TableId: tableId2 },
                transaction: t
            });

            await OrderDetails.update(
                { TableId: tableId2, orderId: newOrderId, kotNumber: findMaxKot + 1 },
                {
                    where: {
                        hotel_id: req.user,
                        orderId,
                        kotNumber,
                        TableId: tableId1,
                        status: ORDER_DETAILS_TYPE.KOT,
                        payment_status: STATUS.PENDING
                    },
                    transaction: t
                }
            );

            const afterUpdate = await OrderDetails.findOne({
                where: {
                    hotel_id: req.user,
                    orderId,
                    TableId: tableId1,
                    status: ORDER_DETAILS_TYPE.KOT,
                    payment_status: STATUS.PENDING
                },
                transaction: t
            });

            if (!afterUpdate) {
                await Table.update({ table_status: "F" }, { where: { id: tableId1, hotel_id: req.user }, transaction: t });
                await Order.update({ deleted: true }, { where: { id: orderId, hotel_id: req.user }, transaction: t });
                orderDeleted = true
            }

            await Order.update(
                {
                    grandAmount: Math.round(orderAvailableOnTable2.grandAmount + totalAmount + gst + totalDiscount),
                    totalAmount: orderAvailableOnTable2.totalAmount + totalAmount,
                    gst: orderAvailableOnTable2.gst + gst,
                    totalDiscount: orderAvailableOnTable2.totalDiscount + totalDiscount
                },
                { where: { id: newOrderId, hotel_id: req.user }, transaction: t }
            );

            if (afterUpdate) {
                await Order.update(
                    {
                        grandAmount: Math.round((currentOrder.totalAmount + currentOrder.gst - currentOrder.totalDiscount) - (totalAmount + gst - totalDiscount)),
                        totalAmount: currentOrder.totalAmount - totalAmount,
                        gst: currentOrder.gst - gst,
                        totalDiscount: currentOrder.totalDiscount - totalDiscount
                    },
                    { where: { id: orderId, hotel_id: req.user }, transaction: t }
                );
            }

        } else {
            // const allOrderData = await Order.findAll({ where: { hotel_id: req.user, isOffline: false }, transaction: t });

            // const maxOnlineBillNo = allOrderData.reduce((max, o) => {
            //     const val = parseInt(o.bill_no, 10);
            //     return val > max ? val : max;
            // }, 0);
            const maxOnlineBillNo = await getNextBillNo(req.user)
            const business_date = getBusinessDate(timeZone, businessStartTime)
            const newOrder = await Order.create(
                {
                    business_date,
                    bill_no: maxOnlineBillNo,
                    order_type: ORDER_TYPE.DININ,
                    status: ORDER_TYPE.IN_PROGRESS,
                    totalAmount,
                    grandAmount: Math.round(totalAmount + gst + totalDiscount),
                    gst,
                    totalDiscount,
                    TableId: tableId2,
                    hotel_id: req.user
                },
                { transaction: t }
            );
            createdNewOrder = true
            newOrderId = newOrder.id;

            await OrderDetails.update(
                { TableId: tableId2, orderId: newOrderId, kotNumber: 1 },
                {
                    where: {
                        hotel_id: req.user,
                        orderId,
                        kotNumber,
                        status: ORDER_DETAILS_TYPE.KOT,
                        payment_status: STATUS.PENDING
                    },
                    transaction: t
                }
            );

            await Table.update({ table_status: "R" }, { where: { id: tableId2, hotel_id: req.user }, transaction: t });

            const afterUpdate = await OrderDetails.findOne({
                where: {
                    hotel_id: req.user,
                    orderId,
                    TableId: tableId1,
                    status: ORDER_DETAILS_TYPE.KOT,
                    payment_status: STATUS.PENDING
                },
                transaction: t
            });

            if (!afterUpdate) {
                await Table.update({ table_status: "F" }, { where: { id: tableId1, hotel_id: req.user }, transaction: t });
                await Order.update({ deleted: true }, { where: { id: orderId, hotel_id: req.user }, transaction: t });
                orderDeleted = true
            } else {
                await Order.update(
                    {
                        grandAmount: Math.round((currentOrder.totalAmount + currentOrder.gst - currentOrder.totalDiscount) - (totalAmount + gst - totalDiscount)),
                        totalAmount: currentOrder.totalAmount - totalAmount,
                        gst: currentOrder.gst - gst,
                        totalDiscount: currentOrder.totalDiscount - totalDiscount
                    },
                    { where: { id: orderId, hotel_id: req.user }, transaction: t }
                );
            }
        }

        await t.commit();
        const tasks = [
            () => safeRedisCall(updateTableToRadis(tableId1, req.user), 'tableId1'),
            () => safeRedisCall(updateTableToRadis(tableId2, req.user), 'tableId2'),
            ...(orderDeleted
                ? [() => safeRedisCall(deleteOrderToRedis(orderId, req.user), 'deleteOrder')]
                : [() => safeRedisCall(updateOrderAppendToRadis(orderId, req.user), 'orderId')]
            ),
            ...(createdNewOrder
                ? [() => safeRedisCall(newOrderAppendToRadis(newOrderId, req.user), 'newOrder')]
                : [() => safeRedisCall(updateOrderAppendToRadis(newOrderId, req.user), 'newOrderId')]
            )
        ];

        for (const task of tasks) {
            await task();
        }

        webChange(req.user, io, tableId1, tableId2);

        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { message: MESSAGE.KOT_MOVED, orderId: newOrderId }, STATUSCODE.SUCCESS));
    } catch (err) {
        await t.rollback();
        console.error("Error in moveKot:", err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};
const moveTable = async (req, res) => {
    const t = await sequelize.transaction();
    try {
        const { tableId1, tableId2, orderId } = req.body;

        const hotel = await Hotel.findOne({ where: { id: req.user }, transaction: t });
        if (!hotel) {
            await t.rollback()
            return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.NOT_FOUND));
        }

        const currentOrder = await Order.findOne({ where: { id: orderId, hotel_id: req.user, deleted: false }, transaction: t });
        if (!currentOrder) {
            await t.rollback()
            return res.json(error(MESSAGE.ORDER_NOT_FOUND, STATUSCODE.BAD_REQUEST));
        }
        // A bill already generated (status "success" - see billerpe-pos-pro-v2's
        // own mapRawLiveOrder, which reads this exact status as "Bill
        // Generated") is meant to be settled as printed, not silently folded
        // into/moved off its table afterward. The frontend already blocks this
        // in its own mergeTables/transferTable before ever calling here -
        // this is the server-side backstop for any other caller.
        if (currentOrder.status === ORDER_TYPE.SUCCESS) {
            await t.rollback()
            return res.json(error("Bill already generated for this order - it can no longer be moved or merged", STATUSCODE.BAD_REQUEST));
        }

        let orderDeleted = false
        let orderUpdateId = 0
        let newOrderId = orderId;

        const orderAvailableOnTable2 = await Order.findOne({
            where: {
                hotel_id: req.user,
                TableId: tableId2,
                payment: STATUS.PENDING,
                deleted: false,
                status: { [Op.or]: [ORDER_TYPE.HOLD, ORDER_TYPE.IN_PROGRESS] }
            },
            transaction: t
        });

        if (orderAvailableOnTable2) {
            newOrderId = orderAvailableOnTable2.id;

            const kotAvailable = await OrderDetails.findAll({
                where: {
                    hotel_id: req.user,
                    orderId,
                    TableId: tableId1,
                    status: { [Op.ne]: ORDER_DETAILS_TYPE.DELIVERED },
                    payment_status: STATUS.PENDING
                },
                include: { model: Menu },
                transaction: t
            });

            let findMaxKot = await OrderDetails.max("kotNumber", {
                where: { orderId: newOrderId, TableId: tableId2 },
                transaction: t
            });

            const maxKot = await OrderDetails.max("kotNumber", {
                where: { orderId, TableId: tableId1 },
                transaction: t
            });

            for (let index = 1; index <= maxKot; index++) {
                await OrderDetails.update(
                    {
                        kotNumber: ++findMaxKot,
                        orderId: newOrderId,
                        TableId: tableId2
                    },
                    {
                        where: { kotNumber: index, hotel_id: req.user, TableId: tableId1, orderId },
                        transaction: t
                    }
                );
            }

            let totalAmount = 0, totalGstNotGstAmount = 0, totalDiscount = 0;

            for (const item of kotAvailable) {
                totalAmount += +item.qty * item.price;
                if (item.dataValues.hms_menu_mst.gst_type === 'G') {
                    totalGstNotGstAmount += +item.qty * item.price;
                }
                totalDiscount += item.totalDiscount;
            }

            let gst = hotel.invoiceFormateIncGst ? (((totalAmount - totalGstNotGstAmount) * 5) / 100) : 0;

            await Order.update(
                {
                    grandAmount: Math.round(orderAvailableOnTable2.grandAmount + totalAmount + gst + totalDiscount),
                    totalAmount: orderAvailableOnTable2.totalAmount + totalAmount,
                    gst: orderAvailableOnTable2.gst + gst,
                    totalDiscount: orderAvailableOnTable2.totalDiscount + totalDiscount
                },
                { where: { id: newOrderId, hotel_id: req.user }, transaction: t }
            );

            await Order.update({ deleted: true }, { where: { id: orderId, hotel_id: req.user }, transaction: t });
            orderDeleted = true
            orderUpdateId = newOrderId
            await Table.update({ table_status: 'F' }, { where: { id: tableId1, hotel_id: req.user }, transaction: t });
        } else {
            await Order.update({ TableId: tableId2 }, { where: { id: orderId, hotel_id: req.user, deleted: false }, transaction: t });

            await OrderDetails.update(
                { TableId: tableId2 },
                {
                    where: {
                        hotel_id: req.user,
                        orderId,
                        TableId: tableId1,
                        payment_status: STATUS.PENDING
                    },
                    transaction: t
                }
            );
            await Table.update({ table_status: 'F' }, { where: { id: tableId1, hotel_id: req.user }, transaction: t });
            await Table.update({ table_status: 'R' }, { where: { id: tableId2, hotel_id: req.user }, transaction: t });
        }

        await t.commit();
        if (orderDeleted) {

            await safeRedisCall(deleteOrderToRedis(orderId, req.user), 'deleteOrder');
            await safeRedisCall(updateOrderAppendToRadis(orderUpdateId, req.user), 'updateOrder');
        } else {

            await safeRedisCall(updateOrderAppendToRadis(orderUpdateId, req.user), 'updateOrder');
            await safeRedisCall(updateOrderAppendToRadis(orderId, req.user), 'updateOrder');
        }
        await safeRedisCall(updateTableToRadis(tableId1, req.user), 'updateTable1');
        await safeRedisCall(updateTableToRadis(tableId2, req.user), 'updateTable2');

        webChange(req.user, io, tableId1, tableId2);
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { message: MESSAGE.T_O_M_S, orderId: newOrderId }, STATUSCODE.SUCCESS));
    } catch (err) {
        await t.rollback();
        console.error("Error in moveTable:", err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};




// room Categories 

module.exports = { moveKot, moveTable }