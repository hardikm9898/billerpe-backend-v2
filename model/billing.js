const { DataTypes } = require("sequelize");
const sequelize = require("../connection/connect");

// BillerPe SuperAdmin phase 6: BillerPe's own billing - the catalog, GST
// invoices and credit notes (the panel is the invoice book, owner
// 2026-10-08), payments (PhonePe links checked with PhonePe, manual UPI /
// bank / cash with approval), renewals and the plan's 1-day grace. Schema
// owned by migration 20261012100000-create-billing; listed in server.js
// TABLES_TO_SKIP_ALTER. Money is in rupees with 2 decimals (DECIMAL).

const T = DataTypes;
// A new object per column: Sequelize writes the column name into it.
const MONEY = () => ({ type: T.DECIMAL(12, 2), allowNull: false, defaultValue: 0 });

// What BillerPe sells. kind: plan | addon | ebill | service. Hardware comes
// from the website's product list (hms_website_products), never from here.
// For a plan: product (LOCAL_SUITE | CLOUD_APP), days it adds, POS App devices.
const BilItem = sequelize.define("bil_item", {
    id: { type: T.INTEGER, primaryKey: true, autoIncrement: true },
    code: { type: T.STRING(30), allowNull: false, unique: "bil_items_code" },
    name: { type: T.STRING(80), allowNull: false },
    kind: { type: T.STRING(10), allowNull: false, defaultValue: "plan" },
    product: { type: T.STRING(20), allowNull: true },
    plan_name: { type: T.STRING(40), allowNull: true },
    price: MONEY(),
    days: { type: T.INTEGER, allowNull: true },
    devices: { type: T.INTEGER, allowNull: true },
    credits: { type: T.INTEGER, allowNull: true },
    sac: { type: T.STRING(8), allowNull: false, defaultValue: "997331" },
    gst_rate: { type: T.DECIMAL(5, 2), allowNull: false, defaultValue: 18 },
    sort: { type: T.INTEGER, allowNull: false, defaultValue: 0 },
    active: { type: T.BOOLEAN, allowNull: false, defaultValue: true },
}, { tableName: "bil_items" });

// One number series per document kind per financial year (GST rule).
// prefix BPE / BCN / BPR, fy "26-27", next = the next number to give.
const BilCounter = sequelize.define("bil_counter", {
    id: { type: T.INTEGER, primaryKey: true, autoIncrement: true },
    kind: { type: T.STRING(10), allowNull: false },
    fy: { type: T.STRING(5), allowNull: false },
    next: { type: T.INTEGER, allowNull: false, defaultValue: 1 },
}, { tableName: "bil_counters", indexes: [{ unique: true, fields: ["kind", "fy"], name: "bil_counters_kind_fy" }] });

