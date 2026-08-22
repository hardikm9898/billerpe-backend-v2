const sequelize = require("../connection/connect")
const { STATUSCODE, MESSAGE } = require("../constant/const")
const PrinterSetting = require("../model/printer_setting")
const { error, success } = require("../responce/res")
const { printerSchema } = require("../validation/validate")

const setPrinterSetting = async (req, res) => {
    const t = await sequelize.transaction()
    try {

        const { printer_name, printer_size, print_type, number_of_copies } = req.body
        // const findPrinter = await PrinterSetting.findByPk(id, { transaction: t })
        // if (!findPrinter) {
        //     await t.rollback()
        //     return res.json(error("Printer Not Found", STATUSCODE.BAD_REQUEST))
        // }
        const printer = await PrinterSetting.create({ printer_name, printer_size, print_type, number_of_copies, table_ids: [], menu_categ_ids: [], item_ids: [], order_type: [], hotel_id: req.user, default: true })
        // console.log(printer)
        await t.commit()
        return res.json(success(MESSAGE.SUCCESS, { message: "Printer Added" }, STATUSCODE.SUCCESS))

        // const { primaryPrinters, formValue } = req.body
        // const { K, I, multi } = formValue
        // if (!K & !I) {
        //     await t.rollback()
        //     return res.json(error(MESSAGE.P_S_D_P, STATUSCODE.BAD_REQUEST))
        // }

        // console.log(K, I, multi)
        // if (!multi) {
        //     if (!K.printer_name) {
        //         await t.rollback()
        //         return res.json(error(MESSAGE.D_P_R, STATUSCODE.BAD_REQUEST))
        //     }
        //     if (!I.printer_name) {
        //         await t.rollback()
        //         return res.json(error(MESSAGE.D_P_R, STATUSCODE.BAD_REQUEST))
        //     }
        //     await PrinterSetting.destroy({ where: { hotel_id: req.user }, transaction: t })
        //     K.multi = false,
        //         K.default = true
        //     K.print_type = "K",
        //         K.hotel_id = req.user
        //     K.menu_categ_id = 1
        //     console.log(K)
        //     await PrinterSetting.create(K, { transaction: t })
        //     I.multi = false,
        //         I.default = true
        //     I.print_type = "I",
        //         I.hotel_id = req.user
        //     I.menu_categ_id = 1
        //     console.log(I)
        //     await PrinterSetting.create(I, { transaction: t })
        //     await t.commit()
        //     return res.json(success(MESSAGE.SUCCESS, { message: "Printer Set" }, STATUSCODE.SUCCESS))
        // }

        // else {

        //     if (!K.printer_name) {
        //         await t.rollback()
        //         return res.json(error(MESSAGE.D_P_R, STATUSCODE.BAD_REQUEST))
        //     }
        //     if (!I.printer_name) {
        //         await t.rollback()
        //         return res.json(error(MESSAGE.D_P_R, STATUSCODE.BAD_REQUEST))
        //     }

        //     await PrinterSetting.destroy({ where: { hotel_id: req.user }, transaction: t })

        //     K.multi = true,
        //         K.default = true
        //     K.print_type = "K",
        //         K.hotel_id = req.user
        //     K.menu_categ_id = 1
        //     await PrinterSetting.create(K, { transaction: t })
        //     I.multi = true,
        //         I.default = true
        //     I.print_type = "I",
        //         I.hotel_id = req.user
        //     I.menu_categ_id = 1
        //     await PrinterSetting.create(I, { transaction: t })


        //     for (const cur of primaryPrinters) {

        //         if (!cur.menu_categ_id) {
        //             await t.rollback()
        //             return res.json(error(MESSAGE.P_S_C, STATUSCODE.BAD_REQUEST))
        //         }
        //         if (!cur.printer_name) {
        //             await t.rollback()
        //             return res.json(error(MESSAGE.P_N_R, STATUSCODE.BAD_REQUEST))
        //         }
        //         if (!cur.printer_name) {
        //             await t.rollback()
        //             return res.json(error(MESSAGE.P_N_R, STATUSCODE.BAD_REQUEST))
        //         }

        //         cur.multi = true
        //         cur.hotel_id = req.user
        //         cur.print_type = 'K'
        //         cur.default = false
        //         await PrinterSetting.create(cur, { transaction: t })
        //     }

        //     await t.commit()
        //     return res.json(success(MESSAGE.SUCCESS, { message: "Printer Set" }, STATUSCODE.SUCCESS))
        // }



    } catch (err) {
        await t.rollback()
        console.log(err)
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const EditPrinterSetting = async (req, res) => {
    const t = await sequelize.transaction()
    try {
        const { printer_name, printer_size, print_type, number_of_copies, id } = req.body
        const findPrinter = await PrinterSetting.findByPk(id, { transaction: t })
        if (!findPrinter) {
            await t.rollback()
            return res.json(error("Printer Not Found", STATUSCODE.BAD_REQUEST))
        }
        await PrinterSetting.update({ printer_name, printer_size, print_type, number_of_copies }, { where: { id, hotel_id: req.user } })
        await t.commit()
        return res.json(success(MESSAGE.SUCCESS, { message: "Printer Updated" }, STATUSCODE.SUCCESS))

        // const { K, I, multi } = formValue
        // if (!K & !I) {
        //     await t.rollback()
        //     return res.json(error(MESSAGE.P_S_D_P, STATUSCODE.BAD_REQUEST))
        // }

        // console.log(K, I, multi)
        // if (!multi) {
        //     if (!K.printer_name) {
        //         await t.rollback()
        //         return res.json(error(MESSAGE.D_P_R, STATUSCODE.BAD_REQUEST))
        //     }
        //     if (!I.printer_name) {
        //         await t.rollback()
        //         return res.json(error(MESSAGE.D_P_R, STATUSCODE.BAD_REQUEST))
        //     }
        //     await PrinterSetting.destroy({ where: { hotel_id: req.user }, transaction: t })
        //     K.multi = false,
        //         K.default = true
        //     K.print_type = "K",
        //         K.hotel_id = req.user
        //     K.menu_categ_id = 1
        //     console.log(K)
        //     await PrinterSetting.create(K, { transaction: t })
        //     I.multi = false,
        //         I.default = true
        //     I.print_type = "I",
        //         I.hotel_id = req.user
        //     I.menu_categ_id = 1
        //     console.log(I)
        //     await PrinterSetting.create(I, { transaction: t })
        //     await t.commit()
        //     return res.json(success(MESSAGE.SUCCESS, { message: "Printer Set" }, STATUSCODE.SUCCESS))
        // }

        // else {

        //     if (!K.printer_name) {
        //         await t.rollback()
        //         return res.json(error(MESSAGE.D_P_R, STATUSCODE.BAD_REQUEST))
        //     }
        //     if (!I.printer_name) {
        //         await t.rollback()
        //         return res.json(error(MESSAGE.D_P_R, STATUSCODE.BAD_REQUEST))
        //     }

        //     await PrinterSetting.destroy({ where: { hotel_id: req.user }, transaction: t })

        //     K.multi = true,
        //         K.default = true
        //     K.print_type = "K",
        //         K.hotel_id = req.user
        //     K.menu_categ_id = 1
        //     await PrinterSetting.create(K, { transaction: t })
        //     I.multi = true,
        //         I.default = true
        //     I.print_type = "I",
        //         I.hotel_id = req.user
        //     I.menu_categ_id = 1
        //     await PrinterSetting.create(I, { transaction: t })


        //     for (const cur of primaryPrinters) {

        //         if (!cur.menu_categ_id) {
        //             await t.rollback()
        //             return res.json(error(MESSAGE.P_S_C, STATUSCODE.BAD_REQUEST))
        //         }
        //         if (!cur.printer_name) {
        //             await t.rollback()
        //             return res.json(error(MESSAGE.P_N_R, STATUSCODE.BAD_REQUEST))
        //         }
        //         if (!cur.printer_name) {
        //             await t.rollback()
        //             return res.json(error(MESSAGE.P_N_R, STATUSCODE.BAD_REQUEST))
        //         }

        //         cur.multi = true
        //         cur.hotel_id = req.user
        //         cur.print_type = 'K'
        //         cur.default = false
        //         await PrinterSetting.create(cur, { transaction: t })
        //     }

        //     await t.commit()
        //     return res.json(success(MESSAGE.SUCCESS, { message: "Printer Set" }, STATUSCODE.SUCCESS))
        // }



    } catch (err) {
        await t.rollback()
        console.log(err)
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const getPrinter = async (req, res) => {
    try {

        const printers = await PrinterSetting.findAll({ where: { hotel_id: req.user } })
        const defaultPrinter = {
            K: {},
            I: {},
            multi: false
        }
        const primaryPrinters = []
        for (const cur of printers) {
            if (cur.default) {
                if (cur.print_type === "K") {
                    if (cur.multi) {
                        defaultPrinter.multi = true
                    }
                    defaultPrinter["K"] = { printer_size: cur.printer_size, printer_name: cur.printer_name, number_of_copies: cur.number_of_copies }
                }
                else {
                    defaultPrinter["I"] = { printer_size: cur.printer_size, printer_name: cur.printer_name, number_of_copies: cur.number_of_copies }
                }


            } else {
                primaryPrinters.push({ printer_size: cur.printer_size, printer_name: cur.printer_name, number_of_copies: cur.number_of_copies, menu_categ_id: cur.menu_categ_id })
            }

        }
        return res.json(success(MESSAGE.SUCCESS, { defaultPrinter, primaryPrinters }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err)
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const deletedPrinter = async (req, res) => {
    const t = await sequelize.transaction()
    try {
        const { id } = req.body
        console.log(id)
        const findPrinter = await PrinterSetting.findByPk(id, { transaction: t })
        if (!findPrinter) {
            await t.rollback()
            return res.json(error("Printer Not Found", STATUSCODE.BAD_REQUEST))
        }
        await PrinterSetting.destroy({ where: { id, hotel_id: req.user } })
        await t.commit()
        return res.json(success(MESSAGE.SUCCESS, { message: "Printer Deleted SuccessFully" }, STATUSCODE.SUCCESS))

        // const { K, I, multi } = formValue
        // if (!K & !I) {
        //     await t.rollback()
        //     return res.json(error(MESSAGE.P_S_D_P, STATUSCODE.BAD_REQUEST))
        // }

        // console.log(K, I, multi)
        // if (!multi) {
        //     if (!K.printer_name) {
        //         await t.rollback()
        //         return res.json(error(MESSAGE.D_P_R, STATUSCODE.BAD_REQUEST))
        //     }
        //     if (!I.printer_name) {
        //         await t.rollback()
        //         return res.json(error(MESSAGE.D_P_R, STATUSCODE.BAD_REQUEST))
        //     }
        //     await PrinterSetting.destroy({ where: { hotel_id: req.user }, transaction: t })
        //     K.multi = false,
        //         K.default = true
        //     K.print_type = "K",
        //         K.hotel_id = req.user
        //     K.menu_categ_id = 1
        //     console.log(K)
        //     await PrinterSetting.create(K, { transaction: t })
        //     I.multi = false,
        //         I.default = true
        //     I.print_type = "I",
        //         I.hotel_id = req.user
        //     I.menu_categ_id = 1
        //     console.log(I)
        //     await PrinterSetting.create(I, { transaction: t })
        //     await t.commit()
        //     return res.json(success(MESSAGE.SUCCESS, { message: "Printer Set" }, STATUSCODE.SUCCESS))
        // }

        // else {

        //     if (!K.printer_name) {
        //         await t.rollback()
        //         return res.json(error(MESSAGE.D_P_R, STATUSCODE.BAD_REQUEST))
        //     }
        //     if (!I.printer_name) {
        //         await t.rollback()
        //         return res.json(error(MESSAGE.D_P_R, STATUSCODE.BAD_REQUEST))
        //     }

        //     await PrinterSetting.destroy({ where: { hotel_id: req.user }, transaction: t })

        //     K.multi = true,
        //         K.default = true
        //     K.print_type = "K",
        //         K.hotel_id = req.user
        //     K.menu_categ_id = 1
        //     await PrinterSetting.create(K, { transaction: t })
        //     I.multi = true,
        //         I.default = true
        //     I.print_type = "I",
        //         I.hotel_id = req.user
        //     I.menu_categ_id = 1
        //     await PrinterSetting.create(I, { transaction: t })


        //     for (const cur of primaryPrinters) {

        //         if (!cur.menu_categ_id) {
        //             await t.rollback()
        //             return res.json(error(MESSAGE.P_S_C, STATUSCODE.BAD_REQUEST))
        //         }
        //         if (!cur.printer_name) {
        //             await t.rollback()
        //             return res.json(error(MESSAGE.P_N_R, STATUSCODE.BAD_REQUEST))
        //         }
        //         if (!cur.printer_name) {
        //             await t.rollback()
        //             return res.json(error(MESSAGE.P_N_R, STATUSCODE.BAD_REQUEST))
        //         }

        //         cur.multi = true
        //         cur.hotel_id = req.user
        //         cur.print_type = 'K'
        //         cur.default = false
        //         await PrinterSetting.create(cur, { transaction: t })
        //     }

        //     await t.commit()
        //     return res.json(success(MESSAGE.SUCCESS, { message: "Printer Set" }, STATUSCODE.SUCCESS))
        // }
    } catch (err) {
        await t.rollback()
        console.log(err)
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const setCategoriesForPrinter = async (req, res) => {
    const t = await sequelize.transaction()
    try {
        const { table_ids, menu_categ_ids, items_ids, order_type, id } = req.body
        console.log(id)
        const findPrinter = await PrinterSetting.findByPk(id, { transaction: t })
        if (!findPrinter) {
            await t.rollback()
            return res.json(error("Printer Not Found", STATUSCODE.BAD_REQUEST))
        }
        await PrinterSetting.update({ table_ids, menu_categ_ids, items_ids, order_type, }, { where: { id, hotel_id: req.user }, transaction: t })
        await t.commit()
        return res.json(success(MESSAGE.SUCCESS, { message: "Printer Deleted SuccessFully" }, STATUSCODE.SUCCESS))

        // const { K, I, multi } = formValue
        // if (!K & !I) {
        //     await t.rollback()
        //     return res.json(error(MESSAGE.P_S_D_P, STATUSCODE.BAD_REQUEST))
        // }

        // console.log(K, I, multi)
        // if (!multi) {
        //     if (!K.printer_name) {
        //         await t.rollback()
        //         return res.json(error(MESSAGE.D_P_R, STATUSCODE.BAD_REQUEST))
        //     }
        //     if (!I.printer_name) {
        //         await t.rollback()
        //         return res.json(error(MESSAGE.D_P_R, STATUSCODE.BAD_REQUEST))
        //     }
        //     await PrinterSetting.destroy({ where: { hotel_id: req.user }, transaction: t })
        //     K.multi = false,
        //         K.default = true
        //     K.print_type = "K",
        //         K.hotel_id = req.user
        //     K.menu_categ_id = 1
        //     console.log(K)
        //     await PrinterSetting.create(K, { transaction: t })
        //     I.multi = false,
        //         I.default = true
        //     I.print_type = "I",
        //         I.hotel_id = req.user
        //     I.menu_categ_id = 1
        //     console.log(I)
        //     await PrinterSetting.create(I, { transaction: t })
        //     await t.commit()
        //     return res.json(success(MESSAGE.SUCCESS, { message: "Printer Set" }, STATUSCODE.SUCCESS))
        // }

        // else {

        //     if (!K.printer_name) {
        //         await t.rollback()
        //         return res.json(error(MESSAGE.D_P_R, STATUSCODE.BAD_REQUEST))
        //     }
        //     if (!I.printer_name) {
        //         await t.rollback()
        //         return res.json(error(MESSAGE.D_P_R, STATUSCODE.BAD_REQUEST))
        //     }

        //     await PrinterSetting.destroy({ where: { hotel_id: req.user }, transaction: t })

        //     K.multi = true,
        //         K.default = true
        //     K.print_type = "K",
        //         K.hotel_id = req.user
        //     K.menu_categ_id = 1
        //     await PrinterSetting.create(K, { transaction: t })
        //     I.multi = true,
        //         I.default = true
        //     I.print_type = "I",
        //         I.hotel_id = req.user
        //     I.menu_categ_id = 1
        //     await PrinterSetting.create(I, { transaction: t })


        //     for (const cur of primaryPrinters) {

        //         if (!cur.menu_categ_id) {
        //             await t.rollback()
        //             return res.json(error(MESSAGE.P_S_C, STATUSCODE.BAD_REQUEST))
        //         }
        //         if (!cur.printer_name) {
        //             await t.rollback()
        //             return res.json(error(MESSAGE.P_N_R, STATUSCODE.BAD_REQUEST))
        //         }
        //         if (!cur.printer_name) {
        //             await t.rollback()
        //             return res.json(error(MESSAGE.P_N_R, STATUSCODE.BAD_REQUEST))
        //         }

        //         cur.multi = true
        //         cur.hotel_id = req.user
        //         cur.print_type = 'K'
        //         cur.default = false
        //         await PrinterSetting.create(cur, { transaction: t })
        //     }

        //     await t.commit()
        //     return res.json(success(MESSAGE.SUCCESS, { message: "Printer Set" }, STATUSCODE.SUCCESS))
        // }



    } catch (err) {
        await t.rollback()
        console.log(err)
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
module.exports = { setCategoriesForPrinter, setPrinterSetting, deletedPrinter, getPrinter, EditPrinterSetting }