
const { error, success } = require("../responce/res")
const { STATUSCODE, MESSAGE } = require("../constant/const")
const TaxType = require("../model/taxType")


const createTaxType = async (req, res) => {
    try {
        const { tax_name, tax_value, amount, order_type, active, menu_ids, table_categ_ids } = req.body
        const checkName = await TaxType.findOne({ where: { tax_name, hotel_id: req.user } })

        if (checkName) return res.json(error("This Tax Name Are Already Exist", STATUSCODE.BAD_REQUEST))
        await TaxType.create({ tax_name, tax_value, amount, order_type, menu_ids, table_categ_ids, hotel_id: req.user })

        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { message: "Tax Type Created Sucssesfully" }, STATUSCODE.SUCCESS))



    } catch (err) {
        console.log("Create Tax Error::", err)
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))

    }
}
const editTaxType = async (req, res) => {
    try {

        const { tax_name, tax_value, amount, order_type, active, id, menu_ids, table_categ_ids } = req.body
        const checkName = await TaxType.findByPk(id)
        if (!checkName) return res.json(error("Tax Type Not Found", STATUSCODE.BAD_REQUEST))
        const updateObject = {}
        if (tax_name) updateObject.tax_name = tax_name
        if (tax_value) updateObject.tax_value = tax_value
        if (amount) updateObject.amount = amount
        if (order_type) updateObject.order_type = order_type
        if (order_type.length) updateObject.order_type = order_type
        if (active) updateObject.active = active
        if (menu_ids.length) updateObject.menu_ids = menu_ids
        if (table_categ_ids.length) updateObject.table_categ_ids = table_categ_ids
        await TaxType.update(updateObject, { where: { id } })

        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { mesasage: "Tax Type Updated Sucssesfully" }, STATUSCODE.SUCCESS))




    } catch (err) {
        console.log("edit Tax type Error:::", err)
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const getTaxtType = async (req, res) => {
    try {
        const taxtTypes = await TaxType.findAll({ where: { hotel_id: req.user } })
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { taxtTypes }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log("getinng Tax Error::", err)
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
// const deleteTaxType = async(req)
module.exports = { getTaxtType, editTaxType, createTaxType }