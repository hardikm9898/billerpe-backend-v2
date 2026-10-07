const { Op } = require("sequelize");
const { CrmLeadV2, CrmTaskV2, CrmActivity, CrmCall, CrmWaChat, CrmWaMessage } = require("../../model");
const { NEXT_LABEL } = require("./config");

// Tasks are the single list of next actions (design doc: Data model). A
// lead's next_action_* columns are a copy of its earliest open task, kept by
// syncNext() after every change, so My Day and the lists are one indexed read.

async function syncNext(leadId, t) {
    const first = await CrmTaskV2.findOne({ where: { lead_id: leadId, status: "open" }, order: [["due_at", "ASC"], ["id", "ASC"]], transaction: t });
    await CrmLeadV2.update(
        first ? { next_action_at: first.due_at, next_action_type: first.type, next_action_note: (first.note || NEXT_LABEL[first.type] || "").slice(0, 200) } : { next_action_at: null, next_action_type: null, next_action_note: null },
        { where: { id: leadId }, transaction: t },
    );
    return first;
}

async function addTask({ leadId, ownerId = null, type = "call", dueAt, note = "", origin = "manual", createdBy = null }, t) {
    return CrmTaskV2.create({ lead_id: leadId, owner_id: ownerId, type, due_at: dueAt, note: String(note || "").slice(0, 300), origin, created_by: createdBy, status: "open" }, { transaction: t });
}

async function cancelOpen(leadId, t, exceptId = 0) {
    const [n] = await CrmTaskV2.update({ status: "cancelled", done_at: new Date() }, { where: { lead_id: leadId, status: "open", ...(exceptId ? { id: { [Op.ne]: exceptId } } : {}) }, transaction: t });
    return n;
}

async function openCount(leadId, t) {
    return CrmTaskV2.count({ where: { lead_id: leadId, status: "open" }, transaction: t });
}

/** Score inputs that need a query: spoken to, demo done. */
async function scoreFacts(leadId, t) {
    const reached = await CrmCall.count({ where: { lead_id: leadId, answered: true }, transaction: t });
    const replies = await CrmActivity.count({ where: { lead_id: leadId, type: "outcome", data: { [Op.like]: '%"reached":true%' } }, transaction: t });
    const demo = await CrmActivity.count({ where: { lead_id: leadId, type: "outcome", data: { [Op.like]: '%"demo_done"%' } }, transaction: t });
    // Work by a person moved from the old CRM (notes, status changes, calls) counts as contact too.
    const worked = await CrmActivity.count({ where: { lead_id: leadId, actor_id: { [Op.ne]: null }, legacy_id: { [Op.like]: "lb1a:%" }, type: ["note", "stage", "call"] }, transaction: t });
    // Writing to us on WhatsApp counts as interest, and as recent contact.
    const chats = (await CrmWaChat.findAll({ where: { lead_id: leadId }, attributes: ["id"], raw: true, transaction: t })).map((c) => c.id);
    const waIn = chats.length ? await CrmWaMessage.count({ where: { chat_id: chats, direction: "in", kind: { [Op.ne]: "reaction" } }, transaction: t }) : 0;
    const lastIn = chats.length ? await CrmWaMessage.max("at", { where: { chat_id: chats, direction: "in" }, transaction: t }) : null;
    return { reached: reached + replies + Math.min(worked, 3), demoDone: demo > 0, waReplies: waIn, lastReplyAt: lastIn || null };
}

module.exports = { syncNext, addTask, cancelOpen, openCount, scoreFacts };
