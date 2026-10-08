const { sequelize, BilCounter } = require("../../model");
const settings = require("../settings");
const { moment, TZ, txt, json, parse } = require("../crm/util");

// Shared pieces of BillerPe's own billing (phase 6): GST states and place of
// supply, the tax split, rupee rounding, the financial year and the number
// series (one per kind per financial year, GST rule).

// GST state codes (the first two digits of a GSTIN).
const STATES = [
    ["01", "Jammu and Kashmir"], ["02", "Himachal Pradesh"], ["03", "Punjab"], ["04", "Chandigarh"], ["05", "Uttarakhand"], ["06", "Haryana"],
    ["07", "Delhi"], ["08", "Rajasthan"], ["09", "Uttar Pradesh"], ["10", "Bihar"], ["11", "Sikkim"], ["12", "Arunachal Pradesh"], ["13", "Nagaland"],
    ["14", "Manipur"], ["15", "Mizoram"], ["16", "Tripura"], ["17", "Meghalaya"], ["18", "Assam"], ["19", "West Bengal"], ["20", "Jharkhand"],
    ["21", "Odisha"], ["22", "Chhattisgarh"], ["23", "Madhya Pradesh"], ["24", "Gujarat"], ["26", "Dadra and Nagar Haveli and Daman and Diu"],
    ["27", "Maharashtra"], ["29", "Karnataka"], ["30", "Goa"], ["31", "Lakshadweep"], ["32", "Kerala"], ["33", "Tamil Nadu"], ["34", "Puducherry"],
    ["35", "Andaman and Nicobar Islands"], ["36", "Telangana"], ["37", "Andhra Pradesh"], ["38", "Ladakh"], ["97", "Other Territory"], ["96", "Outside India"],
].map(([code, name]) => ({ code, name }));
const STATE_NAME = new Map(STATES.map((s) => [s.code, s.name]));

/** The GST state of an Indian PIN code (by its first digits); "" when unknown. Staff can always change it. */
function stateOfPin(pin) {
    const p = String(pin || "").replace(/\D/g, "");
    if (p.length !== 6) return "";
    const n2 = Number(p.slice(0, 2));
    const n3 = Number(p.slice(0, 3));
    if (n3 === 160) return "04";
    if (n3 === 194) return "38";
    if (n3 === 403) return "30";
    if (n3 === 605) return "34";
    if (n3 === 682 && Number(p.slice(0, 4)) === 6825) return "31";
    if (n3 === 737) return "11";
    if (n3 === 744) return "35";
    // Daman (396210-396220), Dadra and Nagar Haveli (396230-396240), Diu (362520).
    if ((Number(p) >= 396210 && Number(p) <= 396240) || p === "362520") return "26";
    if ((n3 >= 244 && n3 <= 249) || n3 === 262 || n3 === 263) return "05";
    if (n3 >= 790 && n3 <= 792) return "12";
    if (n3 === 793 || n3 === 794) return "17";
    if (n3 === 795) return "14";
    if (n3 === 796) return "15";
    if (n3 === 797 || n3 === 798) return "13";
    if (n3 === 799) return "16";
    if (n3 >= 814 && n3 <= 835) return "20";
    if (n2 === 11) return "07";
    if (n2 === 12 || n2 === 13) return "06";
    if (n2 >= 14 && n2 <= 16) return "03";
    if (n2 === 17) return "02";
    if (n2 === 18 || n2 === 19) return "01";
    if (n2 >= 20 && n2 <= 28) return "09";
    if (n2 >= 30 && n2 <= 34) return "08";
    if (n2 >= 36 && n2 <= 39) return "24";
    if (n2 >= 40 && n2 <= 44) return "27";
    if (n2 >= 45 && n2 <= 48) return "23";
    if (n2 === 49) return "22";
    if (n2 === 50) return "36";
    if (n2 >= 51 && n2 <= 53) return "37";
    if (n2 >= 56 && n2 <= 59) return "29";
    if (n2 >= 60 && n2 <= 64) return "33";
    if (n2 >= 67 && n2 <= 69) return "32";
    if (n2 >= 70 && n2 <= 74) return "19";
    if (n2 >= 75 && n2 <= 77) return "21";
    if (n2 === 78) return "18";
    if (n2 >= 80 && n2 <= 85) return "10";
    return "";
}

