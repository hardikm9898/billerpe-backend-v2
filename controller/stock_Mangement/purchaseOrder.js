const { MESSAGE, STATUSCODE } = require("../../constant/const")
const Hotel = require("../../model/hotel")
const PurchaseOrder = require("../../model/Inventory/purchaseOrder")
const PurchaseRawMaterial = require("../../model/Inventory/purchaseRawMaterial")
const StockInHand = require("../../model/stockInHand")
const StockHistory = require("../../model/stockHistory")
const { error, success } = require("../../responce/res")
const { stockInFunction } = require("./stockInOut")
const { Op, where, Sequelize } = require("sequelize")

const PurchaseOrderPayment = require("../../model/Inventory/purchaseOrderPayment")
const Supplier = require("../../model/Inventory/supplyer")
const sequelize = require("../../connection/connect")
const Unit = require("../../model/unit")
const HotelUser = require("../../model/hotelUser")
const RawMaterial = require("../../model/rawItem")
const Order = require("../../model/order")
const RawMaterialConsumption = require("../../model/Inventory/RawMaterialcon")
const OrderDetails = require("../../model/order_details")
const Menu = require("../../model/menu")
const { getBusinessDate, getShiftedDateRange } = require("../../utils/dateUtils")
const RestaurantSetting = require("../../model/restaurantSetting")
const Recipes = require("../../model/recipes")
const SemiFinishedItem = require("../../model/semiFinishedItem")
const SemiFinishedStock = require("../../model/semiFinishedStock")



