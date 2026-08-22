const { Op } = require("sequelize")
const { MESSAGE, STATUSCODE, STATUS } = require("../../constant/const")
const { mobileError, mobileSuccess } = require("../../responce/res")
const Order = require("../../model/order")
const OrderDetails = require("../../model/order_details")
const Menu = require("../../model/menu")
const Menu_categ = require("../../model/menu_categ")
const moment = require('moment')
const { required } = require("joi")
const ExcelJS = require('exceljs');
const fs = require("fs")
const path = require('path')
const sequelize = require("../../connection/connect")
const { getShiftedDateRange } = require("../../utils/dateUtils");
const User = require("../../model/user")

const getDataByCategoryIdOrWithoutId = async (id, startDate, endDate, hotel_id) => {
    const { startD, endD, createdAtStart, createdAtEnd, hasTimeFilter, businessStartDate, businessEndDate } = await getShiftedDateRange(startDate, endDate, hotel_id);
    //   const { } = await getShiftedDateRange(startDate, endDate, req.user);
    console.log(startD, endD)
    const timeFilter = hasTimeFilter ? { createdAt: { [Op.between]: [createdAtStart, createdAtEnd] } } : {};

    console.log(id, "Id::")
    console.log(id === 0, "Id::1")
    console.log(id === "", "Id::2")
    const wherecondi = {}
    let orders = []
    if (id) {
        wherecondi.id = id
        orders = await Order.findAll({
            where: {
                hotel_id, deleted: false, payment: STATUS.SUCCESS,
                business_date: {
                    [Op.between]: [businessStartDate, businessEndDate]
                },
                ...timeFilter,

            }, include: {
                model: OrderDetails, include: {
                    model: Menu,
                    group: "menu_categ_id",
                    include: {
                        model: Menu_categ,
                        where: wherecondi,
                        attributes: ["menu_categ_nm"],
                        required: true
                    },
                    attributes: ['item_name'],
                    required: true
                },
                attributes: ['price', "MenuId", "qty", 'variant_name', "addons", "variant_id"]
            },
            attributes: ["id"]
        })
    } else if (id === 0) {
        orders = await Order.findAll({
            where: {
                hotel_id, deleted: false, payment: STATUS.SUCCESS,
                business_date: {
                    [Op.between]: [businessStartDate, businessEndDate]
                },
                ...timeFilter,

            }, include: {
                model: OrderDetails, include: {
                    model: Menu,
                    where: { active: false },
                    attributes: ['item_name'],
                    required: true
                },
                attributes: ['price', "MenuId", "qty", 'variant_name', "addons", "variant_id"]
            },
            attributes: ["id"]
        })
    } else {
        orders = await Order.findAll({
            where: {
                hotel_id, deleted: false, payment: STATUS.SUCCESS,
                business_date: {
                    [Op.between]: [businessStartDate, businessEndDate]
                },
                ...timeFilter,

            }, include: {
                model: OrderDetails, include: {
                    model: Menu,
                    group: "menu_categ_id",
                    include: {
                        model: Menu_categ,
                        where: wherecondi,
                        attributes: ["menu_categ_nm"],
                        required: true
                    },
                    attributes: ['item_name'],
                    required: true
                },
                attributes: ['price', "MenuId", "qty", 'variant_name', "addons", "variant_id"]
            },
            attributes: ["id"]
        })
        let ordersCustome = await Order.findAll({
            where: {
                hotel_id, deleted: false, payment: STATUS.SUCCESS,

                business_date: {
                    [Op.between]: [businessStartDate, businessEndDate]
                },
                ...timeFilter,

            }, include: {
                model: OrderDetails, include: {
                    model: Menu,
                    where: { active: false },
                    attributes: ['item_name'],
                    required: true
                },
                attributes: ['price', "MenuId", "qty", 'variant_name', "addons", "variant_id"]
            },
            attributes: ["id"]
        })
        // console.log(JSON.parse(JSON.stringify(ordersCustome)), "Orde::")

        orders = [...orders, ...ordersCustome]
    }

    // console.log(JSON.parse(JSON.stringify(orders)), "Orde::")
    // Flatten all orderDetails from all orders
    const allOrderDetails = [];
    for (const order of orders) {
        if (order.hms_orderDetails && Array.isArray(order.hms_orderDetails) && order?.hms_orderDetails?.length) {
            allOrderDetails.push(...order.hms_orderDetails);
        }
    }
    // console.log(JSON.parse(JSON.stringify(allOrderDetails)), "All OrderDetails:")
    // Group by menu_categ_nm
    const categoryMap = {};

    for (const detail of allOrderDetails) {
        const menuCategNm = detail.hms_menu_mst?.hms_menu_categ?.menu_categ_nm || "Custome Item";
        const itemKey = `${detail.MenuId}_${detail.variant_id || "null"}`;

        if (!categoryMap[menuCategNm]) {
            categoryMap[menuCategNm] = {};
        }

        if (!categoryMap[menuCategNm][itemKey]) {
            categoryMap[menuCategNm][itemKey] = {
                item_name: detail.hms_menu_mst?.item_name || "",
                price: detail.price,
                qty: detail.qty,
                variant_id: detail.variant_id,
                addons: detail.addons,
                menuId: detail.MenuId,
                variant_name: detail.variant_name,
            };
        } else {
            // If already exists, sum qty
            categoryMap[menuCategNm][itemKey].qty += detail.qty;
        }
    }

    // Convert to desired array structure
    const result = Object.entries(categoryMap).map(([menu_categ_nm, itemsObj]) => ({
        menu_categ_nm,
        items: Object.values(itemsObj)
    }));
    // console.log(result, "Results:::")
    return result;
    // return orders


}

