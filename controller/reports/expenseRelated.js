const { STATUSCODE, MESSAGE, STATUS } = require("../../constant/const");
const ExpenseEntry = require("../../model/expenseEnty")
const moment = require("moment")
const { error, success } = require("../../responce/res");
const { Op, Model, where } = require("sequelize");
const Order = require("../../model/order");
const ExpenseHead = require("../../model/expenseHead");
const { getShiftedDateRange } = require("../../utils/dateUtils");



// Helper functions to generate date ranges

function getDailyDateRange(start, end) {
    const dateRange = [];
    let currentDate = start.clone();

    while (currentDate.isSameOrBefore(end)) {
        dateRange.push({
            start: currentDate.clone().startOf('day'),
            end: currentDate.clone().endOf('day'),
            formattedDate: currentDate.format('DD/MM/YYYY')
        });
        currentDate.add(1, 'day');
    }

    return dateRange;
}
function getWeeklyDateRange(start, end) {
    const dateRange = [];
    let currentDate = start.clone().startOf('week');

    while (currentDate.isSameOrBefore(end)) {
        const weekEnd = currentDate.clone().endOf('week');

        dateRange.push({
            start: currentDate.clone(),
            end: weekEnd.isSameOrBefore(end) ? weekEnd : end,
            label: `Week ${currentDate.week()} ${currentDate.year()}`
        });

        currentDate.add(1, 'week').startOf('week');
    }

    return dateRange;
}
function getMonthlyDateRange(start, end) {
    const dateRange = [];
    let currentDate = start.clone().startOf('month');

    while (currentDate.isSameOrBefore(end)) {
        const monthEnd = currentDate.clone().endOf('month');

        dateRange.push({
            start: currentDate.clone(),
            end: monthEnd.isSameOrBefore(end) ? monthEnd : end,
            label: currentDate.format('MMMM YYYY')
        });

        currentDate.add(1, 'month').startOf('month');
    }

    return dateRange;
}
function getYearlyDateRange(start, end) {
    const dateRange = [];
    let currentDate = start.clone().startOf('year');

    while (currentDate.isSameOrBefore(end)) {
        const yearEnd = currentDate.clone().endOf('year');

        dateRange.push({
            start: currentDate.clone(),
            end: yearEnd.isSameOrBefore(end) ? yearEnd : end,
            label: currentDate.format('YYYY')
        });

        currentDate.add(1, 'year').startOf('year');
    }

    return dateRange;
}
const calculateAggregates = (data) => {
    // console.log(data)
    const result = {
        total: { period: "Total" },
        min: { period: "Min." },
        max: { period: "Max." },
        avg: { period: "Avg." }
    };

    // Initialize result object
    const fields = [
        'totalSales',
        'totalExpense',
        'totalMoneyIn',
        "totalRemaining",
    ];

    fields.forEach(field => {
        result.total[field] = 0;
        result.min[field] = Number.POSITIVE_INFINITY;
        result.max[field] = Number.NEGATIVE_INFINITY;
    });

    // Calculate totals, min, max
    data.forEach(order => {
        fields.forEach(field => {
            const value = order[field];

            // Total
            result.total[field] += value;

            // Min
            if (value < result.min[field]) {
                result.min[field] = value;
            }

            // Max
            if (value > result.max[field]) {
                result.max[field] = value;
            }
        });
    });

    // Calculate averages
    const count = data.length;
    fields.forEach(field => {
        result.avg[field] = count > 0 ? (result.total[field] / count) : 0;
    });

    return result;
};
const expenseEntryReports = async (req, res) => {
    try {
        const { startDate, endDate, wise = 'day' } = req.body;

        // Validate input
        const { startD, endD, businessStartDate, businessEndDate } = await getShiftedDateRange(startDate, endDate, req.user);

        // if (!startDate || !endDate) {
        //     return res.status(STATUSCODE.BAD_REQUEST).json(
        //         error(MESSAGE.INVALID_INPUT, STATUSCODE.BAD_REQUEST)
        //     );
        // }

        // Convert input dates to moment objects (removing format to avoid clone errors)
        const start = moment(startD);
        const end = moment(endD);
        let dateRange = [];
        switch (wise) {
            case 'day':
                dateRange = getDailyDateRange(start, end);
                break;
            case 'week':
                dateRange = getWeeklyDateRange(start, end);
                break;
            case 'month':
                dateRange = getMonthlyDateRange(start, end);
                break;
            case 'year':
                dateRange = getYearlyDateRange(start, end);
                break;
            default:
                return res.status(STATUSCODE.BAD_REQUEST).json(
                    error(MESSAGE.INVALID_INPUT, STATUSCODE.BAD_REQUEST)
                );
        }

        // Prepare to store financial metrics
        const reports = [];

        // Process each date/period
        for (const period of dateRange) {
            // Set up conditions for the specific period
            const periodConditions = {
                hotel_id: req.user,
                createdAt: {
                    [Op.between]: [
                        period.start.toDate(),
                        period.end.toDate()
                    ]
                },
                deleted: false
            };

            // Fetch period metrics
            const [totalSales, totalExpense, totalMoneyIn] = await Promise.all([
                // Total Sales
                Order.sum('grandAmount', {
                    where: {
                        ...periodConditions,
                        payment: STATUS.SUCCESS,
                        deleted: false
                    }
                }),

                // Total Expense
                ExpenseEntry.sum('amount', {
                    where: {
                        ...periodConditions,
                        addExpense: true,
                        deleted: false
                    }
                }),

                // Total Money In
                ExpenseEntry.sum('amount', {
                    where: {
                        ...periodConditions,
                        addExpense: true,
                        deleted: false
                    }
                })
            ]);

            // Calculate remaining amount
            const totalRemaining = totalSales + totalMoneyIn - totalExpense;

            // Create report object based on wise parameter
            const reportObject = wise === 'day'
                ? { period: period.formattedDate, totalSales: totalSales || 0, totalExpense: totalExpense || 0, totalMoneyIn: totalMoneyIn || 0, totalRemaining: totalRemaining || 0 }
                : { period: period.label, totalSales: totalSales || 0, totalExpense: totalExpense || 0, totalMoneyIn: totalMoneyIn || 0, totalRemaining: totalRemaining || 0 };
            console.log(reportObject, "res-->")
            reports.push(reportObject);
        }
        const resultsData = calculateAggregates(reports)

        reports.unshift(resultsData)

        return res.status(STATUSCODE.SUCCESS).json(
            success(MESSAGE.SUCCESS, {
                bodyData: { startDate, endDate, wise },
                reports: reports
            }, STATUSCODE.SUCCESS)
        );
    }
    catch (error) {
        console.error('Detailed Financial Report Error:', error);
        return res.status(STATUSCODE.INTERNAL_SERVER_ERROR).json(
            error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR)
        );
    }
};

