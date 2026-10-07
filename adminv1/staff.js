const bcrypt = require("bcrypt");
const { Op } = require("sequelize");
const { sequelize, AdmUser, AdmRole, AdmTeam, AdmLeave, AdmSession } = require("../model");
const { RuleError } = require("../appv1/core");
const perms = require("./permissions");
const audit = require("./audit");
const queue = require("../services/admin/queue");
const { need, mobile10, tempPassword } = require("./auth");

// Staff, roles, teams and leave days of BillerPe's own team (Settings ->
// Staff and roles). Every change is audited and emitted as an event.

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const txt = (v, n) => String(v ?? "").trim().slice(0, n);
const intOrNull = (v) => (v === null || v === undefined || v === "" ? null : Number.isInteger(Number(v)) ? Number(v) : NaN);

const PUBLIC_ATTRS = ["id", "name", "mobile", "email", "role_id", "team_id", "manager_id", "shift_start", "shift_end", "daily_lead_cap", "languages", "status", "must_change_password", "last_login_at", "createdAt"];

function staffView(u, roles, teams) {
    return {
        id: u.id,
        name: u.name,
        mobile: u.mobile,
        email: u.email,
        roleId: u.role_id,
        role: roles.get(u.role_id)?.name || "",
        teamId: u.team_id,
        team: u.team_id ? teams.get(u.team_id)?.name || "" : "",
        managerId: u.manager_id,
        shiftStart: u.shift_start,
        shiftEnd: u.shift_end,
        dailyLeadCap: u.daily_lead_cap,
        languages: u.languages,
        status: u.status,
        mustChangePassword: !!u.must_change_password,
        lastLoginAt: u.last_login_at,
        since: u.createdAt,
    };
}

async function lookups() {
    const roles = new Map((await AdmRole.findAll({ raw: true })).map((r) => [r.id, r]));
    const teams = new Map((await AdmTeam.findAll({ raw: true })).map((t) => [t.id, t]));
    return { roles, teams };
}

/** Everyone, with details (Settings -> Staff). */
async function list(s) {
    need(s, "staff.manage");
    const rows = await AdmUser.findAll({ attributes: PUBLIC_ATTRS, order: [["status", "ASC"], ["name", "ASC"]], raw: true });
    const { roles, teams } = await lookups();
    return { staff: rows.map((u) => staffView(u, roles, teams)) };
}

/** Names only, for pickers (assign to, manager): any signed-in person. */
async function people() {
    const rows = await AdmUser.findAll({ where: { status: "active" }, attributes: ["id", "name", "role_id", "team_id"], order: [["name", "ASC"]], raw: true });
    const { roles, teams } = await lookups();
    return { people: rows.map((u) => ({ id: u.id, name: u.name, role: roles.get(u.role_id)?.name || "", team: u.team_id ? teams.get(u.team_id)?.name || "" : "" })) };
}

/** True when another active person would still hold the "*" (Admin) permission. */
async function anotherFullAdmin(exceptUserId, transaction) {
    const roles = (await AdmRole.findAll({ raw: true, transaction })).filter((r) => perms.parse(r.permissions).includes("*")).map((r) => r.id);
    if (!roles.length) return false;
    const n = await AdmUser.count({ where: { role_id: roles, status: "active", id: { [Op.ne]: exceptUserId } }, transaction });
    return n > 0;
}

async function isFullAdminRole(roleId, transaction) {
    const r = await AdmRole.findOne({ where: { id: roleId }, raw: true, transaction });
    return !!r && perms.parse(r.permissions).includes("*");
}

/**
 * Adds or edits a person. A new person gets a temporary password, shown
 * once in the answer; they must change it at first login.
 */
