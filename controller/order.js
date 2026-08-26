const Order = require("../model/order")
const Cart = require("../model/cart")
const { STATUSCODE, MESSAGE, STATUS, ORDER_TYPE, ORDER_DETAILS_TYPE } = require("../constant/const")
const { error, success, mobileSuccess } = require("../responce/res")
const Menu = require("../model/menu")
const Table = require("../model/table")
const User = require("../model/user")
const OrderDetails = require("../model/order_details")
const Hotel = require("../model/hotel")
const { Op, Sequelize } = require("sequelize")
const TableCatagories = require("../model/table_catg")
const moment = require("moment")
const DuePaymentReceive = require("../model/duePayment")
const Variants = require("../model/variants")
const { webChange } = require("./mobileController/offline/gettingData")
const TimeLine = require("../model/timeline")
const HotelUser = require("../model/hotelUser")
const OrderTax = require("../model/orderTax")
const TaxType = require("../model/taxType")
const { updateOrderAppendToRadis, deleteOrderToRedis, updateTableToRadis } = require("./redis/redisCrud")
const Menu_categ = require("../model/menu_categ")
const CryptoJS = require("crypto-js");
const dotenv = require("dotenv");
dotenv.config();
const { getBusinessDate } = require("../utils/dateUtils")
const RestaurantSetting = require("../model/restaurantSetting")
const { getFinancialYearEndDate, getFinancialYearStartDate } = require("../helpers/billNumber")
const SECRET_KEY = process.env.DESECRET_KEY || "MY_SECRET_KEY";

