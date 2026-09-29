const { Op } = require("sequelize");
const moment = require("moment-timezone");
const M = require("../model");
const { outletClock } = require("./core");
const { bookingMoment } = require("./load");

// Scheduled work for POS App (Plan 2) outlets. server.js runs it every minute
// (never on a test database or with DISABLE_CRON=1).

const HOLD_BEFORE = 30 * 60 * 1000;

/**
 * "Reservation due": when a booking's tables start being held (30 min before,
 * the reservation rule), every floor role gets one alert. The alert body ends
 * with "Booking #<id>", which is also how a booking is alerted only once
 * (app_alerts has no reference column).
 */
async function reservationDueAlerts(now = Date.now()) {
    const hotels = await M.Hotel.findAll({ where: { product_plan: "CLOUD_APP" }, attributes: ["id"], raw: true });
    let sent = 0;
    for (const { id: hotelId } of hotels) {
        try {
            sent += await reservationDueFor(hotelId, now);
        } catch (e) {
            console.error(`[appJobs] reservation alerts, hotel ${hotelId}:`, e.message);
        }
    }
    return sent;
}

async function reservationDueFor(hotelId, now) {
    const clock = await outletClock(hotelId);
    const tz = clock.timeZone;
    const days = [moment.tz(now, tz).subtract(1, "day"), moment.tz(now, tz), moment.tz(now, tz).add(1, "day")].map((d) => d.format("YYYY-MM-DD"));
    const rows = await M.TableBooking.findAll({
        where: {
            hotel_id: hotelId,
            deleted: { [Op.not]: true },
            booking_date: { [Op.between]: [`${days[0]} 00:00:00`, `${days[2]} 23:59:59`] },
            [Op.or]: [{ app_status: null }, { app_status: { [Op.notIn]: ["seated", "noshow"] } }],
        },
        raw: true,
    });
    const groups = new Map();
    for (const r of rows) {
        const key = r.booking_id ?? r.id;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(r);
    }
    let sent = 0;
    for (const [bookingId, list] of groups) {
        const r = list[0];
        const start = bookingMoment(r.booking_date, r.start_time, tz);
        if (start == null || now < start - HOLD_BEFORE || now >= start) continue;
        const tag = `Booking #${bookingId}`;
        const done = await M.AppAlert.findOne({
            where: { hotel_id: hotelId, kind: "reservation-due", body: { [Op.like]: `%${tag}` } },
            attributes: ["id"],
            raw: true,
        });
        if (done) continue;
        const [user, tables] = await Promise.all([
            r.UserId ? M.User.findOne({ where: { id: r.UserId, hotel_id: hotelId }, attributes: ["name", "number"], raw: true }) : null,
            M.Table.findAll({ where: { id: list.map((x) => x.TableId).filter(Boolean), hotel_id: hotelId }, attributes: ["table_name"], raw: true }),
        ]);
        const who = user?.name || user?.number || "Guest";
        const at = moment.tz(start, tz).format("h:mm a");
        const guests = Number(r.no_of_person) || 1;
        const tableText = tables.map((t) => t.table_name).join(", ") || "no table";
        await M.AppAlert.create({
            hotel_id: hotelId,
            kind: "reservation-due",
            title: `Reservation at ${at} · ${tableText}`,
            body: `${who} · ${guests} guest${guests === 1 ? "" : "s"} · table held now · ${tag}`,
            link: "/reservations",
            for_roles: JSON.stringify(["Owner", "Manager", "Cashier", "Captain"]),
            read_by: "[]",
        });
        sent++;
    }
    return sent;
}

module.exports = { reservationDueAlerts, reservationDueFor };
