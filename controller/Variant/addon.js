

const sequelize = require("../../connection/connect")
const { MESSAGE, STATUSCODE } = require("../../constant/const")
const AddonDepartment = require("../../model/addonDepartMent")
const Addons = require("../../model/addons")
const Hotel = require("../../model/hotel")
const Variants = require("../../model/variants")
const { error, success } = require("../../responce/res")


const createAddonDepartment = async (req, res) => {
    const t = await sequelize.transaction()
    try {
        const { department_name, maximum_allowed_addon, minimum_allowed_addon, singleSelection, addons, menu_catalog_id } = req.body
        const findVariantAvailable = await AddonDepartment.findOne({ where: { department_name, hotel_id: req.user }, attributes: ['id'], transaction: t },)

        if (!findVariantAvailable) {

            if (addons.length < maximum_allowed_addon) {
                await t.rollback()
                return res.json(error("Maximum Allowed Addon Less Or Equal to Number Of Addon item", STATUSCODE.BAD_REQUEST))
            }
            if (maximum_allowed_addon < minimum_allowed_addon) {
                await t.rollback()
                return res.json(error("Minimum value should not be greater than Maximum value", STATUSCODE.BAD_REQUEST))
            }

            const department = await AddonDepartment.create({ department_name, maximum_allowed_addon, minimum_allowed_addon, singleSelection, hotel_id: req.user, ...(menu_catalog_id ? { menu_catalog_id } : {}) }, { transaction: t })
            const addonData = []
            for (const cur of addons) {
                const { addon_name, price, attributes = 'veg' } = cur
                const addonObject = { addon_name, price, attributes, department_id: department.id, hotel_id: req.user }
                addonData.push(addonObject)
            }
            if (addonData.length) {
                await Addons.bulkCreate(addonData, { transaction: t })
            } else {
                await t.rollback()
                return res.json(error("Please Add Some Addons Items", STATUSCODE.BAD_REQUEST))
            }
            const findAvailableAddons = await AddonDepartment.findAll({ where: { hotel_id: req.user }, attributes: ['id', 'department_name', "maximum_allowed_addon", "singleSelection", "minimum_allowed_addon", "menu_catalog_id"], include: { model: Addons, attributes: ['id', 'addon_name', 'price', 'attributes'] }, transaction: t })
            await t.commit()
            return res.status(STATUSCODE.CREATED).json(success(MESSAGE.SUCCESS, { message: "Addon Created Created Succssefully", addons: findAvailableAddons }, STATUSCODE.CREATED))
        } else {

            await t.rollback()
            return res.json(error("Department Name Already Available", STATUSCODE.BAD_REQUEST))
        }

    } catch (err) {
        await t.rollback()
        console.log(err)
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const updatedAddons = async (req, res) => {
    const t = await sequelize.transaction()
    try {
        const { department_name, maximum_allowed_addon, minimum_allowed_addon, singleSelection, addons, id, menu_catalog_id } = req.body
        const findAddonDepartmentAvailable = await AddonDepartment.findByPk(id, { transaction: t })
        if (!findAddonDepartmentAvailable) {
            await t.rollback()
            return res.json(error("Addon Department Not Found", STATUSCODE.BAD_REQUEST))
        }
        await AddonDepartment.update({ department_name, maximum_allowed_addon, minimum_allowed_addon, singleSelection, ...(menu_catalog_id ? { menu_catalog_id } : {}) }, { where: { id, hotel_id: req.user }, transaction: t })
        await Addons.destroy({ where: { department_id: id, hotel_id: req.user }, transaction: t })
        if (addons.length < maximum_allowed_addon) {
            await t.rollback()
            return res.json(error("Maximum Allowed Addon Less Or Equal to Number Of Addon item", STATUSCODE.BAD_REQUEST))
        }
        if (maximum_allowed_addon < minimum_allowed_addon) {
            await t.rollback()
            return res.json(error("Minimum value should not be greater than Maximum value", STATUSCODE.BAD_REQUEST))
        }
        const addonData = []
        for (const cur of addons) {
            const { addon_name, price, attributes = 'veg' } = cur
            const addonObject = { addon_name, price, attributes, department_id: id, hotel_id: req.user }
            addonData.push(addonObject)
        }
        if (addonData.length) {
            await Addons.bulkCreate(addonData, { transaction: t })
        } else {
            await t.rollback()
            return res.json(error("Please Add Some Addons Items", STATUSCODE.BAD_REQUEST))
        }
        const findAvailableAddons = await AddonDepartment.findAll({ where: { hotel_id: req.user }, attributes: ['id', 'department_name', "maximum_allowed_addon", "singleSelection", "minimum_allowed_addon", "menu_catalog_id"], include: { model: Addons, attributes: ['id', 'addon_name', 'price', 'attributes'] }, transaction: t })
        await t.commit()

        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { message: "Addons Updated Succssefully", addons: findAvailableAddons }, STATUSCODE.SUCCESS))

    } catch (err) {
        await t.rollback()
        console.log(err)
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

const getAllAddons = async (req, res) => {
    try {
        const hotel = await Hotel.findByPk(req.user, { attributes: ['id'] })
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST))
        const findAvailableAddons = await AddonDepartment.findAll({ where: { hotel_id: req.user }, attributes: ['id', 'department_name', "maximum_allowed_addon", "singleSelection", "minimum_allowed_addon", "menu_catalog_id"], include: { model: Addons, attributes: ['id', 'addon_name', 'price', 'attributes'] } })
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { addons: findAvailableAddons }, STATUSCODE.SUCCESS))
    } catch (err) {

        console.log(err)
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

module.exports = { getAllAddons, createAddonDepartment, updatedAddons }