const encryptData = (data) => {
    return CryptoJS.AES.encrypt(JSON.stringify(data), SECRET_KEY).toString();
};
const addToCart = async (req, res) => {
    try {
        // ! test get tableId and userId and MenuId From body in live api get the table and User form the Order Display 

        const user = await User.findOne({ where: { id: req.user } })
        if (!user) return res.json(error(STATUSCODE.BAD_REQUEST, MESSAGE.USER_NOT_FOUND))
        const tableNumber = user.tableNumber
        const table = await Table.findOne({ where: { tableNumber, hotel_id: user.hotel_id } })

        const { MenuId } = req.body

        // Run both lookups in parallel — they don't depend on each other
        const [alreadyItemAvailable, MenuItem] = await Promise.all([
            Cart.findOne({ where: { MenuId, UserId: user.id, TableId: table.dataValues.id, hotel_id: user.hotel_id } }),
            Menu.findOne({ where: { id: MenuId } })
        ]);

        if (alreadyItemAvailable) {
            const updateOrderItems = await Cart.update({ qty: alreadyItemAvailable.qty + 1, totalAmount: parseInt(alreadyItemAvailable.totalAmount) + parseInt(MenuItem.price) }, { where: { id: alreadyItemAvailable.id } })
            return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { message: MESSAGE.QTY_AMOUNT_UPDATED }, STATUSCODE.SUCCESS))
        }
        await Cart.create({
            UserId: user.id, MenuId, TableId: table.dataValues.id, totalAmount: MenuItem.price, hotel_id: user.hotel_id
        })
        return res.status(STATUSCODE.CREATED).json(success(MESSAGE.SUCCESS, { message: MESSAGE.ORDER_CREATE }, STATUSCODE.CREATED))
    } catch (err) {
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const removeCartItems = async (req, res) => {
    try {
        // ! test get tableId and userId and MenuId From body in live api get the table and User form the Order Display 
        const user = await User.findOne({ where: { id: req.user } })
        if (!user) return res.json(error(STATUSCODE.BAD_REQUEST, MESSAGE.USER_NOT_FOUND))
        const tableNumber = user.tableNumber
        const table = await Table.findOne({ where: { tableNumber, hotel_id: user.hotel_id } })

        const { MenuId } = req.body
        const alreadyItemAvailable = await Cart.findOne({ where: { MenuId, UserId: user.id, TableId: table.id, hotel_id: user.hotel_id } })
        const MenuItem = await Menu.findOne({ where: { id: MenuId, hotel_id: user.hotel_id } })
        if (alreadyItemAvailable) {
            if (alreadyItemAvailable.qty === 1) {
                await Cart.destroy({ where: { id: alreadyItemAvailable.id } })
                return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { message: MESSAGE.ITEM_IS_REMOVE_FROM_CART }, STATUSCODE.SUCCESS))
            }
            const updateOrderItems = await Cart.update({ qty: alreadyItemAvailable.qty - 1, totalAmount: parseInt(alreadyItemAvailable.totalAmount) - parseInt(MenuItem.price) }, { where: { id: alreadyItemAvailable.id } })
            return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { message: MESSAGE.QTY_AMOUNT_UPDATED }, STATUSCODE.SUCCESS))
        }
        return res.json(error(MESSAGE.CART_ITEM_NOT_AVAILABLE, STATUSCODE.NOT_FOUND))

    } catch (err) {
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const getCart = async (req, res) => {
    try {
        // ! get UserId from req User after completed authentication process
        const user = await User.findOne({ where: { id: req.user } })
        if (!user) return res.json(error(STATUSCODE.BAD_REQUEST, MESSAGE.USER_NOT_FOUND))
        // Single JOIN query instead of N+1 individual Menu lookups
        const cartData = await Cart.findAll({
            where: { UserId: user.id, hotel_id: user.hotel_id },
            include: [{ model: Menu, where: { hotel_id: user.hotel_id }, required: false }]
        });
        let modifiedCart = { items: [], totalBill: 0, hotel_id: user.hotel_id };
        for (const cur of cartData) {
            modifiedCart.totalBill += cur.totalAmount;
            const item = { ...cur.hms_menu_mst?.dataValues, qty: cur.qty, totalAmount: cur.totalAmount };
            modifiedCart.items.push(item);
        }
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { cartData: modifiedCart }, STATUSCODE.SUCCESS))
    } catch (err) {
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const placeOrder = async (req, res) => {
    try {
        // ! for react app 
        const { cart } = req.body
        // const { MenuId } = req.body

        const user = await User.findOne({ where: { id: req.user } })
        const tableNumber = user.tableNumber
        const table = await Table.findOne({ where: { tableNumber, hotel_id: user.hotel_id } })
        if (!user) return res.json(error(STATUSCODE.BAD_REQUEST, MESSAGE.USER_NOT_FOUND))
        const orderAvailable = await Order.findOne({
            where: {
                TableId: table.id, UserId: user.id, payment: STATUS.PENDING
            }
        })
        if (!orderAvailable) {
            const cartData = await Cart.findAll({
                where: {
                    TableId: table.id, UserId: user.id, hotel_id: user.hotel_id
                }
            })

            if (cartData) {
                // ! for postman testing 
                const cartDelete = await Cart.destroy({ where: { TableId: table.id, UserId: user.id } })
                const modifiedCart = cart
                const gst = modifiedCart.totalBill * 5 / 100
                const allOrderData = await Order.findAll({ where: { hotel_id: req.user, isOffline: false } })

                const maxOnlineBillNo = allOrderData.reduce((max, invoice) => {
                    const numericValue = parseInt(invoice.bill_no, 10);
                    return numericValue > max ? numericValue : max;
                }, 0);

                const setting = await RestaurantSetting.findOne({ where: { hotel_id: user.hotel_id } });
                const timeZone = setting?.timeZone || 'Asia/Kolkata';
                const businessStartTime = setting?.business_day_start_time || '00:01:00';
                const business_date = getBusinessDate(timeZone, businessStartTime);

                const order = await Order.create({ business_date, bill_no: `${maxOnlineBillNo + 1}`, hotel_id: user.hotel_id, UserId: user.id, TableId: table.id, totalAmount: modifiedCart.totalBill, gst, grandAmount: parseInt(modifiedCart.totalBill) + parseInt(gst) })

                // Fetch all menu prices in one query instead of N individual lookups
                const menuIds = cartData.map(c => c.MenuId);
                const menuItems = await Menu.findAll({ where: { id: menuIds } });
                const menuMap = Object.fromEntries(menuItems.map(m => [m.id, m]));

                await OrderDetails.bulkCreate(
                    cartData.map(cur => ({
                        qty: cur.qty,
                        price: menuMap[cur.MenuId]?.price,
                        UserId: cur.UserId,
                        hotel_id: cur.hotel_id,
                        orderId: order.id,
                        TableId: cur.TableId,
                        MenuId: cur.MenuId
                    }))
                );


                return res.json(success(MESSAGE.CREATED, { message: MESSAGE.ORDER_CREATE }, STATUSCODE.CREATED))
            }
            return res.json(error(MESSAGE.CART_NOT_FOUND, STATUSCODE.NOT_FOUND))
        }

        const cartData = await Cart.findAll({
            where: {
                TableId: table.id, UserId: user.id, hotel_id: user.hotel_id
            }
        })
        if (cartData) {

            const orderDetailsData = await OrderDetails.findAll({ where: { orderId: orderAvailable.id } });

            // Fetch all menu prices in one query + destroy cart once outside the loop
            const cartMenuIds = cartData.map(c => c.MenuId);
            const [cartMenuItems] = await Promise.all([
                Menu.findAll({ where: { id: cartMenuIds } }),
                Cart.destroy({ where: { TableId: table.id, UserId: user.id } })  // single destroy, outside loop
            ]);
            const cartMenuMap = Object.fromEntries(cartMenuItems.map(m => [m.id, m]));

            const toCreate = [];
            for (const ele of cartData) {
                const menuAvailable = orderDetailsData.find(element => element.MenuId === ele.MenuId);
                if (menuAvailable) {
                    const qty = ele.qty + menuAvailable.qty;
                    await OrderDetails.update({ qty }, { where: { orderId: orderAvailable.id, MenuId: ele.MenuId, UserId: user.id, TableId: table.id } });
                } else {
                    toCreate.push({
                        UserId: ele.UserId,
                        MenuId: ele.MenuId,
                        hotel_id: ele.hotel_id,
                        qty: ele.qty,
                        price: cartMenuMap[ele.MenuId]?.price,
                        orderId: orderAvailable.id,
                        TableId: ele.TableId
                    });
                }
            }
            if (toCreate.length) {
                await OrderDetails.bulkCreate(toCreate);
            }
            const order_details = await OrderDetails.findAll({ where: { orderId: orderAvailable.id } })

            const totalAmount = order_details.reduce((acu, cur) => {
                acu += cur.price * cur.qty
                return acu
            }, 0)
            const gst = totalAmount * 5 / 100
            const order = await Order.update({ totalAmount: totalAmount, gst, grandAmount: totalAmount + gst }, { where: { id: orderAvailable.id } })
            // setImmediate(() => {

            await updateOrderAppendToRadis(order.id, req.user)
            // });
            // const tables = await Table.findOne({ where: { id: table.id } })

            // if (!tables) {
            //     return res.json(error(MESSAGE.TABLE_NOT_AVAILABLE, STATUSCODE.NOT_FOUND))
            // }

            // const updateTable = await Table.update({ vacant: false }, { where: { id: table.id } })

            return res.json(success(MESSAGE.CREATED, { message: MESSAGE.ORDER_CREATE }, STATUSCODE.CREATED))

        }
        return res.json(error(MESSAGE.CART_NOT_FOUND, STATUSCODE.NOT_FOUND))

    } catch (err) {
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }

}
const getOrders = async (req, res) => {
    try {
        const { orderType } = req.query
        const hotel = await Hotel.findOne({ where: { id: req.user } })
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST,))
        let orderAll
        if (orderType === "allOrder") {
            orderAll = await Order.findAll({
                where: {
                    hotel_id: hotel.id, deleted: false, payment: STATUS.SUCCESS, status: ORDER_TYPE.SUCCESS
                }, include: [
                    {
                        model: User,

                    },
                    {
                        model: Table, include: { model: TableCatagories }
                    },
                    { model: OrderTax, include: { model: TaxType } }
                ],
                order: [
                    ['id', 'DESC'],
                ],
            });

        } else {
            orderAll = await Order.findAll({
                where: {
                    hotel_id: hotel.id, order_type: orderType, deleted: false, payment: STATUS.SUCCESS, status: ORDER_TYPE.SUCCESS
                }, include: [
                    {
                        model: User,
                    },
                    {
                        model: Table, include: { model: TableCatagories }
                    },
                    { model: OrderTax, include: { model: TaxType } }
                ],
                order: [
                    ['id', 'DESC'],
                ],
            });
        }
        if (!orderAll) {
            return res.json(success(MESSAGE.ORDER_NOT_FOUND, STATUSCODE.NOT_FOUND))
        }
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { order: orderAll }, STATUSCODE.SUCCESS))
    } catch (err) {

        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const getOrdersByBillNo = async (req, res) => {
    try {
        const { key } = req.params
        const hotel = await Hotel.findOne({ where: { id: req.user } })
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST,))
        let order
        if (key == "all") {
            order = await Order.findAll({
                where: { hotel_id: hotel.id, deleted: false }, include: [
                    {
                        model: User,
                        // Include associated user data
                    },
                    {
                        model: Table // Include associated table data
                    },
                    { model: OrderTax, include: { model: TaxType } }
                ]
            });
        } else {
            order = await Order.findAll({
                where: { id: key, hotel_id: hotel.id, deleted: false }, include: [
                    {
                        model: User,
                        // Include associated user data
                    },
                    {
                        model: Table // Include associated table data
                    },
                    { model: OrderTax, include: { model: TaxType } }
                ]
            });
        }

        // ! get UserId from req User after completed authentication process
        if (!order) {
            return res.json(success(MESSAGE.ORDER_NOT_FOUND, STATUSCODE.NOT_FOUND))
        }


        for (const el of order) {
            let user
            if (el.UserId) {
                user = await User.findOne({ where: { id: el.UserId, hotel_id: req.user } })
                el.user = user
            }
        }

        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { order }, STATUSCODE.SUCCESS))
    } catch (err) {
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const getSingleOrder = async (req, res) => {
    try {

        // ! get UserId from req User after completed authentication process
        const { id } = req.params

        const hotel = await Hotel.findOne({ where: { id: req.user } })
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST,))


        const order = await Order.findOne({
            where: { id: parseInt(id), deleted: false },
            include: [
                {
                    model: OrderDetails,
                    // ! Edited where: { status: ORDER_DETAILS_TYPE.DELIVERED }, // Filter order details by status
                    include: [
                        {
                            model: Menu

                        },
                        { model: Variants, as: "variantData" }
                    ],
                },
                {
                    model: User
                },
                {
                    model: Table, include: [{ model: TableCatagories }]
                },
                { model: OrderTax, include: { model: TaxType } }
            ]
        });



        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { order }, STATUSCODE.SUCCESS))
    } catch (err) {

        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const getSingleOrderForAdminCart = async (req, res) => {
    try {
        // ! get UserId from req User after completed authentication process
        const { id } = req.params
        const hotel = await Hotel.findOne({ where: { id: req.user } })
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST,))

        const order = await Order.findOne({ where: { id: parseInt(id), hotel_id: hotel.id } })
        if (!order) {
            return res.json(error(MESSAGE.ORDER_NOT_FOUND, STATUSCODE.NOT_FOUND))
        }
        const orderDetails = await OrderDetails.findAll({ where: { orderId: id } });

        const items = []
        for (const cur of orderDetails) {
            // console.log(cur)
            const documents = {}
            const menuData = await Menu.findOne({ where: { id: cur.MenuId, hotel_id: hotel.id } });
            documents.foodName = menuData.item_name
            documents.MenuId = cur.MenuId
            documents.discount = cur.totalDiscount
            documents.price = menuData.price
            documents.qty = cur.qty
            documents.status = cur.status
            documents.totalAmount = menuData.price * cur.qty
            items.push(documents)

        }
        const day = order.createdAt.toString().split(" ")[0]
        const month = order.createdAt.toString().split(" ")[1]
        const date = order.createdAt.toString().split(" ")[2]
        const year = order.createdAt.toString().split(" ")[3]
        const time = order.createdAt.toString().split(" ")[4]
        const subtotal = order.totalAmount
        let user
        let table
        if (order.UserId) {

            user = await User.findOne({ where: { id: order.UserId } })
        }
        if (order.TableId) {
            table = await Table.findOne({ where: { id: order?.TableId }, include: { model: TableCatagories } })
        }

        const billData = {
            restaurantName: hotel.hotel_name,
            dateTime: `${date} ${month} ${year}`,
            orderId: order.id,
            order_type: order.order_type,
            user: user,
            table: table,
            totalDiscount: order.totalDiscount,
            items,
            subtotal,
            gst: order.gst,
            totalBill: order.grandAmount
        }
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { order: billData }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err)
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const billData = async (req, res) => {
    try {
        const id = req.user
        const user = await User.findOne({ where: { id } })
        if (!user) return res.json(error(MESSAGE.USER_NOT_FOUND, STATUSCODE.BAD_REQUEST,))
        const table = await Table.findOne({ where: { tableNumber: user.tableNumber, hotel_id: user.hotel_id } })

        if (!table) return res.json(error(MESSAGE.TABLE_NOT_AVAILABLE, STATUSCODE.NOT_FOUND))

        const order = await Order.findOne({ where: { UserId: id, TableId: table.id, hotel_id: user.hotel_id } })
        if (!order) return res.json(error(MESSAGE.ORDER_NOT_FOUND, STATUSCODE
            .NOT_FOUND))

        const orderDetails = await OrderDetails.findAll({ where: { orderId: order.id } })

        if (!orderDetails) return res.json(error(MESSAGE.ORDERDETAILS_NOT_FOUND, STATUSCODE
            .NOT_FOUND))


        const hotel = await Hotel.findOne({ id: user.hotel_id })

        const items = []
        for (const cur of orderDetails) {
            const documents = {}
            const menuData = await Menu.findOne({ where: { id: cur.MenuId, hotel_id: user.hotel_id } });
            documents.foodName = menuData.item_name
            documents.price = menuData.price
            documents.qty = cur.qty
            documents.totalAmount = menuData.price * cur.qty
            items.push(documents)

        }

        const subtotal = order.totalAmount

        const billData = {
            restaurantName: hotel.hotel_name,
            userDetails: {
                name: user.name,
                email: user.email,
                phone: user.number
            },
            items,
            subtotal,
            gst: order.gst,
            totalBill: order.grandAmount
        }

        return res.json(success(MESSAGE.SUCCESS, { billData }, STATUSCODE.SUCCESS))
    } catch (err) {
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const billDataForAdmin = async (req, res) => {
    try {
        const id = req.user
        const { tableId } = req.params
        const hotel = await Hotel.findOne({ where: { id } })
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST))
        const table = await Table.findOne({ where: { id: tableId, hotel_id: id } })
        if (!table) return res.json(error(MESSAGE.TABLE_NOT_AVAILABLE, STATUSCODE.NOT_FOUND))
        const user = await User.findOne({ where: { tableNumber: table.tableNumber, hotel_id: id } })
        if (!user) return res.json(error(MESSAGE.USER_NOT_FOUND, STATUSCODE.NOT_FOUND))
        const order = await Order.findOne({ where: { TableId: tableId, hotel_id: id } })
        if (!order) return res.json(error(MESSAGE.ORDER_NOT_FOUND, STATUSCODE
            .NOT_FOUND))

        const orderDetails = await OrderDetails.findAll({ where: { orderId: order.id } })

        if (!orderDetails) return res.json(error(MESSAGE.ORDERDETAILS_NOT_FOUND, STATUSCODE
            .NOT_FOUND))


        const items = []

        for (const cur of orderDetails) {
            const documents = {}
            const menuData = await Menu.findOne({ where: { id: cur.MenuId, hotel_id: user.hotel_id } });
            documents.foodName = menuData.item_name
            documents.price = menuData.price
            documents.qty = cur.qty
            documents.totalAmount = menuData.price * cur.qty
            // ! for test status according to all order
            documents.status = order.status
            items.push(documents)

        }

        const subtotal = items.reduce((acu, cur) => {
            acu += cur.totalAmount
            return acu
        }, 0)
        const billData = {
            restaurantName: hotel.hotel_name,
            userDetails: {
                name: user.name,
                email: user.email,
                phone: user.number
            },
            items,
            subtotal,
            gst: order.gst,
            totalBill: subtotal + order.gst,
            paymentStatus: order.payment
        }
        return res.json(success(MESSAGE.SUCCESS, { billData }, STATUSCODE.SUCCESS))
    } catch (err) {
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const getHoldOrders = async (req, res) => {
    try {

        const hotel = await Hotel.findOne({ where: { id: req.user } })
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST,))
        let order = await Order.findAll({ where: { hotel_id: req.user, status: ORDER_TYPE.HOLD, deleted: false }, include: [{ model: OrderTax, include: { model: TaxType } }] });

        let allOrderData = []

        for (const cur of order) {
            let user
            if (cur.UserId) {
                user = await User.findOne({ where: { id: cur.UserId } })
                cur.dataValues.user = user
            }
            let table
            if (cur.TableId) {
                table = await Table.findOne({ where: { id: cur.TableId } })
                cur.dataValues.table = table
            }
            const orderDetails = await OrderDetails.findAll({ where: { hotel_id: req.user, orderId: cur.id, status: ORDER_DETAILS_TYPE.HOLD } })
            cur.dataValues.orderDetails = orderDetails
            allOrderData.push(cur)
        }

        // const orderDetails=await OrderDetails.findAll({orderId:order.id})
        // ! get UserId from req User after completed authentication process



        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { order: allOrderData }, STATUSCODE.SUCCESS))

    } catch (err) {
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const getKotOrder = async (req, res) => {
    try {

        const hotel = await Hotel.findOne({ where: { id: req.user } })
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST,))
        let order = await Order.findAll({ where: { hotel_id: req.user, status: ORDER_TYPE.IN_PROGRESS, deleted: false }, include: [{ model: OrderDetails, where: { status: ORDER_DETAILS_TYPE.KOT } }, { model: User }, { model: Table }, { model: OrderTax, include: { model: TaxType } }] });
        // let allOrderData = []

        // for (const cur of order) {
        //     let user
        //     if (cur.UserId) {
        //         user = await User.findOne({ where: { id: cur.UserId } })
        //         cur.dataValues.user = user
        //     }
        //     let table
        //     if (cur.TableId) {
        //         table = await Table.findOne({ where: { id: cur.TableId } })
        //         cur.dataValues.table = table
        //     }
        //     const orderDetails = await OrderDetails.findAll({ where: { hotel_id: req.user, orderId: cur.id, status: ORDER_DETAILS_TYPE.KOT } })
        //     cur.dataValues.orderDetails = orderDetails
        //     allOrderData.push(cur)
        // }

        // const orderDetails=await OrderDetails.findAll({orderId:order.id})
        // ! get UserId from req User after completed authentication process

        // if (!allOrderData.length) {
        //     return res.json(success(MESSAGE.ORDER_NOT_FOUND, STATUSCODE.NOT_FOUND))
        // }
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { order }, STATUSCODE.SUCCESS))

    } catch (err) {
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const getPickupOrder = async (req, res) => {
    try {

        const hotel = await Hotel.findOne({ where: { id: req.user } })
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST,))
        let order = await Order.findAll({
            where: { hotel_id: req.user, order_type: { [Op.or]: [ORDER_TYPE.DININ, ORDER_TYPE.PICKUP] }, status: { [Op.or]: [ORDER_TYPE.IN_PROGRESS, ORDER_TYPE.HOLD, ORDER_TYPE.SUCCESS] }, payment: STATUS.PENDING, deleted: false },

            include:
                [
                    { model: User },
                    { model: Table, include: [{ model: TableCatagories }] },
                    { model: OrderTax, include: { model: TaxType } }
                ]
            ,
            order: [
                ['createdAt', 'DESC'],
            ],

        });

        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { order }, STATUSCODE.SUCCESS))

    } catch (err) {
        console.log(err, "error=========>")
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const getDinInOrder = async (req, res) => {
    try {

        const hotel = await Hotel.findOne({ where: { id: req.user } })
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST,))
        let order = await Order.findAll({
            where: { hotel_id: req.user, order_type: ORDER_TYPE.DININ, status: { [Op.ne]: ORDER_TYPE.SUCCESS }, payment: "pending", deleted: false }, include:
                [
                    { model: User },
                    { model: Table, include: [{ model: TableCatagories }] },
                    { model: OrderTax, include: { model: TaxType } }
                ],
            order: [
                ['createdAt', 'DESC'],
            ],
        });

        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { order }, STATUSCODE.SUCCESS))

    } catch (err) {
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const getDueOrdersFunction = async (data, hotel_id) => {
    try {
        const { bill_no, number } = data

        // console.log(data, "SearchData --->")
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
            // console.log(orders[0])
            dueOrders.orders = orders
        }
        if (bill_no) {
            // console.log("here")
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
                    [Sequelize.fn('SUM', Sequelize.col('due')), 'totalDue']
                ],
                raw: true
            });
            console.log(totalDue)
            const orders = await Order.findAll({
                where: {
                    bill_no: bill_no,
                    due: {
                        [Op.gt]: 0
                    },
                    hotel_id

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
        // console.log(startDate, endDate, "Start End Date-->")
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
const getDueOrders = async (req, res) => {
    try {
        const { searchData, startDate, endDate } = req.body
        let dueOrders
        console.log(req.user,startDate,endDate)
        
        if (searchData?.bill_no || searchData?.number) {
            dueOrders = await getDueOrdersFunction(searchData, req.user)
        } else {
            dueOrders = await getDueOrdersDateWiseFunction(startDate, endDate, req.user)
        }
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { dueOrders }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err)
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const settleDue = async (req, res) => {
    try {

        const { id, amount, mode, receive } = req?.body?.data
        // console.log(req?.body?.data, "Body Data ---->")

        const findOrder = await Order.findOne({ where: { id } })
        if (Number(receive) <= 0) return res.json(error("Amount Must Be Greater Than 0", STATUSCODE.BAD_REQUEST))


        // console.log(findOrder, +receive)
        if (findOrder.due < receive) return res.json(error("Amount Must Be Less Than Or Equal Remaining Amount", STATUSCODE.BAD_REQUEST))

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
        // console.log(req.body.searchData, "Search Data---->")
        const { bill_no, number } = req.body.searchData
        let dueOrders = []
        if (!bill_no && !number) {
            const startD = moment()
            const endD = moment()
            startD.set('hour', 0)
            startD.set('minute', 0)
            startD.set('second', 0)
            endD.set('hour', 23)
            endD.set('minute', 59)
            endD.set('second', 59)
            // console.log(startD, endD)
            dueOrders = await getDueOrdersDateWiseFunction(new Date(startD), new Date(endD), req.user)
        } else {
            dueOrders = await getDueOrdersFunction(req.body.searchData, req.user)
        }

        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { dueOrders }, STATUSCODE.SUCCESS))

    } catch (err) {
        console.log(err)
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const settleAllDuePayment = async (req, res) => {
    try {

        const { idArray, mode } = req.body

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
        }
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { message: "Due Settle Success" }, STATUSCODE.SUCCESS))


    } catch (err) {
        console.log(err)
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
// TODO need to modify by security
const getPendingBills = async (req, res) => {
    try {
        const hotel = await Hotel.findOne({ where: { id: req.user } })
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST))
        let order = await Order.findAll({
            where: { hotel_id: req.user, order_type: ORDER_TYPE.DININ, status: STATUS.SUCCESS, payment: STATUS.PENDING, deleted: false }, include:
                [
                    { model: User },
                    { model: Table, include: [{ model: TableCatagories }] },
                    { model: OrderTax, include: { model: TaxType } }
                ]
            , order: [
                ['createdAt', 'DESC'],
            ],
        });

        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { order }, STATUSCODE.SUCCESS))

    } catch (err) {
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const deleteOrder = async (req, res) => {
    try {
        const hotel = await Hotel.findOne({ where: { id: req.user } })
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST))
        const { id, allId } = req.body

        if (allId) {
            for (const id of allId) {
                let availableOrder = await Order.findOne({ where: { id, hotel_id: req.user } })
                if (!availableOrder) return res.json(error(MESSAGE.MENU_NOT_FOUND, STATUSCODE.NOT_FOUND))
                const updated = await Order.update({ deleted: true }, { where: { id, hotel_id: req.user } })
                // setImmediate(() => {

                await deleteOrderToRedis(id, req.user)
                // });
                await webChange(req.user, io, id)
            }
            return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { message: MESSAGE.ORDER_DELETED }, STATUSCODE.SUCCESS))
        }
        const orderAvailable = await Order.findOne({ where: { id, hotel_id: req.user } })


        if (req.body.free === "free") {
            await Table.update({ table_status: "F" }, { where: { id: orderAvailable.TableId, hotel_id: req.user } })

            await updateTableToRadis(orderAvailable.TableId, req.user)
            // });
        }
        if (!orderAvailable) return res.json(error(MESSAGE.ORDER_NOT_FOUND, STATUSCODE.NOT_FOUND))
        await Order.update({ deleted: true }, { where: { id, hotel_id: req.user } })
        // setImmediate(() => {

        await deleteOrderToRedis(id, req.user)
        // });
        await webChange(req.user, io, id)
        //TODO remove all orders from Hotel  
        // await Order.destroy({ where: { hotel_id: req.user } })
        // await OrderDetails.destroy({ where: { hotel_id: req.user } })


        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { message: MESSAGE.ORDER_DELETED }, STATUSCODE.SUCCESS))
    } catch (err) {
        ////console.log(err)
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }

}
const getTimeLineByOrderId = async (req, res) => {
    try {
        const { id } = req.query;

        let timesLinesRaw = await TimeLine.findAll({
            where: { order_id: id, deleted: false, hotel_id: req.user },
            include: [
                { model: HotelUser, attributes: ['name'] },
                { model: Table, attributes: ['table_name'] },
                {
                    model: Order,
                    attributes: ['id'],
                    include: {
                        model: OrderTax,
                        attributes: ['amount', "tax_type", "tax_value"],
                        include: { model: TaxType, attributes: ['tax_name'] }
                    }
                }
            ]
        });

        const timesLines = timesLinesRaw.map(timeline => {
            const plainTimeline = timeline.get({ plain: true });
            const updatedItems = [];

            // The model declares `items` as DataTypes.JSON, but the real
            // column is `longtext` (hms_timeline_msts is frozen off
            // auto-alter in server.js's TABLES_TO_SKIP_ALTER, so that type
            // was never actually applied to the DB) - Sequelize doesn't
            // auto-parse it, so this comes back as a raw JSON string, not
            // an array. Iterating a string with `for...of` + `in` throws
            // (confirmed live: every timeline fetch 500'd on this).
            let rawItems = plainTimeline.items;
            if (typeof rawItems === 'string') {
                try {
                    rawItems = JSON.parse(rawItems);
                } catch {
                    rawItems = [];
                }
            }
            if (!Array.isArray(rawItems)) rawItems = [];

            for (const item of rawItems) {
                if ('delete' in item && 'updated' in item) {
                    updatedItems.push(item);
                } else {
                    if (Object.keys(item).length) {

                        updatedItems.push({
                            ...item,
                            delete: item.delete ?? false,
                            updated: item.updated ?? false
                        });
                    } else {

                    }
                }
            }
            return {
                ...plainTimeline,
                items: updatedItems
            };
        });

        // console.log(JSON.stringify(timesLines))

        return res.status(STATUSCODE.SUCCESS).json(
            success(MESSAGE.SUCCESS, { timesLines }, STATUSCODE.SUCCESS)
        );

    } catch (err) {
        console.log("Error While Getting time Line", err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};
const getOrderTaxDetails = async (req, res) => {
    try {
        const { orderId } = req.body

        const orderTax = await OrderTax.findAll({ where: { hmsOrderMstId: orderId, hotel_id: req.user }, include: { model: TaxType } })

        return res.status(STATUSCODE.SUCCESS).json(mobileSuccess(MESSAGE.SUCCESS, { orderTax }, "Order tax Fetch Successfully", STATUSCODE.SUCCESS))

    } catch (error) {
        console.log("getting OrderTax::", error)
    }
}
const getAllOrderPaginationWise = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 10;
        const offset = (page - 1) * limit;
        const search = req.query.search || "";

        const whereCondition = {
            hotel_id: req.user,
            deleted: false,
            payment: STATUS.SUCCESS,
        };

        if (search) {
            whereCondition.bill_no = search;
        }
        const settings = await RestaurantSetting.findOne({
            where: { hotel_id: req.user },
            attributes: ['bill_reset_type', 'financial_year_start_month', 'timeZone'],
        });

        let orderClause = [[Sequelize.literal('CAST(`hms_order_mst`.`bill_no` AS UNSIGNED)'), 'DESC']];

        if (settings?.bill_reset_type === 'financial_year') {
            const startMonth = settings.financial_year_start_month ?? 4;
            const timeZone = settings.timeZone ?? 'Asia/Kolkata';
            const fyStart = getFinancialYearStartDate(startMonth, timeZone);
            const fyEnd = getFinancialYearEndDate(startMonth, timeZone);

            // Current FY rows get priority 0, all older rows get priority 1.
            // Within each group sort by bill_no DESC so sequence is clean.
            orderClause = [
                [
                    Sequelize.literal(
                        `CASE WHEN \`hms_order_mst\`.\`createdAt\` BETWEEN '${fyStart.toISOString()}' AND '${fyEnd.toISOString()}' THEN 0 ELSE 1 END`
                    ),
                    'ASC'
                ],
                [Sequelize.literal('CAST(`hms_order_mst`.`bill_no` AS UNSIGNED)'), 'DESC']
            ];
        }
        const orders = await Order.findAll({
            where: whereCondition,
            include: [
                { model: Table, include: { model: TableCatagories } },
                { model: User },
                {
                    model: OrderDetails,
                    include: [
                        { model: Menu, include: { model: Menu_categ } },
                        { model: Variants, as: "variantData" }
                    ]
                }
            ],
            order: orderClause,
            limit,
            offset
        });

        const count = await Order.count({
            where: whereCondition
        });

        // ✅ ADDED ENCRYPTION (no structure changed)
        const encryptedData = encryptData({
            data: orders,
            pagination: {
                totalRecords: count,
                currentPage: page,
                totalPages: Math.ceil(count / limit),
                limit
            }
        });

        return res.status(STATUSCODE.SUCCESS).json(
            success(MESSAGE.SUCCESS, { encryptedData }, STATUSCODE.SUCCESS)
        );

    } catch (err) {
        console.log(err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

const makeSequenceBillNoOptimized = async (req, res) => {
    try {
        const hotel_id = req.user;
        console.log(hotel_id)

        const settings = await RestaurantSetting.findOne({
            where: { hotel_id },
            attributes: ['bill_reset_type', 'financial_year_start_month', 'timeZone'],
        });

        const billResetType = settings?.bill_reset_type ?? 'never';
        const startMonth = settings?.financial_year_start_month ?? 4;
        const timeZone = settings?.timeZone ?? 'Asia/Kolkata';

        const orderWhere = { hotel_id, deleted: false };

        if (billResetType === 'financial_year') {
            orderWhere.createdAt = {
                [Op.between]: [
                    getFinancialYearStartDate(startMonth, timeZone),
                    getFinancialYearEndDate(startMonth, timeZone),
                ],
            };
        }

        // Get orders scoped to FY window (or all-time if reset is disabled)
        const orders = await Order.findAll({
            where: orderWhere,
            order: [
                [Order.sequelize.literal('bill_no + 0'), 'ASC']  // MySQL trick to sort strings numerically
            ],
            attributes: ['id', 'bill_no']
        });

        if (orders.length === 0) {
            return res.json(error("No orders found to sequence", STATUSCODE.INTERNAL_SERVER_ERROR))

        }

        let sequenceUpdates = [];
        let expectedBillNo = 1;
        let updatedCount = 0;

        // Check each order and prepare updates for gaps
        for (let order of orders) {
            const currentBillNoInt = parseInt(order.bill_no);
            if (currentBillNoInt !== expectedBillNo) {
                sequenceUpdates.push({
                    id: order.id,
                    currentBillNo: order.bill_no,
                    newBillNo: expectedBillNo.toString()
                });
                updatedCount++;
            }
            expectedBillNo++;
        }

        // Perform batch updates if there are gaps to fill
        if (sequenceUpdates.length > 0) {
            // Use transaction for data consistency
            const transaction = await Order.sequelize.transaction();

            try {
                for (let update of sequenceUpdates) {
                    await Order.update(
                        { bill_no: update.newBillNo },
                        {
                            where: { id: update.id },
                            transaction: transaction
                        }
                    );
                }

                await transaction.commit();
                return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, {
                    message: `Successfully updated ${updatedCount} bill numbers to maintain sequence`,
                    updated_count: updatedCount,
                    updates: sequenceUpdates.map(u => ({
                        order_id: u.id,
                        old_bill_no: u.currentBillNo,
                        new_bill_no: u.newBillNo
                    }))
                }, STATUSCODE.SUCCESS))


            } catch (transactionError) {
                await transaction.rollback();
                throw transactionError;
            }

        } else {
            return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, {
                message: 'Bill numbers are already in sequence',
                updated_count: 0
            }, STATUSCODE.SUCCESS))

        }

    } catch (err) {
        console.error('Error in makeSequenceBillNo:', err);

        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
        // return res.status(500).json({
        //     success: false,
        //     message: 'Internal server error while sequencing bill numbers',
        //     error: process.env.NODE_ENV === 'development' ? err.message : undefined
        // });
    }
};

module.exports = {
    makeSequenceBillNoOptimized,
    getAllOrderPaginationWise,
    getOrderTaxDetails,
    getTimeLineByOrderId,
    settleAllDuePayment,
    settleDue,
    getDueOrders,
    getPendingBills,
    getOrdersByBillNo,
    getSingleOrderForAdminCart,
    deleteOrder,
    getKotOrder,
    getDinInOrder,
    getPickupOrder,
    getHoldOrders,
    addToCart,
    getCart,
    removeCartItems,
    placeOrder,
    billData,
    billDataForAdmin,
    getOrders,
    getSingleOrder
}