async function save(s, input = {}) {
    need(s, "staff.manage");
    const id = Number(input.id) || 0;
    const fields = {
        name: txt(input.name, 80),
        mobile: mobile10(input.mobile),
        email: txt(input.email, 120).toLowerCase(),
        role_id: Number(input.roleId) || 0,
        team_id: intOrNull(input.teamId),
        manager_id: intOrNull(input.managerId),
        shift_start: input.shiftStart ? txt(input.shiftStart, 5) : null,
        shift_end: input.shiftEnd ? txt(input.shiftEnd, 5) : null,
        daily_lead_cap: intOrNull(input.dailyLeadCap),
        languages: txt(input.languages, 60),
    };
    if (!fields.name) throw new RuleError("Enter the person's name.");
    if (!fields.mobile) throw new RuleError("Enter a 10-digit mobile number.");
    if (fields.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.email)) throw new RuleError("The email address does not look right.");
    if (Number.isNaN(fields.team_id) || Number.isNaN(fields.manager_id) || Number.isNaN(fields.daily_lead_cap)) throw new RuleError("Check the team, manager and lead cap.");
    if (fields.daily_lead_cap !== null && (fields.daily_lead_cap < 0 || fields.daily_lead_cap > 1000)) throw new RuleError("New leads per day must be between 0 and 1000.");
    if ((fields.shift_start && !HHMM.test(fields.shift_start)) || (fields.shift_end && !HHMM.test(fields.shift_end))) throw new RuleError("Write shift times as HH:MM, for example 10:30.");
    if (fields.shift_start && fields.shift_end && fields.shift_start >= fields.shift_end) throw new RuleError("The shift must end after it starts.");
    if (!(await AdmRole.findOne({ where: { id: fields.role_id }, attributes: ["id"], raw: true }))) throw new RuleError("Choose a role.");
    if (fields.team_id && !(await AdmTeam.findOne({ where: { id: fields.team_id }, attributes: ["id"], raw: true }))) throw new RuleError("That team does not exist.");
    if (fields.manager_id) {
        if (fields.manager_id === id) throw new RuleError("A person cannot be their own manager.");
        const mgr = await AdmUser.findOne({ where: { id: fields.manager_id, status: "active" }, attributes: ["id"], raw: true });
        if (!mgr) throw new RuleError("Choose an active manager.");
    }
    const clash = await AdmUser.findOne({ where: { mobile: fields.mobile, ...(id ? { id: { [Op.ne]: id } } : {}) }, attributes: ["id", "name"], raw: true });
    if (clash) throw new RuleError(`${clash.name} already uses this mobile number.`);

    return sequelize.transaction(async (t) => {
        if (id) {
            const row = await AdmUser.findOne({ where: { id }, transaction: t, lock: t.LOCK.UPDATE });
            if (!row) throw new RuleError("This person no longer exists.");
            if (row.role_id !== fields.role_id && (await isFullAdminRole(row.role_id, t)) && !(await isFullAdminRole(fields.role_id, t)) && !(await anotherFullAdmin(row.id, t))) {
                throw new RuleError("At least one active person must keep the Admin role.");
            }
            const before = row.get({ plain: true });
            await row.update(fields, { transaction: t });
            await audit.write(s, { action: "staff.update", entity: "adm_user", entityId: row.id, summary: `Edited ${row.name}`, before, after: row }, { transaction: t });
            await queue.emit({ type: "staff.updated", entity: "adm_user", entityId: row.id, actorId: s.user.id }, { transaction: t });
            return { id: row.id };
        }
        const password = tempPassword();
        const row = await AdmUser.create({ ...fields, password_hash: await bcrypt.hash(password, 10), must_change_password: true, status: "active" }, { transaction: t });
        await audit.write(s, { action: "staff.create", entity: "adm_user", entityId: row.id, summary: `Added ${row.name}`, after: row }, { transaction: t });
        await queue.emit({ type: "staff.created", entity: "adm_user", entityId: row.id, actorId: s.user.id }, { transaction: t });
        return { id: row.id, temporaryPassword: password };
    });
}

/** Switch a login on or off. Off ends all their sessions. A reason is required to switch off. */
async function setStatus(s, id, active, reason) {
    need(s, "staff.manage");
    const n = Number(id) || 0;
    if (n === s.user.id) throw new RuleError("You cannot switch off your own login.");
    const why = txt(reason, 300);
    if (!active && !why) throw new RuleError("Write why this login is being switched off.");
    return sequelize.transaction(async (t) => {
        const row = await AdmUser.findOne({ where: { id: n }, transaction: t, lock: t.LOCK.UPDATE });
        if (!row) throw new RuleError("This person no longer exists.");
        const status = active ? "active" : "disabled";
        if (row.status === status) return { id: row.id, status };
        if (!active && (await isFullAdminRole(row.role_id, t)) && !(await anotherFullAdmin(row.id, t))) throw new RuleError("At least one active person must keep the Admin role.");
        await row.update({ status }, { transaction: t });
        if (!active) await AdmSession.update({ revoked_at: new Date(), push_token: null }, { where: { user_id: row.id, revoked_at: null }, transaction: t });
        await audit.write(s, { action: active ? "staff.enable" : "staff.disable", entity: "adm_user", entityId: row.id, summary: `${active ? "Switched on" : "Switched off"} ${row.name}`, reason: why }, { transaction: t });
        await queue.emit({ type: active ? "staff.enabled" : "staff.disabled", entity: "adm_user", entityId: row.id, actorId: s.user.id }, { transaction: t });
        return { id: row.id, status };
    });
}

