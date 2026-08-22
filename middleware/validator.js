const { isSchema } = require("joi")
const { STATUSCODE, MESSAGE } = require("../constant/const")
const { success, error } = require("../responce/res")


const validator = (schema) => async (req, res, next) => {
    // console.log(req.body)
    const err = await schema.validate(req.body).error
    const valid = err == null
    if (valid) {
        next()
    }
    else {
        // console.log(error)
        // console.log(err, "error==>")
        const message = err.details.map((detail) => detail.message).join(",");
        return res.json(error(message, STATUSCODE.VALIDATION_ERROR))
    }
}
const queryValidator = (schema) => async (req, res, next) => {
    console.log(req.query, "query")
    const err = await schema.validate(req.query).error
    const valid = err == null
    if (valid) {
        next()
    }
    else {
        // console.log(error)
        // console.log(err, "error==>")
        const message = err.details.map((detail) => detail.message).join(",");
        return res.json(error(message, STATUSCODE.VALIDATION_ERROR))
    }
}

module.exports = { validator, queryValidator }