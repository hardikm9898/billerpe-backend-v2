// What a SuperAdmin role may do. A role holds a list of these keys; "*"
// means every permission (the Admin role). Later phases add their keys
// here; the panel shows this catalog on the role editor.

const CATALOG = [
    { group: "Sales", key: "leads.view_own", label: "See own leads" },
    { group: "Sales", key: "leads.view_team", label: "See the team's leads" },
    { group: "Sales", key: "leads.view_all", label: "See every lead" },
    { group: "Sales", key: "leads.edit", label: "Work leads (calls, outcomes, notes, stages)" },
    { group: "Sales", key: "leads.assign", label: "Assign and reassign leads" },
    { group: "Sales", key: "leads.delete", label: "Delete and merge leads" },
    { group: "Sales", key: "leads.export", label: "Export leads" },
    { group: "Sales", key: "calls.listen_team", label: "Listen to the team's call recordings" },
    { group: "Inbox", key: "inbox.use", label: "Use the WhatsApp inbox" },
    { group: "Customers", key: "customers.view", label: "See customer accounts and outlets" },
    { group: "Customers", key: "customers.manage", label: "Onboarding, renewals and health follow-up" },
    { group: "Customers", key: "outlets.manage", label: "Switch plan and release outlet PCs" },
    { group: "Customers", key: "outlets.open_as", label: "Open an outlet as its owner (support login)" },
    { group: "Billing", key: "billing.view", label: "See invoices and payments" },
    { group: "Billing", key: "billing.manage", label: "Create invoices, record payments" },
    { group: "Billing", key: "billing.approve", label: "Approve payments, credit notes and refunds" },
    { group: "Support", key: "support.use", label: "Answer support tickets" },
    { group: "Admin", key: "automation.manage", label: "Edit automation rules and cadences" },
    { group: "Admin", key: "reports.view", label: "See reports" },
    { group: "Admin", key: "staff.manage", label: "Add and edit staff, teams and leave" },
    { group: "Admin", key: "roles.manage", label: "Edit roles and permissions" },
    { group: "Admin", key: "settings.manage", label: "Change settings" },
    { group: "Admin", key: "audit.view", label: "See the audit log" },
];

const KEYS = new Set(CATALOG.map((p) => p.key));

// The five roles every SuperAdmin starts with (design doc, Roles section).
// Created by ensureDefaultRoles(); is_system roles cannot be deleted.
const DEFAULT_ROLES = [
    { name: "Admin", description: "Everything, including settings, roles and approvals", permissions: ["*"] },
    {
        name: "Sales manager",
        description: "Own team's leads, assignment, automation, team reports",
        permissions: ["leads.view_own", "leads.view_team", "leads.edit", "leads.assign", "leads.export", "calls.listen_team", "inbox.use", "automation.manage", "reports.view", "customers.view"],
    },
    { name: "Sales executive", description: "Own leads and tasks, shared inbox", permissions: ["leads.view_own", "leads.edit", "inbox.use"] },
    {
        name: "Customer success",
        description: "Accounts, onboarding, renewals, payment links",
        permissions: ["customers.view", "customers.manage", "outlets.open_as", "billing.view", "billing.manage", "support.use", "inbox.use"],
    },
    { name: "Support", description: "Ticket queue and outlet status", permissions: ["customers.view", "support.use", "outlets.open_as", "inbox.use"] },
];

const parse = (txt) => {
    try {
        const v = JSON.parse(txt || "[]");
        return Array.isArray(v) ? v.map(String) : [];
    } catch {
        return [];
    }
};

/** Keeps only known keys (and "*"), sorted, without repeats. */
const clean = (list) => [...new Set((Array.isArray(list) ? list : []).map(String).filter((k) => k === "*" || KEYS.has(k)))].sort();

const can = (perms, key) => perms.includes("*") || perms.includes(key);

async function ensureDefaultRoles(AdmRole) {
    for (const r of DEFAULT_ROLES) {
        const row = await AdmRole.findOne({ where: { name: r.name } });
        if (!row) await AdmRole.create({ ...r, permissions: JSON.stringify(r.permissions), is_system: true });
    }
}

module.exports = { CATALOG, KEYS, DEFAULT_ROLES, parse, clean, can, ensureDefaultRoles };
