const { Op } = require("sequelize");
const { STATUSCODE, MESSAGE } = require("../../constant/const");
const { RawMaterial, Hotel, Merchant, Unit, PurchaseOrder, sequelize, PurchaseRawMaterial, StockHistory, StockInHand } = require("../../model");
const FranchiseOrder = require("../../model/franchise/franchiseOrder");
const FranchiseOrderItem = require("../../model/franchise/franchiseOrderItem");
const { error, success } = require("../../responce/res");
const { getBusinessDate } = require("../../utils/dateUtils");
const RestaurantSetting = require("../../model/restaurantSetting");
const Supplier = require("../../model/Inventory/supplyer");


const createFranchiseOrder = async (req, res) => {
    const transaction = await sequelize.transaction();

    try {
        const { merchant_id, franchise_id, items, remarks } = req.body;
        // Validation
        if (!franchise_id || !merchant_id || !items || items.length === 0) {
            await transaction.rollback();
            return res.json(error('Franchise ID, Merchant ID, and items are required', STATUSCODE.INTERNAL_SERVER_ERROR))

        }

        // Calculate totals
        let total_amount = 0;
        const validatedItems = [];
        console.log(items, "items")
        for (const item of items) {
            const rawMaterial = await RawMaterial.findByPk(item.raw_material_id);

            if (!rawMaterial) {
                await transaction.rollback();
                return res.json(error(`Raw material with ID ${item.raw_material_id} not found`, STATUSCODE.INTERNAL_SERVER_ERROR))

            }

            const unit_price = rawMaterial.purchase_price || 0;
            const amount = parseFloat(item.ordered_qty) * parseFloat(unit_price);
            total_amount += amount;

            validatedItems.push({
                raw_material_id: item.raw_material_id,
                ordered_qty: item.ordered_qty,
                approved_qty: item.ordered_qty, // Initially set to ordered qty
                unit_price: unit_price,
                amount: amount
            });
        }

        // Create Order
        const order = await FranchiseOrder.create({
            franchise_id,
            merchant_id,
            status: 'pending',
            remarks: remarks || null,
            total_amount: total_amount,
            grand_total: total_amount
        }, { transaction });

        // Create Order Items
        const orderItems = validatedItems.map(item => ({
            ...item,
            order_id: order.id
        }));

        await FranchiseOrderItem.bulkCreate(orderItems, { transaction });

        await transaction.commit();

        // Fetch complete order with associations
        const completeOrder = await FranchiseOrder.findByPk(order.id, {
            include: [
                {
                    model: FranchiseOrderItem,
                    as: 'items',
                    include: [{ model: RawMaterial, as: 'rawMaterial' }]
                }
            ]
        });
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, {
            message: 'Order created successfully',
            data: completeOrder
        }, STATUSCODE.SUCCESS))


    } catch (err) {
        await transaction.rollback();
        console.error('Error creating franchise order:', err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))

    }
};
const getFranchiseOrders = async (req, res) => {
    try {
        const {
            status,
            franchise_id,
            page = 1,
            limit = 10,
            search = '',
            sort_by = 'created_at',
            sort_order = 'desc',
            start_date,
            end_date
        } = req.query;

        const merchant_id = req.user;

        const pageNumber = parseInt(page);
        const limitNumber = parseInt(limit);
        const offset = (pageNumber - 1) * limitNumber;

        const whereClause = {};

        if (merchant_id) whereClause.merchant_id = merchant_id;
        if (status && status !== 'all') whereClause.status = status;
        if (franchise_id) whereClause.franchise_id = franchise_id;

        if (search) {
            whereClause[Op.or] = [
                { id: { [Op.like]: `%${search}%` } },
                { remarks: { [Op.like]: `%${search}%` } },
                { '$franchise.hotel_name$': { [Op.like]: `%${search}%` } }
            ];
        }

        if (start_date || end_date) {
            whereClause.created_at = {};
            if (start_date) whereClause.created_at[Op.gte] = new Date(start_date);
            if (end_date) {
                const endDateTime = new Date(end_date);
                endDateTime.setHours(23, 59, 59, 999);
                whereClause.created_at[Op.lte] = endDateTime;
            }
        }

        const allowedSortFields = ['created_at', 'status', 'id'];
        const sortField = allowedSortFields.includes(sort_by)
            ? sort_by
            : 'created_at';
        console.log(whereClause, "Condition:::::")
        const { rows, count } = await FranchiseOrder.findAndCountAll({
            where: whereClause,

            distinct: true,
            include: [
                {
                    model: FranchiseOrderItem,
                    as: 'items',
                    include: [
                        {
                            model: RawMaterial,
                            as: 'rawMaterial',
                            include: [{ model: Unit, as: 'purchaseUnit' }]
                        }
                    ]
                },
                { model: Hotel, as: 'franchise' },
                { model: Merchant, as: 'merchant' }
            ],
            order: [[sortField, sort_order.toUpperCase()]],
            limit: limitNumber,
            offset
        });

        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, {
            data: rows,
            total: count,
            page: pageNumber,
            limit: limitNumber,
            totalPages: Math.ceil(count / limitNumber)
        }, STATUSCODE.SUCCESS))


    } catch (err) {
        console.error('Error fetching franchise orders:', err);
        return res.status(500).json({ message: 'Internal server error' });
    }
};

const updateOrderStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { status, remarks } = req.body;

        const validStatuses = ['pending', 'accepted', 'rejected', 'out_for_delivery'];

        if (!validStatuses.includes(status)) {
            return res.json(error('Invalid status', STATUSCODE.BAD_REQUEST))

        }

        const order = await FranchiseOrder.findByPk(id);

        if (!order) {
            return res.json(error("Order not found", STATUSCODE.BAD_REQUEST))

        }

        order.status = status;
        if (remarks) order.remarks = remarks;
        await order.save();

        const updatedOrder = await FranchiseOrder.findByPk(id, {
            include: [
                {
                    model: FranchiseOrderItem,
                    as: 'items',
                    include: [{ model: RawMaterial, as: 'rawMaterial' }]
                }
            ]
        });
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, {
            message: 'Order status updated successfully',
            data: updatedOrder
        }, STATUSCODE.SUCCESS))


    } catch (err) {
        console.error('Error updating order status:', err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))

    }
};
const adjustOrderQty = async (req, res) => {
    const transaction = await sequelize.transaction();

    try {
        const { id } = req.params;
        const { items } = req.body; // Array of { item_id, approved_qty }

        const order = await FranchiseOrder.findByPk(id, {
            include: [{ model: FranchiseOrderItem, as: 'items' }],
            transaction
        });

        if (!order) {
            await transaction.rollback();
            return res.json(error('Order not found', STATUSCODE.BAD_REQUEST));
        }

        if (order.status !== 'pending' && order.status !== 'accepted') {
            await transaction.rollback();
            return res.json(error("Cannot adjust quantities for this order status", STATUSCODE.BAD_REQUEST));
        }

        let total_amount = 0;

        // Convert incoming items to Map for quick lookup
        const incomingMap = new Map();
        for (const item of items) {
            incomingMap.set(parseInt(item.item_id), parseFloat(item.approved_qty));
        }

        // Loop through all existing order items
        for (const orderItem of order.items) {

            const approvedQty = incomingMap.has(orderItem.id)
                ? incomingMap.get(orderItem.id)
                : 0; // 🔥 If removed from frontend → set 0

            orderItem.approved_qty = approvedQty;
            orderItem.amount = approvedQty * parseFloat(orderItem.unit_price);

            await orderItem.save({ transaction });

            total_amount += parseFloat(orderItem.amount);
        }

        // Update order totals
        order.total_amount = total_amount;
        order.grand_total = total_amount;

        await order.save({ transaction });

        await transaction.commit();

        const updatedOrder = await FranchiseOrder.findByPk(id, {
            include: [
                {
                    model: FranchiseOrderItem,
                    as: 'items',
                    include: [{ model: RawMaterial, as: 'rawMaterial' }]
                }
            ]
        });

        return res.status(STATUSCODE.SUCCESS).json(
            success(MESSAGE.SUCCESS, {
                message: 'Quantities adjusted successfully',
                data: updatedOrder
            }, STATUSCODE.SUCCESS)
        );

    } catch (err) {
        await transaction.rollback();
        console.error('Error adjusting quantities:', err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};
const getLastPoNumber = async (merchant_id) => {
    try {
        const lastPurchaseOrder = await PurchaseOrder.findOne({
            where: {
                hotel_id: merchant_id, // Filter by merchant
                Po_no: { [Op.ne]: null }  // Exclude null PO numbers
            },
            order: [['Po_no', 'DESC']], // Get highest PO number
            attributes: ['Po_no']
        });

        // If no previous PO exists, start from 1, otherwise increment
        const newPoNumber = lastPurchaseOrder
            ? parseInt(lastPurchaseOrder.Po_no) + 1
            : 1;

        return newPoNumber;
    } catch (error) {
        console.error('Error getting last PO number:', error);
        throw error;
    }
};

const stockInFunction = async ({ raw_material_id, qty, price, hotel_id, userId }, res = null, transaction = null) => {
    try {
        // Load raw material to get conversion_qty (purchase unit → consumption unit multiplier)
        const rawMaterial = await RawMaterial.findOne({ where: { id: raw_material_id } });
        if (!rawMaterial) throw new Error(`Raw material ${raw_material_id} not found`);
        const conversion_qty = parseFloat(rawMaterial.conversion_qty) || 1;

        const queryOptions = {
            where: { raw_material_id, hotel_id }
        };

        if (transaction) {
            queryOptions.transaction = transaction;
        }

        let stock = await StockInHand.findOne(queryOptions);

        const incomingQty = parseFloat(qty);
        const incomingPrice = parseFloat(price);
        const incomingTotalAmount = incomingQty * incomingPrice;

        if (stock) {
            const oldQty = parseFloat(stock.qty);
            const oldTotalAmount = parseFloat(stock.total_amount || 0);

            const newQty = oldQty + incomingQty;
            const newTotalAmount = oldTotalAmount + incomingTotalAmount;
            const newAvgPrice = newTotalAmount / newQty;
            // Convert purchase qty to consumption unit (e.g. Liters → ML)
            const newConsumptionQty = newQty * conversion_qty;

            stock.qty = newQty;
            stock.price = price.toString();
            stock.average_price = newAvgPrice.toFixed(2);
            stock.total_amount = newTotalAmount;
            stock.available_stock_Consiompsion_qty = newConsumptionQty;

            if (transaction) {
                await stock.save({ transaction });
            } else {
                await stock.save();
            }
        } else {
            const createOptions = {
                raw_material_id,
                qty: incomingQty,
                price: price.toString(),
                average_price: incomingPrice.toFixed(2),
                total_amount: incomingTotalAmount,
                // Convert purchase qty to consumption unit (e.g. Liters → ML)
                available_stock_Consiompsion_qty: incomingQty * conversion_qty,
                hotel_id,
                deleted: false
            };

            if (transaction) {
                stock = await StockInHand.create(createOptions, { transaction });
            } else {
                stock = await StockInHand.create(createOptions);
            }
        }

        const setting = await RestaurantSetting.findOne({ where: { hotel_id: hotel_id } });
        const timeZone = setting?.timeZone || 'Asia/Kolkata';
        const businessStartTime = setting?.business_day_start_time || '00:01:00';
        const business_date = getBusinessDate(timeZone, businessStartTime);

        const historyOptions = {
            business_date,
            raw_material_id,
            qty: incomingQty,
            price: price.toString(),
            total_amount: incomingTotalAmount.toString(),
            stock_in: true,
            user_id: userId,
            hotel_id,
            deleted: false
        };

        if (transaction) {
            await StockHistory.create(historyOptions, { transaction });
        } else {
            await StockHistory.create(historyOptions);
        }

        return stock;
    } catch (error) {
        console.error('Error in stockInFunction:', error);
        throw error;
    }
};
// ✅ DELIVER ORDER (Auto-create PO & Update Stock)
const deliverOrder = async (req, res) => {
    const transaction = await sequelize.transaction();

    try {
        const { id } = req.params;
        const { invoice_no, invoice_date } = req.body;

        const order = await FranchiseOrder.findByPk(id, {
            include: [
                {
                    model: FranchiseOrderItem,
                    as: 'items',
                    include: [{ model: RawMaterial, as: 'rawMaterial' }]
                }
            ]
        });

        if (!order) {
            await transaction.rollback();
            return res.status(404).json({
                code: 404,
                results: {
                    success: false,
                    message: 'Order not found'
                }
            });
        }

        if (order.status !== 'out_for_delivery' && order.status !== 'accepted') {
            await transaction.rollback();
            return res.status(400).json({
                code: 400,
                results: {
                    success: false,
                    message: 'Order must be in out_for_delivery or accepted status'
                }
            });
        }

        // Calculate totals
        let sub_total = 0;
        const rawMaterialData = [];

        for (const item of order.items) {
            const itemAmount = parseFloat(item.approved_qty) * parseFloat(item.unit_price);
            sub_total += itemAmount;

            rawMaterialData.push({
                raw_material_id: item.raw_material_id,
                qty: item.approved_qty,
                price: item.unit_price,
                amount: itemAmount,
                cgst: 0, // Set based on your requirements
                sgst: 0,
                igst: 0,
                unit_id: item.rawMaterial?.unit_id || null
            });
        }

        // 1️⃣ FIND OR CREATE "Warehouse" SUPPLIER FOR THIS MERCHANT
        let warehouseSupplier = await Supplier.findOne({
            where: { hotel_id: order.franchise_id, name: 'Warehouse', deleted_status: false }
        });
        if (!warehouseSupplier) {
            warehouseSupplier = await Supplier.create(
                { name: 'Warehouse', hotel_id: order.franchise_id },
                { transaction }
            );
        }

        // 2️⃣ CREATE PURCHASE ORDER
        const newPoNumber = await getLastPoNumber(order.franchise_id);
        const purchaseOrder = await PurchaseOrder.create({
            supplier_id: warehouseSupplier.id,
            sub_total: sub_total,
            discount_value: 0,
            discount_type: 'fix',
            payment_type: 'unpaid', // or 'unpaid'
            GSTNo: null,
            update_inventory: true,
            grandAmount: order.grand_total,
            discount: 0,
            hotel_id: order.franchise_id, // Use your hotel_id field
            delivery_charge: 0,
            invoice_date: invoice_date || new Date(),
            invoice_number: invoice_no || `FO-${order.id}`,
            Po_no: newPoNumber,
            userId: req.userId || req.user?.id,

        }, { transaction });
        console.log(purchaseOrder, "Purchase Order::::")
        // 2️⃣ CREATE PURCHASE RAW MATERIALS & UPDATE STOCK
        for (const element of rawMaterialData) {
            const { raw_material_id, qty, price, amount, cgst, sgst, igst, unit_id } = element;

            // Create Purchase Raw Material entry
            await PurchaseRawMaterial.create({
                raw_material_id,
                qty,
                price,
                amount,
                sgst,
                cgst,
                igst,
                unit_id,
                purchaseOrderId: purchaseOrder.id,
                hotel_id: order.franchise_id
            }, { transaction });

            // Update Stock using your existing function
            // Note: Your stockInFunction should be modified to accept transaction

            await stockInFunction({
                raw_material_id,
                qty,
                price,
                hotel_id: order.franchise_id,
                userId: null
            }, null, transaction);


        }

        // 3️⃣ UPDATE FRANCHISE ORDER
        order.status = 'delivered';
        order.purchase_order_id = purchaseOrder.id;
        order.delivered_at = new Date();
        await order.save({ transaction });

        await transaction.commit();

        // Fetch updated order
        const updatedOrder = await FranchiseOrder.findByPk(id, {
            include: [
                {
                    model: FranchiseOrderItem,
                    as: 'items',
                    include: [{ model: RawMaterial, as: 'rawMaterial' }]
                },
                {
                    model: PurchaseOrder,
                    as: 'purchaseOrder'
                }
            ]
        });

        res.status(200).json({
            code: 200,
            results: {
                success: true,
                message: 'Order delivered and stock updated successfully',
                data: {
                    order: updatedOrder,
                    purchase_order: purchaseOrder
                }
            }
        });

    } catch (error) {
        await transaction.rollback();
        console.error('Error delivering order:', error);
        res.status(500).json({
            code: 500,
            results: {
                success: false,
                message: 'Failed to deliver order',
                error: error.message
            }
        });
    }
};
const getOrderById = async (req, res) => {
    try {
        const { id } = req.params;

        const order = await FranchiseOrder.findByPk(id, {
            include: [
                {
                    model: FranchiseOrderItem,
                    as: 'items',
                    include: [
                        {
                            model: RawMaterial,
                            as: 'rawMaterial',
                            include: [{ model: Unit, as: "purchaseUnit" }]
                        }
                    ]
                },
                { model: Hotel, as: 'franchise' },
                { model: Merchant, as: 'merchant' },
                { model: PurchaseOrder, as: 'purchaseOrder' }
            ]
        });

        if (!order) {
            return res.json(error('Order not found', STATUSCODE.BAD_REQUEST))

        }
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { data: order }, STATUSCODE.SUCCESS))


    } catch (err) {
        console.error('Error fetching order:', err);
        return res.json(error('Failed to fetch order', STATUSCODE.BAD_REQUEST))

    }
};
// ✅ GET ORDERS FOR FRANCHISE (Outlet View with Pagination)
const getFranchiseOrdersForOutlet = async (req, res) => {
    try {
        const {

            page = 1,
            limit = 10,
            search = '',
            sort_by = 'created_at',
            sort_order = 'desc',
            status
        } = req.query;

        const offset = (page - 1) * limit;

        const whereClause = { franchise_id: req.user };

        if (status && status !== 'all') {
            whereClause.status = status;
        }

        if (search) {
            whereClause[Op.or] = [
                { id: { [Op.like]: `%${search}%` } },
                { remarks: { [Op.like]: `%${search}%` } }
            ];
        }

        const { count, rows } = await FranchiseOrder.findAndCountAll({
            where: whereClause,
            distinct: true,
            include: [
                {
                    model: FranchiseOrderItem,
                    as: 'items',
                    include: [
                        {
                            model: RawMaterial,
                            as: 'rawMaterial'

                        }
                    ]
                }
            ],
            order: [[sort_by, sort_order.toUpperCase()]],
            limit: parseInt(limit),
            offset: parseInt(offset)
        });
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, {
            data: rows,
            total: count,
            page: parseInt(page),
            limit: parseInt(limit),
            totalPages: Math.ceil(count / limit)
        }, STATUSCODE.SUCCESS))


    } catch (err) {
        console.error('Error fetching franchise orders:', err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))

    }
};
// ✅ EDIT ORDER (Outlet Side - Only Pending Orders)
const editFranchiseOrder = async (req, res) => {
    const transaction = await sequelize.transaction();

    try {
        const { id } = req.params;
        const { items, remarks } = req.body;

        const order = await FranchiseOrder.findOne({ where: { id, franchise_id: req.user }, include: [{ model: FranchiseOrderItem, as: 'items' }], transaction });

        if (!order) {
            await transaction.rollback();

            return res.json(error('Order not found', STATUSCODE.BAD_REQUEST))

        }

        if (order.status !== 'pending') {
            await transaction.rollback();
            return res.json(error('Only pending orders can be edited', STATUSCODE.INTERNAL_SERVER_ERROR))

        }

        // Delete removed items
        const updatedItemIds = items.map(i => i.item_id);
        await FranchiseOrderItem.destroy({
            where: {
                order_id: id,
                id: { [Op.notIn]: updatedItemIds }
            },
            transaction
        });

        // Update existing items
        let total_amount = 0;

        for (const item of items) {
            const orderItem = await FranchiseOrderItem.findByPk(item.item_id, { transaction });

            if (orderItem) {
                orderItem.ordered_qty = item.ordered_qty;
                orderItem.approved_qty = item.ordered_qty;
                orderItem.amount = parseFloat(item.ordered_qty) * parseFloat(orderItem.unit_price);
                await orderItem.save({ transaction });

                total_amount += parseFloat(orderItem.amount);
            }
        }

        // Update order
        order.total_amount = total_amount;
        order.grand_total = total_amount;
        order.remarks = remarks;
        await order.save({ transaction });

        await transaction.commit();

        const updatedOrder = await FranchiseOrder.findByPk(id, {
            include: [
                {
                    model: FranchiseOrderItem,
                    as: 'items',
                    include: [{ model: RawMaterial, as: 'rawMaterial' }]
                }
            ]
        });
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, {
            message: 'Order updated successfully',
            data: updatedOrder
        }, STATUSCODE.SUCCESS))


    } catch (err) {
        await transaction.rollback();
        console.error('Error editing order:', err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))

    }
};
// ✅ DELETE ORDER (Outlet Side - Only Pending Orders)
const deleteFranchiseOrder = async (req, res) => {
    try {
        const { id } = req.params;
        const order = await FranchiseOrder.findOne({ where: { id, franchise_id: req.user } });
        if (!order) {
            return res.json(error('Order not found', STATUSCODE.BAD_REQUEST))
        }
        if (order.status !== 'pending') {
            return res.json(error('Only pending orders can be deleted', STATUSCODE.BAD_REQUEST))
        }
        await order.destroy();
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { message: 'Order deleted successfully' }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.error('Error deleting order:', err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))

    }
};
const getOrderStats = async (req, res) => {
    try {
        const merchant_id = req.user;

        const whereClause = merchant_id ? { merchant_id } : {};

        const [total, pending, accepted, out_for_delivery, delivered, rejected] = await Promise.all([
            FranchiseOrder.count({ where: whereClause }),
            FranchiseOrder.count({ where: { ...whereClause, status: 'pending' } }),
            FranchiseOrder.count({ where: { ...whereClause, status: 'accepted' } }),
            FranchiseOrder.count({ where: { ...whereClause, status: 'out_for_delivery' } }),
            FranchiseOrder.count({ where: { ...whereClause, status: 'delivered' } }),
            FranchiseOrder.count({ where: { ...whereClause, status: 'rejected' } })
        ]);

        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, {
            total,
            pending,
            accepted,
            out_for_delivery,
            delivered,
            rejected
        }, STATUSCODE.SUCCESS));

    } catch (err) {
        console.error('Error fetching order stats:', err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};
// ✅ GET RAW MATERIALS (For Franchise Order Creation)
const getRawMaterials = async (req, res) => {
    try {
        const rawMaterials = await RawMaterial.findAll({
            where: { is_active: true }, // Only active materials
            include: [
                {
                    model: Unit,
                    as: 'purchaseUnit',
                    attributes: ['id', 'name', 'short_name']
                }
            ],
            attributes: ['id', 'name', 'purchase_price', 'unit_id'],
            order: [['name', 'ASC']]
        });

        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, {
            data: rawMaterials
        }, STATUSCODE.SUCCESS));

    } catch (err) {
        console.error('Error fetching raw materials:', err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

module.exports = { getOrderStats, getRawMaterials, getFranchiseOrdersForOutlet, editFranchiseOrder, deleteFranchiseOrder, getFranchiseOrders, createFranchiseOrder, updateOrderStatus, adjustOrderQty, getOrderById, deliverOrder }