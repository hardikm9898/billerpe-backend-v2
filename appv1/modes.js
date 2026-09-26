const M = require("../model");
const { fail } = require("./core");

// Payment mode ids in the app: "cash" | "upi" | "card" | "due" for the four
// built-in modes, "pm-<id>" for an outlet's own mode (Paytm...). Rows store
// the mode's NAME (expenses, due collections, other_payments).

const BUILT_IN_NAME = { cash: "Cash", upi: "UPI", card: "Card", due: "Due" };

/** App mode id -> the name stored on a row. */
async function modeName(c, modeId) {
    if (BUILT_IN_NAME[modeId]) return BUILT_IN_NAME[modeId];
    const m = /^pm-(\d+)$/.exec(String(modeId || ""));
    const row = m ? await M.PaymentMode.findOne({ where: { id: Number(m[1]), hotel_id: c.hotelId } }) : null;
    if (!row) fail("Pick a payment mode");
    return row.name;
}

/** Stored name -> app mode id (modes = the outlet's PaymentMode rows). */
function modeIdFromName(name, modes) {
    const n = String(name || "").trim().toLowerCase();
    if (BUILT_IN_NAME[n]) return n;
    const row = modes.find((m) => String(m.name).trim().toLowerCase() === n);
    return row ? `pm-${row.id}` : n || "cash";
}

module.exports = { modeName, modeIdFromName, BUILT_IN_NAME };
