// socket.js
const http = require('http');
const requestHandler = require("./requestHandler")
require("dotenv").config()

const server = http.createServer();
const socketIO = require('socket.io');
const Hotel = require('../model/hotel');
const { mobileSuccess, mobileError } = require('../responce/res');
const { MESSAGE, STATUSCODE } = require('../constant/const');
const jwt = require('jsonwebtoken');
const HotelUser = require('../model/hotelUser');
const { log } = require('console');

const Order = require('../model/order');
const { Op } = require('sequelize');
const OrderDetails = require('../model/order_details');


const User = require('../model/user');
const { syncSingleOrder } = require('../controller/mobileController/offline/sync');

const Variants = require('../model/variants');
const TableCatagories = require('../model/table_catg');
const Table = require('../model/table');

const KitchenSetting = require('../model/kitchen');
const { ORDER_DETAILS_TYPE, STATUS } = require('../constant/const');
const Menu = require('../model/menu');

const Menu_categ = require('../model/menu_categ');
const redisClient = require('./redis');
const { createAdapter } = require('@socket.io/redis-adapter');
const cookie = require('cookie');

let io;
let kdsNamespace;

// Handshake auth: the same "token" cookie already sent (httpOnly, via
// withCredentials on the client) to every REST endpoint is also present on
// the socket handshake request - we just weren't reading it here before,
// which meant anyone could open a hotel-scoped or /kds connection with no
// credentials at all. Mirrors adminAuth.js/captainAuth.js: one cookie, tried
// against both possible signing secrets since either an Admin or a Captain
// session can legitimately open this connection.
const socketAuth = async (socket, next) => {
    try {
        const cookieHeader = socket.handshake.headers.cookie;
        if (!cookieHeader) {
            return next(new Error("Unauthorized"));
        }
        const { token } = cookie.parse(cookieHeader);
        if (!token) {
            return next(new Error("Unauthorized"));
        }

        let decoded;
        try {
            decoded = jwt.verify(token, process.env.JWT_SECRET_KEY_ADMIN);
        } catch {
            try {
                decoded = jwt.verify(token, process.env.JWT_SECRET_KEY_CAPTAIN);
            } catch {
                return next(new Error("Unauthorized"));
            }
        }

        const user = await HotelUser.findOne({ where: { id: decoded.id, active: true } });
        if (!user) {
            return next(new Error("Unauthorized"));
        }

        socket.hotelUserId = user.id;
        socket.authedHotelId = user.hotel_id;
        return next();
    } catch (err) {
        console.log('Socket auth error', err.message);
        return next(new Error("Unauthorized"));
    }
};

// Presence is no longer tracked in this in-memory map (it only knew about
// sockets on THIS instance). With multiple autoscaled instances we ask the
// Redis adapter, which sees rooms across every instance. See isHotelConnected().
const isHotelConnected = async (hotelId) => {
    try {
        if (!io || !hotelId) return false;
        const sockets = await io.in(String(hotelId)).fetchSockets();
        return sockets.length > 0;
    } catch (error) {
        console.log('Error checking hotel connection presence', error);
        return false;
    }
};

const checkAlreadyLoginOrNot = async (device_id, userId) => {
    try {
        const user = await HotelUser.findOne({ where: { id: userId, active: true } })
        if (user) {
            if (device_id !== user.device_id) {
                return false
            } else {
                return true
            }

        } else {
            return false
        }


    } catch (error) {
        console.log("Erro While Checking Device Logi or Not ", error)
        return false
    }
}
const authCheck = async (token, userId) => {
    try {


        // Convert jwt.verify into a promise
        const data = await new Promise((resolve, reject) => {
            jwt.verify(token, process.env.JWT_SECRET_KEY_ADMIN, (err, decoded) => {
                if (err) {
                    console.log(mobileError(MESSAGE.NOT_AUTHORIZE, STATUSCODE.VALIDATION_ERROR), "usee token validation");
                    return reject(mobileError(MESSAGE.NOT_AUTHORIZE, STATUSCODE.VALIDATION_ERROR));
                }
                resolve(decoded);
            });
        });



        const user = await HotelUser.findOne({ where: { id: data.id } });


        if (!user) {
            console.log(mobileError(MESSAGE.USER_NOT_FOUND, STATUSCODE.BAD_REQUEST), "usee Validation");
            return mobileError(MESSAGE.USER_NOT_FOUND, STATUSCODE.BAD_REQUEST);
        }


        return { code: 200, error: false, status: "success", message: "Signup" };

    } catch (error) {
        console.log(error, "Error internal server");
        return mobileError(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR);
    }
};

