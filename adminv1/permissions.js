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
    { group: "Inbox", key: "inbox.use", label: "Use the WhatsApp inbox (chats of the leads they see)" },
    { group: "Inbox", key: "inbox.all", label: "See every chat: guests, customers, unknown numbers" },
    { group: "Inbox", key: "campaigns.send", label: "Send WhatsApp campaigns" },
    { group: "Customers", key: "customers.view", label: "See customer accounts and outlets" },
    { group: "Customers", key: "customers.manage", label: "Onboarding, renewals and health follow-up" },
    { group: "Customers", key: "outlets.manage", label: "Switch plan and release outlet PCs" },
    { group: "Customers", key: "outlets.open_as", label: "Open an outlet as its owner (support login)" },
    { group: "Billing", key: "billing.view", label: "See invoices and payments" },
    { group: "Billing", key: "billing.manage", label: "Create invoices, record payments" },
    { group: "Billing", key: "billing.approve", label: "Approve payments, credit notes and refunds" },
    { group: "Support", key: "support.use", label: "Answer support tickets" },
    { group: "Support", key: "support.manage", label: "Assign tickets to others; told when a ticket is late" },
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
        permissions: ["leads.view_own", "leads.view_team", "leads.edit", "leads.assign", "leads.export", "calls.listen_team", "inbox.use", "campaigns.send", "automation.manage", "reports.view", "customers.view"],
    },
    { name: "Sales executive", description: "Own leads and tasks, shared inbox", permissions: ["leads.view_own", "leads.edit", "inbox.use"] },
    {
        name: "Customer success",
        description: "Accounts, onboarding, renewals, payment links",
        permissions: ["customers.view", "customers.manage", "outlets.open_as", "billing.view", "billing.manage", "support.use", "inbox.use", "inbox.all"],
    },
    { name: "Support", description: "Ticket queue and outlet status", permissions: ["customers.view", "support.use", "outlets.open_as", "inbox.use", "inbox.all"] },
];

// Keys a later phase added to the built-in roles. Roles made before that
// phase get them once (adm_settings roles_version); a role someone edited
// keeps its other choices.
const UPGRADES = [{ version: 3, add: { "Sales manager": ["campaigns.send"], "Customer success": ["inbox.all"], Support: ["inbox.all"] } }];

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
    await upgradeRoles();
}

async function upgradeRoles() {
    const { AdmRole, AdmSetting } = require("../model");
    const row = await AdmSetting.findOne({ where: { setting_key: "roles_version" } });
    const have = row ? Number(row.value) || 0 : 0;
    const todo = UPGRADES.filter((u) => u.version > have);
    if (!todo.length) return have;
    for (const u of todo) {
        for (const [name, keys] of Object.entries(u.add)) {
            const role = await AdmRole.findOne({ where: { name, is_system: true } });
            if (!role) continue;
            const now = parse(role.permissions);
            if (now.includes("*")) continue;
            await role.update({ permissions: JSON.stringify(clean([...now, ...keys])) });
        }
    }
    const version = Math.max(...todo.map((u) => u.version));
    if (row) await row.update({ value: String(version) });
    else await AdmSetting.create({ setting_key: "roles_version", value: String(version) });
    return version;
}

module.exports = { CATALOG, KEYS, DEFAULT_ROLES, parse, clean, can, ensureDefaultRoles, upgradeRoles };
