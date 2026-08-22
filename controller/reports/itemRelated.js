const { STATUSCODE, MESSAGE, STATUS } = require("../../constant/const");

const { error, success } = require("../../responce/res");
const { Op } = require("sequelize");
const Order = require("../../model/order");
const sequelize = require("../../connection/connect");

const OrderDetails = require("../../model/order_details");
const Menu = require("../../model/menu");
const Menu_categ = require("../../model/menu_categ");

const Hotel = require("../../model/hotel");
const TaxType = require("../../model/taxType");
const OrderTax = require("../../model/orderTax");

const { getShiftedDateRange } = require("../../utils/dateUtils");
// const itemTextReports = async (req, res) => {
//     try {
//         const hotel = await Hotel.findOne({ where: { id: req.user }, attributes: ['id', 'invoiceFormateIncGst'], raw: true })
//         if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST))
//         const { startDate, endDate } = req.query;
//         // console.log()
//         const [startD, endD, previousStartDate] = getDateRange(startDate, endDate);

//         console.log(startD, endD)

//         // Direct aggregation using sequelize
//         const getAllDynamictaxes =  (await TaxType.findAll({where:{active:true,hotel_id:req.user}})).map(el=>{
//             return {tax_name:el.tax_name,menuIds:el.menu_ids,tax_value:el.tax_value,amount:el.amount}
//         })

//         const itemWiseData = await OrderDetails.findAll({
//             attributes: ['variant_name', "MenuId",
//                 [sequelize.col('hms_menu_mst.item_name'), 'item_name'],
//                 [sequelize.col('hms_menu_mst.gst_type'), 'gst_type'],
//                 [sequelize.col('hms_menu_mst.hms_menu_categ.menu_categ_nm'), 'catagoriesName'],
//                 [sequelize.fn('SUM', sequelize.col('hms_orderDetails.qty')), 'totalQty'],
//                 [sequelize.fn('AVG', sequelize.col('hms_orderDetails.price')), 'price'],
//                 [
//                     sequelize.literal('SUM(hms_orderDetails.qty * hms_orderDetails.price)'),    // Added table name
//                     'totalSale'
//                 ]

//             ],
//             include: [{
//                 model: Menu,
//                 required: true,
//                 attributes: ['item_name'],
//                 include: [{
//                     model: Menu_categ,
//                     attributes: ['menu_categ_nm'],
//                     required: true
//                 }]
//             },
//             {
//                 model: Order,
//                 attributes: [],
//                 required: true,
//                 where: {
//                     hotel_id: req.user,
//                     deleted: false,
//                     payment: STATUS.SUCCESS,
//                     createdAt: {
//                         [Op.between]: [startD, endD]
//                     }
//                 }, as: "order"
//             }
//             ],
//             group: [
//                 'hms_orderDetails.price',
//                 'hms_orderDetails.MenuId',
//                 'hms_orderDetails.variant_id',
//                 'hms_orderDetails.variant_name',
//             ],
//             having: sequelize.literal('SUM(hms_orderDetails.qty) > 0'),
//             order: [[sequelize.literal('SUM(hms_orderDetails.qty)'), 'DESC']],
//             raw: true
//         });
//         console.log(itemWiseData)
//         // Format the response data
//         const formattedData = itemWiseData.map(item => ({
//             item_name: item.item_name,
//             gst_type: item.gst_type,
//             variant_name: item.variant_name,
//             catagoriesName: item.catagoriesName,
//             totalQty: parseInt(item.totalQty),
//             price: parseInt(item.price),
//             totalSale: parseInt(item.totalSale),
//             dynamicTax :getAllDynamictaxes.filter(el=>{
//             if(hotel.invoiceFormateIncGst && item.gst_type==="S"){
//                 if()
//             }
//             }),
//             gst: hotel.invoiceFormateIncGst ? (item.gst_type === "S" ? ((item.totalSale * 5) / 100) : 0) : 0
//         }));


//         // Optional: Group by categories
//         const categoryWiseData = formattedData.reduce((acc, item) => {
//             if (!acc[item.catagoriesName]) {
//                 acc[item.catagoriesName] = {
//                     categoryName: item.catagoriesName,
//                     items: [],
//                     totalQty: 0,
//                     totalSale: 0
//                 };
//             }

