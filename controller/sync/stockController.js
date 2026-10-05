const sequelize = require("../../connection/connect");
const { RawMaterial, SemiFinishedItem, OwnerStockLevel, OwnerStockDay } = require("../../model");
const { success, error } = require("../../responce/res");
const { MESSAGE, STATUSCODE } = require("../../constant/const");

// POST /sync/push/stock (device token): a Plan 1 outlet PC's stock for the
// Owner App - billerpe-local-exe services/sync/pushStock.js.
//   { snapshot?: [{ kind: "raw"|"semi", id, qty, cost, value }],
//     days?: [{ date: "YYYY-MM-DD", rows: [{ kind, id, purchased_qty, ..., opening_entry_value }] }] }
// The snapshot replaces the outlet's levels; each day replaces that day.
// Item ids are this server's ids; one that is not this outlet's is dropped.
// Read-only copies: nothing here is ever sent back to the PC.

const COLS = ["purchased", "used", "wastage", "manual", "opening_entry"].flatMap((c) => [`${c}_qty`, `${c}_value`]);
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const isDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || ""));

async function ownIds(hotelId, rows) {
    const rawIds = [...new Set(rows.filter((r) => r.kind === "raw").map((r) => Number(r.id)).filter(Number.isInteger))];
    const semiIds = [...new Set(rows.filter((r) => r.kind === "semi").map((r) => Number(r.id)).filter(Number.isInteger))];
    const [raw, semi] = await Promise.all([
        rawIds.length ? RawMaterial.findAll({ where: { hotel_id: hotelId, id: rawIds }, attributes: ["id"], raw: true }) : [],
        semiIds.length ? SemiFinishedItem.findAll({ where: { hotel_id: hotelId, id: semiIds }, attributes: ["id"], raw: true }) : [],
    ]);
    const ok = new Set([...raw.map((r) => `raw|${r.id}`), ...semi.map((r) => `semi|${r.id}`)]);
    return (r) => ok.has(`${r.kind}|${Number(r.id)}`);
}

const pushStock = async (req, res) => {
    try {
        const hotelId = req.user;
        const snapshot = Array.isArray(req.body?.snapshot) ? req.body.snapshot : null;
        const days = Array.isArray(req.body?.days) ? req.body.days.filter((d) => d && isDate(d.date) && Array.isArray(d.rows)) : [];
        const mine = await ownIds(hotelId, [...(snapshot || []), ...days.flatMap((d) => d.rows)]);
        let levels = 0;
        let rows = 0;
        await sequelize.transaction(async (t) => {
            if (snapshot) {
                await OwnerStockLevel.destroy({ where: { hotel_id: hotelId }, transaction: t });
                const list = snapshot.filter(mine).map((r) => ({ hotel_id: hotelId, kind: r.kind, item_id: Number(r.id), qty: num(r.qty), cost: num(r.cost), value: num(r.value) }));
                if (list.length) await OwnerStockLevel.bulkCreate(list, { transaction: t });
                levels = list.length;
            }
            for (const d of days) {
                await OwnerStockDay.destroy({ where: { hotel_id: hotelId, business_date: d.date }, transaction: t });
                const list = d.rows.filter(mine).map((r) => ({ hotel_id: hotelId, business_date: d.date, kind: r.kind, item_id: Number(r.id), ...Object.fromEntries(COLS.map((c) => [c, num(r[c])])) }));
                if (list.length) await OwnerStockDay.bulkCreate(list, { transaction: t });
                rows += list.length;
            }
        });
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { levels, days: days.length, rows }, STATUSCODE.SUCCESS));
    } catch (err) {
        console.error("[sync] push stock error:", err.message);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

module.exports = { pushStock };
