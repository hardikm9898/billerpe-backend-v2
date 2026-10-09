const { DataTypes } = require("sequelize");
const sequelize = require("../connection/connect");

// An outlet's setup, captured once when it is created (owner 2026-10-09):
// the plan from the catalog and for how long, what the plan includes
// (printers, rolls), the extras sold, the discount and the token payment.
// The outlet's first invoice is made from it; a plan longer than a year,
// more than one printer, a large discount or a free trial waits for an
// approver first (status "approval": the outlet is made on approval).
// Schema owned by migration 20261016100000-outlet-setup; listed in
// server.js TABLES_TO_SKIP_ALTER.

const T = DataTypes;

// status: approval | done | rejected. request = everything asked (outlet
// details, order, token with its stored proof, the owner's password hash).
// includes = [{ itemId, qty }] the plan gives free (allowance for sending).
// pay_by = full payment due (15 days); frozen_at = when the unpaid freeze began.
const CsOutletSetup = sequelize.define("cs_outlet_setup", {
    id: { type: T.INTEGER, primaryKey: true, autoIncrement: true },
    status: { type: T.STRING(10), allowNull: false, defaultValue: "approval" },
    source: { type: T.STRING(10), allowNull: false, defaultValue: "new" },
    hotel_id: { type: T.INTEGER, allowNull: true, unique: "cs_outlet_setups_hotel" },
    account_id: { type: T.INTEGER, allowNull: true },
    lead_id: { type: T.INTEGER, allowNull: true },
    outlet_name: { type: T.STRING(120), allowNull: false, defaultValue: "" },
    owner_mobile: { type: T.STRING(10), allowNull: false, defaultValue: "" },
    plan_item_id: { type: T.INTEGER, allowNull: true },
    plan_label: { type: T.STRING(120), allowNull: false, defaultValue: "" },
    years: { type: T.INTEGER, allowNull: false, defaultValue: 1 },
    includes: { type: T.TEXT, allowNull: true },
    request: { type: T.TEXT, allowNull: true },
    reasons: { type: T.TEXT, allowNull: true },
    total: { type: T.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
    token_amount: { type: T.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
    invoice_id: { type: T.INTEGER, allowNull: true },
    token_payment_id: { type: T.INTEGER, allowNull: true },
    pay_by: { type: T.DATE, allowNull: true },
    frozen_at: { type: T.DATE, allowNull: true },
    created_by: { type: T.INTEGER, allowNull: true },
    decided_by: { type: T.INTEGER, allowNull: true },
    decided_at: { type: T.DATE, allowNull: true },
    reject_reason: { type: T.STRING(200), allowNull: false, defaultValue: "" },
}, { tableName: "cs_outlet_setups", indexes: [{ fields: ["status"], name: "cs_outlet_setups_status" }] });

module.exports = { CsOutletSetup };
