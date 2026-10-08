const { MESSAGE, STATUSCODE } = require("../../constant/const")
const webSiteUserData = require("../../model/webSiteUserData")
const intake = require("../../adminv1/crm/intake")
const { error, success } = require("../../responce/res")
const axios = require("axios")

const WHATSAPP_URL = `https://graph.facebook.com/v22.0/${process.env.WHATSAPPPHONEID}/messages`

const WHATSAPP_HEADERS = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${process.env.WHATSAPPTOKEN}`
}

const sendWhatsAppMessage = async (name, phone_number) => {
    const now = new Date();

    let hours = now.getHours();
    let minutes = now.getMinutes();

    const period = hours >= 12 ? "PM" : "AM";
    hours = hours % 12 || 12;
    minutes = minutes.toString().padStart(2, "0");

    const body = {
        messaging_product: "whatsapp",
        to: `${phone_number}`,
        type: "template",
        template: {
            name: "billerpe_inquiry_update",
            language: { code: "en" },
            components: [
                {
                    type: "body",
                    parameters: [
                        { type: "text", text: name || '' },
                        { type: "text", text: hours || '0' },
                        { type: "text", text: ":" },
                        { type: "text", text: minutes || '0' },
                        { type: "text", text: period || '0' },
                    ]
                }
            ]
        }
    };

    axios.post(WHATSAPP_URL, body, { headers: WHATSAPP_HEADERS })
        .then(response => {
            console.log(response.data);
        })
        .catch(error => {
            console.error(error.response.data, "Error in sending message");
        });
}

const sendAdminNotifications = (name, phone_number, email, message) => {
    // Never from a test server (a *_test database or DISABLE_CRON=1, as the
    // scheduled jobs in server.js): these go to real phones.
    if (process.env.DISABLE_CRON === "1" || /_test$/.test(process.env.DATABASE_NAME || "")) {
        console.log("[admin whatsapp] skipped on a test server:", name, message);
        return;
    }
    const adminNumbers = ['8866484190', '8490900456']
    // const adminNumbers = ['7434993463']

    for (const num of adminNumbers) {
        const body = {
            messaging_product: "whatsapp",
            to: num,
            type: "template",
            template: {
                name: "order_inquiry",
                language: { code: "en" },
                components: [
                    {
                        type: "body",
                        parameters: [
                            { type: "text", text: name || 'no name' },
                            { type: "text", text: phone_number || '0' },
                            { type: "text", text: email || '0' },
                            { type: "text", text: message || '0' },
                        ]
                    }
                ]
            }
        };

        axios.post(WHATSAPP_URL, body, { headers: WHATSAPP_HEADERS })
            .then(response => {
                console.log(response.data);
            })
            .catch(error => {
                console.error(error.response.data, "Error in sending message");
            });
    }
}

const storeWebsiteUserData = async (req, res) => {
    try {
        const { name, phone_number, email, message } = req.body
        let checkUserAvailable = await webSiteUserData.findOne({ where: { phone_number } })
        if (!checkUserAvailable) {
            checkUserAvailable = await webSiteUserData.create({ name, phone_number, email, message })
            await sendWhatsAppMessage(name, phone_number)
            sendAdminNotifications(name, phone_number, email, message)
        }
        // SuperAdmin sales CRM: every inquiry, first or repeat. A known
        // number joins its lead (and reopens it if it was lost).
        await intake.receiveSafely({ source: "website", name, phone: phone_number, email, message, sourceDetail: { websiteUserId: checkUserAvailable.id, page: req.body.page || null } })

        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { user: checkUserAvailable, message: "User Data Stored Succssefully" }, STATUSCODE.SUCCESS))

    } catch (err) {
        console.log(err)
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}


module.exports = { storeWebsiteUserData,sendAdminNotifications }
