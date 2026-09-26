// COPY of billerpe-local-exe/controller/customer.js for the POS App (Plan 2) -
// written by scripts/vendor-exe-for-appv1.py. Do not edit here: change the
// exe's file and re-run the script, so both plans keep the same rules.

const { fn, col, Op } = require("sequelize");
const { User, Order, OrderDetails, Menu } = require("../model");
const { MESSAGE, STATUSCODE } = require("../../../constant/const");
const { success, error } = require("../../../responce/res");

// Ported from uat-backend-v2/controller/user.js's getNumberSuggestion
// (GET /customer/getAll) - read-only. customerApi.getAll (billerpe-pos-
// pro-v2's api.ts) only ever calls this with `?limit=500`, never `search`
// or `page`, so those two params aren't reproduced here.
//
// The nonEmptyCondition filter matters here specifically because
// createDineInOrder (controller/order.js) creates a placeholder User row
// with blank name/number for every dine-in order that never collects a
// real customer number - without this filter every such order would show
// up as a junk blank "customer" row.
const getNumberSuggestion = async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit, 10) || 10, 1000);
        // ?search=<digits>: customers whose mobile contains them - the
        // customer form's suggestions as staff type a number, so a regular
        // is found even beyond the first page the POS keeps in memory.
        const search = String(req.query.search || "").replace(/D/g, "").slice(0, 10);

        const nonEmptyCondition = {
            [Op.or]: [
                { name: { [Op.and]: [{ [Op.ne]: null }, { [Op.ne]: "" }] } },
                { address: { [Op.and]: [{ [Op.ne]: null }, { [Op.ne]: "" }] } },
                { gstin: { [Op.and]: [{ [Op.ne]: null }, { [Op.ne]: "" }] } },
                { number: { [Op.and]: [{ [Op.ne]: null }, { [Op.ne]: "" }, { [Op.ne]: 0 }] } },
            ],
        };
        const whereCondition = {
            hotel_id: req.user, ...nonEmptyCondition,
            ...(search ? { number: { [Op.like]: `%${search}%` } } : {}),
        };
        const totalCount = await User.count({ where: whereCondition, distinct: true, col: "number" });
        const numbers = await User.findAll({
            where: whereCondition,
            attributes: [
                "number",
                [fn("MAX", col("name")), "name"],
                [fn("MAX", col("address")), "address"],
                [fn("MAX", col("gstin")), "gstin"],
                [fn("MAX", col("id")), "id"],
            ],
            group: ["number"],
            // Most recent customers first, so a capped list keeps the ones
            // who actually come back.
            order: [[fn("MAX", col("id")), "DESC"]],
            limit,
            raw: true,
        });

        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { numbers, total: totalCount }, STATUSCODE.SUCCESS));
    } catch (err) {
        console.error("[customer] getNumberSuggestion error:", err);
        return res.status(STATUSCODE.INTERNAL_SERVER_ERROR).json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

// Same rules as the Customer form, so a customer with no name or number
// can't be saved by any client.
const customerProblem = ({ name, number, gstin }) => {
    if (!String(name ?? "").trim()) return "Customer name is required";
    if (!/^\d{10}$/.test(String(number ?? "").trim())) return "Enter a 10-digit mobile number";
    if (gstin && !/^[0-9A-Z]{15}$/i.test(String(gstin).trim())) return "GSTIN must be 15 letters/digits";
    return null;
};

const createCustomerData = async (req, res) => {
    try {
        const { name, number, gstin, address } = req.body;
        const problem = customerProblem(req.body);
        if (problem) return res.json(error(problem, STATUSCODE.BAD_REQUEST));
        const existing = await User.findOne({ where: { number: String(number).trim(), hotel_id: req.user } });
        if (existing) return res.json(error("Customer Number Already Created", STATUSCODE.BAD_REQUEST));
        await User.create({ name: String(name).trim(), number: String(number).trim(), gstin, address, hotel_id: req.user, isPlaceholder: false });
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { message: "Customer Data Created" }, STATUSCODE.SUCCESS));
    } catch (err) {
        console.error("[customer] createCustomerData error:", err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

const updateCostumerData = async (req, res) => {
    try {
        const { name, number, gstin, address, id } = req.body;
        const problem = customerProblem(req.body);
        if (problem) return res.json(error(problem, STATUSCODE.BAD_REQUEST));
        const clash = await User.findOne({ where: { number: String(number).trim(), hotel_id: req.user, id: { [Op.ne]: id } } });
        if (clash) return res.json(error("Another customer already has this number", STATUSCODE.BAD_REQUEST));
        await User.update({ name: String(name).trim(), number: String(number).trim(), gstin, address }, { where: { id, hotel_id: req.user } });
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { message: "Customer Data Updated" }, STATUSCODE.SUCCESS));
    } catch (err) {
        console.error("[customer] updateCostumerData error:", err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

// GET /customer/lastOrder?number=<mobile>&excludeOrderId=<id> - staff-
// facing "repeat this customer's last order" suggestion (Attach customer
// dialog, billerpe-pos-pro-v2's order screen). Real items only, not the
// blank placeholder User rows every dine-in order creates when no
// customer number is collected (see getNumberSuggestion's own comment on
// that - matched here by requiring a non-empty `number`).
// excludeOrderId skips the order currently being built, so typing a
// returning customer's own number into their brand-new order doesn't
// "suggest" that same still-empty order right back at them.
const getLastOrderForCustomer = async (req, res) => {
    try {
        const { number, excludeOrderId } = req.query;
        if (!number) return res.json(error("A customer number is required", STATUSCODE.BAD_REQUEST));

        const order = await Order.findOne({
            include: [
                { model: User, where: { hotel_id: req.user, number }, attributes: [] },
                { model: OrderDetails, include: [{ model: Menu }] },
            ],
            where: {
                hotel_id: req.user,
                deleted: false,
                ...(excludeOrderId ? { id: { [Op.ne]: excludeOrderId } } : {}),
            },
            order: [["createdAt", "DESC"]],
        });

        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { order }, STATUSCODE.SUCCESS));
    } catch (err) {
        console.error("[customer] getLastOrderForCustomer error:", err);
        return res.status(STATUSCODE.INTERNAL_SERVER_ERROR).json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

module.exports = { getNumberSuggestion, createCustomerData, updateCostumerData, getLastOrderForCustomer };
