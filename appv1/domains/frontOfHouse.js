const { Op } = require("sequelize");
const moment = require("moment-timezone");
const M = require("../../model");
const { fail, need, r2, audit, outletClock } = require("../core");
const { callController } = require("../legacy");
const { recordCash, event } = require("../orders");
const { bookingMoment } = require("../load");
const customerCtl = require("../exe/controller/customer");

// Reservations, waitlist, customers and dues for POS App outlets.
//
// Reservations use the cloud's own storage (hms_tableBooking_mst: one row
// per table, grouped by booking_id; the guest on hms_user_master) so a plan
// switch keeps them. The cloud's controller/tableBooking.js scheduler is NOT
// used: it flips table_status on a timer and references a request that no
// longer exists. Whether a booking holds its table is decided by the clock
// when the outlet is loaded (appv1/load.js), like the exe's reservation timer.

const MOBILE = /^\d{10}$/;

/* ------------------------------ reservations ------------------------------ */

async function bookingRows(c, id) {
    return M.TableBooking.findAll({ where: { hotel_id: c.hotelId, booking_id: Number(id) || 0 }, transaction: c.t });
}

/** Customer row for a mobile: an existing real customer, or a new one. */
async function customerFor(c, name, mobile, email) {
    let user = await M.User.findOne({ where: { hotel_id: c.hotelId, number: mobile, isPlaceholder: { [Op.not]: true } }, order: [["id", "DESC"]], transaction: c.t });
    if (user) await user.update({ name, ...(email ? { email } : {}) }, { transaction: c.t });
    else user = await M.User.create({ hotel_id: c.hotelId, name, number: mobile, email: email || null, isPlaceholder: false }, { transaction: c.t });
    return user;
}

async function saveReservation(c, r) {
    need(c, "reservations", r.id ? "edit" : "create");
    const name = String(r.name || "").trim();
    if (!name) fail("Guest name is required");
    if (!MOBILE.test(String(r.mobile || ""))) fail("Enter a 10-digit mobile number");
    if (!(Number(r.guests) >= 1)) fail("Guests must be at least 1");
    const start = new Date(r.at);
    const end = new Date(r.endAt);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) fail("Pick the date and time");
    if (end <= start) fail("End time must be after the start time");
    if (Number(r.advance) < 0) fail("Advance cannot be negative");
    const tableIds = [...new Set((r.tableIds || []).map(Number).filter(Boolean))];
    if (!tableIds.length) fail("Pick a table");
    const tables = await M.Table.findAll({ where: { id: tableIds, hotel_id: c.hotelId, active: true }, transaction: c.t });
    if (tables.length !== tableIds.length) fail("A table is no longer available");

    // Clash: another active booking on one of these tables overlapping in time.
    const clock = await outletClock(c.hotelId, c.t);
    const day = moment(start).tz(clock.timeZone);
    const others = await M.TableBooking.findAll({
        where: {
            hotel_id: c.hotelId, TableId: tableIds, deleted: false, app_status: { [Op.is]: null },
            booking_date: { [Op.between]: [day.clone().subtract(1, "day").format("YYYY-MM-DD"), day.clone().add(1, "day").format("YYYY-MM-DD")] },
            ...(r.id ? { booking_id: { [Op.ne]: Number(r.id) } } : {}),
        },
        transaction: c.t,
    });
    for (const o of others) {
        const s = bookingMoment(o.booking_date, o.start_time, clock.timeZone);
        let e = bookingMoment(o.booking_date, o.end_time, clock.timeZone);
        if (s == null || e == null) continue;
        if (e <= s) e += 24 * 60 * 60 * 1000;
        if (s < end.getTime() && e > start.getTime()) {
            const t = tables.find((x) => x.id === o.TableId);
            const who = await M.User.findOne({ where: { id: o.UserId }, attributes: ["name"], transaction: c.t });
            fail(`${t?.table_name ?? "A table"} is already booked from ${moment(s).tz(clock.timeZone).format("HH:mm")} to ${moment(e).tz(clock.timeZone).format("HH:mm")}${who?.name ? ` (${who.name})` : ""}. Choose another time or table.`);
        }
    }

    const user = await customerFor(c, name, String(r.mobile), r.email);
    let bookingId = Number(r.id) || 0;
    if (bookingId) {
        const rows = await bookingRows(c, bookingId);
        if (!rows.length) fail("Reservation not found");
        await M.TableBooking.destroy({ where: { hotel_id: c.hotelId, booking_id: bookingId }, transaction: c.t });
    } else {
        // Same numbering as the cloud controller: one past the highest.
        bookingId = ((await M.TableBooking.max("booking_id", { where: { hotel_id: c.hotelId }, transaction: c.t })) || 0) + 1;
    }
    // Stored as the outlet's local "YYYY-MM-DDTHH:mm", like the Web POS sends.
    const local = (d) => moment(d).tz(clock.timeZone).format("YYYY-MM-DDTHH:mm");
    for (const t of tables) {
        await M.TableBooking.create({
            hotel_id: c.hotelId, TableId: t.id, UserId: user.id, booking_id: bookingId,
            booking_date: day.format("YYYY-MM-DD"), start_time: local(start), end_time: local(end),
            no_of_person: Number(r.guests), advance: Number(r.advance) || 0, totalAmount: Number(r.advance) || 0,
            enter_by: c.userId, modified_by: c.userId, status: true, deleted: false,
        }, { transaction: c.t });
    }
    await audit(c, "Reservations", `${r.id ? "Edited" : "Booked"} ${name} for ${r.guests} on ${local(start)}`);
    return { id: String(bookingId) };
}

