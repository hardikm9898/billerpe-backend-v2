const Order = require("../../model/order")
const Item = require("../../model/menu")
const Cart = require("../../model/cart")
const { getBusinessDate } = require("../../utils/dateUtils")

const { Op } = require("sequelize")
const { STATUSCODE, MESSAGE, STATUS, ORDER_TYPE, ORDER_DETAILS_TYPE } = require("../../constant/const")
const { mobileError, success, mobileSuccess } = require("../../responce/res")
const Menu = require("../../model/menu")
const TableCatagories = require("../../model/table_catg")
const Table = require("../../model/table")
const User = require("../../model/user")
const OrderDetails = require("../../model/order_details")
const Hotel = require("../../model/hotel")
const moment = require("moment")
const Menu_categ = require("../../model/menu_categ")
const { Json } = require("sequelize/lib/utils")
const Variants = require("../../model/variants")
const { createLogFile } = require("../../logs/log")
const AddonDepartment = require("../../model/addonDepartMent")
const Addons = require("../../model/addons")
const { sequelize, RestaurantSetting } = require("../../model")
const { deleteOrderToRedis, updateTableToRadis, updateOrderAppendToRadis, newOrderAppendToRadis } = require("../redis/redisCrud")
const { updatedPosData } = require("./kot")
const { RestoreObjectCommand } = require("@aws-sdk/client-s3")
const { getNextBillNo } = require("../../helpers/billNumber")

