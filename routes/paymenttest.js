const axios = require('axios');
const { MESSAGE, STATUSCODE } = require('../constant/const');
const { success, error } = require('../responce/res');

const webSitePayment = (req, res) => {
    try {


        const requestBodyJson = {
            client_id: "SU2509121030282437979126", client_version: 1, client_secret: "997c5303-bb49-4a12-9099-360d2a3caf3f", grant_type: "client_credentials",
            "client_version": 1,
            "grant_type": "client_credentials"
        };
        const requestHeaders = {
            "Content-Type": "application/x-www-form-urlencoded"
        };
        const requestBody = new URLSearchParams(requestBodyJson).toString();

        const options = {
            method: 'POST',
            url: 'https://api.phonepe.com/apis/identity-manager/v1/oauth/token',
            headers: requestHeaders,
            data: requestBody
        };

        axios.request(options)
            .then(function (response) {

                console.log(response)
                const requestHeaders = {
                    "Content-Type": "application/json",
                    'Authorization': `O-Bearer ${response.data.access_token}`

                };

                const requestBody = {
                    "amount": 1000,
                    "expireAfter": 1200,
                    "merchantOrderId": `testdb1${new Date().getMilliseconds()}`,

                    "metaInfo": {
                        "udf1": "additional-information-1",
                        "udf2": "additional-information-2",
                        "udf3": "additional-information-3",
                        "udf4": "additional-information-4",
                        "udf5": "additional-information-5",

                    },
                    "paymentFlow": {
                        "type": "PG_CHECKOUT",
                        "message": "Payment message used for collect requests",
                        "merchantUrls": {
                            "redirectUrl": "",

                        },

                    }
                };

                const options = {
                    method: 'POST',
                    url: 'https://api.phonepe.com/apis/pg/checkout/v2/pay',
                    headers: requestHeaders,
                    data: requestBody
                };

                axios.request(options)
                    .then(function (response) {
                        console.log(response, "responce:::::")
                        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, response.data, STATUSCODE.SUCCESS));
                    })
                    .catch(function (err) {
                        console.log(err);
                        return res.status(STATUSCODE.INTERNAL_SERVER_ERROR)
                            .json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
                    });
            })
            .catch(function (err) {
                console.log(err);
                return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
            });
    } catch (err) {
        console.log(err)
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

module.exports = { webSitePayment }