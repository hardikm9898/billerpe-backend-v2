const { Op, UniqueConstraintError } = require("sequelize");
const { AdmNotification, AdmUser, AdmRole } = require("../../model");
const perms = require("../permissions");

// In-panel notifications (the bell). `ref` makes an event notify a person
// once, however often the code that sees it runs.

async function notify(userId, { type, title, body = "", link = "", ref = null }, opts = {}) {
    if (!userId) return null;
    try {
        const row = await AdmNotification.create(
            { user_id: userId, type: String(type).slice(0, 30), title: String(title).slice(0, 160), body: String(body).slice(0, 400), link: String(link).slice(0, 160), ref: ref ? String(ref).slice(0, 120) : null },
            { transaction: opts.transaction },
        );
        // Also to the person's phones (sales app), once the change is saved.
        const push = () => require("../push").toUser(userId, { title: row.title, body: row.body, link: row.link, type: row.type, id: row.id });
        if (opts.transaction) opts.transaction.afterCommit(() => void push());
        else void push();
        return row;
    } catch (e) {
        if (e instanceof UniqueConstraintError) return null;
        throw e;
    }
}

/** Everyone active whose role has `permission` (for unassigned leads etc.). */
async function peopleWith(permission) {
    const roles = (await AdmRole.findAll({ raw: true })).filter((r) => perms.can(perms.parse(r.permissions), permission)).map((r) => r.id);
    if (!roles.length) return [];
    return AdmUser.findAll({ where: { role_id: roles, status: "active" }, attributes: ["id", "name"], raw: true });
}

async function list(s, query = {}) {
    const where = { user_id: s.user.id };
    if (query.before) where.id = { [Op.lt]: Number(query.before) || 0 };
    if (query.unread) where.read_at = null;
    const rows = await AdmNotification.findAll({ where, order: [["id", "DESC"]], limit: 41, raw: true });
    const unread = await AdmNotification.count({ where: { user_id: s.user.id, read_at: null } });
    return {
        serverTime: new Date().toISOString(),
        unread,
        more: rows.length > 40,
        notifications: rows.slice(0, 40).map((n) => ({ id: n.id, type: n.type, title: n.title, body: n.body, link: n.link, at: n.createdAt, read: !!n.read_at })),
    };
}

async function unreadCount(s) {
    return { unread: await AdmNotification.count({ where: { user_id: s.user.id, read_at: null } }) };
}

async function markRead(s, ids) {
    const where = { user_id: s.user.id, read_at: null };
    if (ids !== "all") where.id = (Array.isArray(ids) ? ids : [ids]).map(Number).filter(Boolean);
    await AdmNotification.update({ read_at: new Date() }, { where });
    return unreadCount(s);
}

module.exports = { notify, peopleWith, list, unreadCount, markRead };