function initializeSocket(server) {
    io = socketIO(server, {
        cors: {
            origin: [process.env.DASH_BOARD_URL, process.env.SOCKET_URL],
            credentials: true,
        },
        transports: ["websocket"],

        pingTimeout: 60000,
        pingInterval: 5000,
        allowEIO3: true,
    });

    // --- Cross-instance support for autoscaling / load balancing ---
    // Without this adapter every instance keeps its own isolated set of rooms,
    // so io.to(room).emit() on one server never reaches clients on another.
    // The adapter relays rooms/broadcasts between instances over Redis pub/sub.
    const pubClient = redisClient.duplicate();
    const subClient = redisClient.duplicate();
    pubClient.on('error', (err) => console.error('Redis pubClient error:', err.message));
    subClient.on('error', (err) => console.error('Redis subClient error:', err.message));
    Promise.all([pubClient.connect(), subClient.connect()])
        .then(() => {
            io.adapter(createAdapter(pubClient, subClient));
            console.log('Socket.IO Redis adapter connected (multi-instance broadcasting enabled)');
        })
        .catch((err) => console.error('Failed to connect Socket.IO Redis adapter:', err.message));

    // Initialize KDS namespace
    kdsNamespace = io.of("/kds");

    io.use(socketAuth);
    kdsNamespace.use(socketAuth);

    io.on("connection", (socket) => {
        console.log('Total connected users:', io.engine.clientsCount);
        console.log("A user connected", socket.id);
        console.log(socket.handshake.query, "query Paramer")
        const hotelId = parseInt(socket.handshake.query.hotelId);
        if (hotelId) {
            socket.join(String(hotelId))
        }
        socket.on("login", async (data) => {
            try {
                const { hotelId } = data
                if (hotelId) {
                    console.log("login comming", hotelId)
                    socket.join(String(hotelId))
                    const payload = mobileSuccess(MESSAGE.SUCCESS, { message: "Login Successfully" }, "Success", STATUSCODE.SUCCESS)
                    await socket.emit("login", payload)
                }
            } catch (error) {
                console.log(error)
            }
        })

        console.log(socket.handshake.query.hotelId)
        var room = io.sockets.adapter.rooms

        socket.on("signup", async (data) => {
            try {
                console.log("signup Comming")
                const { hotel_id } = data
                if (!hotel_id) {
                    await socket.emit("signup", mobileError(MESSAGE.NOT_AUTHORIZE, STATUSCODE.VALIDATION_ERROR))
                }
                socket.join(String(hotel_id))
                const checking = await checkAlreadyLoginOrNot(data.device_id, +data.user_id)
                console.log("Checking:::::::::::::::::::", checking)
                // await socket.emit("signup", "here coming")
                if (!checking) {
                    const data = await socket.emit("signup", mobileError(MESSAGE.NOT_AUTHORIZE, STATUSCODE.VALIDATION_ERROR))
                    // console.log(data, "Data")
                }
                const checkAuth = await authCheck(data.token, +data.user_id)
                // console.log(checkAuth, "check auth")
                if (checkAuth.code !== 200) {
                    await socket.emit("signup", checkAuth)
                } else {

                    let orders;
                    const exists = await redisClient.exists(`hotel:${hotelId}:orders`);
                    if (exists) {
                        const value = await redisClient.get(`hotel:${hotelId}:orders`);
                        orders = JSON.parse(value);
                    } else {
                        orders = await Order.findAll({
                            where: {
                                hotel_id: Number(hotel_id),
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
                            `hotel:${Number(hotel_id)}:orders`,
                            JSON.stringify(orders),
                            { EX: 172800 }
                        );
                    }
                    const tables = await Table.findAll({ where: { hotel_id: Number(hotel_id), active: true }, include: { model: TableCatagories, where: { hotel_id: Number(hotel_id), active: true }, attributes: [], required: true } })


                    const payload = mobileSuccess(MESSAGE.SUCCESS, { tables, orders }, "Success", STATUSCODE.SUCCESS)
                    await socket.emit("signup", payload)
                }
            } catch (error) {
                console.log(error)
            }
        })
        socket.on('syncSingleOrder', async (data) => {
            console.log("syncSingle Order comming")
            // await syncSingleOrder(data, socket)
        })

        // socket.on('update_order', async (data) => {
        //     await updateSocketOrder(data, socket)
        // })
        socket.on('create_order', async (data) => {
            const { createSocketOrder } = require('../controller/mobileController/offline/gettingData');
            const checking = await checkAlreadyLoginOrNot(data.device_id, +data.hotelUserId)
            console.log("Checking:::::::::::::::::::", checking)
            if (!checking) {
                const data = await socket.emit("create_order", mobileError(MESSAGE.NOT_AUTHORIZE, STATUSCODE.VALIDATION_ERROR))

                return
            }
            await createSocketOrder(data, socket)
        })
        socket.on("disconnect", () => {
            console.log('Total connected users:', io.engine.clientsCount);
            // Presence is derived from the adapter (rooms across all instances),
            // so there is nothing to clear here. The socket leaves its rooms
            // automatically on disconnect.
            console.log("User disconnected");
        });
        // socket.on("joinRoom", (id) => {
        //     connection[id] = true
        //     socket.join(id)
        // });
    });

    kdsNamespace.on("connection", (socket) => {
        console.log("KDS connected");

        // Join kitchen room
        socket.on("joinKitchen", async ({ kitchenId }) => {
            try {
                socket.join(`kitchen_${kitchenId}`);
                console.log(`KDS joined kitchen room: ${kitchenId}`);

                // Send initial orders
                const kitchen = await KitchenSetting.findByPk(kitchenId);
                if (!kitchen) {
                    socket.emit("error", { message: "Kitchen not found" });
                    return;
                }

                const orders = await Order.findAll({
                    where: {
                        hotel_id: kitchen.hotel_id,
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

                log("Raw Orders Data:::", orders);
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
                        notes: order.notes || ""
                    }));
                }).flat();

                // const filterData = formattedOrders.filter(el => {
                //     const anyonefalse = el.items.some(el => !el.ready)
                //     if (anyonefalse) {
                //         return el
                //     }
                // })

                log("Formatted Orders Data:::", formattedOrders);
                socket.emit("initialOrders", formattedOrders);
            } catch (error) {
                console.error("Error in joinKitchen:", error);
                socket.emit("error", { message: "Failed to join kitchen" });
            }
        });

        // Handle item ready status
        socket.on("itemStatusUpdate", async (data) => {
            try {

                const { orderId, orderDetailsId, kitchen } = data
                console.log("Kitchen::::", orderId, orderDetailsId, kitchen)
                const getOrderDetails = await OrderDetails.findByPk(orderDetailsId)

                await OrderDetails.update(
                    { ready: !getOrderDetails.ready },
                    { where: { id: orderDetailsId } }
                );


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

                                attributes: ['item_name', 'menu_categ_id'],
                                required: true
                            }]
                        },
                        { model: HotelUser, attributes: ['name'] }, { model: Table, attributes: ["table_name", 'type'], include: { model: TableCatagories, attributes: ['table_catag_nm'] } }

                    ],
                    order: [['createdAt', 'DESC']]
                });

                // log("Raw Orders Data:::", orders);


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
                        deteled: false
                    })),
                    notes: orders.notes || "",

                }))

                // const findAllKitchen = await KitchenSetting.findAll({ where: { hotel_id: kitchen.hotel_id } })
                // const kdsNamespace = getKDSNamespace()
                // for (const element of findAllKitchen) {

                const data3 = await socket.broadcast.emit("itemready", formatedData);
                console.log(data3, "Data3")
                // }
                // socket.emit("itemReady", formatedData);

            } catch (error) {
                console.error("Error in itemStatusUpdate:", error);
                socket.emit("error", { message: "Failed to update item status" });
            }
        });

        // Handle order completion
        socket.on("readyKot", async ({ orderId, kotNumber, kitchen, allIdes }) => {
            try {
                console.log("readkot")
                const order = await Order.findByPk(orderId);
                if (!order) {
                    socket.emit("error", { message: "Order not found" });
                    return;
                }
                // await Order.update({ status: ORDER_DETAILS_TYPE.DELIVERED }, { where: { id: orderId } })

                await OrderDetails.update(
                    { ready: true },
                    {
                        where: {
                            orderId: orderId, kotNumber: kotNumber, id: {
                                [Op.in]: allIdes
                            }
                        }
                    }
                );
                const getAllKitchen = await KitchenSetting.findAll({ where: { hotel_id: order.hotel_id }, attributes: ['id'] })
                // Notify POS about completed order
                // io.to(`hotel_${order.hotel_id}`).emit("orderComplete", { orderId });

                // // Remove order from KDS display
                // socket.to(`kitchen_${order.kitchen_id}`).emit("orderComplete", { orderId });
                // const kdsNamespace = getKDSNamespace()
                for (const kitchen of getAllKitchen) {
                    kdsNamespace.to(`kitchen_${kitchen.id}`).emit("readyKot", { orderId, kotNumber, allIdes })
                }
            } catch (error) {
                console.error("Error in completeOrder:", error);
                socket.emit("error", { message: "Failed to complete order" });
            }
        });

        socket.on("disconnect", () => {
            console.log("KDS disconnected");
        });
    });

    // Helper function to calculate order timer
    const calculateOrderTimer = (createdAt) => {
        const now = new Date();
        const created = new Date(createdAt);
        const diff = Math.floor((now - created) / 1000 / 60); // difference in minutes
        const hours = Math.floor(diff / 60);
        const minutes = diff % 60;
        return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
    };

    return { io, kdsNamespace }
}

