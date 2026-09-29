const M = require("../model");
const { parseJson, r2 } = require("./core");

// Owner alerts (owner list 2026-09-29 #10): things the owner wants to hear
// about at once, each switched on/off in the app (Settings -> Owner alerts,
// owner only), stored as JSON in hms_res_settings.owner_alerts (migration
// 20260929110000). Sent only to Owners (in the app and as a push), and never
// for something the owner did personally.

const OWNER_ALERT_DEFAULTS = { cancelAfterKot: true, bigDiscount: true, discountPct: 20, cashDifference: true };

async function ownerAlertSettings(hotelId, transaction) {
    const row = await M.RestaurantSetting.findOne({ where: { hotel_id: hotelId }, attributes: ["owner_alerts"], raw: true, transaction });
    const saved = parseJson(row?.owner_alerts, {}) || {};
    return { ...OWNER_ALERT_DEFAULTS, ...saved };
}

async function ownerAlert(c, key, { title, body, link }) {
    if (c.perms?.owner) return false;
    const s = await ownerAlertSettings(c.hotelId, c.t);
    if (!s[key]) return false;
    await M.AppAlert.create(
        { hotel_id: c.hotelId, kind: "owner-alert", title: title.slice(0, 160), body: `${body} · by ${c.userName}`.slice(0, 400), link: link || null, for_roles: JSON.stringify(["Owner"]), read_by: "[]" },
        { transaction: c.t },
    );
    return true;
}

/** A settled bill whose discount is above the owner's limit (% of the subtotal). */
async function discountAlert(c, order, { edited = false } = {}) {
    const subtotal = Number(order.totalAmount) || 0;
    const discount = Number(order.totalDiscount) || 0;
    if (!(discount > 0) || !(subtotal > 0)) return false;
    const s = await ownerAlertSettings(c.hotelId, c.t);
    const pct = r2((discount / subtotal) * 100);
    if (pct <= Number(s.discountPct)) return false;
    return ownerAlert(c, "bigDiscount", {
        title: `Big discount · bill ${order.bill_no}`,
        body: `${pct}% off (₹${discount.toFixed(2)} of ₹${subtotal.toFixed(2)})${edited ? " · settled bill edited" : ""}${order.discount_reason ? ` · ${order.discount_reason}` : ""}`,
        link: `/orders/${order.id}`,
    });
}

module.exports = { OWNER_ALERT_DEFAULTS, ownerAlertSettings, ownerAlert, discountAlert };
