const sequelize = require("../connection/connect");
const HotelUser = require("../model/hotelUser");
const RestaurantSetting = require("../model/restaurantSetting");
const RawMaterial = require("../model/rawItem");
const Supplier = require("../model/Inventory/supplyer");
const PurchaseOrder = require("../model/Inventory/purchaseOrder");
const PurchaseRawMaterial = require("../model/Inventory/purchaseRawMaterial");
const StockInHand = require("../model/stockInHand");
const StockHistory = require("../model/stockHistory");
const Requisition = require("../model/Inventory/requisition");
const RequisitionItem = require("../model/Inventory/requisitionItem");
const { MESSAGE, STATUSCODE } = require("../constant/const");
const { error, success } = require("../responce/res");
const { getBusinessDate } = require("../utils/dateUtils");

const businessDateFor = async (hotel_id) => {
    const setting = await RestaurantSetting.findOne({ where: { hotel_id } });
    return getBusinessDate(setting?.timeZone || "Asia/Kolkata", setting?.business_day_start_time || "00:01:00");
};

const STATUS_VALUES = ["Pending", "Accepted", "Out for delivery", "Delivered", "Rejected"];

const getRequisitions = async (req, res) => {
    try {
        const requisitions = await Requisition.findAll({
            where: { hotel_id: req.user, deleted_status: false },
            include: [{ model: RequisitionItem, as: "items", where: { deleted_status: false }, required: false }],
            order: [["createdAt", "DESC"]],
        });
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { requisitions }, STATUSCODE.SUCCESS));
    } catch (err) {
        console.error("[requisition] getRequisitions error:", err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

const createRequisition = async (req, res) => {
    const t = await sequelize.transaction();
    try {
        const hotel_id = req.user;
        const { items, remarks } = req.body;
        if (!Array.isArray(items) || !items.length) {
            await t.rollback();
            return res.json(error("At least one material is required", STATUSCODE.BAD_REQUEST));
        }

        const hotelUser = await HotelUser.findOne({ where: { id: req.userId }, transaction: t });
        const business_date = await businessDateFor(hotel_id);
        const maxReqNo = await Requisition.max("req_no", { where: { hotel_id }, transaction: t });

        const requisition = await Requisition.create({
            hotel_id,
            req_no: (maxReqNo || 0) + 1,
            business_date,
            status: "Pending",
            remarks: remarks || null,
            raised_by: hotelUser?.name || null,
        }, { transaction: t });

        for (const item of items) {
            if (!(Number(item.orderedQty) > 0)) continue;
            await RequisitionItem.create({
                hotel_id,
                requisition_id: requisition.id,
                raw_material_id: Number(item.materialId),
                ordered_qty: item.orderedQty,
                unit_price: item.unitPrice || 0,
            }, { transaction: t });
        }

        await t.commit();
        return res.status(STATUSCODE.CREATED).json(success(MESSAGE.SUCCESS, { message: "Requisition placed", id: requisition.id, req_no: requisition.req_no }, STATUSCODE.CREATED));
    } catch (err) {
        await t.rollback();
        console.error("[requisition] createRequisition error:", err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

const setRequisitionStatus = async (req, res) => {
    try {
        const { id, status } = req.body;
        if (!id || !STATUS_VALUES.includes(status)) {
            return res.json(error("A valid id and status are required", STATUSCODE.BAD_REQUEST));
        }
        const requisition = await Requisition.findOne({ where: { id, hotel_id: req.user, deleted_status: false } });
        if (!requisition) return res.json(error("Requisition Not Found", STATUSCODE.NOT_FOUND));
        if (requisition.purchase_order_id) {
            return res.json(error("This requisition is already fulfilled", STATUSCODE.BAD_REQUEST));
        }
        await requisition.update({ status });
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { message: `Requisition ${status.toLowerCase()}` }, STATUSCODE.SUCCESS));
    } catch (err) {
        console.error("[requisition] setRequisitionStatus error:", err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

const setRequisitionItemQty = async (req, res) => {
    try {
        const { id, materialId, qty } = req.body;
        const requisition = await Requisition.findOne({ where: { id, hotel_id: req.user, deleted_status: false } });
        if (!requisition) return res.json(error("Requisition Not Found", STATUSCODE.NOT_FOUND));
        if (requisition.purchase_order_id) {
            return res.json(error("This requisition is already fulfilled", STATUSCODE.BAD_REQUEST));
        }
        const [count] = await RequisitionItem.update(
            { ordered_qty: Math.max(0, Number(qty) || 0) },
            { where: { requisition_id: id, raw_material_id: Number(materialId), hotel_id: req.user } },
        );
        if (!count) return res.json(error("Requisition item not found", STATUSCODE.NOT_FOUND));
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { message: "Quantity updated" }, STATUSCODE.SUCCESS));
    } catch (err) {
        console.error("[requisition] setRequisitionItemQty error:", err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

const removeRequisition = async (req, res) => {
    try {
        const { id } = req.body;
        const requisition = await Requisition.findOne({ where: { id, hotel_id: req.user, deleted_status: false } });
        if (!requisition) return res.json(error("Requisition Not Found", STATUSCODE.NOT_FOUND));
        if (requisition.purchase_order_id) {
            return res.json(error("A fulfilled requisition can't be deleted", STATUSCODE.BAD_REQUEST));
        }
        await requisition.update({ deleted_status: true });
        await RequisitionItem.update({ deleted_status: true }, { where: { requisition_id: id, hotel_id: req.user } });
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { message: "Requisition deleted" }, STATUSCODE.SUCCESS));
    } catch (err) {
        console.error("[requisition] removeRequisition error:", err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

// Atomically turns an "Out for delivery" requisition into a real
// PurchaseOrder + PurchaseRawMaterial rows and receives stock, in one
// transaction - see model/Inventory/requisition.js's header comment. This
// is the one place a Requisition ever produces real stock movement, so it
// must not be able to half-succeed (PO created but requisition left
// unfulfilled, or vice versa).
const fulfilRequisition = async (req, res) => {
    const t = await sequelize.transaction();
    try {
        const hotel_id = req.user;
        const { id } = req.body;
        const requisition = await Requisition.findOne({
            where: { id, hotel_id, deleted_status: false },
            include: [{ model: RequisitionItem, as: "items", where: { deleted_status: false }, required: false }],
            transaction: t,
        });
        if (!requisition) {
            await t.rollback();
            return res.json(error("Requisition Not Found", STATUSCODE.NOT_FOUND));
        }
        if (requisition.purchase_order_id) {
            await t.rollback();
            return res.json(error("This requisition is already fulfilled", STATUSCODE.BAD_REQUEST));
        }
        if (requisition.status !== "Out for delivery") {
            await t.rollback();
            return res.json(error("Requisition must be out for delivery before it can be received", STATUSCODE.BAD_REQUEST));
        }
        if (!requisition.items || !requisition.items.length) {
            await t.rollback();
            return res.json(error("Requisition has no items", STATUSCODE.BAD_REQUEST));
        }

        const supplier = await Supplier.findOne({
            where: { hotel_id, deleted_status: false },
            order: [["id", "ASC"]],
            transaction: t,
        });
        if (!supplier) {
            await t.rollback();
            return res.json(error("Add a supplier before fulfilling requisitions", STATUSCODE.BAD_REQUEST));
        }

        const business_date = await businessDateFor(hotel_id);
        const maxPo = await PurchaseOrder.max("Po_no", { where: { hotel_id }, transaction: t });

        const lines = [];
        for (const item of requisition.items) {
            const material = await RawMaterial.findOne({ where: { id: item.raw_material_id, hotel_id }, transaction: t });
            if (!material) {
                await t.rollback();
                return res.json(error("A requested raw material no longer exists", STATUSCODE.BAD_REQUEST));
            }
            if (!material.unit_id) {
                await t.rollback();
                return res.json(error(`${material.raw_material_name} has no purchase unit configured`, STATUSCODE.BAD_REQUEST));
            }
            const qty = item.approved_qty ?? item.ordered_qty;
            const rate = item.unit_price;
            const amount = Math.round(qty * rate * 100) / 100;
            const tax = Math.round(amount * 0.05 * 100) / 100;
            lines.push({
                raw_material_id: item.raw_material_id,
                qty, price: rate, amount,
                cgst: Math.round((tax / 2) * 100) / 100,
                sgst: Math.round((tax / 2) * 100) / 100,
                igst: 0,
                unit_id: material.unit_id,
            });
        }

        const sub_total = lines.reduce((s, l) => s + l.amount, 0);
        const taxTotal = lines.reduce((s, l) => s + l.cgst + l.sgst + l.igst, 0);
        const grandAmount = Math.round((sub_total + taxTotal) * 100) / 100;

        const purchaseOrder = await PurchaseOrder.create({
            hotel_id,
            userId: req.userId,
            supplier_id: supplier.id,
            business_date,
            Po_no: (maxPo || 0) + 1,
            sub_total,
            grandAmount,
            discount: 0,
            discount_value: 0,
            discount_type: "fix",
            delivery_charge: 0,
            payment_type: "unpaid",
            GSTNo: "",
            update_inventory: true,
        }, { transaction: t });

        for (const line of lines) {
            await PurchaseRawMaterial.create({
                business_date,
                purchaseOrderId: purchaseOrder.id,
                hotel_id,
                ...line,
            }, { transaction: t });

            const existing = await StockInHand.findOne({ where: { raw_material_id: line.raw_material_id, hotel_id }, transaction: t });
            const material = await RawMaterial.findOne({ where: { id: line.raw_material_id, hotel_id }, transaction: t });
            const conversionQty = Number(material.conversion_qty) || 1;
            const inQty = line.qty * conversionQty;
            if (existing) {
                const combinedQty = Number(existing.qty) + inQty;
                const averagePrice = combinedQty > 0
                    ? ((line.price * inQty) + (Number(existing.average_price) * Number(existing.qty))) / combinedQty
                    : line.price;
                await existing.update({
                    qty: combinedQty,
                    average_price: averagePrice,
                    available_stock_Consiompsion_qty: combinedQty,
                    total_amount: averagePrice * combinedQty,
                }, { transaction: t });
            } else {
                await StockInHand.create({
                    hotel_id,
                    raw_material_id: line.raw_material_id,
                    average_price: line.price,
                    price: line.price,
                    qty: inQty,
                    available_stock_Consiompsion_qty: inQty,
                    total_amount: line.price * inQty,
                }, { transaction: t });
            }
            await StockHistory.create({
                hotel_id,
                raw_material_id: line.raw_material_id,
                price: line.price,
                qty: inQty,
                total_amount: line.price * inQty,
                stock_in: true,
                business_date,
                user_id: req.userId,
            }, { transaction: t });
        }

        await requisition.update({ status: "Delivered", purchase_order_id: purchaseOrder.id }, { transaction: t });

        await t.commit();
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, {
            message: "Requisition fulfilled",
            purchase_order_id: purchaseOrder.id,
            po_no: purchaseOrder.Po_no,
        }, STATUSCODE.SUCCESS));
    } catch (err) {
        await t.rollback();
        console.error("[requisition] fulfilRequisition error:", err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

module.exports = {
    getRequisitions, createRequisition, setRequisitionStatus,
    setRequisitionItemQty, removeRequisition, fulfilRequisition,
};
