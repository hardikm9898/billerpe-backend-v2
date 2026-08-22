const { Op } = require("sequelize")
const { MESSAGE, STATUSCODE, ORDER_TYPE, ORDER_DETAILS_TYPE, STATUS } = require("../../../constant/const")
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
const User = require("../../../model/user")
const Variants = require("../../../model/variants")
const { mobileError, mobileSuccess } = require("../../../responce/res")

const { MenuShowByCatagories } = require("../../menu")

const sequelize = require("../../../connection/connect")
const { createLogFile } = require("../../../logs/log")
const TimeLine = require("../../../model/timeline")
const HotelUser = require("../../../model/hotelUser")

const { log } = require("console")
const { sendKotToAllKdsClient, otherkot, removeKotItemFromKds, descriseKotQtyItemFromKDS, orderCompletedSendtoKdsCLient } = require("../../kds/kds")
const OrderTax = require("../../../model/orderTax")
const TaxType = require("../../../model/taxType")

const redisClient = require("../../../connection/redis")
const { newOrderAppendToRadis, deleteOrderToRedis, updateOrderAppendToRadis, updateTableToRadis } = require("../../redis/redisCrud")
const { checkRawMaterialAvailableOrNot } = require("../../recipes")
const { RestaurantSetting } = require("../../../model")
const { getBusinessDate } = require("../../../utils/dateUtils")
const { updatedPosData, findAndUpdateUser } = require("../kot")
const { getNextBillNo } = require("../../../helpers/billNumber")


