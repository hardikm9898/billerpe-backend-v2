const { MESSAGE, STATUSCODE } = require("../../constant/const")
const webSiteUserData = require("../../model/webSiteUserData")
const { CrmLead } = require("../../model")
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
            await CrmLead.create({
                name,
                phone_number,
                email,
                message,
                source: "website",
                status: "NEW",
                priority: "P3",
                website_user_id: checkUserAvailable.id,
            })
        }

        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { user: checkUserAvailable, message: "User Data Stored Succssefully" }, STATUSCODE.SUCCESS))

    } catch (err) {
        console.log(err)
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}


module.exports = { storeWebsiteUserData,sendAdminNotifications }
