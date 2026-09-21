const crypto = require("crypto")
const { Op } = require("sequelize")
const CryptoJS = require("crypto-js")
const { Hotel, Table, QrOrder, QrSession } = require("../model")
const { emitToDevice } = require("../connection/socket")
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

// ---------------------------------------------------------------------------
// Customer sessions (model/qrSession.js). Owner-approved rules, 2026-09-20:
//   - one session per table + mobile, open until the table's order is
//     settled or cancelled on the exe (qrSessionTableState)
//   - no OTP yet (no SMS facility); misuse is capped instead: staff accept
//     every round, ONE pending round per session, item/qty caps, and a cap
//     on new sessions per table
//   - no new rounds once the table's bill has been printed
// ---------------------------------------------------------------------------
const MAX_LINES_PER_ROUND = 30
const MAX_QTY_PER_LINE = 20
const MAX_NEW_SESSIONS_PER_TABLE_PER_HOUR = 20
const MAX_ROUNDS_PER_SESSION_PER_HOUR = 20
// A session the exe never closed (it was offline, the relay was lost) must
// not stay open forever - a new guest at that table would inherit it.
const SESSION_MAX_AGE_MS = 12 * 60 * 60 * 1000

async function closeStaleSession(session) {
    if (session.status === "open" && Date.now() - new Date(session.createdAt).getTime() > SESSION_MAX_AGE_MS) {
        await session.update({ status: "closed", closed_reason: "expired", closed_at: new Date() })
    }
    return session
}

async function sessionView(session) {
    const [table, rounds] = await Promise.all([
        Table.findOne({ where: { id: session.table_id }, attributes: ["id", "table_name", "table_status"] }),
        QrOrder.findAll({
            where: { session_id: session.id },
            attributes: ["id", "items", "status", "createdAt"],
            order: [["id", "ASC"]],
        }),
    ])
    return {
        session: {
            key: session.session_key,
            status: session.status,
            // Only the exe's own report (qrSessionTableState). The cloud's
            // copy of table_status lags the exe by minutes, so a table that
            // was settled and freed could still read "P" here.
            bill_ready: session.status === "open" && !!session.bill_ready,
            closed_reason: session.closed_reason,
            customer_name: session.customer_name,
            customer_mobile: session.customer_mobile,
            table_name: table?.table_name ?? null,
        },
        rounds: rounds.map((r) => ({
            id: r.id,
            items: typeof r.items === "string" ? JSON.parse(r.items) : r.items,
            status: r.status,
            submittedAt: r.createdAt,
        })),
    }
}

