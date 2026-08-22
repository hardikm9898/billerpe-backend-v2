// const name = require("../../server");
const Order = require("../../model/order")
const Item = require("../../model/menu")
const Cart = require("../../model/cart")
const sequelize = require("../../connection/connect")
const { Op, where } = require("sequelize")
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
const path = require("path")
const fs = require("fs")

const puppeteer = require("puppeteer")
const { createLogFile } = require("../../logs/log")
const InvoiceFormate = require("../../model/invoiceFormate")
const PrinterSetting = require("../../model/printer_setting")

const { generateKotPdf, arranPrintersForKotWithTheseItems, sentEbill } = require('../../controller/kto')
const { type } = require("os")
const Variants = require("../../model/variants")
const EBillCredit = require("../../model/ebillCredit")
const EBillCreditDebit = require("../../model/ebillCreditDebit")
const Hashids = require('hashids/cjs');
const PromoCode = require("../../model/promoCode")
const { findAndUpdateUser } = require("../user")
const salt = "hellothisisdemoId"
const { getBusinessDate } = require("../../utils/dateUtils")
const RestaurantSetting = require("../../model/restaurantSetting")

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
function getAddonsFromAddonDepartment(addonDepartmentData) {
    let addons = [];
    if (addonDepartmentData?.length) {
        for (const department of addonDepartmentData) {
            if (department.type === 1 && department.addonsQty > 0) {
                const existingDepartmentIndex = addons.findIndex(el => el.id == department.department_id);
                // If department exists, push the addon into hms_addon_msts
                if (existingDepartmentIndex > -1) {
                    const {
                        id, price, hotel_id, createdAt, updatedAt,
                        addon_name, attributes, department_id, addonsQty
                    } = department;

                    const hms_addon_msts = {
                        qty: addonsQty,
                        id,
                        price,
                        hotel_id,
                        createdAt,
                        updatedAt,
                        addon_name,
                        attributes,
                        department_id,
                    };
                    addons[existingDepartmentIndex].hms_addon_msts.push(hms_addon_msts);
                } else {
                    // Find parent department (type === 0)
                    const findDepartment = addonDepartmentData.find(el => el.type === 0 && el.id === department.department_id);

                    if (findDepartment) {
                        // Initialize hms_addon_msts array
                        findDepartment.hms_addon_msts = [];

                        // Push the parent department to addons
                        addons.push(findDepartment);

                        // Add the addon into hms_addon_msts
                        const {
                            id, price, hotel_id, createdAt, updatedAt,
                            addon_name, attributes, department_id, addonsQty
                        } = department;

                        const hms_addon_msts = {
                            qty: addonsQty,
                            id,
                            price,
                            hotel_id,
                            createdAt,
                            updatedAt,
                            addon_name,
                            attributes,
                            department_id,
                        };

                        // Update hms_addon_msts for the department
                        addons[addons.length - 1].hms_addon_msts.push(hms_addon_msts);
                    }
                }
            }
        }
    }

    // Filter out departments with no hms_addon_msts
    return addons.filter(department => department.hms_addon_msts.length > 0);
}
const updatedPosData = async (io, hotel_id) => {
    await io.to(hotel_id).emit("updated", { data: true })
}
// const generateKotPdf = async (data) => {

//     let browser
//     if (data.origin != "http://localhost:3000") {
//         browser = await puppeteer.launch({
//             executablePath: "/usr/bin/google-chrome-stable",
//             args: ['--no-sandbox'], headless: true
//         });
//     } else {
//         browser = await puppeteer.launch();   // ! local
//     }
//     const page = await browser.newPage();

//     const htmlContent = `
//         <!DOCTYPE html>
//         <html lang="en">

//             <style>
//             body{
//                 margin:0px;
//                 padding:0px;
//             }
//             @import url('https://fonts.cdnfonts.com/css/verdana');
//             @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+Gujarati:wght@100..900&display=swap');
//             .invoice {
// width:${data.printerSize == "S" ? "182px" : "270px"};
//       font-family: 'Verdana', sans-serif;
//     }
//     .invoice p {
//       margin-bottom: 5px;
//       margin-top: 0;
//       font-weight: 400;
//       font-size: 13px;
//     }
//     .invoice strong {
//       margin-bottom: 5px;
//       margin-top: 0;
//       font-weight: 600;
//       font-size: 14px;
//       letter-spacing: 0.5px;
//     }
//     .invoice-header {
//       text-align: center;
//       border-bottom: 2px dashed #000;
//     }
//     .hotel-name {
//       margin-bottom: 5px;
//       margin-top: 0;
//       font-weight: 600 !important; 
//       font-size: 14px !important; 
//     }
//     .custom-table-header {
//       display: flex;
//       gap: 35%;
//       margin-top: 5px;
//       border-bottom: 2px dashed #000;
//     }
//     .invoice-items tr {
//       border: none;
//     }

//     .invoice-items {
//       width: 100%;
//       border-collapse: collapse;
//       margin-top: 5px;
//     }


//     .invoice-items th,
//     .invoice-items td {
//     font-family: "Noto Sans Gujarati", sans-serif;
//         vertical-align: top;
//       padding: 1px;
//       text-align: right;
//       border: none;
//       color: #000;
//       font-size: 14px;
//       font-weight: 400;
//     }
//     .invoice-items td:first-child,.invoice-items th:first-child{
//         text-align: left;
//     }

//     .invoice-items th:nth-child(3){
//       width: 55%;
//     }

//     .invoice-items th {
//       font-size: 14px !important;
//       font-weight: 400;
//     }

//         </style>
//             <body>

//                 <div class="invoice">
//                     <div class="invoice-header">
//                         <p class="hotel-name">${data.restaurantName}</p>
//                         <p>${data.timeAndDate}</p>
//                         <p>KOT - ${data.order_id}</p>
//                         <p><strong>${data.order_type}</strong></p>
//                         <p><strong>${data.userOrTableNo}</strong></p>
//                     </div>

//                     <div class="custom-table-header">
//                         <p>Biller : biller</p>
//                     </div>

//                     <table class="invoice-items">
//                         <thead>
//                             <tr>

//                             <th>Item</th>
//                                 <th>Qty.</th>
//                                 <th>Special Note</th>
//                             </tr>
//                         </thead>
//                         <tbody>

//                          ${data.items.map((item, index) => `
//                                 <tr>
//                                 <td><strong>${item.item_name}</strong> ${item.sub_categories == "regular" ? "" : `(${item.sub_categories})`}</td>
//                                     <td>${item.qty}</td>
//                                     <td>${item.comment ? item.comment : "--"}</td>
//                                 </tr>
//                             `).join('')}

//                         </tbody>
//                     </table>
//                 </div>

//             </body>
//         </html>
//         `;

