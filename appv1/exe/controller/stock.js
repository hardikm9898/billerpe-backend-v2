// COPY of billerpe-local-exe/controller/stock.js for the POS App (Plan 2) -
// written by scripts/vendor-exe-for-appv1.py. Do not edit here: change the
// exe's file and re-run the script, so both plans keep the same rules.

const { Op } = require("sequelize");
const { Hotel, Unit, RawMaterial, StockInHand } = require("../model");
const { MESSAGE, STATUSCODE } = require("../../../constant/const");
const { success, error } = require("../../../responce/res");

// Ported from uat-backend-v2/controller/stock_Mangement/{unit,rawMaterial,
// stockInOut}.js. addUnit/editUnit/addRawMaterial/editRawMaterial below are
// the simple-CRUD half of that port; stockIn/stockOut/history live in
// services/stockMovements.js - split out because they touch running stock
// averages/history, not because the logic differs in kind.

const getAllUnit = async (req, res) => {
    try {
        const hotel = await Hotel.findOne({ where: { id: req.user } });
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST));
        const units = await Unit.findAll({ where: { hotel_id: req.user } });
        return res.status(STATUSCODE.SUCCESS).json(success("Unit Fetch Successfully", { units }, STATUSCODE.SUCCESS));
    } catch (err) {
        console.error("[stock] getAllUnit error:", err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

const getAllRawMaterial = async (req, res) => {
    try {
        const hotel = await Hotel.findOne({ where: { id: req.user } });
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST));
        const whereCondition = { hotel_id: req.user };
        if (req.query.search) {
            whereCondition.raw_material_name = { [Op.like]: `%${req.query.search}%` };
        }
        const rawMaterials = await RawMaterial.findAll({
            where: whereCondition,
            include: [
                { model: Unit, as: "purchaseUnit" },
                { model: Unit, as: "consumptionUnit" },
            ],
        });
        return res.status(STATUSCODE.SUCCESS).json(success("RawMaterial Fetch Successfully", { rawMaterials }, STATUSCODE.SUCCESS));
    } catch (err) {
        console.error("[stock] getAllRawMaterial error:", err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

const getStockInHand = async (req, res) => {
    try {
        const whereCondition = { hotel_id: req.user };
        if (req.query.search) {
            whereCondition.raw_material_name = { [Op.like]: `%${req.query.search}%` };
        }
        const stockInHand = await StockInHand.findAll({
            where: { hotel_id: req.user, deleted: false },
            include: {
                model: RawMaterial,
                where: whereCondition,
                required: true,
                include: [
                    { model: Unit, as: "purchaseUnit" },
                    { model: Unit, as: "consumptionUnit" },
                ],
            },
        });
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { stockInHand }, STATUSCODE.SUCCESS));
    } catch (err) {
        console.error("[stock] getStockInHand error:", err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

// Ported verbatim from uat-backend-v2/controller/stock_Mangement/unit.js's
// addUnit - same duplicate-name guard, same response shape (the full unit
// list back, matching how the frontend's unitApi.create expects to
// replace its whole local list from the response).
const addUnit = async (req, res) => {
    try {
        const hotel = await Hotel.findOne({ where: { id: req.user } });
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST));
        const { unitName: unit_name, shortName } = req.body;
        const existing = await Unit.findOne({ where: { unit_name, hotel_id: req.user } });
        if (existing) return res.json(error("Unit Name Has Already Taken", STATUSCODE.BAD_REQUEST));
        await Unit.create({ unit_name, shortName, hotel_id: req.user });
        const units = await Unit.findAll({ where: { hotel_id: req.user } });
        return res.status(STATUSCODE.CREATED).json(success("Unit Created", { units }, STATUSCODE.CREATED));
    } catch (err) {
        console.error("[stock] addUnit error:", err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

const editUnit = async (req, res) => {
    try {
        const hotel = await Hotel.findOne({ where: { id: req.user } });
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST));
        const { unitName: unit_name, shortName, id } = req.body;
        const unit = await Unit.findOne({ where: { id } });
        if (!unit) return res.json(error("Unit Not Found", STATUSCODE.BAD_REQUEST));
        await Unit.update({ unit_name, shortName, hotel_id: req.user }, { where: { id } });
        const units = await Unit.findAll({ where: { hotel_id: req.user } });
        return res.status(STATUSCODE.SUCCESS).json(success("Unit Updated Successfully", { units }, STATUSCODE.SUCCESS));
    } catch (err) {
        console.error("[stock] editUnit error:", err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

// Ported verbatim from uat-backend-v2/controller/stock_Mangement/
// rawMaterial.js's addRawMaterial/editRawMaterial - same duplicate-name
// guard, same "both units must already exist" check, and editRawMaterial's
// real business rule: once a raw material has any stock-in-hand recorded,
// its purchase unit / consumption unit / conversion qty can never change
// again (would silently corrupt every stock-value calculation already made
// against the old conversion factor) - reproduced exactly, not relaxed.
const addRawMaterial = async (req, res) => {
    try {
        const hotel = await Hotel.findOne({ where: { id: req.user } });
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST));
        const { raw_material_name, purchase_price, unit: unit_id, consumption_unit, conversion_qty, mini_stock_level, mini_stock_level_qty } = req.body;
        const existing = await RawMaterial.findOne({ where: { raw_material_name, hotel_id: req.user } });
        if (existing) return res.json(error("RawMaterial Name Has Already Taken", STATUSCODE.BAD_REQUEST));
        const findUnit = await Unit.findByPk(unit_id);
        const find2Unit = await Unit.findByPk(consumption_unit);
        if (!findUnit || !find2Unit) return res.json(error("Unit Not Found", STATUSCODE.BAD_REQUEST));
        await RawMaterial.create({ mini_stock_level, mini_stock_level_qty, raw_material_name, purchase_price, unit_id, hotel_id: req.user, consumption_unit, conversion_qty });
        const rawMaterials = await RawMaterial.findAll({ where: { hotel_id: req.user }, include: [{ model: Unit, as: "purchaseUnit" }, { model: Unit, as: "consumptionUnit" }] });
        return res.status(STATUSCODE.CREATED).json(success("RawMaterial Created", { rawMaterials }, STATUSCODE.CREATED));
    } catch (err) {
        console.error("[stock] addRawMaterial error:", err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

const editRawMaterial = async (req, res) => {
    try {
        const hotel = await Hotel.findOne({ where: { id: req.user } });
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST));
        const { raw_material_name, purchase_price, unit: unit_id, id, consumption_unit, conversion_qty, mini_stock_level, mini_stock_level_qty } = req.body;
        const rawMaterial = await RawMaterial.findOne({ where: { id } });
        if (!rawMaterial) return res.json(error("RawMaterial Not Found", STATUSCODE.BAD_REQUEST));
        const findUnit = await Unit.findByPk(unit_id);
        const fin2Unit = await Unit.findByPk(consumption_unit);
        if (!findUnit || !fin2Unit) return res.json(error("Unit Not Found", STATUSCODE.BAD_REQUEST));

        const check = await StockInHand.findOne({ where: { raw_material_id: id } });
        if (check) {
            if (check.available_stock_Consiompsion_qty > 0 && (rawMaterial.unit_id !== unit_id || rawMaterial.consumption_unit !== consumption_unit || rawMaterial.conversion_qty !== conversion_qty)) {
                if (rawMaterial.unit_id !== unit_id) {
                    return res.json(error("You can't change Purchase Unit of raw material after stock in", STATUSCODE.BAD_REQUEST));
                }
                if (rawMaterial.consumption_unit !== consumption_unit) {
                    return res.json(error("You can't change Consumption Unit of raw material after stock in", STATUSCODE.BAD_REQUEST));
                }
                if (rawMaterial.conversion_qty !== conversion_qty) {
                    return res.json(error("You can't change Conversion Qty of raw material after stock in", STATUSCODE.BAD_REQUEST));
                }
            }
        }
        await RawMaterial.update({ mini_stock_level, mini_stock_level_qty, raw_material_name, purchase_price, unit_id, consumption_unit, conversion_qty }, { where: { id } });
        const rawMaterials = await RawMaterial.findAll({ where: { hotel_id: req.user }, include: [{ model: Unit, as: "purchaseUnit" }, { model: Unit, as: "consumptionUnit" }] });
        return res.status(STATUSCODE.SUCCESS).json(success("RawMaterial Updated", { rawMaterials }, STATUSCODE.SUCCESS));
    } catch (err) {
        console.error("[stock] editRawMaterial error:", err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

// Stock Ledger (owner request, 2026-09-25): per raw material for a period -
// opening, purchased, used in orders, wastage, manual, closing - and the
// day-by-day movements of one material. Dates are business dates
// (YYYY-MM-DD, inclusive), from the stock journal (services/stockLedger.js).
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const getStockLedger = async (req, res) => {
    try {
        const { startDate, endDate } = req.query;
        if (!DATE.test(startDate || "") || !DATE.test(endDate || "") || startDate > endDate) {
            return res.json(error("startDate and endDate (YYYY-MM-DD, start not after end) are required", STATUSCODE.BAD_REQUEST));
        }
        const { ledgerSummary } = require("../../engine/stockLedger");
        return res.json(success(MESSAGE.SUCCESS, await ledgerSummary(req.user, startDate, endDate), STATUSCODE.SUCCESS));
    } catch (err) {
        console.error("[stock] getStockLedger error:", err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

const getStockLedgerDetail = async (req, res) => {
    try {
        const { startDate, endDate } = req.query;
        if (!DATE.test(startDate || "") || !DATE.test(endDate || "") || startDate > endDate) {
            return res.json(error("startDate and endDate (YYYY-MM-DD) are required", STATUSCODE.BAD_REQUEST));
        }
        const { ledgerDetail } = require("../../engine/stockLedger");
        const detail = await ledgerDetail(req.user, Number(req.params.rawMaterialId), startDate, endDate);
        if (!detail) return res.json(error("Raw material not found", STATUSCODE.NOT_FOUND));
        return res.json(success(MESSAGE.SUCCESS, detail, STATUSCODE.SUCCESS));
    } catch (err) {
        console.error("[stock] getStockLedgerDetail error:", err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

// Order-wise ingredient cost: every settled bill of the period with what its
// ingredients actually cost when it was sold (RawMaterialConsumption,
// written by the sale deduction) - the Web POS used to estimate this from
// recipe names for the last 30 bills it happened to have loaded.
const getOrderConsumption = async (req, res) => {
    try {
        const { startDate, endDate } = req.query;
        if (!DATE.test(startDate || "") || !DATE.test(endDate || "") || startDate > endDate) {
            return res.json(error("startDate and endDate (YYYY-MM-DD) are required", STATUSCODE.BAD_REQUEST));
        }
        const { Op, fn, col } = require("sequelize");
        const { Order, RawMaterialConsumption, Table } = require("../model");
        const orders = await Order.findAll({
            where: { hotel_id: req.user, deleted: false, payment: "success", business_date: { [Op.between]: [startDate, endDate] } },
            attributes: ["id", "bill_no", "business_date", "order_type", "totalAmount", "grandAmount", "TableId"],
            include: [{ model: Table, attributes: ["table_name"], required: false }],
            order: [["id", "DESC"]],
        });
        const costs = orders.length ? await RawMaterialConsumption.findAll({
            where: { hotel_id: req.user, status: "CONSUMED", order_id: orders.map((o) => o.id) },
            attributes: ["order_id", [fn("SUM", col("cost")), "cost"], [fn("COUNT", col("id")), "lines"]],
            group: ["order_id"], raw: true,
        }) : [];
        const costOf = new Map(costs.map((c) => [c.order_id, c]));
        const rows = orders.map((o) => {
            const revenue = Number(o.totalAmount) || 0;
            const cost = Math.round((Number(costOf.get(o.id)?.cost) || 0) * 100) / 100;
            return {
                order_id: o.id, bill_no: o.bill_no, business_date: o.business_date, order_type: o.order_type,
                table: o.hms_table_mst?.table_name ?? null, revenue, cost, costed: Boolean(costOf.get(o.id)),
                margin: revenue > 0 ? Math.round(((revenue - cost) / revenue) * 1000) / 10 : null,
            };
        });
        return res.json(success(MESSAGE.SUCCESS, { rows }, STATUSCODE.SUCCESS));
    } catch (err) {
        console.error("[stock] getOrderConsumption error:", err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

module.exports = { getAllUnit, getAllRawMaterial, getStockInHand, addUnit, editUnit, addRawMaterial, editRawMaterial, getStockLedger, getStockLedgerDetail, getOrderConsumption };