const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/** Place of supply: the buyer's GSTIN state, else their PIN code's state, else the seller's own. */
function supplyState({ gstin, pin }, sellerState) {
    const g = String(gstin || "").toUpperCase();
    if (GSTIN_RE.test(g) && STATE_NAME.has(g.slice(0, 2))) return g.slice(0, 2);
    return stateOfPin(pin) || sellerState;
}

/* ------------------------------ money ------------------------------ */

// Paise integers inside, rupees (2 decimals) outside.
const paise = (r) => Math.round((Number(r) || 0) * 100);
const rupees = (p) => Math.round(p) / 100;

/**
 * Totals of an invoice from its lines (qty, unit_price, gst_rate), one
 * invoice-level discount in percent, and whether tax is CGST+SGST (same
 * state) or IGST. The discount is shared over the lines before tax; the
 * total is rounded to the rupee (round_off).
 */
function totals(lines, discountPct, intraState) {
    const amounts = lines.map((l) => Math.round(paise(l.unit_price) * (Number(l.qty) || 0)));
    const subtotal = amounts.reduce((a, b) => a + b, 0);
    const pct = Math.min(100, Math.max(0, Number(discountPct) || 0));
    const discount = Math.round((subtotal * pct) / 100);
    let left = discount;
    let cgst = 0;
    let sgst = 0;
    let igst = 0;
    let taxable = 0;
    lines.forEach((l, i) => {
        const share = i === lines.length - 1 ? left : subtotal ? Math.round((discount * amounts[i]) / subtotal) : 0;
        left -= share;
        const base = amounts[i] - share;
        taxable += base;
        const tax = Math.round((base * (Number(l.gst_rate) || 0)) / 100);
        if (intraState) {
            const half = Math.round(tax / 2);
            cgst += half;
            sgst += tax - half;
        } else igst += tax;
    });
    const exact = taxable + cgst + sgst + igst;
    const total = Math.round(exact / 100) * 100;
    return {
        amounts: amounts.map(rupees),
        subtotal: rupees(subtotal),
        discount: rupees(discount),
        discount_pct: pct,
        taxable: rupees(taxable),
        cgst: rupees(cgst),
        sgst: rupees(sgst),
        igst: rupees(igst),
        round_off: rupees(total - exact),
        total: rupees(total),
    };
}

/* ------------------------------ numbers ------------------------------ */

/** "26-27" for any date from 1 Apr 2026 to 31 Mar 2027 (India time). */
function fyOf(date = new Date()) {
    const m = moment(date).tz(TZ);
    const start = m.month() >= 3 ? m.year() : m.year() - 1;
    return `${String(start).slice(2)}-${String(start + 1).slice(2)}`;
}

/** The next number of a series, inside `t` (the counter row is locked until the change commits). */
async function nextNumber(kind, prefix, t, date = new Date()) {
    const fy = fyOf(date);
    const [row] = await BilCounter.findOrCreate({ where: { kind, fy }, defaults: { next: 1 }, transaction: t, lock: t.LOCK.UPDATE });
    const n = row.next;
    await row.update({ next: n + 1 }, { transaction: t });
    return `${prefix}/${fy}/${String(n).padStart(5, "0")}`;
}

async function billingSettings() {
    return settings.read("billing");
}

async function seller() {
    const c = await settings.read("company");
    return { name: c.name, gstin: c.gstin, demo: !!c.gstinIsDemo, state: c.stateCode || String(c.gstin || "").slice(0, 2), stateName: c.state, address: c.address, sac: c.sac, prefixes: { invoice: c.invoicePrefix, credit: c.creditNotePrefix, receipt: c.receiptPrefix } };
}

const money = (n) => `Rs ${Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

module.exports = { STATES, STATE_NAME, GSTIN_RE, stateOfPin, supplyState, paise, rupees, totals, fyOf, nextNumber, billingSettings, seller, money, moment, TZ, txt, json, parse, sequelize };