// POST /qrSession - public. { qr, customer_mobile, customer_name }.
// Returns this customer's open session at this table, or starts one - so a
// customer whose phone lost everything gets their whole history back just by
// scanning and entering the same mobile again. (An OTP check would slot in
// right here, before a session is handed out.)
const startQrSession = async (req, res) => {
    try {
        const { qr, customer_mobile, customer_name } = req.body
        const payload = decryptQrTablePayload(qr)
        if (!payload) return res.json(error("This menu link looks invalid.", STATUSCODE.BAD_REQUEST))
        if (!customer_mobile || !MOBILE_PATTERN.test(String(customer_mobile))) {
            return res.json(error("Enter a valid 10-digit mobile number.", STATUSCODE.BAD_REQUEST))
        }
        const table = await Table.findOne({ where: { id: payload.tableId, hotel_id: payload.hotelId, active: true } })
        if (!table) return res.json(error(MESSAGE.TABLE_NOT_AVAILABLE, STATUSCODE.BAD_REQUEST))
        if (table.qr_version !== payload.qrVersion) {
            return res.json(error("This menu link is no longer valid - please ask staff for the current one.", STATUSCODE.BAD_REQUEST))
        }

        const mobile = String(customer_mobile)
        let session = await QrSession.findOne({
            where: { hotel_id: payload.hotelId, table_id: table.id, customer_mobile: mobile, status: "open" },
            order: [["id", "DESC"]],
        })
        if (session) await closeStaleSession(session)
        if (session && session.status === "open") {
            if (customer_name && customer_name !== session.customer_name) await session.update({ customer_name })
            return res.json(success(MESSAGE.SUCCESS, await sessionView(session), STATUSCODE.SUCCESS))
        }

        const recent = await QrSession.count({
            where: { table_id: table.id, createdAt: { [Op.gt]: new Date(Date.now() - 60 * 60 * 1000) } },
        })
        if (recent >= MAX_NEW_SESSIONS_PER_TABLE_PER_HOUR) {
            return res.json(error("Too many orders started at this table. Please ask a staff member.", 429))
        }

        // A second guest at a table whose bill is already printed joins the
        // same "no more items" state.
        const billReadyHere = await QrSession.findOne({
            where: { table_id: table.id, status: "open", bill_ready: true },
            attributes: ["id"],
        })
        session = await QrSession.create({
            hotel_id: payload.hotelId,
            table_id: table.id,
            customer_mobile: mobile,
            customer_name: customer_name || null,
            session_key: crypto.randomBytes(24).toString("hex"),
            bill_ready: !!billReadyHere,
        })
        return res.status(STATUSCODE.CREATED).json(success(MESSAGE.SUCCESS, await sessionView(session), STATUSCODE.CREATED))
    } catch (err) {
        console.log(err, "startQrSession error")
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

// GET /qrSession/:key - public. The customer's page polls this for every
// round's status and whether ordering is still open.
const getQrSession = async (req, res) => {
    try {
        const session = await QrSession.findOne({ where: { session_key: req.params.key } })
        if (!session) return res.json(error("Session not found", STATUSCODE.NOT_FOUND))
        await closeStaleSession(session)
        return res.json(success(MESSAGE.SUCCESS, await sessionView(session), STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err, "getQrSession error")
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

// POST /qrOrder - public. { session_key, client_key, items }.
// client_key is generated once per submission by the page and reused on a
// retry, so a double tap or a lost response never creates a second round.
const createQrOrder = async (req, res) => {
    try {
        const { session_key, client_key, items } = req.body
        if (!session_key) {
            // A page from before sessions existed.
            return res.json(error("This menu page was updated - please reload it.", STATUSCODE.BAD_REQUEST))
        }
        if (!client_key || String(client_key).length > 64) {
            return res.json(error("Please reload this page and try again.", STATUSCODE.BAD_REQUEST))
        }
        const session = await QrSession.findOne({ where: { session_key } })
        if (!session) return res.json(error("Your session was not found - please scan the QR again.", STATUSCODE.BAD_REQUEST))
        await closeStaleSession(session)

        const existing = await QrOrder.findOne({ where: { session_id: session.id, client_key: String(client_key) } })
        if (existing) {
            return res.json(success(MESSAGE.SUCCESS, { id: existing.id, duplicate: true, ...(await sessionView(session)) }, STATUSCODE.SUCCESS))
        }

        if (session.status !== "open") {
            return res.json(error("This table's order is closed. Scan the QR again to start a new order.", 409))
        }
        const table = await Table.findOne({ where: { id: session.table_id, active: true }, attributes: ["id", "table_status"] })
        if (!table) return res.json(error(MESSAGE.TABLE_NOT_AVAILABLE, STATUSCODE.BAD_REQUEST))
        if (session.bill_ready) {
            return res.json(error("Your bill is ready. Please ask a staff member to add anything more.", 409))
        }

        if (!Array.isArray(items) || !items.length) {
            return res.json(error("Your cart is empty.", STATUSCODE.BAD_REQUEST))
        }
        if (items.length > MAX_LINES_PER_ROUND) {
            return res.json(error(`Please send at most ${MAX_LINES_PER_ROUND} items in one order.`, STATUSCODE.BAD_REQUEST))
        }
        for (const item of items) {
            const qty = Number(item?.qty)
            if (!Number.isInteger(Number(item?.menuId)) || !Number.isInteger(qty) || qty < 1 || qty > MAX_QTY_PER_LINE) {
                return res.json(error(`Quantity must be between 1 and ${MAX_QTY_PER_LINE} for each item.`, STATUSCODE.BAD_REQUEST))
            }
        }

        const pending = await QrOrder.findOne({ where: { session_id: session.id, status: "pending" }, attributes: ["id"] })
        if (pending) {
            return res.json(error("Your previous order is still waiting for the restaurant to confirm it.", 409))
        }
        const recentRounds = await QrOrder.count({
            where: { session_id: session.id, createdAt: { [Op.gt]: new Date(Date.now() - 60 * 60 * 1000) } },
        })
        if (recentRounds >= MAX_ROUNDS_PER_SESSION_PER_HOUR) {
            return res.json(error("Too many orders from this phone. Please ask a staff member.", 429))
        }

        const qrOrder = await QrOrder.create({
            hotel_id: session.hotel_id,
            table_id: session.table_id,
            qr_version: (await Table.findByPk(session.table_id, { attributes: ["qr_version"] }))?.qr_version ?? 1,
            customer_name: session.customer_name,
            customer_mobile: session.customer_mobile,
            items,
            status: "pending",
            session_id: session.id,
            client_key: String(client_key),
        })

        // The restaurant's exe hears about it at once over its live link
        // (billerpe-local-exe/services/cloudLink.js); its 60s heartbeat is
        // only the fallback.
        emitToDevice(session.hotel_id, "qrOrderCreated", { id: qrOrder.id })

        return res.status(STATUSCODE.CREATED).json(success(MESSAGE.SUCCESS, { id: qrOrder.id, ...(await sessionView(session)) }, STATUSCODE.CREATED))
    } catch (err) {
        if (err?.name === "SequelizeUniqueConstraintError") {
            // Two simultaneous retries of the same submission: the other one won.
            return res.json(error("Your order was already received.", 409))
        }
        console.log(err, "createQrOrder error")
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

// POST /qrSession/tableState - deviceOrAdminAuth. The exe tells us what
// happened to a table that has QR customers:
//   bill_ready: bill printed - stop taking rounds from the phone
//   open:       items added again after the bill - ordering re-opens
//   closed:     settled, cancelled or moved - the visit is over
// Pending rounds of a closed visit are expired so the customer's page
// stops showing "waiting".
const qrSessionTableState = async (req, res) => {
    try {
        const { table_id, state, reason } = req.body
        if (!["bill_ready", "open", "closed"].includes(state)) {
            return res.json(error("Invalid state", STATUSCODE.BAD_REQUEST))
        }
        const where = { hotel_id: req.user, table_id, status: "open" }
        const sessions = await QrSession.findAll({ where, attributes: ["id"] })
        if (state === "closed") {
            await QrSession.update({ status: "closed", closed_reason: reason || "settled", closed_at: new Date() }, { where })
            if (sessions.length) {
                await QrOrder.update({ status: "expired" }, { where: { session_id: sessions.map((x) => x.id), status: "pending" } })
            }
        } else {
            await QrSession.update({ bill_ready: state === "bill_ready" }, { where })
        }
        return res.json(success(MESSAGE.SUCCESS, { sessions: sessions.length }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err, "qrSessionTableState error")
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
    startQrSession,
    getQrSession,
    qrSessionTableState,
    createQrOrder,
    getQrOrderStatus,
    getTableSessionStatus,
    getPendingQrOrders,
    updateQrOrderStatus,
    regenerateTableQr,
}
