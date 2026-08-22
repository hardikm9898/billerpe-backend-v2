const { MESSAGE, STATUSCODE } = require("../constant/const")
const { error } = require("../responce/res")

export const errorHandling = async (method) => {
    return (req, res) => {

        try {
            method(req, res)
        } catch (err) {
            console.log(err)
            //createLogFile(req.user, `Internal Server Error  `, { err })
            return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
        }
    }
}