const checkDashBoardOnOrNot = async (req, res) => {
    try {
        const hotel = await Hotel.findOne({ where: { id: req.user } })
        if (!hotel) return res.json(mobileError(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.NOT_FOUND))
        const hotelId = req.user

        if (hotelId && await isHotelConnected(hotelId)) {
            res.json(mobileSuccess(MESSAGE.SUCCESS, { isSocketConnected: true }, "Printer Connected", STATUSCODE.SUCCESS));
        } else {
            res.json(mobileSuccess(MESSAGE.SUCCESS, { isSocketConnected: false }, "printer Not connected", STATUSCODE.SUCCESS));
        }

    } catch (err) {
        console.log(err)
        return res.json(mobileError(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

// Function to get the main socket instance
const getIO = () => {
    if (!io) {
        console.log('Socket.io not initialized');
    }
    return io;
}

// Function to get the KDS namespace
const getKDSNamespace = () => {
    if (!kdsNamespace) {
        console.log('KDS namespace not initialized');
    }
    return kdsNamespace;
}

// Function to emit to all connected KDS clients
const emitToKDS = (kitchenId, event, data) => {
    if (kdsNamespace) {
        kdsNamespace.to(`kitchen_${kitchenId}`).emit(event, data);
    }
}

// Function to emit to all connected POS clients
const emitToPOS = (hotelId, event, data) => {
    if (io) {
        io.to(`hotel_${hotelId}`).emit(event, data);
    }
}

module.exports = {
    initializeSocket,
    getIO,
    getKDSNamespace,
    emitToKDS,
    emitToPOS,
    checkDashBoardOnOrNot
};