/** New temporary password (shown once); ends all their sessions. */
async function resetPassword(s, id) {
    need(s, "staff.manage");
    const n = Number(id) || 0;
    if (n === s.user.id) throw new RuleError("Use Change password for your own login.");
    return sequelize.transaction(async (t) => {
        const row = await AdmUser.findOne({ where: { id: n }, transaction: t, lock: t.LOCK.UPDATE });
        if (!row) throw new RuleError("This person no longer exists.");
        const password = tempPassword();
        await row.update({ password_hash: await bcrypt.hash(password, 10), must_change_password: true }, { transaction: t });
        await AdmSession.update({ revoked_at: new Date(), push_token: null }, { where: { user_id: row.id, revoked_at: null }, transaction: t });
        await audit.write(s, { action: "staff.reset_password", entity: "adm_user", entityId: row.id, summary: `Reset the password of ${row.name}` }, { transaction: t });
        return { id: row.id, temporaryPassword: password };
    });
}

/* ------------------------------ roles ------------------------------ */

async function roles(s) {
    need(s, "roles.manage");
    const rows = await AdmRole.findAll({ order: [["is_system", "DESC"], ["name", "ASC"]], raw: true });
    const counts = await AdmUser.findAll({ attributes: ["role_id", [sequelize.fn("COUNT", sequelize.col("id")), "n"]], where: { status: "active" }, group: ["role_id"], raw: true });
    const byRole = new Map(counts.map((c) => [c.role_id, Number(c.n)]));
    return {
        roles: rows.map((r) => ({ id: r.id, name: r.name, description: r.description, permissions: perms.parse(r.permissions), system: !!r.is_system, people: byRole.get(r.id) || 0 })),
        catalog: perms.CATALOG,
    };
}

/** Role names for the staff form (any staff manager). */
async function roleNames(s) {
    need(s, "staff.manage");
    const rows = await AdmRole.findAll({ attributes: ["id", "name"], order: [["name", "ASC"]], raw: true });
    return { roles: rows };
}

async function saveRole(s, input = {}) {
    need(s, "roles.manage");
    const id = Number(input.id) || 0;
    const name = txt(input.name, 60);
    const description = txt(input.description, 200);
    const list = perms.clean(input.permissions);
    if (!name) throw new RuleError("Enter the role name.");
    if (!list.length) throw new RuleError("Give the role at least one permission.");
    const clash = await AdmRole.findOne({ where: { name, ...(id ? { id: { [Op.ne]: id } } : {}) }, attributes: ["id"], raw: true });
    if (clash) throw new RuleError("Another role already has this name.");
    return sequelize.transaction(async (t) => {
        if (id) {
            const row = await AdmRole.findOne({ where: { id }, transaction: t, lock: t.LOCK.UPDATE });
            if (!row) throw new RuleError("This role no longer exists.");
            if (row.is_system && row.name !== name) throw new RuleError("Built-in roles keep their name.");
            const wasFull = perms.parse(row.permissions).includes("*");
            if (wasFull && !list.includes("*")) {
                const others = (await AdmRole.findAll({ where: { id: { [Op.ne]: id } }, raw: true, transaction: t })).filter((r) => perms.parse(r.permissions).includes("*")).map((r) => r.id);
                const left = others.length ? await AdmUser.count({ where: { role_id: others, status: "active" }, transaction: t }) : 0;
                if (!left) throw new RuleError("At least one role used by an active person must keep every permission.");
            }
            const before = row.get({ plain: true });
            await row.update({ name, description, permissions: JSON.stringify(list) }, { transaction: t });
            await audit.write(s, { action: "role.update", entity: "adm_role", entityId: row.id, summary: `Edited role ${row.name}`, before, after: row }, { transaction: t });
            return { id: row.id };
        }
        const row = await AdmRole.create({ name, description, permissions: JSON.stringify(list), is_system: false }, { transaction: t });
        await audit.write(s, { action: "role.create", entity: "adm_role", entityId: row.id, summary: `Added role ${row.name}`, after: row }, { transaction: t });
        return { id: row.id };
    });
}

async function deleteRole(s, id) {
    need(s, "roles.manage");
    return sequelize.transaction(async (t) => {
        const row = await AdmRole.findOne({ where: { id: Number(id) || 0 }, transaction: t, lock: t.LOCK.UPDATE });
        if (!row) throw new RuleError("This role no longer exists.");
        if (row.is_system) throw new RuleError("Built-in roles cannot be deleted.");
        const users = await AdmUser.count({ where: { role_id: row.id }, transaction: t });
        if (users) throw new RuleError(`${users} ${users === 1 ? "person has" : "people have"} this role. Give them another role first.`);
        const before = row.get({ plain: true });
        await row.destroy({ transaction: t });
        await audit.write(s, { action: "role.delete", entity: "adm_role", entityId: before.id, summary: `Deleted role ${before.name}`, before }, { transaction: t });
        return {};
    });
}

/* ------------------------------ teams ------------------------------ */

