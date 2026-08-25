

const { STATUSCODE, MESSAGE, } = require("../constant/const");
const { error, success } = require("../responce/res");

const Hotel = require("../model/hotel");
const OnlineOrders = require("../model/onlineOrder");
const OnlineOrderDetails = require("../model/onlineOrderDetails");
const { createLogFile } = require("../logs/log");
const moment = require("moment");
const { default: puppeteer } = require("puppeteer");
const PrinterSetting = require("../model/printer_setting");
const InvoiceFormate = require("../model/invoiceFormate");




const GetOrderSFromZomoto = async (req, res) => {
    try {
        // console.log('order', req.body)

        const { orders } = req.body
        if (orders.length) {
            // console.log(orders, "inside Orders.lengh----->")

            for (const order of orders) {
                const data = order.data
                // console.log(data)
                const { state, id, creator, resId, paymentMethod, otp, cartDetails, supportingRiderDetails, handoverDetails, orderMessages } = data.order
                const findHotelHaveOnlineOrderActive = await Hotel.findOne({ where: { zomato_id: resId, active_zomato: true } })

                const { discounts } = cartDetails?.discountApplied ? cartDetails?.discountApplied : 0
                let totalDiscount = 0
                if (discounts) {

                    for (const cur of discounts) {
                        totalDiscount += cur.discount.totalDiscountAmount
                    }
                }
                if (findHotelHaveOnlineOrderActive) {
                    //createLogFile(findHotelHaveOnlineOrderActive.hotel_id, "orderData From Zomato", data.order)
                    //! gst Work Pending
                    const calculation = (data) => {
                        let sub_total, gst, grandAmount = 0
                        let items = []
                        const { subtotal, total } = data
                        sub_total = subtotal?.amountDetails.totalCost
                        grandAmount = total?.amountDetails.totalCost
                        for (const cur of data?.items?.dishes) {
                            items.push(cur)
                        }
                        return { sub_total, grandAmount, gst, items }
                    }
                    const { sub_total, grandAmount, gst, items } = calculation(cartDetails)
                    console.log(sub_total, grandAmount, gst, items, "Details extract------------->", handoverDetails.time)
                    const preparation_time = new Date(moment().minutes(handoverDetails.time + moment().minutes()).format())
                    console.log(new Date(moment().minutes(handoverDetails.time + moment().minutes()).format()))
                    const findAlreadyExistOrder = await OnlineOrders.findOne({ where: { zomato_id: id, hotel_id: findHotelHaveOnlineOrderActive.id } })

                    if (findAlreadyExistOrder) {
                        await OnlineOrders.update({ address: creator?.address?.address, status: state, rider_name: supportingRiderDetails.length ? supportingRiderDetails[0]?.name : '', rider_number: supportingRiderDetails.length ? supportingRiderDetails[0]?.phone : 0 }, { where: { id: findAlreadyExistOrder.id, zomato_id: id, hotel_id: findHotelHaveOnlineOrderActive.id } })
                        const order = await OnlineOrders.findByPk(findAlreadyExistOrder.id, { include: { model: OnlineOrderDetails } });
                        console.log(order, "Order--->")
                        await io.to(findHotelHaveOnlineOrderActive.id).emit('onlineOrder', { onlineOrder: order, update: true })
                        return res.json(success(MESSAGE.SUCCESS, { message: "Order Updated" }, STATUSCODE.SUCCESS))

                    } else {
                        console.log(findHotelHaveOnlineOrderActive, "heteloo--------------->")
                        const allOrderData = await OnlineOrders.findAll({ where: { hotel_id: findHotelHaveOnlineOrderActive?.id, }, attributes: ['bill_no'] })
                        const maxOnlineBillNo = allOrderData.reduce((max, invoice) => {
                            const numericValue = parseInt(invoice.bill_no, 10);
                            return numericValue > max ? numericValue : max;
                        }, 0);
                        console.log(orderMessages.find(el => el.messageTag === 'order_top'))
                        const orderMessage = orderMessages.find(el => el.messageTag === 'order_top')?.value?.message
                        console.log(orderMessage)
                        let order = await OnlineOrders.create({ bill_no: maxOnlineBillNo + 1, address: creator.address.address, resId, zomato_id: id, status: state, creator_name: creator?.originalName, rider_name: supportingRiderDetails.length ? supportingRiderDetails[0]?.name : '', rider_number: supportingRiderDetails.length ? supportingRiderDetails[0]?.phone : '', paymentMethod, order_message: orderMessage ? orderMessage : "", sub_total, totalDiscount, grandAmount, gst, otp, preparation_time, hotel_id: findHotelHaveOnlineOrderActive.id })

                        console.log(order, "Order Created-------------->")
                        for (const cur of items) {
                            await OnlineOrderDetails.create({ zomato_id: parseInt(cur?.referenceId), item_name: cur?.name, qty: cur?.quantity, unitCost: cur?.unitCost, totalCost: cur?.totalCost, orderId: order.id, hotel_id: findHotelHaveOnlineOrderActive.id })
                        }
                        const onlineOrder = await OnlineOrders.findByPk(order.id, { include: { model: OnlineOrderDetails } });

                        await io.to(findHotelHaveOnlineOrderActive.id).emit('onlineOrder', { onlineOrder, update: false })
                        return res.json(success(MESSAGE.SUCCESS, { message: MESSAGE.SUCCESS }, STATUSCODE.SUCCESS))
                    }
                } else {
                    return res.json(error("Zomato Service Not Avtivated On This Restaurant", STATUSCODE.BAD_REQUEST))
                }
            }

        } else {
            return res.json(error(MESSAGE.ORDER_NOT_FOUND, STATUSCODE.NOT_FOUND))
        }
    } catch (err) {
        // console.log('order', req.body)
        console.log(err, "err--------------->")
        //createLogFile("zomto Error", `getting offlineUserAccess/err Error`, { err });
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const orderStatus = async (req, res) => {
    try {
        console.log(req.params)
        const findAllOrders = await OnlineOrders.findAll({ where: { resId: req.params.id, clientUpdatedStatus: true } })
        const order = []
        for (const cur of findAllOrders) {
            const object = {
                "orderId": `${cur.zomato_id}`,
                "resId": `${cur.resId}`,
                "status": cur.status === 'PREPARING' ? 1 : cur.status === "READY" ? 3 : cur.status === 'REJECT' ? 0 : 5,
                "prepTime": 30
            }
            order.push(object)

            await OnlineOrders.update({ clientUpdatedStatus: false }, { where: { zomato_id: cur.zomato_id, clientUpdatedStatus: true, resId: req.params.id } })
        }
        console.log(order, "orders-->")
        return res.json({
            "orderHistory": false,
            "orders": order
        })

    } catch (err) {
        console.log(err)
        //createLogFile(req.user, `getting offlineUserAccess/err Error`, err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))

    }
}
const items = async (req, res) => {
    try {
        // console.log(req)
        console.log(req.params)
        return res.json(success(MESSAGE.SUCCESS, { message: MESSAGE.SUCCESS }, STATUSCODE.SUCCESS))

    } catch (error) {
        console.log(err)
        //createLogFile(req.user, `getting offlineUserAccess/err Error`, err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))

    }
}
const orderStatusChange = async (req, res) => {
    try {
        const { id, status } = req.body
        const findExistingOrder = await OnlineOrders.findByPk(id)
        if (!findExistingOrder) return res.json(error(MESSAGE.ORDER_NOT_FOUND, STATUSCODE.NOT_FOUND))
        let message = ''
        if (status === 'accept') {
            await OnlineOrders.update({ status: "PREPARING", clientUpdatedStatus: true }, { where: { id } })
            message = "Order Accepted"
        }
        else if (status === 'ready') {
            await OnlineOrders.update({ status: "READY", clientUpdatedStatus: true }, { where: { id } })
            message = "Order Ready For Delivered"
        } else if (status === 'reject') {
            await OnlineOrders.update({ status: "REJECT", clientUpdatedStatus: true }, { where: { id } })
            message = "Order Rejected"
        } else {
            message = "InValid Status"
        }
        const updatedOrder = await OnlineOrders.findByPk(id, { include: { model: OnlineOrderDetails } })
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { updatedOrder, message }, STATUSCODE.SUCCESS))

    } catch (error) {
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const getOrderHistory = async (req, res) => {
    try {
        //createLogFile(1, "Order History body", req.body)
        //createLogFile(1, "Order History query", req.query)
    } catch (error) {
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const orderStatusChangeFromZomato = async (req, res) => {
    try {
        //createLogFile(1, "Order Status Chnage Base on OrderId", req.body)
        //createLogFile(1, "Order Status Chnage Base on Query", req.query)

    } catch (error) {
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}


const generateZomatoInvoicePDF = async (data, outputPath) => {
    try {
        // See controller/kto.js's generateKotPdf comment - CHROME_PATH
        // replaces the old origin-header sniffing.
        const browser = await puppeteer.launch({
            executablePath: process.env.CHROME_PATH || undefined,
            args: ['--no-sandbox'],
            headless: true,
        });

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
font-size: 12px;
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
width: 60%;
}

.custom-table-header-details-right {
width: 40%;
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
border-bottom: 1px solid #000
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
font-size: 13px;
font-weight: 400;
}

.invoice-items th:nth-child(2),
.invoice-items th:nth-child(3),
.invoice-items td:nth-child(3),
.invoice-items td:nth-child(2) {
width: 15%;
}

.invoice-items th:nth-child(4) {
text-align: right;
}

.invoice-items td:first-child {
text-align: left;
}
.invoice-items th:first-child {
text-align: left;
}

.invoice-items th {
font-size: 14px !important;
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
font-size:15px;
}

.invoice-footer {
padding-top: 4px;
}
</style>
</head>
            <body>

                <div class="invoice">
                    <div class="invoice-header">
                   <p> <strong> PAID </strong></p>
                    ${data.headerText.join('')}
                    </div>
                    <div class="custom-table-header-name">
            
                     <p> ${data.name ? ` Name : ${data.name}` : ""} </p>
                       <p> ${data.address ? ` Adr : ${data.address}` : ""} </p>
                      
                    </div>
                    <div class="custom-table-header">

                        <div class="custom-table-header-details">
                            <p>Date : ${data.dateAndTime}</p>

                        </div>
                        <div class="custom-table-header-details-right">
                            <p><strong>${data.type}</strong></p>
                            <p>Bill No: ${data.orderId}</p>
                        </div>
                    </div>
                     <div class="custom-table-header">

                        <div class="custom-table-header-details">
                            <p>zomato Id : ${data.zomato_id}</p>

                        </div>
                        <div class="custom-table-header-details-right">
                            <p><strong> Otp :${data.otp}</strong></p>
                            
                        </div>
                    </div>
                    <table class="invoice-items">
                        <thead>
                            <tr>

                                <th>Item</th>
                                <th>Qty.</th>
                                <th>Price</th>
                                <th>Amt</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${data.items.map((item, index) => `
                            <tr>
                                 <td>${item.item_name} </td>
                                <td>${item.qty}</td>
                                <td>${Number(item.price).toFixed(2)}</td>
                                <td>${+item.totalAmount.toFixed(2)}</td>
                            </tr>
                        `).join('')}

                        </tbody>
                    </table>

                    <div class="invoice-total-one">
                       
                        <div>
                            <p> Total Qty:${data.totalQty} sub Total: ${(+data.subtotal).toFixed(2)}</p>
                            <p> ${data.gst > 0 ? `CGST @2.5% : ${(+data.gst / 2).toFixed(2)}` : ''}</p>
                            <p>${data.gst > 0 ? `SGST @2.5% :${(+data.gst / 2).toFixed(2)}` : ''}</p>
                        </div>
                    </div>
                    <div class="invoice-total">
                        <div>
                        <p>${data.totalDiscount ? "Discount" : ""}</p>
                            <p>[Paid online by Zomato] <strong> Grand Total </strong></p>
                        </div>
                        <div>
                        <p>${data.totalDiscount ? "₹" + data.totalDiscount : ""}</p>
                            <p><strong>₹ ${data.totalBill}</strong></p>
                        </div>
                    </div>

                    ${data.footerText.join('')}
                </div>

            </body>
        </html>
        `;
        // Set content to page
        await page.setContent(htmlContent);
        const pdf = await page.pdf();
        // await browser.close();
        console.log(pdf, "Pdf buffer------------>")
        await browser.close()
        return pdf
    } catch (error) {
        //createLogFile(req.user, `generateInvoicePDF /err Error`, err);
        console.log(error, "Error from pupperter======================>")
        return error
    }
}
const generateKotPdf = async (data) => {
    // console.log(data.items)

    // See controller/kto.js's generateKotPdf comment - CHROME_PATH
    // replaces the old origin-header sniffing.
    const browser = await puppeteer.launch({
        executablePath: process.env.CHROME_PATH || undefined,
        args: ['--no-sandbox'],
        headless: true,
    });
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
margin: 5px;
border-bottom:2px dashed #000;
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


.invoice-total{
display:flex;
alight-item:center;
justify-content:center;
margin:5px 0px;
}
.invoice-items th {
font-size: 14px !important;
font-weight: 400;
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
                            </tr>
                        </thead>
                        <tbody>

                         ${data.items.map((item, index) => `
                                <tr>
                                <td><strong>${item.item_name}</strong></td>
                                    <td>${item.qty}</td>
                                    
                                </tr>
                            `).join('')}

                        </tbody>
                    </table>
  <div class="invoice-total">
                       
                        <p> ${data.message}</p>
                    </div>
                </div>

            </body>
        </html>
        `;
    await page.setContent(htmlContent);
    const pdf = await page.pdf();
    // await browser.close();
    console.log(pdf, "Pdf buffer------------>")
    await browser.close()
    return pdf
}
const generateZomatoKot = async (req, res) => {
    try {
        const { id } = req.body
        const hotel = await Hotel.findOne({ where: { id: req.user } })
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST))
        console.log(req.body, "body Data=================>")

        const findZomatoOrder = await OnlineOrders.findByPk(id, { include: { model: OnlineOrderDetails } })
        if (!findZomatoOrder) return res.json(error("Zomato Order Not Found", STATUSCODE.BAD_REQUEST))

        const OrderDetails = findZomatoOrder.toJSON().hms_online_orderDetails_msts
        console.log(OrderDetails)
        const vendor = 'Zomato'
        const message = findZomatoOrder.order_message
        console.log(message, findZomatoOrder, "Instruction---->")
        const checkDefaultPrinterSetting = await PrinterSetting.findOne({ where: { hotel_id: req.user, print_type: "K", multi: false, default: true } });

        if (checkDefaultPrinterSetting) {
            const data = {
                origin: req.headers.origin,
                printerSize: checkDefaultPrinterSetting.printer_size,
                printer: checkDefaultPrinterSetting,
                items: OrderDetails,
                order_type: 'Delivery',
                order_id: findZomatoOrder.zomato_id,
                restaurantName: hotel.hotel_name,
                userOrTableNo: `${vendor} kot`,
                timeAndDate: moment().format("DD/MM hh:mm a"),
                kotNumber: 0,
                message,
            };

            const pdf = await generateKotPdf(data)
            return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.KOT_GENERATED, { pdf, printer: checkDefaultPrinterSetting }, STATUSCODE.SUCCESS))
        }

        return res.json(error('Please Set Default Printer', STATUSCODE.NOT_FOUND))

    } catch (err) {
        console.log(err, "error --------------->")
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const generateZomatoBill = async (req, res) => {
    try {


        const { id } = req.body
        const hotel = await Hotel.findOne({ where: { id: req.user }, include: { model: InvoiceFormate } })

        if (!hotel) {

            return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.NOT_FOUND))
        }

        console.log(req.body, "request body===>")
        // console.log(hotel.dataValues.invoicePrinter, "request body===>")
        const printer = await PrinterSetting.findOne({ where: { default: true, print_type: 'I', hotel_id: req.user } })
        if (!printer) {

            return res.json(error("Printer Not Set", STATUSCODE.BAD_REQUEST))
        }
        const order = await OnlineOrders.findByPk(id, { include: { model: OnlineOrderDetails } })
        if (!order) {

            return res.json(error(MESSAGE.ORDER_NOT_FOUND, STATUSCODE
                .NOT_FOUND))
        }



        const orderDetail = order.hms_online_orderDetails_msts
        if (!orderDetail.length) {

            return res.json(error(MESSAGE.ORDERDETAILS_NOT_FOUND, STATUSCODE
                .NOT_FOUND))
        }

        // console.log(orderDetails, "order Detaild=========================>")

        const items = []
        let totalQty = 0;

        for (const cur of orderDetail) {
            const documents = {}
            documents.item_name = cur.item_name
            documents.price = cur.unitCost
            documents.qty = cur.qty

            documents.totalAmount = cur.totalCost
            items.push(documents)
            totalQty += cur.qty
        }
        const timeAndDate = moment().format("DD/MM/YYYY hh:mm a");
        const subtotal = order.sub_total

        const type = 'Delivery'
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
            headerText = headerContent.map(el => {

                let data = ""
                if (el == "marketing_text") {
                    data = hotel.invoiceFormateHeaderText
                    return el ? `<p class="${el === 'hotel_name' ? 'hotel-name' : ''}"> ${data} </p>` : ''
                }
                else if (el === 'hotel_logo') {
                    // const paths = path.join(__dirname, "../", "public", "images")
                    return el ? `<img style="width:150px;height:150px;" src="${process.env.SUPER_URL}/images/${hotel[el]}"/> ` : ''
                } else if (el === 'gst_no') {

                    data = `GSTIN = ${hotel[el]}`
                    return el ? `<p class="${el === 'hotel_name' ? 'hotel-name' : ''}"> ${data} </p>` : ''
                } else if (el === 'fssai_no') {
                    data = `FSSAI_No :${hotel[el]} `
                    return el ? `<p class="${el === 'hotel_name' ? 'hotel-name' : ''}"> ${data} </p>` : ''
                }
                else if (el === 'restaurant_number') {
                    data = `Mo.${hotel.contact1}`
                    return el ? `<p class="${el === 'hotel_name' ? 'hotel-name' : ''}"> ${data} </p>` : ''
                } else if (el === "address") {
                    data = hotel.address1 + " " + hotel.address2
                    return el ? `<p class="${el === 'hotel_name' ? 'hotel-name' : ''}"> ${data} </p>` : ''
                } else if (hotel[el]) {
                    data = hotel[el]
                    return el ? `<p class="${el === 'hotel_name' ? 'hotel-name' : ''}"> ${data} </p>` : ''
                }
                else {
                    data = el
                    return el ? `<p class="${el === 'hotel_name' ? 'hotel-name' : ''}"> ${data} </p>` : ''
                }

            }
            )
            footerText = footerContent.map(el => {
                let data = ""
                if (el == "marketing_text") {
                    data = hotel.invoiceFormateBottomText
                    return el ? `<p class="${el === 'hotel_name' ? 'hotel-name invoice-grand-total' : 'invoice-grand-total'}"> ${data} </p>` : ''
                }
                else if (el === 'hotel_logo') {
                    // const paths = path.join(__dirname, "../", "public", "images")
                    return el ? `<img class="invoice-grand-total" style="width:150px;height:150px;" src="${process.env.SUPER_URL}/images/${hotel[el]}"/> ` : ''
                } else if (el === 'gst_no') {

                    data = `GSTIN = ${hotel[el]}`
                    return el ? `<p class="${el === 'hotel_name' ? 'hotel-name invoice-grand-total' : 'invoice-grand-total'}"> ${data} </p>` : ''
                } else if (el === 'fssai_no') {
                    data = `FSSAI_No :${hotel[el]} `
                    return el ? `<p class="${el === 'hotel_name' ? 'hotel-name invoice-grand-total' : 'invoice-grand-total'}"> ${data} </p>` : ''
                }
                else if (el === 'restaurant_number') {
                    data = `Mo.${hotel.contact1}`
                    return el ? `<p class="${el === 'hotel_name' ? 'hotel-name invoice-grand-total' : 'invoice-grand-total'}"> ${data} </p>` : ''
                } else if (el === "address") {
                    data = hotel.address1 + " " + hotel.address2
                    return el ? `<p class="${el === 'hotel_name' ? 'hotel-name invoice-grand-total' : 'invoice-grand-total'}"> ${data} </p>` : ''
                } else if (hotel[el]) {
                    data = hotel[el]
                    return el ? `<p class="${el === 'hotel_name' ? 'hotel-name invoice-grand-total' : 'invoice-grand-total'}"> ${data} </p>` : ''
                }
                else {
                    data = el
                    return el ? `<p class="${el === 'hotel_name' ? 'hotel-name invoice-grand-total' : 'invoice-grand-total'}"> ${data} </p>` : ''
                }
            })
        } else {

            headerText = headerContent.map(el => {
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
            footerText = footerContent.map(el => {
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
        }


        console.log(footerText,
            headerText, logoAvailable, hotel.multiLanguage, "Header Text Footer Text")
        const data = {
            zomato_id: order?.zomato_id,

            footerText,
            headerText,
            dateAndTime: timeAndDate,
            orderId: order.bill_no,
            restaurantName: hotel.hotel_name,
            bottomText: hotel.invoiceFormateBottomText,
            address: order.address,
            restaurantNumber: hotel.contact1,
            restaurantAddress: `${hotel.address1} ${hotel.address2}`,
            items,
            name: order.creator_name,
            rider_name: order.rider_name,
            rider_number: order.rider_number,
            type,
            printerSize: printer.printer_size,
            printer: printer,
            subtotal,
            otp: order.otp,
            gst: order.gst,
            totalBill: order.grandAmount,
            totalQty,
            totalDiscount: order.totalDiscount,
            origin: req.headers.origin,
        }
        const pdf = await generateZomatoInvoicePDF(data)

        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { pdf, printer }, STATUSCODE.SUCCESS))


    } catch (err) {
        console.log(err, "err heer")
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
module.exports = { generateZomatoKot, generateZomatoBill, orderStatusChange, GetOrderSFromZomoto, items, orderStatus, getOrderHistory, orderStatusChangeFromZomato }