async function setReservationStatus(c, id, status) {
    need(c, "reservations", "edit");
    const rows = await bookingRows(c, id);
    if (!rows.length) fail("Reservation not found");
    const patch =
        status === "cancelled" ? { deleted: true }
            : status === "seated" || status === "noshow" ? { app_status: status, deleted: false }
                : status === "booked" ? { app_status: null, deleted: false }
                    : fail("Unknown status");
    await M.TableBooking.update({ ...patch, modified_by: c.userId }, { where: { hotel_id: c.hotelId, booking_id: Number(id) }, transaction: c.t });
    await audit(c, "Reservations", `Reservation ${id}: ${status}`);
}

/* ------------------------------ waitlist ------------------------------ */

async function addToQueue(c, e) {
    need(c, "queue", "create");
    const name = String(e.name || "").trim();
    if (!name) fail("Customer name is required");
    const mobile = String(e.mobile || "").trim();
    if (!mobile) fail("Mobile number is required");
    if (!MOBILE.test(mobile)) fail("Enter a 10-digit mobile number");
    if (!Number.isInteger(Number(e.guests)) || Number(e.guests) < 1) fail("Party size must be a whole number of at least 1");
    const row = await M.AppQueueEntry.create({ hotel_id: c.hotelId, name, mobile, guests: Number(e.guests), note: e.note ? String(e.note).slice(0, 200) : null, status: "waiting", joined_at: new Date() }, { transaction: c.t });
    return { id: String(row.id) };
}

async function setQueueStatus(c, id, status) {
    need(c, "queue", "edit");
    if (!["waiting", "called", "seated", "noshow", "cancelled"].includes(status)) fail("Invalid status");
    const row = await M.AppQueueEntry.findOne({ where: { id: Number(id) || 0, hotel_id: c.hotelId }, transaction: c.t });
    if (!row) fail("Queue entry not found");
    await row.update({ status, ...(status === "called" ? { called_at: new Date() } : {}) }, { transaction: c.t });
}

/* ------------------------------ customers & dues ------------------------------ */

