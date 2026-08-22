const Order = require("../../model/order")
const Item = require("../../model/menu")
const Cart = require("../../model/cart")
const sequelize = require("sequelize")
const { Op } = require("sequelize")
const { STATUSCODE, MESSAGE, STATUS, ORDER_TYPE, ORDER_DETAILS_TYPE } = require("../../constant/const")
const { error, success, mobileSuccess, mobileError } = require("../../responce/res")
const Menu = require("../../model/menu")
const TableCatagories = require("../../model/table_catg")
const Table = require("../../model/table")
const User = require("../../model/user")
const OrderDetails = require("../../model/order_details")
const Hotel = require("../../model/hotel")
const moment = require("moment")
const Menu_categ = require("../../model/menu_categ")
const { createLogFile } = require("../../logs/log")
const Variants = require("../../model/variants")
const AddonDepartment = require("../../model/addonDepartMent")
const Addons = require("../../model/addons")

const mobileMenu = async (req, res) => {
    try {
        const id = req.user
        const { key } = req.params
        const hotel = await Hotel.findOne({ where: { id } })
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST))
        let menu
        if (key === "all") {
            menu = await Menu_categ.findAll({
                where: {
                    hotel_id: req.user,
                    active: true
                },
                include: [{
                    model: Menu, where: {
                        hotel_id: req.user, active: true
                    }, include: [{ model: Variants, as: "variantData", where: { active: true }, required: false }, { model: AddonDepartment, as: "addonDepartmentData", include: { model: Addons } }]
                }]
            })
        } else {
            menu = await Menu_categ.findAll({
                where: {
                    hotel_id: req.user,
                    active: true
                },
                include: [{
                    model: Menu, where: {
                        hotel_id: req.user, active: true, sub_categories: key
                    }, include: [{ model: Variants, as: "variantData", where: { active: true }, required: false }, { model: AddonDepartment, as: "addonDepartmentData", include: { model: Addons } }]
                }]
            })

        }


        return res.status(STATUSCODE.SUCCESS).json(mobileSuccess(MESSAGE.SUCCESS, { menu }, "", STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err, "=====>error")
        //createLogFile(req.user, `Getting mobileMenu /err Error`, err);
        return res.status(STATUSCODE.INTERNAL_SERVER_ERROR).json(mobileError(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const mobileCategory = async (req, res) => {
    try {
        const id = req.user
        const { key } = req.params
        const hotel = await Hotel.findOne({ where: { id } })
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST))
        let menu
        if (key === "all") {
            menu = await Menu.findAll({
                where: {
                    hotel_id: req.user,
                    active: true
                },
                include: [{ model: Menu_categ }, { model: Variants, as: "variantData", where: { active: true }, required: false }, { model: AddonDepartment, as: "addonDepartmentData", include: { model: Addons } }]
            })


        } else {

            menu = await Menu.findAll({
                where: {
                    hotel_id: req.user,
                    item_name: {
                        [Op.like]: `%${key.toLowerCase()}%`, // Case-insensitive search for the product name
                    },

                    active: true
                },
                include: [{ model: Menu_categ }, { model: Variants, as: "variantData", where: { active: true }, required: false }, { model: AddonDepartment, as: "addonDepartmentData", include: { model: Addons } }]
            })


        }


        return res.status(STATUSCODE.SUCCESS).json(mobileSuccess(MESSAGE.SUCCESS, { menu }, "", STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err, "=====>error")
        //createLogFile(req.user, `Getting mobileCategory /err Error`, err);
        return res.status(STATUSCODE.INTERNAL_SERVER_ERROR).json(mobileError(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}


module.exports = { mobileMenu, mobileCategory }