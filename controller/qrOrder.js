const CryptoJS = require("crypto-js")
const { Hotel, Table, QrOrder } = require("../model")
const { STATUSCODE, MESSAGE } = require("../constant/const")
const { success, error } = require("../responce/res")
const { updateTableToRadis } = require("./redis/redisCrud")

// QR table ordering. See model/qrOrder.js and migrations/20260908130000-*
// /20260908130100-* for the full design rationale - this is the handoff
// record between a customer's phone and the exe; the exe (controller/
// qrOrder.js, billerpe-local-exe) is what creates the real billable order
// once staff accepts.

// Packs {hotelId, tableId, qrVersion} into one opaque blob, same AES
// scheme as menu.js's decryptId (DESECRET_KEY) but carrying three fields
// instead of one - the customer's page never sends raw hotel_id/table_id
// itself, only this ciphertext, matching the same "don't trust a raw id
// from the client" posture the QR menu view already uses.
function decryptQrTablePayload(encrypted) {
    try {
        const decoded = decodeURIComponent(encrypted)
        const bytes = CryptoJS.AES.decrypt(decoded, process.env.DESECRET_KEY)
        const json = bytes.toString(CryptoJS.enc.Utf8)
        const parsed = JSON.parse(json)
        if (!parsed || typeof parsed.hotelId !== "number" || typeof parsed.tableId !== "number" || typeof parsed.qrVersion !== "number") {
            return null
        }
        return parsed
    } catch (err) {
        return null
    }
}

const MOBILE_PATTERN = /^[0-9]{10}$/