async function teams(s) {
    need(s, "staff.manage");
    const rows = await AdmTeam.findAll({ order: [["name", "ASC"]], raw: true });
    return { teams: rows.map((t) => ({ id: t.id, name: t.name, managerId: t.manager_id, active: !!t.active })) };
}

async function saveTeam(s, input = {}) {
    need(s, "staff.manage");
    const id = Number(input.id) || 0;
    const name = txt(input.name, 60);
    const managerId = intOrNull(input.managerId);
    if (!name) throw new RuleError("Enter the team name.");
    if (Number.isNaN(managerId)) throw new RuleError("Choose the team's manager.");
    if (managerId && !(await AdmUser.findOne({ where: { id: managerId, status: "active" }, attributes: ["id"], raw: true }))) throw new RuleError("Choose an active manager.");
    const clash = await AdmTeam.findOne({ where: { name, ...(id ? { id: { [Op.ne]: id } } : {}) }, attributes: ["id"], raw: true });
    if (clash) throw new RuleError("Another team already has this name.");
    const fields = { name, manager_id: managerId, active: input.active !== false };
    return sequelize.transaction(async (t) => {
        if (id) {
            const row = await AdmTeam.findOne({ where: { id }, transaction: t });
            if (!row) throw new RuleError("This team no longer exists.");
            const before = row.get({ plain: true });
            await row.update(fields, { transaction: t });
            await audit.write(s, { action: "team.update", entity: "adm_team", entityId: row.id, summary: `Edited team ${row.name}`, before, after: row }, { transaction: t });
            return { id: row.id };
        }
        const row = await AdmTeam.create(fields, { transaction: t });
        await audit.write(s, { action: "team.create", entity: "adm_team", entityId: row.id, summary: `Added team ${row.name}`, after: row }, { transaction: t });
        return { id: row.id };
    });
}

/* ------------------------------ leave days ------------------------------ */

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Leave days from `from` (YYYY-MM-DD, default today) on. Own leave for anyone; everyone's with staff.manage. */
async function leaves(s, query = {}) {
    const all = s.can("staff.manage");
    const from = DATE.test(String(query.from || "")) ? query.from : new Date().toISOString().slice(0, 10);
    const where = { to_date: { [Op.gte]: from }, ...(all ? (query.userId ? { user_id: Number(query.userId) } : {}) : { user_id: s.user.id }) };
    const rows = await AdmLeave.findAll({ where, order: [["from_date", "ASC"]], raw: true });
    const names = new Map((await AdmUser.findAll({ where: { id: [...new Set(rows.map((r) => r.user_id))] }, attributes: ["id", "name"], raw: true })).map((u) => [u.id, u.name]));
    return { leaves: rows.map((r) => ({ id: r.id, userId: r.user_id, name: names.get(r.user_id) || "", from: r.from_date, to: r.to_date, note: r.note })) };
}

async function saveLeave(s, input = {}) {
    need(s, "staff.manage");
    const userId = Number(input.userId) || 0;
    const from = String(input.from || "");
    const to = String(input.to || input.from || "");
    const person = await AdmUser.findOne({ where: { id: userId }, attributes: ["id", "name"], raw: true });
    if (!person) throw new RuleError("Choose the person.");
    if (!DATE.test(from) || !DATE.test(to)) throw new RuleError("Choose the leave dates.");
    if (to < from) throw new RuleError("The leave must end on or after its first day.");
    return sequelize.transaction(async (t) => {
        const row = await AdmLeave.create({ user_id: userId, from_date: from, to_date: to, note: txt(input.note, 160), created_by: s.user.id }, { transaction: t });
        await audit.write(s, { action: "leave.create", entity: "adm_leave", entityId: row.id, summary: `Leave for ${person.name}, ${from} to ${to}`, after: row }, { transaction: t });
        await queue.emit({ type: "staff.leave_added", entity: "adm_user", entityId: userId, data: { from, to }, actorId: s.user.id }, { transaction: t });
        return { id: row.id };
    });
}

async function deleteLeave(s, id) {
    need(s, "staff.manage");
    return sequelize.transaction(async (t) => {
        const row = await AdmLeave.findOne({ where: { id: Number(id) || 0 }, transaction: t });
        if (!row) throw new RuleError("This leave no longer exists.");
        const before = row.get({ plain: true });
        const person = await AdmUser.findOne({ where: { id: before.user_id }, attributes: ["name"], raw: true, transaction: t });
        await row.destroy({ transaction: t });
        await audit.write(s, { action: "leave.delete", entity: "adm_leave", entityId: before.id, summary: `Removed leave of ${person ? person.name : "a person"}, ${before.from_date} to ${before.to_date}`, before }, { transaction: t });
        return {};
    });
}

module.exports = { list, people, save, setStatus, resetPassword, roles, roleNames, saveRole, deleteRole, teams, saveTeam, leaves, saveLeave, deleteLeave };
