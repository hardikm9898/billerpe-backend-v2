const Order = require("../model/order")

const { Op } = require("sequelize")
const { STATUSCODE, MESSAGE, STATUS, } = require("../constant/const")
const { error, success } = require("../responce/res")

const Hotel = require("../model/hotel")
const RestaurantSetting = require("../model/restaurantSetting")
const moment = require("moment-timezone")

const axios = require("axios")
const DuePaymentReceive = require("../model/duePayment")
const path = require("path")
const fs = require("fs")
const xlsx = require("xlsx")
const WhatsappTemplate = require("../model/whatsappTemplate")
const validator = require("validator");


const TOKEN = process.env.WHATSAPPTOKEN;
const PHONE_NUMBER_ID = process.env.WHATSAPPPHONEID

const whatsAppBody = (name, parameters, number, default_image) => {

    const url = `https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`;
    const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${TOKEN}`
    };
    let headerImage = {
        "type": "header",
        "parameters": []
    }
    if (default_image)
        headerImage = {
            "type": "header",
            "parameters": [
                {
                    "type": "image",
                    "image": {
                        "link": `${default_image}`
                    }
                }
            ]
        }
    return {
        body: {
            messaging_product: "whatsapp",
            to: `${number}`,
            type: "template",
            template: {
                name: name,
                language: { code: "en" },
                components: [
                    headerImage,
                    {
                        type: "body",
                        parameters: parameters
                    }
                ]
            }
        }, url, headers
    };

}
const dailySendToClientTotalSales = async (req, res) => {
    try {


        const allRestaurant = await Hotel.findAll({
            where: {
                id: {
                    [Op.ne]: 134
                }
            },
            attributes: ['id', 'hotel_name', 'owner_number', 'active']
        });

        for (const restaurant of allRestaurant) {
            if (restaurant.active) {

                const modifiedEnd = moment().endOf('day')
                const modifiedStart = moment().startOf('day')

                const startD = new Date(modifiedStart)
                const endD = new Date(modifiedEnd)




                // ! total Sale 

                const totalSale = await Order.sum("grandAmount", {
                    where: {
                        payment: STATUS.SUCCESS, hotel_id: restaurant.id,
                        createdAt: {
                            [Op.between]: [startD, endD]
                        }, deleted: false
                    }
                })
                // ! total invoice 
                const totalInvoice = await Order.count({
                    where: {
                        payment: STATUS.SUCCESS, hotel_id: restaurant.id,
                        createdAt: {
                            [Op.between]: [startD, endD]
                        }, deleted: false
                    }
                })

                // ! total dine in Sale 
                const totalDinInSale = await Order.sum("grandAmount", {
                    where: {
                        order_type: "dinin", payment: STATUS.SUCCESS, hotel_id: restaurant.id, createdAt: {
                            [Op.between]: [startD, endD]
                        }, deleted: false
                    }
                })

                // ! total pickup sale in Sale 
                const totalPickupSale = await Order.sum("grandAmount", {
                    where: {
                        order_type: "pickup", payment: STATUS.SUCCESS, hotel_id: restaurant.id, createdAt: {
                            [Op.between]: [startD, endD]
                        }, deleted: false
                    }
                })
                //! total Card Payment 
                const totalCardPayment = await Order.sum("card", {
                    where: {
                        payment: STATUS.SUCCESS, hotel_id: restaurant.id, createdAt: {
                            [Op.between]: [startD, endD]
                        }, deleted: false
                    }
                })
                //! total Cash Payment 
                const totalCashPayment = await Order.sum("cash", {
                    where: {
                        payment: STATUS.SUCCESS, hotel_id: restaurant.id, createdAt: {
                            [Op.between]: [startD, endD]
                        }, deleted: false
                    }
                })
                //! total Upi Payment 
                const totalUpiPayment = await Order.sum("upi", {
                    where: {
                        payment: STATUS.SUCCESS, hotel_id: restaurant.id, createdAt: {
                            [Op.between]: [startD, endD]
                        }, deleted: false
                    }
                })
                const totalDuePayment = await Order.sum("due", {
                    where: {
                        payment: STATUS.SUCCESS, hotel_id: restaurant.id, createdAt: {
                            [Op.between]: [startD, endD]
                        }, deleted: false
                    }
                })
                const totalSettleDuePayment = await DuePaymentReceive.sum("amount", {
                    where: {
                        hotel_id: restaurant.id, createdAt: {
                            [Op.between]: [startD, endD]
                        }, deleted: false
                    }
                })

                const totalDiscount = await Order.sum("totalDiscount", {
                    where: {
                        payment: STATUS.SUCCESS, hotel_id: restaurant.id, createdAt: {
                            [Op.between]: [startD, endD]
                        }, deleted: false
                    }
                })


                // await axios.post(`http://xpress.bazaaraajtak.in/v2/sendSMS?username=itliontr&message=Date- ${moment().format('dd/mm/yyyy hh:mm a')} For, ${restaurant.hotel_name} Total Invoice- ${totalInvoice} Total Sales- ${totalSale} Total Dinin Sales-${totalDinInSale} Total Pickup Sales-${totalPickupSale} Cash- ${totalCashPayment} Card- ${totalCardPayment} UPI- ${totalUpiPayment} Discount- ${totalDiscount} Thank you, BillerPe&sendername=BILRPE&smstype=TRANS&numbers=8866484190&apikey=56f121b9-1fa2-4d2f-a148-e2de1e5f0d3d&peid=1201169475672703190&templateid=1707172122840984907`)
                // const url = 'http://xpress.bazaaraajtak.in/v2/sendSMS';
                // const params = {
                //     username: 'itliontr',
                //     message: `Date- ${moment().format('DD/MM/YYYY')}\nFor, ${restaurant.hotel_name || ''}\nTotal Invoice- ${totalInvoice || 0}\nTotal Sales- ${totalSale || 0}\nCash- ${totalCashPayment || 0}\nCard- ${totalCardPayment || 0}\nOnline${'/Upi- ' + `${totalUpiPayment || 0}`}\nDiscount- ${totalDiscount || 0}\nThank you, BillerPe`,
                //     sendername: 'BILRPE',
                //     smstype: 'TRANS',
                //     numbers: restaurant.owner_number,
                //     apikey: '56f121b9-1fa2-4d2f-a148-e2de1e5f0d3d',
                //     peid: '1201169475672703190',
                //     templateid: '1707172122840984907'
                // };
                console.log([
                    { type: "text", text: restaurant.hotel_name },
                    { type: "text", text: totalInvoice },
                    { type: "text", text: totalSale },
                    { type: "text", text: totalCashPayment },
                    { type: "text", text: totalCardPayment },
                    { type: "text", text: totalUpiPayment },
                    { type: "text", text: totalDiscount },
                    { type: "text", text: totalDuePayment },
                    { type: "text", text: totalSettleDuePayment }
                ])
                const url = `https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`;
                const headers = {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${TOKEN}`
                };
                const body = {
                    messaging_product: "whatsapp",
                    to: restaurant.owner_number,
                    type: "template",
                    template: {
                        name: "sales_summary1",
                        language: { code: "en" },
                        components: [
                            {
                                type: "body",
                                parameters: [
                                    { type: "text", text: restaurant.hotel_name || '' },
                                    { type: "text", text: totalInvoice || '0' },
                                    { type: "text", text: totalSale || '0' },
                                    { type: "text", text: totalCashPayment || '0' },
                                    { type: "text", text: totalCardPayment || '0' },
                                    { type: "text", text: totalUpiPayment || '0' },
                                    { type: "text", text: totalDiscount || '0' },
                                    { type: "text", text: totalDuePayment || '0' },
                                    { type: "text", text: totalSettleDuePayment || '0' }
                                ]
                            }
                        ]
                    }
                };

                axios.post(url, body, { headers })
                    .then(response => {
                        console.log(response.data);
                    })
                    .catch(error => {
                        console.error(error);
                    });

                // axios.post(url, {}, { params })
                //     .then(response => {
                //         console.log(response.data);
                //     })
                //     .catch(error => {
                //         console.error(error);
                //     });
            }
        }
        return res.json(success(MESSAGE.SUCCESS, { message: "SMS SuccessFully Sent" }, STATUSCODE.SUCCESS))

    } catch (err) {
        console.log(err)
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const getSalesSummaryMetrics = async (hotel_id, startD, endD) => {
    const totalSale = await Order.sum("grandAmount", {
        where: {
            payment: STATUS.SUCCESS, hotel_id,
            createdAt: { [Op.between]: [startD, endD] }, deleted: false
        }
    })
    const totalInvoice = await Order.count({
        where: {
            payment: STATUS.SUCCESS, hotel_id,
            createdAt: { [Op.between]: [startD, endD] }, deleted: false
        }
    })
    const totalCardPayment = await Order.sum("card", {
        where: {
            payment: STATUS.SUCCESS, hotel_id,
            createdAt: { [Op.between]: [startD, endD] }, deleted: false
        }
    })
    const totalCashPayment = await Order.sum("cash", {
        where: {
            payment: STATUS.SUCCESS, hotel_id,
            createdAt: { [Op.between]: [startD, endD] }, deleted: false
        }
    })
    const totalUpiPayment = await Order.sum("upi", {
        where: {
            payment: STATUS.SUCCESS, hotel_id,
            createdAt: { [Op.between]: [startD, endD] }, deleted: false
        }
    })
    const totalDuePayment = await Order.sum("due", {
        where: {
            payment: STATUS.SUCCESS, hotel_id,
            createdAt: { [Op.between]: [startD, endD] }, deleted: false
        }
    })
    const totalSettleDuePayment = await DuePaymentReceive.sum("amount", {
        where: {
            hotel_id,
            createdAt: { [Op.between]: [startD, endD] }, deleted: false
        }
    })
    const totalDiscount = await Order.sum("totalDiscount", {
        where: {
            payment: STATUS.SUCCESS, hotel_id,
            createdAt: { [Op.between]: [startD, endD] }, deleted: false
        }
    })

    return {
        totalSale, totalInvoice, totalCardPayment, totalCashPayment,
        totalUpiPayment, totalDuePayment, totalSettleDuePayment, totalDiscount
    }
}

const sendRestaurantSalesSummary = async (hotel, timeZone, businessStartTime, businessDate) => {
    if (!hotel.owner_number) {
        console.warn(`Skipping sales summary for hotel ${hotel.id}: no owner_number`)
        return false
    }
    const [hour, minute, second] = businessStartTime.split(':').map(Number)

    const startD = moment.tz(businessDate, timeZone)
        .set({ hour, minute, second: second || 0, millisecond: 0 })
        .toDate()
    const endD = moment.tz(businessDate, timeZone)
        .add(1, 'day')
        .set({ hour, minute, second: second || 0, millisecond: 0 })
        .toDate()

    const {
        totalSale, totalInvoice, totalCardPayment, totalCashPayment,
        totalUpiPayment, totalDuePayment, totalSettleDuePayment, totalDiscount
    } = await getSalesSummaryMetrics(hotel.id, startD, endD)

    const url = `https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`;
    const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${TOKEN}`
    };
    const body = {
        messaging_product: "whatsapp",
        to: hotel.owner_number,
        type: "template",
        template: {
            name: "sales_summary1",
            language: { code: "en" },
            components: [
                {
                    type: "body",
                    parameters: [
                        { type: "text", text: hotel.hotel_name || '' },
                        { type: "text", text: totalInvoice || '0' },
                        { type: "text", text: totalSale || '0' },
                        { type: "text", text: totalCashPayment || '0' },
                        { type: "text", text: totalCardPayment || '0' },
                        { type: "text", text: totalUpiPayment || '0' },
                        { type: "text", text: totalDiscount || '0' },
                        { type: "text", text: totalDuePayment || '0' },
                        { type: "text", text: totalSettleDuePayment || '0' }
                    ]
                }
            ]
        }
    };

    try {
        const response = await axios.post(url, body, { headers })
        console.log(response.data, `Sales summary sent for hotel ${hotel.id} (business date ${businessDate})`)
        return true
    } catch (err) {
        console.error(err?.response?.data || err.message, `Error sending sales summary for hotel ${hotel.id}`)
        return false
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// SALES-SUMMARY QUEUE
// Rate-limited, in-process worker. The per-minute cron only *enqueues* hotels
// whose business day has closed and that haven't been sent yet; a single guarded
// worker drains the queue slowly (so we never blast hundreds of WhatsApp messages
// in one minute and trip Meta rate limits). last_summary_sent_date is updated only
// on a successful send, so failures naturally retry on the next cron tick.
// ─────────────────────────────────────────────────────────────────────────────
const SUMMARY_SEND_DELAY_MS = 1500   // gap between WhatsApp sends (rate-limit safety)
const SUMMARY_MAX_ATTEMPTS = 2       // retries within a single drain before giving up for this run

let summaryWorkerRunning = false
const summaryQueue = []
const summaryQueued = new Set()      // de-dupe key: `${hotelId}-${businessDate}`

// Sent by this server, by the same key. last_summary_sent_date lives on the
// hotel's hms_res_setting row; a hotel without that row was never marked and
// got the summary again every minute (2026-09-26: 475 messages to 25 numbers).
const summarySent = new Set()
// A send that failed waits before the next try instead of retrying every minute.
const SUMMARY_RETRY_AFTER_MS = 30 * 60 * 1000
const summaryRetryAt = new Map()     // key -> time the next try is allowed

const enqueueSummaryJob = (job) => {
    const key = `${job.hotel.id}-${job.businessDate}`
    if (summaryQueued.has(key)) return   // already queued / in-flight
    summaryQueued.add(key)
    summaryQueue.push({ ...job, key, attempts: 0 })
}

const processSummaryQueue = async () => {
    if (summaryWorkerRunning) return     // single worker — prevents overlapping cron runs from racing
    summaryWorkerRunning = true
    try {
        while (summaryQueue.length) {
            const job = summaryQueue.shift()
            const { hotel, timeZone, businessStartTime, businessDate, setting } = job
            let ok = false
            try {
                ok = await sendRestaurantSalesSummary(hotel, timeZone, businessStartTime, businessDate)
            } catch (err) {
                console.error(`Unexpected error sending summary for hotel ${hotel.id}`, err?.message)
            }

            if (ok) {
                summarySent.add(job.key)
                summaryRetryAt.delete(job.key)
                if (setting) await setting.update({ last_summary_sent_date: businessDate })
                summaryQueued.delete(job.key)
            } else {
                job.attempts += 1
                if (job.attempts < SUMMARY_MAX_ATTEMPTS) {
                    summaryQueue.push(job)            // retry later in this same drain
                } else {
                    summaryQueued.delete(job.key)     // give up for this run; tried again after SUMMARY_RETRY_AFTER_MS
                    summaryRetryAt.set(job.key, Date.now() + SUMMARY_RETRY_AFTER_MS)
                    console.error(`Summary send failed this run for hotel ${hotel.id} (business date ${businessDate})`)
                }
            }

            await sleep(SUMMARY_SEND_DELAY_MS)
        }
    } finally {
        summaryWorkerRunning = false
    }
}

const checkAndSendClosingSummaries = async () => {
    try {
        const hotels = await Hotel.findAll({
            where: {
                active: true,
                id: { [Op.ne]: 134 }
            },
            attributes: ['id', 'hotel_name', 'owner_number', 'active'],
            include: { model: RestaurantSetting }
        })

        for (const hotel of hotels) {
            const setting = hotel.hms_res_setting
            const timeZone = setting?.timeZone || "Asia/Kolkata"
            const businessStartTime = setting?.business_day_start_time || "00:01:00"

            const [hour, minute] = businessStartTime.split(':').map(Number)
            const nowTz = moment.tz(timeZone)
            const businessStartToday = nowTz.clone().set({ hour, minute, second: 0, millisecond: 0 })

            // Business day for this hotel hasn't closed yet today → nothing to send.
            if (nowTz.isBefore(businessStartToday)) continue

            // The business day that just closed started one day before this morning's start time.
            const businessDate = businessStartToday.clone().subtract(1, 'day').format('YYYY-MM-DD')

            // Already sent for this business date (guard against duplicates).
            if (setting?.last_summary_sent_date === businessDate) continue

            // No way to deliver — skip without marking, stays visible as null for follow-up.
            if (!hotel.owner_number) continue

            // Already sent by this server (the only record for a hotel with no
            // settings row), or a failed send still waiting for its retry time.
            const key = `${hotel.id}-${businessDate}`
            if (summarySent.has(key)) continue
            if ((summaryRetryAt.get(key) || 0) > Date.now()) continue

            enqueueSummaryJob({ hotel, timeZone, businessStartTime, businessDate, setting })
        }

        // Keys from past business days are no longer needed.
        const oldest = moment().subtract(3, 'days').format('YYYY-MM-DD')
        for (const k of summarySent) if (k.slice(k.indexOf('-') + 1) < oldest) summarySent.delete(k)
        for (const k of summaryRetryAt.keys()) if (k.slice(k.indexOf('-') + 1) < oldest) summaryRetryAt.delete(k)

        // Fire-and-forget; the worker is self-guarded against overlap.
        processSummaryQueue()
    } catch (err) {
        console.log(err, "Error in checkAndSendClosingSummaries")
    }
}

const XLSX = require("xlsx");

const sendMessageToNajeria = async () => {
    try {

        const restaurant = await Hotel.findOne({ where: { id: 134 }, attributes: ['id', 'hotel_name', 'owner_number', "active"] })

        // console.log(allRestaurant, "All Restaurant ---->")
        // for (const restaurant of allRestaurant) {
        // const restaurant_id_array = [16]
        if (restaurant.active) {
            console.log(restaurant, "Restaurant ---->")

            const modifiedEnd = moment(); // current time
            const modifiedStart = moment().subtract(24, 'hours');

            console.log(modifiedStart, modifiedEnd, "Start end -")

            const startD = new Date(modifiedStart)
            const endD = new Date(modifiedEnd)

            console.log(startD, endD, "Start and End date --==-=-=>")



            // ! total Sale 

            const totalSale = await Order.sum("grandAmount", {
                where: {
                    payment: STATUS.SUCCESS, hotel_id: restaurant.id,
                    createdAt: {
                        [Op.between]: [startD, endD]
                    }, deleted: false
                }
            })
            // ! total invoice 
            const totalInvoice = await Order.count({
                where: {
                    payment: STATUS.SUCCESS, hotel_id: restaurant.id,
                    createdAt: {
                        [Op.between]: [startD, endD]
                    }, deleted: false
                }
            })


            //! total Card Payment 
            const totalCardPayment = await Order.sum("card", {
                where: {
                    payment: STATUS.SUCCESS, hotel_id: restaurant.id, createdAt: {
                        [Op.between]: [startD, endD]
                    }, deleted: false
                }
            })
            //! total Cash Payment 
            const totalCashPayment = await Order.sum("cash", {
                where: {
                    payment: STATUS.SUCCESS, hotel_id: restaurant.id, createdAt: {
                        [Op.between]: [startD, endD]
                    }, deleted: false
                }
            })

            const totalDuePayment = await Order.sum("due", {
                where: {
                    payment: STATUS.SUCCESS, hotel_id: restaurant.id, createdAt: {
                        [Op.between]: [startD, endD]
                    }, deleted: false
                }
            })
            const totalSettleDuePayment = await DuePaymentReceive.sum("amount", {
                where: {
                    hotel_id: restaurant.id, createdAt: {
                        [Op.between]: [startD, endD]
                    }, deleted: false
                }
            })

            const totalDiscount = await Order.sum("totalDiscount", {
                where: {
                    payment: STATUS.SUCCESS, hotel_id: restaurant.id, createdAt: {
                        [Op.between]: [startD, endD]
                    }, deleted: false
                }
            })



            console.log([
                { type: "text", text: restaurant.hotel_name },
                { type: "text", text: totalInvoice },
                { type: "text", text: totalSale },
                { type: "text", text: totalCashPayment },
                { type: "text", text: totalCardPayment },

                { type: "text", text: totalDiscount },
                { type: "text", text: totalDuePayment },
                { type: "text", text: totalSettleDuePayment }
            ])
            const url = `https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`;
            const headers = {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${TOKEN}`
            };
            const body = {
                messaging_product: "whatsapp",
                to: restaurant.owner_number,
                type: "template",
                template: {
                    name: "sales_summary2",
                    language: { code: "en" },
                    components: [
                        {
                            type: "body",
                            parameters: [
                                { type: "text", text: restaurant.hotel_name || '' },
                                { type: "text", text: totalInvoice || '0' },
                                { type: "text", text: totalSale || '0' },
                                { type: "text", text: totalCashPayment || '0' },
                                { type: "text", text: totalCardPayment || '0' },
                                { type: "text", text: totalDiscount || '0' },
                                { type: "text", text: totalDuePayment || '0' },
                                { type: "text", text: totalSettleDuePayment || '0' }
                            ]
                        }
                    ]
                }
            };

            axios.post(url, body, { headers })
                .then(response => {
                    console.log(response.data);
                })
                .catch(error => {
                    console.error(error);
                });

            // }

        }
        return

    } catch (err) {
        console.log(err)
        return error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR)
    }
}
const CustomerFeedBackSendMessage = async (req, res) => {
    try {
        const filePath = path.join(__dirname, "..", "public", "images", "customerFeedBack.xlsx");
        const fileBuffer = fs.readFileSync(filePath);

        // Read the Excel file
        const workbook = xlsx.read(fileBuffer, { type: "buffer" });
        const sheetName = workbook.SheetNames[0];

        console.log("Sheet Names:", workbook.SheetNames);

        const sheetData = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], {
            header: 1, // Read as an array of rows
            defval: "" // Preserve empty cells
        });
        if (!sheetData.length) {
            return res.status(400).json({ error: "Excel file is empty" });
        }
        const headers1 = sheetData[0]; // First row is headers
        const rows = sheetData.slice(1); // Remaining rows

        const jsonData = rows.map(row => {
            let obj = {};
            headers1.forEach((key, index) => {
                obj[key] = row[index] || "";
            });
            return obj;
        });

        console.log("Parsed JSON Data:", jsonData);
        for (const row of jsonData) {
            // console.log(row)
            let { contact_number } = row;
            if (typeof (contact_number) === "string") {
                contact_number = contact_number.replace(/\D/g, ''); // Remove non-digit characters
            }
            contact_number = Number(contact_number)

            if (contact_number) {

                const url = `https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`;
                const headers = {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${TOKEN}`
                };
                console.log(path.join(__dirname, "..", "public", "images", "atithi.jpeg"))
                const body = {
                    messaging_product: "whatsapp",
                    to: `${contact_number}`, // include country code
                    type: "template",
                    template: {
                        name: "feedback",
                        language: { code: "en" },
                        components: [
                            {
                                type: "header",
                                parameters: [
                                    {
                                        type: "image",
                                        image: { link: "https://backend.billerpe.com/images/customerFeedBack.jpeg" } // Path to the image file
                                    }
                                ]
                            }
                        ]
                    }
                };


                axios.post(url, body, { headers })
                    .then(response => {
                        //createLogFile("customerFeedBack", `${contact_number} - ${response.data}`, "customerFeedBack")
                        console.log(response.data);
                    })
                    .catch(error => {
                        console.error(error.response.data, "Error in sending message");
                    });
            }
        }



        // }

        // }
        return res.json(success(MESSAGE.SUCCESS, { message: "SMS SuccessFully Sent" }, STATUSCODE.SUCCESS))

    } catch (err) {
        console.log(err)
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

const getAllWhatsappTemplates = async (req, res) => {
    try {
        const templates = await WhatsappTemplate.findAll({
            where: {
                active: true,
            },
            attributes: [
                "id",
                "name",
                "params",
                "active",
                "createdAt",
                "updatedAt",
            ],
            order: [["createdAt", "DESC"]],
        });
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { templates }, STATUSCODE.SUCCESS))

    } catch (err) {
        console.error("Error fetching WhatsApp templates:", err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))

    }
};
const createWhatsAppTemplate = async (req, res) => {
    try {
        const { name, params } = JSON.parse(req.body.data)
        let default_image = ''
        if (req.file) {
            // default_image = req.file.location
            default_image = `${process.env.SUPER_URL}/images/${req.file.filename}`
        }
        // console.log(req.file, "file::")
        // return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, {}, STATUSCODE.SUCCESS))
        console.log(req.body, "Body Dta:::")
        const checkname = await WhatsappTemplate.findOne({ where: { name } })
        if (checkname) {
            return res.json(error("This Name Already available", STATUSCODE.BAD_REQUEST))
        }
        await WhatsappTemplate.create({ name, params, default_image })
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { message: "Template Created SuccessFully" }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err, "error While Creating WhatsApp Template")
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const updateWhatsAppTemplate = async (req, res) => {
    try {
        console.log(req.body.data)
        let data = req.body.data;

        // ✅ SAFE PARSE
        console.log(typeof data)
        if (typeof data === "string") {
            data = JSON.parse(data);
        }

        const { id, name, params, active } = data;
        const checkTemplate = await WhatsappTemplate.findByPk(+id)
        console.log(checkTemplate)
        if (!checkTemplate)
            return res.json(error("Template Not found", STATUSCODE.BAD_REQUEST))
        let default_image = checkTemplate.default_image
        // let default_image = ''
        if (req.file) {
            // default_image = req.file.location
            default_image = `${process.env.SUPER_URL}/images/${req.file.filename}`
        }

        if (checkTemplate.name !== name) {
            const checkSecond = await WhatsappTemplate.findOne({
                where: {
                    name,
                    id: { [Op.ne]: id }
                }
            });

            if (checkSecond) {
                return res.json(
                    error("This Template Already Available", STATUSCODE.BAD_REQUEST)
                );
            }
        }

        await checkTemplate.update({
            name,
            params,
            active,
            default_image
        });
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { message: "Template Updated SuccessFully" }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err, "error While Updating WhatsApp Template")
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const deleteWhatsAppTemplate = async (req, res) => {
    try {
        const { id } = req.body
        const finddata = await WhatsappTemplate.findByPk(id)
        if (!finddata) return res.json(error("Template Not Found", STATUSCODE.BAD_REQUEST))

        await finddata.update({ active: false })
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { message: "Templated deleted SuccessFully" }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err, "error While Deleting Template")
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

const sendWhatsappMessage = async (req, res) => {
    try {
        const { template_id, to, values } = req.body;

        /* ------------------ Basic Validation ------------------ */
        if (!template_id || !to || !Array.isArray(values)) {
            return res.status(STATUSCODE.BAD_REQUEST).json(
                error("template_id, to, and values are required", STATUSCODE.BAD_REQUEST)
            );
        }

        if (isEmpty(to)) {
            return res.status(STATUSCODE.BAD_REQUEST).json(
                error("Mobile number is required", STATUSCODE.BAD_REQUEST)
            );
        }

        /* ------------------ Fetch Template ------------------ */
        const template = await WhatsappTemplate.findByPk(template_id);

        if (!template || !template.active) {
            return res.status(STATUSCODE.BAD_REQUEST).json(
                error("Template not found or inactive", STATUSCODE.BAD_REQUEST)
            );
        }

        if (values.length !== template.params.length) {
            return res.status(STATUSCODE.BAD_REQUEST).json(
                error(
                    `This template requires exactly ${template.params.length} parameters`,
                    STATUSCODE.BAD_REQUEST
                )
            );
        }

        /* ------------------ Validate Values ------------------ */
        for (let i = 0; i < template.params.length; i++) {
            if (isEmpty(values[i])) {
                return res.status(STATUSCODE.BAD_REQUEST).json(
                    error(
                        `Parameter '${template.params[i].name}' cannot be empty`,
                        STATUSCODE.BAD_REQUEST
                    )
                );
            }
        }

        /* ------------------ Build Params ------------------ */
        const bodyParameters = values.map((val, i) => ({
            type: template.params[i].type || "text",
            text: String(val),
        }));

        const { url, headers, body } = whatsAppBody(
            template.name,
            bodyParameters,
            to,
            template.default_image || ""
        );

        const waResponse = await axios.post(url, body, { headers });

        return res.status(STATUSCODE.SUCCESS).json(
            success(
                MESSAGE.SUCCESS,
                {
                    whatsapp_message_id:
                        waResponse?.data?.messages?.[0]?.id || null,
                },
                STATUSCODE.SUCCESS
            )
        );
    } catch (err) {
        console.error("WhatsApp send error:", err.response?.data || err.message);

        return res.status(STATUSCODE.BAD_REQUEST).json(
            error(
                err.response?.data?.error?.message || MESSAGE.INTERNAL_SERVER_ERROR,
                STATUSCODE.BAD_REQUEST
            )
        );
    }
};
const isEmpty = (val) =>
    val === undefined || val === null || String(val).trim() === "";

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const sendBulkWhatsappMessage = async (req, res) => {
    try {
        const { template_id } = req.body;
        const file = req.file;

        /* ------------------ Basic Validation ------------------ */
        if (!template_id || !file) {
            return res.status(STATUSCODE.BAD_REQUEST).json(
                error("template_id and Excel/CSV file are required", STATUSCODE.BAD_REQUEST)
            );
        }

        /* ------------------ Fetch Template ------------------ */
        const template = await WhatsappTemplate.findByPk(template_id);

        if (!template || !template.active) {
            return res.status(STATUSCODE.BAD_REQUEST).json(
                error("Template not found or inactive", STATUSCODE.BAD_REQUEST)
            );
        }

        /* ------------------ Read Excel / CSV ------------------ */
        const filePath = path.join(__dirname, "..", file.path);
        const fileBuffer = fs.readFileSync(filePath);

        const workbook = xlsx.read(fileBuffer, { type: "buffer" });
        const sheetName = workbook.SheetNames[0];

        const sheetData = xlsx.utils.sheet_to_json(
            workbook.Sheets[sheetName],
            { header: 1, defval: "" }
        );

        if (!sheetData.length || sheetData.length < 2) {
            fs.unlinkSync(filePath);
            return res.status(STATUSCODE.BAD_REQUEST).json(
                error("Excel file is empty", STATUSCODE.BAD_REQUEST)
            );
        }

        /* ------------------ Extract Header & Rows ------------------ */
        const headers = sheetData[0].map(h => String(h).trim());
        const rows = sheetData.slice(1);

        /* ------------------ Validate Required Columns ------------------ */
        const requiredColumns = ["mobile", ...template.params.map(p => p.name)];

        for (const col of requiredColumns) {
            if (!headers.includes(col)) {
                fs.unlinkSync(filePath);
                return res.status(STATUSCODE.BAD_REQUEST).json(
                    error(`Missing required column: ${col}`, STATUSCODE.BAD_REQUEST)
                );
            }
        }

        /* ------------------ Build Column Index Map ------------------ */
        const columnIndexMap = {};
        headers.forEach((h, i) => {
            columnIndexMap[h] = i;
        });

        const successRows = [];
        const failedRows = [];

        /* ------------------ Process Rows ------------------ */
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];

            try {
                const mobile = row[columnIndexMap.mobile];

                if (isEmpty(mobile)) {
                    throw new Error("Mobile number is empty");
                }

                /* ---- Extract & validate template values ---- */
                const values = template.params.map(p => {
                    const val = row[columnIndexMap[p.name]];
                    if (isEmpty(val)) {
                        throw new Error(`Column '${p.name}' is empty`);
                    }
                    return val;
                });

                /* ---- Build WhatsApp body params ---- */
                const bodyParameters = values.map((val, idx) => ({
                    type: template.params[idx].type || "text",
                    text: String(val),
                }));

                /* ---- Build WhatsApp payload ---- */
                const { url, headers: waHeaders, body } = whatsAppBody(
                    template.name,
                    bodyParameters,
                    String(mobile),
                    template.default_image || ""
                );

                /* ---- Send WhatsApp message ---- */
                const waResponse = await axios.post(url, body, { headers: waHeaders });

                successRows.push({
                    row: i + 2, // actual Excel row number
                    mobile,
                    whatsapp_message_id:
                        waResponse?.data?.messages?.[0]?.id || null,
                });

                /* ---- WhatsApp rate-limit safe delay ---- */
                await sleep(1200);

            } catch (rowError) {
                failedRows.push({
                    row: i + 2,
                    mobile: row[columnIndexMap.mobile] || "",
                    error: rowError.message,
                });
            }
        }

        /* ------------------ Cleanup ------------------ */
        fs.unlinkSync(filePath);

        /* ------------------ Final Response ------------------ */
        return res.status(STATUSCODE.SUCCESS).json(
            success(
                MESSAGE.SUCCESS,
                {
                    total: rows.length,
                    success: successRows.length,
                    failed: failedRows.length,
                    successRows,
                    failedRows,
                },
                STATUSCODE.SUCCESS
            )
        );
    } catch (err) {
        console.error("Bulk WhatsApp error:", err);

        return res.status(STATUSCODE.INTERNAL_SERVER_ERROR).json(
            error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR)
        );
    }
};
const downloadSampleExcel = async (req, res) => {
    const { template_id } = req.body;

    const template = await WhatsappTemplate.findByPk(template_id);
    if (!template) {
        return res.status(400).json({ message: "Template not found" });
    }

    const headers = ["mobile", ...template.params.map(p => p.name)];
    const sampleRow = headers.reduce((a, c) => ({ ...a, [c]: "" }), {});

    const ws = XLSX.utils.json_to_sheet([sampleRow]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Sample");

    const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    res.setHeader("Content-Disposition", "attachment; filename=sample.xlsx");
    res.setHeader("Content-Type", "application/octet-stream");
    res.send(buffer);
};

const sendTicketInWhatsApp = async(req,res)=>{

} 

module.exports = { downloadSampleExcel, downloadSampleExcel, deleteWhatsAppTemplate, updateWhatsAppTemplate, createWhatsAppTemplate, sendBulkWhatsappMessage, getAllWhatsappTemplates, sendWhatsappMessage, sendMessageToNajeria, dailySendToClientTotalSales, CustomerFeedBackSendMessage, checkAndSendClosingSummaries }