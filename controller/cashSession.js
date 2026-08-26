const { STATUSCODE, MESSAGE } = require("../constant/const")
const { error, success } = require("../responce/res")
const CashSession = require("../model/cashSession")
const CashMovement = require("../model/cashMovement")
const HotelUser = require("../model/hotelUser")

// One open drawer per hotel at a time - mirrors the frontend's own
// assumption (s.cashSessions.find(c => c.status === "Open")).
async function findOpenSession(hotel_id) {
    return CashSession.findOne({ where: { hotel_id, status: "Open", deleted: false } })
}

const getCashSessions = async (req, res) => {
    try {
        const sessions = await CashSession.findAll({
            where: { hotel_id: req.user, deleted: false },
            include: [
                { model: CashMovement, include: [{ model: HotelUser, attributes: ['id', 'name'] }] },
                { model: HotelUser, attributes: ['id', 'name'] },
            ],
            order: [['opened_at', 'DESC']],
            limit: 100,
        })
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { sessions }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err, "getCashSessions error")
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

const openCashSession = async (req, res) => {
    try {
        const { opening_float } = req.body
        const existing = await findOpenSession(req.user)
        if (existing) {
            return res.json(error("A cash session is already open", STATUSCODE.BAD_REQUEST))
        }
        const float = Number(opening_float) || 0
        const openedAt = new Date()
        const session = await CashSession.create({
            hotel_id: req.user, hotelUserId: req.userId,
            opening_float: float, status: "Open", opened_at: openedAt,
        })
        await CashMovement.create({
            cashSessionId: session.id, hotelUserId: req.userId,
            type: "Opening", amount: float, reason: "Opening float", at: openedAt,
        })
        const full = await CashSession.findOne({
            where: { id: session.id },
            include: [
                { model: CashMovement, include: [{ model: HotelUser, attributes: ['id', 'name'] }] },
                { model: HotelUser, attributes: ['id', 'name'] },
            ],
        })
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { session: full }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err, "openCashSession error")
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

const MOVEMENT_TYPES = ["Add", "Withdraw", "Expense", "Settlement"]

const addCashMovement = async (req, res) => {
    try {
        const { type, amount, reason } = req.body
        if (!MOVEMENT_TYPES.includes(type)) {
            return res.json(error("Invalid movement type", STATUSCODE.BAD_REQUEST))
        }
        const amt = Number(amount)
        if (!amt || amt <= 0) {
            return res.json(error("Amount must be greater than zero", STATUSCODE.BAD_REQUEST))
        }
        const session = await findOpenSession(req.user)
        if (!session) {
            return res.json(error("No cash session is open", STATUSCODE.BAD_REQUEST))
        }
        // Withdraw/Expense reduce the drawer - Add/Settlement increase it,
        // matching the frontend's own sign convention.
        const signedAmount = type === "Withdraw" || type === "Expense" ? -amt : amt
        if (signedAmount < 0) {
            const movements = await CashMovement.findAll({ where: { cashSessionId: session.id } })
            const balance = movements.reduce((sum, m) => sum + Number(m.amount), 0)
            if (amt > balance) {
                return res.json(error(
                    `Amount exceeds the drawer balance of ${balance}`,
                    STATUSCODE.BAD_REQUEST,
                ))
            }
        }
        const movement = await CashMovement.create({
            cashSessionId: session.id, hotelUserId: req.userId,
            type, amount: signedAmount, reason: reason || "", at: new Date(),
        })
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { movement }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err, "addCashMovement error")
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

const closeCashSession = async (req, res) => {
    try {
        const { counted_cash, variance_reason } = req.body
        const session = await findOpenSession(req.user)
        if (!session) {
            return res.json(error("No cash session is open", STATUSCODE.BAD_REQUEST))
        }
        const movements = await CashMovement.findAll({ where: { cashSessionId: session.id } })
        const expected = movements.reduce((sum, m) => sum + Number(m.amount), 0)
        const counted = Number(counted_cash) || 0
        await session.update({
            status: "Closed",
            closed_at: new Date(),
            counted_cash: counted,
            variance: counted - expected,
            variance_reason: variance_reason || null,
        })
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, {
            session, expected,
        }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err, "closeCashSession error")
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

module.exports = { getCashSessions, openCashSession, addCashMovement, closeCashSession }
