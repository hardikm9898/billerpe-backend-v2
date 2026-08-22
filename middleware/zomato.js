

const crypto = require("crypto");
const { STATUSCODE } = require("../constant/const");
const { error } = require("../responce/res");

require("dotenv").config()

function generateOneTimeSignature() {
    const signature = crypto
        .createHmac('sha256', process.env.ZOMATO_SECRET_KEY)
        .update(process.env.ZOMATO_API_KEY)
        .digest('hex');
    console.log('Your generated signature:', signature);
    return signature;
}

function validateSignature(req, res, next) {
    const providedSignature = req.headers['api-key'];
    console.log(providedSignature, "data:::")
    if (!providedSignature) {
        return res.status(STATUSCODE.UNAUTHORIZED).json(error('Not Authorized', STATUSCODE.UNAUTHORIZED))
        // return res.status(401).json({ error: 'Missing Api-key header' });
    }

    const expectedSignature = crypto
        .createHmac('sha256', process.env.ZOMATO_SECRET_KEY)
        .update(process.env.ZOMATO_API_KEY)
        .digest('hex');
    console.log(expectedSignature, "expected:::")
    if (providedSignature !== expectedSignature) {
        return res.status(STATUSCODE.UNAUTHORIZED).json(error('Not Authorized', STATUSCODE.UNAUTHORIZED))

    }

    next();
}

generateOneTimeSignature()
module.exports = { validateSignature }