// An invoice or credit note. status: draft | approval (discount above the
// limit, waits for an admin) | issued | part_paid | paid | cancelled.
// The bill-to and tax split are copied at issue time and never recomputed.
const BilInvoice = sequelize.define("bil_invoice", {
    id: { type: T.INTEGER, primaryKey: true, autoIncrement: true },
    kind: { type: T.STRING(12), allowNull: false, defaultValue: "invoice" },
    number: { type: T.STRING(20), allowNull: true, unique: "bil_invoices_number" },
    status: { type: T.STRING(10), allowNull: false, defaultValue: "draft" },
    account_id: { type: T.INTEGER, allowNull: true },
    hotel_id: { type: T.INTEGER, allowNull: true },
    renewal_id: { type: T.INTEGER, allowNull: true },
    hardware_order_id: { type: T.INTEGER, allowNull: true, unique: "bil_invoices_hardware" },
    credit_for_id: { type: T.INTEGER, allowNull: true },
    bill_name: { type: T.STRING(160), allowNull: false, defaultValue: "" },
    bill_gstin: { type: T.STRING(15), allowNull: false, defaultValue: "" },
    bill_address: { type: T.STRING(400), allowNull: false, defaultValue: "" },
    bill_mobile: { type: T.STRING(15), allowNull: false, defaultValue: "" },
    bill_email: { type: T.STRING(120), allowNull: false, defaultValue: "" },
    // Two-digit GST state code of the place of supply.
    supply_state: { type: T.STRING(2), allowNull: false, defaultValue: "" },
    subtotal: MONEY(),
    discount: MONEY(),
    discount_pct: { type: T.DECIMAL(5, 2), allowNull: false, defaultValue: 0 },
    discount_reason: { type: T.STRING(200), allowNull: false, defaultValue: "" },
    taxable: MONEY(),
    cgst: MONEY(),
    sgst: MONEY(),
    igst: MONEY(),
    round_off: MONEY(),
    total: MONEY(),
    paid: MONEY(),
    issued_at: { type: T.DATE, allowNull: true },
    due_at: { type: T.DATE, allowNull: true },
    paid_at: { type: T.DATE, allowNull: true },
    cancelled_at: { type: T.DATE, allowNull: true },
    cancel_reason: { type: T.STRING(200), allowNull: false, defaultValue: "" },
    approved_by: { type: T.INTEGER, allowNull: true },
    // The seller's details at issue time (GSTIN may still be the demo one).
    seller: { type: T.TEXT, allowNull: true },
    demo: { type: T.BOOLEAN, allowNull: false, defaultValue: false },
    // The plan changes etc. were applied (once) when it was paid.
    applied_at: { type: T.DATE, allowNull: true },
    note: { type: T.STRING(500), allowNull: false, defaultValue: "" },
    created_by: { type: T.INTEGER, allowNull: true },
}, {
    tableName: "bil_invoices",
    indexes: [{ fields: ["account_id", "status"], name: "bil_invoices_account" }, { fields: ["hotel_id"], name: "bil_invoices_hotel" }, { fields: ["status", "due_at"], name: "bil_invoices_status_due" }],
});

// A line. effect (JSON) = what paying it does: { plan: { product, planName,
// days, devices } } | { devices: n } | { credits: n } | { hardware: true }.
const BilInvoiceLine = sequelize.define("bil_invoice_line", {
    id: { type: T.INTEGER, primaryKey: true, autoIncrement: true },
    invoice_id: { type: T.INTEGER, allowNull: false },
    item_id: { type: T.INTEGER, allowNull: true },
    product_id: { type: T.INTEGER, allowNull: true },
    kind: { type: T.STRING(10), allowNull: false, defaultValue: "plan" },
    description: { type: T.STRING(200), allowNull: false },
    sac: { type: T.STRING(8), allowNull: false, defaultValue: "997331" },
    qty: { type: T.DECIMAL(10, 2), allowNull: false, defaultValue: 1 },
    unit_price: MONEY(),
    amount: MONEY(),
    gst_rate: { type: T.DECIMAL(5, 2), allowNull: false, defaultValue: 18 },
    period_from: { type: T.DATEONLY, allowNull: true },
    period_to: { type: T.DATEONLY, allowNull: true },
    effect: { type: T.TEXT, allowNull: true },
    sort: { type: T.INTEGER, allowNull: false, defaultValue: 0 },
}, { tableName: "bil_invoice_lines", updatedAt: false, indexes: [{ fields: ["invoice_id"], name: "bil_invoice_lines_invoice" }] });

