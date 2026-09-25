const { Op } = require("sequelize");
const { Order, OrderDetails, OrderTax, Table, Hotel, TaxType, ServiceCharge, BillChargeRule, RestaurantSetting } = require("../../model");
const { computeBill } = require("./billEngine");
const { r2 } = require("../core");

// Port of billerpe-local-exe/helpers/orderTotals.js + localBillNumber.js +
// model/orderHooks.js for Plan 2: the cloud persists the one bill engine's
// result on every order change, and gives bill numbers / tokens.

async function loadBillConfig(hotel_id, transaction) {
    const [hotel, taxTypes, serviceCharge, packagingRule] = await Promise.all([
        Hotel.findOne({ where: { id: hotel_id }, attributes: ["id", "invoiceFormateIncGst"], transaction }),
        TaxType.findAll({ where: { hotel_id, active: true }, raw: true, transaction }),
        ServiceCharge.findOne({ where: { hotel_id }, raw: true, transaction }),
        BillChargeRule.findOne({ where: { hotel_id, rule_for: "packaging" }, raw: true, transaction }),
    ]);
    return { gstOn: hotel ? hotel.invoiceFormateIncGst !== false : true, taxTypes, serviceCharge, packagingRule };
}

/**
 * Recomputes and stores an order's totals from its current lines (fired
 * AND held - the held lines are on the order, only not in the kitchen).
 * opts.discount / serviceOverride: undefined = keep what is stored.
 */
async function recomputeOrderTotals(orderId, hotel_id, opts = {}) {
    const { transaction } = opts;
    const order = await Order.findOne({ where: { id: orderId, hotel_id }, transaction });
    if (!order) return null;
    const [lines, config] = await Promise.all([
        OrderDetails.findAll({ where: { orderId, hotel_id }, attributes: ["qty", "price", "addons", "MenuId"], raw: true, transaction }),
        loadBillConfig(hotel_id, transaction),
    ]);
    let tableCategId = null;
    if (order.TableId != null) {
        const table = await Table.findOne({ where: { id: order.TableId }, attributes: ["table_catag_id"], raw: true, transaction });
        tableCategId = table?.table_catag_id ?? null;
    }
    let discount = opts.discount;
    if (!discount) {
        const stored = Number(order.discount_value) || 0;
        discount = stored > 0 ? { type: order.discount_type === "pr" ? "pr" : "fix", value: stored } : { type: "fix", value: 0 };
    }
    const serviceOverride = opts.serviceOverride === undefined ? order.service_override ?? null : opts.serviceOverride;
    const totals = computeBill({ lines, orderType: order.order_type, tableCategId, discount, packagingOverride: order.packaging_override ?? null, serviceOverride, config });
    await Order.update({
        totalAmount: totals.subtotal,
        totalDiscount: totals.discount,
        discount_type: discount.type,
        discount_value: discount.value,
        ...(opts.discountReason !== undefined ? { discount_reason: opts.discountReason || "" } : {}),
        service_charge: totals.service,
        packaging_charge: totals.packaging,
        service_override: serviceOverride,
        delivery_charge: totals.delivery,
        gst: totals.tax,
        total_cgst: r2(totals.taxLines.filter((t) => /cgst/i.test(t.name)).reduce((s, t) => s + t.amount, 0)),
        total_sgst: r2(totals.taxLines.filter((t) => /sgst/i.test(t.name)).reduce((s, t) => s + t.amount, 0)),
        grandAmount: totals.grandAmount,
        roundOff: totals.roundOff,
    }, { where: { id: orderId, hotel_id }, transaction });
    await OrderTax.destroy({ where: { hmsOrderMstId: orderId, hotel_id }, transaction });
    if (totals.taxLines.length) {
        // Stored the way the rest of the system reads it (exe orderTotals.js):
        // column amount = the RATE, column tax_value = the RUPEES charged.
        await OrderTax.bulkCreate(
            totals.taxLines.map((t) => ({ hmsOrderMstId: orderId, hmsTaxTypeMstId: t.id, hotel_id, amount: t.tax_value, tax_type: t.tax_type, tax_value: t.amount })),
            { transaction },
        );
    }
    return totals;
}

/* ------------------------------ numbering ------------------------------ */

// Numbers issued under the exe's old "OFF12" scheme still count.
const parseBillNumber = (raw) => {
    const n = parseInt(String(raw ?? "").replace(/^OFF/, "").replace(/^0+(?=\d)/, ""), 10);
    return Number.isNaN(n) ? 0 : n;
};

/**
 * Bill numbers: one sequence for every order type, reset never / daily /
 * per financial year (RestaurantSetting.bill_reset_type), never re-issued.
 * Called inside the outlet-locked transaction (appv1/core.js mutate), so
 * two phones can never get the same number.
 */
async function nextBillNo(hotelId, clock, transaction) {
    const s = clock.settings || (await RestaurantSetting.findOne({ where: { hotel_id: hotelId }, raw: true, transaction }));
    const reset = s?.bill_reset_type || "never";
    const where = { hotel_id: hotelId };
    if (reset === "daily") where.business_date = clock.today;
    if (reset === "financial_year") {
        const startMonth = s?.financial_year_start_month || 4;
        const now = new Date();
        const y = now.getMonth() + 1 >= startMonth ? now.getFullYear() : now.getFullYear() - 1;
        where.createdAt = { [Op.gte]: new Date(y, startMonth - 1, 1) };
    }
    const rows = await Order.findAll({ where, attributes: ["bill_no"], raw: true, transaction });
    return String(rows.reduce((m, r) => Math.max(m, parseBillNumber(r.bill_no)), 0) + 1);
}

// Hotel.is_token_on: "0" pickup, "1" dine-in, "2" both, "3" off.
const TOKEN_TYPES = { 0: ["pickup"], 1: ["dinin"], 2: ["dinin", "pickup"], 3: [] };
const tokenApplies = (code, orderType) => (TOKEN_TYPES[String(code ?? "3")] || []).includes(orderType);

async function nextToken(hotelId, orderType, clock, transaction) {
    const hotel = await Hotel.findOne({ where: { id: hotelId }, attributes: ["is_token_on", "token_reset_at"], transaction });
    if (!tokenApplies(hotel?.is_token_on, orderType)) return 0;
    const where = { hotel_id: hotelId, business_date: clock.today };
    if (hotel?.token_reset_at) where.createdAt = { [Op.gt]: hotel.token_reset_at };
    const highest = await Order.max("token", { where, transaction });
    return (Number(highest) || 0) + 1;
}

module.exports = { loadBillConfig, recomputeOrderTotals, nextBillNo, nextToken, tokenApplies, parseBillNumber, TOKEN_TYPES };
