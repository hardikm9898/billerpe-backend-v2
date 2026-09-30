const { Op } = require("sequelize");
const sequelize = require("../../connection/connect");
const { Order, OrderDetails, OrderTax, User } = require("../../model");
const { MESSAGE, STATUSCODE } = require("../../constant/const");
const { success, error } = require("../../responce/res");
const { decodeJsonValue } = require("./jsonColumns");

// History download for a PC that has just registered (list 6 issue 8,
// owner decision 2026-09-29). Orders and customers only ever went UP
// (exe -> cloud), so registering a new PC - or registering the same PC
// again, which wipes it - left the Web POS with no past bills, no running
// tables and no dues. The exe now downloads, right after its pull:
//   - every customer with a mobile number (Customer Data), not deleted
//   - every order from the last 90 days, plus every older order that is
//     still open (running / held / bill generated) or still has a Due,
//     with its lines, its taxes and any placeholder customer it uses.
// Ids here are OURS. The exe stores each row under a new local id and then
// calls /sync/history/link, which sets our local_id to it, so every later
// push of that row (an edit, a settle, a due received) updates this same
// row instead of creating a second one.

const DAYS = 90;
const MAX_LIMIT = 500;

const ORDER_FIELDS = [
    "id", "bill_no", "order_type", "payment", "status", "payment_type",
    "totalAmount", "gst", "grandAmount", "roundOff", "totalDiscount",
    "discount_reason", "discount_type", "discount_value",
    "service_charge", "delivery_charge", "packaging_charge",
    "cash", "upi", "card", "due", "other_payments", "other_amount", "tip", "billPrintCount", "billed_at",
    "total_sgst", "total_cgst", "deleted", "token", "business_date", "createdAt", "updatedAt",
    "TableId", "UserId",
];
const DETAIL_FIELDS = [
    "id", "MenuId", "qty", "price", "order_type", "kotNumber", "totalDiscount",
    "status", "payment_status", "comment", "addons", "variant_name", "createdAt",
];
const TAX_FIELDS = ["hmsTaxTypeMstId", "amount", "tax_type", "tax_value"];
const CUSTOMER_FIELDS = ["id", "name", "number", "gstin", "address", "isPlaceholder", "createdAt", "updatedAt"];

function historyWhere(hotelId) {
    const since = new Date(Date.now() - DAYS * 24 * 60 * 60 * 1000);
    return {
        hotel_id: hotelId,
        [Op.or]: [
            { createdAt: { [Op.gte]: since } },
            { deleted: false, payment: "pending" },
            { deleted: false, due: { [Op.gt]: 0 } },
        ],
    };
}

const plain = (row, fields) => Object.fromEntries(fields.map((f) => [f, row[f] ?? null]));

// GET /sync/history?kind=customers|orders&afterId=0&limit=200
const downloadHistory = async (req, res) => {
    try {
        const hotelId = req.user;
        const kind = req.query.kind === "customers" ? "customers" : "orders";
        const afterId = Math.max(0, Number(req.query.afterId) || 0);
        const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), MAX_LIMIT);

        if (kind === "customers") {
            const rows = await User.findAll({
                where: { hotel_id: hotelId, id: { [Op.gt]: afterId }, deleted_at: null, number: { [Op.and]: [{ [Op.ne]: null }, { [Op.ne]: "" }] } },
                attributes: CUSTOMER_FIELDS,
                order: [["id", "ASC"]],
                limit,
                raw: true,
            });
            return res.json(success(MESSAGE.SUCCESS, {
                kind,
                customers: rows.map((r) => plain(r, CUSTOMER_FIELDS)),
                nextAfterId: rows.length ? rows[rows.length - 1].id : afterId,
                done: rows.length < limit,
            }, STATUSCODE.SUCCESS));
        }

        const orders = await Order.findAll({
            where: { ...historyWhere(hotelId), id: { [Op.gt]: afterId } },
            attributes: ORDER_FIELDS,
            order: [["id", "ASC"]],
            limit,
            raw: true,
        });
        const ids = orders.map((o) => o.id);
        const [details, taxes] = ids.length
            ? await Promise.all([
                OrderDetails.findAll({ where: { hotel_id: hotelId, orderId: ids }, order: [["id", "ASC"]], raw: true }),
                OrderTax.findAll({ where: { hotel_id: hotelId, hmsOrderMstId: ids }, raw: true }),
            ])
            : [[], []];
        const userIds = [...new Set(orders.map((o) => o.UserId).filter(Boolean))];
        // Placeholders (walk-ins) and deleted customers are not in the
        // customer download, but a bill that names them still needs them.
        const customers = userIds.length
            ? await User.findAll({ where: { hotel_id: hotelId, id: userIds }, attributes: CUSTOMER_FIELDS, raw: true })
            : [];

        const byOrder = (rows, key) => {
            const m = new Map();
            for (const r of rows) {
                if (!m.has(r[key])) m.set(r[key], []);
                m.get(r[key]).push(r);
            }
            return m;
        };
        const detailsOf = byOrder(details, "orderId");
        const taxesOf = byOrder(taxes, "hmsOrderMstId");

        return res.json(success(MESSAGE.SUCCESS, {
            kind,
            orders: orders.map((o) => ({
                ...plain(o, ORDER_FIELDS),
                other_payments: decodeJsonValue(o.other_payments),
                details: (detailsOf.get(o.id) || []).map((d) => ({ ...plain(d, DETAIL_FIELDS), addons: decodeJsonValue(d.addons) || [] })),
                taxes: (taxesOf.get(o.id) || []).map((t) => plain(t, TAX_FIELDS)),
            })),
            customers: customers.map((r) => plain(r, CUSTOMER_FIELDS)),
            nextAfterId: orders.length ? orders[orders.length - 1].id : afterId,
            done: orders.length < limit,
            days: DAYS,
        }, STATUSCODE.SUCCESS));
    } catch (err) {
        console.error("[sync] downloadHistory error:", err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

// POST /sync/history/link { orders: [{ cloud_id, local_id }], customers: [...] }
// Our local_id for each row the exe just stored. Anything else of this
// hotel that happens to hold that local_id (it can't after /sync/rebase,
// which gave every order and customer -id) is moved to -id first, so the
// (hotel_id, local_id) unique index never refuses the link.
const linkHistory = async (req, res) => {
    const hotelId = req.user;
    try {
        const linked = { orders: 0, customers: 0 };
        await sequelize.transaction(async (transaction) => {
            for (const [key, Model] of [["orders", Order], ["customers", User]]) {
                const pairs = (Array.isArray(req.body?.[key]) ? req.body[key] : [])
                    .map((p) => ({ cloud: Number(p.cloud_id), local: Number(p.local_id) }))
                    .filter((p) => p.cloud > 0 && p.local > 0);
                for (const p of pairs) {
                    await Model.update(
                        { local_id: sequelize.literal("-`id`") },
                        { where: { hotel_id: hotelId, local_id: p.local, id: { [Op.ne]: p.cloud } }, transaction, silent: true },
                    );
                    const [n] = await Model.update(
                        { local_id: p.local },
                        { where: { hotel_id: hotelId, id: p.cloud }, transaction, silent: true },
                    );
                    linked[key] += n;
                }
            }
        });
        return res.json(success(MESSAGE.SUCCESS, { linked }, STATUSCODE.SUCCESS));
    } catch (err) {
        console.error("[sync] linkHistory error:", err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

module.exports = { downloadHistory, linkHistory };