// POST /qrOrder - public, no auth, same reasoning as menuByCategory: the
// customer's phone was never going to have a session. Rejects a stale/
// rotated QR (qr_version mismatch) here, at submit time, rather than
// letting it confuse staff later as an unexplained pending order.
const createQrOrder = async (req, res) => {
    try {
        const { qr, customer_name, customer_mobile, items } = req.body

        const payload = decryptQrTablePayload(qr)
        if (!payload) return res.json(error("This menu link looks invalid.", STATUSCODE.BAD_REQUEST))

        if (!customer_mobile || !MOBILE_PATTERN.test(String(customer_mobile))) {
            return res.json(error("A valid 10-digit mobile number is required.", STATUSCODE.BAD_REQUEST))
        }
        if (!Array.isArray(items) || !items.length) {
            return res.json(error("Your cart is empty.", STATUSCODE.BAD_REQUEST))
        }

        const hotel = await Hotel.findOne({ where: { id: payload.hotelId } })
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST))

        const table = await Table.findOne({ where: { id: payload.tableId, hotel_id: payload.hotelId, active: true } })
        if (!table) return res.json(error(MESSAGE.TABLE_NOT_AVAILABLE, STATUSCODE.BAD_REQUEST))

        if (table.qr_version !== payload.qrVersion) {
            return res.json(error("This menu link is no longer valid - please ask staff for the current one.", STATUSCODE.BAD_REQUEST))
        }

        const qrOrder = await QrOrder.create({
            hotel_id: payload.hotelId,
            table_id: payload.tableId,
            qr_version: payload.qrVersion,
            customer_name: customer_name || null,
            customer_mobile: String(customer_mobile),
            items,
            status: "pending",
        })

        return res.status(STATUSCODE.CREATED).json(success(MESSAGE.SUCCESS, { id: qrOrder.id }, STATUSCODE.CREATED))
    } catch (err) {
        console.log(err, "createQrOrder error")
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

// GET /qrOrder/:id/status - public poll target for the customer's own
// page. Deliberately minimal (status only, no items/mobile echoed back) -
// this is reachable by anyone who has the order id, no auth at all.
const getQrOrderStatus = async (req, res) => {
    try {
        const qrOrder = await QrOrder.findOne({ where: { id: req.params.id }, attributes: ["id", "status"] })
        if (!qrOrder) return res.json(error("Order not found", STATUSCODE.NOT_FOUND))
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { status: qrOrder.status }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err, "getQrOrderStatus error")
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

// GET /qrOrder/tableStatus - public poll target for the customer's own
// page to know when its ordering session has ended (bill settled / table
// turned over), so it knows when to stop showing "your order so far" and
// reset for the next guest. `table_status` here is direct-from-MySQL, not
// the exe's own Redis-cached offlineTable snapshot (see regenerateTableQr's
// own comment on that cache) - this reads Table fresh every call, though it
// can still lag the exe's real-time value by up to the 60s order-push tick
// (table_status is local-exe-authoritative and only reaches the cloud via
// that push - see billerpe-local-exe/services/cloudPull.js's own comment on
// why table_status is dropped on the PULL side). That's an acceptable
// latency for "has my session ended", not a hard real-time requirement.
const getTableSessionStatus = async (req, res) => {
    try {
        const { qr } = req.query
        const payload = decryptQrTablePayload(qr)
        if (!payload) return res.json(error("This menu link looks invalid.", STATUSCODE.BAD_REQUEST))

        const table = await Table.findOne({
            where: { id: payload.tableId, hotel_id: payload.hotelId, active: true },
            attributes: ["table_status"],
        })
        if (!table) return res.json(error(MESSAGE.TABLE_NOT_AVAILABLE, STATUSCODE.BAD_REQUEST))

        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { table_status: table.table_status }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err, "getTableSessionStatus error")
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

// GET /qrOrder/pending - adminAuth, used by the exe's 15s config-sync pull
// (services/qrOrderSync.js, billerpe-local-exe) to mirror pending orders
// down locally.
const getPendingQrOrders = async (req, res) => {
    try {
        const qrOrders = await QrOrder.findAll({
            where: { hotel_id: req.user, status: "pending" },
            order: [["id", "ASC"]],
        })
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { qrOrders }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err, "getPendingQrOrders error")
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

// POST /qrOrder/:id/status - adminAuth, the exe calls this right after a
// real local accept/reject (controller/qrOrder.js, billerpe-local-exe) so
// the cloud record the customer is polling reflects what staff actually
// decided. Only ever moves pending -> accepted/rejected/expired - the exe
// is the one source of truth for that decision, this just relays it.
const updateQrOrderStatus = async (req, res) => {
    try {
        const { status } = req.body
        if (!["accepted", "rejected", "expired"].includes(status)) {
            return res.json(error("Invalid status", STATUSCODE.BAD_REQUEST))
        }
        const qrOrder = await QrOrder.findOne({ where: { id: req.params.id, hotel_id: req.user } })
        if (!qrOrder) return res.json(error("Order not found", STATUSCODE.NOT_FOUND))
        await qrOrder.update({ status })
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { message: "Updated" }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err, "updateQrOrderStatus error")
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

// POST /table/:id/qr-version - adminAuth, staff-triggered "regenerate this
// table's QR" (Operations -> QR section). Bumps the one column that
// createQrOrder checks, invalidating every previously-printed/shared link
// for just this table - mirrors down to the exe on the next config-sync
// pull like any other table field.
const regenerateTableQr = async (req, res) => {
    try {
        const table = await Table.findOne({ where: { id: req.params.id, hotel_id: req.user } })
        if (!table) return res.json(error(MESSAGE.TABLE_NOT_AVAILABLE, STATUSCODE.BAD_REQUEST))
        // table.update(...) mutates this same in-memory instance's field to
        // the new value on success - capture it once rather than reading
        // `table.qr_version + 1` a second time afterward, which would
        // double-increment the value in the response only (confirmed live:
        // DB correctly went 1->2, but the response echoed 3).
        const newVersion = table.qr_version + 1
        await table.update({ qr_version: newVersion })
        // Every other table-mutating endpoint in this codebase refreshes
        // this same cache (controller/hotel.js's editTable, kto.js's table-
        // status changes, etc.) - confirmed live this one didn't: the exe's
        // offlineTable pull (services/cloudPull.js, billerpe-local-exe)
        // kept serving the stale pre-bump qr_version for the cache's full
        // 48h TTL, so a "regenerated" QR staff just downloaded would
        // silently encode the OLD version and get rejected on first scan.
        // Best-effort like every other caller of this helper - the version
        // bump above already committed, so a Redis hiccup here must not
        // turn an already-successful regenerate into a reported failure.
        try {
            await updateTableToRadis(req.params.id, req.user)
        } catch (cacheErr) {
            console.error("regenerateTableQr: updateTableToRadis failed -", cacheErr)
        }
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { qr_version: newVersion }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err, "regenerateTableQr error")
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

module.exports = {
    createQrOrder,
    getQrOrderStatus,
    getTableSessionStatus,
    getPendingQrOrders,
    updateQrOrderStatus,
    regenerateTableQr,
}
