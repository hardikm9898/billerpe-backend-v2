const { Op } = require("sequelize");
const { Hotel, CsAccount, CsTask, CsOnboardingItem } = require("../../model");
const { need } = require("../auth");
const { todayRange } = require("../crm/util");

// "Customers today" for the person who looks after accounts (My Day and
// Home): their open customer tasks and onboarding steps due by the end of
// today, overdue first.

async function counts(userId, now = new Date()) {
    const { end } = todayRange(now);
    const overdue = (await CsTask.count({ where: { owner_id: userId, status: "open", due_at: { [Op.lt]: now } } })) + (await CsOnboardingItem.count({ where: { owner_id: userId, done_at: null, due_at: { [Op.lt]: now } } }));
    const today = (await CsTask.count({ where: { owner_id: userId, status: "open", due_at: { [Op.gte]: now, [Op.lt]: end } } })) + (await CsOnboardingItem.count({ where: { owner_id: userId, done_at: null, due_at: { [Op.gte]: now, [Op.lt]: end } } }));
    return { overdue, today };
}

async function today(s) {
    need(s, "customers.manage");
    const now = new Date();
    const { end } = todayRange(now);
    const me = s.user.id;
    const tasks = await CsTask.findAll({ where: { owner_id: me, status: "open", due_at: { [Op.lt]: end } }, order: [["due_at", "ASC"]], limit: 200, raw: true });
    const steps = await CsOnboardingItem.findAll({ where: { owner_id: me, done_at: null, due_at: { [Op.lt]: end } }, order: [["due_at", "ASC"]], limit: 200, raw: true });
    const accIds = [...new Set([...tasks.map((x) => x.account_id), ...steps.map((x) => x.account_id)])];
    const hotelIds = [...new Set([...tasks.map((x) => x.hotel_id), ...steps.map((x) => x.hotel_id)].filter(Boolean))];
    const accs = new Map((accIds.length ? await CsAccount.findAll({ where: { id: accIds }, attributes: ["id", "name", "owner_mobile", "health"], raw: true }) : []).map((a) => [a.id, a]));
    const hotels = new Map((hotelIds.length ? await Hotel.findAll({ where: { id: hotelIds }, attributes: ["id", "hotel_name"], raw: true }) : []).map((h) => [h.id, h.hotel_name]));
    const acc = (id) => {
        const a = accs.get(id);
        return a ? { id: a.id, name: a.name, mobile: a.owner_mobile, health: a.health } : { id, name: `#${id}`, mobile: "", health: "grey" };
    };
    const items = [
        ...tasks.map((x) => ({ kind: "task", id: x.id, type: x.type, title: x.note || x.type, origin: x.origin, dueAt: x.due_at, account: acc(x.account_id), outlet: x.hotel_id ? hotels.get(x.hotel_id) || `#${x.hotel_id}` : null })),
        ...steps.map((x) => ({ kind: "step", id: x.id, type: "onboarding", title: x.title, origin: "onboarding", dueAt: x.due_at, account: acc(x.account_id), outlet: hotels.get(x.hotel_id) || `#${x.hotel_id}` })),
    ].sort((a, b) => new Date(a.dueAt) - new Date(b.dueAt));
    return {
        serverTime: now.toISOString(),
        overdue: items.filter((i) => new Date(i.dueAt) < now),
        later: items.filter((i) => new Date(i.dueAt) >= now),
    };
}

module.exports = { today, counts };
