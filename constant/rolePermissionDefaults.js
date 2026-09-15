// Ported verbatim from billerpe-pos-pro-v2/src/mock/data.ts's
// ROLE_PERMISSION_DEFAULTS / ROLE_SPECIAL_DEFAULTS - the seed values a
// brand-new hotel (or the migration backfill for existing hotels) starts
// with for model/rolePermissionDefault.js. Kept as plain JS objects since
// the backend can't import the frontend's TS module; if the frontend's
// defaults change, this file needs updating to match by hand.

const FULL = { view: true, create: true, edit: true, delete: true };
const VIEW = { view: true, create: false, edit: false, delete: false };
const EDIT = { view: true, create: true, edit: true, delete: false };
const NONE = { view: false, create: false, edit: false, delete: false };

const ALL_MODULES = [
    "dashboard", "biller", "keyboard-billing", "kds", "orders", "menu", "tables",
    "reservations", "users", "permissions", "reports", "expense",
    "stock-masters", "stock-transactions", "stock-recipes", "stock-reports",
    "cash-session", "ops-billing", "ops-hardware", "ops-experience", "ops-ledger",
    "system", "audit-log",
];

const fullRow = () => Object.fromEntries(ALL_MODULES.map((m) => [m, { ...FULL }]));

const ROLE_PERMISSION_DEFAULTS = {
    Owner: fullRow(),
    Manager: {
        dashboard: VIEW, biller: FULL, "keyboard-billing": FULL, kds: VIEW, orders: FULL,
        menu: FULL, tables: FULL, reservations: FULL, users: NONE, permissions: NONE,
        reports: VIEW, expense: EDIT, "stock-masters": VIEW, "stock-transactions": VIEW,
        "stock-recipes": VIEW, "stock-reports": VIEW, "cash-session": FULL, "ops-billing": VIEW,
        "ops-hardware": VIEW, "ops-experience": VIEW, "ops-ledger": FULL, system: NONE, "audit-log": VIEW,
    },
    Cashier: {
        dashboard: NONE, biller: EDIT, "keyboard-billing": EDIT, kds: NONE, orders: EDIT,
        menu: VIEW, tables: VIEW, reservations: NONE, users: NONE, permissions: NONE,
        reports: NONE, expense: EDIT, "stock-masters": NONE, "stock-transactions": NONE,
        "stock-recipes": NONE, "stock-reports": NONE, "cash-session": FULL, "ops-billing": NONE,
        "ops-hardware": NONE, "ops-experience": NONE, "ops-ledger": NONE, system: NONE, "audit-log": NONE,
    },
    Captain: {
        dashboard: NONE, biller: EDIT, "keyboard-billing": EDIT, kds: VIEW, orders: EDIT,
        menu: VIEW, tables: FULL, reservations: FULL, users: NONE, permissions: NONE,
        reports: NONE, expense: NONE, "stock-masters": NONE, "stock-transactions": NONE,
        "stock-recipes": NONE, "stock-reports": NONE, "cash-session": NONE, "ops-billing": NONE,
        "ops-hardware": NONE, "ops-experience": NONE, "ops-ledger": NONE, system: NONE, "audit-log": NONE,
    },
    "Kitchen Staff": {
        dashboard: NONE, biller: NONE, "keyboard-billing": NONE, kds: FULL, orders: NONE,
        menu: NONE, tables: NONE, reservations: NONE, users: NONE, permissions: NONE,
        reports: NONE, expense: NONE, "stock-masters": NONE, "stock-transactions": NONE,
        "stock-recipes": NONE, "stock-reports": NONE, "cash-session": NONE, "ops-billing": NONE,
        "ops-hardware": NONE, "ops-experience": NONE, "ops-ledger": NONE, system: NONE, "audit-log": NONE,
    },
    "Inventory Manager": {
        dashboard: NONE, biller: NONE, "keyboard-billing": NONE, kds: NONE, orders: NONE,
        menu: VIEW, tables: NONE, reservations: NONE, users: NONE, permissions: NONE,
        reports: NONE, expense: NONE, "stock-masters": FULL, "stock-transactions": FULL,
        "stock-recipes": FULL, "stock-reports": VIEW, "cash-session": NONE, "ops-billing": NONE,
        "ops-hardware": NONE, "ops-experience": NONE, "ops-ledger": NONE, system: NONE, "audit-log": NONE,
    },
    Accountant: {
        dashboard: VIEW, biller: NONE, "keyboard-billing": NONE, kds: NONE, orders: VIEW,
        menu: NONE, tables: NONE, reservations: NONE, users: NONE, permissions: NONE,
        reports: VIEW, expense: FULL, "stock-masters": NONE, "stock-transactions": VIEW,
        "stock-recipes": NONE, "stock-reports": VIEW, "cash-session": FULL, "ops-billing": VIEW,
        "ops-hardware": NONE, "ops-experience": NONE, "ops-ledger": FULL, system: NONE, "audit-log": VIEW,
    },
};

const ROLE_SPECIAL_DEFAULTS = {
    Owner: {
        "orders.editAfterKot": true, "orders.reopenSettled": true, "orders.deleteOrder": true,
        "tables.mergeTransfer": true, "system.remakeOrderSequence": true, "users.editPermissions": true,
    },
    Manager: {
        "orders.editAfterKot": true, "orders.reopenSettled": true, "orders.deleteOrder": true,
        "tables.mergeTransfer": true, "system.remakeOrderSequence": false, "users.editPermissions": false,
    },
    Cashier: {
        "orders.editAfterKot": false, "orders.reopenSettled": false, "orders.deleteOrder": false,
        "tables.mergeTransfer": false, "system.remakeOrderSequence": false, "users.editPermissions": false,
    },
    Captain: {
        "orders.editAfterKot": false, "orders.reopenSettled": false, "orders.deleteOrder": false,
        "tables.mergeTransfer": true, "system.remakeOrderSequence": false, "users.editPermissions": false,
    },
    "Kitchen Staff": {
        "orders.editAfterKot": false, "orders.reopenSettled": false, "orders.deleteOrder": false,
        "tables.mergeTransfer": false, "system.remakeOrderSequence": false, "users.editPermissions": false,
    },
    "Inventory Manager": {
        "orders.editAfterKot": false, "orders.reopenSettled": false, "orders.deleteOrder": false,
        "tables.mergeTransfer": false, "system.remakeOrderSequence": false, "users.editPermissions": false,
    },
    Accountant: {
        "orders.editAfterKot": false, "orders.reopenSettled": false, "orders.deleteOrder": false,
        "tables.mergeTransfer": false, "system.remakeOrderSequence": false, "users.editPermissions": false,
    },
};

const ROLES = Object.keys(ROLE_PERMISSION_DEFAULTS);

module.exports = { ROLES, ROLE_PERMISSION_DEFAULTS, ROLE_SPECIAL_DEFAULTS };