//TODO moneyIn Fro add addExpense Query parameter false by default it's true for expense

const expenseByReports = async (req, res) => {
    try {
        let { expense_head_id, startDate, endDate, addExpense = true } = req.query
        // console.log(req.query)
        if (addExpense === 'true') {
            addExpense = true
        } else {
            addExpense = false
        }
        const { startD, endD, businessStartDate, businessEndDate } = await getShiftedDateRange(startDate, endDate, req.user);

        let headInclude = {
            model: ExpenseHead,
            attributes: ['expense_head_name'],
            required: true
        };

        if (expense_head_id) {
            const checkHeadAvailable = await ExpenseHead.findByPk(expense_head_id)
            if (!checkHeadAvailable) return res.json(error("Expense Head Not Found", STATUSCODE.NOT_FOUND))
            headInclude = {
                model: ExpenseHead,
                where: {
                    id: expense_head_id,
                    hotel_id: req.user
                },
                attributes: ['expense_head_name'],
                required: true
            }
        }

        const expenseReports = await ExpenseEntry.findAll({
            where: {
                hotel_id: req.user,
                addExpense,
                deleted: false,
                business_date: { [Op.between]: [businessStartDate, businessEndDate] },
            },
            include: headInclude,
            attributes: ["amount",
                "reason",
                "paymentMode", 'createdAt', "addExpense"]
        });
        console.log({
            where: {
                hotel_id: req.user,
                addExpense,
                deleted: false,
                business_date: { [Op.between]: [businessStartDate, businessEndDate] },
            }
        },)
        const whereParam = expense_head_id ? {
            hotel_id: req.user,
            addExpense,
            deleted: false,
            expense_head_id: expense_head_id,
            business_date: { [Op.between]: [businessStartDate, businessEndDate] }
        } : {
            hotel_id: req.user,
            addExpense,
            deleted: false,

            business_date: { [Op.between]: [businessStartDate, businessEndDate] }
        }
        const totalExpense = await ExpenseEntry.sum('amount', {
            where: {
                ...whereParam
            },
        });
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { expenseReports, totalExpense: totalExpense || 0 }, STATUSCODE.SUCCESS))
    }
    catch (err) {
        console.log(err)
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))

    }
}

module.exports = { expenseEntryReports, expenseByReports }