const { Op } = require("sequelize");
const sequelize = require("../connection/connect");
const Order = require("../model/order");
const OrderDetails = require("../model/order_details");
const RawMaterialConsumption = require("../model/Inventory/RawMaterialcon");
const StockInHand = require("../model/stockInHand");
const RawMaterial = require("../model/rawItem");
const Menu = require("../model/menu");
const Recipes = require("../model/recipes");
const SemiFinishedStock = require("../model/semiFinishedStock");
const DuePaymentReceive = require("../model/duePayment");
const RestaurantSetting = require("../model/restaurantSetting");
const { getBusinessDate } = require("../utils/dateUtils");
const { checkRawMaterialAvailableOrNot } = require("./recipes");
const { MESSAGE, STATUSCODE, ORDER_DETAILS_TYPE, STATUS } = require("../constant/const");
const { error, success } = require("../responce/res");

// "Reopen and edit a settled order" - orders.reopenSettled (billerpe-pos-pro-v2's
// Permissions screen) was a dead toggle until this: no backend capability
// existed to touch an order's items once payment:"success". This endpoint
// does NOT revert an order to "pending" - the original payment stays on
// record (per the product decision: "re-settle for the difference") - it
// replaces the item list, corrects stock, recomputes the total, and turns
// any gap between the new total and what's already been collected into
// `due` (positive = collect more, negative = refund owed - see
// getRefundDueOrders/settleRefundDue below for the refund side).
//
// Reverses ALL of this order's existing stock consumption first, then
// forward-consumes fresh for the new item list - simpler and safer than
// trying to diff old vs. new line-by-line, since the frontend has no
// stable per-line backend id to diff against in the first place (order
// lines are local-only until settlement; see mock/types.ts's OrderLine).
//
// Known gap: per-tax-type OrderTax rows (used by tax-breakdown reports)
// are NOT reconciled here - only Order.gst (the aggregate figure `due` is
// computed from) is updated. Flagged, not silently left wrong.
const editSettledOrder = async (req, res) => {
    const t = await sequelize.transaction();
    try {
        const hotel_id = req.user;
        const {
            orderId, items, totalAmount, gst = 0, grandAmount, totalDiscount = 0,
            discount_reason = "", discount_type = "fix", discount_value = 0,
            service_charge = 0,
        } = req.body;

        if (!orderId || !Array.isArray(items) || !items.length) {
            await t.rollback();
            return res.json(error("orderId and a non-empty items array are required", STATUSCODE.BAD_REQUEST));
        }
        if (!(Number(grandAmount) >= 0)) {
            await t.rollback();
            return res.json(error("A valid grandAmount is required", STATUSCODE.BAD_REQUEST));
        }

        const order = await Order.findOne({
            where: { id: orderId, hotel_id, payment: "success", deleted: false },
            transaction: t,
        });
        if (!order) {
            await t.rollback();
            return res.json(error("Settled order not found", STATUSCODE.NOT_FOUND));
        }

        // 1) Reverse every raw-material consumption row this order currently
        // has on record (adapted from recipes.js's cancelOrderStock, inlined
        // here so it can share this transaction instead of committing on
        // its own - the original doesn't take an external transaction).
        const consumptions = await RawMaterialConsumption.findAll({
            where: { order_id: orderId, hotel_id, status: "CONSUMED" },
            lock: t.LOCK.UPDATE,
            transaction: t,
        });
        for (const c of consumptions) {
            const stock = await StockInHand.findOne({
                where: { raw_material_id: c.raw_material_id, hotel_id },
                include: [{ model: RawMaterial }],
                lock: t.LOCK.UPDATE,
                transaction: t,
            });
            if (stock) {
                const restoredQty = parseFloat(c.consumed_qty);
                const newAvail = parseFloat(stock.available_stock_Consiompsion_qty) + restoredQty;
                // Fixed vs. cancelOrderStock's own version of this logic
                // (recipes.js): that one reads stock.conversion_qty, a
                // column that doesn't exist on StockInHand at all (always
                // undefined -> falls back to 1) - conversion_qty only
                // exists on the related RawMaterial row, exactly like the
                // forward path (checkRawMaterialAvailableOrNot) already
                // reads it correctly a few functions above.
                const rmConversionQty = Number(stock.hms_rawMaterial_mst?.conversion_qty) || 1;
                const newQty = newAvail / rmConversionQty;
                const total_amount = newQty * Number(stock.average_price);
                await stock.update({ available_stock_Consiompsion_qty: newAvail, qty: newQty, total_amount }, { transaction: t });
            }
            await c.update({ status: "REVERSED", notes: "Settled order edited" }, { transaction: t });
        }

        // 2) Reverse SFI consumption the same way cancelOrderStock does -
        // recomputed from the OLD OrderDetails + recipes (there's no
        // per-item SFI audit row to reverse from directly), so this must
        // run BEFORE those rows are destroyed below.
        const oldCart = await OrderDetails.findAll({
            where: { orderId, hotel_id, status: "delivered" },
            include: [{ model: Menu }],
            transaction: t,
        });
        if (oldCart.length) {
            const oldMenuIds = [...new Set(oldCart.map((i) => i.MenuId))];
            const sfiRecipes = await Recipes.findAll({
                where: { menu_id: oldMenuIds, hotel_id, semi_finished_item_id: { [Op.not]: null } },
                transaction: t,
            });
            const sfiRecipeMap = {};
            for (const r of sfiRecipes) {
                if (!sfiRecipeMap[r.menu_id]) sfiRecipeMap[r.menu_id] = [];
                sfiRecipeMap[r.menu_id].push(r);
            }
            const extractAddons = (addonsJson) => {
                if (!Array.isArray(addonsJson)) return [];
                const out = [];
                for (const dept of addonsJson) {
                    if (!Array.isArray(dept.hms_addon_msts)) continue;
                    for (const a of dept.hms_addon_msts) {
                        if (Number(a.qty) > 0 && a.id) out.push({ addon_id: Number(a.id), qty: Number(a.qty) });
                    }
                }
                return out;
            };
            const requiredSFI = {};
            for (const item of oldCart) {
                if (!item.hms_menu_mst?.stockTrack) continue;
                const selectedAddons = extractAddons(item.addons);
                const recipes = sfiRecipeMap[item.MenuId] || [];
                for (const r of recipes) {
                    if (r.variant_id && r.variant_id !== item.variant_id) continue;
                    let addonMultiplier = 1;
                    if (r.addon_id) {
                        const addon = selectedAddons.find((a) => a.addon_id === r.addon_id);
                        if (!addon) continue;
                        addonMultiplier = addon.qty;
                    }
                    const consumeQty = Number(r.consumption_qty) * Number(item.qty) * Number(addonMultiplier);
                    requiredSFI[r.semi_finished_item_id] = (requiredSFI[r.semi_finished_item_id] || 0) + consumeQty;
                }
            }
            for (const [sfiId, restoreQty] of Object.entries(requiredSFI)) {
                const sfiStock = await SemiFinishedStock.findOne({
                    where: { semi_finished_item_id: sfiId, hotel_id },
                    lock: t.LOCK.UPDATE,
                    transaction: t,
                });
                if (sfiStock) {
                    const newQty = parseFloat(sfiStock.available_qty) + restoreQty;
                    await sfiStock.update(
                        { available_qty: newQty, total_amount: newQty * parseFloat(sfiStock.cost_per_unit) },
                        { transaction: t },
                    );
                }
            }
        }

        // 3) Replace the item list wholesale - matches this order having no
        // stable per-line id the frontend could diff against (see this
        // file's own header comment).
        await OrderDetails.destroy({ where: { orderId, hotel_id }, transaction: t });

        for (const item of items) {
            await OrderDetails.create({
                orderId, hotel_id, MenuId: item.menuId, qty: item.qty, price: item.price,
                totalDiscount: item.totalDiscount || 0, order_type: order.order_type,
                variant_id: item.variantId || null, variant_name: item.variantName || null,
                addons: item.addons || [], status: ORDER_DETAILS_TYPE.DELIVERED, payment_status: STATUS.SUCCESS,
            }, { transaction: t });
        }

        // 4) Forward-consume fresh for the new item list, same function
        // settleBills already trusts for this - same-transaction, so a
        // stock failure here rolls back the item replacement above too
        // rather than leaving the order half-edited.
        const stockCheck = await checkRawMaterialAvailableOrNot(orderId, hotel_id, req.userId, t);
        if (stockCheck.error) {
            await t.rollback();
            return res.json(error("Error updating stock for the new item list", STATUSCODE.INTERNAL_SERVER_ERROR));
        }

        // 5) Re-settle for the difference: the original cash/upi/card stays
        // exactly as recorded - only `due` moves, up (collect more) or
        // down into negative (refund owed).
        const alreadyCollected = Number(order.cash) + Number(order.upi) + Number(order.card);
        const due = Math.round((Number(grandAmount) - alreadyCollected) * 100) / 100;

        await Order.update({
            totalAmount, gst, grandAmount, totalDiscount, discount_reason, discount_type, discount_value,
            service_charge, due,
        }, { where: { id: orderId, hotel_id }, transaction: t });

        await t.commit();
        return res.status(STATUSCODE.SUCCESS).json(
            success(MESSAGE.SUCCESS, { message: "Order updated", due }, STATUSCODE.SUCCESS),
        );
    } catch (err) {
        await t.rollback();
        console.error("[editSettledOrder] error:", err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

// Refund-due: the lightweight side of "re-settle for the difference" for
// when an edit makes the new total LOWER than what's already been
// collected. Order.due goes negative in that case (editSettledOrder
// above) - these two endpoints are the minimal read/resolve pair for it,
// deliberately separate from getDueOrders/settleDue (order.js), which
// only ever query/validate `due > 0` and would need real behavioral
// changes to also mean "give money back."
const getRefundDueOrders = async (req, res) => {
    try {
        const orders = await Order.findAll({
            where: { hotel_id: req.user, due: { [Op.lt]: 0 }, deleted: false },
            attributes: ["id", "bill_no", "due", "createdAt"],
            order: [["createdAt", "DESC"]],
        });
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { orders }, STATUSCODE.SUCCESS));
    } catch (err) {
        console.error("[editSettledOrder] getRefundDueOrders error:", err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

const settleRefundDue = async (req, res) => {
    try {
        const { id, payment_mode = "cash" } = req.body;
        const order = await Order.findOne({ where: { id, hotel_id: req.user, deleted: false } });
        if (!order) return res.json(error("Order Not Found", STATUSCODE.NOT_FOUND));
        if (!(Number(order.due) < 0)) {
            return res.json(error("This order has no refund due", STATUSCODE.BAD_REQUEST));
        }

        const setting = await RestaurantSetting.findOne({ where: { hotel_id: req.user } });
        const business_date = getBusinessDate(
            setting?.timeZone || "Asia/Kolkata",
            setting?.business_day_start_time || "00:01:00",
        );

        // Recorded as a negative amount - the same audit table settleDue
        // uses for positive due collection, just the opposite direction,
        // so refund history shows up alongside normal due history for
        // this order rather than in an entirely separate ledger.
        await DuePaymentReceive.create({
            business_date, user_id: order.UserId, order_id: order.id, hotel_id: req.user,
            settle_by: req.userId, amount: order.due, bill_no: order.bill_no, payment_mode,
        });
        await Order.update({ due: 0 }, { where: { id, hotel_id: req.user } });

        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { message: "Refund recorded" }, STATUSCODE.SUCCESS));
    } catch (err) {
        console.error("[editSettledOrder] settleRefundDue error:", err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

module.exports = { editSettledOrder, getRefundDueOrders, settleRefundDue };
