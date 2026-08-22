const { MESSAGE, STATUSCODE, STATUS } = require("../../constant/const")
const Hotel = require("../../model/hotel")
const ExpenseEntry = require("../../model/expenseEnty")
const ExpenseHead = require("../../model/expenseHead")
const { Op } = require("sequelize")
const { getBusinessDate, getShiftedDateRange } = require("../../utils/dateUtils")
const RestaurantSetting = require("../../model/restaurantSetting")
const Order = require("../../model/order")
const ExcelJS = require('exceljs');
const path = require("path")
const fs = require("fs")
const { error, success, mobileError, mobileSuccess } = require("../../responce/res")


const addExpenseHead = async (req, res) => {
    try {
        const hotel = await Hotel.findOne({ where: { id: req.user } })
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST))
        const { expense_head_name } = req.body
        if (!/^[A-Za-z0-9\s&.,'()\-\[\]]+$/.test(expense_head_name)) {
            return res.json(error("Please Enter  Valid Expense Head Name", STATUSCODE.BAD_REQUEST));
        }
        const expenseHead = await ExpenseHead.findOne({ where: { expense_head_name, hotel_id: req.user } })
        if (expenseHead) return res.json(error("ExpenseHead Name Has Already Taken", STATUSCODE.BAD_REQUEST))
        await ExpenseHead.create({ expense_head_name, hotel_id: req.user })
        const expenseHeads = await ExpenseHead.findAll({ where: { hotel_id: req.user } })
        return res.status(STATUSCODE.CREATED).json(success("ExpenseHead Created", { expenseHeads }, STATUSCODE.CREATED))
    } catch (err) {
        console.log(err)
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const getAllExpenseHead = async (req, res) => {
    try {
        const hotel = await Hotel.findOne({ where: { id: req.user } })
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST))
        const expenseHeads = await ExpenseHead.findAll({ where: { hotel_id: req.user } })
        return res.status(STATUSCODE.SUCCESS).json(success("ExpenseHeads Fetch Successfully", { expenseHeads }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err)
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const editExpenseHead = async (req, res) => {
    try {
        const hotel = await Hotel.findOne({ where: { id: req.user } })
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST))
        const { expense_head_name, id } = req.body
        if (!/^[A-Za-z0-9\s&.,'()\-\[\]]+$/.test(expense_head_name)) {
            return res.json(error("Please Enter  Valid Expense Head Name", STATUSCODE.BAD_REQUEST));
        }
        const expenseHead = await ExpenseHead.findOne({ where: { id } })
        if (!expenseHead) return res.json(error("Expense Head Not Found", STATUSCODE.BAD_REQUEST))
        await ExpenseHead.update({ expense_head_name }, { where: { id } })
        const expenseHeads = await ExpenseHead.findAll({ where: { hotel_id: req.user } })
        return res.status(STATUSCODE.SUCCESS).json(success("ExpenseHead Updated Successfully", { expenseHeads }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err)
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}


//! Expense Entry 

const addExpense = async (req, res) => {
    try {

        const { addExpense, amount, paymentMode, reason, expense_head_id, date } = req.body

        const hotel = await Hotel.findOne({ where: { id: req.user } })
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST))

        const setting = await RestaurantSetting.findOne({ where: { hotel_id: req.user } });
        const timeZone = setting?.timeZone || 'Asia/Kolkata';
        const businessStartTime = setting?.business_day_start_time || '00:01:00';

        const dateObj = date ? new Date(date) : new Date();
        const business_date = getBusinessDate(timeZone, businessStartTime, dateObj);

        const findHead = await ExpenseHead.findByPk(expense_head_id)
        if (!findHead) return res.json(error("Expense Head Not Found", STATUSCODE.BAD_REQUEST))
        await ExpenseEntry.create({ business_date, addExpense, amount, paymentMode, reason, user_id: req.userId, hotel_id: req.user, expense_head_id, createdAt: dateObj })

        return res.status(STATUSCODE.CREATED).json(success(MESSAGE.SUCCESS, { message: "Expense Entry Added" }, STATUSCODE.CREATED))

    } catch (err) {
        console.log(err)
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const allEntry = async (req, res) => {
    try {
        const { startDate, endDate } = req.query
        console.log(startDate, endDate, "Start Date End Date ::::")
        const { businessStartDate: bizStartDate, businessEndDate: bizEndDate } = await getShiftedDateRange(startDate, endDate, req.user);
        console.log(bizStartDate, bizEndDate, "Business Start Date End Date ::::")
        const hotel = await Hotel.findOne({ where: { id: req.user } })
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST))
        const entry = await ExpenseEntry.findAll({ where: { hotel_id: req.user, deleted: false, business_date: { [Op.between]: [bizStartDate, bizEndDate] } }, include: { model: ExpenseHead } })
        const totalExpense = await ExpenseEntry.sum("amount", { where: { hotel_id: req.user, addExpense: true, deleted: false, business_date: { [Op.between]: [bizStartDate, bizEndDate] } } })
        const totalMoneyIn = await ExpenseEntry.sum("amount", { where: { hotel_id: req.user, addExpense: false, deleted: false, business_date: { [Op.between]: [bizStartDate, bizEndDate] } } })
        const totalSale = await Order.sum("grandAmount", {
            where: {
                payment: STATUS.SUCCESS, hotel_id: req.user,
                business_date: { [Op.between]: [bizStartDate, bizEndDate] }, deleted: false
            }
        })
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { entry, totalMoneyIn: totalMoneyIn ? totalMoneyIn : 0, totalExpense: totalExpense ? totalExpense : 0, totalSale: totalSale ? totalSale : 0, remainingAmount: (totalSale - +totalExpense) + totalMoneyIn }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err)
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const editExpense = async (req, res) => {
    try {
        const { addExpense, amount, paymentMode, reason, expense_head_id, id, date } = req.body
        const hotel = await Hotel.findOne({ where: { id: req.user } })
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST))
        const findEntry = await ExpenseEntry.findByPk(id)
        if (!findEntry) return res.json(error("Expense Entry Not Found", STATUSCODE.BAD_REQUEST))
        const findHead = await ExpenseHead.findByPk(expense_head_id)
        if (!findHead) return res.json(error("Expense Head Not Found", STATUSCODE.BAD_REQUEST))
        await ExpenseEntry.update({ addExpense, amount, paymentMode, reason, expense_head_id, createdAt: date ? new Date(date) : new Date() }, { where: { id } })

        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { message: "Expense Entry Updated" }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err)
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const deleteExpense = async (req, res) => {
    try {
        const { id } = req.body

        const hotel = await Hotel.findOne({ where: { id: req.user } })
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST))
        const findHead = await ExpenseEntry.findByPk(id)
        if (!findHead) return res.json(error("Expense Entry Not Found", STATUSCODE.BAD_REQUEST))
        await ExpenseEntry.update({ deleted: true }, { where: { id } })

        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { message: "Expense Entry Deleted" }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err)
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}


