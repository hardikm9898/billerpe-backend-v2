// COPY of billerpe-local-exe/controller/cashSession.js for the POS App (Plan 2) -
// written by scripts/vendor-exe-for-appv1.py. Do not edit here: change the
// exe's file and re-run the script, so both plans keep the same rules.

const { CashSession, CashMovement, HotelUser } = require("../model");
const { MESSAGE, STATUSCODE } = require("../../../constant/const");
const { success, error } = require("../../../responce/res");

// Ported from uat-backend-v2/controller/cashSession.js - all 4 routes.
const MOVEMENT_TYPES = ["Add", "Withdraw", "Expense", "Settlement"];
const INCLUDES = [
    { model: CashMovement, include: [{ model: HotelUser, attributes: ["id", "name"] }] },
    { model: HotelUser, attributes: ["id", "name"] },
];

// Ordered on purpose: with no order SQLite may return any matching row, and
// while this outlet had 953 duplicate "Open" sessions (see
// utils/dataRepair.js) that made every answer here arbitrary. The newest
// open session is the one a cashier means.
async function findOpenSession(hotel_id) {
    return CashSession.findOne({
        where: { hotel_id, status: "Open", deleted: false },
        order: [["opened_at", "DESC"], ["id", "DESC"]],
    });
}

async function sessionBalance(cashSessionId) {
    return (await CashMovement.sum("amount", { where: { cashSessionId } })) || 0;
}

const getCashSessions = async (req, res) => {
    try {
        const sessions = await CashSession.findAll({
            where: { hotel_id: req.user, deleted: false },
            include: INCLUDES,
            order: [["opened_at", "DESC"]],
            limit: 100,
        });
        return res.json(success(MESSAGE.SUCCESS, { sessions }, STATUSCODE.SUCCESS));
    } catch (err) {
        console.error("[cashSession] getCashSessions error:", err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

const openCashSession = async (req, res) => {
    try {
        const hotel_id = req.user;
        if (await findOpenSession(hotel_id)) {
            return res.json(error("A cash session is already open", STATUSCODE.BAD_REQUEST));
        }
        const float = Number(req.body.opening_float) || 0;
        const openedAt = new Date();
        const session = await CashSession.create({ hotel_id, hotelUserId: req.userId, opening_float: float, status: "Open", opened_at: openedAt });
        await CashMovement.create({ cashSessionId: session.id, hotelUserId: req.userId, type: "Opening", amount: float, reason: "Opening float", at: openedAt });

        const full = await CashSession.findByPk(session.id, { include: INCLUDES });
        return res.status(STATUSCODE.CREATED).json(success(MESSAGE.SUCCESS, { session: full }, STATUSCODE.CREATED));
    } catch (err) {
        console.error("[cashSession] openCashSession error:", err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

const addCashMovement = async (req, res) => {
    try {
        const hotel_id = req.user;
        const { type, amount, reason } = req.body;
        if (!MOVEMENT_TYPES.includes(type)) return res.json(error("Invalid movement type", STATUSCODE.BAD_REQUEST));
        const amt = Number(amount);
        if (!(amt > 0)) return res.json(error("Amount must be greater than zero", STATUSCODE.BAD_REQUEST));

        const session = await findOpenSession(hotel_id);
        if (!session) return res.json(error("No cash session is open", STATUSCODE.BAD_REQUEST));

        const signedAmount = (type === "Withdraw" || type === "Expense") ? -amt : amt;
        if (signedAmount < 0) {
            const balance = await sessionBalance(session.id);
            if (amt > balance) return res.json(error(`Amount exceeds the drawer balance of ${balance}`, STATUSCODE.BAD_REQUEST));
        }

        const movement = await CashMovement.create({ cashSessionId: session.id, hotelUserId: req.userId, type, amount: signedAmount, reason: reason || "", at: new Date() });
        return res.status(STATUSCODE.CREATED).json(success(MESSAGE.SUCCESS, { movement }, STATUSCODE.CREATED));
    } catch (err) {
        console.error("[cashSession] addCashMovement error:", err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

const closeCashSession = async (req, res) => {
    try {
        const hotel_id = req.user;
        const session = await findOpenSession(hotel_id);
        if (!session) return res.json(error("No cash session is open", STATUSCODE.BAD_REQUEST));

        const expected = await sessionBalance(session.id);
        const counted = Number(req.body.counted_cash) || 0;
        await session.update({
            status: "Closed", closed_at: new Date(), counted_cash: counted,
            variance: counted - expected, variance_reason: req.body.variance_reason || null,
        });
        return res.json(success(MESSAGE.SUCCESS, { session, expected }, STATUSCODE.SUCCESS));
    } catch (err) {
        console.error("[cashSession] closeCashSession error:", err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

module.exports = { getCashSessions, openCashSession, addCashMovement, closeCashSession };
