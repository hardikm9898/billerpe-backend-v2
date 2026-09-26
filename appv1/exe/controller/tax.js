// COPY of billerpe-local-exe/controller/tax.js for the POS App (Plan 2) -
// written by scripts/vendor-exe-for-appv1.py. Do not edit here: change the
// exe's file and re-run the script, so both plans keep the same rules.

const { TaxType } = require("../model");
const { MESSAGE, STATUSCODE } = require("../../../constant/const");
const { success, error } = require("../../../responce/res");
const { emitConfigChanged } = require("../socketShim");

// Ported from uat-backend-v2/controller/tax.js. TaxType has no cloud
// offline* sync endpoint at all (see services/cloudPull.js's own comment
// on this exact gap) - this data has nowhere else to come from but being
// entered directly here, so createTaxType/editTaxType are ported too, not
// just the read, unlike most of Milestone 1's other "just unblock the
// toast" endpoints.
const getTaxtType = async (req, res) => {
    try {
        const taxtTypes = await TaxType.findAll({ where: { hotel_id: req.user } });
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { taxtTypes }, STATUSCODE.SUCCESS));
    } catch (err) {
        console.error("[tax] getTaxtType error:", err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

const createTaxType = async (req, res) => {
    try {
        const { tax_name, tax_value, amount, order_type, menu_ids, table_categ_ids } = req.body;
        const checkName = await TaxType.findOne({ where: { tax_name, hotel_id: req.user } });
        if (checkName) return res.json(error("This Tax Name Are Already Exist", STATUSCODE.BAD_REQUEST));
        await TaxType.create({ tax_name, tax_value, amount, order_type, menu_ids, table_categ_ids, hotel_id: req.user });
        emitConfigChanged(req.user, ["taxTypes"]);
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { message: "Tax Type Created Successfully" }, STATUSCODE.SUCCESS));
    } catch (err) {
        console.error("[tax] createTaxType error:", err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

// Only the fields actually sent are changed - but "sent" means present, not
// truthy. This used to copy uat-backend-v2's `if (active) ...` checks, which
// silently dropped every falsy value: a tax could never be switched OFF
// (active: false was ignored, and the Web POS switch flipped back on after
// the reload - owner report, 2026-09-22), and its order-type / menu /
// table-category limits could never be cleared back to "all" (an empty list
// was ignored the same way).
const editTaxType = async (req, res) => {
    try {
        const { tax_name, tax_value, amount, order_type, active, id, menu_ids, table_categ_ids } = req.body;
        const tax = await TaxType.findOne({ where: { id, hotel_id: req.user } });
        if (!tax) return res.json(error("Tax Type Not Found", STATUSCODE.BAD_REQUEST));

        const updateObject = {};
        if (tax_name !== undefined) {
            if (!String(tax_name).trim()) return res.json(error("Tax name is required", STATUSCODE.BAD_REQUEST));
            const clash = await TaxType.findOne({ where: { tax_name, hotel_id: req.user } });
            if (clash && clash.id !== tax.id) return res.json(error("This Tax Name Are Already Exist", STATUSCODE.BAD_REQUEST));
            updateObject.tax_name = tax_name;
        }
        if (tax_value !== undefined) {
            if (!["fix", "pr"].includes(tax_value)) return res.json(error("Tax type must be fixed or percentage", STATUSCODE.BAD_REQUEST));
            updateObject.tax_value = tax_value;
        }
        if (amount !== undefined) {
            const n = Number(amount);
            if (!Number.isFinite(n) || n < 0) return res.json(error("Tax amount must be 0 or more", STATUSCODE.BAD_REQUEST));
            updateObject.amount = n;
        }
        if (active !== undefined) updateObject.active = active === true || active === "true" || active === 1;
        if (Array.isArray(order_type)) updateObject.order_type = order_type;
        if (Array.isArray(menu_ids)) updateObject.menu_ids = menu_ids;
        if (Array.isArray(table_categ_ids)) updateObject.table_categ_ids = table_categ_ids;

        await TaxType.update(updateObject, { where: { id: tax.id, hotel_id: req.user } });
        // Every open screen re-reads taxes at once (the Captain App and
        // other Web POS tabs preview totals with them).
        emitConfigChanged(req.user, ["taxTypes"]);
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { message: "Tax Type Updated Successfully" }, STATUSCODE.SUCCESS));
    } catch (err) {
        console.error("[tax] editTaxType error:", err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

module.exports = { getTaxtType, createTaxType, editTaxType };
