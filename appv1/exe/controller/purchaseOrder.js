// COPY of billerpe-local-exe/controller/purchaseOrder.js for the POS App (Plan 2) -
// written by scripts/vendor-exe-for-appv1.py. Do not edit here: change the
// exe's file and re-run the script, so both plans keep the same rules.

const { Op } = require("sequelize");
const {
    sequelize, Hotel, Supplier, PurchaseOrder, PurchaseOrderPayment, PurchaseRawMaterial,
    RawMaterial, StockInHand, StockHistory, HotelUser, Unit, RestaurantSetting,
} = require("../model");
const { MESSAGE, STATUSCODE } = require("../../../constant/const");
const { success, error } = require("../../../responce/res");
const { getBusinessDate, getShiftedDateRange } = require("../utils/dateUtils");
const { applyStockMovement } = require("../../engine/stockLedger");
const {
    recordSupplierPayment, deleteSupplierPayment, removeAllPayments, refreshPaymentType, paidSoFar,
} = require("../services/supplierPayments");

// Ported from uat-backend-v2/controller/stock_Mangement/purchaseOrder.js
// (supplier + purchase order + maxPo + payment routes) and the shared
// stockInFunction from stock_Mangement/stockInOut.js. Fixes applied vs. the
// source, per explicit sign-off (architecture memo, Phase F):
//   1. editSupplier and paymentDone now scope their lookups to hotel_id -
//      the source used bare id/findByPk, so any hotel's admin token could
//      edit another hotel's supplier or attach a payment to another
//      hotel's purchase order.
// editPurchaseOrder's destroy-then-recreate line-matching (a real, working
// full-replace contract, not a bug) is preserved as-is but documented
// clearly at the call site below, rather than silently left unexplained.

// Purchase stock goes through the one stock service
// (services/stockLedger.js): journaled against this PO, cost re-averaged,
// and never refused for lack of stock - reducing or deleting a PO whose
// goods were already used may take stock below zero (owner rule,
// 2026-09-25; the Web POS warns first). Both used to be separate copies
// that refused with "Not enough stock available".
async function stockInFunction(hotel_id, { raw_material_id, qty, price, userId, poId, type = "purchase" }, t) {
    await applyStockMovement({
        hotel_id, raw_material_id, qty: Number(qty), unit_cost: Number(price), type,
        ref_type: "purchase_order", ref_id: poId, user_id: userId, t,
    });
}

async function stockOutForQty(hotel_id, { raw_material_id, qty, userId, poId, type = "purchase_edit" }, t) {
    await applyStockMovement({
        hotel_id, raw_material_id, qty: -Number(qty), type,
        ref_type: "purchase_order", ref_id: poId, user_id: userId, t,
    });
}

// ---------- Supplier ----------

