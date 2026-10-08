const { Op } = require("sequelize");
const { sequelize, Hotel, EBillCredit, EBillCreditDebit, AdmAuditLog, AdmUser } = require("../../model");
const { RuleError } = require("../../appv1/core");
const { need } = require("../auth");
const audit = require("../audit");
const { addActivity } = require("../cs/common");
const { txt } = require("../crm/util");

// E-bill credits (old panel: "E-bill credit"). Paid credits are sold on an
// invoice (an e-bill pack in the catalog: the panel is the invoice book);
// free credits are given here with a reason. The history lists every credit
// added and, per outlet, what was used.

const MAX_FREE = 10000;

/** Free credits for an outlet (goodwill, a trial, a make-good). */
async function grantFree(s, hotelId, count, reason) {
    need(s, "billing.manage");
    const n = Number(count);
    if (!Number.isInteger(n) || n < 1 || n > MAX_FREE) throw new RuleError(`Give 1 to ${MAX_FREE} credits.`);
    const why = txt(reason, 200);
    if (why.length < 5) throw new RuleError("Write why they are given free (a few words).");
    return sequelize.transaction(async (t) => {
        const hotel = await Hotel.findOne({ where: { id: Number(hotelId) || 0 }, attributes: ["id", "hotel_name"], transaction: t });
        if (!hotel) throw new RuleError("Outlet not found.");
        const row = await EBillCredit.findOne({ where: { hotel_id: hotel.id }, transaction: t, lock: t.LOCK.UPDATE });
        if (row) await row.update({ credit: Number(row.credit || 0) + n }, { transaction: t });
        else await EBillCredit.create({ hotel_id: hotel.id, credit: n }, { transaction: t });
        const entry = await EBillCreditDebit.create({ hotel_id: hotel.id, credit: true, debit: false, amount: 0, credit_type: "free", ebill_count: n, discount: 0, business_date: new Date() }, { transaction: t });
        await audit.write(s, { action: "ebill.free", entity: "ebill_credit", entityId: entry.id, summary: `Gave ${n} free e-bill credits to ${hotel.hotel_name}`, reason: why }, { transaction: t });
        const { CsAccountOutlet } = require("../../model");
        const link = await CsAccountOutlet.findOne({ where: { hotel_id: hotel.id }, transaction: t });
        if (link) await addActivity(link.account_id, hotel.id, "note", s.user.id, `${s.user.name} gave ${n} free e-bill credits (${why})`, null, t);
        const after = await EBillCredit.findOne({ where: { hotel_id: hotel.id }, transaction: t });
        return { balance: Number(after.credit) || 0 };
    });
}

/**
 * Credits added (all outlets, or one), newest first; for one outlet also
 * the balance and what was used in the last 30 days. Who gave a free
 * credit and why come from the audit log.
 */
async function history(s, query = {}) {
    need(s, "billing.view");
    const hotelId = Number(query.hotelId) || null;
    const page = Math.max(1, Number(query.page) || 1);
    const where = { credit: true, ...(hotelId ? { hotel_id: hotelId } : {}) };
    const { rows, count } = await EBillCreditDebit.findAndCountAll({ where, order: [["id", "DESC"]], limit: 50, offset: (page - 1) * 50, raw: true });
    const hotels = new Map((await Hotel.findAll({ where: { id: [...new Set(rows.map((r) => r.hotel_id).filter(Boolean))] }, attributes: ["id", "hotel_name"], raw: true })).map((h) => [h.id, h.hotel_name]));
    const notes = new Map((rows.length ? await AdmAuditLog.findAll({ where: { entity: "ebill_credit", entity_id: rows.map((r) => String(r.id)) }, attributes: ["entity_id", "actor_id", "reason"], raw: true }) : []).map((a) => [Number(a.entity_id), a]));
    const who = new Map((await AdmUser.findAll({ where: { id: [...new Set([...notes.values()].map((a) => a.actor_id).filter(Boolean))] }, attributes: ["id", "name"], raw: true })).map((u) => [u.id, u.name]));
    let outlet = null;
    if (hotelId) {
        const bal = await EBillCredit.findOne({ where: { hotel_id: hotelId }, raw: true });
        const used30 = await EBillCreditDebit.count({ where: { hotel_id: hotelId, debit: true, createdAt: { [Op.gte]: new Date(Date.now() - 30 * 86400000) } } });
        outlet = { balance: bal ? Number(bal.credit) || 0 : 0, used30 };
    }
    return {
        total: count,
        page,
        outlet,
        entries: rows.map((r) => {
            const a = notes.get(r.id);
            return {
                id: r.id,
                at: r.createdAt,
                hotelId: r.hotel_id,
                outlet: hotels.get(r.hotel_id) || "",
                count: Number(r.ebill_count) || 0,
                kind: r.credit_type,
                amount: Number(r.amount) || 0,
                by: a ? who.get(a.actor_id) || "" : r.added_by ? "Old panel" : "Invoice / outlet",
                reason: a ? a.reason || "" : "",
            };
        }),
    };
}

module.exports = { grantFree, history };