const itemWiseReportMobile = async (req, res) => {
    try {
        const { menu_category_id, startDate, endDate } = req.body
        const data = await getDataByCategoryIdOrWithoutId(menu_category_id, startDate, endDate, req.user)
        return res.status(STATUSCODE.SUCCESS).json(mobileSuccess(STATUS.SUCCESS, { data }, MESSAGE.SUCCESS, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err)
        return res.json(mobileError(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

const itemWiseReportMobileDownnloadExel = async (req, res) => {
    try {
        const { menu_category_id, startDate, endDate } = req.body;
        const reportData = await getDataByCategoryIdOrWithoutId(menu_category_id, startDate, endDate, req.user);

        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Item Wise Report');

        // Header row
        worksheet.addRow(['Item Name', 'Qty', 'Total Sales (₹)']).font = { bold: true };

        reportData.forEach(category => {
            worksheet.addRow([category.menu_categ_nm]); // Category row
            category.items.forEach(item => {
                const total = item.qty * item.price;
                worksheet.addRow([item.item_name, item.qty, total]);
            });
            worksheet.addRow([]); // Empty row
        });

        // Define file path
        const fileName = `item-wise-report-${Date.now()}.xlsx`;
        const filePath = path.join(__dirname, "..", "..", 'public', 'images', fileName);
        console.log(":::::::Filepath-->", filePath)
        // Save the file
        setTimeout(() => {
            fs.unlink(filePath, err => {
                if (err) console.error(`Error deleting file: ${fileName}`, err);
                else console.log(`Deleted file: ${fileName}`);
            });
        }, 30 * 1000);
        await workbook.xlsx.writeFile(filePath);

        const fileUrl = `${process.env.SUPER_URL}/images/${fileName}`;

        return res.status(STATUSCODE.SUCCESS).json(mobileSuccess(STATUS.SUCCESS, { url: fileUrl, dowanload: reportData.length ? true : false }, 'Excel file generated successfully', STATUSCODE.SUCCESS))



    } catch (err) {
        console.error(err);
        res.status(500).json(mobileError(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

const getAllMenuCategory = async (req, res) => {
    try {

        const data = await Menu_categ.findAll({ where: { active: true, hotel_id: req.user }, attributes: ['id', 'menu_categ_nm'] })
        data.push({ id: 0, menu_categ_nm: "Custom Item" })
        return res.status(STATUSCODE.SUCCESS).json(mobileSuccess(STATUS.SUCCESS, { data }, MESSAGE.SUCCESS, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err)
        return res.json(mobileError(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

const salesReportDayWiseMobile = async (req, res) => {
    try {
        const { period = 'daily', startDate, endDate } = req.body;
        // console.log(req.query, "params---->")
        // Validate input


        const { startD: defaultStartD, endD: defaultEndD, businessStartDate, businessEndDate } = await getShiftedDateRange(startDate, endDate, req.user);

        let periodColumn;
        let adjustedStartD = defaultStartD;
        let adjustedEndD = defaultEndD;
        let adjustedStart = moment(startDate || new Date());
        let adjustedEnd = moment(endDate || new Date());

        switch (period) {
            case 'daily':
                periodColumn = sequelize.col('business_date');
                break;
            case 'monthly':
                periodColumn = sequelize.literal("DATE_FORMAT(business_date, '%Y-%m-01')");
                adjustedStart = moment(startDate || new Date()).startOf('month');
                adjustedEnd = moment(endDate || new Date()).endOf('month');
                const monthBounds = await getShiftedDateRange(adjustedStart.format('YYYY-MM-DD'), adjustedEnd.format('YYYY-MM-DD'), req.user);
                adjustedStartD = monthBounds.startD;
                adjustedEndD = monthBounds.endD;
                break;
            case 'yearly':
                periodColumn = sequelize.literal("DATE_FORMAT(business_date, '%Y-01-01')");
                adjustedStart = moment(startDate || new Date()).startOf('year');
                adjustedEnd = moment(endDate || new Date()).endOf('year');
                const yearBounds = await getShiftedDateRange(adjustedStart.format('YYYY-MM-DD'), adjustedEnd.format('YYYY-MM-DD'), req.user);
                adjustedStartD = yearBounds.startD;
                adjustedEndD = yearBounds.endD;
                break;
        }

        // Base aggregation options
        const aggregationOptions = {
            where: {
                hotel_id: req.user,
                business_date: {
                    [Op.between]: [businessStartDate, businessEndDate],
                },
                deleted: false,
                payment: STATUS.SUCCESS,

            },
            attributes: [
                [periodColumn, 'period'],
                [sequelize.fn('SUM', sequelize.col('totalAmount')), 'totalAmount'],
                [sequelize.fn('SUM', sequelize.col('gst')), 'gst'],
                [sequelize.fn('SUM', sequelize.col('grandAmount')), 'grandAmount'],
                [sequelize.fn('SUM', sequelize.col('totalDiscount')), 'totalDiscount'],
                [sequelize.fn('SUM', sequelize.col('card')), 'card'],
                [sequelize.fn('SUM', sequelize.col('cash')), 'cash'],
                [sequelize.fn('SUM', sequelize.col('upi')), 'upi'],
                [sequelize.fn('SUM', sequelize.col('due')), 'due'],
                [sequelize.fn('COUNT', sequelize.col('id')), 'totalOrders'],
                [
                    sequelize.fn(
                        'MIN',
                        sequelize.cast(sequelize.col('bill_no'), 'UNSIGNED')
                    ),
                    'startBillNo'
                ],
                [
                    sequelize.fn(
                        'MAX',
                        sequelize.cast(sequelize.col('bill_no'), 'UNSIGNED')
                    ),
                    'endBillNo'
                ]
            ],
            group: [periodColumn],
            order: [[sequelize.literal('period'), 'ASC']],
            raw: true
        };

        // Fetch period-wise aggregated data
        const aggregatedOrders = await Order.findAll(aggregationOptions);

        // Overall totals for the entire date range
        const overallTotals = await Order.findOne({
            where: {
                business_date: {
                    [Op.between]: [businessStartDate, businessEndDate],
                },
                deleted: false,
                payment: STATUS.SUCCESS,
                hotel_id: req.user
            },
            attributes: [
                [sequelize.fn('SUM', sequelize.col('totalAmount')), 'totalAmount'],
                [sequelize.fn('SUM', sequelize.col('gst')), 'gst'],
                [sequelize.fn('SUM', sequelize.col('grandAmount')), 'grandAmount'],
                [sequelize.fn('SUM', sequelize.col('totalDiscount')), 'totalDiscount'],
                [sequelize.fn('SUM', sequelize.col('card')), 'card'],
                [sequelize.fn('SUM', sequelize.col('cash')), 'cash'],
                [sequelize.fn('SUM', sequelize.col('upi')), 'upi'],
                [sequelize.fn('SUM', sequelize.col('due')), 'due'],
                [sequelize.fn('COUNT', sequelize.col('id')), 'totalOrders']
            ],
            raw: true
        });

        // Format the aggregated data based on period type
        let formattedAggregatedOrders = aggregatedOrders.map(order => ({
            ...order,
            period: moment(order.period).format('YYYY-MM-DD'), // Consistent date format
            totalAmount: parseFloat(order.totalAmount) || 0,
            gst: parseFloat(order.gst) || 0,
            grandAmount: parseFloat(order.grandAmount) || 0,
            totalDiscount: parseFloat(order.totalDiscount) || 0,
            card: parseFloat(order.card) || 0,
            cash: parseFloat(order.cash) || 0,
            upi: parseFloat(order.upi) || 0,
            due: parseFloat(order.due) || 0,
            totalOrders: parseInt(order.totalOrders) || 0
        }));

        // Format overall totals
        const formattedTotals = overallTotals ? {
            totalAmount: parseFloat(overallTotals.totalAmount) || 0,
            gst: parseFloat(overallTotals.gst) || 0,
            grandAmount: parseFloat(overallTotals.grandAmount) || 0,
            totalDiscount: parseFloat(overallTotals.totalDiscount) || 0,
            card: parseFloat(overallTotals.card) || 0,
            cash: parseFloat(overallTotals.cash) || 0,
            upi: parseFloat(overallTotals.upi) || 0,
            due: parseFloat(overallTotals.due) || 0,
            totalOrders: parseInt(overallTotals.totalOrders) || 0,
            period: "Total"
        } : {};
        formattedAggregatedOrders.push(formattedTotals)

        return res.status(STATUSCODE.SUCCESS).json(mobileSuccess(STATUS.SUCCESS, {
            periodData: formattedAggregatedOrders,
            overallTotals: formattedTotals,
            metadata: {
                period,
                startDate: adjustedStart.format('YYYY-MM-DD'),
                endDate: adjustedEnd.format('YYYY-MM-DD'),
                totalPeriods: formattedAggregatedOrders.length
            }
        }, MESSAGE.SUCCESS, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log('Error in dayWiseGrowthReport:', err);
        return res.json(mobileError(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
};

const salesReportDayWiseMobileDownloadExcel = async (req, res) => {
    try {
        const { period = 'daily', startDate, endDate } = req.body;

        const { startD: defaultStartD, endD: defaultEndD, businessEndDate, businessStartTime } = await getShiftedDateRange(startDate, endDate, req.user);

        let periodColumn;
        let adjustedStartD = defaultStartD;
        let adjustedEndD = defaultEndD;
        let adjustedStart = moment(startDate || new Date());
        let adjustedEnd = moment(endDate || new Date());

        switch (period) {
            case 'daily':
                periodColumn = sequelize.col('business_date');
                break;
            case 'monthly':
                periodColumn = sequelize.literal("DATE_FORMAT(business_date, '%Y-%m-01')");
                adjustedStart = moment(startDate || new Date()).startOf('month');
                adjustedEnd = moment(endDate || new Date()).endOf('month');
                const monthBounds = await getShiftedDateRange(adjustedStart.format('YYYY-MM-DD'), adjustedEnd.format('YYYY-MM-DD'), req.user);
                adjustedStartD = monthBounds.startD;
                adjustedEndD = monthBounds.endD;
                break;
            case 'yearly':
                periodColumn = sequelize.literal("DATE_FORMAT(business_date, '%Y-01-01')");
                adjustedStart = moment(startDate || new Date()).startOf('year');
                adjustedEnd = moment(endDate || new Date()).endOf('year');
                const yearBounds = await getShiftedDateRange(adjustedStart.format('YYYY-MM-DD'), adjustedEnd.format('YYYY-MM-DD'), req.user);
                adjustedStartD = yearBounds.startD;
                adjustedEndD = yearBounds.endD;
                break;
        }

        const aggregationOptions = {
            where: {
                hotel_id: req.user,
                business_date: {
                    [Op.between]: [businessStartTime, businessEndDate],
                },
                deleted: false,
                payment: STATUS.SUCCESS,
            },
            attributes: [
                [periodColumn, 'period'],
                [sequelize.fn('SUM', sequelize.col('totalAmount')), 'totalAmount'],
                [sequelize.fn('SUM', sequelize.col('gst')), 'gst'],
                [sequelize.fn('SUM', sequelize.col('grandAmount')), 'grandAmount'],
                [sequelize.fn('SUM', sequelize.col('totalDiscount')), 'totalDiscount'],
                [sequelize.fn('SUM', sequelize.col('card')), 'card'],
                [sequelize.fn('SUM', sequelize.col('cash')), 'cash'],
                [sequelize.fn('SUM', sequelize.col('upi')), 'upi'],
                [sequelize.fn('SUM', sequelize.col('due')), 'due'],
                [sequelize.fn('COUNT', sequelize.col('id')), 'totalOrders'],
                [
                    sequelize.fn(
                        'MIN',
                        sequelize.cast(sequelize.col('bill_no'), 'UNSIGNED')
                    ),
                    'startBillNo'
                ],
                [
                    sequelize.fn(
                        'MAX',
                        sequelize.cast(sequelize.col('bill_no'), 'UNSIGNED')
                    ),
                    'endBillNo'
                ]
            ],
            group: [periodColumn],
            order: [[sequelize.literal('period'), 'ASC']],
            raw: true
        };

        const aggregatedOrders = await Order.findAll(aggregationOptions);
        const overallTotals = await Order.findOne({
            where: {
                business_date: {
                    [Op.between]: [businessStartTime, businessEndDate],
                },
                deleted: false,
                payment: STATUS.SUCCESS,
                hotel_id: req.user
            },
            attributes: [
                [sequelize.fn('SUM', sequelize.col('totalAmount')), 'totalAmount'],
                [sequelize.fn('SUM', sequelize.col('gst')), 'gst'],
                [sequelize.fn('SUM', sequelize.col('grandAmount')), 'grandAmount'],
                [sequelize.fn('SUM', sequelize.col('totalDiscount')), 'totalDiscount'],
                [sequelize.fn('SUM', sequelize.col('card')), 'card'],
                [sequelize.fn('SUM', sequelize.col('cash')), 'cash'],
                [sequelize.fn('SUM', sequelize.col('upi')), 'upi'],
                [sequelize.fn('SUM', sequelize.col('due')), 'due'],
                [sequelize.fn('COUNT', sequelize.col('id')), 'totalOrders']
            ],
            raw: true
        });

        const formattedOrders = aggregatedOrders.map(order => ({
            period: moment(order.period).format('YYYY-MM-DD'),
            totalOrders: parseInt(order.totalOrders),
            startBillNo: order.startBillNo,
            endBillNo: order.endBillNo,
            grandAmount: parseFloat(order.grandAmount),
            gst: parseFloat(order.gst),
            totalDiscount: parseFloat(order.totalDiscount),
            totalAmount: parseFloat(order.totalAmount),
            cash: parseFloat(order.cash),
            card: parseFloat(order.card),
            upi: parseFloat(order.upi),
            due: parseFloat(order.due)
        }));

        if (overallTotals) {
            formattedOrders.unshift({
                period: 'Total',
                totalOrders: parseInt(overallTotals.totalOrders),
                startBillNo: '',
                endBillNo: '',
                grandAmount: parseFloat(overallTotals.grandAmount),
                gst: parseFloat(overallTotals.gst),
                totalDiscount: parseFloat(overallTotals.totalDiscount),
                totalAmount: parseFloat(overallTotals.totalAmount),
                cash: parseFloat(overallTotals.cash),
                card: parseFloat(overallTotals.card),
                upi: parseFloat(overallTotals.upi),
                due: parseFloat(overallTotals.due)
            });
        }

        // Generate Excel
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Sales Report');

        worksheet.addRow([
            'Date', 'Orders', 'Start Bill No', 'End Bill No', 'GrandAmount', 'Total Tax',
            'Total Discount', 'Sub Total', 'Cash Payment', 'Card Payment', 'UPI Payment', 'Due Payment'
        ]).font = { bold: true };

        formattedOrders.forEach(row => {
            worksheet.addRow([
                row.period,
                row.totalOrders || 0,
                row.startBillNo || '',
                row.endBillNo || '',
                row.grandAmount || 0,
                row.gst || 0,
                row.totalDiscount || 0,
                row.totalAmount || 0,
                row.cash || 0,
                row.card || 0,
                row.upi || 0,
                row.due || 0
            ]);
        });

        // File path and writing
        const fileName = `sales-report-${Date.now()}.xlsx`;
        const filePath = path.join(__dirname, '..', "..", 'public', 'images', fileName);
        await workbook.xlsx.writeFile(filePath);

        // Auto-delete after 30 seconds
        setTimeout(() => {
            fs.unlink(filePath, err => {
                if (err) console.error(`Error deleting file: ${fileName}`, err);
                else console.log(`Deleted file: ${fileName}`);
            });
        }, 30 * 1000);

        const fileUrl = `${process.env.SUPER_URL}/images/${fileName}`;

        return res.status(STATUSCODE.SUCCESS).json(mobileSuccess(MESSAGE.SUCCESS, { url: fileUrl, dowanload: formattedOrders.length ? true : false }, "Sales report generated successfully", STATUSCODE.SUCCESS))


    } catch (err) {
        console.error('Error generating sales report Excel:', err);
        return res.status(500).json(mobileError(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

const DiscountedOrdersReportMobile = async (req, res) => {
    try {
        const { startDate, endDate, } = req.body;
        console.log(startDate, endDate, "Start")

        const { startD, endD, createdAtStart, createdAtEnd, hasTimeFilter, businessStartDate, businessEndDate } = await getShiftedDateRange(startDate, endDate, req.user);
        console.log(startD, endD)
        const timeFilter = hasTimeFilter ? { createdAt: { [Op.between]: [createdAtStart, createdAtEnd] } } : {};

        const discountedOrdersReport = await Order.findOne({
            where: {
                hotel_id: req.user,
                business_date: {
                    [Op.between]: [businessStartDate.businessEndDate]
                },
                ...timeFilter,
                totalDiscount: {
                    [Op.gt]: 0 // Only orders with discounts
                },
                deleted: false,

            },
            attributes: [
                // Discount-specific aggregations
                [sequelize.fn('MIN', sequelize.col('totalDiscount')), 'minDiscount'],
                [sequelize.fn('MAX', sequelize.col('totalDiscount')), 'maxDiscount'],
                [sequelize.fn('AVG', sequelize.col('totalDiscount')), 'avgDiscount'],
                [sequelize.fn('COUNT', sequelize.col('id')), 'totalDiscountedOrders'],

                // Order amount aggregations
                [sequelize.fn('SUM', sequelize.col('grandAmount')), 'totalGrandAmount'],
                [sequelize.fn('SUM', sequelize.col('totalDiscount')), 'totalDiscountAmount'],
                [sequelize.fn('SUM', sequelize.col('gst')), 'totalGST'],
                [sequelize.fn('SUM', sequelize.col('totalAmount')), 'totalOrderAmount'],

                // Payment type breakdown
                [sequelize.fn('SUM', sequelize.col('cash')), 'totalCash'],
                [sequelize.fn('SUM', sequelize.col('upi')), 'totalUPI'],
                [sequelize.fn('SUM', sequelize.col('card')), 'totalCard'],
                [sequelize.fn('SUM', sequelize.col('due')), 'totalDue']
            ],
            raw: true
        });

        const whereClause = {
            hotel_id: req.user,
            business_date: {
                [Op.between]: [businessStartDate, businessEndDate]
            },
            ...timeFilter,
            totalDiscount: {
                [Op.gt]: 0
            },
            deleted: false,

        }
        const attributes = [
            'id',
            'bill_no',
            'grandAmount',
            'totalDiscount',
            'gst',
            'totalAmount',
            'order_type',
            'cash',
            'upi',
            'card',
            'due',
            'createdAt'
        ]
        const orderBy = [['createdAt', 'DESC']]
        const include = [{ model: User, attributes: ['name', 'number'] }]


        const discountedOrdersList = await Order.findAll({ where: whereClause, include, attributes, order: orderBy })
        // await getPa(Order, page, limit, whereClause, include, attributes, orderBy)

        // console.log("here-->")
        return res.status(STATUSCODE.SUCCESS).json(mobileSuccess(MESSAGE.SUCCESS, {
            success: true,
            reportSummary: discountedOrdersReport,
            discountedOrders: discountedOrdersList,
        }, "Descounted Data Fetch Successfully", STATUSCODE.SUCCESS))

    } catch (err) {
        console.log(err, "Discounted Orders Report Error");
        return res.json(mobileError(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};
const DiscountedOrdersReportMobileExel = async (req, res) => {
    try {
        const { startDate, endDate } = req.body;
        const { startD, endD, createdAtStart, createdAtEnd, hasTimeFilter, businessStartDate, businessEndDate } = await getShiftedDateRange(startDate, endDate, req.user);
        console.log(startD, endD)
        const timeFilter = hasTimeFilter ? { createdAt: { [Op.between]: [createdAtStart, createdAtEnd] } } : {};

        const discountedOrdersList = await Order.findAll({
            where: {
                hotel_id: req.user,
                business_date: {
                    [Op.between]: [businessStartDate, businessEndDate]
                },
                ...timeFilter,
                totalDiscount: { [Op.gt]: 0 },
                deleted: false,
            },
            include: [{ model: User, attributes: ['name', 'number'] }],
            attributes: [
                'id', 'bill_no', 'grandAmount', 'totalDiscount', 'gst',
                'totalAmount', 'order_type', 'cash', 'upi', 'card', 'due', 'createdAt'
            ],
            order: [['createdAt', 'DESC']],
            raw: true,
            nest: true,
        });

        // Create Excel file
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Discounted Orders');

        // Define headers
        worksheet.columns = [
            { header: 'Bill No', key: 'bill_no', width: 15 },
            { header: 'Created Date', key: 'createdAt', width: 20 },
            { header: 'Order Type', key: 'order_type', width: 15 },
            { header: 'Customer Name', key: 'customer_name', width: 20 },
            { header: 'Customer Number', key: 'customer_number', width: 20 },
            { header: 'Sub Total (₹)', key: 'totalAmount', width: 20 },
            { header: 'Discount (₹)', key: 'totalDiscount', width: 20 },
            { header: 'Total Taxes (₹)', key: 'gst', width: 20 },
            { header: 'Grand Amount (₹)', key: 'grandAmount', width: 20 }
        ];

        // Populate rows
        discountedOrdersList.forEach(order => {
            worksheet.addRow({
                bill_no: order.bill_no,
                createdAt: new Date(order.createdAt).toLocaleString(),
                order_type: order.order_type,
                customer_name: order.hms_user_master?.name || '',
                customer_number: order.hms_user_master?.number || '',
                totalAmount: order.totalAmount.toFixed(2),
                totalDiscount: order.totalDiscount.toFixed(2),
                gst: order.gst.toFixed(2),
                grandAmount: order.grandAmount.toFixed(2),
            });
        });

        // Save the Excel file (temporary or stream back)
        const fileName = `DiscountedOrders_${Date.now()}.xlsx`;
        const filePath = path.join(__dirname, "..", "..", "public", "images", fileName);

        await workbook.xlsx.writeFile(filePath);



        setTimeout(() => {
            fs.unlink(filePath, err => {
                if (err) console.error(`Error deleting file: ${fileName}`, err);
                else console.log(`Deleted file: ${fileName}`);
            });
        }, 30 * 1000);

        const fileUrl = `${process.env.SUPER_URL}/images/${fileName}`;

        return res.status(STATUSCODE.SUCCESS).json(mobileSuccess(MESSAGE.SUCCESS, { url: fileUrl, dowanload: discountedOrdersList.length ? true : false }, "Sales report generated successfully", STATUSCODE.SUCCESS))

    } catch (err) {
        console.log(err, "Discounted Orders Report Error");
        return res.json(mobileError(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};
module.exports = { DiscountedOrdersReportMobileExel, DiscountedOrdersReportMobile, salesReportDayWiseMobile, salesReportDayWiseMobileDownloadExcel, itemWiseReportMobile, getAllMenuCategory, itemWiseReportMobileDownnloadExel }
