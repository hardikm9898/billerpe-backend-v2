const { sequelize, CrmInquiry, CrmLeadV2 } = require("../../model");
const config = require("./config");
const { createLead, findByPhone, activity, reopen, recalc } = require("./leads");
const { syncNext, addTask } = require("./tasks");
const { assign, pickOwner, canTakeLeads } = require("./assign");
const { notify, peopleWith } = require("./notify");
const { normalizePhone, firstContactDue, txt } = require("./util");

// Every inbound inquiry (website form, Meta Lead Ads, WhatsApp, the sales
// app's "new caller") comes through receive(). The same Meta delivery is
// stored once (external_id). A number already in the CRM never makes a
// second lead: the inquiry joins the existing lead, a closed lead is
// reopened, and its owner is told to call back. Repeat inquiries are never
// dropped (the old website form ignored them).

const SOURCE_LABEL = { website: "the website", meta: "Meta ads", whatsapp: "WhatsApp", phone: "a phone call", referral: "a referral", manual: "manual entry", import: "an import" };

async function receive(input = {}) {
    const source = String(input.source || "website").slice(0, 20);
    const phone = normalizePhone(input.phone);
    const at = input.receivedAt ? new Date(input.receivedAt) : new Date();
    const inquiry = {
        source,
        external_id: input.externalId ? String(input.externalId).slice(0, 80) : null,
        name: txt(input.name, 120),
        phone: txt(input.phone, 40),
        email: txt(input.email, 120),
        message: txt(input.message, 1000),
        source_detail: input.sourceDetail ? JSON.stringify(input.sourceDetail) : null,
        received_at: at,
    };
    const r = await sequelize.transaction(async (t) => {
        if (inquiry.external_id) {
            const seen = await CrmInquiry.findOne({ where: { external_id: inquiry.external_id }, transaction: t });
            if (seen) return { leadId: seen.lead_id, repeat: true };
        }
        const existing = phone.valid ? await findByPhone(phone.key, t) : null;
        if (!existing) {
            const lead = await createLead({ fields: { name: inquiry.name, email: inquiry.email, ...(input.fields || {}) }, phone, source, sourceDetail: input.sourceDetail || null, message: inquiry.message, at }, t);
            await CrmInquiry.create({ ...inquiry, lead_id: lead.id }, { transaction: t });
            if (!lead.owner_id) {
                for (const p of await peopleWith("leads.assign")) {
                    await notify(p.id, { type: "lead.unassigned", title: `New lead with no owner: ${lead.name || lead.phone}`, body: `From ${SOURCE_LABEL[source] || source}. Nobody can take leads right now.`, link: `/leads/${lead.id}`, ref: `unassigned:${lead.id}` }, { transaction: t });
                }
            }
            return { leadId: lead.id, created: true };
        }

        // The number is known: join it to that lead.
        const c = await config.load();
        const lead = await CrmLeadV2.findOne({ where: { id: existing.id }, transaction: t, lock: t.LOCK.UPDATE });
        await CrmInquiry.create({ ...inquiry, lead_id: lead.id }, { transaction: t });
        const fill = {};
        if (!lead.name && inquiry.name) fill.name = inquiry.name;
        if (!lead.email && inquiry.email) fill.email = inquiry.email;
        if (Object.keys(fill).length) await lead.update(fill, { transaction: t });
        await activity(lead.id, "inquiry", null, `Enquired again through ${SOURCE_LABEL[source] || source}${inquiry.message ? `: ${inquiry.message}` : ""}`, { source, sourceDetail: input.sourceDetail || null }, t);

        if (!(await canTakeLeads(lead.owner_id))) {
            const pick = await pickOwner({ phoneKey: "", excludeLeadId: lead.id }, at);
            if (pick) await assign(lead, pick.id, { byId: null, reason: `${pick.reason} (previous owner cannot take leads)` }, t);
        }
        const kind = c.stageById.get(lead.stage_id)?.kind;
        const due = await firstContactDue(at);
        if (kind === "won") {
            await notify(lead.owner_id, { type: "lead.customer_inquiry", title: `Customer enquired again: ${lead.name || lead.phone}`, body: inquiry.message || `Through ${SOURCE_LABEL[source] || source}`, link: `/leads/${lead.id}`, ref: `inq:${lead.id}:${at.getTime()}` }, { transaction: t });
            return { leadId: lead.id, joined: true, customer: true };
        }
        if (kind === "lost") {
            await reopen(null, lead.id, { stageId: lead.first_contact_at ? c.stageByKey.get("contacted").id : c.stageByKey.get("new").id, next: { type: "call", dueAt: due, note: "Enquired again: call back" } }, { system: true, transaction: t, why: `Enquired again through ${SOURCE_LABEL[source] || source}` });
        } else {
            await addTask({ leadId: lead.id, ownerId: lead.owner_id, type: "call", dueAt: due, note: "Enquired again: call back", origin: "intake" }, t);
            await syncNext(lead.id, t);
        }
        await lead.update({ response_due_at: due }, { transaction: t });
        await recalc(lead, t);
        await notify(lead.owner_id, { type: "lead.inquiry", title: `${lead.name || lead.phone} enquired again`, body: inquiry.message || `Through ${SOURCE_LABEL[source] || source}. Call back.`, link: `/leads/${lead.id}`, ref: `inq:${lead.id}:${at.getTime()}` }, { transaction: t });
        return { leadId: lead.id, joined: true, reopened: kind === "lost" };
    });
    return r;
}

/** For callers that must never fail because of the CRM (website form, Meta webhook). */
async function receiveSafely(input) {
    try {
        return await receive(input);
    } catch (e) {
        console.error("[crm intake]", input && input.source, e && e.message);
        return null;
    }
}

module.exports = { receive, receiveSafely };
