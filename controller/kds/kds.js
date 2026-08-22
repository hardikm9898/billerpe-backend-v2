const { STATUSCODE, MESSAGE, STATUS, ORDER_TYPE, ORDER_DETAILS_TYPE } = require("../../constant/const")
const { error, success } = require("../../responce/res")

const KitchenSetting = require("../../model/kitchen")
const Menu_categ = require("../../model/menu_categ")

const OrderDetails = require("../../model/order_details")
const Order = require("../../model/order")

const Table = require("../../model/table")
const sequelize = require("../../connection/connect")
const Menu = require("../../model/menu")
const { Op, where } = require("sequelize")
const { getKDSNamespace } = require("../../connection/socket")
const { when } = require("joi")
const { log } = require("util")
const HotelUser = require("../../model/hotelUser")
const TableCatagories = require("../../model/table_catg")
const { updateOrderAppendToRadis } = require("../redis/redisCrud")


const getAllKitchen = async (req, res) => {
    try {
        const kitchen = await KitchenSetting.findAll({ where: { hotel_id: req.user } })
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { kitchen }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log("get all Kitchen Error::::", err)
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

const getKitchenDataById = async (req, res) => {
    try {
        const { id } = req.params
        const data = await KitchenSetting.findByPk(id)
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, data, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log('get kitchen By Id', err)
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

const createKitchen = async (req, res) => {
    try {
        const { kitchen_name } = req.body
        const getAllMenuCategoryId = (await Menu_categ.findAll({ where: { hotel_id: req.user, active: true }, include: { model: Menu, where: { active: true } }, attributes: ['id'] })).map(el => el.id)
        const getAllTableCategoryId = (await Table.findAll({ where: { hotel_id: req.user, active: true }, attributes: ['id'] })).map(el => el.id)
        const checkAvailable = await KitchenSetting.findOne({ where: { kitchen_name, hotel_id: req.user } })


        if (checkAvailable) return res.json(error("This Kitchen Name Already Available", STATUSCODE.BAD_REQUEST))
        await KitchenSetting.create({ hotel_id: req.user, kitchen_name, menu_categ_ids: getAllMenuCategoryId, table_ids: getAllTableCategoryId, order_type: ['dinin', 'pickup'] })
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { message: "Kitchen Created Successfully" }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log("create kitchen Error:::::", err)
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

const getLiveOrders = async (req, res) => {
    try {
        const { kitchenId } = req.params
        const kitchen = await KitchenSetting.findByPk(kitchenId)

        if (!kitchen) {
            return res.json(error("Kitchen not found", STATUSCODE.NOT_FOUND))
        }

        const orders = await Order.findAll({
            where: {
                hotel_id: req.user,
                status: ORDER_DETAILS_TYPE.IN_PROGRESS,
                payment: STATUS.PENDING,
                deleted: false
            },
            include: [{
                model: OrderDetails,
                where: {
                    ready: false,
                    MenuId: {
                        [Op.in]: kitchen.menu_categ_ids
                    }
                },
                include: [{
                    model: Menu,
                    attributes: ['item_name']
                }]
            }],
            order: [['createdAt', 'DESC']]
        })

        // Format orders for KDS display
        const formattedOrders = orders.map(order => ({
            id: order.id,
            orderNo: `#${order.id}`,
            timer: calculateOrderTimer(order.createdAt),
            type: order.order_type,
            biller: order.User?.name || "Unknown",
            room: order.Table?.table_name || "",
            status: "Processing",
            button: "Food Ready",
            buttonColor: kotNumber > 1 ? "red" : "green",
            items: order.OrderDetails.map(item => ({
                name: item.Menu.item_name,
                qty: item.qty,
                ready: item.ready
            })),
            notes: order.notes || ""
        }))

        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { orders: formattedOrders }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log("getLiveOrders Error:::::", err)
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

const markItemReady = async (req, res) => {
    try {
        const { orderId, itemId } = req.body

        await OrderDetails.update(
            { ready: true },
            {
                where: {
                    id: itemId,
                    orderId: orderId,
                    hotel_id: req.user
                }
            }
        )

        // Check if all items are ready
        const order = await Order.findOne({
            where: { id: orderId, hotel_id: req.user },
            include: [{
                model: OrderDetails,
                where: { ready: false }
            }]
        })

        if (order && order.OrderDetails.length === 0) {
            // All items are ready
            await Order.update(
                { status: ORDER_DETAILS_TYPE.DELIVERED },
                { where: { id: orderId, hotel_id: req.user } }
            )
            // setImmediate(() => {

            await updateOrderAppendToRadis(orderId, req.user)

            // });
        }

        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { message: "Item marked as ready" }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log("markItemReady Error:::::", err)
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

// Helper function to calculate order timer
const calculateOrderTimer = (createdAt) => {
    const now = new Date()
    const created = new Date(createdAt)
    const diff = Math.floor((now - created) / 1000 / 60) // difference in minutes
    const hours = Math.floor(diff / 60)
    const minutes = diff % 60
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`
}

const editKitchen = async (req, res) => {
    try {
        const { kitchen_name, id } = req.body
        await KitchenSetting.update({ kitchen_name }, { where: { id } })
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { message: "Kitchen Update Successfully" }, STATUSCODE.SUCCESS))

    } catch (err) {
        console.log("edit kitchne Error:::::", err)
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

const changesMenuAndCategoryId = async (req, res) => {
    try {
        const { menu_categ_ids, item_ids, id } = req.body
        await KitchenSetting.update({ menu_categ_ids, item_ids }, { where: { id } })
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { message: "Kitchen Update Successfully" }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log("changesMenuAndCategoryId Error ::::", err)
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

const getAllLiveKotForKitchenWise = async (req, res) => {

    try {
        const kot = Order.findAll({ where: { hotel_id: req.user, status: ORDER_DETAILS_TYPE.IN_PROGRESS, payment: STATUS.PENDING, deleted: false }, includes: [{ Model: OrderDetails, where: { ready: false } }] })



    } catch (err) {
        console.log("getAllLiveKotForKitchenWise Error :::::", err)
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

const readyKot = async (req, res) => {
    try {

        const { kotNumber, orderId } = req.body
        await OrderDetails.update({ ready: true }, { where: { orderId, kotNumber, hotel_id: req.user } })
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { message: "Ready Item" }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log("readyKotcllic Erro:::", err)
    }
}

const recallKot = async (req, res) => {
    try {


        const orders = await Order.findAll({
            where: {
                hotel_id: req.user,
                status: ORDER_DETAILS_TYPE.IN_PROGRESS,
                payment: STATUS.PENDING,
                deleted: false,

            },

            include: [
                {
                    model: OrderDetails,
                    where: {
                        status: 'kot',
                    },
                    required: true,
                    include: [{
                        model: Menu,

                        attributes: ['item_name', "menu_categ_id"],
                        required: true
                    }]
                },
                { model: HotelUser, attributes: ['name'] }, { model: Table, attributes: ["table_name", 'type'], include: { model: TableCatagories, attributes: ['table_catag_nm'] } }
            ],
            order: [['createdAt', 'DESC']]
        });


        const formattedOrders = orders.map(order => {
            // Group order details by KOT number
            const kotGroups = order.hms_orderDetails.reduce((groups, item) => {
                const kotNumber = item.kotNumber || 0;
                if (!groups[kotNumber]) {
                    groups[kotNumber] = [];
                }
                groups[kotNumber].push(item);
                return groups;
            }, {});
            console.log(JSON.stringify(order), "Order::")
            // Create separate order objects for each KOT
            return Object.entries(kotGroups).map(([kotNumber, items]) => ({
                id: order.id,
                kotNumber: parseInt(kotNumber),
                orderNo: `#${order.id}${kotNumber > 0 ? `-KOT${kotNumber}` : ''}`,
                timer: order.createdAt,
                type: order.order_type,
                biller: order.hms_hotelUser_master?.name || "Unknown",

                room: `${order.hms_table_mst?.type === "T" ? "Table" : "Room"} - ${order.hms_table_mst?.hms_table_categ?.table_catag_nm}(${order.hms_table_mst?.table_name})` || "",
                tableId: order.TableId || "",
                table_name: order.hms_table_mst?.table_name || "",
                status: "Processing",
                button: "Mark Done",
                buttonColor: "green",
                items: items.map(item => ({
                    name: item.hms_menu_mst.item_name,
                    qty: item.qty,
                    ready: item.ready,
                    variant_name: item.variant_name,
                    addons: item.addons,
                    comment: item.comment,
                    id: item.id,
                    menu_categ_id: item?.hms_menu_mst?.menu_categ_id,
                    deleted: false
                })),
                notes: order.notes || ""
            }));
        }).flat().filter(el => {
            const checking = el.items.some(el => !el.ready)
            if (!checking) {
                return el
            }
        });


        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { formattedOrders }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log("while Fetching Recall Kots", err)
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))

    }
}
const setCategoryForKitchen = async (req, res) => {
    const t = await sequelize.transaction()
    try {
        const { table_ids, menu_categ_ids, order_type, id } = req.body
        const findPrinter = await KitchenSetting.findByPk(id, { transaction: t })
        if (!findPrinter) {
            await t.rollback()
            return res.json(error("Kitchen Not Found", STATUSCODE.BAD_REQUEST))
        }
        await KitchenSetting.update({ table_ids, menu_categ_ids, order_type, }, { where: { id, hotel_id: req.user }, transaction: t })
        await t.commit()
        return res.json(success(MESSAGE.SUCCESS, { message: "Kitchen Setting SuccessFully" }, STATUSCODE.SUCCESS))

    } catch (err) {
        await t.rollback()
        console.log(err)
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

const sendKotToAllKdsClient = async (orderId, hotel_id, neworder = false) => {
    try {
        const findAllKitchen = await KitchenSetting.findAll({ where: { hotel_id } })
        if (findAllKitchen.length) {

            for (const kitchen of findAllKitchen) {

                if (neworder) {
                    const orders = await Order.findOne({
                        where: {
                            hotel_id: kitchen.hotel_id,
                            status: ORDER_DETAILS_TYPE.IN_PROGRESS,
                            payment: STATUS.PENDING,
                            deleted: false,
                            id: orderId,

                        },

                        include: [
                            {
                                model: OrderDetails,
                                where: {
                                    status: 'kot',
                                },
                                required: true,
                                include: [{
                                    model: Menu,
                                    attributes: ['item_name', "menu_categ_id"],
                                    required: true
                                }]
                            }, { model: HotelUser, attributes: ['name'] }, { model: Table, attributes: ["table_name", "type"], include: { model: TableCatagories, attributes: ['table_catag_nm'] } }
                        ],
                        order: [['createdAt', 'DESC']]
                    });
                    let kotGroups = {}
                    if (orders && orders.hms_orderDetails.length) {
                        kotGroups = orders.hms_orderDetails.reduce((groups, item) => {
                            const kotNumber = item.kotNumber || 0;
                            if (!groups[kotNumber]) {
                                groups[kotNumber] = [];
                            }
                            groups[kotNumber].push(item);
                            return groups;
                        }, {});
                    }
                    // Create separate order objects for each KOT
                    const formatedData = Object.entries(kotGroups).map(([kotNumber, items]) => ({
                        id: orders.id,
                        kotNumber: parseInt(kotNumber),
                        orderNo: `#${orders.id}${kotNumber > 0 ? `-KOT${kotNumber}` : ''}`,
                        timer: orders.createdAt,
                        type: orders.order_type,
                        biller: orders.hms_hotelUser_master?.name || "Unknown",

                        room: `${orders.hms_table_mst?.type === "T" ? "Table" : "Room"} - ${orders.hms_table_mst?.hms_table_categ?.table_catag_nm}(${orders.hms_table_mst?.table_name})` || "",
                        tableId: orders.TableId || "",
                        status: "Processing",
                        button: "Food Ready",
                        buttonColor: kotNumber > 1 ? "red" : "green",
                        items: items.map(item => ({
                            name: item.hms_menu_mst.item_name,
                            qty: item.qty,
                            ready: item.ready,
                            variant_name: item.variant_name,
                            addons: item.addons,
                            comment: item.comment,
                            id: item.id,
                            menu_categ_id: item?.hms_menu_mst?.menu_categ_id || 0,
                            deleted: false
                        })),
                        notes: orders.notes || ""
                    }));
                    // console.log(formatedData, "FormatedData::")
                    const kdsNamespace = getKDSNamespace();
                    if (kdsNamespace) {
                        var room = kdsNamespace.sockets
                        await kdsNamespace.to(`kitchen_${kitchen.id}`).emit("newOrder", { ...formatedData[0] });
                    }
                }
                else {
                    const orders = await Order.findOne({
                        where: {
                            hotel_id: kitchen.hotel_id,
                            status: ORDER_DETAILS_TYPE.IN_PROGRESS,
                            payment: STATUS.PENDING,
                            deleted: false,
                            id: orderId,
                            TableId: {
                                [Op.in]: kitchen.table_ids
                            },
                        },

                        include: [
                            {
                                model: OrderDetails,
                                where: {
                                    status: 'kot',
                                },
                                required: true,
                                include: [{
                                    model: Menu,

                                    attributes: ['item_name', 'menu_categ_id'],
                                    required: true
                                }]
                            }, { model: HotelUser, attributes: ['name'] }, { model: Table, attributes: ["table_name", "type"], include: { model: TableCatagories, attributes: ['table_catag_nm'] } }
                        ],
                        order: [['createdAt', 'DESC']]
                    });
                    let kotGroups = {}
                    if (orders && orders.hms_orderDetails.length) {
                        kotGroups = orders.hms_orderDetails.reduce((groups, item) => {
                            const kotNumber = item.kotNumber || 0;
                            if (!groups[kotNumber]) {
                                groups[kotNumber] = [];
                            }
                            groups[kotNumber].push(item);
                            return groups;
                        }, {});
                    }
                    // Create separate order objects for each KOT
                    const formatedData = Object.entries(kotGroups).map(([kotNumber, items]) => ({
                        id: orders.id,
                        kotNumber: parseInt(kotNumber),
                        orderNo: `#${orders.id}${kotNumber > 0 ? `-KOT${kotNumber}` : ''}`,
                        timer: orders.createdAt,
                        type: orders.order_type,
                        biller: orders.hms_hotelUser_master?.name || "Unknown",

                        room: `${orders.hms_table_mst?.type === "T" ? "Table" : "Room"} - ${orders.hms_table_mst?.hms_table_categ?.table_catag_nm}(${orders.hms_table_mst?.table_name})` || "",
                        tableId: orders.TableId || "",
                        status: "Processing",
                        button: "Food Ready",
                        buttonColor: kotNumber > 1 ? "red" : "green",
                        items: items.map(item => ({
                            name: item.hms_menu_mst.item_name,
                            qty: item.qty,
                            ready: item.ready,
                            variant_name: item.variant_name,
                            addons: item.addons,
                            comment: item.comment,
                            id: item.id,
                            menu_categ_id: item?.hms_menu_mst?.menu_categ_id || 0,
                            deleted: false
                        })),
                        notes: orders.notes || ""
                    }));
                    const kdsNamespace = getKDSNamespace();
                    if (kdsNamespace) {
                        await kdsNamespace.to(`kitchen_${kitchen.id}`).emit("newOrder", formatedData);
                    }

                }

            }
        }
    } catch (error) {
        console.log("Error Wile Sent to KDS", error)
    }
}
const orderCompletedSendtoKdsCLient = async (hotel_id, orderId) => {
    try {
        const findAllKitchen = await KitchenSetting.findAll({ where: { hotel_id } })
        if (findAllKitchen.length) {
            for (const kitchen of findAllKitchen) {
                const kdsNamespace = getKDSNamespace();
                if (kdsNamespace) {
                    await kdsNamespace.to(`kitchen_${kitchen.id}`).emit("orderComplete", orderId);
                }
            }
        }
    } catch (error) {
        console.log("error While Order compeleted To sent :::", error)
    }
}
const otherkot = async (orderId, hotel_id) => {
    try {
        const findAllKitchen = await KitchenSetting.findAll({ where: { hotel_id } })
        if (findAllKitchen.length) {

            for (const kitchen of findAllKitchen) {


                const orders = await Order.findOne({
                    where: {
                        hotel_id: kitchen.hotel_id,
                        status: ORDER_DETAILS_TYPE.IN_PROGRESS,
                        payment: STATUS.PENDING,
                        deleted: false,
                        id: orderId,

                    },

                    include: [
                        {
                            model: OrderDetails,
                            where: {
                                status: 'kot',
                            },
                            required: true,
                            include: [{
                                model: Menu,

                                attributes: ['item_name', "menu_categ_id"],
                                required: true
                            }]
                        }, { model: HotelUser, attributes: ['name'] }, { model: Table, attributes: ["table_name", "type"], include: { model: TableCatagories, attributes: ['table_catag_nm'] } }
                    ],
                    order: [['createdAt', 'DESC']]
                });
                let kotGroups = {}
                let maxKotNumber = 0
                if (orders && orders.hms_orderDetails.length) {

                    maxKotNumber = orders.hms_orderDetails.reduce((count, cur) => {
                        // console.log(cur, "Cure:::::")
                        if (Number(cur.kotNumber) > count) {
                            count = cur.kotNumber
                            return count
                        }
                        return count
                    }, 0)

                    kotGroups = orders.hms_orderDetails.reduce((groups, item) => {

                        const kotNumber = item.kotNumber || 0;
                        if (!groups[kotNumber]) {
                            groups[kotNumber] = [];
                        }
                        groups[kotNumber].push(item);
                        return groups;

                    }, {});
                }
                // console.log("kotGroups::::", kotGroups)
                // Create separate order objects for each KOT
                let formatedData = Object.entries(kotGroups).map(([kotNumber, items]) => ({

                    id: orders.id,
                    kotNumber: parseInt(kotNumber),
                    orderNo: `#${orders.id}${kotNumber > 0 ? `-KOT${kotNumber}` : ''}`,
                    timer: orders.createdAt,
                    type: orders.order_type,
                    biller: orders.hms_hotelUser_master?.name || "Unknown",

                    room: `${orders.hms_table_mst?.type === "T" ? "Table" : "Room"} - ${orders.hms_table_mst?.hms_table_categ?.table_catag_nm}(${orders.hms_table_mst?.table_name})` || "",
                    tableId: orders.TableId || "",
                    status: "Processing",
                    button: "Food Ready",
                    buttonColor: kotNumber > 1 ? "red" : "green",
                    items: items.map(item => ({
                        name: item.hms_menu_mst.item_name,
                        qty: item.qty,
                        ready: item.ready,
                        variant_name: item.variant_name,
                        addons: item.addons,
                        comment: item.comment,
                        id: item.id,
                        menu_categ_id: item?.hms_menu_mst?.menu_categ_id,
                        deleted: false
                    })),
                    notes: orders.notes || ""
                })).filter(el => el.kotNumber === maxKotNumber);
                // console.log("FOmrateData:::", formatedData)
                const kdsNamespace = getKDSNamespace();
                if (kdsNamespace) {

                    await kdsNamespace.to(`kitchen_${kitchen.id}`).emit("newOrder", { ...formatedData[0] });
                }


            }
        }
    } catch (error) {
        console.log("Error Wile Sent to KDS", error)
    }
}
const removeKotItemFromKds = async (orderId, hotel_id, kotNumber, id) => {
    try {
        const findAllKitchen = await KitchenSetting.findAll({ where: { hotel_id } })
        if (findAllKitchen.length) {
            for (const kitchen of findAllKitchen) {
                // const orders = await Order.findOne({
                //     where: {
                //         hotel_id: kitchen.hotel_id,
                //         status: ORDER_DETAILS_TYPE.IN_PROGRESS,
                //         payment: STATUS.PENDING,
                //         deleted: false,
                //         id: orderId,
                //     },

                //     include: [
                //         {
                //             model: OrderDetails,
                //             where: {
                //                 status: 'kot',
                //             },
                //             required: true,
                //             include: [{
                //                 model: Menu,

                //                 attributes: ['item_name', "menu_categ_id"],
                //                 required: true
                //             }]
                //         }, { model: HotelUser, attributes: ['name'] }, { model: Table, attributes: ["table_name", "type"], include: { model: TableCatagories, attributes: ['table_catag_nm'] } }
                //     ],
                //     order: [['createdAt', 'DESC']]
                // });
                // let kotGroups = {}
                // let maxKotNumber = 0
                // if (orders && orders.hms_orderDetails.length) {

                //     maxKotNumber = orders.hms_orderDetails.reduce((count, cur) => {
                //         console.log(cur, "Cure:::::")
                //         if (Number(cur.kotNumber) > count) {
                //             count = cur.kotNumber
                //             return count
                //         }
                //         return count
                //     }, 0)
                //     console.log(maxKotNumber, "MaxKot nUmber ")

                //     kotGroups = orders.hms_orderDetails.reduce((groups, item) => {

                //         const kotNumber = item.kotNumber || 0;
                //         if (!groups[kotNumber]) {
                //             groups[kotNumber] = [];
                //         }
                //         groups[kotNumber].push(item);
                //         return groups;

                //     }, {});
                // }
                // console.log("kotGroups::::", kotGroups)
                // // Create separate order objects for each KOT
                // let formatedData = Object.entries(kotGroups).map(([kotNumber, items]) => ({

                //     id: orders.id,
                //     kotNumber: parseInt(kotNumber),
                //     orderNo: `#${orders.id}${kotNumber > 0 ? `-KOT${kotNumber}` : ''}`,
                //     timer: orders.createdAt,
                //     type: orders.order_type,
                //     biller: orders.hms_hotelUser_master?.name || "Unknown",

                //     room: `${orders.hms_table_mst?.type === "T" ? "Table" : "Room"} - ${orders.hms_table_mst?.hms_table_categ?.table_catag_nm}(${orders.hms_table_mst?.table_name})` || "",
                //     tableId: orders.TableId || "",
                //     status: "Processing",
                //     button: "Food Ready",
                //     buttonColor: "#707071",
                //     items: items.map(item => ({
                //         name: item.hms_menu_mst.item_name,
                //         qty: item.qty,
                //         ready: item.ready,
                //         variant_name: item.variant_name,
                //         addons: item.addons,
                //         comment: item.comment,
                //         id: item.id,
                //         menu_categ_id: item?.hms_menu_mst?.menu_categ_id,
                //     })),
                //     notes: orders.notes || ""
                // })).filter(el => el.kotNumber === kotNumber);
                // console.log("FOmrateData:::", formatedData)
                const kdsNamespace = getKDSNamespace();
                if (kdsNamespace) {
                    await kdsNamespace.to(`kitchen_${kitchen.id}`).emit("removeKotItem", { orderId, kotNumber, id });
                }


            }
        }




    } catch (error) {
        console.log("Error ::::", error)
        throw new Error(error)
    }
}
const descriseKotQtyItemFromKDS = async (orderId, hotel_id, kotNumber, id) => {
    try {
        const findAllKitchen = await KitchenSetting.findAll({ where: { hotel_id } })
        if (findAllKitchen.length) {
            for (const kitchen of findAllKitchen) {
                // const orders = await Order.findOne({
                //     where: {
                //         hotel_id: kitchen.hotel_id,
                //         status: ORDER_DETAILS_TYPE.IN_PROGRESS,
                //         payment: STATUS.PENDING,
                //         deleted: false,
                //         id: orderId,
                //     },

                //     include: [
                //         {
                //             model: OrderDetails,
                //             where: {
                //                 status: 'kot',
                //             },
                //             required: true,
                //             include: [{
                //                 model: Menu,

                //                 attributes: ['item_name', "menu_categ_id"],
                //                 required: true
                //             }]
                //         }, { model: HotelUser, attributes: ['name'] }, { model: Table, attributes: ["table_name", "type"], include: { model: TableCatagories, attributes: ['table_catag_nm'] } }
                //     ],
                //     order: [['createdAt', 'DESC']]
                // });
                // let kotGroups = {}
                // let maxKotNumber = 0
                // if (orders && orders.hms_orderDetails.length) {

                //     maxKotNumber = orders.hms_orderDetails.reduce((count, cur) => {
                //         console.log(cur, "Cure:::::")
                //         if (Number(cur.kotNumber) > count) {
                //             count = cur.kotNumber
                //             return count
                //         }
                //         return count
                //     }, 0)
                //     console.log(maxKotNumber, "MaxKot nUmber ")

                //     kotGroups = orders.hms_orderDetails.reduce((groups, item) => {

                //         const kotNumber = item.kotNumber || 0;
                //         if (!groups[kotNumber]) {
                //             groups[kotNumber] = [];
                //         }
                //         groups[kotNumber].push(item);
                //         return groups;

                //     }, {});
                // }
                // console.log("kotGroups::::", kotGroups)
                // // Create separate order objects for each KOT
                // let formatedData = Object.entries(kotGroups).map(([kotNumber, items]) => ({

                //     id: orders.id,
                //     kotNumber: parseInt(kotNumber),
                //     orderNo: `#${orders.id}${kotNumber > 0 ? `-KOT${kotNumber}` : ''}`,
                //     timer: orders.createdAt,
                //     type: orders.order_type,
                //     biller: orders.hms_hotelUser_master?.name || "Unknown",

                //     room: `${orders.hms_table_mst?.type === "T" ? "Table" : "Room"} - ${orders.hms_table_mst?.hms_table_categ?.table_catag_nm}(${orders.hms_table_mst?.table_name})` || "",
                //     tableId: orders.TableId || "",
                //     status: "Processing",
                //     button: "Food Ready",
                //     buttonColor: "#707071",
                //     items: items.map(item => ({
                //         name: item.hms_menu_mst.item_name,
                //         qty: item.qty,
                //         ready: item.ready,
                //         variant_name: item.variant_name,
                //         addons: item.addons,
                //         comment: item.comment,
                //         id: item.id,
                //         menu_categ_id: item?.hms_menu_mst?.menu_categ_id,
                //     })),
                //     notes: orders.notes || ""
                // })).filter(el => el.kotNumber === kotNumber);
                // console.log("FOmrateData:::", formatedData)
                const kdsNamespace = getKDSNamespace();
                if (kdsNamespace) {
                    await kdsNamespace.to(`kitchen_${kitchen.id}`).emit("descriseKotItem", { orderId, kotNumber, id });
                }


            }
        }


    } catch (error) {
        console.log("Error ::::", error)
        throw new Error(error)
    }
}
const deleteKitchen = async (req, res) => {
    try {
        const { id } = req.params
        await KitchenSetting.destroy({ where: { id: parseInt(id) } })
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { message: "Kitchen Deleted Successfully" }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err, "while deleteting Kitchen")
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

module.exports = { descriseKotQtyItemFromKDS, removeKotItemFromKds, recallKot, deleteKitchen, otherkot, orderCompletedSendtoKdsCLient, sendKotToAllKdsClient, getKitchenDataById, setCategoryForKitchen, createKitchen, getAllKitchen, getLiveOrders, markItemReady }