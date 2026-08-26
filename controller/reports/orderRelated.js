const { STATUSCODE, MESSAGE, STATUS } = require("../../constant/const");
const ExpenseEntry = require("../../model/expenseEnty")
const moment = require("moment")
const { error, success } = require("../../responce/res");
const { Op, fn, col } = require("sequelize");
const Order = require("../../model/order");
const sequelize = require("../../connection/connect");
const OnlineOrders = require("../../model/onlineOrder");
const { getShiftedDateRange } = require("../../utils/dateUtils");
const User = require("../../model/user");
const HotelUser = require("../../model/hotelUser");
const OrderTax = require("../../model/orderTax");
const TaxType = require("../../model/taxType");
const TimeLine = require("../../model/timeline");


const getPaginatedData = async (model, page, limit, whereClause = {}, include = [], attributes = null, orderBy = [['createdAt', 'DESC']]) => {

    // Validate and set defaults for page and limit

    page = parseInt(page) || 1;
    limit = parseInt(limit) || 10;
    const offset = (page - 1) * limit;

    // Perform query with pagination, attributes, and ordering

    const { count, rows } = await model.findAndCountAll({
        where: whereClause,
        include: include,
        attributes: attributes,
        limit: limit,
        offset: offset,
        order: orderBy,
    });
    console.log(count, limit)
    const totalPages = Math.ceil(count / limit);
    console.log(totalPages)
    return {
        data: rows,
        currentPage: page,
        totalPages: totalPages,
        totalItems: count,
        limit: limit,
    };
};
const DiscountedOrdersReport = async (req, res) => {
    try {
        const { startDate, endDate, page } = req.query;
        const limit = 10
        console.log(startDate, endDate, "Start En date")
        const { startD, endD, businessStartDate, businessEndDate, hasTimeFilter, createdAtStart, createdAtEnd } = await getShiftedDateRange(startDate, endDate, req.user);
        console.log(startD, endD)

        const timeFilter = hasTimeFilter ? { createdAt: { [Op.between]: [createdAtStart, createdAtEnd] } } : {};

        // Aggregation query for discounted orders
        const discountedOrdersReport = await Order.findOne({
            where: {
                hotel_id: req.user,
                business_date: { [Op.between]: [businessStartDate, businessEndDate] },
                totalDiscount: {
                    [Op.gt]: 0 // Only orders with discounts
                },
                deleted: false,
                ...timeFilter,
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
        // console.log(discountedOrdersReport, "discountedOrdersReport===>")
        // Detailed discounted orders list
        const whereClause = {
            hotel_id: req.user,
            business_date: { [Op.between]: [businessStartDate, businessEndDate] },
            totalDiscount: {
                [Op.gt]: 0
            },
            deleted: false,
            ...timeFilter,
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
        const discountedOrdersList = await getPaginatedData(Order, page, limit, whereClause, include, attributes, orderBy)

        console.log("here-->")
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, {
            success: true,
            reportSummary: discountedOrdersReport,
            discountedOrders: discountedOrdersList,
        }, STATUSCODE.SUCCESS))

    } catch (err) {
        console.log(err, "Discounted Orders Report Error");
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};


// Function to calculate totals, min, max, and avg
const calculateAggregates = (data, dynamicTaxHeaders) => {
    const result = {
        total: { order_type: "TOTAL." },
        min: { order_type: "MIN." },
        max: { order_type: "MAX." },
        avg: { order_type: "AVG." }
    };

    // Initialize result object
    const fields = [
        'totalGrandAmount',
        'totalDiscountAmount',
        'totalGST',
        'totalOrderAmount',
        'totalCash',
        'totalUPI',
        'totalCard',
        'totalDue',
        'totalDynamicTax'
    ];

    // Add dynamic tax fields
    const dynamicTaxFields = dynamicTaxHeaders.map(taxName => `tax_${taxName}`);
    const allFields = [...fields, ...dynamicTaxFields];

    allFields.forEach(field => {
        result.total[field] = 0;
        result.min[field] = Number.POSITIVE_INFINITY;
        result.max[field] = Number.NEGATIVE_INFINITY;
    });

    // Calculate totals, min, max
    data.forEach(order => {
        allFields.forEach(field => {
            const value = parseFloat(order[field] || 0);

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
    allFields.forEach(field => {
        result.avg[field] = count > 0 ? (result.total[field] / count) : 0;
    });

    return result;
};

const AllOrderTypeWise = async (req, res) => {
    try {
        const { startDate, endDate } = req.query;
        console.log("Request received -->");

        const { startD, endD, businessStartDate, businessEndDate, hasTimeFilter, createdAtStart, createdAtEnd } = await getShiftedDateRange(startDate, endDate, req.user);

        const timeFilter = hasTimeFilter ? { createdAt: { [Op.between]: [createdAtStart, createdAtEnd] } } : {};
        // When time filter is active use the exact createdAt range; otherwise span the full business day.
        const timestampRange = hasTimeFilter ? [createdAtStart, createdAtEnd] : [startD, endD];

        // Step 1: Get order data grouped by order_type
        let data = await Order.findAll({
            where: {
                hotel_id: req.user,
                business_date: { [Op.between]: [businessStartDate, businessEndDate] },
                deleted: false,
                ...timeFilter,
            },
            attributes: [
                'order_type',
                [sequelize.fn('SUM', sequelize.col('grandAmount')), 'totalGrandAmount'],
                [sequelize.fn('SUM', sequelize.col('totalDiscount')), 'totalDiscountAmount'],
                [sequelize.fn('SUM', sequelize.col('gst')), 'totalGST'],
                [sequelize.fn('SUM', sequelize.col('totalAmount')), 'totalOrderAmount'],
                [sequelize.fn('SUM', sequelize.col('cash')), 'totalCash'],
                [sequelize.fn('SUM', sequelize.col('upi')), 'totalUPI'],
                [sequelize.fn('SUM', sequelize.col('card')), 'totalCard'],
                [sequelize.fn('SUM', sequelize.col('due')), 'totalDue']
            ],
            group: ['order_type'],
            raw: true
        });

        // Step 2: Get dynamic tax data grouped by order_type and tax
        const taxSummary = await OrderTax.findAll({
            where: {
                hotel_id: req.user,
                updatedAt: {
                    [Op.between]: timestampRange
                }
            },
            include: [
                {
                    model: Order,
                    where: {
                        hotel_id: req.user,
                        business_date: { [Op.between]: [businessStartDate, businessEndDate] },
                        deleted: false,
                        ...timeFilter,
                    },
                    attributes: ['order_type'],
                    required: true
                },
                {
                    model: TaxType,
                    attributes: ['id', 'tax_name', 'tax_value', 'amount']
                }
            ],
            attributes: [
                [sequelize.col('hms_order_mst.order_type'), 'order_type'],
                [sequelize.col('hms_tax_type_mst.id'), 'taxId'],
                [sequelize.col('hms_tax_type_mst.tax_name'), 'taxName'],
                [sequelize.col('hms_tax_type_mst.amount'), 'taxRate'],
                [sequelize.col('hms_tax_type_mst.tax_value'), 'taxType'],
                [sequelize.fn('SUM', sequelize.col('hms_order_tax_mst.tax_value')), 'totalTaxAmount'],
                [sequelize.fn('COUNT', sequelize.col('hms_order_tax_mst.id')), 'taxCount']
            ],
            group: [
                'hms_order_mst.order_type',
                'hms_tax_type_mst.id',
                'hms_tax_type_mst.tax_name',
                'hms_tax_type_mst.amount',
                'hms_tax_type_mst.tax_value'
            ],
            raw: true
        });

        // Step 3: Prepare a map for tax summary grouped by order_type
        const taxSummaryByOrderType = {};
        taxSummary.forEach(tax => {
            const orderType = tax.order_type;
            if (!taxSummaryByOrderType[orderType]) {
                taxSummaryByOrderType[orderType] = {
                    totalDynamicTax: 0,
                    taxBreakdown: []
                };
            }

            const taxAmount = parseFloat(tax.totalTaxAmount || 0);
            taxSummaryByOrderType[orderType].totalDynamicTax += taxAmount;
            taxSummaryByOrderType[orderType].taxBreakdown.push({
                taxId: tax.taxId,
                taxName: tax.taxName,
                taxRate: parseFloat(tax.taxRate || 0),
                taxType: tax.taxType,
                totalAmount: taxAmount.toFixed(2),
                applicableOrders: parseInt(tax.taxCount || 0)
            });
        });

        // Step 4: Merge tax data with order data
        data = data.map(orderTypeData => ({
            ...orderTypeData,
            totalDynamicTax: parseFloat(taxSummaryByOrderType[orderTypeData.order_type]?.totalDynamicTax || 0),
            taxBreakdown: taxSummaryByOrderType[orderTypeData.order_type]?.taxBreakdown || []
        }));

        // Step 5: Get unique dynamic tax headers
        const allTaxTypes = new Set();
        data.forEach(order => {
            if (order.taxBreakdown && order.taxBreakdown.length > 0) {
                order.taxBreakdown.forEach(tax => {
                    allTaxTypes.add(tax.taxName);
                });
            }
        });

        const dynamicTaxHeaders = Array.from(allTaxTypes).sort();

        // Step 6: Flatten data structure for frontend
        const flattenedData = data.map(order => {
            const flattened = {
                order_type: order.order_type,
                totalGrandAmount: parseFloat(order.totalGrandAmount || 0),
                totalDiscountAmount: parseFloat(order.totalDiscountAmount || 0),
                totalGST: parseFloat(order.totalGST || 0),
                totalOrderAmount: parseFloat(order.totalOrderAmount || 0),
                totalCash: parseFloat(order.totalCash || 0),
                totalUPI: parseFloat(order.totalUPI || 0),
                totalCard: parseFloat(order.totalCard || 0),
                totalDue: parseFloat(order.totalDue || 0),
                totalDynamicTax: parseFloat(order.totalDynamicTax || 0)
            };

            dynamicTaxHeaders.forEach(taxName => {
                const taxData = order.taxBreakdown?.find(tax => tax.taxName === taxName);
                flattened[`tax_${taxName}`] = taxData ? parseFloat(taxData.totalAmount) : 0;
            });

            return flattened;
        });

        // Step 7: Calculate totals, min, max, avg and insert into flattenedData
        let result = {};
        if (flattenedData.length) {
            result = calculateAggregates(flattenedData, dynamicTaxHeaders);

            flattenedData.unshift(result.avg);
            flattenedData.unshift(result.max);
            flattenedData.unshift(result.min);
            flattenedData.unshift(result.total);
        }

        // Step 8: Create headers for frontend
        const headers = [

            // Dynamic Tax Columns
            ...dynamicTaxHeaders.map(taxName => ({
                key: `tax_${taxName}`,
                label: taxName,
                fixed: false,
                type: 'tax'
            }))
        ];
        console.log(flattenedData, dynamicTaxHeaders, headers)

        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, {
            data: flattenedData,
            headers: headers,
            dynamicTaxTypes: dynamicTaxHeaders
        }, STATUSCODE.SUCCESS));

    } catch (err) {
        console.error(err, "Order Type Wise Report Error");
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

const dayWiseGrowthReport = async (req, res) => {
    try {
        const { period, startDate, endDate } = req.query;
        console.log(req.query, "params---->")
        // Validate input
        if (!['daily', 'monthly', 'yearly'].includes(period)) {
            return res.status(400).json({
                message: 'Invalid period. Choose daily, monthly, or yearly.'
            });
        }
        const { startD: defaultStartD, endD: defaultEndD, businessStartDate: defaultBusinessStart, businessEndDate: defaultBusinessEnd } = await getShiftedDateRange(startDate, endDate, req.user);
        console.log(defaultStartD, defaultEndD, "defaultStartD defaultEndD")
        let periodColumn;
        let adjustedStartD = defaultStartD;
        let adjustedEndD = defaultEndD;
        let adjustedBusinessStartDate = defaultBusinessStart;
        let adjustedBusinessEndDate = defaultBusinessEnd;
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
                adjustedBusinessStartDate = monthBounds.businessStartDate;
                adjustedBusinessEndDate = monthBounds.businessEndDate;
                break;
            case 'yearly':
                periodColumn = sequelize.literal("DATE_FORMAT(business_date, '%Y-01-01')");
                adjustedStart = moment(startDate || new Date()).startOf('year');
                adjustedEnd = moment(endDate || new Date()).endOf('year');
                const yearBounds = await getShiftedDateRange(adjustedStart.format('YYYY-MM-DD'), adjustedEnd.format('YYYY-MM-DD'), req.user);
                adjustedStartD = yearBounds.startD;
                adjustedEndD = yearBounds.endD;
                adjustedBusinessStartDate = yearBounds.businessStartDate;
                adjustedBusinessEndDate = yearBounds.businessEndDate;
                break;
        }
        // Base aggregation options

        const aggregationOptions = {
            where: {
                hotel_id: req.user,
                business_date: {
                    [Op.between]: [adjustedBusinessStartDate, adjustedBusinessEndDate],
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
                    [Op.between]: [adjustedBusinessStartDate, adjustedBusinessEndDate],
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
        console.log(aggregatedOrders)
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
        formattedAggregatedOrders.unshift(formattedTotals)
        // Prepare response
        //    return res.json({
        //         periodData: formattedAggregatedOrders,
        //         overallTotals: formattedTotals,
        //         metadata: {
        //             period,
        //             startDate: adjustedStart.format('YYYY-MM-DD'),
        //             endDate: adjustedEnd.format('YYYY-MM-DD'),
        //             totalPeriods: formattedAggregatedOrders.length
        //         }
        //     });

        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, {
            periodData: formattedAggregatedOrders,
            overallTotals: formattedTotals,
            metadata: {
                period,
                startDate: adjustedStart.format('YYYY-MM-DD'),
                endDate: adjustedEnd.format('YYYY-MM-DD'),
                totalPeriods: formattedAggregatedOrders.length
            }
        }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log('Error in dayWiseGrowthReport:', err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
};

const posCollectionReport = async (req, res) => {
    try {
        const { startDate, endDate } = req.query;

        // Validate dates
        if (!startDate || !endDate) {
            return res.status(400).json({
                success: false,
                message: 'Both startDate and endDate are required'
            });
        }

        const { startD, endD, businessStartDate, businessEndDate, hasTimeFilter, createdAtStart, createdAtEnd } = await getShiftedDateRange(startDate, endDate, req.user);
        const start = startDate ? moment(startDate) : moment();
        const end = endDate ? moment(endDate) : moment();

        // Validate date range
        if (!start.isValid() || !end.isValid()) {
            return res.status(400).json({
                success: false,
                message: 'Invalid date format. Please use YYYY-MM-DD'
            });
        }

        const timeFilter = hasTimeFilter ? { createdAt: { [Op.between]: [createdAtStart, createdAtEnd] } } : {};
        const timestampRange = hasTimeFilter ? [createdAtStart, createdAtEnd] : [startD, endD];

        // Fetch aggregated order data
        const orderSummary = await Order.findOne({
            where: {
                hotel_id: req.user,
                business_date: { [Op.between]: [businessStartDate, businessEndDate] },
                deleted: false,
                payment: STATUS.SUCCESS,
                ...timeFilter,
            },

            attributes: [
                [sequelize.fn('COUNT', sequelize.col('id')), 'totalBills'],
                [sequelize.fn('SUM', sequelize.col('cash')), 'cashTotal'],
                [sequelize.fn('SUM', sequelize.col('due')), 'dueTotal'],
                [sequelize.fn('SUM', sequelize.col('upi')), 'upiTotal'],
                [sequelize.fn('SUM', sequelize.col('card')), 'cardTotal'],
                [sequelize.fn('SUM', sequelize.col('gst')), 'totalGst'],
                [sequelize.fn('SUM', sequelize.col('grandAmount')), 'totalAmount'],
                [sequelize.fn('SUM', sequelize.col('totalDiscount')), 'totalDiscount'],
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
            raw: true
        });

        const taxSummary = await OrderTax.findAll({

            where: {
                hotel_id: req.user,
                updatedAt: {
                    [Op.between]: timestampRange
                }
            },

            include: [
                {
                    model: Order,
                    where: {
                        hotel_id: req.user,
                        business_date: { [Op.between]: [businessStartDate, businessEndDate] },
                        deleted: false,
                        payment: STATUS.SUCCESS,
                        ...timeFilter,
                    },
                    attributes: [], required: true
                },
                {
                    model: TaxType,
                    attributes: ['id', 'tax_name', 'tax_value', 'amount']
                }
            ],
            attributes: [
                [sequelize.col('hms_tax_type_mst.id'), 'taxId'],
                [sequelize.col('hms_tax_type_mst.tax_name'), 'taxName'],
                [sequelize.col('hms_tax_type_mst.amount'), 'taxRate'],
                [sequelize.col('hms_tax_type_mst.tax_value'), 'taxType'],
                [sequelize.fn('SUM', sequelize.col('hms_order_tax_mst.tax_value')), 'totalTaxAmount'],
                [sequelize.fn('COUNT', sequelize.col('hms_order_tax_mst.id')), 'taxCount']
            ],
            group: [
                'hms_tax_type_mst.id',
                'hms_tax_type_mst.tax_name',
                'hms_tax_type_mst.amount',
                'hms_tax_type_mst.tax_value'
            ],
            raw: true
        });
        const totalDynamicTax = taxSummary.reduce((sum, tax) => {
            return sum + parseFloat(tax.totalTaxAmount || 0);
        }, 0);

        // Format tax breakdown
        const taxBreakdown = taxSummary.map(tax => ({
            taxId: tax.taxId,
            taxName: tax.taxName,
            taxRate: parseFloat(tax.taxRate || 0),
            taxType: tax.taxType,
            totalAmount: parseFloat(tax.totalTaxAmount || 0).toFixed(2),
            applicableOrders: parseInt(tax.taxCount || 0)
        }));
        console.log("Tax Summary:", taxBreakdown, totalDynamicTax, taxSummary)
        const formattedSummary = {

            totalBills: parseInt(orderSummary?.totalBills || 0),
            cashTotal: parseFloat(orderSummary?.cashTotal || 0).toFixed(2),
            dueTotal: parseFloat(orderSummary?.dueTotal || 0).toFixed(2),
            upiTotal: parseFloat(orderSummary?.upiTotal || 0).toFixed(2),
            cardTotal: parseFloat(orderSummary?.cardTotal || 0).toFixed(2),
            totalGst: parseFloat(orderSummary?.totalGst || 0).toFixed(2),
            totalAmount: parseFloat(orderSummary?.totalAmount || 0).toFixed(2),
            totalDiscount: parseFloat(orderSummary?.totalDiscount || 0).toFixed(2),
            totalDynamicTax,
            taxBreakdown,
            billRange: {
                start: orderSummary?.startBillNo || 0,
                end: orderSummary?.endBillNo || 0
            },

            dateRange: {
                start: start.format('YYYY-MM-DD'),
                end: end.format('YYYY-MM-DD')
            }
        };
        console.log(formattedSummary, "formated Data:::")
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { posCollections: formattedSummary }, STATUSCODE.SUCCESS))

    } catch (error) {
        console.error('Error in posCollectionReport:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching POS collection report',
            error: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
};

const ExecutiveSalesReportSummary = async (req, res) => {
    try {

        const { startDate, endDate } = req.query;
        console.log(startDate, endDate)
        // Validate dates
        if (!startDate || !endDate) {
            return res.json(error("Both startDate and endDate are required", STATUSCODE.NOT_FOUND))
        }

        const { startD, endD, businessStartDate, businessEndDate, hasTimeFilter, createdAtStart, createdAtEnd } = await getShiftedDateRange(startDate, endDate, req.user);

        // Validate date range
        if (!startD || !endD) {
            return res.json(error('Invalid date format. Please use YYYY-MM-DD', STATUSCODE.BAD_REQUEST))
        }

        const timeFilter = hasTimeFilter ? { createdAt: { [Op.between]: [createdAtStart, createdAtEnd] } } : {};
        const timestampRange = hasTimeFilter ? [createdAtStart, createdAtEnd] : [startD, endD];

        // Fetch aggregated order data
        const orderSummary = await Order.findOne({
            where: {
                hotel_id: req.user,
                business_date: { [Op.between]: [businessStartDate, businessEndDate] },
                deleted: false,
                payment: STATUS.SUCCESS,
                ...timeFilter,
            },
            attributes: [
                [sequelize.fn('COUNT', sequelize.col('id')), 'totalBills'],
                [sequelize.fn('SUM', sequelize.col('cash')), 'cashTotal'],
                [sequelize.fn('SUM', sequelize.col('due')), 'dueTotal'],
                [sequelize.fn('SUM', sequelize.col('upi')), 'upiTotal'],
                [sequelize.fn('SUM', sequelize.col('card')), 'cardTotal'],
                [sequelize.fn('SUM', sequelize.col('gst')), 'totalGst'],
                [sequelize.fn('SUM', sequelize.col('grandAmount')), 'totalAmount'],
                [sequelize.fn('SUM', sequelize.col('totalDiscount')), 'totalDiscount'],
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
            raw: true
        });
        const taxSummary = await OrderTax.findAll({

            where: {
                hotel_id: req.user,
                updatedAt: {
                    [Op.between]: timestampRange
                }
            },

            include: [
                {
                    model: Order,
                    where: {
                        hotel_id: req.user,
                        business_date: { [Op.between]: [businessStartDate, businessEndDate] },
                        deleted: false,
                        payment: STATUS.SUCCESS,
                        ...timeFilter,
                    },
                    attributes: [], required: true
                },
                {
                    model: TaxType,
                    attributes: ['id', 'tax_name', 'tax_value', 'amount']
                }
            ],
            attributes: [
                [sequelize.col('hms_tax_type_mst.id'), 'taxId'],
                [sequelize.col('hms_tax_type_mst.tax_name'), 'taxName'],
                [sequelize.col('hms_tax_type_mst.amount'), 'taxRate'],
                [sequelize.col('hms_tax_type_mst.tax_value'), 'taxType'],
                [sequelize.fn('SUM', sequelize.col('hms_order_tax_mst.tax_value')), 'totalTaxAmount'],
                [sequelize.fn('COUNT', sequelize.col('hms_order_tax_mst.id')), 'taxCount']
            ],
            group: [
                'hms_tax_type_mst.id',
                'hms_tax_type_mst.tax_name',
                'hms_tax_type_mst.amount',
                'hms_tax_type_mst.tax_value'
            ],
            raw: true
        });
        const totalDynamicTax = taxSummary.reduce((sum, tax) => {
            return sum + parseFloat(tax.totalTaxAmount || 0);
        }, 0);

        // Format tax breakdown
        const taxBreakdown = taxSummary.map(tax => ({
            taxId: tax.taxId,
            taxName: tax.taxName,
            taxRate: parseFloat(tax.taxRate || 0),
            taxType: tax.taxType,
            totalAmount: parseFloat(tax.totalTaxAmount || 0).toFixed(2),
            applicableOrders: parseInt(tax.taxCount || 0)
        }));
        const orderTypeSummary = await Order.findAll({
            where: {
                hotel_id: req.user,
                business_date: { [Op.between]: [businessStartDate, businessEndDate] },
                deleted: false,
                payment: STATUS.SUCCESS,
                ...timeFilter,
            },
            attributes: [
                'order_type',
                [sequelize.fn('SUM', sequelize.col('grandAmount')), 'totalAmount'],
                [sequelize.fn('COUNT', sequelize.col('id')), 'totalBills'],
            ],
            group: ['order_type'],

            raw: true
        });

        const periodColumn = sequelize.literal("business_date");

        const expense = await ExpenseEntry.findAll({
            where: {
                hotel_id: req.user,
                addExpense: true,
                deleted: false,
                business_date: { [Op.between]: [businessStartDate, businessEndDate] },
            },
            attributes: [
                [periodColumn, 'period'],
                [sequelize.fn('SUM', sequelize.col('amount')), 'totalAmount'],
            ],
            group: [periodColumn],
            order: [[sequelize.literal('period'), 'ASC']],
            raw: true
        });

        const moneyIn = await ExpenseEntry.findAll({
            where: {
                hotel_id: req.user,
                addExpense: false,
                deleted: false,
                business_date: {
                    [Op.between]: [businessStartDate, businessEndDate]
                },
            },
            attributes: [
                [periodColumn, 'period'],
                [sequelize.fn('SUM', sequelize.col('amount')), 'totalAmount'],
            ],
            group: [periodColumn],
            order: [[sequelize.literal('period'), 'ASC']],
            raw: true
        });
        const onlinePeriodColumn = sequelize.literal("DATE(createdAt)");

        const onlineOrders = await OnlineOrders.findAll({
            where: {
                hotel_id: req.user,
                deleted: false,
                createdAt: {
                    [Op.between]: [startD, endD]
                },
            },
            attributes: [
                [onlinePeriodColumn, 'period'],
                [sequelize.fn('SUM', sequelize.col('grandAmount')), 'grandAmount'],
                [sequelize.fn('COUNT', sequelize.col('id')), 'total_bill'],
            ],
            group: [onlinePeriodColumn],
            order: [[sequelize.literal('period'), 'ASC']],
            raw: true
        });



        const formattedSummary = {

            billing: {
                totalDynamicTax, taxBreakdown,
                totalBills: parseInt(orderSummary?.totalBills || 0),
                cashTotal: parseFloat(orderSummary?.cashTotal || 0).toFixed(2),
                dueTotal: parseFloat(orderSummary?.dueTotal || 0).toFixed(2),
                upiTotal: parseFloat(orderSummary?.upiTotal || 0).toFixed(2),
                cardTotal: parseFloat(orderSummary?.cardTotal || 0).toFixed(2),
                totalGst: parseFloat(orderSummary?.totalGst || 0).toFixed(2),
                totalAmount: parseFloat(orderSummary?.totalAmount || 0).toFixed(2),
                totalDiscount: parseFloat(orderSummary?.totalDiscount || 0).toFixed(2),
            },
            orderTypeSummary: orderTypeSummary.map(type => ({
                orderType: type.order_type,
                totalBills: parseInt(type.totalBills || 0),
                totalAmount: parseFloat(type.totalAmount || 0).toFixed(2)
            })),
            expense: expense.map(type => ({
                date: moment(type.createdAt).format("DD/MM/YYYY"),
                totalAmount: parseFloat(type.totalAmount || 0).toFixed(2),
            })),
            moneyIn: moneyIn.map(type => ({
                date: moment(type.createdAt).format("DD/MM/YYYY"),
                totalAmount: parseFloat(type.totalAmount || 0).toFixed(2),
            })),
            billRange: {
                start: orderSummary?.startBillNo || 0,
                end: orderSummary?.endBillNo || 0
            },
            onlineOrders,
            dateRange: {
                start: startD,
                end: endD
            }
        };

        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { exclusiveReportsData: formattedSummary }, STATUSCODE.SUCCESS))

    } catch (err) {
        console.log(err)
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const userWiseOrderGet = async (req, res) => {
    try {
        const { startDate, endDate } = req.query;
        if (!startDate || !endDate) {
            return res.status(STATUSCODE.BAD_REQUEST).json(error('Start date and end date are required', STATUSCODE.BAD_REQUEST));
        }
        const { startD, endD, businessStartDate, businessEndDate, hasTimeFilter, createdAtStart, createdAtEnd } = await getShiftedDateRange(startDate, endDate, req.user);
        if (!startD || !endD) {
            return res.json(error('Invalid date format. Please use YYYY-MM-DD', STATUSCODE.BAD_REQUEST))
        }
        console.log(startD, endD, businessStartDate, businessEndDate)
        const timeFilter = hasTimeFilter ? { createdAt: { [Op.between]: [createdAtStart, createdAtEnd] } } : {};
        const userWiseOrder = await Order.findAll({ where: { hotel_id: req.user, business_date: { [Op.between]: [businessStartDate, businessEndDate] }, payment: STATUS.SUCCESS, deleted: false, ...timeFilter }, include: { model: HotelUser, required: true } })


        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { userWiseOrder }, STATUSCODE.SUCCESS))

    } catch (err) {
        console.log(err, "from User Wise Order get")
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, {}, STATUSCODE.SUCCESS))
    }
}

// Day-wise count of real KOT tickets fired (hms_timeline_mst rows with
// action "kot" - written once per KOT round by kto.js's own
// addToFroRemoveTimeLine/its sibling, so this is a true event log, not a
// derived guess). TimeLine has no business_date column of its own, so this
// groups by DATE(created_Date) in the hotel's own timezone-shifted window
// instead, unlike Order-based reports which group by business_date.
const kotReport = async (req, res) => {
    try {
        const { startDate, endDate } = req.query;
        const { startD, endD } = await getShiftedDateRange(startDate, endDate, req.user);

        const periodColumn = sequelize.literal("DATE(created_Date)");
        const rows = await TimeLine.findAll({
            where: {
                hotel_id: req.user,
                action: 'kot',
                deleted: false,
                created_Date: { [Op.between]: [startD, endD] },
            },
            attributes: [
                [periodColumn, 'period'],
                [sequelize.fn('COUNT', sequelize.col('id')), 'totalTickets'],
                [sequelize.fn('COUNT', sequelize.fn('DISTINCT', sequelize.col('order_id'))), 'totalOrders'],
            ],
            group: [periodColumn],
            order: [[sequelize.literal('period'), 'ASC']],
            raw: true,
        });

        const periodData = rows.map(r => ({
            period: moment(r.period).format('YYYY-MM-DD'),
            totalTickets: parseInt(r.totalTickets) || 0,
            totalOrders: parseInt(r.totalOrders) || 0,
        }));
        const totalTickets = periodData.reduce((s, r) => s + r.totalTickets, 0);

        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, {
            periodData,
            totalTickets,
        }, STATUSCODE.SUCCESS));
    } catch (err) {
        console.log(err, 'kotReport error');
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

module.exports = { getPaginatedData, AllOrderTypeWise, DiscountedOrdersReport, dayWiseGrowthReport, posCollectionReport, ExecutiveSalesReportSummary, userWiseOrderGet, kotReport }