const getSupplier = async (req, res) => {
    try {
        const suppliers = await Supplier.findAll({ where: { hotel_id: req.user, deleted_status: false } });
        return res.json(success(MESSAGE.SUCCESS, { suppliers }, STATUSCODE.SUCCESS));
    } catch (err) {
        console.error("[purchaseOrder] getSupplier error:", err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

const createSupplier = async (req, res) => {
    try {
        const { name } = req.body;
        if (!name) return res.json(error("Name Is Required", STATUSCODE.BAD_REQUEST));
        const supplier = await Supplier.create({ name, hotel_id: req.user });
        return res.status(STATUSCODE.CREATED).json(success(MESSAGE.SUCCESS, { supplier, message: "Supplier Created" }, STATUSCODE.CREATED));
    } catch (err) {
        console.error("[purchaseOrder] createSupplier error:", err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

const editSupplier = async (req, res) => {
    try {
        const { name, id } = req.body;
        if (!name || !id) return res.json(error("Name and id are required", STATUSCODE.BAD_REQUEST));
        // Fixed: scoped to hotel_id (source updated by bare id).
        const [count] = await Supplier.update({ name }, { where: { id, hotel_id: req.user } });
        if (!count) return res.json(error("Supplier not found", STATUSCODE.BAD_REQUEST));
        const supplier = await Supplier.findAll({ where: { hotel_id: req.user, deleted_status: false } });
        return res.json(success(MESSAGE.SUCCESS, { supplier, message: "Supplier Updated" }, STATUSCODE.SUCCESS));
    } catch (err) {
        console.error("[purchaseOrder] editSupplier error:", err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

// ---------- Max PO / Payment ----------

const getMaxPo = async (req, res) => {
    try {
        const max = await PurchaseOrder.max("Po_no", { where: { hotel_id: req.user, deleted_status: false } });
        return res.json(success(MESSAGE.SUCCESS, { maxPo: (max || 0) + 1 }, STATUSCODE.SUCCESS));
    } catch (err) {
        console.error("[purchaseOrder] getMaxPo error:", err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

// POST /stock/payment - one supplier payment on a PO: mode, date, reference
// no., and whether cash came out of the drawer. Also recorded as an expense
// when the outlet's setting says so (services/supplierPayments.js).
const paymentDone = async (req, res) => {
    const t = await sequelize.transaction();
    try {
        const { id, payment_mode, payment_ref_no, payment_date, paidAmount, from_drawer } = req.body;
        if (!(Number(id) > 0)) {
            await t.rollback();
            return res.json(error("id is required", STATUSCODE.BAD_REQUEST));
        }
        // Scoped to hotel_id (source used a bare findByPk here).
        const po = await PurchaseOrder.findOne({ where: { id, hotel_id: req.user, deleted_status: false }, transaction: t });
        if (!po) {
            await t.rollback();
            return res.json(error("Purchase Order Not Found", STATUSCODE.BAD_REQUEST));
        }
        const { payment, expense, fromDrawer } = await recordSupplierPayment({
            hotel_id: req.user, userId: req.userId, po, amount: paidAmount, mode: payment_mode,
            date: payment_date, ref: payment_ref_no, fromDrawer: from_drawer,
        }, t);
        await t.commit();
        return res.status(STATUSCODE.CREATED).json(success(MESSAGE.SUCCESS, {
            message: "Payment Successfully Updated", paymentId: payment.id, expenseId: expense?.id ?? null, fromDrawer,
        }, STATUSCODE.CREATED));
    } catch (err) {
        await t.rollback();
        console.error("[purchaseOrder] paymentDone error:", err);
        return res.json(error(err.status ? err.message : MESSAGE.INTERNAL_SERVER_ERROR, err.status || STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

// DELETE /stock/payment { id } - removes a payment, its expense and (while
// that cash session is open) gives its cash back to the drawer.
const deletePayment = async (req, res) => {
    const t = await sequelize.transaction();
    try {
        const { id } = req.body;
        if (!(Number(id) > 0)) {
            await t.rollback();
            return res.json(error("id is required", STATUSCODE.BAD_REQUEST));
        }
        await deleteSupplierPayment({ hotel_id: req.user, paymentId: Number(id) }, t);
        await t.commit();
        return res.json(success(MESSAGE.SUCCESS, { message: "Payment deleted" }, STATUSCODE.SUCCESS));
    } catch (err) {
        await t.rollback();
        console.error("[purchaseOrder] deletePayment error:", err);
        return res.json(error(err.status ? err.message : MESSAGE.INTERNAL_SERVER_ERROR, err.status || STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

// ---------- Purchase Order CRUD ----------

const createPurchaseOrder = async (req, res) => {
    const t = await sequelize.transaction();
    try {
        const hotel_id = req.user;
        const {
            supplier_id, payment_type, payment_mode, payment_ref_no, GSTNo,
            update_inventory = true, grandAmount, discount = 0, delivery_charge = 0,
            invoice_date, invoice_number, Po_no = 0, paidAmount = 0, paymentDate,
            rawMaterialData, discount_type, discount_value, sub_total, from_drawer,
        } = req.body;

        if (!(Number(supplier_id) > 0) || grandAmount === undefined) {
            await t.rollback();
            return res.json(error("supplier_id and grandAmount are required", STATUSCODE.BAD_REQUEST));
        }
        if (!Array.isArray(rawMaterialData) || rawMaterialData.length === 0) {
            await t.rollback();
            return res.json(error("rawMaterialData must be a non-empty array", STATUSCODE.BAD_REQUEST));
        }

        const setting = await RestaurantSetting.findOne({ where: { hotel_id }, transaction: t });
        const business_date = getBusinessDate(setting?.timeZone || "Asia/Kolkata", setting?.business_day_start_time || "00:01:00");

        const po = await PurchaseOrder.create({
            hotel_id, userId: req.userId, supplier_id, payment_type: "unpaid", GSTNo,
            update_inventory, grandAmount, discount, delivery_charge, invoice_date: invoice_date || new Date(),
            invoice_number, Po_no, discount_type, discount_value, sub_total, business_date,
        }, { transaction: t });

        // The amount paid when the bill is entered. It used to be saved only
        // when payment_type was exactly "paid" - a part payment was lost.
        if (Number(paidAmount) > 0) {
            await recordSupplierPayment({
                hotel_id, userId: req.userId, po, amount: paidAmount, mode: payment_mode || "Cash",
                date: paymentDate, ref: payment_ref_no, fromDrawer: from_drawer,
            }, t);
        }

        for (const line of rawMaterialData) {
            await PurchaseRawMaterial.create({
                business_date, raw_material_id: line.raw_material_id, qty: line.qty, price: line.price,
                amount: line.amount, sgst: line.sgst, cgst: line.cgst, igst: line.igst,
                unit_id: line.unit_id, purchaseOrderId: po.id, hotel_id,
            }, { transaction: t });
            // "Update inventory" off = the bill is recorded without adding stock.
            if (update_inventory !== false && update_inventory !== "false") {
                await stockInFunction(hotel_id, { raw_material_id: line.raw_material_id, qty: line.qty, price: line.price, userId: req.userId, poId: po.id }, t);
            }
        }

        await t.commit();
        return res.status(STATUSCODE.CREATED).json(success(MESSAGE.SUCCESS, { message: "Purchase Order Created", id: po.id }, STATUSCODE.CREATED));
    } catch (err) {
        await t.rollback();
        console.error("[purchaseOrder] createPurchaseOrder error:", err);
        return res.json(error(err.status ? err.message : MESSAGE.INTERNAL_SERVER_ERROR, err.status || STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

const getPurchaseOrders = async (req, res) => {
    try {
        const hotel_id = req.user;
        const { startDate, endDate } = req.query;
        const { startD, endD } = await getShiftedDateRange(startDate, endDate, hotel_id);
        const range = { [Op.between]: [startD, endD] };

        const purchaseOrders = await PurchaseOrder.findAll({
            where: { hotel_id, business_date: range },
            include: [
                { model: HotelUser, attributes: ["id", "name"] },
                { model: PurchaseRawMaterial, where: { deleted_status: false }, required: false, include: [{ model: Unit }, { model: RawMaterial, as: "rawMaterial" }] },
                { model: Supplier, attributes: ["id", "name"] },
                { model: PurchaseOrderPayment, where: { deleted_status: false }, required: false, include: [{ model: HotelUser, attributes: ["name"] }] },
            ],
            order: [["createdAt", "DESC"]],
        });

        const totalGrandAmount = (await PurchaseOrder.sum("grandAmount", { where: { hotel_id, deleted_status: false, business_date: range } })) || 0;
        const totalPayment = (await PurchaseOrderPayment.sum("amount", {
            where: { hotel_id, deleted_status: false },
            include: { model: PurchaseOrder, where: { hotel_id, deleted_status: false, business_date: range }, attributes: [], required: true },
        })) || 0;

        return res.json(success(MESSAGE.SUCCESS, {
            purchaseOrders,
            summary: { totalPurchase: totalGrandAmount, totalPayment, outStandingPayment: totalGrandAmount - totalPayment, totalOrders: purchaseOrders.length },
        }, STATUSCODE.SUCCESS));
    } catch (err) {
        console.error("[purchaseOrder] getPurchaseOrders error:", err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

// editPurchaseOrder's contract: rawMaterialData must contain every line
// that should still exist on this PO (with its real `id` for unchanged/
// modified lines, no `id` for new ones) - any of this PO's existing lines
// whose id ISN'T present in the payload is treated as removed and its
// stock reversed. Matches the real backend's contract exactly (this is how
// the already-working frontend integration calls it), documented here
// rather than left silent.
const editPurchaseOrder = async (req, res) => {
    const t = await sequelize.transaction();
    try {
        const hotel_id = req.user;
        const { id, supplier_id, GSTNo, grandAmount, discount, discount_type, discount_value, sub_total, invoice_date, invoice_number, rawMaterialData } = req.body;
        if (!id) {
            await t.rollback();
            return res.json(error("id is required", STATUSCODE.BAD_REQUEST));
        }
        const po = await PurchaseOrder.findOne({ where: { id, hotel_id, deleted_status: false }, transaction: t });
        if (!po) {
            await t.rollback();
            return res.json(error("Purchase order not found", STATUSCODE.BAD_REQUEST));
        }
        // A new total below what was already paid would leave the supplier
        // overpaid with nothing to show for it.
        const paid = await paidSoFar(po.id, t);
        if (grandAmount !== undefined && Number(grandAmount) + 0.005 < paid) {
            await t.rollback();
            return res.json(error(`₹${paid.toLocaleString("en-IN")} is already paid on this PO, more than the new total ₹${Number(grandAmount).toLocaleString("en-IN")}. Delete a payment first.`, STATUSCODE.BAD_REQUEST));
        }
        await po.update({ supplier_id, GSTNo, grandAmount, discount, discount_type, discount_value, sub_total, invoice_date, invoice_number }, { transaction: t });

        const existingLines = await PurchaseRawMaterial.findAll({ where: { purchaseOrderId: id, deleted_status: false }, transaction: t });
        const existingById = new Map(existingLines.map((l) => [l.id, l]));

        for (const line of rawMaterialData || []) {
            if (line.id && existingById.has(line.id)) {
                const existing = existingById.get(line.id);
                const qtyDifference = Number(line.qty) - Number(existing.qty);
                await existing.update({ qty: line.qty, price: line.price, amount: line.amount, sgst: line.sgst, cgst: line.cgst, igst: line.igst, unit_id: line.unit_id }, { transaction: t });
                if (qtyDifference > 0) {
                    if (po.update_inventory !== false) await stockInFunction(hotel_id, { raw_material_id: existing.raw_material_id, qty: qtyDifference, price: line.price, userId: req.userId, poId: po.id, type: "purchase_edit" }, t);
                } else if (qtyDifference < 0) {
                    if (po.update_inventory !== false) await stockOutForQty(hotel_id, { raw_material_id: existing.raw_material_id, qty: -qtyDifference, userId: req.userId, poId: po.id }, t);
                }
                existingById.delete(line.id);
            } else {
                const created = await PurchaseRawMaterial.create({
                    business_date: po.business_date, raw_material_id: line.raw_material_id, qty: line.qty, price: line.price,
                    amount: line.amount, sgst: line.sgst, cgst: line.cgst, igst: line.igst, unit_id: line.unit_id,
                    purchaseOrderId: id, hotel_id,
                }, { transaction: t });
                if (po.update_inventory !== false) await stockInFunction(hotel_id, { raw_material_id: created.raw_material_id, qty: created.qty, price: created.price, userId: req.userId, poId: po.id, type: "purchase_edit" }, t);
            }
        }

        // Any line still left in the map was on this PO but wasn't present
        // in the request - reverse its stock and soft-delete it.
        for (const leftover of existingById.values()) {
            if (po.update_inventory !== false) await stockOutForQty(hotel_id, { raw_material_id: leftover.raw_material_id, qty: leftover.qty, userId: req.userId, poId: po.id }, t);
            await leftover.update({ deleted_status: true }, { transaction: t });
        }
        await refreshPaymentType(po, t);

        await t.commit();
        return res.json(success(MESSAGE.SUCCESS, { message: "Purchase Order Updated" }, STATUSCODE.SUCCESS));
    } catch (err) {
        await t.rollback();
        console.error("[purchaseOrder] editPurchaseOrder error:", err);
        return res.json(error(err.status ? err.message : MESSAGE.INTERNAL_SERVER_ERROR, err.status || STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

const deletePurchaseorder = async (req, res) => {
    const t = await sequelize.transaction();
    try {
        const hotel_id = req.user;
        const { id } = req.body;
        const po = await PurchaseOrder.findOne({ where: { id, hotel_id, deleted_status: false }, transaction: t });
        if (!po) {
            await t.rollback();
            return res.json(error("Purchase order not found", STATUSCODE.BAD_REQUEST));
        }
        const lines = await PurchaseRawMaterial.findAll({ where: { purchaseOrderId: id, deleted_status: false }, transaction: t });
        for (const line of lines) {
            if (po.update_inventory !== false) await stockOutForQty(hotel_id, { raw_material_id: line.raw_material_id, qty: line.qty, userId: req.userId, poId: po.id, type: "purchase_delete" }, t);
            await line.update({ deleted_status: true }, { transaction: t });
        }
        // Payments go with it: their expenses too, and cash back to a drawer
        // that is still open (refused for cash from a closed session).
        await removeAllPayments(po, hotel_id, t);
        await po.update({ deleted_status: true }, { transaction: t });

        await t.commit();
        return res.json(success(MESSAGE.SUCCESS, { message: "Purchase Order Deleted" }, STATUSCODE.SUCCESS));
    } catch (err) {
        await t.rollback();
        console.error("[purchaseOrder] deletePurchaseorder error:", err);
        return res.json(error(err.status ? err.message : MESSAGE.INTERNAL_SERVER_ERROR, err.status || STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

// GET/PUT /stock/purchaseSettings - "Record supplier payments as expenses".
const getPurchaseSettings = async (req, res) => {
    try {
        const setting = await RestaurantSetting.findOne({ where: { hotel_id: req.user } });
        return res.json(success(MESSAGE.SUCCESS, { supplier_payment_expense: setting?.supplier_payment_expense !== false }, STATUSCODE.SUCCESS));
    } catch (err) {
        console.error("[purchaseOrder] getPurchaseSettings error:", err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

const updatePurchaseSettings = async (req, res) => {
    try {
        const { supplier_payment_expense } = req.body;
        if (typeof supplier_payment_expense !== "boolean") {
            return res.json(error("supplier_payment_expense must be true or false", STATUSCODE.BAD_REQUEST));
        }
        const [setting] = await RestaurantSetting.findOrCreate({ where: { hotel_id: req.user }, defaults: { hotel_id: req.user } });
        await setting.update({ supplier_payment_expense });
        return res.json(success(MESSAGE.SUCCESS, { message: "Purchase settings saved", supplier_payment_expense }, STATUSCODE.SUCCESS));
    } catch (err) {
        console.error("[purchaseOrder] updatePurchaseSettings error:", err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

module.exports = {
    getPurchaseSettings, updatePurchaseSettings,
    getSupplier, createSupplier, editSupplier, getMaxPo, paymentDone, deletePayment,
    createPurchaseOrder, getPurchaseOrders, editPurchaseOrder, deletePurchaseorder,
};
