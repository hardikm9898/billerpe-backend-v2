const { Op } = require("sequelize");
const { sequelize, CrmWaTemplate, CrmWaMessage } = require("../../model");
const { RuleError } = require("../../appv1/core");
const audit = require("../audit");
const { need } = require("../auth");
const { txt, parse } = require("./util");

// WhatsApp templates. Meta approves each template's text in the WhatsApp
// Manager; here we keep its exact name and language (what the API needs), a
// copy of the approved text for the panel, and what fills each {{n}}.

const SOURCES = ["lead.name", "lead.restaurant", "owner.name", "owner.mobile", "custom"];

function view(t, sent = 0) {
    return { id: t.id, name: t.name, language: t.language, category: t.category, body: t.body || "", params: parse(t.params) || [], headerImage: t.header_image || "", active: !!t.active, sent30d: sent };
}

async function list(s, { all = false } = {}) {
    if (!s.can("inbox.use") && !s.can("inbox.all") && !s.can("automation.manage") && !s.can("leads.edit")) throw new RuleError("You do not have permission for this.");
    const rows = await CrmWaTemplate.findAll({ where: all && s.can("automation.manage") ? {} : { active: true }, order: [["name", "ASC"]] });
    const since = new Date(Date.now() - 30 * 86400000);
    const counts = new Map((await CrmWaMessage.findAll({ where: { kind: "template", at: { [Op.gte]: since }, template_id: { [Op.ne]: null } }, attributes: ["template_id", [sequelize.fn("COUNT", sequelize.col("id")), "n"]], group: ["template_id"], raw: true })).map((r) => [r.template_id, Number(r.n)]));
    return { templates: rows.map((t) => view(t, counts.get(t.id) || 0)), sources: SOURCES };
}

async function save(s, input = {}) {
    need(s, "automation.manage");
    const name = txt(input.name, 80);
    if (!/^[a-z0-9_]{1,80}$/.test(name)) throw new RuleError("Write the template name exactly as in WhatsApp Manager: small letters, numbers and _ only.");
    const language = txt(input.language, 10) || "en";
    if (!/^[a-z]{2}(_[A-Z]{2})?$/.test(language)) throw new RuleError("Language code like en, en_US or hi.");
    const category = ["marketing", "utility"].includes(input.category) ? input.category : "marketing";
    const body = txt(input.body, 1024);
    const params = (Array.isArray(input.params) ? input.params : []).map((p, i) => {
        const source = SOURCES.includes(p.source) ? p.source : "custom";
        const value = txt(p.value, 200);
        if (source === "custom" && !value) throw new RuleError(`Value ${i + 1}: write the fixed text, or choose where it comes from.`);
        return { label: txt(p.label, 60) || `Value ${i + 1}`, source, value };
    });
    const used = [...new Set((body.match(/\{\{(\d+)\}\}/g) || []).map((m) => Number(m.slice(2, -2))))].sort((a, b) => a - b);
    if (body && used.length !== params.length) throw new RuleError(`The text has ${used.length} {{n}} place${used.length === 1 ? "" : "s"} but ${params.length} value${params.length === 1 ? " is" : "s are"} set.`);
    if (used.some((n, i) => n !== i + 1)) throw new RuleError("Number the places {{1}}, {{2}}, ... in order.");
    const headerImage = txt(input.headerImage, 500).replace(/ /g, "%20");
    // The old CRM's approved templates use http:// image links, and WhatsApp delivers them.
    if (headerImage && !/^https?:\/\/\S+$/.test(headerImage)) throw new RuleError("The header image must be a web link (https://...).");
    return sequelize.transaction(async (t) => {
        let row = input.id ? await CrmWaTemplate.findByPk(Number(input.id), { transaction: t }) : null;
        if (input.id && !row) throw new RuleError("This template no longer exists.");
        const dupe = await CrmWaTemplate.findOne({ where: { name, language, ...(row ? { id: { [Op.ne]: row.id } } : {}) }, transaction: t });
        if (dupe) throw new RuleError("A template with this name and language is already here.");
        const fields = { name, language, category, body: body || null, params: JSON.stringify(params), header_image: headerImage || null, active: input.active !== false };
        const before = row ? view(row) : null;
        if (row) await row.update(fields, { transaction: t });
        else row = await CrmWaTemplate.create({ ...fields, created_by: s.user.id }, { transaction: t });
        await audit.write(s, { action: input.id ? "template.update" : "template.create", entity: "crm_wa_template", entityId: row.id, summary: `${input.id ? "Changed" : "Added"} the WhatsApp template ${name}`, before, after: view(row) }, { transaction: t });
        return { id: row.id };
    }).then(async (r) => {
        await require("./cadences").linkDefaultTemplates();
        return r;
    });
}

module.exports = { list, save, view, SOURCES };