//     await page.setContent(htmlContent, { waitUntil: 'networkidle0' });
//     const buffer = await page.pdf({ format: 'A4' });
//     setTimeout(() => {
//         browser.close()
//     }, 1000)
//     return buffer
// }
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
const mobileKotOrder = async (req, res) => {

    try {
        // await io.to(req.user).emit("available", { valiblae: "kskd" })
        // ! for react app 
        const { cart, order_type = "dinin", order_id, dashBoardCalling, gstin = "", name = "", number = "", address = "" } = req.body
        // console.log(req.body.cart, "req.body===================================================>")
        // console.log(cart, "cart==========================>kot")
        const hotel = await Hotel.findByPk(req.user)
        if (!hotel) return res.json(mobileError(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.NOT_FOUND))        // let { userName, mobile } = req.body
        let printer
        if (dashBoardCalling) {
            printer = await PrinterSetting.findOne({ where: { hotel_id: req.user, print_type: 'K', } })
            if (!printer) {
                return res.json(mobileError("Printer Not Set", STATUSCODE.BAD_REQUEST))
            }

        }
        if (!order_type) {
            return res.json(mobileError(MESSAGE.PLEASE_SELECT_ORDER_TYPE, STATUSCODE.BAD_REQUEST))
        }
        if (!cart.items.length) {
            return res.json(mobileError(MESSAGE.CART_NOT_FOUND, STATUSCODE.NOT_FOUND))
        }

        let user = await findAndUpdateUser({ name, number, gstin, address, hotel_id: req.user })

        let table
        const cartData = cart.items
        const findWithoutOrderKotItem = cartData.find(el => el.status === ORDER_DETAILS_TYPE.IN_PROGRESS)
        if (!findWithoutOrderKotItem) return res.json(mobileError("NO New Cart Item Found", STATUSCODE.NOT_FOUND))
        if (+order_id) {

            const maxKotNumber = await OrderDetails.max('kotNumber', {
                where: {
                    orderId: order_id,
                    hotel_id: req.user
                },
                raw: true
            });

            if (!cartData.length) return res.json(mobileError(MESSAGE.CART_NOT_FOUND, STATUSCODE.NOT_FOUND))

            const modifiedCart = cart

            let gst = 0
            if (hotel.invoiceFormateIncGst) {
                gst = modifiedCart.gst
            }
            else {
                gst = 0
            }
            const totalDiscount = modifiedCart.totalDiscount
            const order = await Order.update({ UserId: user.id, status: ORDER_TYPE.IN_PROGRESS, order_type, totalAmount: ((modifiedCart.totalBill - gst) + totalDiscount), gst, totalDiscount, grandAmount: Math.round(modifiedCart.totalBill) }, { where: { id: order_id, hotel_id: req.user, deleted: false } })

            const orderInformation = await Order.findOne({ where: { id: order_id, hotel_id: req.user, deleted: false } })
            // console.log(orderInformation, "order information===========>")
            await Table.update({ table_status: "R" }, { where: { id: orderInformation?.TableId, hotel_id: req.user, active: true } })

            await OrderDetails.destroy({ where: { orderId: order_id, hotel_id: req.user, status: ORDER_DETAILS_TYPE.IN_PROGRESS } }, { truncate: true })

            for (const cur of cartData) {
                if (!+cur.qty) {
                    return res.mobileError(MESSAGE.QTY_MUST_BE_GREATER_THAN_ZERO, STATUSCODE.VALIDATION_ERROR)
                }
                if (cur.status === "kot") {

                }
                else {

                    let condition = { orderId: order_id, MenuId: +cur.id, kotNumber: maxKotNumber + 1, hotel_id: req.user }
                    if (cur.variant_id) {
                        condition = { orderId: order_id, variant_id: cur.variant_id, MenuId: +cur.id, kotNumber: maxKotNumber + 1, hotel_id: req.user }
                    }

                    const orderDetailsAvailableHold = await OrderDetails.findOne({ where: { ...condition } })
                    let result = false
                    let addons = []
                    if (cur?.addonDepartmentData?.length) {
                        addons = getAddonsFromAddonDepartment(cur.addonDepartmentData)
                    }
                    if (orderDetailsAvailableHold) {
                        if (addons?.length) {

                            const data = matchDepartmentsAndAddonsById(orderDetailsAvailableHold.addons, addons)
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
                        await OrderDetails.update({ totalDiscount: cur.discount, qty: +cur.qty + orderDetailsAvailableHold.qty, price: +cur.price, order_type, status: ORDER_DETAILS_TYPE.KOT }, { where: { id: orderDetailsAvailableHold.id, hotel_id: req.user } })
                    } else {

                        let modifiedCartForOrderDetails = { MenuId: "", hotel_id: "", qty: "", orderId: "", totalDiscount: 0 };
                        modifiedCartForOrderDetails.MenuId = +cur.id
                        modifiedCartForOrderDetails.qty = cur.qty
                        modifiedCartForOrderDetails.price = cur.price
                        modifiedCartForOrderDetails.totalDiscount = cur.discount
                        modifiedCartForOrderDetails.kotNumber = maxKotNumber + 1
                        modifiedCartForOrderDetails.order_type = order_type
                        modifiedCartForOrderDetails.payment_status = STATUS.PENDING
                        modifiedCartForOrderDetails.TableId = orderInformation.TableId
                        modifiedCartForOrderDetails.hotel_id = cur.hotel_id
                        modifiedCartForOrderDetails.orderId = order_id
                        modifiedCartForOrderDetails.status = ORDER_DETAILS_TYPE.KOT
                        modifiedCartForOrderDetails.addons = addons.length ? addons : []
                        modifiedCartForOrderDetails.variant_id = cur.variant_id ? cur.variant_id : null
                        modifiedCartForOrderDetails.variant_name = cur.variant_name ? cur.variant_name : null

                        const orderDetails = await OrderDetails.create(modifiedCartForOrderDetails)
                    }
                }
            }
            // ! generate kot order OrderAvailable 
            // Extract year, month, and day from the current date
            const data = []
            if (dashBoardCalling) {


                const items = cart.items.filter(el => {
                    const addons = getAddonsFromAddonDepartment(el?.addonDepartmentData ? el.addonDepartmentData : [])
                    el.addon = addons
                    if (el.status !== "kot") {
                        return el
                    }
                })
                let userOrTableNo = order_type === "pickup" ? `User Name :${user?.name}` : `Table No:${req.body.tableNumber}`
                const timeAndDate = moment().format('DD/MM/YYYY, h:mm a');
                const type = order_type == "pickup" ? "Pick-Up" : "Dine In"
                const checkDefaultPrinterSetting = JSON.parse(JSON.stringify(await PrinterSetting.findAll({ where: { hotel_id: req.user, print_type: "K" } })));
                const printerWithThereItems = arranPrintersForKotWithTheseItems(checkDefaultPrinterSetting, items, order_type, table?.id)

                // if (checkDefaultPrinterSetting) {

                for (const element of printerWithThereItems) {
                    const itemDetails = {
                        items,
                        order_type: type,
                        order_id: order.id,
                        restaurantName: hotel.hotel_name,
                        userOrTableNo,
                        timeAndDate,
                        origin: req.headers.origin,
                        printerSize: element.printer.printer_size
                    }
                    const pdfBuffer = await generateKotPdf(itemDetails)
                    data.push({ printer: element.printer, pdf: pdfBuffer })
                }
            } else {

            }
            await io.to(hotel.id).emit("printKot", { pdfData: dashBoardCalling ? data : [], print: dashBoardCalling ? true : false, printer: printer })
            return res.json(mobileSuccess(STATUS.SUCCESS, { orderId: order_id, restaurantName: hotel.hotel_name }, MESSAGE.KOT_GENERATED, STATUSCODE.CREATED))
        }
        if (order_type === "dinin") {
            let { tableId } = req.body
            if (!tableId) return res.json(mobileError(MESSAGE.PLEASE_ADD_Table_IN_DININ, STATUSCODE.BAD_REQUEST))
            // req.body.hotel_id = req.user
            table = await Table.findOne({ where: { id: tableId, hotel_id: req.user, active: true } })
            if (!table) {
                return res.json(mobileError(MESSAGE.TABLE_NOT_AVAILABLE, STATUSCODE.BAD_REQUEST))
            }
            // const { userName, mobile } = req.body
            // // console.log(req.body, "from kot Order================================================================>")

            // console.log(table, "table===============>")
            const tableRunning = await Order.findOne({ where: { hotel_id: req.user, TableId: table?.id, deleted: false, payment: "pending" }, attributes: ["id"] })
            // console.log(tableRunning, "table runnning data")
            if (tableRunning) {
                return res.json(mobileError(MESSAGE.TABLE_RUNNING, STATUSCODE.BAD_REQUEST))
            }
            // console.log(table, "table================================================================>")
            await Table.update({ table_status: "R" }, { where: { id: table?.id, hotel_id: req.user, active: true } })
            // console.log(tableupdated, "table Upadtd============================================================================================>")
        }
        if (cartData) {
            const modifiedCart = cart
            let gst = 0
            if (hotel.invoiceFormateIncGst) {
                gst = modifiedCart.gst
            } else {
                gst = 0
            }
            const totalDiscount = modifiedCart.totalDiscount
            // console.log(modifiedCart, "from kot wihtout order===========>")
            const allOrderData = await Order.findAll({ where: { hotel_id: req.user, isOffline: false, deleted: false }, attributes: ['bill_no'] })

            const maxOnlineBillNo = allOrderData.reduce((max, invoice) => {
                const numericValue = parseInt(invoice.bill_no, 10);
                return numericValue > max ? numericValue : max;
            }, 0);
            
            const setting = await RestaurantSetting.findOne({ where: { hotel_id: req.user } });
            const timeZone = setting?.timeZone || 'Asia/Kolkata';
            const businessStartTime = setting?.business_day_start_time || '00:01:00';
            const business_date = getBusinessDate(timeZone, businessStartTime);

            const order = await Order.create({ business_date, hotelUserId: req.userId, created_from: "mobile", bill_no: `${maxOnlineBillNo + 1}`, hotel_id: req.user, TableId: table?.id, UserId: user?.id, totalDiscount, status: ORDER_TYPE.IN_PROGRESS, order_type, totalAmount: modifiedCart.totalBill - gst + totalDiscount, gst, grandAmount: Math.round(modifiedCart.totalBill) })
            // const modificationOrderDetails = []

            for (const cur of cartData) {
                let addons = []
                addons = getAddonsFromAddonDepartment(cur.addonDepartmentData)
                if (!+cur.qty) {
                    return res.mobileError(MESSAGE.QTY_MUST_BE_GREATER_THAN_ZERO, STATUSCODE.VALIDATION_ERROR)
                }
                let modifiedCartForOrderDetails = { MenuId: "", hotel_id: "", qty: "", orderId: "", totalDiscount: 0 };
                modifiedCartForOrderDetails.MenuId = +cur.id
                modifiedCartForOrderDetails.qty = cur.qty
                modifiedCartForOrderDetails.price = cur.price
                modifiedCartForOrderDetails.kotNumber = 1
                modifiedCartForOrderDetails.totalDiscount = cur.discount
                modifiedCartForOrderDetails.order_type = order_type
                modifiedCartForOrderDetails.UserId = user?.id
                modifiedCartForOrderDetails.TableId = table?.id
                modifiedCartForOrderDetails.payment_status = "pending",
                    modifiedCartForOrderDetails.hotel_id = cur.hotel_id
                modifiedCartForOrderDetails.orderId = order.id
                modifiedCartForOrderDetails.status = ORDER_DETAILS_TYPE.KOT
                modifiedCartForOrderDetails.addons = addons.length ? addons : []
                modifiedCartForOrderDetails.variant_id = cur?.variant_id ? cur.variant_id : null
                modifiedCartForOrderDetails.variant_name = cur?.variant_name ? cur.variant_name : null
                // modificationOrderDetails.push(modificationOrderDetails)
                await OrderDetails.create(modifiedCartForOrderDetails)

            }
            // await OrderDetails.bulkCreate(modificationOrderDetails)

            const data = []
            if (dashBoardCalling) {
                var room = io.sockets.adapter.rooms
                const items = cart.items.filter(el => {
                    const addons = getAddonsFromAddonDepartment(el?.addonDepartmentData ? el.addonDepartmentData : [])
                    el.addon = addons
                    if (el.status !== "kot") {
                        return el
                    }
                })

                let userOrTableNo = `Table No:${req.body.tableNumber}`
                const timeAndDate = moment().format('DD/MM/YYYY, h:mm a');
                const type = order_type == "pickup" ? "Pick-Up" : "Dine In"
                const checkDefaultPrinterSetting = JSON.parse(JSON.stringify(await PrinterSetting.findAll({ where: { hotel_id: req.user, print_type: "K" } })));
                const printerWithThereItems = arranPrintersForKotWithTheseItems(checkDefaultPrinterSetting, items, order_type, table?.id)

                for (const element of printerWithThereItems) {
                    const itemDetails = {
                        items,
                        order_type: type,
                        order_id: order.id,
                        restaurantName: hotel.hotel_name,
                        userOrTableNo,
                        timeAndDate,
                        origin: req.headers.origin,
                        printerSize: element.printer.printer_size
                    }
                    const pdfBuffer = await generateKotPdf(itemDetails)
                    data.push({ printer: element.printer, pdf: pdfBuffer })
                }
            }
            await io.to(hotel.id).emit("printKot", { pdfData: dashBoardCalling ? data : [], print: dashBoardCalling ? true : false, printer: printer })
            return res.json(mobileSuccess(MESSAGE.SUCCESS, { orderId: order.id, restaurantName: hotel.hotel_name }, MESSAGE.KOT_GENERATED, STATUSCODE.CREATED))
        }
        return res.json(mobileError(MESSAGE.CART_NOT_FOUND, STATUSCODE.NOT_FOUND))
    } catch (err) {
        console.log(err)
        //createLogFile(req.user, `mobileKotOrder MoBile /err Error`, err);
        return res.json(mobileError(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

const mobileHoldOrder = async (req, res) => {
    try {
        const { cart, order_type = "dinin", order_id, name = "", number = "", gstin = "", address = "" } = req.body
        // console.log(cart, req.body, req.user, "cart==========================>hold")
        const hotel = await Hotel.findOne({ where: { id: req.user } })
        if (!hotel) return res.json(mobileError(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.NOT_FOUND))
        if (!order_type) {
            return res.json(mobileError(MESSAGE.PLEASE_SELECT_ORDER_TYPE, STATUSCODE.BAD_REQUEST))
        }
        if (!cart.items.length) {
            return res.json(mobileError(MESSAGE.CART_NOT_FOUND, STATUSCODE.NOT_FOUND))
        }


        let table

        const cartData = cart.items
        let user = await findAndUpdateUser({ name, number, gstin, address, hotel_id: req.user })
        console.log(user, "User----from Hold>")
        if (+order_id) {
            if (!cartData.length) return res.json(mobileError(MESSAGE.CART_NOT_FOUND, STATUSCODE.NOT_FOUND))
            const modifiedCart = cart

            const gst = modifiedCart.gst
            const totalDiscount = modifiedCart.totalDiscount
            const order = await Order.update({ UserId: user.id, status: ORDER_TYPE.HOLD, order_type, totalDiscount, totalAmount: modifiedCart.totalBill - gst + totalDiscount, gst, grandAmount: Math.round(modifiedCart.totalBill) }, { where: { id: order_id, hotel_id: req.user, deleted: false } })
            const orderInformation = await Order.findOne({ where: { id: order_id, hotel_id: req.user, deleted: false } })
            await Table.update({ table_status: "H" }, { where: { id: orderInformation?.TableId, hotel_id: req.user, active: true } })

            await OrderDetails.destroy({ where: { orderId: order_id, status: ORDER_DETAILS_TYPE.IN_PROGRESS, hotel_id: req.user } }, { truncate: true })

            for (const cur of cartData) {
                // console.log(cur, "current Menu Items===>")
                if (cur.status === "kot") {

                }
                else {
                    if (!+cur.qty) {
                        return res.mobileError(MESSAGE.QTY_MUST_BE_GREATER_THAN_ZERO, STATUSCODE.VALIDATION_ERROR)
                    }
                    let condition = { orderId: order_id, MenuId: +cur.id, hotel_id: req.user, payment_status: STATUS.PENDING, status: { [Op.eq]: ORDER_DETAILS_TYPE.IN_PROGRESS } }
                    if (cur?.variant_id) {
                        condition = { orderId: order_id, MenuId: +cur.id, hotel_id: req.user, variant_id: cur.variant_id, payment_status: STATUS.PENDING, status: { [Op.eq]: ORDER_DETAILS_TYPE.IN_PROGRESS } }
                    }

                    // const menuData = await Menu.findOne({ where: { id: +cur.id, hotel_id: req.user } });
                    const OrderDetailsAvailable = await OrderDetails.findOne({ where: { ...condition } })
                    console.log(cur.addonDepartmentData, "Cur.addonDepartment---->")
                    let result = false
                    let addons = []
                    if (cur.addonDepartmentData.length) {
                        addons = getAddonsFromAddonDepartment(cur.addonDepartmentData)
                    }

                    console.log(addons, "addons--->")
                    console.log(condition, "condition--->")
                    console.log(OrderDetailsAvailable, "OverDetails Available ------>")

                    if (OrderDetailsAvailable) {
                        if (addons?.length) {
                            const data = matchDepartmentsAndAddonsById(OrderDetailsAvailable.addons, addons)
                            console.log(data, "addons Match ----->")
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
                        await OrderDetails.update({ totalDiscount: cur.discount, qty: +cur.qty + OrderDetailsAvailable.qty, price: +cur.price, order_type, status: ORDER_DETAILS_TYPE.HOLD }, { where: { id: OrderDetailsAvailable.id, hotel_id: req.user } })
                    }
                    else {
                        let modifiedCartForOrderDetails = { MenuId: "", hotel_id: "", qty: "", orderId: "", totalDiscount: 0 };
                        modifiedCartForOrderDetails.MenuId = +cur.id
                        modifiedCartForOrderDetails.qty = +cur.qty
                        modifiedCartForOrderDetails.price = +cur.price
                        modifiedCartForOrderDetails.totalDiscount = cur.discount
                        modifiedCartForOrderDetails.order_type = order_type
                        modifiedCartForOrderDetails.payment_status = STATUS.PENDING

                        modifiedCartForOrderDetails.hotel_id = cur.hotel_id
                        modifiedCartForOrderDetails.orderId = order_id
                        modifiedCartForOrderDetails.status = ORDER_DETAILS_TYPE.HOLD
                        modifiedCartForOrderDetails.TableId = orderInformation.TableId
                        modifiedCartForOrderDetails.addons = addons.length ? addons : []
                        modifiedCartForOrderDetails.variant_id = cur.variant_id ? cur.variant_id : null
                        modifiedCartForOrderDetails.variant_name = cur.variant_name ? cur.variant_name : null

                        const orderDetails = await OrderDetails.create(modifiedCartForOrderDetails)

                    }
                }

            }
            await updatedPosData(io, hotel.id)
            return res.json(mobileSuccess(MESSAGE.SUCCESS, { message: MESSAGE.ORDER_HOLD, orderId: order_id }, MESSAGE.ORDER_HOLD, STATUSCODE.CREATED))


        }



        let { tableId, tableNumber } = req.body
        // const table_number = tableNumber.split("-")[0]
        // const catagories_name = tableNumber.split("-")[1]

        // const table_catag_id = await TableCatagories.findOne({ where: { table_catag_nm: catagories_name, hotel_id: req.user, active: true } })
        table = await Table.findOne({ where: { id: tableId, hotel_id: req.user, active: true } })
        if (!table) {
            return res.json(mobileError(MESSAGE.TABLE_NOT_AVAILABLE, STATUSCODE.BAD_REQUEST))
        }
        const tableRunning = await Order.findOne({ where: { TableId: table?.id, status: { [Op.ne]: ORDER_TYPE.SUCCESS }, deleted: false, payment: "pending" } })
        console.log(tableRunning, "table runnning data")
        if (tableRunning) {
            return res.json(mobileError(MESSAGE.TABLE_RUNNING, STATUSCODE.BAD_REQUEST))
        }
        await Table.update({ table_status: "H" }, { where: { id: table?.id, hotel_id: req.user, active: true } })
        if (cartData) {
            // ! for postman testing 
            // const cartDelete = await AdminCart.destroy({ where: { hotel_id: req.user } })
            const modifiedCart = cart
            const gst = modifiedCart.gst
            const totalDiscount = modifiedCart.totalDiscount
            const allOrderData = await Order.findAll({ where: { hotel_id: req.user, isOffline: false } })

            const maxOnlineBillNo = allOrderData.reduce((max, invoice) => {
                const numericValue = parseInt(invoice.bill_no, 10);
                return numericValue > max ? numericValue : max;
            }, 0);

            const setting = await RestaurantSetting.findOne({ where: { hotel_id: req.user } });
            const timeZone = setting?.timeZone || 'Asia/Kolkata';
            const businessStartTime = setting?.business_day_start_time || '00:01:00';
            const business_date = getBusinessDate(timeZone, businessStartTime);

            const order = await Order.create({ business_date, hotelUserId: req.userId, created_from: "mobile", bill_no: `${maxOnlineBillNo + 1}`, hotel_id: req.user, TableId: table?.id, totalDiscount, UserId: user?.id, status: ORDER_TYPE.HOLD, order_type, totalAmount: modifiedCart.totalBill - gst + totalDiscount, gst, grandAmount: Math.round(modifiedCart.totalBill) })

            for (const cur of cartData) {
                let addons = []
                if (cur?.addonDepartmentData?.length) {
                    addons = getAddonsFromAddonDepartment(cur?.addonDepartmentData)
                }
                if (!+cur.qty) {
                    return res.mobileError(MESSAGE.QTY_MUST_BE_GREATER_THAN_ZERO, STATUSCODE.VALIDATION_ERROR)
                }
                console.log(addons, "Addon comming From Post Request------------>")
                let modifiedCartForOrderDetails = { MenuId: "", hotel_id: "", qty: "", orderId: "", totalDiscount: 0 };
                modifiedCartForOrderDetails.MenuId = +cur.id
                modifiedCartForOrderDetails.qty = cur.qty
                modifiedCartForOrderDetails.price = +cur.price
                modifiedCartForOrderDetails.totalDiscount = cur.discount
                modifiedCartForOrderDetails.TableId = table?.id
                modifiedCartForOrderDetails.UserId = user?.id
                modifiedCartForOrderDetails.order_type = order_type
                modifiedCartForOrderDetails.payment_status = "pending"
                modifiedCartForOrderDetails.hotel_id = cur.hotel_id
                modifiedCartForOrderDetails.orderId = order.id
                modifiedCartForOrderDetails.status = ORDER_DETAILS_TYPE.IN_PROGRESS
                modifiedCartForOrderDetails.addons = addons.length ? addons : []
                modifiedCartForOrderDetails.variant_id = cur?.variant_id ? cur.variant_id : null
                modifiedCartForOrderDetails.variant_name = cur?.variant_name ? cur.variant_name : null
                const orderDetails = await OrderDetails.create(modifiedCartForOrderDetails)
            }
            await updatedPosData(io, hotel.id)
            return res.json(mobileSuccess(MESSAGE.SUCCESS, { orderId: order.id }, MESSAGE.ORDER_HOLD, STATUSCODE.CREATED))
        }
        return res.json(mobileError(MESSAGE.CART_NOT_FOUND, STATUSCODE.NOT_FOUND))
    } catch (err) {
        console.log(err)
        //createLogFile(req.user, `mobileHoldOrder MoBile /err Error`, err);
        return res.json(mobileError(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const mobilePrintOrder = async (req, res) => {
    try {
        console.log(req.body)
        // ! for react app 
        const { cart, order_type = "dinin", order_id, cash = 0, card = 0, upi = 0, due = 0, name = 0, number, gstin = "", address = "", dashBoardCalling } = req.body
        // console.log(cart, "cart==========================>AdminOrder")
        if (due > 0 && !number) {
            return res.json(mobileError("MObile Require On Due Payment", STATUSCODE.BAD_REQUEST))
        }
        console.log(req.user, "HotelId")
        const hotel = await Hotel.findOne({ where: { id: req.user }, include: { model: InvoiceFormate } })
        if (!hotel) return res.json(mobileError(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.NOT_FOUND))

        if (!order_type) {
            return res.json(mobileError(MESSAGE.PLEASE_SELECT_ORDER_TYPE, STATUSCODE.BAD_REQUEST))
        }
        if (!cart.items.length) {
            return res.json(mobileError(MESSAGE.CART_NOT_FOUND, STATUSCODE.NOT_FOUND))
        }

        const cartData = cart.items

        let user = await findAndUpdateUser({ name, number, gstin, address, hotel_id: req.user })

        if (+order_id) {
            // const orderget = await Order.findByPk(order_id)
            const orderWithoutupdated = await Order.findByPk(order_id)
            if (!orderWithoutupdated) return res.json(mobileError(MESSAGE.ORDER_NOT_FOUND, STATUSCODE.NOT_FOUND))
            if (!cartData.length) return res.json(mobileError(MESSAGE.CART_NOT_FOUND, STATUSCODE.NOT_FOUND))
            const modifiedCart = cart
            const gst = modifiedCart.gst
            const totalDiscount = modifiedCart.totalDiscount
            await Table.update({ table_status: "P" }, { where: { id: orderWithoutupdated.TableId, hotel_id: req.user } })
            if (!orderWithoutupdated) return res.json(mobileError(MESSAGE.ORDER_NOT_FOUND, STATUSCODE.NOT_FOUND))
            const totalAmount = +cash + +card + +upi + +due
            if (orderWithoutupdated.order_type === "pickup") {
                if (totalAmount === 0 && (Math.round(modifiedCart.totalBill) !== 0)) {
                    return res.json(mobileError(MESSAGE.PAYMENT_MODE_NOT_SELECTED, STATUSCODE.NOT_FOUND))
                }
                if (totalAmount !== Math.round(modifiedCart.totalBill)) {
                    return res.json(mobileError("Please Enter Valid Amount", STATUSCODE.NOT_FOUND))
                }
            }
            await Order.update({ UserId: user.id, cash, card, upi, due, totalDiscount, status: STATUS.SUCCESS, payment: STATUS.PENDING, order_type, totalAmount: modifiedCart.totalBill - gst + totalDiscount, gst, grandAmount: Math.round(modifiedCart.totalBill) }, { where: { id: order_id, hotel_id: req.user } })

            await OrderDetails.destroy({ where: { orderId: order_id, hotel_id: req.user, } }, { truncate: true })

            for (const cur of cartData) {

                if (!+cur.qty) {
                    return res.mobileError(MESSAGE.QTY_MUST_BE_GREATER_THAN_ZERO, STATUSCODE.VALIDATION_ERROR)
                }

                let condition = { orderId: order_id, MenuId: +cur.id, price: cur.price, hotel_id: req.user, status: { [Op.eq]: ORDER_DETAILS_TYPE.DELIVERED } }
                if (cur.variant_id) {
                    condition = { orderId: order_id, variant_id: cur.variant_id, MenuId: +cur.id, price: cur.price, hotel_id: req.user, status: { [Op.eq]: ORDER_DETAILS_TYPE.DELIVERED } }
                }
                const OrderDetailsAvailable = await OrderDetails.findOne({ where: { ...condition } })

                let result = false
                let addons = []
                if (cur?.addonDepartmentData?.length) {
                    addons = getAddonsFromAddonDepartment(cur.addonDepartmentData)
                }
                if (OrderDetailsAvailable) {
                    if (addons?.length) {
                        const data = matchDepartmentsAndAddonsById(OrderDetailsAvailable.addons, addons)
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
                    await OrderDetails.update({ totalDiscount: cur.discount, qty: +cur.qty + OrderDetailsAvailable.qty, order_type, payment_status: orderWithoutupdated.order_type == "pickup" ? STATUS.SUCCESS : STATUS.PENDING }, { where: { id: OrderDetailsAvailable.id, hotel_id: req.user } })
                }
                else {
                    let modifiedCartForOrderDetails = { MenuId: "", hotel_id: "", qty: "", orderId: "" };
                    modifiedCartForOrderDetails.MenuId = +cur.id
                    modifiedCartForOrderDetails.qty = cur.qty
                    modifiedCartForOrderDetails.price = +cur.price
                    modifiedCartForOrderDetails.totalDiscount = cur.discount
                    modifiedCartForOrderDetails.order_type = order_type
                    modifiedCartForOrderDetails.payment_status = orderWithoutupdated.order_type == "pickup" ? STATUS.SUCCESS : STATUS.PENDING
                    modifiedCartForOrderDetails.hotel_id = cur.hotel_id
                    modifiedCartForOrderDetails.orderId = order_id
                    modifiedCartForOrderDetails.status = ORDER_DETAILS_TYPE.DELIVERED
                    modifiedCartForOrderDetails.TableId = orderWithoutupdated.TableId
                    modifiedCartForOrderDetails.addons = addons.length ? addons : []
                    modifiedCartForOrderDetails.variant_id = cur?.variant_id ? cur.variant_id : null
                    modifiedCartForOrderDetails.variant_name = cur?.variant_name ? cur.variant_name : null
                    await OrderDetails.create(modifiedCartForOrderDetails)
                }


            }
            await OrderDetails.update({ totalDiscount, status: ORDER_DETAILS_TYPE.DELIVERED, payment_status: orderWithoutupdated.order_type == "pickup" ? STATUS.SUCCESS : STATUS.PENDING }, { where: { orderId: order_id, hotel_id: req.user } })

            const orderDetails = await OrderDetails.findAll({ where: { orderId: order_id, hotel_id: req.user }, include: [{ model: Menu }, { model: Variants, as: "variantData" }] })

            let modifiedOrderDetails = { items: [], totalBill: 0, totalDiscount: 0, totalExcGstAmount: 0, gst: 0 };

            for (const cur of orderDetails) {

                const menuData = await Menu.findOne({ where: { id: cur.MenuId, hotel_id: req.user } });

                if (menuData.gst_type == "G") {
                    modifiedOrderDetails.totalExcGstAmount += (parseFloat(cur.qty) * parseFloat(cur.price))
                }

                cur.totalAmount = parseFloat(cur.qty) * parseFloat(cur.price)
                modifiedOrderDetails.totalDiscount += parseFloat(cur.discount)
                modifiedOrderDetails.totalBill += parseFloat(cur.qty) * parseFloat(cur.price);
                menuData.dataValues.qty = parseFloat(cur.qty);
                menuData.dataValues.totalAmount = parseFloat(cur.qty) * parseFloat(cur.price);
                menuData.dataValues.status = cur.status
                menuData.dataValues.comment = cur.comment
                menuData.dataValues.discount = +cur.discount
                menuData.dataValues.hms_menu_mst = { item_name: menuData.item_name },
                    menuData.dataValues.price = cur.price
                menuData.dataValues.variantData = cur.variantData ? cur.variantData : {}
                menuData.dataValues.addons = cur.addons ? cur.addons : []
                modifiedOrderDetails.items.push(menuData.dataValues);

            }

            if (!hotel.invoiceFormateIncGst) {
                modifiedOrderDetails.gst = 0
            } else {
                modifiedOrderDetails.gst = (((modifiedOrderDetails.totalBill - modifiedOrderDetails.totalExcGstAmount) * 5) / 100)
            }
            if (order_type !== 'pickup') {
                return res.json(mobileSuccess(MESSAGE.CREATED, { modifiedOrderDetails, orderId: order_id, restaurantName: hotel.hotel_name }, MESSAGE.ORDER_COMPLETED, STATUSCODE.CREATED))
            }

            else {
                const order = await Order.findByPk(order_id)
                const orderDetails = await OrderDetails.findAll({
                    where: {
                        orderId: order_id, hotel_id: req.user
                    }, include: [{ model: Menu }, { model: Variants, as: "variantData" }]
                })

                let modifiedOrderDetails = { items: [], totalBill: 0, totalDiscount: 0, totalExcGstAmount: 0, gst: 0 };

                for (const cur of orderDetails) {

                    const menuData = await Menu.findOne({ where: { id: cur.MenuId, hotel_id: req.user } });
                    if (menuData.gst_type == "G") {
                        modifiedOrderDetails.totalExcGstAmount += (parseFloat(cur.qty) * parseFloat(cur.price))
                    }
                    cur.totalAmount = parseFloat(cur.qty) * parseFloat(cur.price)
                    modifiedOrderDetails.totalDiscount += parseFloat(cur.discount)
                    modifiedOrderDetails.totalBill += parseFloat(cur.qty) * parseFloat(cur.price);
                    menuData.dataValues.qty = parseFloat(cur.qty);
                    menuData.dataValues.totalAmount = parseFloat(cur.qty) * parseFloat(cur.price);
                    menuData.dataValues.status = cur.status
                    menuData.dataValues.comment = cur.comment
                    menuData.dataValues.discount = +cur.discount
                    menuData.dataValues.hms_menu_mst = { item_name: menuData.item_name, },
                        menuData.dataValues.price = cur.price
                    menuData.dataValues.variantData = cur.variantData ? cur.variantData : {}
                    menuData.dataValues.addons = cur.addons ? cur.addons : []
                    modifiedOrderDetails.items.push(menuData.dataValues);

                }

                if (!hotel.invoiceFormateIncGst) {
                    modifiedOrderDetails.gst = 0
                } else {
                    modifiedOrderDetails.gst = (((modifiedOrderDetails.totalBill - modifiedOrderDetails.totalExcGstAmount) * 5) / 100)
                }
                const printer = await PrinterSetting.findOne({ where: { default: true, print_type: 'I', hotel_id: req.user } })
                const orderDetails2 = modifiedOrderDetails.items
                if (!cart.items.length) return res.json(mobileError(MESSAGE.ORDERDETAILS_NOT_FOUND, STATUSCODE
                    .NOT_FOUND))
                const items = []
                let totalQty = 0;
                for (const cur of orderDetails2) {
                    const documents = {}
                    // const menuData = await Menu.findOne({ where: { id: +cur.id, hotel_id: req.user } })
                    documents.item_name = cur.item_name
                    documents.price = cur.price
                    documents.qty = parseFloat(cur.qty)
                    documents.totalAmount = cur.price * parseFloat(cur.qty)
                    documents.variantData = cur.variantData
                    documents.addons = cur.addons
                    items.push(documents)
                    totalQty += cur.qty
                }
                // con7st currentDate = new Date();
                const timeAndDate = moment().format('DD/MM/YYYY');
                const subtotal = (order.totalAmount).toFixed(2)
                // let table = await Table.findOne({ where: { id: order?.TableId, hotel_id: req.user } })
                let tableAndUserInfo = ''

                const headerContent = []
                const footerContent = []
                console.log(hotel.hms_invoice_formate_mst, "Hotel----------------------------->")
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
                console.log(headerText, footerText)
                const type = "PickUp";
                const data = {
                    customerName: user?.name,
                    customerNumber: user?.number,
                    gstin: user?.gstin,
                    address: user?.address,
                    origin: req.headers.origin,
                    headerContent: headerText,
                    footerContent: footerText,
                    dateAndTime: timeAndDate,
                    orderId: order.id,
                    bill_no: order.bill_no,
                    restaurantName: hotel.hotel_name,
                    restaurantNumber: hotel.contact1,
                    restaurantAddress: `${hotel.address1} ${hotel.address2}`,
                    printerSize: printer.printer_size,
                    items,
                    tableAndUserInfo,
                    type,
                    subtotal,
                    gst: order.gst,
                    totalBill: order.grandAmount,
                    totalQty,
                    totalDiscount: order.totalDiscount,
                    invoiceFormateIncGst: hotel.invoiceFormateIncGst
                }
                await io.to(hotel.id).emit("printBill", { orderId: order.id, print: dashBoardCalling ? true : false })
                console.log(data, "Data Here Print")
                return res.json(mobileSuccess(MESSAGE.CREATED, { invoicedata: data, orderId: order.id, restaurantName: hotel.hotel_name }, MESSAGE.ORDER_CREATE, STATUSCODE.CREATED))
            }


        }
        else {

            let table
            let { tableId } = req.body
            if (order_type !== "pickup") {
                table = await Table.findOne({ where: { id: tableId, hotel_id: req.user, active: true } })
                if (!table) {
                    return res.json(mobileError(MESSAGE.TABLE_NOT_AVAILABLE, STATUSCODE.BAD_REQUEST))
                }
                const tableRunning = await Order.findOne({ where: { TableId: table?.id, status: { [Op.ne]: ORDER_TYPE.SUCCESS }, deleted: false, payment: "pending" } })

                if (tableRunning) {
                    return res.json(mobileError(MESSAGE.TABLE_RUNNING, STATUSCODE.BAD_REQUEST))
                }
                await Table.update({ table_status: "P" }, { where: { id: table?.id, hotel_id: req.user, active: true } })
            }

            if (cartData) {
                const modifiedCart = cart
                const gst = modifiedCart.gst
                const totalDiscount = modifiedCart.totalDiscount
                const allOrderData = await Order.findAll({ where: { hotel_id: req.user, isOffline: false } })
                const maxOnlineBillNo = allOrderData.reduce((max, invoice) => {
                    const numericValue = parseInt(invoice.bill_no, 10);
                    return numericValue > max ? numericValue : max;
                }, 0);

                const setting = await RestaurantSetting.findOne({ where: { hotel_id: req.user } });
                const timeZone = setting?.timeZone || 'Asia/Kolkata';
                const businessStartTime = setting?.business_day_start_time || '00:01:00';
                const business_date = getBusinessDate(timeZone, businessStartTime);

                const order = await Order.create({ business_date, hotelUserId: req.userId, created_from: "mobile", cash, card, upi, due, bill_no: `${maxOnlineBillNo + 1}`, hotel_id: req.user, UserId: user?.id, TableId: table?.id, status: STATUS.SUCCESS, order_type, payment: order_type === "pickup" ? "success" : "pending", totalDiscount, totalAmount: modifiedCart.totalBill - gst + totalDiscount, gst, grandAmount: Math.round(modifiedCart.totalBill) })

                for (const cur of cartData) {
                    let addons = []
                    addons = getAddonsFromAddonDepartment(cur.addonDepartmentData)

                    if (!+cur.qty) {
                        return res.mobileError(MESSAGE.QTY_MUST_BE_GREATER_THAN_ZERO, STATUSCODE.VALIDATION_ERROR)
                    }
                    let modifiedCartForOrderDetails = { MenuId: "", hotel_id: "", qty: "", orderId: "", totalDiscount: 0 };
                    // const menuData = await Menu.findOne({ where: { id: +cur.id } });
                    modifiedCartForOrderDetails.MenuId = +cur.id
                    modifiedCartForOrderDetails.qty = cur.qty
                    modifiedCartForOrderDetails.price = +cur.price
                    modifiedCartForOrderDetails.order_type = order_type
                    modifiedCartForOrderDetails.totalDiscount = cur.discount
                    modifiedCartForOrderDetails.payment_status = STATUS.PENDING
                    // modifiedCartForOrderDetails.UserId = cur.UserId
                    modifiedCartForOrderDetails.hotel_id = cur.hotel_id
                    modifiedCartForOrderDetails.orderId = order.id
                    modifiedCartForOrderDetails.status = ORDER_DETAILS_TYPE.DELIVERED
                    modifiedCartForOrderDetails.TableId = table?.id
                    modifiedCartForOrderDetails.addons = addons.length ? addons : []
                    modifiedCartForOrderDetails.variant_id = cur?.variant_id ? cur.variant_id : null
                    modifiedCartForOrderDetails.variant_name = cur?.variant_name ? cur.variant_name : null
                    // console.log(modifiedCartForOrderDetails, "modified cart details============>")
                    const orderDetails = await OrderDetails.create(modifiedCartForOrderDetails)
                    // console.log(orderDetails, "orderDetails===========>")
                }

                console.log(order.id, "orderId=====================>")

                const orderDetails = await OrderDetails.findAll({
                    where: {
                        orderId: order.id, hotel_id: req.user

                    }, include: [{ model: Menu }, { model: Variants, as: "variantData" }]
                })

                let modifiedOrderDetails = { items: [], totalBill: 0, totalDiscount: 0, totalExcGstAmount: 0, gst: 0 };

                for (const cur of orderDetails) {

                    const menuData = await Menu.findOne({ where: { id: cur.MenuId, hotel_id: req.user } });
                    if (menuData.gst_type == "G") {
                        modifiedOrderDetails.totalExcGstAmount += (parseFloat(cur.qty) * parseFloat(cur.price))
                    }
                    cur.totalAmount = +cur.qty * +cur.price
                    modifiedOrderDetails.totalDiscount += parseFloat(cur.discount)
                    modifiedOrderDetails.totalBill += +cur.qty * cur.price;
                    menuData.dataValues.qty = cur.qty;
                    menuData.dataValues.totalAmount = +cur.qty * cur.price;
                    menuData.dataValues.status = cur.status
                    menuData.dataValues.comment = cur.comment
                    menuData.dataValues.discount = +cur.discount
                    menuData.dataValues.variantData = cur.variantData ? cur.variantData : {}
                    menuData.dataValues.addons = cur.addons ? cur.addons : []
                    menuData.dataValues.hms_menu_mst = { item_name: menuData.item_name }
                    menuData.dataValues.price = cur.price
                    console.log(menuData, "MenuData---->")
                    modifiedOrderDetails.items.push(menuData.dataValues);

                }


                if (!hotel.invoiceFormateIncGst) {
                    modifiedOrderDetails.gst = 0
                } else {
                    modifiedOrderDetails.gst = (((modifiedOrderDetails.totalBill - modifiedOrderDetails.totalExcGstAmount) * 5) / 100)
                }
                if (order_type !== 'pickup') {

                    return res.json(mobileSuccess(MESSAGE.CREATED, { modifiedOrderDetails, orderId: order.id, restaurantName: hotel.hotel_name }, MESSAGE.ORDER_CREATE, STATUSCODE.CREATED))
                }
                else {

                    if (!hotel.invoiceFormateIncGst) {
                        modifiedOrderDetails.gst = 0
                    } else {
                        modifiedOrderDetails.gst = (((modifiedOrderDetails.totalBill - modifiedOrderDetails.totalExcGstAmount) * 5) / 100)
                    }
                    const printer = await PrinterSetting.findOne({ where: { default: true, print_type: 'I', hotel_id: req.user } })
                    const orderDetails2 = modifiedOrderDetails.items
                    if (!cart.items.length) return res.json(mobileError(MESSAGE.ORDERDETAILS_NOT_FOUND, STATUSCODE
                        .NOT_FOUND))
                    const items = []
                    let totalQty = 0;
                    for (const cur of orderDetails2) {
                        const documents = {}

                        documents.item_name = cur.item_name
                        documents.price = cur.price
                        documents.qty = +cur.qty
                        documents.totalAmount = cur.totalAmount
                        documents.variantData = cur.variantData ? cur.variantData : {}
                        documents.addons = cur.addons ? cur.addons : []
                        items.push(documents)
                        totalQty += cur.qty
                    }
                    const timeAndDate = moment().format('DD/MM/YYYY');
                    const subtotal = (order.totalAmount).toFixed(2)
                    let tableAndUserInfo = ''

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
                    console.log(headerText, footerText)
                    const type = "PickUp";
                    const data = {
                        customerName: user?.name,
                        customerNumber: user?.number,
                        gstin: user?.gstin,
                        address: user?.address,
                        origin: req.headers.origin,
                        headerContent: headerText,
                        footerContent: footerText,
                        dateAndTime: timeAndDate,
                        orderId: order.id,
                        bill_no: order.bill_no,
                        restaurantName: hotel.hotel_name,
                        restaurantNumber: hotel.contact1,
                        restaurantAddress: `${hotel.address1} ${hotel.address2}`,
                        printerSize: printer.printer_size,
                        items,
                        tableAndUserInfo,
                        type,
                        subtotal,
                        gst: order.gst,
                        totalBill: order.grandAmount,
                        totalQty,
                        totalDiscount: order.totalDiscount,
                        invoiceFormateIncGst: hotel.invoiceFormateIncGst
                    }
                    await io.to(hotel.id).emit("printBill", { orderId: order.id, print: dashBoardCalling ? true : false })

                    return res.json(mobileSuccess(MESSAGE.CREATED, { invoicedata: data, orderId: order.id, restaurantName: hotel.hotel_name }, MESSAGE.ORDER_CREATE, STATUSCODE.CREATED))
                }
            }
            return res.json(mobileError(MESSAGE.CART_NOT_FOUND, STATUSCODE.NOT_FOUND))
        }
    } catch (err) {
        console.log(err)
        //createLogFile(req.user, `mobilePrintOrder MoBile /err Error`, err);

        return res.json(mobileError(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const printBill = async (req, res) => {
    try {
        const id = req.user
        const { order_id, resObject, dashBoardCalling, rePrint = false } = req.body

        if (rePrint && dashBoardCalling) {
            return res.json(mobileError("Print From Clound Not Wroking On Reprint", STATUSCODE.NOT_FOUND))
        }

        console.log(resObject, "resObject=================>")
        const hotel = await Hotel.findOne({ where: { id }, include: { model: InvoiceFormate } })
        if (!hotel) return res.json(mobileError(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.NOT_FOUND))
        const printer = await PrinterSetting.findOne({ where: { default: true, print_type: 'I', hotel_id: req.user } })
        const order1 = JSON.parse(JSON.stringify(await Order.findOne({ where: { hotel_id: req.user, id: +order_id } })))
        const user = await User.findByPk(order1.UserId)
        if (!order1) return res.json(mobileError(MESSAGE.ORDER_NOT_FOUND, STATUSCODE
            .NOT_FOUND))

        if (!rePrint) {
            console.log("order Update-->", resObject.totalDiscount, order_id, req.user)
            const update = await Order.update({ totalDiscount: resObject.totalDiscount ? resObject.totalDiscount : 0, totalAmount: resObject?.totalBill + resObject?.totalDiscount - resObject?.gst, grandAmount: Math.round(resObject.totalBill), gst: resObject?.gst }, { where: { hotel_id: req.user, id: +order_id } })
            console.log(update, "Update->")
        }
        const order = JSON.parse(JSON.stringify(await Order.findOne({ where: { hotel_id: req.user, id: +order_id } })))


        const orderDetails1 = await OrderDetails.findAll({
            where: {
                orderId: order.id, hotel_id: req.user

            }, include: [{ model: Menu }, { model: Variants, as: "variantData" }]
        })
        console.log(orderDetails1, "OrderDetails------------>")
        let modifiedOrderDetails = { items: [], totalBill: 0, totalDiscount: 0, totalExcGstAmount: 0, gst: 0 };

        for (const cur of orderDetails1) {

            const menuData = await Menu.findOne({ where: { id: cur.MenuId, hotel_id: req.user } });
            if (menuData.gst_type == "G") {
                modifiedOrderDetails.totalExcGstAmount += (parseFloat(cur.qty) * parseFloat(cur.price))
            }
            cur.totalAmount = +cur.qty * +cur.price
            modifiedOrderDetails.totalDiscount += parseFloat(cur.discount)
            modifiedOrderDetails.totalBill += +cur.qty * cur.price;
            menuData.dataValues.qty = cur.qty;
            menuData.dataValues.totalAmount = +cur.qty * cur.price;
            menuData.dataValues.status = cur.status
            menuData.dataValues.comment = cur.comment
            menuData.dataValues.discount = +cur.discount
            menuData.dataValues.variantData = cur.variantData ? cur.variantData : {}
            menuData.dataValues.addons = cur.addons ? cur.addons : []
            menuData.dataValues.hms_menu_mst = { item_name: menuData.item_name }
            menuData.dataValues.price = cur.price
            console.log(menuData, "MenuData---->")
            modifiedOrderDetails.items.push(menuData.dataValues);

        }
        const orderDetails = modifiedOrderDetails.items

        // console.log(orderDetails, "OrderDetails------------->")
        if (!orderDetails.length) return res.json(mobileError(MESSAGE.ORDERDETAILS_NOT_FOUND, STATUSCODE.NOT_FOUND))
        const items = []

        let totalQty = 0;

        for (const cur of orderDetails) {
            const documents = {}
            documents.item_name = cur.item_name
            documents.price = +cur.price.toFixed(2)
            documents.qty = +cur.qty
            documents.totalAmount = (+cur.totalAmount).toFixed(2)
            documents.variantData = cur.variantData ? cur.variantData : {}
            documents.addons = cur.addons ? cur.addons : []
            items.push(documents)
            totalQty = +totalQty + +((+cur.qty).toFixed(2))
        }
        // con7st currentDate = new Date();
        const timeAndDate = moment().format('DD/MM/YYYY');
        const subtotal = rePrint ? order.totalAmount : (resObject?.totalBill + resObject?.totalDiscount - +resObject?.gst).toFixed(2)
        console.log(order, "Tableid")
        let table = await Table.findOne({ where: { id: order?.TableId, hotel_id: req.user } })
        console.log(table, "Table data-->")
        let tableCategory = await TableCatagories.findOne({ where: { id: table.table_catag_id, hotel_id: req.user } })
        console.log(table, "table------------>")
        let tableAndUserInfo = `${table.type === "T" ? "Table No" : "Room No"} : ${tableCategory?.table_catag_nm}-${table?.table_name}`

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

        const type = "Dine In";

        const data = {
            customerName: user?.name,
            customerNumber: user?.number,
            gstin: user?.gstin,
            address: user?.address,
            origin: req.headers.origin,
            headerContent: headerText,
            footerContent: footerText,
            dateAndTime: timeAndDate,
            orderId: order.id,
            bill_no: order.bill_no,
            restaurantName: hotel.hotel_name,
            restaurantNumber: hotel.contact1,
            restaurantAddress: `${hotel.address1} ${hotel.address2}`,
            items,
            bottomText: hotel.invoiceFormateBottomText,
            tableAndUserInfo,
            type,
            subtotal,
            gst: order.gst,
            totalBill: order.grandAmount,
            printerSize: printer.printer_size,
            totalQty,
            totalDiscount: order.totalDiscount,
            invoiceFormateIncGst: hotel.invoiceFormateIncGst

        }
        console.log(printer.printer_size, typeof (printer.printer_size), "rpintname Na dorderId")
        console.log(data, "Data-sedn--->")
        await io.to(hotel.id).emit("printBill", { orderId: order.id, print: dashBoardCalling ? true : false })
        return res.json(mobileSuccess(MESSAGE.SUCCESS, { invoicedata: data, printerName: printer.printer_name, orderId: order.id }, MESSAGE.BILL_PRINTED, STATUSCODE.SUCCESS))


    } catch (err) {
        console.log(err)
        //createLogFile(req.user, `printBill MoBile /err Error`, err);

        return res.json(mobileError(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const mobilePickUp = async (req, res) => {
    const t = await sequelize.transaction()
    try {
        const { cart, order_type = "pickup", dashBoardCalling, cash = 0, card = 0, upi = 0, due = 0, name, mobile, gstin = "", address = "" } = req.body
        console.log(req.body, "body Data=>")
        console.log(cart, "cart==========================>AdminOrder")
        if (due > 0 && !mobile) {
            return res.json(mobileError("MObile Require On Due Payment", STATUSCODE.BAD_REQUEST))
        }
        let paymentMode = cash || card || upi || due ? true : false
        if (!paymentMode) {
            await t.rollback()
            return res.json(mobileError(MESSAGE.PAYMENT_MODE_NOT_SELECTED, STATUSCODE.BAD_REQUEST))
        }
        const hotel = await Hotel.findOne({ where: { id: req.user }, include: { model: InvoiceFormate }, transaction: t })
        if (!hotel) {
            await t.rollback()
            return res.json(mobileError(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.NOT_FOUND))
        }
        if (!order_type) {
            await t.rollback()
            return res.json(mobileError(MESSAGE.PLEASE_SELECT_ORDER_TYPE, STATUSCODE.BAD_REQUEST))
        }
        if (!cart.items.length) {
            await t.rollback()
            return res.json(mobileError(MESSAGE.CART_NOT_FOUND, STATUSCODE.NOT_FOUND))
        }
        console.log(req.body)


        let user = ""
        if (number) {

            user = await User.findOne({ where: { hotel_id: req.user, number: number } })
            if (user) {
                await User.update({ name, gstin, address }, { where: { hotel_id: req.user, number: number } })
                user = { name, gstin, address, number }
            }
            else {
                user = await User.create({ name: name ? name : '', number: number ? number : '', gstin, address, hotel_id: req.user })
            }
        } else {

            user = await User.create({ name: name ? name : '', number: number ? number : '', gstin, address, hotel_id: req.user })
        }



        const cartData = cart.items
        if (cartData) {
            // ! for postman testing 
            // const cartDelete = await AdminCart.destroy({ where: { hotel_id: req.user } })

            const { totalBill, totalDiscount, gst } = cart
            const modifiedCart = cart

            const grandAmount = totalBill
            const totalAmount = grandAmount + totalDiscount - gst

            const allOrderData = await Order.findAll({ where: { hotel_id: req.user, isOffline: false } })

            const maxOnlineBillNo = allOrderData.reduce((max, invoice) => {
                const numericValue = parseInt(invoice.bill_no, 10);
                return numericValue > max ? numericValue : max;
            }, 0);
            
            const setting = await RestaurantSetting.findOne({ where: { hotel_id: req.user } });
            const timeZone = setting?.timeZone || 'Asia/Kolkata';
            const businessStartTime = setting?.business_day_start_time || '00:01:00';
            const business_date = getBusinessDate(timeZone, businessStartTime);

            const order = await Order.create({ business_date, bill_no: `${maxOnlineBillNo + 1}`, cash, card, upi, due, hotel_id: req.user, UserId: user?.id, status: STATUS.SUCCESS, payment: STATUS.SUCCESS, order_type, totalDiscount, totalAmount, gst, grandAmount: Math.round(grandAmount) }, { transaction: t })

            for (const cur of cartData) {
                if (!+cur.qty) {
                    await t.rollback()
                    return res.mobileError(MESSAGE.QTY_MUST_BE_GREATER_THAN_ZERO, STATUSCODE.VALIDATION_ERROR)
                }
                let modifiedCartForOrderDetails = { MenuId: "", hotel_id: "", qty: "", orderId: "", totalDiscount: 0 };
                const menuData = await Menu.findOne({ where: { id: +cur.id } });
                modifiedCartForOrderDetails.MenuId = +cur.id
                modifiedCartForOrderDetails.qty = cur.qty
                modifiedCartForOrderDetails.price = +cur.price
                modifiedCartForOrderDetails.order_type = order_type
                modifiedCartForOrderDetails.totalDiscount = cur.discount
                modifiedCartForOrderDetails.payment_status = STATUS.SUCCESS
                modifiedCartForOrderDetails.hotel_id = cur.hotel_id
                modifiedCartForOrderDetails.orderId = order.id
                modifiedCartForOrderDetails.status = ORDER_DETAILS_TYPE.DELIVERED
                const orderDetails = await OrderDetails.create(modifiedCartForOrderDetails, { transaction: t })
                // console.log(orderDetails, "orderDetails===========>")
            }

            const orderDetails = await OrderDetails.findAll({
                where: {
                    orderId: order.id, hotel_id: req.user
                }, include: { model: Menu }, transaction: t
            })

            let modifiedOrderDetails = { items: [], totalBill: 0, totalDiscount: 0, totalExcGstAmount: 0, gst: 0 };

            for (const cur of orderDetails) {

                const menuData = await Menu.findOne({ where: { id: cur.MenuId, hotel_id: req.user }, transaction: t });
                if (menuData.gst_type == "G") {
                    modifiedOrderDetails.totalExcGstAmount += (parseFloat(cur.qty) * parseFloat(cur.price))
                }
                cur.totalAmount = parseFloat(cur.qty) * parseFloat(cur.price)
                modifiedOrderDetails.totalDiscount += parseFloat(cur.discount)
                modifiedOrderDetails.totalBill += parseFloat(cur.qty) * parseFloat(cur.price);
                menuData.dataValues.qty = parseFloat(cur.qty);
                menuData.dataValues.totalAmount = parseFloat(cur.qty) * parseFloat(cur.price);
                menuData.dataValues.status = cur.status
                menuData.dataValues.comment = cur.comment
                menuData.dataValues.discount = +cur.discount
                menuData.dataValues.hms_menu_mst = { item_name: menuData.item_name }
                modifiedOrderDetails.items.push(menuData.dataValues);

            }

            if (!hotel.invoiceFormateIncGst) {
                modifiedOrderDetails.gst = 0
            } else {
                modifiedOrderDetails.gst = (((modifiedOrderDetails.totalBill - modifiedOrderDetails.totalExcGstAmount) * 5) / 100)
            }
            const printer = await PrinterSetting.findOne({ where: { default: true, print_type: 'I', hotel_id: req.user }, transaction: t })
            const orderDetails2 = cart.items
            if (!orderDetails2.length) return res.json(mobileError(MESSAGE.ORDERDETAILS_NOT_FOUND, STATUSCODE
                .NOT_FOUND))
            const items = []
            let totalQty = 0;
            for (const cur of orderDetails2) {
                const documents = {}
                const menuData = await Menu.findOne({ where: { id: +cur.id, hotel_id: req.user }, transaction: t })
                documents.item_name = menuData.item_name
                documents.price = +cur.price
                documents.qty = parseFloat(cur.qty)
                documents.totalAmount = cur.price * parseFloat(cur.qty)
                items.push(documents)
                totalQty += cur.qty
            }
            // con7st currentDate = new Date();
            const timeAndDate = moment().format('DD/MM/YYYY');
            const subtotal = (order.totalAmount).toFixed(2)
            // let table = await Table.findOne({ where: { id: order?.TableId, hotel_id: req.user } })
            let tableAndUserInfo = ''

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
            console.log(headerText, footerText)
            const type = "PickUp";
            const data = {
                customerName: user?.name,
                customerNumber: user?.number,
                gstin: user?.gstin,
                address: user?.address,
                origin: req.headers.origin,
                headerContent: headerText,
                footerContent: footerText,
                dateAndTime: timeAndDate,
                orderId: order.id,
                bill_no: order.bill_no,
                restaurantName: hotel.hotel_name,
                restaurantNumber: hotel.contact1,
                restaurantAddress: `${hotel.address1} ${hotel.address2}`,
                printerSize: printer.printer_size,
                items,
                tableAndUserInfo,
                type,
                subtotal,
                gst: order.gst,
                totalBill: order.grandAmount,
                totalQty,
                totalDiscount: order.totalDiscount,
                invoiceFormateIncGst: hotel.invoiceFormateIncGst
            }
            await io.to(hotel.id).emit("printBill", { orderId: order.id, print: dashBoardCalling ? true : false })
            await t.commit()
            console.log(data, "Data Send =--->")
            return res.json(mobileSuccess(MESSAGE.CREATED, { invoicedata: data, orderId: order.id, restaurantName: hotel.hotel_name }, MESSAGE.ORDER_CREATE, STATUSCODE.CREATED))
        } else {

            await t.rollback()
            return res.json(mobileError(MESSAGE.CART_NOT_FOUND, STATUSCODE.NOT_FOUND))
        }



    } catch (err) {
        await t.rollback()
        console
            .log(err)
        //createLogFile(req.user, ` mobilePickUp MoBile /err Error`, err);

        return res.json(mobileError(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const getAllUserInfoToRestaurantWise = async (req, res) => {
    const t = await sequelize.transaction()
    try {
        const hotel = await Hotel.findByPk(req.user, { transaction: t })

        if (!hotel) {
            await t.rollback()
            return res.json(mobileError(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.NOT_FOUND))
        }

        const user = await User.findAll({ where: { hotel_id: req.user }, attributes: ['name', "number"], transaction: t })

        await t.commit()
        return res.status(STATUSCODE.SUCCESS).json(mobileSuccess(MESSAGE.SUCCESS, { user }, MESSAGE.ORDER_SETTLE, STATUSCODE.SUCCESS))

    } catch (error) {
        //createLogFile(req.user, `Getting getAllUserInfoToRestaurantWise MoBile /err Error`, err);

        console.log(error)
        await t.rollback()
        return res.json(mobileError(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const mobileRemoveAdminCartItems = async (req, res) => {
    try {
        // ! test get tableId and userId and MenuId From body in live api get the table and User form the Order Display 
        console.log(req.body, "removeCartItems")
        const hotel = await Hotel.findOne({ where: { id: req.user } })
        if (!hotel) return res.json(mobileError(MESSAGE.USER_NOT_FOUND, STATUSCODE.NOT_FOUND))

        const { MenuId, orderId, kotNumber, all } = req.body
        console.log(MenuId, orderId, kotNumber, all)

        if (all) {
            const alreadyItemAvailable = await OrderDetails.findOne({ where: { id: parseInt(MenuId), orderId: parseInt(orderId), hotel_id: req.user, kotNumber: parseInt(kotNumber), status: { [Op.eq]: ORDER_DETAILS_TYPE.KOT } } })
            const allOrderDetaild = await OrderDetails.findAll({ where: { orderId: parseInt(orderId) } })
            console.log(allOrderDetaild, "all Order Details=============>")
            console.log(alreadyItemAvailable, "nkbdsjkxmnzbm nm===>")
            if (alreadyItemAvailable) {
                const order = await Order.findOne({ where: { id: parseInt(orderId), hotel_id: req.user } })
                const gst = (((order.gst - (alreadyItemAvailable.qty * alreadyItemAvailable.price)) * 5) / 100)
                const totalAmount = order.totalAmount - (alreadyItemAvailable.qty * alreadyItemAvailable.price)
                const totalDiscount = order.totalDiscount - alreadyItemAvailable.totalDiscount

                await Order.update({ totalDiscount, totalAmount, gst, grandAmount: Math.round(totalAmount + gst) }, { where: { id: parseInt(orderId), hotel_id: req.user } })
                //createLogFile(req.user, `removeAdminAllCart /  Updated `, { totalDiscount: order.totalDiscount - alreadyItemAvailable.totalDiscount, totalAmount: order.totalAmount - (alreadyItemAvailable.qty * alreadyItemAvailable.price), gst: (((order.gst - (alreadyItemAvailable.qty * alreadyItemAvailable.price)) * 5) / 100), grandAmount: Math.round(order.totalAmount - (alreadyItemAvailable.qty * alreadyItemAvailable.price) - (((order.gst - (alreadyItemAvailable.qty * alreadyItemAvailable.price)) * 5) / 100)), where: { id: parseInt(orderId), hotel_id: req.user } })
                await OrderDetails.destroy({ where: { id: alreadyItemAvailable.id } })
                //createLogFile(req.user, `removeAdminAllCart /  Destroy `, { where: { id: alreadyItemAvailable.id } })

                return res.status(STATUSCODE.SUCCESS).json(mobileSuccess(MESSAGE.SUCCESS, {}, MESSAGE.ITEM_IS_REMOVE_FROM_CART, STATUSCODE.SUCCESS))
            }
            await updatedPosData(io, hotel.id)
            return res.json(mobileError(MESSAGE.CART_ITEM_NOT_AVAILABLE, STATUSCODE.NOT_FOUND))

        }
        else {

            const alreadyItemAvailable = await OrderDetails.findOne({ where: { id: parseInt(MenuId), orderId: parseInt(orderId), kotNumber: parseInt(kotNumber), hotel_id: req.user, status: { [Op.eq]: ORDER_DETAILS_TYPE.KOT } } })
            const MenuItem = await Menu.findOne({ where: { id: parseInt(alreadyItemAvailable.MenuId), hotel_id: req.user } })

            if (alreadyItemAvailable) {
                const order = await Order.findOne({ where: { id: parseInt(orderId), hotel_id: req.user } })
                if (+alreadyItemAvailable.qty === 1) {
                    //createLogFile(req.user, `REMOVEADMINCARTITEMS from Mobile/${parseInt(orderId)} OrderDetails QTY 1 Updated and destroy `, { totalDiscount: order.totalDiscount - alreadyItemAvailable.totalDiscount, totalAmount: order.totalAmount - (alreadyItemAvailable.qty * alreadyItemAvailable.price), gst: (((order.gst - (alreadyItemAvailable.qty * alreadyItemAvailable.price)) * 5) / 100), grandAmount: Math.round(order.totalAmount - (alreadyItemAvailable.qty * alreadyItemAvailable.price) - (((order.gst - (alreadyItemAvailable.qty * alreadyItemAvailable.price)) * 5) / 100)), where: { id: parseInt(orderId), hotel_id: req.user } })
                    const gst = (((order.gst - (alreadyItemAvailable.qty * alreadyItemAvailable.price)) * 5) / 100)
                    const totalAmount = order.totalAmount - (alreadyItemAvailable.qty * alreadyItemAvailable.price)
                    const totalDiscount = order.totalDiscount - alreadyItemAvailable.totalDiscount

                    await Order.update({ totalDiscount, totalAmount, gst, grandAmount: Math.round(totalAmount + gst) }, { where: { id: parseInt(orderId), hotel_id: req.user } })
                    await OrderDetails.destroy({ where: { id: alreadyItemAvailable.id, hotel_id: req.user } })
                    //createLogFile(req.user, `REMOVEADMINCARTITEMS/${parseInt(orderId)} OrderDetails destroy  `, { where: { id: alreadyItemAvailable.id, hotel_id: req.user } })

                    return res.status(STATUSCODE.SUCCESS).json(mobileSuccess(MESSAGE.SUCCESS, {}, MESSAGE.ITEM_IS_REMOVE_FROM_CART, STATUSCODE.SUCCESS))
                } else {

                    const gst = (((order.gst - alreadyItemAvailable.price) * 5) / 100)
                    const totalAmount = order.totalAmount - alreadyItemAvailable.price
                    const totalDiscount = order.totalDiscount - alreadyItemAvailable.totalDiscount

                    //createLogFile(req.user, `REMOVEADMINCARTITEMS/${parseInt(orderId)} OrderDetails QTY GRATER THAN 1+ ORDER Updated`, { totalAmount: order.totalAmount - alreadyItemAvailable.price, gst: (((order.gst - alreadyItemAvailable.price) * 5) / 100), grandAmount: Math.round(order.totalAmount - alreadyItemAvailable.price - (((order.gst - alreadyItemAvailable.price) * 5) / 100)) }, { where: { id: parseInt(orderId), hotel_id: req.user } })
                    await Order.update({ totalAmount, gst, grandAmount: Math.round(totalAmount + gst) }, { where: { id: parseInt(orderId), hotel_id: req.user } })
                    //createLogFile(req.user, `REMOVEADMINCARTITEMS/${orderId} OrderDetails QTY GRATER THAN 1+ ORDERDETAILS Updated`, { totalAmount: order.totalAmount - alreadyItemAvailable.price, gst: (((order.gst - alreadyItemAvailable.price) * 5) / 100), grandAmount: Math.round(order.totalAmount - alreadyItemAvailable.price - (((order.gst - alreadyItemAvailable.price) * 5) / 100)) }, { where: { id: parseInt(orderId), hotel_id: req.user } })
                    const updateOrderItems = await OrderDetails.update({ qty: +alreadyItemAvailable.qty - 1, totalAmount: parseInt(alreadyItemAvailable.totalAmount) - parseInt(MenuItem.price) }, { where: { id: alreadyItemAvailable.id } })
                    // console.log(updateOrderItems, "order Items qty  and total Amount Updated ======>")
                    return res.status(STATUSCODE.SUCCESS).json(mobileSuccess(MESSAGE.SUCCESS, {}, MESSAGE.QTY_AMOUNT_UPDATED, STATUSCODE.SUCCESS))
                }
            }

            await updatedPosData(io, hotel.id)
            return res.json(mobileError(MESSAGE.CART_ITEM_NOT_AVAILABLE, STATUSCODE.NOT_FOUND))
        }

    } catch (err) {
        console.log(err, "=====>error")
        //createLogFile(req.user, `removeAdminCartItems Mobile/err Error`, err)
        return res.json(mobileError(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const mobileDeleteOrder = async (req, res) => {
    try {
        const hotel = await Hotel.findOne({ where: { id: req.user } })
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST))
        const { id, allId } = req.body
        ////console.log(allId, "allId from react")
        if (allId) {
            for (const id of allId) {
                let availableOrder = await Order.findOne({ where: { id, hotel_id: req.user } })
                if (!availableOrder) return res.json(mobileError(MESSAGE.MENU_NOT_FOUND, STATUSCODE.NOT_FOUND))
                const updated = await Order.update({ deleted: true }, { where: { id, hotel_id: req.user } })
            }
            return res.status(STATUSCODE.SUCCESS).json(mobileSuccess(MESSAGE.SUCCESS, {}, MESSAGE.ORDER_DELETED, STATUSCODE.SUCCESS))
        }
        const orderAvailable = await Order.findOne({ where: { id, hotel_id: req.user } })
        // for (let i = orderAvailable.bill_no; i >= orderAvailable.bill_no; i--) {
        //     await Order.update({ bill_no: i }, { where: { bill_no: i, hotel_id: req.user, deleted: false } })
        // }

        if (!orderAvailable) return res.json(error(MESSAGE.ORDER_NOT_FOUND, STATUSCODE.NOT_FOUND))
        if (req.body.free) {
            await Table.update({ table_status: "F" }, { where: { id: orderAvailable.TableId, hotel_id: req.user } })
        }
        await Order.update({ deleted: true }, { where: { id, hotel_id: req.user } })

        //TODO remove all orders from Hotel  
        // await Order.destroy({ where: { hotel_id: req.user } })
        // await OrderDetails.destroy({ where: { hotel_id: req.user } })

        await updatedPosData(io, hotel.id)
        return res.status(STATUSCODE.SUCCESS).json(mobileSuccess(MESSAGE.SUCCESS, {}, MESSAGE.ORDER_DELETED, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err)
        //createLogFile(req.user, `mobileDeleteOrder MoBile /err Error`, err);
        return res.json(mobileError(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }

}
const gettingInvoiceForMobileDaashBoradCalling = async (hotel_id, tableId, order_type) => {

    const invoicePrinters = JSON.parse(JSON.stringify(await PrinterSetting.findAll({
        where: {
            hotel_id, print_type: 'I',
        }, attributes: ['number_of_copies', 'printer_name', 'id', 'printer_size', 'order_type', "table_ids"]
    })))

    console.log(invoicePrinters, "Invoice Printer--")
    const printer = []
    for (const element of invoicePrinters) {
        if ((element.table_ids.includes(tableId) || !element.table_ids.length) && (element.order_type.includes(order_type) || !element.order_type.length)) {
            printer.push(element)
        }
    }
    return printer
}
const updateMobileInvoice = async (req, res) => {
    try {
        console.log(req.body)
        // ! for react app 
        const { cart, order_type = "dinin", order_id, cash = 0, card = 0, upi = 0, due = 0, name = 0, number, gstin = "", address = "", dashBoardCalling } = req.body
        console.log(cart, "cart==========================>updateMobileInvoice")
        if (due > 0 && !number) {
            return res.json(mobileError("MObile Require On Due Payment", STATUSCODE.BAD_REQUEST))
        }
        const hotel = await Hotel.findOne({ where: { id: req.user }, include: { model: InvoiceFormate } })
        if (!hotel) return res.json(mobileError(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.NOT_FOUND))

        if (!order_type) {
            return res.json(mobileError(MESSAGE.PLEASE_SELECT_ORDER_TYPE, STATUSCODE.BAD_REQUEST))
        }
        if (!cart.items.length) {
            return res.json(mobileError(MESSAGE.CART_NOT_FOUND, STATUSCODE.NOT_FOUND))
        }

        const cartData = cart.items
        let user = await findAndUpdateUser({ name, number, gstin, address, hotel_id: req.user })

        console.log(user, "user--->Updated ill")
        if (+order_id) {
            const orderget = await Order.findByPk(order_id)
            if (!orderget) return res.json(mobileError(MESSAGE.ORDER_NOT_FOUND, STATUSCODE.NOT_FOUND))
            console.log(cartData, "cart Items=====================>")
            if (!cartData.length) return res.json(mobileError(MESSAGE.CART_NOT_FOUND, STATUSCODE.NOT_FOUND))
            const modifiedCart = cart
            const gst = modifiedCart.gst
            const totalDiscount = modifiedCart.totalDiscount
            const orderWithoutupdated = await Order.findOne({ where: { id: order_id, hotel_id: req.user } })
            await Table.update({ table_status: "P" }, { where: { id: orderWithoutupdated.TableId, hotel_id: req.user } })
            if (!orderWithoutupdated) return res.json(mobileError(MESSAGE.ORDER_NOT_FOUND, STATUSCODE.NOT_FOUND))
            const totalAmount = +cash + +card + +upi + +due
            if (orderWithoutupdated.order_type === "pickup") {
                if (totalAmount === 0 && (Math.round(modifiedCart.totalBill) !== 0)) {
                    return res.json(mobileError(MESSAGE.PAYMENT_MODE_NOT_SELECTED, STATUSCODE.NOT_FOUND))
                }
                if (totalAmount !== Math.round(modifiedCart.totalBill)) {
                    return res.json(mobileError("Please Enter Valid Amount", STATUSCODE.NOT_FOUND))
                }
            }
            const orderupdated = await Order.update({ UserId: user.id, cash, card, upi, due, totalDiscount, status: STATUS.SUCCESS, payment: STATUS.PENDING, order_type, totalAmount: modifiedCart.totalBill - gst + totalDiscount, gst, grandAmount: Math.round(modifiedCart.totalBill) }, { where: { id: order_id, hotel_id: req.user } })
            console.log(cartData, "card Data from orders")
            await OrderDetails.destroy({ where: { orderId: order_id, hotel_id: req.user, } }, { truncate: true })
            let item = []
            for (const cur of cartData) {

                if (!+cur.qty) {
                    return res.mobileError(MESSAGE.QTY_MUST_BE_GREATER_THAN_ZERO, STATUSCODE.VALIDATION_ERROR)
                }
                let condition = { orderId: order_id, MenuId: +cur.id, price: cur.price, hotel_id: req.user, status: { [Op.eq]: ORDER_DETAILS_TYPE.DELIVERED } }
                if (cur.variant_id) {
                    condition = { orderId: order_id, variant_id: cur.variant_id, MenuId: +cur.id, price: cur.price, hotel_id: req.user, status: { [Op.eq]: ORDER_DETAILS_TYPE.DELIVERED } }
                }
                const OrderDetailsAvailable = await OrderDetails.findOne({ where: { ...condition } })

                let result = false
                let addons = []
                if (cur?.addonDepartmentData?.length) {
                    addons = getAddonsFromAddonDepartment(cur.addonDepartmentData)
                }
                if (OrderDetailsAvailable) {
                    if (addons?.length) {
                        const data = matchDepartmentsAndAddonsById(OrderDetailsAvailable.addons, addons)
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
                console.log(OrderDetailsAvailable, "orderDetails Available==============>", OrderDetailsAvailable?.qty, cur.qty, cur.price)
                if (result) {
                    const updatedOrderDetails = await OrderDetails.update({ totalDiscount: cur.discount, qty: +cur.qty + OrderDetailsAvailable.qty, order_type, payment_status: orderWithoutupdated.order_type == "pickup" ? STATUS.SUCCESS : STATUS.PENDING }, { where: { id: OrderDetailsAvailable.id, hotel_id: req.user } })
                    console.log(updatedOrderDetails, "updated OrderDetails=================>")
                }

                else {
                    let modifiedCartForOrderDetails = { MenuId: "", hotel_id: "", qty: "", orderId: "" };
                    modifiedCartForOrderDetails.MenuId = +cur.id
                    modifiedCartForOrderDetails.qty = cur.qty
                    modifiedCartForOrderDetails.price = +cur.price
                    modifiedCartForOrderDetails.totalDiscount = cur.discount
                    modifiedCartForOrderDetails.order_type = order_type
                    // modifiedCartForOrderDetails.payment_type = orderWithoutupdated.order_type == "pickup" ? paymentMode : ""
                    modifiedCartForOrderDetails.payment_status = orderWithoutupdated.order_type == "pickup" ? STATUS.SUCCESS : STATUS.PENDING
                    // modifiedCartForOrderDetails.UserId = cur.UserId
                    modifiedCartForOrderDetails.hotel_id = cur.hotel_id
                    modifiedCartForOrderDetails.orderId = order_id
                    modifiedCartForOrderDetails.status = ORDER_DETAILS_TYPE.DELIVERED
                    modifiedCartForOrderDetails.TableId = orderWithoutupdated.TableId
                    modifiedCartForOrderDetails.addons = addons.length ? addons : []
                    modifiedCartForOrderDetails.variant_id = cur?.variant_id ? cur.variant_id : null
                    modifiedCartForOrderDetails.variant_name = cur?.variant_name ? cur.variant_name : null
                    // console.log(modifiedCartForOrderDetails, "modified cart details============>")
                    const orderDetails = await OrderDetails.create(modifiedCartForOrderDetails)

                }
                // }

            }
            await OrderDetails.update({ totalDiscount, status: ORDER_DETAILS_TYPE.DELIVERED, payment_status: orderWithoutupdated.order_type == "pickup" ? STATUS.SUCCESS : STATUS.PENDING }, { where: { orderId: order_id, hotel_id: req.user } })
            const orderDetails = await OrderDetails.findAll({ where: { orderId: order_id, hotel_id: req.user }, include: [{ model: Menu }, { model: Variants, as: "variantData" }] })
            let modifiedOrderDetails = { items: [], totalBill: 0, totalDiscount: 0, totalExcGstAmount: 0, gst: 0 };
            console.log(orderDetails, "orderdetailsc ========================>")
            for (const cur of orderDetails) {

                const menuData = await Menu.findOne({ where: { id: cur.MenuId, hotel_id: req.user } });
                if (menuData.gst_type == "G") {
                    modifiedOrderDetails.totalExcGstAmount += (parseFloat(cur.qty) * parseFloat(cur.price))
                }
                cur.totalAmount = parseFloat(cur.qty) * parseFloat(cur.price)
                modifiedOrderDetails.totalDiscount += parseFloat(cur.discount)
                modifiedOrderDetails.totalBill += parseFloat(cur.qty) * parseFloat(cur.price);
                menuData.dataValues.qty = parseFloat(cur.qty);
                menuData.dataValues.totalAmount = parseFloat(cur.qty) * parseFloat(cur.price);
                menuData.dataValues.status = cur.status
                menuData.dataValues.comment = cur.comment
                menuData.dataValues.discount = +cur.discount
                menuData.dataValues.hms_menu_mst = { item_name: menuData.item_name },
                    menuData.dataValues.price = cur.price
                menuData.dataValues.variantData = cur.variantData ? cur.variantData : {}
                menuData.dataValues.addons = cur.addons ? cur.addons : []
                modifiedOrderDetails.items.push(menuData.dataValues);

            }
            console.log(modifiedOrderDetails, "Modified Details-----<")
            if (!hotel.invoiceFormateIncGst) {
                modifiedOrderDetails.gst = 0
            } else {
                modifiedOrderDetails.gst = (((modifiedOrderDetails.totalBill - modifiedOrderDetails.totalExcGstAmount) * 5) / 100)
            }
            const order = await Order.findByPk(order_id)
            if (!hotel.invoiceFormateIncGst) {
                modifiedOrderDetails.gst = 0
            } else {
                modifiedOrderDetails.gst = (((modifiedOrderDetails.totalBill - modifiedOrderDetails.totalExcGstAmount) * 5) / 100)
            }
            const printer = await PrinterSetting.findOne({ where: { default: true, print_type: 'I', hotel_id: req.user } })
            const orderDetails2 = modifiedOrderDetails.items
            if (!cart.items.length) return res.json(mobileError(MESSAGE.ORDERDETAILS_NOT_FOUND, STATUSCODE
                .NOT_FOUND))
            const items = []
            let totalQty = 0;
            for (const cur of orderDetails2) {
                const documents = {}
                documents.item_name = cur.item_name
                documents.price = cur.price
                documents.qty = parseFloat(cur.qty)
                documents.totalAmount = cur.price * parseFloat(cur.qty)
                documents.variantData = cur.variantData
                documents.addons = cur.addons
                items.push(documents)
                totalQty += cur.qty
            }

            const timeAndDate = moment().format('DD/MM/YYYY');
            const subtotal = (+order.totalAmount).toFixed(2)
            let table = await Table.findOne({ where: { id: order?.TableId, hotel_id: req.user } })
            let tableCategory = await TableCatagories.findOne({ where: { id: table.table_catag_id, hotel_id: req.user } })
            let tableAndUserInfo = `${table.type === "T" ? "Table No" : "Room No"} : ${tableCategory?.table_catag_nm}-${table?.table_name}`

            // let tableAndUserInfo = '' //cganges

            const headerContent = []
            const footerContent = []
            console.log(hotel.hms_invoice_formate_mst, "Hotel----------------------------->")
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
            console.log(headerText, footerText)
            const type = "dinin";
            const data = {
                customerName: user?.name,
                customerNumber: user?.number,
                gstin: user?.gstin,
                address: user?.address,
                origin: req.headers.origin,
                headerContent: headerText,
                footerContent: footerText,
                dateAndTime: timeAndDate,
                orderId: order.id,
                bill_no: order.bill_no,
                restaurantName: hotel.hotel_name,
                restaurantNumber: hotel.contact1,
                restaurantAddress: `${hotel.address1} ${hotel.address2}`,
                printerSize: printer.printer_size,
                items,
                tableAndUserInfo,
                type,
                subtotal,
                gst: order.gst,
                totalBill: order.grandAmount,
                totalQty,
                totalDiscount: order.totalDiscount,
                invoiceFormateIncGst: hotel.invoiceFormateIncGst
            }
            await io.to(hotel.id).emit("printBill", { orderId: order.id, print: dashBoardCalling ? true : false })
            console.log(data, "Data Here Print")
            return res.json(mobileSuccess("Order Updated", { invoicedata: data, orderId: order.id, restaurantName: hotel.hotel_name }, MESSAGE.ORDER_CREATE, STATUSCODE.CREATED))
            // }


        } else {
            return res.json(mobileError(MESSAGE.ORDER_NOT_FOUND, STATUSCODE.BAD_REQUEST))
        }


    } catch (error) {
        console.log(error)
        //createLogFile(req.user, `updateInvoice MoBile /err Error`, error);
        return res.json(mobileError(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const generateHashId = (id) => {

    // salt + min length

    const hashids = new Hashids(salt, 10);
    const encoded = hashids.encode(id);      // e.g., "NkK9"
    return encoded

}
const sentEbillMobile = async (req, res) => {
    try {


        const { mobile, orderId } = req.body
        const hotel = await Hotel.findByPk(req.user)
        if (!mobile) {
            return res.json(mobileError("Mobile Number requred for Sending E-Bill", STATUSCODE.BAD_REQUEST))
        }

        if (!orderId) {
            return res.json(mobileError("Order Not Found", STATUSCODE.BAD_REQUEST))
        }

        const order = await Order.findByPk(orderId)
        if (!order) {
            return res.json(mobileError("Order Not Found", STATUSCODE.BAD_REQUEST))
        }


        // const bill_no = generateHashId(orderId)
        // const hotelId = generateHashId(req.user)
        // const link = `${process.env.SOCKET_URL}/#/billview?bill_no=${bill_no}&id=${hotelId}`
        // const getEbillCredit = await EBillCredit({ where: { hotel_id: req.user } })
        // if (getEbillCredit && getEbillCredit.credit <= 0) {
        //     return res.json(mobileError("No Enough Credit For Send E-bill", STATUSCODE.BAD_REQUEST))
        // }
        // const url = 'https://graph.facebook.com/v22.0/594499130419645/messages';
        // const headers = {
        //     'Content-Type': 'application/json',
        //     'Authorization': 'Bearer EAAN1O5KCXlQBOzZCE7Nmv7ViVTzC214I80fQYYxCSJZBwSldpxeIZAm1IxeKzuqrxo997uwmI2OTlC4YeaKDWxWDXTK5u5gOFIylFeG45ppal0CiGxXaH4egQ622LuMJ2nV9RNkB8jDDXnFglZCp4LfJOVTsGj1cN1MFvN6USvHY3ExBuLG9RvW3rRYm0aFYWQZDZD'
        // };
        // const user = await User.findByPk(order.UserId)
        // const body = {
        //     messaging_product: "whatsapp",
        //     to: mobile,
        //     type: "template",
        //     template: {
        //         name: "invoice_online",
        //         language: { code: "en" },
        //         components: [
        //             {
        //                 type: "body",
        //                 parameters: [
        //                     { type: "text", text: user?.name || 'User' },
        //                     { type: "text", text: hotel?.hotel_name || '' },
        //                     { type: "text", text: order.grandAmount || "0" },
        //                     { type: "text", text: `${moment(new Date()).format("DD/MM/YYYY hh:mm a")}` },
        //                     { type: "text", text: link || "" },

        //                 ]
        //             }
        //         ]
        //     }
        // };



        // axios.post(url, body, { headers })
        //     .then(async (response) => {
        //       //createLogFile(req.user, `${mobile} - ${response.data}`, "E-bill")
        //         console.log(response.data);
        //         const checkFirstTime = await EBillCredit.findOne({ where: { hotel_id: req.user } })
        //         if (!checkFirstTime) {
        //             await EBillCredit.create({ hotel_id: req.user, credit: 50 })
        //             await EBillCredit.update({ credit: 49 }, { where: { hotel_id: req.user } })
        //             await EBillCreditDebit.create({ hotel_id: req.user, credit: true, amount: 50, mobile })
        //             await EBillCreditDebit.create({ orderId, hotel_id: req.user, debit: true, amount: 1, mobile })
        //         } else {
        //             await EBillCredit.update({ credit: checkFirstTime - 1 }, { where: { hotel_id: req.user } })
        //             await EBillCreditDebit.create({ orderId, hotel_id: req.user, debit: true, amount: 1, mobile })
        //         }

        //     })
        //     .catch(error => {
        //         console.error(error.response.data, "Error in sending message");
        //         throw new Error(error)
        //     });
        const responce = await sentEbill(req, res)
        console.log("responce:::", responce)
        // if (responce.data.code === 200) {

        //     return res.status(STATUSCODE.SUCCESS).json(mobileSuccess(MESSAGE.SUCCESS, { message: "Invoice send to User Whatsapp" }, "", STATUSCODE.SUCCESS))
        // } else {
        //     return res.json(mobileError(responce.data.results.message, STATUSCODE.BAD_REQUEST))
        // }

    } catch (err) {
        console.log(err)
        return res.json(mobileError(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const getEbillCreditMobile = async (req, res) => {
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
const getMobileAllPromoCode = async (req, res) => {
    try {

        const promoCodes = await PromoCode.findAll({ where: { hotel_id: req.user, status: true } })
        return res.status(STATUSCODE.SUCCESS).json(mobileSuccess(MESSAGE.SUCCESS, { promoCodes }, "Promo Code Fetch Successfully", STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err)
        //createLogFile(req.user, "PromoCOde create Error", JSON.stringify(err))
        return res.json(mobileError(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
module.exports = { getMobileAllPromoCode, sentEbillMobile, findAndUpdateUser, getEbillCreditMobile, updatedPosData, updateMobileInvoice, mobileDeleteOrder, getAllUserInfoToRestaurantWise, mobilePickUp, printBill, mobileKotOrder, mobileHoldOrder, mobilePrintOrder, mobileRemoveAdminCartItems }