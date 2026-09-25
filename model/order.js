
const { Sequelize, DataTypes } = require('sequelize');
const sequelize = require("../connection/connect");
const User = require("./user");
const Table = require('./table');
const { MESSAGE, STATUS } = require('../constant/const');
const Hotel = require('./hotel');
const OrderDetails = require("../model/order_details");
const HotelUser = require('./hotelUser');
const moment = require("moment")

const Order = sequelize.define("hms_order_mst", {

    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    totalAmount: {
        type: DataTypes.DOUBLE,
        defaultValue: 0
    },
    gst: {
        type: DataTypes.DOUBLE,
        defaultValue: 0
    },
    grandAmount: {
        type: DataTypes.DOUBLE,
        defaultValue: 0
    },
    order_type: {
        type: DataTypes.STRING,
    },
    bill_no: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: '0000'
    },
    isOffline: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    // The exe's own Order.id for this same order, once it's been pushed at
    // least once - see controller/offline/offline.js's
    // syncOrderDataWithDataBase and migration 20260910130000. Paired with
    // hotel_id as the real idempotency key for a repeat push, now that a
    // first-time sync can assign a brand new bill_no instead of keeping the
    // exe's "OFF#" placeholder forever - bill_no itself is no longer safe
    // to match a retry against once it can change out from under it.
    local_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
    },
    payment: {
        type: DataTypes.STRING,
        defaultValue: STATUS.PENDING
    },
    status: {
        type: DataTypes.STRING,
        defaultValue: STATUS.DISPATCH
    },
    payment_type: {
        type: DataTypes.STRING,
        defaultValue: null
    },
    cash: {
        type: DataTypes.DOUBLE,
        defaultValue: 0
    },
    upi: {
        type: DataTypes.DOUBLE,
        defaultValue: 0
    },
    card: {
        type: DataTypes.DOUBLE,
        defaultValue: 0
    },
    due: {
        type: DataTypes.DOUBLE,
        defaultValue: 0
    },
    // Amounts paid with the outlet's own payment modes (Paytm, ...), synced
    // from the exe (billerpe-local-exe/helpers/otherPayments.js): JSON
    // [{ name, amount }] and their total.
    other_payments: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    // When the bill was generated on the exe - what the bill itself shows
    // (billerpe-local-exe/helpers/orderTotals.js#stampBilledAt). createdAt is
    // when the table was opened, a different day for an overnight table.
    billed_at: {
        type: DataTypes.DATE,
        allowNull: true
    },
    other_amount: {
        type: DataTypes.DOUBLE,
        defaultValue: 0
    },
    // Waiter service tip - entered at settlement, deliberately NOT part of
    // the cash+upi+card+due=amount reconciliation (settleBills' own
    // validation): a tip is an extra amount on top of the bill, often
    // handed over separately from however the bill itself got paid, and
    // forcing it through that same equation would make it impossible to
    // log a cash tip against a UPI-paid bill. Attributed to the order's
    // own hotelUserId (the waiter who took the order), not whoever happens
    // to be logged in at settle time - matches how tips are actually
    // meant in a restaurant (for the person who served the table).
    tip: {
        type: DataTypes.DOUBLE,
        defaultValue: 0
    },
    // Owner-visible "reprinted N times" counter (Task 5) - incremented only
    // by the exe's explicit "Reprint bill" action, never the first
    // bill-generation print, and synced up from the exe's own local count
    // (billerpe-local-exe/model/order.js's own comment) rather than
    // incremented here directly, since the exe is where every real print
    // happens.
    billPrintCount: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    },
    total_sgst: {
        type: DataTypes.DOUBLE,
        defaultValue: 0
    },
    total_cgst: {
        type: DataTypes.DOUBLE,
        defaultValue: 0
    },
    deleted: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    totalDiscount: {
        type: DataTypes.DOUBLE,
        defaultValue: 0
    },
    discount_reason: {
        type: DataTypes.STRING,
        defaultValue: ""
    },
    discount_value: {
        type: DataTypes.FLOAT,
        defaultValue: 0
    },
    version:{
        type:DataTypes.INTEGER,
        defaultValue:0
    },
    discount_type: {
        type: DataTypes.ENUM,
        values: ['fix', 'pr'],
        defaultValue: 'fix'
    },
    token: { type: DataTypes.INTEGER, defaultValue: 0 },
    created_from: {
        type: DataTypes.STRING,
        defaultValue: "web"
    },
    tableTime: { type: DataTypes.DATE, defaultValue: new Date() },
    table_time_sated: { type: DataTypes.BOOLEAN, defaultValue: false },
    timeOver: {
        type: DataTypes.BOOLEAN, defaultValue: false
    },
    service_charge: {
        type: DataTypes.DOUBLE,
        defaultValue: 0
    },
    // Delivery/packaging charges (settings/billing.tsx's DeliveryChargeRule/
    // PackagingChargeRule) were computed client-side and folded straight
    // into grandAmount, with nowhere of their own to persist to - invisible
    // on the cloud-rendered e-bill webview (getBillViewData) even when
    // configured and actually charged. Same DOUBLE/defaultValue(0)
    // convention as service_charge above, which they sit alongside in
    // every cart payload (see mock/store.tsx's orderTotals).
    delivery_charge: {
        type: DataTypes.DOUBLE,
        defaultValue: 0
    },
    packaging_charge: {
        type: DataTypes.DOUBLE,
        defaultValue: 0
    },
    business_date: {
        type: DataTypes.DATEONLY,
        defaultValue: () => moment().format("YYYY-MM-DD"),
        index: true
    },
    // Bill engine inputs/outputs persisted with the order (same columns as
    // billerpe-local-exe). Written by Plan 2 (/app/v1); the exe's push
    // carries them too.
    roundOff: { type: DataTypes.DOUBLE, defaultValue: 0 },
    packaging_override: { type: DataTypes.DOUBLE, allowNull: true },
    service_override: { type: DataTypes.DOUBLE, allowNull: true },
    // POS App (Plan 2): guests, the order's menu, pickup ready time.
    guests: { type: DataTypes.INTEGER, defaultValue: 0 },
    menu_catalog_id: { type: DataTypes.INTEGER, allowNull: true },
    token_ready_at: { type: DataTypes.DATE, allowNull: true }
},
    {
        indexes: [
            { fields: ["hotel_id", "business_date"] },             // existing — date-range queries
            { fields: ["hotel_id", "payment", "deleted"] },        // dashboard sum/count (most critical)
            { fields: ["hotel_id", "order_type", "payment"] },     // dine-in / pickup breakdown
            { fields: ["hotel_id", "status", "deleted"] },         // active order listing
            { fields: ["TableId", "payment"] },                    // table-level order lookups
        ],
        hooks: {
            beforeValidate(order) {
                if (
                    order.discount_type === 'fix' &&
                    (!order.discount_value || order.discount_value === 0)
                ) {
                    order.discount_value = order.totalDiscount;
                }
            },

            // fires when Order.update() static method is used
            beforeBulkUpdate(options) {
                options.attributes.version = sequelize.literal('version + 1');
            },
            beforeUpdate(order) {
                if (
                    order.discount_type === 'fix' &&
                    (!order.discount_value || order.discount_value === 0)
                ) {
                    order.discount_value = order.totalDiscount;
                }
                order.version = sequelize.literal('version + 1');
            },

        }
    }
)



module.exports = Order