const createPurchaseOrder = async (req, res) => {
    const t = await sequelize.transaction()
    try {

        const { supplier_id, sub_total, discount_value, discount_type, paymentDate, paidAmount, payment_type, GSTNo, update_inventory = true, grandAmount, discount, delivery_charge, payment_mode, invoice_date, invoice_number, Po_no, rawMaterialData, payment_ref_no } = req.body

        const setting = await RestaurantSetting.findOne({ where: { hotel_id: req.user } });
        const timeZone = setting?.timeZone || 'Asia/Kolkata';
        const businessStartTime = setting?.business_day_start_time || '00:01:00';
        const business_date = getBusinessDate(timeZone, businessStartTime);

        const purchaseOrder = await PurchaseOrder.create({ business_date, sub_total, discount_value, discount_type, supplier_id, payment_type, GSTNo, update_inventory, grandAmount, discount, hotel_id: req.user, delivery_charge, invoice_date, invoice_number, Po_no, userId: req.userId }, { transaction: t })
        if (payment_type === "paid") {
            await PurchaseOrderPayment.create({ paymentDate, amount: paidAmount, hotel_id: req.user, payment_mode, payment_ref_no, purchaseOrderId: purchaseOrder.id, userId: req.userId }, { transaction: t })
        }
        for (const element of rawMaterialData) {
            const { raw_material_id, qty, price, amount, cgst, sgst, igst, unit_id } = element
            await PurchaseRawMaterial.create({ business_date, raw_material_id, qty, price, amount, sgst, cgst, igst, unit_id, purchaseOrderId: purchaseOrder.id, hotel_id: req.user }, { transaction: t })
            await stockInFunction({ raw_material_id, qty, price, hotel_id: req.user, userId: req.userId }, res)
        }
        await t.commit()
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { message: "Purchase Order Created" }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err)
        await t.rollback()
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

const editPurchaseOrder = async (req, res) => {
    try {

        const { id, supplier_id, discount_type, discount_value, sub_total, payment_type, GSTNo, update_inventory = true, grandAmount, discount, delivery_charge, invoice_date, invoice_number, Po_no, rawMaterialData } = req.body

        // Find the purchase order
        const purchaseOrder = await PurchaseOrder.findOne({ where: { id, deleted_status: false } })
        if (!purchaseOrder) {
            return res.status(STATUSCODE.BAD_REQUEST).json(error("Purchase Order not found", STATUSCODE.BAD_REQUEST))
        }

        // Update the purchase order
        await PurchaseOrder.update(
            { supplier_id, GSTNo, grandAmount, discount, discount_type, discount_value, sub_total, invoice_date, invoice_number },
            { where: { id } }
        )

        // Get existing purchase raw materials
        const existingRawMaterials = await PurchaseRawMaterial.findAll({
            where: { purchaseOrderId: id, deleted_status: false }
        })

        // Create a map of existing raw materials for easy lookup
        const existingRawMaterialMap = new Map()
        for (const rawMaterial of existingRawMaterials) {
            existingRawMaterialMap.set(rawMaterial.raw_material_id, rawMaterial)
        }

        // Process each raw material in the request
        for (const element of rawMaterialData) {
            const { raw_material_id, qty, price, amount, cgst, sgst, igst, unit_id, id: rawMaterialId } = element

            if (rawMaterialId) {
                // Update existing raw material
                const existingRawMaterial = await PurchaseRawMaterial.findOne({
                    where: { id: rawMaterialId, deleted_status: false }
                })

                if (existingRawMaterial) {
                    // Calculate quantity difference
                    const qtyDifference = qty - existingRawMaterial.qty

                    // Update the raw material
                    await PurchaseRawMaterial.update(
                        { raw_material_id, qty, price, amount, sgst, cgst, igst, unit_id },
                        { where: { id: rawMaterialId } }
                    )

                    // Update stock if quantity changed
                    if (qtyDifference !== 0) {
                        // Find the stock in hand for this raw material
                        const stockInHand = await StockInHand.findOne({
                            where: { raw_material_id, hotel_id: req.user, deleted: false }
                        })

                        if (qtyDifference > 0) {
                            // Add to stock
                            await stockInFunction({
                                raw_material_id,
                                qty: qtyDifference,
                                price,
                                hotel_id: req.user
                            }, res)
                        } else if (qtyDifference < 0 && stockInHand) {
                            // Remove from stock
                            const absQtyDiff = Math.abs(qtyDifference)

                            if (stockInHand.qty < absQtyDiff) {
                                return res.status(STATUSCODE.BAD_REQUEST).json(
                                    error("Not enough stock available", STATUSCODE.BAD_REQUEST)
                                )
                            }

                            if (stockInHand.qty === absQtyDiff) {
                                await StockInHand.destroy({ where: { id: stockInHand.id } })
                            } else {
                                await StockInHand.update(
                                    {
                                        qty: stockInHand.qty - absQtyDiff,
                                        total_amount: (stockInHand.qty - absQtyDiff) * stockInHand.average_price
                                    },
                                    { where: { id: stockInHand.id } }
                                )
                            }

                            // Create stock history record for stock out
                            const setting = await RestaurantSetting.findOne({ where: { hotel_id: req.user } });
                            const timeZone = setting?.timeZone || 'Asia/Kolkata';
                            const businessStartTime = setting?.business_day_start_time || '00:01:00';
                            const business_date = getBusinessDate(timeZone, businessStartTime);

                            await StockHistory.create({
                                business_date,
                                price: price.toString(),
                                total_amount: (absQtyDiff * price).toString(),
                                qty: absQtyDiff,
                                stock_in: false,
                                raw_material_id,
                                hotel_id: req.user,
                                user_id: req.userId
                            })
                        }
                    }

                    // Remove from map to track which ones were processed
                    existingRawMaterialMap.delete(existingRawMaterial.raw_material_id)
                }
            } else {
                // Create new raw material
                const setting = await RestaurantSetting.findOne({ where: { hotel_id: req.user } });
                const timeZone = setting?.timeZone || 'Asia/Kolkata';
                const businessStartTime = setting?.business_day_start_time || '00:01:00';
                const business_date = getBusinessDate(timeZone, businessStartTime);

                await PurchaseRawMaterial.create({
                    business_date, raw_material_id, qty, price, amount, sgst, cgst, igst, unit_id, purchaseOrderId: id, hotel_id: req.user
                })

                // Add to stock
                await stockInFunction({
                    raw_material_id, qty, price, hotel_id: req.user
                }, res)
            }
        }

        // Handle raw materials that were removed
        for (const [_, rawMaterial] of existingRawMaterialMap) {
            // Soft delete the raw material
            await PurchaseRawMaterial.update(
                { deleted_status: true },
                { where: { id: rawMaterial.id } }
            )

            // Remove from stock
            const stockInHand = await StockInHand.findOne({
                where: { raw_material_id: rawMaterial.raw_material_id, hotel_id: req.user, deleted: false }
            })

            if (stockInHand) {
                if (stockInHand.qty === rawMaterial.qty) {
                    await StockInHand.destroy({ where: { id: stockInHand.id } })
                } else if (stockInHand.qty > rawMaterial.qty) {
                    await StockInHand.update(
                        {
                            qty: stockInHand.qty - rawMaterial.qty,
                            total_amount: (stockInHand.qty - rawMaterial.qty) * stockInHand.average_price
                        },
                        { where: { id: stockInHand.id } }
                    )
                } else {
                    return res.status(STATUSCODE.BAD_REQUEST).json(
                        error("Not enough stock available", STATUSCODE.BAD_REQUEST)
                    )
                }

                // Create stock history record for stock out
                const setting = await RestaurantSetting.findOne({ where: { hotel_id: req.user } });
                const timeZone = setting?.timeZone || 'Asia/Kolkata';
                const businessStartTime = setting?.business_day_start_time || '00:01:00';
                const business_date = getBusinessDate(timeZone, businessStartTime);

                await StockHistory.create({
                    business_date,
                    price: rawMaterial.price.toString(),
                    total_amount: (rawMaterial.qty * rawMaterial.price).toString(),
                    qty: rawMaterial.qty,
                    stock_in: false,
                    raw_material_id: rawMaterial.raw_material_id,
                    hotel_id: req.user,
                    user_id: req.userId
                })
            }
        }

        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { message: "Purchase Order Updated" }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.error(err)
        return res.status(STATUSCODE.INTERNAL_SERVER_ERROR).json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

const deletePurchaseorder = async (req, res) => {
    try {
        const { id } = req.body

        // Find the purchase order
        const purchaseOrder = await PurchaseOrder.findOne({ where: { id, deleted_status: false } })
        if (!purchaseOrder) {

            return res.status(STATUSCODE.BAD_REQUEST).json(error("Purchase Order not found", STATUSCODE.BAD_REQUEST))
        }

        // Get all raw materials for this purchase order
        const rawMaterials = await PurchaseRawMaterial.findAll({
            where: { purchaseOrderId: id, deleted_status: false }
        })

        // Process each raw material
        for (const rawMaterial of rawMaterials) {
            // Find the stock in hand for this raw material
            const stockInHand = await StockInHand.findOne({
                where: { raw_material_id: rawMaterial.raw_material_id, hotel_id: req.user, deleted: false }
            })

            if (stockInHand) {
                if (stockInHand.qty === rawMaterial.qty) {
                    // If the stock quantity equals the raw material quantity, remove the stock
                    await StockInHand.destroy({ where: { id: stockInHand.id } })
                } else if (stockInHand.qty > rawMaterial.qty) {
                    // If the stock quantity is greater, reduce it
                    await StockInHand.update(
                        {
                            qty: stockInHand.qty - rawMaterial.qty,
                            total_amount: (stockInHand.qty - rawMaterial.qty) * stockInHand.average_price
                        },
                        { where: { id: stockInHand.id } }
                    )
                } else {

                    return res.json(error("Not enough stock available to delete this purchase order", STATUSCODE.BAD_REQUEST))
                    // Not enough stock available

                }

                // Create stock history record for stock out
                const setting = await RestaurantSetting.findOne({ where: { hotel_id: req.user } });
                const timeZone = setting?.timeZone || 'Asia/Kolkata';
                const businessStartTime = setting?.business_day_start_time || '00:01:00';
                const business_date = getBusinessDate(timeZone, businessStartTime);

                await StockHistory.create({
                    business_date,
                    price: rawMaterial.price.toString(),
                    total_amount: (rawMaterial.qty * rawMaterial.price).toString(),
                    qty: rawMaterial.qty,
                    stock_in: false,
                    raw_material_id: rawMaterial.raw_material_id,
                    hotel_id: req.user,
                    user_id: req.userId
                })
            }

            // Soft delete the raw material
            await PurchaseRawMaterial.update(
                { deleted_status: true },
                { where: { id: rawMaterial.id } }
            )
        }

        // Soft delete the purchase order
        await PurchaseOrder.update(
            { deleted_status: true },
            { where: { id } }
        )
        await PurchaseOrderPayment.update(
            { deleted_status: true },
            { where: { purchaseOrderId: id } }
        )

        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { message: "Purchase Order Deleted" }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.error(err)
        return res.status(STATUSCODE.INTERNAL_SERVER_ERROR).json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

const getPurchaseOrders = async (req, res) => {
    try {
        const { startDate, endDate } = req.query;
        const { startD, endD } = await getShiftedDateRange(startDate, endDate, req.user);
        console.log(startD, endD)
        // Get all purchase orders with related data
        const purchaseOrders = await PurchaseOrder.findAll({
            where: {
                hotel_id: req.user, // assuming req.user has id property
                business_date: { [Op.between]: [startD, endD] }
            },
            include: [
                {
                    model: HotelUser,
                    attributes: ["id", "name"]
                },
                {
                    model: PurchaseRawMaterial,
                    include: [
                        {
                            model: Unit,
                        }, {
                            model: RawMaterial, as: "rawMaterial"
                        }
                    ]
                },
                {
                    model: Supplier,
                    attributes: ["id", "name"]
                },
                {
                    model: PurchaseOrderPayment,
                    include: { model: HotelUser, attributes: ['name'] },
                    attributes: ["id", "amount", "paymentDate", "payment_mode", "payment_ref_no", "deleted_status", "createdAt"]
                }
            ],
            order: [['createdAt', 'DESC']]
        });
        const dummanyPurchase = await PurchaseOrder.findAll({
            where: {
                hotel_id: req.user, // assuming req.user has id property
                business_date: { [Op.between]: [startD, endD] }
            },
        })
        console.log(dummanyPurchase, "Hlloooo")
        // Calculate totals
        const totalGrandAmount = await PurchaseOrder.sum('grandAmount', {
            where: {
                hotel_id: req.user, deleted_status: false,
                business_date: { [Op.between]: [startD, endD] }
            }
        });

        // Calculate total payments made for these orders
        const totalPayment = await PurchaseOrderPayment.sum('amount', {
            where: {
                hotel_id: req.user,
                deleted_status: false
            },
            include: {
                model: PurchaseOrder,
                where: {
                    deleted_status: false,
                    hotel_id: req.user,
                    business_date: { [Op.between]: [startD, endD] }
                },
                attributes: [],
                required: true
            }
        });
        console.log(totalPayment, "Payment")
        // Calculate outstanding amount
        const outStandingPayment = totalGrandAmount - (totalPayment || 0);

        // Format response data
        const response = {
            purchaseOrders: purchaseOrders.map(order => {
                let payment = 0;
                order.hms_purchase_payments.forEach(ele => {
                    payment += ele.amount
                });
                return {
                    id: order.id,
                    orderNumber: order.orderNumber,
                    date: order.createdAt,
                    invoice_date: order.invoice_date,
                    invoice_number: order.invoice_number,
                    Po_no: order.Po_no,
                    grandAmount: order.grandAmount,
                    GSTNo: order.GSTNo,
                    status: order.status,
                    paymentStatus: order.paymentStatus,
                    deleted_status: order.deleted_status,
                    sub_total: order.sub_total,
                    discount: order.discount,
                    discount_type: order.discount_type,
                    discount_value: order.discount_value,
                    hms_hotelUser_master: order.hms_hotelUser_master,
                    supplier: order.hms_supplier,
                    rawMaterials: order.hms_purchase_rawMaterials.map(prm => ({
                        id: prm.id,
                        raw_material_id: prm.raw_material_id,
                        raw_material_name: prm.rawMaterial?.raw_material_name,
                        name: prm.name,
                        quantity: prm.qty,
                        unit: prm.hms_unit_mst,
                        price: prm.price,
                        amount: prm.amount,
                        cgst: prm.cgst,
                        sgst: prm.sgst,
                        igst: prm.igst
                    })),

                    payments: payment,
                    paymentList: order.hms_purchase_payments
                }
            }
            ),
            summary: {
                totalPurchase: totalGrandAmount || 0,
                totalPayment: totalPayment || 0,
                outStandingPayment: outStandingPayment || 0,
                totalOrders: purchaseOrders.length
            }
        };

        return res.status(STATUSCODE.SUCCESS).json(
            success(MESSAGE.SUCCESS, response, STATUSCODE.SUCCESS)
        );

    } catch (err) {
        console.error(err);
        return res.status(STATUSCODE.INTERNAL_SERVER_ERROR).json(
            error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR)
        );
    }
};

const createSupplier = async (req, res) => {
    try {

        const { name } = req.body
        console.log(req.body)
        if (!name) return res.json(error("Name Is Required", STATUSCODE.BAD_REQUEST))
        const supplier = await Supplier.create({ name, hotel_id: req.user })
        // const supplier = await Supplier.findAll({ where: { hotel_id: req.user, deleted_status: false } })
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { supplier, message: "Supplier Created" }, STATUSCODE.SUCCESS))

    } catch (err) {
        console.log(err)
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const editSupplier = async (req, res) => {
    try {

        const { name, id } = req.body

        if (!name) return res.json(error("Name Is Required", STATUSCODE.BAD_REQUEST))
        if (!id) return res.json(error("Supplier  Is Required", STATUSCODE.BAD_REQUEST))
        await Supplier.update({ name }, { where: { id } })
        const supplier = await Supplier.findAll({ where: { hotel_id: req.user, deleted_status: false } })
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { supplier, message: "Supplier Updated" }, STATUSCODE.SUCCESS))

    } catch (err) {
        console.log(err)
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const getSupplier = async (req, res) => {
    try {
        const suppliers = await Supplier.findAll({ where: { hotel_id: req.user, deleted_status: false } })

        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { suppliers }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err)
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const getMaxPo = async (req, res) => {
    try {
        const maxPo = await PurchaseOrder.max('Po_no', { where: { hotel_id: req.user, deleted_status: false } })

        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { maxPo: maxPo + 1 }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err)
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const paymentDone = async (req, res) => {
    try {
        const { id, payment_mode, payment_date, paidAmount, payment_ref_no } = req.body
        const findPurchaseOrder = await PurchaseOrder.findByPk(id)
        if (!findPurchaseOrder) return res.json(error("Purchase Order Not Found", STATUSCODE.BAD_REQUEST))
        await PurchaseOrderPayment.create({ purchaseOrderId: id, payment_mode, date: payment_date, amount: paidAmount, payment_ref_no, userId: req.userId, hotel_id: req.user })
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { message: "Payment Successfully Updated" }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err)
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const getSupplierWisePurchaseOrder = async (req, res) => {
    try {
        let { startDate, endDate, search } = req.query
        const { startD, endD } = await getShiftedDateRange(startDate, endDate, req.user);
        const whereCondition = {
            hotel_id: req.user, deleted_status: false,

        }
        if (search) {
            whereCondition.name = { [Op.like]: `%${search}%` }
        }
        // Get all suppliers with their purchase orders and raw materials   
        let suppliers = await Supplier.findAll({
            where: whereCondition,
            include: [
                {
                    model: PurchaseOrder,
                    where: { hotel_id: req.user, business_date: { [Op.between]: [startD, endD] }, deleted_status: false },
                    include: [
                        {
                            model: PurchaseRawMaterial,
                            include: [
                                { model: Unit },
                                { model: RawMaterial, as: "rawMaterial" }
                            ]
                        },
                        { model: PurchaseOrderPayment }
                    ],
                    required: true
                }
            ],

        });
        suppliers = JSON.parse(JSON.stringify(suppliers))
        // Calculate total purchase amount and total paid amount for each supplier
        console.log(suppliers, "suppliers")

        let totalGransPurchaseAmount = 0
        let totalGransPaidAmount = 0
        const response = suppliers.map(supplier => {
            let totalPurchaseAmount = 0;
            let totalPaidAmount = 0;

            supplier.hms_purchase_orders.forEach(order => {
                totalPurchaseAmount += order.grandAmount || 0;
                order.hms_purchase_payments.forEach(payment => {
                    totalPaidAmount += payment.amount || 0;
                });
            });
            totalGransPurchaseAmount += totalPurchaseAmount || 0
            totalGransPaidAmount += totalPaidAmount || 0
            return {
                totalPurchaseAmount,
                totalPaidAmount,
                ...supplier
            };
        });
        // console.log(response, "response")
        return res.status(STATUSCODE.SUCCESS).json(
            success(MESSAGE.SUCCESS, { suppliers: response, totalGransPaidAmount, totalGransPurchaseAmount, totalRemainingAmount: totalGransPurchaseAmount - totalGransPaidAmount }, STATUSCODE.SUCCESS)
        );
        // return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { purchaseOrders }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err)
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const orderWiserConsumptionReports = async (req, res) => {
    try {
        const { startDate, endDate, search } = req.query;
        const { startD, endD } = await getShiftedDateRange(startDate, endDate, req.user);

        const orderWhere = { hotel_id: req.user, deleted: false };
        if (search) {
            orderWhere.bill_no = { [Op.like]: `%${search}%` };
        } else {
            orderWhere.business_date = { [Op.between]: [startD, endD] };
        }

        const orders = await Order.findAll({
            where: orderWhere,
            attributes: ['id', 'bill_no', 'totalAmount', 'createdAt', 'gst'],
            include: [
                {
                    model: RawMaterialConsumption,
                    as: "consumptionRawMaterial",
                    required: false,
                    where: { status: "CONSUMED", purpose: "RECIPE" },
                    attributes: ['raw_material_id', 'consumed_qty', 'cost', 'menu_id', 'variant_id', 'addon_id'],
                    include: [{
                        model: RawMaterial,
                        as: "rawMaterial",
                        attributes: ['raw_material_name'],
                        include: [{ model: Unit, as: "consumptionUnit", attributes: ['unit_name'] }]
                    }]
                },
                {
                    model: OrderDetails,
                    attributes: ['qty', 'price', 'MenuId', 'variant_name', 'addons', 'variant_id'],
                    include: [{ model: Menu, attributes: ['item_name', 'stockTrack'] }]
                }
            ],
            order: [['createdAt', 'DESC']]
        });

        if (!orders.length) {
            return res.status(200).json(success("SUCCESS", { orders: [], totalSales: 0, totalGrandCost: 0 }, 200));
        }

        // Collect menu IDs from stock-tracked items to fetch SFI recipes
        const allMenuIds = new Set();
        for (const order of orders) {
            for (const d of order.hms_orderDetails) {
                if (d.hms_menu_mst?.stockTrack) allMenuIds.add(d.MenuId);
            }
        }

        // Fetch SFI recipes for those menus in one query
        const sfiRecipeMap = {};
        const sfiCostMap = {};   // sfi_id → cost_per_unit
        if (allMenuIds.size > 0) {
            const sfiRecipes = await Recipes.findAll({
                where: { menu_id: [...allMenuIds], hotel_id: req.user },
                attributes: ['menu_id', 'variant_id', 'addon_id', 'semi_finished_item_id', 'consumption_qty'],
                include: [{
                    model: SemiFinishedItem,
                    as: "semiFinishedItem",
                    required: true,
                    attributes: ['id', 'name'],
                    include: [{ model: Unit, as: "unit", attributes: ['unit_name'] }]
                }]
            });
            for (const r of sfiRecipes) {
                if (!sfiRecipeMap[r.menu_id]) sfiRecipeMap[r.menu_id] = [];
                sfiRecipeMap[r.menu_id].push(r);
            }

            // Fetch cost_per_unit for every unique SFI referenced in those recipes
            const uniqueSfiIds = [...new Set(sfiRecipes.map(r => r.semi_finished_item_id).filter(Boolean))];
            if (uniqueSfiIds.length > 0) {
                const stocks = await SemiFinishedStock.findAll({
                    where: { semi_finished_item_id: uniqueSfiIds, hotel_id: req.user },
                    attributes: ['semi_finished_item_id', 'cost_per_unit']
                });
                for (const s of stocks) {
                    sfiCostMap[s.semi_finished_item_id] = parseFloat(s.cost_per_unit) || 0;
                }
            }
        }

        let totalSales = 0;
        let totalGrandCost = 0;

        const formattedOrders = orders.map(order => {
            let totalCost = 0;
            const itemMap = {};
            const rmMap = {};
            const sfiMap = {};

            // Build itemMap + compute SFI consumption from order details
            for (const detail of order.hms_orderDetails) {
                const baseKey = `${detail.MenuId}_BASE`;
                if (!itemMap[baseKey]) {
                    itemMap[baseKey] = {
                        itemName: detail.hms_menu_mst?.item_name,
                        variant_name: detail.variant_name,
                        addons: detail.addons,
                        qty: detail.qty,
                        price: detail.price,
                        baseRawMaterials: [],
                        variants: {},
                        totalItemCost: 0
                    };
                }

                // Compute SFI qty + cost consumed for this order item
                const recipes = sfiRecipeMap[detail.MenuId] || [];
                for (const r of recipes) {
                    if (r.variant_id && r.variant_id !== detail.variant_id) continue;
                    if (r.addon_id) continue;
                    const consumeQty = Number(r.consumption_qty) * Number(detail.qty);
                    const sfiKey = String(r.semi_finished_item_id);
                    const sfiName = r.semiFinishedItem.name;
                    const sfiUnit = r.semiFinishedItem?.unit?.unit_name || "";
                    const costPerUnit = sfiCostMap[r.semi_finished_item_id] || 0;
                    const consumeCost = consumeQty * costPerUnit;
                    if (!sfiMap[sfiKey]) {
                        sfiMap[sfiKey] = { name: sfiName, qty: 0, unit: sfiUnit, cost: 0 };
                    }
                    sfiMap[sfiKey].qty += consumeQty;
                    sfiMap[sfiKey].cost += consumeCost;
                    totalCost += consumeCost;
                }
            }

            // Raw material consumption loop
            for (const c of (order.consumptionRawMaterial || [])) {
                const rawObj = {
                    rawMaterialName: c.rawMaterial?.raw_material_name || "",
                    qty: Number(c.consumed_qty) || 0,
                    cost: Number(c.cost) || 0,
                    unit: c.rawMaterial?.consumptionUnit?.unit_name || ""
                };
                totalCost += rawObj.cost;

                const rmKey = `${rawObj.rawMaterialName}_${rawObj.unit}`;
                if (!rmMap[rmKey]) {
                    rmMap[rmKey] = { ...rawObj };
                } else {
                    rmMap[rmKey].qty += rawObj.qty;
                    rmMap[rmKey].cost += rawObj.cost;
                }

                const itemKeyBase = `${c.menu_id}_BASE`;
                if (!itemMap[itemKeyBase]) continue;

                if (!c.variant_id && !c.addon_id) {
                    itemMap[itemKeyBase].baseRawMaterials.push(rawObj);
                } else {
                    const vKey = c.variant_id || "NO_VARIANT";
                    if (!itemMap[itemKeyBase].variants[vKey]) {
                        itemMap[itemKeyBase].variants[vKey] = { rawMaterials: [], addons: {} };
                    }
                    if (c.addon_id) {
                        if (!itemMap[itemKeyBase].variants[vKey].addons[c.addon_id]) {
                            itemMap[itemKeyBase].variants[vKey].addons[c.addon_id] = { rawMaterials: [] };
                        }
                        itemMap[itemKeyBase].variants[vKey].addons[c.addon_id].rawMaterials.push(rawObj);
                    } else {
                        itemMap[itemKeyBase].variants[vKey].rawMaterials.push(rawObj);
                    }
                }
                itemMap[itemKeyBase].totalItemCost += rawObj.cost;
            }

            totalSales += Number(order.totalAmount);
            totalGrandCost += totalCost;

            return {
                bill_no: order.bill_no,
                totalAmount: order.totalAmount,
                totalCost,
                items: Object.values(itemMap),
                orderRawMaterials: Object.values(rmMap),
                orderSemiFinished: Object.values(sfiMap)
            };
        });

        // Only include orders that have at least some tracked consumption
        const filtered = formattedOrders.filter(o =>
            o.orderRawMaterials.length > 0 || o.orderSemiFinished.length > 0
        );

        return res.status(200).json(success("SUCCESS", {
            orders: filtered,
            totalSales,
            totalGrandCost
        }, 200));

    } catch (err) {
        console.error(err);
        return res.status(500).json(error("Internal server error", 500));
    }
};



const getRawMaterialWisePurchaseOrder = async (req, res) => {
    try {
        const { startDate, endDate, search } = req.query
        const { startD, endD } = await getShiftedDateRange(startDate, endDate, req.user);
        const whereCondition = {
            hotel_id: req.user,
        }
        if (search) {
            whereCondition.raw_material_name = { [Op.like]: `%${search}%` }
        }
        let rawMaterial = await RawMaterial.findAll({
            where: whereCondition,
            attributes: ["raw_material_name"], include: [
                {
                    model: PurchaseRawMaterial,
                    as: "purchases",
                    attributes: ['qty', 'price', 'amount', 'sgst', 'cgst', 'igst'],
                    include: [
                        {
                            model: PurchaseOrder,
                            as: "purchaseOrder",
                            where: { hotel_id: req.user, business_date: { [Op.between]: [startD, endD] }, deleted_status: false },
                            attributes: ['invoice_date'],
                            include: [
                                {
                                    model: Supplier,
                                    attributes: ["id", "name"]
                                }
                            ]

                            , required: true
                        }
                    ],
                    required: true
                }
            ],
        });

        rawMaterial = JSON.parse(JSON.stringify(rawMaterial))
        let totalGrandQty = 0
        let totalGrandPrice = 0
        rawMaterial = rawMaterial.map(material => {
            let totalQty = 0;
            let totalPrice = 0;
            let minPrice = Infinity;
            let maxPrice = -Infinity;

            material.purchases.forEach(purchase => {
                totalQty += purchase.qty;
                totalPrice += purchase.amount;
                if (purchase.price < minPrice) minPrice = purchase.price;
                if (purchase.price > maxPrice) maxPrice = purchase.price;
            });

            const averagePrice = totalQty > 0 ? totalPrice / totalQty : 0;
            totalGrandPrice += totalPrice
            totalGrandQty += totalQty
            return {
                ...material,
                totalQty,
                totalPrice,
                minPrice: minPrice === Infinity ? 0 : minPrice,
                maxPrice: maxPrice === -Infinity ? 0 : maxPrice,
                averagePrice
            };
        });

        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { totalGrandPrice, totalGrandQty, rawMaterial }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err)
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}


module.exports = { editSupplier, getRawMaterialWisePurchaseOrder, orderWiserConsumptionReports, getSupplierWisePurchaseOrder, paymentDone, getMaxPo, getSupplier, createPurchaseOrder, editPurchaseOrder, deletePurchaseorder, getPurchaseOrders, createSupplier }