// Money received against an invoice. method: phonepe | upi | bank | cash | card.
// status: pending (manual, waits for approval) | approved | rejected.
const BilPayment = sequelize.define("bil_payment", {
    id: { type: T.INTEGER, primaryKey: true, autoIncrement: true },
    number: { type: T.STRING(20), allowNull: true, unique: "bil_payments_number" },
    invoice_id: { type: T.INTEGER, allowNull: false },
    account_id: { type: T.INTEGER, allowNull: true },
    method: { type: T.STRING(10), allowNull: false },
    amount: MONEY(),
    reference: { type: T.STRING(80), allowNull: false, defaultValue: "" },
    proof: { type: T.STRING(500), allowNull: true },
    status: { type: T.STRING(10), allowNull: false, defaultValue: "pending" },
    received_on: { type: T.DATEONLY, allowNull: false },
    decided_by: { type: T.INTEGER, allowNull: true },
    decided_at: { type: T.DATE, allowNull: true },
    reject_reason: { type: T.STRING(200), allowNull: false, defaultValue: "" },
    link_id: { type: T.INTEGER, allowNull: true, unique: "bil_payments_link" },
    note: { type: T.STRING(300), allowNull: false, defaultValue: "" },
    created_by: { type: T.INTEGER, allowNull: true },
}, { tableName: "bil_payments", indexes: [{ fields: ["invoice_id"], name: "bil_payments_invoice" }, { fields: ["status"], name: "bil_payments_status" }] });

// A PhonePe payment link for an invoice. merchant_order_id starts with
// "BPE" so the shared PhonePe webhook can tell ours from the old flows.
// A link is never trusted from a callback alone: its order status is read
// from PhonePe before the payment is recorded.
const BilPayLink = sequelize.define("bil_pay_link", {
    id: { type: T.INTEGER, primaryKey: true, autoIncrement: true },
    invoice_id: { type: T.INTEGER, allowNull: false },
    merchant_order_id: { type: T.STRING(40), allowNull: false, unique: "bil_pay_links_merchant" },
    phonepe_order_id: { type: T.STRING(60), allowNull: true },
    url: { type: T.STRING(1000), allowNull: false, defaultValue: "" },
    amount: MONEY(),
    state: { type: T.STRING(12), allowNull: false, defaultValue: "PENDING" },
    expires_at: { type: T.DATE, allowNull: true },
    checked_at: { type: T.DATE, allowNull: true },
    detail: { type: T.TEXT, allowNull: true },
    created_by: { type: T.INTEGER, allowNull: true },
}, { tableName: "bil_pay_links", indexes: [{ fields: ["invoice_id"], name: "bil_pay_links_invoice" }, { fields: ["state"], name: "bil_pay_links_state" }] });

// One renewal per outlet per plan end. stage: upcoming | contacted |
// invoiced | paid | churned. The 1-day grace (owner 2026-10-08) is used at
// most once per renewal; ends_on keeps the paid-up end, without the grace.
const CsRenewal = sequelize.define("cs_renewal", {
    id: { type: T.INTEGER, primaryKey: true, autoIncrement: true },
    hotel_id: { type: T.INTEGER, allowNull: false },
    account_id: { type: T.INTEGER, allowNull: true },
    ends_on: { type: T.DATE, allowNull: false },
    stage: { type: T.STRING(10), allowNull: false, defaultValue: "upcoming" },
    owner_id: { type: T.INTEGER, allowNull: true },
    invoice_id: { type: T.INTEGER, allowNull: true },
    reminded_at: { type: T.DATE, allowNull: true },
    remind_how: { type: T.STRING(10), allowNull: true },
    grace_used_at: { type: T.DATE, allowNull: true },
    grace_by: { type: T.STRING(40), allowNull: true },
    paid_at: { type: T.DATE, allowNull: true },
    churned_at: { type: T.DATE, allowNull: true },
    churn_reason: { type: T.STRING(200), allowNull: false, defaultValue: "" },
    note: { type: T.STRING(300), allowNull: false, defaultValue: "" },
}, { tableName: "cs_renewals", indexes: [{ unique: true, fields: ["hotel_id", "ends_on"], name: "cs_renewals_hotel_end" }, { fields: ["stage", "ends_on"], name: "cs_renewals_stage" }, { fields: ["owner_id", "stage"], name: "cs_renewals_owner" }] });

module.exports = { BilItem, BilCounter, BilInvoice, BilInvoiceLine, BilPayment, BilPayLink, CsRenewal };