// MOBILE:::

const addExpenseHeadMobile = async (req, res) => {
    try {
        const hotel = await Hotel.findOne({ where: { id: req.user } })
        if (!hotel) return res.json(mobileError(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST))
        const { expense_head_name } = req.body

        const expenseHead = await ExpenseHead.findOne({ where: { expense_head_name, hotel_id: req.user } })
        if (expenseHead) return res.json(mobileError("ExpenseHead Name Has Already Taken", STATUSCODE.BAD_REQUEST))
        await ExpenseHead.create({ expense_head_name, hotel_id: req.user })
        const expenseHeads = await ExpenseHead.findAll({ where: { hotel_id: req.user } })
        return res.status(STATUSCODE.SUCCESS).json(mobileSuccess(MESSAGE.SUCCESS, { expenseHeads }, "ExpenseHead Created", STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err)
        return res.json(mobileError(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const getAllExpenseHeadMobile = async (req, res) => {
    try {
        const hotel = await Hotel.findOne({ where: { id: req.user } })
        if (!hotel) return res.json(mobileError(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST))
        const expenseHeads = await ExpenseHead.findAll({ where: { hotel_id: req.user } })
        return res.status(STATUSCODE.SUCCESS).json(mobileSuccess(MESSAGE.SUCCESS, { expenseHeads }, "ExpenseHeads Fetch Successfully", STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err)
        return res.json(mobileError(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const editExpenseHeadMobile = async (req, res) => {
    try {
        const hotel = await Hotel.findOne({ where: { id: req.user } })
        if (!hotel) return res.json(mobileError(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST))
        const { expense_head_name, id } = req.body
        const expenseHead = await ExpenseHead.findOne({ where: { id } })
        if (!expenseHead) return res.json(mobileError("Unit Not Found", STATUSCODE.BAD_REQUEST))
        await ExpenseHead.update({ expense_head_name }, { where: { id } })
        const expenseHeads = await ExpenseHead.findAll({ where: { hotel_id: req.user } })
        return res.status(STATUSCODE.SUCCESS).json(mobileSuccess(MESSAGE.SUCCESS, { expenseHeads }, "ExpenseHead Updated Successfully", STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err)
        return res.json(mobileError(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

//! Expense Entry 

const addExpenseMobile = async (req, res) => {
    try {
        const { addExpense, amount, paymentMode, reason, expense_head_id, date } = req.body

        const hotel = await Hotel.findOne({ where: { id: req.user } })
        if (!hotel) return res.json(mobileError(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST))

        const setting = await RestaurantSetting.findOne({ where: { hotel_id: req.user } });
        const timeZone = setting?.timeZone || 'Asia/Kolkata';
        const businessStartTime = setting?.business_day_start_time || '00:01:00';

        const dateObj = date ? new Date(date) : new Date();
        const business_date = getBusinessDate(timeZone, businessStartTime, dateObj);

        const findHead = await ExpenseHead.findByPk(expense_head_id)
        if (!findHead) return res.json(mobileError("Expense Head Not Found", STATUSCODE.BAD_REQUEST))
        await ExpenseEntry.create({ business_date, createdAt: dateObj, addExpense, amount, paymentMode, reason, user_id: req.userId, hotel_id: req.user, expense_head_id })

        return res.status(STATUSCODE.SUCCESS).json(mobileSuccess(MESSAGE.SUCCESS, { message: addExpense ? "Expense Entry Added" : 'Money In SuccessFully' }, "", STATUSCODE.SUCCESS))
    } catch (err) {
        return res.json(mobileError(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const allEntryMobile = async (req, res) => {
    try {
        const { startDate, endDate } = req.body
        const { businessStartDate: bizStartDate, businessEndDate: bizEndDate } = await getShiftedDateRange(startDate, endDate, req.user);
        const hotel = await Hotel.findOne({ where: { id: req.user } })
        if (!hotel) return res.json(mobileError(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST))
        const entry = await ExpenseEntry.findAll({ where: { hotel_id: req.user, deleted: false, business_date: { [Op.between]: [bizStartDate, bizEndDate] } }, include: { model: ExpenseHead } })
        const totalExpense = await ExpenseEntry.sum("amount", { where: { hotel_id: req.user, addExpense: true, deleted: false, business_date: { [Op.between]: [bizStartDate, bizEndDate] } } })
        const totalMoneyIn = await ExpenseEntry.sum("amount", { where: { hotel_id: req.user, addExpense: false, deleted: false, business_date: { [Op.between]: [bizStartDate, bizEndDate] } } })
        const totalSale = await Order.sum("grandAmount", {
            where: {
                payment: STATUS.SUCCESS, hotel_id: req.user,
                business_date: {
                    [Op.between]: [bizStartDate, bizEndDate]
                }, deleted: false
            }
        })
        return res.status(STATUSCODE.SUCCESS).json(mobileSuccess(MESSAGE.SUCCESS, { entry, totalMoneyIn: totalMoneyIn ? totalMoneyIn : 0, totalExpense: totalExpense ? totalExpense : 0, totalSale: totalSale ? totalSale : 0, remainingAmount: (totalSale - +totalExpense) + totalMoneyIn }, "", STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err)
        return res.json(mobileError(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const allEntryMobileExcel = async (req, res) => {
    try {
        const { startDate, endDate } = req.body
        const { businessStartDate: bizStartDate, businessEndDate: bizEndDate } = await getShiftedDateRange(startDate, endDate, req.user);
        const hotel = await Hotel.findOne({ where: { id: req.user } })
        if (!hotel) return res.json(mobileError(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST))
        const entry = await ExpenseEntry.findAll({ where: { hotel_id: req.user, deleted: false, business_date: { [Op.between]: [bizStartDate, bizEndDate] } }, include: { model: ExpenseHead } })
        // Create Excel file
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Expense Report');
        worksheet.addRow([]);
        worksheet.columns = [
            { header: 'Expense Head', key: 'expense_head', width: 20 },
            { header: 'Payment Mode', key: 'payment_mode', width: 20 },
            { header: 'Amount', key: 'amount', width: 20 },
            { header: 'Reason', key: 'reason', width: 20 },
            { header: 'Created Date', key: 'createdAt', width: 20 }
        ];



        // NOW add rows
        entry.forEach(eachEntry => {
            const row = worksheet.addRow({
                expense_head: eachEntry?.hms_expense_head_mst?.expense_head_name || "",
                payment_mode: eachEntry?.paymentMode || "",
                amount: parseFloat(eachEntry.amount)?.toFixed(2) || 0,
                reason: eachEntry?.reason || "",
                createdAt: new Date(eachEntry.createdAt).toLocaleString(),
            });

            if (eachEntry.addExpense === false) {
                row.eachCell(c => c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '90EE90' } });
            } else {
                row.eachCell(c => c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC5202B' } });
            }
        });


        // Save the Excel file (temporary or stream back)
        const fileName = `expense_report_${Date.now()}.xlsx`;
        const filePath = path.join(__dirname, "..", "..", "public", "images", fileName);




        await workbook.xlsx.writeFile(filePath);



        setTimeout(() => {
            fs.unlink(filePath, err => {
                if (err) console.error(`Error deleting file: ${fileName}`, err);
                else console.log(`Deleted file: ${fileName}`);
            });
        }, 30 * 1000);

        const fileUrl = `${process.env.SUPER_URL}/images/${fileName}`;
        if (entry.length === 0) {
            return res.status(STATUSCODE.SUCCESS).json(mobileError("No Expense Entry Found In Given Date Range", STATUSCODE.BAD_REQUEST))
        }

        return res.status(STATUSCODE.SUCCESS).json(mobileSuccess(MESSAGE.SUCCESS, { url: fileUrl, download: true }, "Expense Report Generated Successfully", STATUSCODE.SUCCESS))

    } catch (err) {
        console.log(err)
        return res.json(mobileError(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const editExpenseMobile = async (req, res) => {
    try {
        const { addExpense, amount, paymentMode, reason, expense_head_id, id, date } = req.body
        const hotel = await Hotel.findOne({ where: { id: req.user } })
        if (!hotel) return res.json(mobileError(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST))
        const findEntry = await ExpenseEntry.findByPk(id)
        if (!findEntry) return res.json(mobileError("Expense Entry Not Found", STATUSCODE.BAD_REQUEST))
        const findHead = await ExpenseHead.findByPk(expense_head_id)
        if (!findHead) return res.json(mobileError("Expense Head Not Found", STATUSCODE.BAD_REQUEST))
        await ExpenseEntry.update({ createdAt: date ? new Date(date) : new Date(), addExpense, amount, paymentMode, reason, expense_head_id }, { where: { id } })

        return res.status(STATUSCODE.SUCCESS).json(mobileSuccess(MESSAGE.SUCCESS, { message: "Expense Entry Updated" }, "", STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err)
        return res.json(mobileError(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const deleteExpenseMobile = async (req, res) => {
    try {
        const { id } = req.body

        const hotel = await Hotel.findOne({ where: { id: req.user } })
        if (!hotel) return res.json(mobileError(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST))
        const findHead = await ExpenseEntry.findByPk(id)
        if (!findHead) return res.json(mobileError("Expense Entry Not Found", STATUSCODE.BAD_REQUEST))
        await ExpenseEntry.update({ deleted: true }, { where: { id } })

        return res.status(STATUSCODE.SUCCESS).json(mobileSuccess(MESSAGE.SUCCESS, { message: "Expense Entry Deleted" }, "", STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err)
        return res.json(mobileError(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

module.exports = {
    allEntryMobileExcel,
    addExpenseHeadMobile,
    getAllExpenseHeadMobile,
    editExpenseHeadMobile,
    addExpenseMobile,
    allEntryMobile,
    editExpenseMobile,
    deleteExpenseMobile, editExpense, deleteExpense, allEntry, addExpense, addExpenseHead, getAllExpenseHead, editExpenseHead
}