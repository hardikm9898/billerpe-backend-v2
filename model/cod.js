const { DataTypes } = require("sequelize");
const sequelize = require("../connection/connect");

// India Post cash on delivery (owner 2026-10-09). A parcel goes by India
// Post COD for (part of) an invoice; the post office later pays BillerPe one
// cheque for many parcels, less its charges. A remittance records that cheque
// with the parcels it covers; when an approver approves it, every invoice
// gets its COD payment. Schema owned by migration 20261018100000-cod; listed
// in server.js TABLES_TO_SKIP_ALTER.

const T = DataTypes;
const MONEY = () => ({ type: T.DECIMAL(12, 2), allowNull: false, defaultValue: 0 });

// status: booked (on its way / delivered, money not in yet) | remitting (on a
// remittance waiting for approval) | remitted | returned (came back unpaid).
const BilCodParcel = sequelize.define("bil_cod_parcel", {
    id: { type: T.INTEGER, primaryKey: true, autoIncrement: true },
    invoice_id: { type: T.INTEGER, allowNull: false },
    hotel_id: { type: T.INTEGER, allowNull: true },
    consignment: { type: T.STRING(40), allowNull: false, unique: "bil_cod_parcels_consignment" },
    amount: MONEY(),
    booked_on: { type: T.DATEONLY, allowNull: false },
    status: { type: T.STRING(10), allowNull: false, defaultValue: "booked" },
    remit_id: { type: T.INTEGER, allowNull: true },
    move_id: { type: T.INTEGER, allowNull: true },
    note: { type: T.STRING(300), allowNull: false, defaultValue: "" },
    created_by: { type: T.INTEGER, allowNull: true },
}, { tableName: "bil_cod_parcels", indexes: [{ fields: ["status"], name: "bil_cod_parcels_status" }, { fields: ["invoice_id"], name: "bil_cod_parcels_invoice" }] });

// One cheque (or transfer) from India Post. status: pending | approved | rejected.
// amount = what reached BillerPe; charges = parcels' total - amount (post charges).
const BilCodRemit = sequelize.define("bil_cod_remit", {
    id: { type: T.INTEGER, primaryKey: true, autoIncrement: true },
    reference: { type: T.STRING(60), allowNull: false },
    received_on: { type: T.DATEONLY, allowNull: false },
    amount: MONEY(),
    parcels_total: MONEY(),
    charges: MONEY(),
    proof: { type: T.STRING(500), allowNull: true },
    note: { type: T.STRING(300), allowNull: false, defaultValue: "" },
    status: { type: T.STRING(10), allowNull: false, defaultValue: "pending" },
    created_by: { type: T.INTEGER, allowNull: true },
    decided_by: { type: T.INTEGER, allowNull: true },
    decided_at: { type: T.DATE, allowNull: true },
    reject_reason: { type: T.STRING(200), allowNull: false, defaultValue: "" },
}, { tableName: "bil_cod_remits", indexes: [{ fields: ["status"], name: "bil_cod_remits_status" }] });

module.exports = { BilCodParcel, BilCodRemit };