/** Same rules and storage as the exe's customer screen (controller/customer.js). */
async function saveCustomer(c, input) {
    need(c, "ops-ledger", input.id ? "edit" : "create");
    const body = { name: input.name, number: String(input.mobile || "").trim(), gstin: input.gstin ? String(input.gstin).trim().toUpperCase() : null, address: input.address || null };
    if (input.id) {
        const row = await M.User.findOne({ where: { id: Number(input.id) || 0, hotel_id: c.hotelId } });
        if (!row) fail("Customer not found");
        await callController(customerCtl.updateCostumerData, c, { body: { ...body, id: row.id } });
    } else {
        await callController(customerCtl.createCustomerData, c, { body });
    }
    if (input.email !== undefined) {
        await M.User.update({ email: input.email || null }, { where: { hotel_id: c.hotelId, number: body.number, isPlaceholder: { [Op.not]: true } } });
    }
}

/**
 * Collect a due: the customer's bills oldest first. Each bill's due drops
 * and the money goes to the mode it was paid in (exe controller/order.js#
 * settleDue: part payments allowed; the outlet's own modes go to
 * other_payments). Cash goes into the open drawer.
 */
async function collectDue(c, mobile, amount, modeId) {
    need(c, "ops-ledger", "edit");
    const amt = r2(amount);
    if (!(amt > 0)) fail("Enter an amount");
    if (modeId === "due") fail("Pick how the customer paid");
    let customMode = null;
    if (!["cash", "upi", "card"].includes(modeId)) {
        customMode = /^pm-(\d+)$/.test(String(modeId)) ? await M.PaymentMode.findOne({ where: { id: Number(String(modeId).slice(3)), hotel_id: c.hotelId, active: true }, transaction: c.t }) : null;
        if (!customMode) fail("Choose a valid payment mode");
    }
    const users = await M.User.findAll({ where: { hotel_id: c.hotelId, number: String(mobile) }, attributes: ["id", "name"], transaction: c.t });
    if (!users.length) fail("Customer not found");
    const bills = await M.Order.findAll({
        where: { hotel_id: c.hotelId, UserId: users.map((u) => u.id), deleted: false, due: { [Op.gt]: 0 } },
        order: [["createdAt", "ASC"]], transaction: c.t,
    });
    const outstanding = r2(bills.reduce((s, o) => s + Number(o.due), 0));
    if (amt > outstanding) fail(`Only ₹${outstanding.toFixed(2)} is due`);
    let left = amt;
    for (const o of bills) {
        if (left <= 0) break;
        const take = r2(Math.min(left, Number(o.due)));
        const fields = { due: r2(Number(o.due) - take) };
        if (customMode) {
            const list = (() => {
                try {
                    return JSON.parse(o.other_payments || "[]") || [];
                } catch {
                    return [];
                }
            })();
            const hit = list.find((p) => String(p.name).trim().toLowerCase() === customMode.name.trim().toLowerCase());
            if (hit) hit.amount = r2(Number(hit.amount) + take);
            else list.push({ name: customMode.name, amount: take });
            fields.other_payments = JSON.stringify(list);
            fields.other_amount = r2(list.reduce((s, p) => s + (Number(p.amount) || 0), 0));
        } else fields[modeId] = r2((Number(o[modeId]) || 0) + take);
        await o.update(fields, { transaction: c.t });
        await M.DuePaymentReceive.create({
            hotel_id: c.hotelId, user_id: o.UserId, order_id: o.id, settle_by: c.userId, amount: take,
            payment_mode: customMode ? customMode.name : modeId, bill_no: String(o.bill_no), business_date: moment().format("YYYY-MM-DD"),
        }, { transaction: c.t });
        await event(c, o.id, `Due collected ₹${take.toFixed(2)} (${customMode ? customMode.name : modeId.toUpperCase()})`, "update_order");
        if (modeId === "cash") await recordCash(c, take, `Due collected · Bill #${o.bill_no}`);
        left = r2(left - take);
    }
    await audit(c, "Due", `Collected ₹${amt} from ${users[0].name || mobile}`);
}

module.exports = {
    saveReservation: { write: true, fn: saveReservation },
    setReservationStatus: { write: true, fn: setReservationStatus },
    addToQueue: { write: true, fn: addToQueue },
    setQueueStatus: { write: true, fn: setQueueStatus },
    // The exe's customer controller writes outside our transaction.
    saveCustomer: { fn: saveCustomer },
    collectDue: { write: true, fn: collectDue },
};