//             acc[item.catagoriesName].items.push(item);
//             acc[item.catagoriesName].totalQty += item.totalQty;
//             // acc[item.catagoriesName].price = item.price;
//             acc[item.catagoriesName].totalSale += item.totalSale;

//             return acc;
//         }, {});

//         // Send both item-wise and category-wise data
//         const responseData = {
//             itemWise: formattedData,
//             categoryWise: Object.values(categoryWiseData)
//         };

//         return res.json(success(MESSAGE.SUCCESS, responseData, STATUSCODE.SUCCESS));

//     } catch (err) {
//         console.log(err);
//         return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
//     }

// };


const itemTextReports = async (req, res) => {
    try {
        const hotel = await Hotel.findOne({
            where: { id: req.user },
            attributes: ['id', 'invoiceFormateIncGst'],
            raw: true
        });

        if (!hotel) {
            return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST));
        }

        const { startDate, endDate, gst_type_filter } = req.query;
        const { businessStartDate: startD, businessEndDate: endD } = await getShiftedDateRange(startDate, endDate, req.user);

        // Build optional gst_type where clause:
        //   gst_type_filter=with_tax    → only taxable items  (gst_type != 'N')
        //   gst_type_filter=without_tax → only non-taxable    (gst_type = 'N')
        //   omitted                     → all items (existing behaviour)
        const menuGstWhere =
            gst_type_filter === 'with_tax'    ? { gst_type: { [Op.ne]: 'N' } } :
            gst_type_filter === 'without_tax' ? { gst_type: 'N' } :
            {};

        // Step 1: Fetch OrderDetails with OrderId and MenuId
        const itemWiseData = await OrderDetails.findAll({
            attributes: [
                [sequelize.fn('TRIM', sequelize.fn('IFNULL', sequelize.col('hms_orderDetails.variant_name'), '')), 'variant_name'],
                'MenuId',
                // 'OrderId',
                [sequelize.col('hms_menu_mst.item_name'), 'item_name'],
                [sequelize.col('hms_menu_mst.gst_type'), 'gst_type'],
                [sequelize.col('hms_menu_mst.hms_menu_categ.menu_categ_nm'), 'catagoriesName'],
                [sequelize.fn('SUM', sequelize.col('hms_orderDetails.qty')), 'totalQty'],
                [sequelize.fn('AVG', sequelize.col('hms_orderDetails.price')), 'price'],
                [sequelize.literal('SUM(hms_orderDetails.qty * hms_orderDetails.price)'), 'totalSale']
            ],
            include: [
                {
                    model: Menu,
                    required: true,
                    ...(Object.keys(menuGstWhere).length > 0 && { where: menuGstWhere }),
                    include: [{
                        model: Menu_categ,
                        required: true
                    }]
                },
                {
                    model: Order,
                    attributes: [],
                    required: true,
                    where: {
                        hotel_id: req.user,
                        deleted: false,
                        payment: STATUS.SUCCESS,
                        business_date: { [Op.between]: [startD, endD] }
                    },
                    as: 'order'
                }
            ],
            group: [
                // 'hms_orderDetails.OrderId',
                'hms_orderDetails.MenuId',
                sequelize.fn('TRIM', sequelize.fn('IFNULL', sequelize.col('hms_orderDetails.variant_name'), ''))
            ],
            having: sequelize.literal('SUM(hms_orderDetails.qty) > 0'),
            order: [[sequelize.literal('SUM(hms_orderDetails.qty)'), 'DESC']],
            raw: true
        });

        const orderIds = [...new Set(itemWiseData.map(item => item.OrderId))];

        // Step 2: Fetch OrderTax for those orders
        const orderTaxes = await OrderTax.findAll({
            where: {
                hmsOrderMstId: { [Op.in]: orderIds }
            },
            include: [
                {
                    model: TaxType,
                    attributes: ['tax_name'],
                    required: true
                }
            ],
            attributes: ['hmsOrderMstId', 'tax_value'],
            raw: true
        });

        // Step 3: Group dynamic tax by order_id and tax_name
        const orderTaxMap = {};
        orderTaxes.forEach(tax => {
            const key = `${tax.hmsOrderMstId}_${tax['hms_tax_type_mst.tax_name']}`;
            if (!orderTaxMap[key]) orderTaxMap[key] = 0;
            orderTaxMap[key] += parseFloat(tax.tax_value || 0);
        });

        // Step 4: Rebuild tax data per MenuId
        const menuTaxMap = {};
        const allDynamicTaxHeaders = new Set();
        const getAllDynamictaxes = (await TaxType.findAll({
            where: { active: true, hotel_id: req.user }
        })).map(el => ({
            tax_name: el.tax_name,
            menuIds: el.menu_ids,
            tax_value: el.tax_value,
            amount: el.amount
        }));

        itemWiseData.forEach(item => {
            const menuId = item.MenuId;
            const orderId = item.OrderId;
            const itemTaxes = getAllDynamictaxes
                .filter(tax => tax.menuIds.includes(item.MenuId)) // only applicable taxes
                .reduce((acc, tax) => {
                    allDynamicTaxHeaders.add(tax.tax_name);

                    let taxAmount = 0;

                    if (tax.tax_value === 'pr') {
                        // percentage
                        taxAmount = (item.totalSale * tax.amount) / 100;
                    } else if (tax.tax_value === 'fix') {
                        // fixed amount
                        taxAmount = tax.amount;
                    }

                    acc[tax.tax_name] = (acc[tax.tax_name] || 0) + taxAmount;
                    return acc;
                }, {});
            if (!menuTaxMap[menuId]) menuTaxMap[menuId] = {};
            Object.entries(itemTaxes).forEach(([taxName, tax_value]) => {
                if (!menuTaxMap[menuId][taxName]) menuTaxMap[menuId][taxName] = 0;
                menuTaxMap[menuId][taxName] += tax_value;
            });
        });
        console.log("menuTaxes::::", menuTaxMap)
        // Step 5: Format final output
        const formattedData = itemWiseData.map(item => {
            const dynamicTax = menuTaxMap[item.MenuId] || {};
            // let gst = 0

            const row = {
                item_name: item.item_name,
                variant_name: item.variant_name,
                catagoriesName: item.catagoriesName,
                gst_type: item.gst_type,
                totalQty: parseFloat(item.totalQty),
                price: parseFloat(item.price),
                totalSale: parseFloat(item.totalSale),
                gst: 0
            };

            allDynamicTaxHeaders.forEach(taxName => {
                row[`tax_${taxName}`] = dynamicTax[taxName] || 0;
                row.gst = row.gst + dynamicTax[taxName] || 0
            });

            return row;
        });

        // Step 6: Group by category
        const categoryWiseData = formattedData.reduce((acc, item) => {
            if (!acc[item.catagoriesName]) {
                acc[item.catagoriesName] = {
                    categoryName: item.catagoriesName,
                    items: [],
                    totalQty: 0,
                    totalSale: 0
                };
            }

            acc[item.catagoriesName].items.push(item);
            acc[item.catagoriesName].totalQty += item.totalQty;
            acc[item.catagoriesName].totalSale += item.totalSale;

            return acc;
        }, {});

        // Step 7: Headers for frontend
        const taxHeaders = Array.from(allDynamicTaxHeaders).sort().map(taxName => ({
            key: `tax_${taxName}`,
            label: taxName,
            type: 'tax'
        }));

        const headers = [

            ...taxHeaders
        ];

        console.log("Fromated Datat::", formattedData)

        return res.json(success(MESSAGE.SUCCESS, {
            itemWise: formattedData,
            categoryWise: Object.values(categoryWiseData),
            headers
        }, STATUSCODE.SUCCESS));

    } catch (err) {
        console.log(err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};


const calculateAggregates = (data) => {
    // console.log(data)
    const result = {
        total: { item_name: "Total" },
        min: { item_name: "Min." },
        max: { item_name: "Max." },
        avg: { item_name: "Avg." }
    };

    // Initialize result object
    const fields = [
        'totalQty',
        'totalSale',
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

const HighestSellingReports = async (req, res) => {
    try {
        const hotel = await Hotel.findOne({ where: { id: req.user }, attributes: ['id', 'invoiceFormateIncGst'], raw: true })
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST))
        const { startDate, endDate } = req.query;
        // console.log()
        const { startD, endD, previousStartD: previousStartDate } = await getShiftedDateRange(startDate, endDate, req.user);
        console.log(startD, endD)
        // Direct aggregation using sequelize
        const itemWiseData = await OrderDetails.findAll({
            attributes: [
                [sequelize.col('hms_menu_mst.item_name'), 'item_name'],
                [sequelize.col('hms_orderDetails.variant_name'), 'variant_name'],

                [sequelize.col('hms_menu_mst.hms_menu_categ.menu_categ_nm'), 'catagoriesName'],
                [sequelize.fn('SUM', sequelize.col('hms_orderDetails.qty')), 'totalQty'],
                [
                    sequelize.literal('SUM(hms_orderDetails.qty * hms_orderDetails.price)'),    // Added table name
                    'totalSale'
                ]
            ],
            include: [{
                model: Menu,
                required: true,
                attributes: ['item_name'],
                include: [{
                    model: Menu_categ,
                    attributes: ['menu_categ_nm'],
                    required: true
                }]
            },
            {
                model: Order,
                attributes: [],
                required: true,
                where: {
                    hotel_id: req.user,
                    deleted: false,
                    payment: STATUS.SUCCESS,
                    business_date: { [Op.between]: [startD, endD] }
                }, as: "order"
            }
            ],
            group: [
                'hms_orderDetails.price',
                'hms_orderDetails.MenuId',
                'hms_orderDetails.variant_name',
            ],
            having: sequelize.literal('SUM(hms_orderDetails.qty) > 0'),
            order: [[sequelize.literal('SUM(hms_orderDetails.qty)'), 'DESC']],
            raw: true
        });
        console.log(itemWiseData)
        // Format the response data
        const formattedData = itemWiseData.map(item => ({
            item_name: item.item_name,
            variant_name: item?.variant_name || "",

            catagoriesName: item.catagoriesName,
            totalQty: parseInt(item.totalQty),

            totalSale: parseInt(item.totalSale),

        }));

        const result = calculateAggregates(formattedData)
        formattedData.unshift(result.avg)
        formattedData.unshift(result.max)
        formattedData.unshift(result.min)
        formattedData.unshift(result.total)

        const responseData = {
            itemWise: formattedData,
        };

        return res.json(success(MESSAGE.SUCCESS, responseData, STATUSCODE.SUCCESS));

    } catch (err) {
        console.log(err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }

};
const getDayWiseItemReport = async (startDate, endDate, hotel_id) => {
    try {

        const { businessStartDate: startD, businessEndDate: endD } = await getShiftedDateRange(startDate, endDate, hotel_id);

        const itemWiseData = await OrderDetails.findAll({
            attributes: [
                [sequelize.col('hms_menu_mst.item_name'), 'item_name'],
                [sequelize.fn('SUM', sequelize.col('hms_orderDetails.qty')), 'qty'],
                [sequelize.col('hms_orderDetails.price'), 'price'],
                [sequelize.fn('IFNULL', sequelize.col('hms_orderDetails.variant_name'), ''), 'variant_name'],
                [sequelize.literal('SUM(hms_orderDetails.qty * hms_orderDetails.price)'), 'totalSale'],
                [sequelize.col('order.business_date'), 'orderDate']
            ],
            include: [{
                model: Menu,
                required: true,
                attributes: ['item_name']
            },
            {
                model: Order,
                attributes: [],
                required: true,
                where: {
                    hotel_id,
                    deleted: false,
                    payment: STATUS.SUCCESS,
                    business_date: { [Op.between]: [startD, endD] }
                },
                as: "order"
            }],
            group: [
                'hms_orderDetails.MenuId',
                'hms_orderDetails.price',
                sequelize.fn('IFNULL', sequelize.col('hms_orderDetails.variant_name'), ''),
                sequelize.col('order.business_date')
            ],
            having: sequelize.literal('SUM(hms_orderDetails.qty) > 0'),
            raw: true
        });

        // Format and group by date
        const dayWiseReport = itemWiseData.reduce((acc, item) => {
            const dateKey = new Date(item.orderDate).toLocaleDateString();
            const i = acc.findIndex(el => el.period === dateKey)
            if (i === -1) {
                const defaultData = {
                    period: dateKey,
                    items: [],
                    totalQty: 0,
                    totalSale: 0
                };
                const formattedItem = {
                    item_name: item.item_name,
                    variant_name: item.variant_name,
                    qty: parseInt(item.qty),
                    price: parseInt(item.price),
                    totalSale: parseInt(item.totalSale)
                };
                console.log(defaultData)
                defaultData.items.push(formattedItem);
                defaultData.totalQty += formattedItem.qty;
                defaultData.totalSale += formattedItem.totalSale;
                acc.push(defaultData)
                return acc
            }

            const formattedItem = {
                item_name: item.item_name,
                variant_name: item.variant_name,
                qty: parseInt(item.qty),
                price: parseInt(item.price),
                totalSale: parseInt(item.totalSale)
            };
            console.log(acc[i])
            acc[i].items.push(formattedItem);
            acc[i].totalQty += formattedItem.qty;
            acc[i].totalSale += formattedItem.totalSale;

            return acc;
        }, []);

        return dayWiseReport

    } catch (err) {
        throw new Error(err)
    }
};
const getMonthWiseItemReport = async (startDate, endDate, hotel_id) => {
    try {

        const { businessStartDate: startD, businessEndDate: endD } = await getShiftedDateRange(startDate, endDate, hotel_id);

        const itemWiseData = await OrderDetails.findAll({
            attributes: [
                [sequelize.col('hms_menu_mst.item_name'), 'item_name'],
                [sequelize.fn('SUM', sequelize.col('hms_orderDetails.qty')), 'qty'],
                [sequelize.col('hms_orderDetails.price'), 'price'],
                [sequelize.fn('IFNULL', sequelize.col('hms_orderDetails.variant_name'), ''), 'variant_name'],
                [sequelize.literal('SUM(hms_orderDetails.qty * hms_orderDetails.price)'), 'totalSale'],
                [sequelize.fn('DATE_FORMAT', sequelize.col('order.business_date'), '%Y-%m'), 'yearMonth']
            ],
            include: [{
                model: Menu,
                required: true,
                attributes: ['item_name']
            },
            {
                model: Order,
                attributes: [],
                required: true,
                where: {
                    hotel_id,
                    deleted: false,
                    payment: STATUS.SUCCESS,
                    business_date: { [Op.between]: [startD, endD] }
                },
                as: "order"
            }],
            group: [
                'hms_orderDetails.MenuId',
                'hms_orderDetails.price',
                sequelize.fn('IFNULL', sequelize.col('hms_orderDetails.variant_name'), ''),
                sequelize.fn('DATE_FORMAT', sequelize.col('order.business_date'), '%Y-%m')
            ],
            having: sequelize.literal('SUM(hms_orderDetails.qty) > 0'),
            raw: true
        });

        // Format and group by month
        const monthWiseReport = itemWiseData.reduce((acc, item) => {
            const [year, month] = item.yearMonth.split('-');
            const monthKey = `${month}/${year}`;
            const i = acc.findIndex(el => el.period === monthKey)
            if (i === -1) {
                const defaultData = {
                    period: monthKey,
                    items: [],
                    totalQty: 0,
                    totalSale: 0
                };
                const formattedItem = {
                    item_name: item.item_name,
                    variant_name: item.variant_name,
                    qty: parseInt(item.qty),
                    price: parseInt(item.price),
                    totalSale: parseInt(item.totalSale)
                };
                console.log(defaultData)
                defaultData.items.push(formattedItem);
                defaultData.totalQty += formattedItem.qty;
                defaultData.totalSale += formattedItem.totalSale;
                acc.push(defaultData)
                return acc
            }

            const formattedItem = {
                item_name: item.item_name,
                variant_name: item.variant_name,
                qty: parseInt(item.qty),
                price: parseInt(item.price),
                totalSale: parseInt(item.totalSale)
            };
            console.log(acc[i])
            acc[i].items.push(formattedItem);
            acc[i].totalQty += formattedItem.qty;
            acc[i].totalSale += formattedItem.totalSale;

            return acc;
        }, []);

        return monthWiseReport;

    } catch (err) {
        throw new Error(err)
    }
};
const getYearWiseItemReport = async (startDate, endDate, hotel_id) => {
    try {

        const { businessStartDate: startD, businessEndDate: endD } = await getShiftedDateRange(startDate, endDate, hotel_id);

        const itemWiseData = await OrderDetails.findAll({
            attributes: [
                [sequelize.col('hms_menu_mst.item_name'), 'item_name'],
                [sequelize.fn('SUM', sequelize.col('hms_orderDetails.qty')), 'qty'],
                [sequelize.col('hms_orderDetails.price'), 'price'],
                [sequelize.fn('IFNULL', sequelize.col('hms_orderDetails.variant_name'), ''), 'variant_name'],
                [sequelize.literal('SUM(hms_orderDetails.qty * hms_orderDetails.price)'), 'totalSale'],
                [sequelize.fn('YEAR', sequelize.col('order.business_date')), 'year']
            ],
            include: [{
                model: Menu,
                required: true,
                attributes: ['item_name']
            },
            {
                model: Order,
                attributes: [],
                required: true,
                where: {
                    hotel_id,
                    deleted: false,
                    payment: STATUS.SUCCESS,
                    business_date: { [Op.between]: [startD, endD] }
                },
                as: "order"
            }],
            group: [
                'hms_orderDetails.MenuId',
                'hms_orderDetails.price',
                sequelize.fn('IFNULL', sequelize.col('hms_orderDetails.variant_name'), ''),
                sequelize.fn('YEAR', sequelize.col('order.business_date'))
            ],
            having: sequelize.literal('SUM(hms_orderDetails.qty) > 0'),
            raw: true
        });

        // Format and group by year
        const yearWiseReport = itemWiseData.reduce((acc, item) => {
            const yearKey = item.year.toString();

            const i = acc.findIndex(el => el.period === yearKey)
            if (i === -1) {
                const defaultData = {
                    period: yearKey,
                    items: [],
                    totalQty: 0,
                    totalSale: 0
                };
                const formattedItem = {
                    item_name: item.item_name,
                    variant_name: item.variant_name,
                    qty: parseInt(item.qty),
                    price: parseInt(item.price),
                    totalSale: parseInt(item.totalSale)
                };
                console.log(defaultData)
                defaultData.items.push(formattedItem);
                defaultData.totalQty += formattedItem.qty;
                defaultData.totalSale += formattedItem.totalSale;
                acc.push(defaultData)
                return acc
            }

            const formattedItem = {
                item_name: item.item_name,
                variant_name: item.variant_name,
                qty: parseInt(item.qty),
                price: parseInt(item.price),
                totalSale: parseInt(item.totalSale)
            };
            console.log(acc[i])
            acc[i].items.push(formattedItem);
            acc[i].totalQty += formattedItem.qty;
            acc[i].totalSale += formattedItem.totalSale;

            return acc;
        }, []);

        return yearWiseReport

    } catch (err) {
        throw new Error(err)
    }
};
const itemReportDayWise = async (req, res) => {
    try {

        const { startDate, endDate, period = "daily" } = req.query

        if (!['daily', 'monthly', 'yearly'].includes(period)) {
            return res.status(400).json({
                message: 'Invalid period. Choose daily, monthly, or yearly.'
            });
        }
        let data = await (
            period === "monthly"
                ? getMonthWiseItemReport(startDate, endDate, req.user)
                : period === 'yearly'
                    ? getYearWiseItemReport(startDate, endDate, req.user)
                    : period === 'daily'
                        ? getDayWiseItemReport(startDate, endDate, req.user)
                        : null
        );

        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { data }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err)
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))

    }
}
module.exports = { HighestSellingReports, itemTextReports, itemReportDayWise }