const getMobileTables = async (req, res) => {
    try {
        let tables = [];
        let tableCategory = [];

        const tableKey = `hotel:${req.user}:table`;
        const categoryExists = await redisClient.exists(`hotel:${req.user}:tableCategory`)


        const tableExists = await redisClient.exists(`hotel:${req.user}:table`);
        // Fetch from Redis if both exist
        if (tableExists) {
            // console.log("Getting table & tableCategory from Redis for mobile");
            const tableValue = await redisClient.get(`hotel:${req.user}:table`)
            tables = JSON.parse(tableValue);
        } else {
            // Fetch from DB if not in Redis
            // console.log("Fetching table & tableCategory from DB for mobile");

            const freshTables = await Table.findAll({ where: { hotel_id: req.user, active: true }, include: { model: TableCatagories, where: { active: true } }, required: true })
            tables = freshTables;
            redisClient.set(tableKey, JSON.stringify(tables), { EX: 172800 })
        }
        if (categoryExists) {
            const categoryValue = await redisClient.get(`hotel:${req.user}:tableCategory`)
            tableCategory = JSON.parse(categoryValue);
        } else {
            const freshCategories = await TableCatagories.findAll({ where: { hotel_id: req.user, active: true }, include: { model: Table, required: false, where: { active: true }, include: { model: TableCatagories, required: false } } })
            tableCategory = freshCategories;
            redisClient.set(`hotel:${req.user}:tableCategory`, JSON.stringify(tableCategory), { EX: 172800 })
        }
        // console.log(tables.filter(el => el.table_name === '5' || el.table_name === '2'))
        return res.status(STATUSCODE.SUCCESS).json(
            mobileSuccess("success", { tables, tableCategory }, MESSAGE.USER_LOGIN, STATUSCODE.SUCCESS)
        );

    } catch (err) {
        console.log(err);
        createLogFile(req.user, `Error in getMobileTables`, err);
        return res.json(mobileError(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

const gettingMobileAllOrders = async (req, res) => {
    try {
        let orders;
        const exists = await redisClient.exists(`hotel:${req.user}:orders`);
        if (exists) {
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
                        model: Table, where: { active: true },
                        include: { model: TableCatagories, where: { active: true } }
                    },
                    { model: User },
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

            await redisClient.set(
                `hotel:${req.user}:orders`,
                JSON.stringify(orders),
                { EX: 172800 }
            );
        }

        // Order details logic
        const orderIds = orders.map(o => o.id);
        const orderDetails = await OrderDetails.findAll({
            where: {
                hotel_id: req.user,
                orderId: {
                    [Op.in]: orderIds
                }
            },
            include: {
                model: Order,
                as: "order",
                required: true,
                attributes: []
            }
        });

        return res.status(STATUSCODE.SUCCESS).json(
            mobileSuccess("success", { orderDetails, orders }, MESSAGE.USER_LOGIN, STATUSCODE.SUCCESS)
        );

    } catch (err) {
        console.error(err);
        createLogFile(req.user, "Error in gettingMobileAllOrders", err);
        return res.json(mobileError(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

const gettingMobileMenu = async (req, res) => {
    try {

        let menus = []
        const existsmenu = await redisClient.exists(`hotel:${req.user}:menu`);

        if (existsmenu) {
            // console.log("Redis Data Get menu");
            // console.log(new Date(), "start")
            const value = await redisClient.get(`hotel:${req.user}:menu`);
            menus = JSON.parse(value);
            // console.log(new Date(), "end")

        } else {
            // printerSettings = await PrinterSetting.findAll({ where: { hotel_id: req.user } })
            menus = await Menu.findAll({ where: { hotel_id: req.user, active: true }, include: [{ model: Menu_categ }, { model: Variants, as: "variantData", where: { active: true }, required: false }, { model: AddonDepartment, as: "addonDepartmentData", include: { model: Addons } }] })
            await redisClient.set(`hotel:${req.user}:menu`, JSON.stringify(menus), { EX: 172800 })
        }
        let menuCategorys = []
        const exists = await redisClient.exists(`hotel:${req.user}:menu_category`);

        if (exists) {
            // console.log("Redis Data Get menu categ");
            // console.log(new Date(), "start")
            const value = await redisClient.get(`hotel:${req.user}:menu_category`);
            menuCategorys = JSON.parse(value);
            // console.log(new Date(), "end")

        } else {
            // printerSettings = await PrinterSetting.findAll({ where: { hotel_id: req.user } })
            menuCategorys = await Menu_categ.findAll({ where: { hotel_id: req.user, active: true } })
            await redisClient.set(`hotel:${req.user}:menu_category`, JSON.stringify(menuCategorys), { EX: 172800 })
        }

        const variants = await Variants.findAll({ where: { hotel_id: req.user, active: true } })
        const menuAddons = await MenuAddon.findAll({ where: { hotel_id: req.user, active: true } })
        const addons = await Addons.findAll({ where: { hotel_id: req.user }, include: { model: AddonDepartment, where: { active: true, hotel_id: req.user }, required: true, attributes: [] } })
        const addonsDepartments = await AddonDepartment.findAll({ where: { hotel_id: req.user, active: true } })
        const menuVariants = await MenuVariants.findAll({ where: { hotel_id: req.user } })
        return res.status(STATUSCODE.SUCCESS).json(mobileSuccess("success", { menuCategorys, menus, variants, menuAddons, menuVariants, addonsDepartments, addons }, MESSAGE.USER_LOGIN, STATUSCODE.SUCCESS));
    } catch (err) {
        log(err)
        return res.json(mobileError(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
function matchDepartmentsAndAddonsById(original, other) {
    if (original.length !== other.length) return false;

    for (let dept of original) {
        const matchingDept = other.find((oDept) => oDept.id === dept.id);

        if (!matchingDept) {

            return false;
        }
        log(matchingDept, dept, "both Department -->")

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
function getAddonsFromMobileData(addonData = []) {
    try {
        if (!Array.isArray(addonData) || addonData.length === 0) {
            return [];
        }

        // Already in DB format
        const isDbFormat = addonData.every(item =>
            item &&
            Array.isArray(item.hms_addon_msts) &&
            item.hms_addon_msts.length > 0 &&
            item.hms_addon_msts.every(addon =>
                addon &&
                addon.id &&
                addon.department_id !== undefined
            )
        );

        if (isDbFormat) {
            return addonData.filter(
                dept => dept.hms_addon_msts?.length > 0
            );
        }

        // Convert mobile format
        const departments = {};

        for (const item of addonData) {

            if (
                item?.type !== 1 ||
                Number(item?.addonsQty) <= 0
            ) {
                continue;
            }

            const departmentId = Number(
                item?.department_id ||
                item?.hmsAddonMst?.department_id ||
                item?.id
            );

            if (!departmentId) {
                continue;
            }

            if (!departments[departmentId]) {
                departments[departmentId] = {
                    id: departmentId,
                    department_name: item?.department_name || "",
                    singleSelection: Boolean(item?.singleSelection),
                    maximum_allowed_addon:
                        Number(item?.maximum_allowed_addon) || 0,
                    minimum_allowed_addon:
                        Number(item?.minimum_allowed_addon) || 0,
                    hms_addon_msts: []
                };
            }

            departments[departmentId].hms_addon_msts.push({
                qty: Number(item?.addonsQty) || 0,
                id: Number(item?.hmsAddonMst?.id || item?.id) || 0,
                price: Number(
                    item?.hmsAddonMst?.price ??
                    item?.price
                ) || 0,
                hotel_id: Number(
                    item?.hmsAddonMst?.hotel_id ??
                    item?.hotel_id
                ) || 0,
                createdAt:
                    item?.hmsAddonMst?.createdAt ??
                    item?.createdAt ??
                    null,
                updatedAt:
                    item?.hmsAddonMst?.updatedAt ??
                    item?.updatedAt ??
                    null,
                addon_name:
                    item?.hmsAddonMst?.addon_name ??
                    item?.addon_name ??
                    "",
                attributes:
                    item?.hmsAddonMst?.attributes ??
                    item?.attributes ??
                    "",
                department_id: departmentId
            });
        }

        return Object.values(departments).filter(
            dept => dept.hms_addon_msts.length > 0
        );

    } catch (error) {
        console.error("Error extracting addons:", error);
        return [];
    }
}

const gettingHeaderFooter = async (req, res) => {
    try {
        const hotel = await Hotel.findOne({ where: { id: req.user }, include: { model: InvoiceFormate } })
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
        const headerText = headerContent.map(el => {

            let data = ""
            if (el == "marketing_text") {
                data = hotel.invoiceFormateHeaderText
                return el ? { title: 'marketing_text', value: data } : ''
            }
            else if (el === 'hotel_logo') {
                return el ? { title: 'hotel_logo', value: hotel[el] } : ''
                // return el ? hotel[el] : ''
            } else if (el === 'gst_no') {
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
        }
        )
        const footerText = footerContent.map(el => {
            let data = ""
            if (el == "marketing_text") {
                data = hotel.invoiceFormateHeaderText
                return el ? { title: 'marketing_text', value: data } : ''
            }
            else if (el === 'hotel_logo') {
                return el ? { title: 'hotel_logo', value: hotel[el] } : ''
                // return el ? hotel[el] : ''
            } else if (el === 'gst_no') {

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


        return res.status(STATUSCODE.SUCCESS).json(mobileSuccess("success", { footerText, headerText }, "Header Footer Data Fetched", STATUSCODE.SUCCESS));

    } catch (err) {
        log(err)
        return res.json(mobileError(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const webChange = async (hotelId, io, orderId) => {
    try {

        // log(+hotelId, io, orderId, "hotelId, io, orderId")
        const order = await Order.findByPk(orderId)
        const orderDetails = await OrderDetails.findAll({ where: { hotel_id: hotelId, orderId: orderId }, include: [{ model: Order, as: "order", where: { hotel_id: hotelId, id: orderId }, required: true, attributes: [] }, { model: Menu, include: { model: Menu_categ } }] })
        var room = io.sockets.adapter.rooms
        // log(room, "Room s")
        await io.to(hotelId).emit("webChange", { key: "object", order, orderDetails })

    } catch (error) {
        log(error, "on Web Change")
    }
}
const updateSocketOrder = async (data, socket) => {
    try {



    } catch (err) {
        log(err)
        socket.emit(mobileError(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
        return
    }
}

const generateToken = async (hotel_id) => {

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

    return findMaxToken?.token ? parseInt(findMaxToken.token) + 1 : 1;

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
const kot = async (originalId, orderId, orderDetails, hotel_id, TableId) => {
    try {
        log({
            orderId,
            hotel_id
        }, "max kot Number condition")
        const maxKotNumber = await OrderDetails.max('kotNumber', {
            where: {
                orderId,
                hotel_id
            },
            raw: true
        });

        if (originalId) {
            log({ orderId, hotel_id, status: ORDER_DETAILS_TYPE.IN_PROGRESS }, "destroy condition")
            await OrderDetails.destroy({ where: { orderId, hotel_id, status: ORDER_DETAILS_TYPE.IN_PROGRESS } }, { truncate: true })

            for (const cur of orderDetails) {
                if (!+cur.qty) {
                    return res.mobileError(MESSAGE.QTY_MUST_BE_GREATER_THAN_ZERO, STATUSCODE.VALIDATION_ERROR)
                }
                if (cur.status === "kot") {

                } else {

                    let condition = { orderId, MenuId: +cur.MenuId, kotNumber: maxKotNumber + 1, hotel_id }
                    if (cur.variant_id) {
                        condition = { orderId, variant_id: +cur.variant_id, MenuId: +cur.MenuId, kotNumber: maxKotNumber + 1, hotel_id }
                    }
                    log(condition, "condition-->")
                    const OrderDetailsAvailable = await OrderDetails.findOne({ where: { ...condition } })
                    let result = false
                    let addons = []
                    if (cur?.addons?.length) {
                        addons = cur.addons
                    }
                    if (OrderDetailsAvailable) {
                        if (addons?.length) {
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
                        await OrderDetails.update({ totalDiscount: cur.discount, qty: +cur.qty + OrderDetailsAvailable.qty }, { where: { id: OrderDetailsAvailable.id, orderId, hotel_id: hotel_id } })
                    }
                    else {
                        let modifiedCartForOrderDetails = { MenuId: "", hotel_id: "", qty: "", orderId: "" };
                        modifiedCartForOrderDetails.MenuId = +cur.MenuId
                        if (!cur?.hms_menu_mst?.active) {
                            const { price, item_name } = cur?.hms_menu_mst
                            const menu = await Menu.create({ price, item_name, active: false, hotel_id })
                            modifiedCartForOrderDetails.MenuId = menu.id
                        }
                        // modifiedCartForOrderDetails.MenuId = +cur.MenuId
                        modifiedCartForOrderDetails.qty = cur.qty
                        modifiedCartForOrderDetails.price = +cur.price
                        modifiedCartForOrderDetails.kotNumber = maxKotNumber + 1
                        modifiedCartForOrderDetails.order_type = cur.order_type
                        modifiedCartForOrderDetails.payment_status = STATUS.PENDING
                        modifiedCartForOrderDetails.comment = cur?.comment
                        modifiedCartForOrderDetails.hotel_id = hotel_id
                        modifiedCartForOrderDetails.orderId = +orderId
                        modifiedCartForOrderDetails.status = 'kot'
                        modifiedCartForOrderDetails.TableId = +TableId ? +TableId : null
                        modifiedCartForOrderDetails.addons = cur?.addons?.length?getAddonsFromMobileData(cur.addons):[]
                        modifiedCartForOrderDetails.variant_id = cur?.variant_id ? cur.variant_id : null
                        modifiedCartForOrderDetails.variant_name = cur?.variant_name ? cur.variant_name : null
                        await OrderDetails.create(modifiedCartForOrderDetails)
                    }
                }


            }
        }
        else {
            for (const cur of orderDetails) {
                let addons = []
                addons = cur.addons
                let modifiedCartForOrderDetails = { MenuId: "", hotel_id: "", qty: "", orderId: "", totalDiscount: 0 };
                modifiedCartForOrderDetails.MenuId = cur.MenuId
                if (!cur?.hms_menu_mst?.active) {
                    // console.log(cur, "Cur:::")
                    const { price, item_name } = cur?.hms_menu_mst
                    const menu = await Menu.create({ price, item_name, active: false, hotel_id })
                    modifiedCartForOrderDetails.MenuId = menu.id
                }
                modifiedCartForOrderDetails.qty = +cur.qty
                modifiedCartForOrderDetails.price = +cur.price
                modifiedCartForOrderDetails.kotNumber = 1
                // modifiedCartForOrderDetails.totalDiscount = cur.discount
                modifiedCartForOrderDetails.order_type = cur?.order_type
                modifiedCartForOrderDetails.comment = cur?.comment
                // modifiedCartForOrderDetails.UserId = user?.id
                modifiedCartForOrderDetails.TableId = TableId ? +TableId : null
                modifiedCartForOrderDetails.payment_status = STATUS.PENDING,
                    modifiedCartForOrderDetails.hotel_id = +hotel_id
                modifiedCartForOrderDetails.orderId = orderId
                modifiedCartForOrderDetails.status = ORDER_DETAILS_TYPE.KOT
                modifiedCartForOrderDetails.addons = addons.length ? getAddonsFromMobileData(addons) : []
                modifiedCartForOrderDetails.variant_id = cur?.variant_id ? +cur.variant_id : null
                modifiedCartForOrderDetails.variant_name = cur?.variant_name ? cur.variant_name : null
                // modificationOrderDetails.push(modificationOrderDetails)
                await OrderDetails.create(modifiedCartForOrderDetails)

            }
        }

    } catch (err) {
        throw new Error(err.message)
    }
}
const completedOrder = async (originalId, orderId, orderDetails, hotel_id, TableId) => {
    try {
        console.log(JSON.stringify(orderDetails), "Original orderid hotelid")
        if (originalId) {
            await OrderDetails.destroy({ where: { orderId, hotel_id } })
            for (const cur of orderDetails) {
                let condition = { orderId: orderId, MenuId: +cur.MenuId, price: +cur.price, hotel_id, status: { [Op.eq]: ORDER_DETAILS_TYPE.DELIVERED } }
                if (cur.variant_id) {
                    condition = { orderId, variant_id: +cur.variant_id, MenuId: +cur.MenuId, price: +cur.price, hotel_id, status: { [Op.eq]: ORDER_DETAILS_TYPE.DELIVERED } }
                }
                // log(condition, "condition")
                const OrderDetailsAvailable = await OrderDetails.findOne({ where: { ...condition } })
                // log(OrderDetailsAvailable, "avaibale Order Details--")
                let result = false
                let addons = []

                if (cur?.addons?.length) {
                    addons = cur.addons
                }
                if (OrderDetailsAvailable) {
                    if (addons?.length) {
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
                    await OrderDetails.update({ qty: +cur.qty + OrderDetailsAvailable.qty, payment_status: cur.order_type == "pickup" ? STATUS.SUCCESS : STATUS.PENDING, status: ORDER_DETAILS_TYPE.DELIVERED }, { where: { id: OrderDetailsAvailable.id, hotel_id } })
                }
                else {
                    let modifiedCartForOrderDetails = { MenuId: "", hotel_id: "", qty: "", orderId: "" };
                    modifiedCartForOrderDetails.MenuId = cur.MenuId
                    if (!cur?.hms_menu_mst?.active) {
                        const { price, item_name } = cur?.hms_menu_mst
                        const menu = await Menu.create({ price, item_name, active: false, hotel_id })
                        modifiedCartForOrderDetails.MenuId = menu.id
                    }
                    modifiedCartForOrderDetails.qty = cur.qty
                    modifiedCartForOrderDetails.price = +cur.price
                    modifiedCartForOrderDetails.totalDiscount = cur.discount
                    modifiedCartForOrderDetails.order_type = cur.order_type
                    modifiedCartForOrderDetails.payment_status = cur.order_type == "pickup" ? STATUS.SUCCESS : STATUS.PENDING
                    modifiedCartForOrderDetails.hotel_id = cur.hotel_id
                    modifiedCartForOrderDetails.orderId = orderId
                    modifiedCartForOrderDetails.comment = cur?.comment
                    modifiedCartForOrderDetails.status = ORDER_DETAILS_TYPE.DELIVERED
                    modifiedCartForOrderDetails.TableId = TableId ? +TableId : null
                    modifiedCartForOrderDetails.addons = addons?.length ? getAddonsFromMobileData(addons) : []
                    modifiedCartForOrderDetails.variant_id = cur?.variant_id ? cur.variant_id : null
                    modifiedCartForOrderDetails.variant_name = cur?.variant_name ? cur.variant_name : null
                    await OrderDetails.create(modifiedCartForOrderDetails)
                }
            }

        }
        else {

            for (const cur of orderDetails) {
                let addons = []
                addons = cur.addons
                let modifiedCartForOrderDetails = { MenuId: "", hotel_id: "", qty: "", orderId: "", totalDiscount: 0 };
                modifiedCartForOrderDetails.MenuId = cur.MenuId
                if (!cur?.hms_menu_mst?.active) {
                    const { price, item_name } = cur?.hms_menu_mst
                    const menu = await Menu.create({ price, item_name, active: false, hotel_id })
                    modifiedCartForOrderDetails.MenuId = menu.id
                }
                modifiedCartForOrderDetails.qty = +cur.qty
                modifiedCartForOrderDetails.price = +cur.price
                modifiedCartForOrderDetails.kotNumber = 1
                modifiedCartForOrderDetails.comment = cur?.comment
                modifiedCartForOrderDetails.order_type = cur?.order_type
                modifiedCartForOrderDetails.TableId = TableId ? TableId : null
                modifiedCartForOrderDetails.payment_status = cur.order_type === ORDER_TYPE.PICKUP ? STATUS.SUCCESS : STATUS.PENDING,
                modifiedCartForOrderDetails.hotel_id = +hotel_id
                modifiedCartForOrderDetails.orderId = +orderId
                modifiedCartForOrderDetails.status = ORDER_DETAILS_TYPE.DELIVERED
                modifiedCartForOrderDetails.addons = addons.length ? getAddonsFromMobileData(addons) : []
                modifiedCartForOrderDetails.variant_id = cur?.variant_id ? +cur.variant_id : null
                modifiedCartForOrderDetails.variant_name = cur?.variant_name ? cur.variant_name : null
                // modificationOrderDetails.push(modificationOrderDetails)
                const data = await OrderDetails.create(modifiedCartForOrderDetails)
                // log(data, "order Details created")
            }
        }


    } catch (err) {
        throw new Error(err.message)
    }
}

const addToTimeLineMobile = async (id, action, event_name, device_name, userId) => {
    const order = await Order.findOne({ where: { id }, include: [{ model: OrderDetails, include: [{ model: Menu, include: { model: Menu_categ } }, { model: Variants, as: "variantData" }] }, { model: HotelUser, attributes: ['name'] }] })
    log(order.id, "Order--->")
    const userName = await HotelUser.findByPk(userId)
    // log(userName)
    const { totalDiscount: discount, service_charge, grandAmount, gst, id: order_id, totalAmount: sub_total, order_type, bill_no, status: order_status, TableId, hotelUserId, hotel_id } = order
    // log(order, "order---->")
    const { hms_orderDetails: items } = order
    const timeline = await TimeLine.create({ gst, service_charge, grandAmount, discount, creator: userName?.name, order_id, sub_total, order_type, order_status, bill_no, items, action, event_name: event_name, device_name: device_name, from: "online", created_Date: new Date(), TableId, hotelUserId: userName?.id, hotel_id })
    const timeLineretun = await TimeLine.findByPk(timeline?.id)
    if (timeLineretun?.items && Array.isArray(timeLineretun.items)) {
        timeLineretun.items = JSON.stringify(timeLineretun.items);
    }
    return timeLineretun
}
const addToTimeLineRemoveKotMobile = async (id, action, event_name, device_name, userId, detailId, actionHere) => {
    const order = await Order.findOne({ where: { id }, include: [{ model: OrderDetails, include: [{ model: Menu, include: { model: Menu_categ } }, { model: Variants, as: "variantData" }] }, { model: HotelUser, attributes: ['name'] }] })
    // log(order, "Order--->")
    const userName = await HotelUser.findByPk(userId)
    // log(userName)
    const { totalDiscount: discount, service_charge, grandAmount, gst, id: order_id, totalAmount: sub_total, order_type, bill_no, status: order_status, TableId, hotelUserId, hotel_id } = order
    // log(order, "order---->")
    let items = []
    const findTimeLine = await TimeLine.findAll({ where: { order_id: id, deleted: false } })
    // console.log(JSON.stringify(findTimeLine[0].items), "original Itmes")
    if (findTimeLine[findTimeLine.length - 1]?.items?.length) {
        for (const element of findTimeLine[findTimeLine.length - 1].items) {
            let data = {}
            if (actionHere === "decriseKot") {
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
    const timeline = await TimeLine.create({ gst, service_charge, grandAmount, discount, creator: userName?.name, order_id, sub_total, order_type, order_status, bill_no, items, action, event_name: event_name, device_name: device_name, from: "online", created_Date: new Date(), TableId, hotelUserId: userName?.id, hotel_id })
    const timeLineretun = await TimeLine.findByPk(timeline?.id)
    if (timeLineretun?.items && Array.isArray(timeLineretun.items)) {
        timeLineretun.items = JSON.stringify(timeLineretun.items);
    }
    return timeLineretun
}

const addOrderTax = async (taxes, orderId, hotel_id) => {

    if (taxes.length) {
        for (const el of taxes) {
            const data = await OrderTax.create({ amount: el.amount, tax_type: el.tax_value, tax_value: el.tax, hmsOrderMstId: orderId, hmsTaxTypeMstId: el.id, hotel_id })
            // console.log(data, "Order Tax created::")
        }
    }
}

const updateOrderTax = async (taxes, orderId, hotel_id) => {
    if (taxes.length) {

        for (const el of taxes) {
            const data = await OrderTax.update({ amount: el.amount, tax_type: el.tax_type, tax_value: el.tax }, { where: { hotel_id, hmsOrderMstId: orderId, hmsTaxTypeMstId: el.id } })
            // console.log(data, "Order Tax Updated::")
        }
    }
}

let tableLocks = new Map();

const acquireTableLock = (tableId) => {
    if (tableLocks.has(tableId)) {
        return false; // locked by someone else
    }
    tableLocks.set(tableId, true); // lock it
    return true;
};

const releaseTableLock = (tableId) => {
    tableLocks.delete(tableId); // unlock
};

const updateOrdeer = async (data) => {

    try {
        const {
            id,
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
            address = "",
            hotel_id,
        } = data
        // console.log(data, "Data in update order")
        const order_id = id
        const hotel = await Hotel.findOne({ where: { id: hotel_id } })
        if (!hotel) {
            throw new Error(MESSAGE.HOTEL_NOT_FOUND)
            // res.json(mobileError(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST))
        }

        // Find order
        if (!order_id) {
            throw new Error('Order ID is required')

        }

        const findOrder = await Order.findOne({ where: { id: order_id, hotel_id, deleted: false } })
        if (!findOrder) {
            throw new Error(MESSAGE.ORDER_NOT_FOUND)

        }

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
                    addons: cur?.addons?.length?getAddonsFromMobileData(cur.addons) : [],
                    variant_id: cur.variant_id ? +cur.variant_id : null,
                    variant_name: cur.variant_name || null
                }
                if (!cur?.hms_menu_mst?.active) {
                    const { price, item_name } = cur?.hms_menu_mst
                    const menu = await Menu.create({ price, item_name, active: false, hotel_id })
                    modifiedCartForOrderDetails.MenuId = menu.id
                }
                await OrderDetails.create(modifiedCartForOrderDetails)
            }
        }
        return true


    } catch (error) {
        throw new Error(error.message)

    }

}
const sendingSingupReq = async (hotel_id,socket)=>{
     try {
                    let orders;
                    const exists = await redisClient.exists(`hotel:${hotel_id}:orders`);
                    if (exists) {
                        const value = await redisClient.get(`hotel:${hotel_id}:orders`);
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
                
            } catch (error) {
                console.log(error)
            }
}

const createSocketOrder = async (data, socket) => {
    try {
        const { order, orderDetails = [], hotelUserId, tag, device_name, action, tax_details = [] } = data
        const { order_type, payment, payment_type, status, deleted ,version } = order

        console.log(data, "Data::::")
        const parseOrder = (order) => ({
            ...order, hotel_id: parseInt(order.hotel_id), id: parseInt(order.id), gst: parseFloat(order.gst), totalAmount: parseFloat(order.totalAmount), TableId: +order.TableId, card: +order.card, cash: +order.cash, due: +order.due, grandAmount: +order.grandAmount, total_cgst: +order.total_cgst, totalDiscount: +order.totalDiscount, total_sgst: +order.total_sgst, upi: +order.upi, service_charge: (+order?.service_charge || 0).toFixed(2)
        })
        const { id, gst, hotel_id, totalAmount, card, cash, due, discount_type, discount_value, grandAmount, total_cgst, totalDiscount, total_sgst, upi, service_charge, TableId: parsedTableId } = parseOrder(order)
        // console.log(discount_type, "Discount Type:")
        // createLogFile(hotel_id, "socketohk create coming Data", JSON.stringify({ order, orderDetails, hotelUserId, tag }))
        let TableId = parsedTableId


        // console.log(TableId, "TableId:::")
        const hotel = await Hotel.findByPk(+hotel_id, { include: { model: RestaurantSetting, attributes: ['timeZone', 'business_day_start_time'] } })
        const timeZone = hotel?.hms_res_setting?.timeZone || "Asia/Kolkata"
        const businessStartTime = hotel?.hms_res_setting?.business_day_start_time || "00:01:00"

        let table = {}
        let timeLine = []

        let user = null
        const { name, number, address, gstin } = order?.hms_user_master ? order.hms_user_master : { name: "", number: "", address: "", gstin: "" }
        // // console.log(name, number, gstin, address, "name number ")
        // const user = JSON.parse(JSON.stringify(await findAndUpdateUser({ name: name ? name : "", number: number ? number : "", gstin: gstin ? gstin : "", address: address ? address : "", hotel_id: +hotel_id })))
        // // console.log(user, "user-->")
        let token = 0
        let newOrderId = id
        if (hotel.is_token_on !== "3") {
            if (hotel.is_token_on === '2') {
                token = await generateToken(+hotel_id)
            }
            if (hotel.is_token_on === '1' && order_type === 'dinin' || hotel.is_token_on === '0' && order_type === 'pickup') {
                token = await generateToken(+hotel_id)
            }
        }
        // console.log(id, "id", typeof (id), "type", id ? true : false, "condition")
            if (!+id) {
                user = await User.create({
                    hotel_id: +hotel_id,
                    name: "",
                    number: "",
                    address: "",
                    gstin: "",
                    isPlaceholder: true
                });
                if (order_type === ORDER_TYPE.DININ) {
                    // console.log(acquireTableLock(TableId), "TableId:::")
                    // console.log(tableLocks, "tableloCk::")
                    if (!acquireTableLock(TableId)) {
                        releaseTableLock(TableId)
                        await socket.emit("create_order", mobileError("Table is currently in use", STATUSCODE.BAD_REQUEST));
                        return;
                    }
                    const [tableRunning, tableStatusCheck] = await Promise.all([
                        Order.findOne({ where: { TableId, deleted: false, payment: "pending", hotel_id } }),
                        Table.findOne({ where: { id: TableId } })
                    ]);
                    // console.log(tableStatusCheck, "Check Status::")
                    if (tableRunning || tableStatusCheck.table_status !== 'F') {
                        releaseTableLock(TableId)
                        sendingSingupReq(hotel_id,socket)
                        await socket.emit("create_order", mobileError("This Table is Already running", STATUSCODE.BAD_REQUEST))
                        return
                    }
                    const tableStatus = status === "hold" ? "H" : status === ORDER_TYPE.IN_PROGRESS ? "R" : (status === ORDER_TYPE.SUCCESS) && (payment === ORDER_TYPE.SUCCESS) ? "F" : "P"
                    await Table.update({ table_status: tableStatus }, { where: { id: TableId } })

                    await updateTableToRadis(TableId, hotel_id)

                }


                const bill_no = await getNextBillNo(hotel_id);
                console.log(bill_no, "Bill No:::::::::")

                const business_date = getBusinessDate(timeZone, businessStartTime)
                const orderCreate = await Order.create({ business_date, created_from: "mobile", discount_type: discount_type ? discount_type : "fix", discount_value, hotelUserId: +hotelUserId, token, bill_no: bill_no, gst, totalAmount, TableId: TableId ? TableId : null, card, cash, due, grandAmount, service_charge, UserId: user.id, order_type, payment, payment_type, status, total_cgst, totalDiscount, total_sgst, upi, hotel_id: +hotel_id })
                user = await findAndUpdateUser(
                    {
                        name: name ?? "",
                        number: number ?? "",
                        gstin: gstin ?? "",
                        address: address ?? "",
                        hotel_id: +hotel_id
                    },
                    orderCreate.id
                );
                await addOrderTax(tax_details, orderCreate.id, hotel_id)
                newOrderId = orderCreate.id

                if (status === ORDER_TYPE.IN_PROGRESS) {
                    await kot(id, newOrderId, orderDetails, hotel_id, TableId)
                    await sendKotToAllKdsClient(newOrderId, hotel_id, true)
                    await newOrderAppendToRadis(newOrderId, hotel_id)
                } else if (status === STATUS.SUCCESS) {

                    await completedOrder(id, newOrderId, orderDetails, hotel_id, TableId)
                    await orderCompletedSendtoKdsCLient(hotel_id, newOrderId)
                    if (order_type === "dinin") {
                        await newOrderAppendToRadis(newOrderId, hotel_id)
                    }
                } else {

                    const detailsToCreate = []
                    for (const cur of orderDetails) {
                        const addons = cur.addons
                        let menuId = cur.MenuId
                        if (!cur?.hms_menu_mst?.active) {
                            const { price, item_name } = cur?.hms_menu_mst
                            const menu = await Menu.create({ price, item_name, active: false, hotel_id })
                            menuId = menu.id
                        }
                        detailsToCreate.push({
                            MenuId: menuId,
                            qty: +cur.qty,
                            price: +cur.price,
                            kotNumber: 0,
                            order_type: cur?.order_type,
                            UserId: user?.id,
                            comment: cur?.comment,
                            TableId: +TableId,
                            payment_status: cur.payment_status,
                            hotel_id: +hotel_id,
                            orderId: orderCreate.id,
                            status: ORDER_DETAILS_TYPE.IN_PROGRESS,
                            addons: addons.length ? getAddonsFromMobileData(addons) : [],
                            variant_id: cur?.variant_id ? +cur.variant_id : null,
                            variant_name: cur?.variant_name ? cur.variant_name : null,
                            totalDiscount: 0
                        })
                    }
                    await OrderDetails.bulkCreate(detailsToCreate)
                    await newOrderAppendToRadis(newOrderId, hotel_id)
                }
                // setImmediate(() => {


                releaseTableLock(TableId)
                // });
                // log(+hotel_id, io, orderCreate.id, "hotelId, io, orderId")
            }
        else {
            user = await findAndUpdateUser(
                {
                    name: name ?? "",
                    number: number ?? "",
                    gstin: gstin ?? "",
                    address: address ?? "",
                    hotel_id: +hotel_id
                },
                id // ✅ pass orderId ONLY for updates
            );
            const findOrder = await Order.findOne({ where: { id: newOrderId, hotel_id , ...(order_type === "dinin" && { TableId }),} })
             if (!findOrder) {
                sendingSingupReq(hotel_id,socket)
                await socket.emit("create_order", mobileError("Order not found Please refresh it", STATUSCODE.BAD_REQUEST));
                return;
            }
            console.log(findOrder.version , Number(version),"version Check::")
            if(findOrder.version !== Number(version)){
                sendingSingupReq(hotel_id,socket)
                await socket.emit("create_order", mobileError("Order Version Not Match", STATUSCODE.BAD_REQUEST));
                return;
            }    
           
            if(findOrder && findOrder.payment==="success" && findOrder.status==="success" && tag !=="updateOrder"){
                  await socket.emit("create_order", mobileError("This Order is Already Settled", STATUSCODE.BAD_REQUEST));
                return;
            }
            const isCompleted = findOrder.status === ORDER_TYPE.SUCCESS && findOrder.payment === ORDER_TYPE.SUCCESS
            if (isCompleted && tag !== "updateOrder") {
                await socket.emit("create_order", mobileError("Completed order cannot be updated", STATUSCODE.BAD_REQUEST));
                return;
            }
            if (order_type === ORDER_TYPE.DININ && tag !== "updateOrder") {
                const tableStatus = (status === "hold") && (deleted === false) ? "H" : status === ORDER_TYPE.IN_PROGRESS ? "R" : (status === ORDER_TYPE.SUCCESS) && (payment === ORDER_TYPE.SUCCESS) ? "F" : "P"
                await Table.update({ table_status: tableStatus }, { where: { id: TableId } })

                await updateTableToRadis(TableId, hotel_id)

            }
            await Order.update({ deleted, totalDiscount, discount_type: discount_type ? discount_type : "fix", discount_value, UserId: user.id, totalAmount, due, cash, card, upi, status, payment, grandAmount, service_charge, gst }, { where: { id: newOrderId, hotel_id }, individualHooks: true })
            await updateOrderTax(tax_details, id, hotel_id)
            if (status === ORDER_TYPE.IN_PROGRESS && tag === 'kot') {
                await kot(+id, newOrderId, orderDetails, hotel_id, TableId)
                await otherkot(id, hotel_id)
            } else if (status === ORDER_TYPE.IN_PROGRESS && tag === 'removekot') {
                // const getorderDetails = await OrderDetails.findAll({ hotel_id, orderId: newOrderId })
                //! New Code
                // const existingOrderDetails = await OrderDetails.findAll({
                //     where: { hotel_id, orderId: newOrderId }
                // });

                // Convert existing DB items to a map
                // const existingMap = new Map();
                // for (const item of existingOrderDetails) {
                //     const key = `${item.MenuId}_${item.variant_id || 0}_${item.kotNumber || 0}`;
                //     existingMap.set(key, item);
                // }
                // Convert updated orderDetails to a map
                // const updatedMap = new Map();
                // for (const item of orderDetails) {
                //     const key = `${item.MenuId}_${item.variant_id || 0}_${item.kotNumber || 0}`;
                //     updatedMap.set(key, item);
                // }

                // for (const [key, existingItem] of existingMap.entries()) {
                //     const updatedItem = updatedMap.get(key);
                //     if (!updatedItem || +updatedItem.qty === 0) {
                //         actionHere = "decriseKot"
                //         detailId = existingItem.id
                //         await removeKotItemFromKds(newOrderId, hotel_id, existingItem.kotNumber, existingItem.id)
                //     } else if (+updatedItem.qty < +existingItem.qty) {
                //         detailId = existingItem.id
                //         await descriseKotQtyItemFromKDS(newOrderId, hotel_id, existingItem.kotNumber, existingItem.id)
                //     }
                // }
                // await OrderDetails.destroy({ where: { hotel_id, orderId: newOrderId } })
                let actionHere = "removekot"
                let detailId = 0
                for (const cur of orderDetails) {
                    // console.log("QTY::::", +cur.qty > 0, cur.qty)
                    if (+cur.qty > 0) {
                        const findExsitingOrderDetails = await OrderDetails.findOne({ where: { orderId: newOrderId, hotel_id: hotel_id, MenuId: cur.MenuId, variant_id: cur?.variant_id ? cur.variant_id : null, kotNumber: cur.kotNumber, status: cur.status, price: cur.price, TableId: cur.TableId ? cur.TableId : null, order_type: cur.order_type } })
                        // console.log("findExsitingOrderDetails::", findExsitingOrderDetails)
                        if (findExsitingOrderDetails) {
                            actionHere = "decriseKot"
                            detailId = findExsitingOrderDetails.id
                            await descriseKotQtyItemFromKDS(newOrderId, hotel_id, findExsitingOrderDetails.kotNumber, findExsitingOrderDetails.id)

                            await OrderDetails.update({ qty: cur.qty, price: cur.price }, { where: { id: findExsitingOrderDetails.id } })
                        }


                    } else {
                        const findExsitingOrderDetails = await OrderDetails.findOne({ where: { orderId: newOrderId, hotel_id: hotel_id, MenuId: cur.MenuId, variant_id: cur?.variant_id ? cur.variant_id : null, kotNumber: cur.kotNumber, price: cur.price, TableId: cur.TableId ? cur.TableId : null, order_type: cur.order_type } })
                        if (findExsitingOrderDetails) {


                            detailId = findExsitingOrderDetails.id
                            await removeKotItemFromKds(newOrderId, hotel_id, findExsitingOrderDetails.kotNumber, findExsitingOrderDetails.id)

                            await OrderDetails.destroy({ where: { id: findExsitingOrderDetails.id } })
                        }
                    }

                }
                timeLine = await addToTimeLineRemoveKotMobile(newOrderId, action || tag, "create order", device_name || "", hotelUserId, detailId, actionHere)
            } else if (status === ORDER_TYPE.SUCCESS && tag === "updateOrder") {
                await updateOrdeer({
                    id,
                    orderDetails,
                    order_type,
                    totalAmount,
                    grandAmount,
                    gst,
                    totalDiscount,
                    discount_type,
                    discount_value,
                    service_charge,
                    tax_details,
                    cash,
                    card,
                    upi,
                    due,
                    payment,
                    payment_type,
                    status,
                    name,
                    number,
                    gstin,
                    address,
                    hotel_id,
                })
            }
            else if (tag === 'holdFree') {
                await Table.update({ table_status: "F" }, { where: { id: TableId } })
                await Order.update({ deleted: true }, { where: { id: newOrderId, hotel_id } })
                // setImmediate(() => {
                await updateTableToRadis(TableId, hotel_id)
                await deleteOrderToRedis(newOrderId, hotel_id)

                // });

            } else if (tag === "sattleOrder") {
                const data = await OrderDetails.update({ status: ORDER_DETAILS_TYPE.DELIVERED, payment_status: STATUS.SUCCESS }, { where: { orderId: +newOrderId, hotel_id: +hotel_id } })
                await deleteOrderToRedis(newOrderId, hotel_id)
                const data1 = await checkRawMaterialAvailableOrNot(id, hotel_id, hotelUserId)
                if (data1.error) {

                    throw new Error("Error From Stock Update")
                }
            }
            else if (status === ORDER_TYPE.SUCCESS) {
                const business_date = getBusinessDate(timeZone, businessStartTime)
                await Order.update({ createdAt: new Date(), business_date }, { where: { id: newOrderId } })
                await completedOrder(+id, newOrderId, orderDetails, hotel_id)
                if (order_type === "pickup") {

                    await deleteOrderToRedis(newOrderId, hotel_id)

                }
                await orderCompletedSendtoKdsCLient(hotel_id, newOrderId)
            }
            else {
                await OrderDetails.destroy({ where: { orderId: +newOrderId, hotel_id, status: ORDER_DETAILS_TYPE.IN_PROGRESS } })
                for (const cur of orderDetails) {
                    if (cur.status === "kot") {

                    } else {

                        log("Status:::::::", cur.status)

                        if (!+cur.qty) {
                            return res.mobileError(MESSAGE.QTY_MUST_BE_GREATER_THAN_ZERO, STATUSCODE.VALIDATION_ERROR)
                        }

                        let condition = { orderId: id, MenuId: +cur.MenuId, price: cur.price, hotel_id, status: { [Op.eq]: ORDER_DETAILS_TYPE.IN_PROGRESS } }

                        if (cur.variant_id) {
                            condition = { orderId: id, variant_id: cur.variant_id, MenuId: +cur.MenuId, status: { [Op.eq]: ORDER_DETAILS_TYPE.IN_PROGRESS }, price: cur.price, hotel_id }
                        }
                        const OrderDetailsAvailable = await OrderDetails.findOne({ where: { ...condition } })
                        let result = false
                        let addons = []
                        if (cur?.addons?.length) {
                            addons = cur.addons
                        }
                        if (OrderDetailsAvailable) {
                            if (addons?.length) {
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
                            await OrderDetails.update({ totalDiscount: cur.discount, qty: +cur.qty + OrderDetailsAvailable.qty }, { where: { id: OrderDetailsAvailable.id, orderId: +newOrderId, hotel_id: hotel_id } })
                        }
                        else {
                            let modifiedCartForOrderDetails = { MenuId: "", hotel_id: "", qty: "", orderId: "" };
                            modifiedCartForOrderDetails.MenuId = cur.MenuId
                            if (!cur?.hms_menu_mst?.active) {
                                const { price, item_name } = cur?.hms_menu_mst
                                const menu = await Menu.create({ price, item_name, active: false, hotel_id })
                                modifiedCartForOrderDetails.MenuId = menu.id
                            }
                            modifiedCartForOrderDetails.qty = cur.qty
                            modifiedCartForOrderDetails.price = +cur.price
                            modifiedCartForOrderDetails.kotNumber = +cur.kotNumber
                            modifiedCartForOrderDetails.order_type = cur.order_type
                            modifiedCartForOrderDetails.comment = cur?.comment
                            modifiedCartForOrderDetails.payment_status = cur.payment_status
                            modifiedCartForOrderDetails.hotel_id = hotel_id
                            modifiedCartForOrderDetails.orderId = +newOrderId
                            modifiedCartForOrderDetails.status = ORDER_DETAILS_TYPE.IN_PROGRESS
                            modifiedCartForOrderDetails.TableId = +cur.TableId ? +cur.TableId : null
                            modifiedCartForOrderDetails.addons = cur?.addons?.length?getAddonsFromMobileData(cur.addons):[]
                            modifiedCartForOrderDetails.variant_id = cur?.variant_id ? cur.variant_id : null
                            modifiedCartForOrderDetails.variant_name = cur?.variant_name ? cur.variant_name : null
                            await OrderDetails.create(modifiedCartForOrderDetails)
                        }
                    }
                }
            }
            await updateOrderAppendToRadis(newOrderId, hotel_id)
        }

        const [orderUpdated, orderDetailsUpdated, updatedTable] = await Promise.all([
            Order.findByPk(+newOrderId, { include: [{ model: User }, { model: OrderTax, include: { model: TaxType } }] }),
            OrderDetails.findAll({
                where: { hotel_id: +hotel_id, orderId: +newOrderId },
                include: [
                    {
                        model: Menu
                    },
                    {
                        model: Order,
                        as: "order",
                        where: { hotel_id: +hotel_id, id: newOrderId },
                        required: true,
                        attributes: [],
                    },
                ],
                attributes: [
                    "id",
                    "qty",
                    "order_type",
                    "comment",
                    "price",
                    "kotNumber",
                    "totalDiscount",
                    "status",
                    "payment_status",
                    "createdAt",
                    "updatedAt",
                    "UserId",
                    "TableId",
                    "MenuId",
                    "variant_id",
                    "orderId",
                    "hotel_id",
                    "variant_name",
                    "addons"
                ],


            }),
            (order_type === ORDER_TYPE.DININ && TableId) ? Table.findByPk(TableId) : Promise.resolve(null)
        ]);
        if (updatedTable) {
            table = JSON.parse(JSON.stringify(updatedTable))
        }

        // log(JSON.parse(JSON.stringify(orderUpdated)),
        //     JSON.parse(JSON.stringify(orderDetailsUpdated)), hotelUserId, "Updaed"
        // )

        // createLogFile(hotel_id, "socket create given Data", JSON.stringify({ tag, order: orderUpdated, orderDetails: orderDetailsUpdated, hotelUserId, oldOrderId: order.id, table }))
        if (tag !== "removekot") {
            timeLine = await addToTimeLineMobile(orderUpdated.id, action || tag, "create order", device_name || "", hotelUserId)
        }
        console.log(JSON.stringify(orderUpdated), "orderUpdated")

        await io.to(+hotel_id).emit("create_order", mobileSuccess("success", { tag, timeLine, action, order: orderUpdated, orderDetails: orderDetailsUpdated, hotelUserId, oldOrderId: order.id, table }, "New Order And Orderdetails", STATUSCODE.SUCCESS))

        await updatedPosData(io, hotel_id)
        return
    } catch (err) {
        console.log(err)
        // createLogFile("Create_Order", "socket create Error", JSON.stringify(err))
        // releaseTableLock()
        tableLocks = new Map()
        socket.emit(mobileError(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
        return
    }
}


// const prepareIncomingOrderData = async (data) => {
//     const { order, hotelUserId ,action } = data;
//     const parsedOrder = parseOrder(order);

//     const hotel = await Hotel.findByPk(+parsedOrder.hotel_id);
//     const { name, number, address, gstin } = order?.hms_user_master ?? {};
//     const user = await findAndUpdateUser({
//         name: name || "", number: number || "", address: address || "",
//         gstin: gstin || "", hotel_id: +parsedOrder.hotel_id
//     });

//     const TableId = await resolveTableId(parsedOrder, hotel);
//     const token = await generateTokenIfNeeded(hotel, parsedOrder.order_type);

//     return { order: parsedOrder, hotelUserId, hotel, user, TableId, token,action };
// };

// const parseOrder = (order) => ({
//     ...order,
//     hotel_id: +order.hotel_id, id: +order.id, gst: +order.gst,
//     totalAmount: +order.totalAmount, TableId: +order.TableId, card: +order.card,
//     cash: +order.cash, due: +order.due, grandAmount: +order.grandAmount,
//     total_cgst: +order.total_cgst, totalDiscount: +order.totalDiscount,
//     total_sgst: +order.total_sgst, upi: +order.upi,
// });

// const resolveTableId = async (order, hotel) => {
//     if (order.order_type !== ORDER_TYPE.DININ || +order.id) return order.TableId;

//     const existingOrder = await Order.findOne({
//         where: { TableId: order.TableId, deleted: false, payment: "pending", hotel_id: order.hotel_id }
//     });

//     if (!existingOrder) return order.TableId;

//     const table = await Table.findByPk(order.TableId);
//     const altTable = await Table.findOne({
//         where: { table_name: `${table.table_name}(1)`, hotel_id: table.hotel_id, type: table.type, table_catag_id: table.table_catag_id }
//     });

//     if (!altTable) {
//         const newTable = await Table.create({
//             table_name: `${table.table_name}(1)`, hotel_id: table.hotel_id,
//             table_catag_id: table.table_catag_id, type: table.type
//         });
//         return newTable.id;
//     } else {
//         await Table.update({ active: true }, { where: { id: altTable.id } });
//         return altTable.id;
//     }
// };

// const generateTokenIfNeeded = async (hotel, orderType) => {
//     if (hotel.is_token_on === "3") return 0;
//     if (hotel.is_token_on === "2") return await generateToken(hotel.id);
//     if (hotel.is_token_on === "1" && orderType === "dinin") return await generateToken(hotel.id);
//     if (hotel.is_token_on === "0" && orderType === "pickup") return await generateToken(hotel.id);
//     return 0;
// };

// const handleNewOrder = async ({ parsed, data, TableId }) => {
//     const { hotel, user, order } = parsed;
//     const { orderDetails, hotelUserId, status } = data;

//     const tableStatus = getTableStatus(status, order.payment);
//     if (order.order_type === ORDER_TYPE.DININ) {
//         await Table.update({ table_status: tableStatus }, { where: { id: TableId } });
//     }

//     const bill_no = await getNextBillNo(hotel.id);
//     const createdOrder = await Order.create({
//         created_from: "mobile", token: parsed.token, bill_no, hotelUserId: +hotelUserId,
//         gst: order.gst, totalAmount: order.totalAmount, TableId, card: order.card, cash: order.cash,
//         due: order.due, grandAmount: order.grandAmount, UserId: user.id,
//         order_type: order.order_type, payment: order.payment, payment_type: order.payment_type,
//         status: order.status, total_cgst: order.total_cgst, totalDiscount: order.totalDiscount,
//         total_sgst: order.total_sgst, upi: order.upi, hotel_id: hotel.id
//     });

//     if (status === ORDER_TYPE.IN_PROGRESS) {
//         await kot(order.id, createdOrder.id, orderDetails, hotel.id, TableId);
//     } else if (status === STATUS.SUCCESS) {
//         await completedOrder(order.id, createdOrder.id, orderDetails, hotel.id, TableId);
//     } else {
//         await bulkInsertOrderDetails(orderDetails, createdOrder.id, user.id, hotel.id, TableId);
//     }

//     return createdOrder.id;
// };

// const handleExistingOrder = async ({ parsed, data, newOrderId, TableId }) => {
//     const { order, hotel, user } = parsed;
//     const { orderDetails, tag, status } = data;

//     const tableStatus = getTableStatus(status, order.payment);
//     if (order.order_type === ORDER_TYPE.DININ) {
//         await Table.update({ table_status: tableStatus }, { where: { id: TableId } });
//     }

//     await Order.update({
//         deleted: order.deleted, totalDiscount: order.totalDiscount,
//         UserId: user.id, totalAmount: order.totalAmount, due: order.due,
//         cash: order.cash, card: order.card, upi: order.upi,
//         status: order.status, payment: order.payment, grandAmount: order.grandAmount,
//         gst: order.gst
//     }, { where: { id: newOrderId, hotel_id: hotel.id } });

//     switch (tag) {
//         case 'kot':
//             return await kot(order.id, newOrderId, orderDetails, hotel.id);
//         case 'removekot':
//             return await removeKot(orderDetails, newOrderId, hotel.id);
//         case 'holdFree':
//             await Table.update({ table_status: "F" }, { where: { id: TableId } });
//             return await Order.update({ deleted: true }, { where: { id: newOrderId, hotel_id: hotel.id } });
//         case 'sattleOrder':
//             return await OrderDetails.update({ status: ORDER_DETAILS_TYPE.DELIVERED, payment_status: STATUS.SUCCESS }, { where: { orderId: newOrderId, hotel_id: hotel.id } });
//         case undefined:
//         default:
//             if (status === ORDER_TYPE.SUCCESS) {
//                 return await completedOrder(order.id, newOrderId, orderDetails, hotel.id);
//             } else {
//                 return await updateInProgressOrderDetails(orderDetails, newOrderId, hotel.id, TableId);
//             }
//     }
// };

// const getTableStatus = (status, payment) => {
//     if (status === "hold") return "H";
//     if (status === ORDER_TYPE.IN_PROGRESS) return "R";
//     if (status === ORDER_TYPE.SUCCESS && payment === ORDER_TYPE.SUCCESS) return "F";
//     return "P";
// };

// const getNextBillNo = async (hotel_id) => {
//     const orders = await Order.findAll({ where: { hotel_id, isOffline: false, deleted: false }, attributes: ['bill_no'] });
//     return orders.reduce((max, o) => Math.max(max, parseInt(o.bill_no, 10)), 0) + 1;
// };

// const bulkInsertOrderDetails = async (orderDetails, orderId, userId, hotel_id, TableId) => {
//     for (const cur of orderDetails) {
//         await OrderDetails.create({
//             MenuId: +cur.MenuId,
//             qty: +cur.qty,
//             price: +cur.price,
//             kotNumber: 0,
//             order_type: cur?.order_type,
//             UserId: userId,
//             comment: cur?.comment,
//             TableId: +TableId,
//             payment_status: cur.payment_status,
//             hotel_id,
//             orderId,
//             status: ORDER_DETAILS_TYPE.IN_PROGRESS,
//             addons: cur.addons || [],
//             variant_id: cur?.variant_id ?? null,
//             variant_name: cur?.variant_name ?? ""
//         });
//     }
// };
// const createSocketOrder = async (data, socket) => {
//     try {

//         const parsed = await prepareIncomingOrderData(data);
//         const { order, hotel, user, TableId, token } = parsed;

//         let newOrderId = order.id;
//         if (!+order.id) {
//             newOrderId = await handleNewOrder({ parsed, data, TableId });
//         } else {
//             await handleExistingOrder({ parsed, data, newOrderId, TableId });
//         }
//         const timeLine = await addToTimeLineMobile(newOrderId, action || tag, "create order", device_name || "")
//                 await io.to(+hotel_id).emit("create_order", mobileSuccess("success", { tag, timeLine, action, order: orderUpdated, orderDetails: orderDetailsUpdated, hotelUserId, oldOrderId: order.id, table }, "New Order And Orderdetails", STATUSCODE.SUCCESS))
//                 await updatedPosData(io, hotel_id)

//     } catch (err) {
//         console.error("Error in createSocketOrder", err);
//     }
// };



module.exports = { createSocketOrder, updateSocketOrder, webChange, gettingHeaderFooter, getMobileTables, gettingMobileAllOrders, gettingMobileMenu }