const safeRedisCall = async (promise, label) => {
    try {
        console.log(label, "Lable")
        await promise;
    } catch (err) {
        console.error(`Redis error [${label}]:`, err);
    }
};
const mobileTable = async (req, res) => {
    try {
        const hotel = await Hotel.findOne({ where: { id: req.user } })
        if (!hotel) return res.json(mobileError(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST))

        let tables =
            await TableCatagories.findAll({
                where: {
                    hotel_id: req.user, active: true
                },
                include: [{
                    model: Table, where: { active: true, hotel_id: req.user }, include: [{
                        model: Order, where: {
                            status: {
                                [Op.in]: [ORDER_TYPE.IN_PROGRESS, ORDER_TYPE.SUCCESS, ORDER_TYPE.HOLD]
                            },
                            payment: STATUS.PENDING,
                            deleted: false,

                        },
                        required: false,
                        include: [{
                            model: OrderDetails,
                        }, { model: User }]
                    }]
                }]
            })


        tables = tables.map(el => {
            let category = el.hms_table_msts.map((tables, index) => {
                let kotCount = 0
                if (tables.hms_order_msts[0]) {
                    // console.log(tables.hms_order_msts[0].hms_orderDetails, "Order sss--->")
                    tables.hms_order_msts[0]?.hms_orderDetails.forEach((el) => {
                        if (el.kotNumber) {
                            if (kotCount < el.kotNumber) {
                                kotCount = el.kotNumber
                            }
                        }

                        if (el.status === "delivered") {
                            kotCount = 1
                        }
                    })
                    tables.hms_order_msts[0].dataValues.kotItems = kotCount
                    tables.hms_order_msts[0].dataValues.hms_orderDetails = []
                }

                return tables
            })
            el.hms_table_msts = category
            return el
        })

        console.log(JSON.parse(JSON.stringify(tables)), "Tables----->")

        return res.status(STATUSCODE.SUCCESS).json(mobileSuccess(MESSAGE.SUCCESS, { tables }, "", STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err)
        //createLogFile(req.user, `Getting mobileTable /err Error`, err);

        return res.status(STATUSCODE.INTERNAL_SERVER_ERROR).json(mobileError(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}


const tableWiseKotRetrive = async (req, res) => {
    try {
        const { tableNumber, order_id, order_type = 'dinin' } = req.body
        if (order_type === 'dinin') {
            const table_number = tableNumber.split("-")[0]
            const catagories_name = tableNumber.split("-")[1]
            console.log(req.body)
            const tableCatagories = await TableCatagories.findOne({ where: { table_catag_nm: catagories_name, hotel_id: req.user, active: true } })
            if (!tableCatagories) {
                return res.json(mobileError(MESSAGE.TABLE_CATEGORY_NOT_AVAILABLE, STATUSCODE.BAD_REQUEST))
            }
            // console.log(tableCatagories, "catagories================>")
            const table = await Table.findOne({ where: { table_name: table_number, table_catag_id: tableCatagories.id, hotel_id: req.user, active: true } })
            if (!table) {
                return res.json(mobileError(MESSAGE.TABLE_NOT_AVAILABLE, STATUSCODE.BAD_REQUEST))
            }


            const order = await Order.findOne({ where: { id: order_id, hotel_id: req.user } })

            if (!order) {
                return res.json(mobileError(MESSAGE.ORDER_NOT_FOUND, STATUSCODE.BAD_REQUEST))
            }
            console.log(table, "tables================>")
            const kot = await OrderDetails.findAll({
                where: {
                    hotel_id: req.user,
                    // TableId: table.id,
                    status: {
                        [Op.or]: [ORDER_DETAILS_TYPE.IN_PROGRESS, ORDER_DETAILS_TYPE.KOT, ORDER_DETAILS_TYPE.DELIVERED]
                    },
                    orderId: order_id,
                },
                include: [{ model: Menu, include: [{ model: Variants, as: "variantData", where: { active: true }, required: false }, { model: AddonDepartment, as: "addonDepartmentData", include: { model: Addons } }] }, { model: Variants, as: "variantData" }]
            });


            console.log(kot, "kot here=ddd==========>")
            const groupedKot = {};
            kot.forEach((item, index) => {
                const data = JSON.parse(JSON.stringify(item))
                data.addonDepartmentData = data.addons
                delete data.addons
                // console.log(data, "Items going------------")
                if (!groupedKot[`KOT-${data.kotNumber}`]) {
                    groupedKot[`KOT-${data.kotNumber}`] = [];
                }
                groupedKot[`KOT-${data.kotNumber}`].push(data);
            });
            // console.log(groupedKot, "Group Kot--->")
            const resultsArray = Object.keys(groupedKot).map(kotName => {

                return {
                    title: kotName,
                    status: kotName === "KOT-0" ? "H" : "K",
                    menuItems: groupedKot[kotName]
                }
            });

            // console.log(resultsArray, "resultsArray");

            return res.json(mobileSuccess(MESSAGE.SUCCESS, resultsArray, "", STATUSCODE.SUCCESS))
        } else {

            const order = await Order.findOne({ where: { id: order_id, hotel_id: req.user } })

            if (!order) {
                return res.json(mobileError(MESSAGE.ORDER_NOT_FOUND, STATUSCODE.BAD_REQUEST))
            }
            // console.log(table, "tables================>")
            const kot = await OrderDetails.findAll({
                where: {
                    hotel_id: req.user,
                    status: {
                        [Op.or]: [ORDER_DETAILS_TYPE.IN_PROGRESS, ORDER_DETAILS_TYPE.KOT, ORDER_TYPE.DELIVERY]
                    },
                    orderId: order_id,
                },
                include: [{ model: Menu, include: [{ model: Variants, as: "variantData", where: { active: true }, required: false }, { model: AddonDepartment, as: "addonDepartmentData", include: { model: Addons } }] }, { model: Variants, as: "variantData" }]
            });


            // console.log(kot, "kot here===========>")
            const groupedKot = {};
            kot.forEach((item, index) => {
                const data = JSON.parse(JSON.stringify(item))
                data.addonDepartmentData = data.addons
                delete data.addons
                // console.log(data, "Items going------------")

                if (!groupedKot[`KOT-${data.kotNumber}`]) {
                    groupedKot[`KOT-${data.kotNumber}`] = [];
                }
                groupedKot[`KOT-${data.kotNumber}`].push(data);
            });
            const resultsArray = Object.keys(groupedKot).map(kotName => {
                return {
                    title: kotName,
                    status: kotName === "KOT-0" ? "H" : "K",
                    menuItems: groupedKot[kotName]
                }
            });

            // console.log(resultsArray, "results Array");

            return res.json(mobileSuccess(MESSAGE.SUCCESS, resultsArray, "", STATUSCODE.SUCCESS))
        }
    } catch (err) {
        //createLogFile(req.user, `Getting tableWiseKotRetrive MoBile /err Error`, err);
        console.log(err)
        return res.status(STATUSCODE.INTERNAL_SERVER_ERROR).json(mobileError(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const moveMobileKot = async (req, res) => {
    const t = await sequelize.transaction();
    try {
        const hotel = await Hotel.findOne({ where: { id: req.user }, include: { model: RestaurantSetting, attributes: ['timeZone', 'business_day_start_time'] }, transaction: t });
        if (!hotel) {
            await t.rollback()
            return res.json(mobileError(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.NOT_FOUND))
        };
        const timeZone = hotel?.hms_res_setting?.timeZone || "Asia/Kolkata"
        const businessStartTime = hotel?.hms_res_setting?.business_day_start_time || "00:01:00"

        let orderDeleted = false;
        let createdNewOrder = false
        const { orderId, kotNumberString, tableId1, tableId2,version } = req.body;
        
        if (!orderId || !kotNumberString || !tableId1 || !tableId2 || !version) {
            await t.rollback()
            return res.json(mobileError("All Fields Required", STATUSCODE.BAD_REQUEST));
        }
        const kotNumber = parseInt(kotNumberString.split("-")[1], 10);

        console.log('Request data:', { orderId, kotNumber, tableId1, tableId2 });

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
            return res.json(mobileError(MESSAGE.KOT_NOT_FOUND, STATUSCODE.BAD_REQUEST));
        }

        const currentOrder = await Order.findOne({ where: { id: orderId, hotel_id: req.user,TableId:tableId1, deleted: false }, transaction: t });
        
        if (!currentOrder) {
            await t.rollback()
            return res.json(mobileError(MESSAGE.ORDER_NOT_FOUND, STATUSCODE.BAD_REQUEST));
        }
         if(currentOrder.version !== Number(version) ){
            await t.rollback()
            return res.json(mobileError("Version Match Refresh And Please Retry Again", STATUSCODE.BAD_REQUEST));
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


            const maxOnlineBillNo = await getNextBillNo(req.user)
            const business_date = getBusinessDate(timeZone, businessStartTime)
            const newOrder = await Order.create(
                {
                    UserId: currentOrder.UserId,
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
        console.log(createdNewOrder, orderDeleted)
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
        updatedPosData(io, req.user);
        return res.status(STATUSCODE.SUCCESS).json(mobileSuccess(MESSAGE.SUCCESS, { message: MESSAGE.KOT_MOVED, orderId: newOrderId }, "Kot Moved Successfully", STATUSCODE.SUCCESS));
    } catch (err) {
        await t.rollback();
        console.log("Error in moveKot:", err);
        return res.json(mobileError(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};
const moveMobileTable = async (req, res) => {
    const t = await sequelize.transaction();
    try {
        const { tableId1, tableId2, orderId,version } = req.body;
        if (!orderId || !tableId1 || !tableId2 || !version) {
            await t.rollback()
            return res.json(mobileError("All Fields Required", STATUSCODE.BAD_REQUEST));
        }
        const hotel = await Hotel.findOne({ where: { id: req.user }, transaction: t });
        if (!hotel) {
            await t.rollback()
            return res.json(mobileError(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.NOT_FOUND));
        }

        const currentOrder = await Order.findOne({ where: { id: orderId, hotel_id: req.user, TableId:tableId1, deleted: false }, transaction: t });
        if (!currentOrder) {
            await t.rollback()
            return res.json(mobileError(MESSAGE.ORDER_NOT_FOUND, STATUSCODE.BAD_REQUEST));
        }
        if(currentOrder.version !== Number(version) ){
          await t.rollback()
          return res.json(mobileError("Version Match Refresh And Please Retry Again", STATUSCODE.BAD_REQUEST));
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
        console.log(orderDeleted, "Order Details::")
        if (orderDeleted) {

            await safeRedisCall(deleteOrderToRedis(orderId, req.user), 'deleteOrder');
            await safeRedisCall(updateOrderAppendToRadis(orderUpdateId, req.user), 'updateOrder');
        } else {

            await safeRedisCall(updateOrderAppendToRadis(orderUpdateId, req.user), 'updateOrder');
            await safeRedisCall(updateOrderAppendToRadis(orderId, req.user), 'updateOrder');
        }
        await safeRedisCall(updateTableToRadis(tableId1, req.user), 'updateTable1');
        await safeRedisCall(updateTableToRadis(tableId2, req.user), 'updateTable2');
        updatedPosData(io, req.user);
        return res.status(STATUSCODE.SUCCESS).json(mobileSuccess(MESSAGE.SUCCESS, { message: MESSAGE.T_O_M_S, orderId: newOrderId }, "Table Order Moved Successfully", STATUSCODE.SUCCESS));
    } catch (err) {
        console.log("Error in moveTable:", err);
        await t.rollback();
        return res.json(mobileError(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};


module.exports = { moveMobileKot, moveMobileTable, mobileTable, tableWiseKotRetrive }