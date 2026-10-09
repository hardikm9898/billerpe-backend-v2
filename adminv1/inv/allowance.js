const { CsOutletSetup, InvMove } = require("../../model");
const { parse } = require("../crm/util");

// What an outlet's plan includes free (its setup: a "with printer" plan
// gives a printer and rolls) and how much of it has gone out. Only sends
// marked "part of the plan" count; sold extras go out on their invoice.

/** How many more of this item the outlet's plan still includes. */
async function remaining(hotelId, itemId, t) {
    const setup = await CsOutletSetup.findOne({ where: { hotel_id: hotelId, status: "done" }, attributes: ["includes"], raw: true, transaction: t });
    const inc = ((setup && parse(setup.includes)) || []).find((x) => Number(x.itemId) === Number(itemId));
    if (!inc) return 0;
    const sent = Number((await InvMove.sum("qty", { where: { hotel_id: hotelId, item_id: itemId, kind: "dispatch", basis: "plan", status: ["done", "pending"] }, transaction: t })) || 0);
    return Math.max(0, Number(inc.qty) - sent);
}

module.exports = { remaining };
