// Scenario tests for the old-panel features brought into the new SuperAdmin
// (owner 2026-10-08: nothing the sales team had may go missing). One block
// per feature, added as each is built.
//
//   DATABASE_NAME=billerpe_app_test node scripts/test-parity.js
//
// Refuses to run unless the database name ends in "_test". Everything it
// makes carries a per-run stamp and is removed at the end.

require("dotenv").config();
if (!/_test$/.test(process.env.DATABASE_NAME || "")) {
    console.error("Refusing to run: DATABASE_NAME must end in _test");
    process.exit(1);
}
process.env.ADMIN_JWT_SECRET = process.env.ADMIN_JWT_SECRET || "parity-test-secret";
process.env.DISABLE_CRON = "1";
delete process.env.ADMIN_WA_LIVE;

const http = require("http");
const express = require("express");
const bcrypt = require("bcrypt");
const { Op } = require("sequelize");
const M = require("../model");
const { ensureDefaultRoles } = require("../adminv1/permissions");
const util = require("../adminv1/crm/util");
const intake = require("../adminv1/crm/intake");
const config = require("../adminv1/crm/config");

let passed = 0;
const failures = [];
function check(name, ok, detail) {
    if (ok) {
        passed += 1;
        console.log(`  ok   ${name}`);
    } else {
        failures.push(name);
        console.log(`  FAIL ${name}${detail !== undefined ? `  ${JSON.stringify(detail).slice(0, 500)}` : ""}`);
    }
}

const stamp = String(Date.now()).slice(-5);
const phone = (n) => `8${String(n).padStart(4, "0")}${stamp}`;
const PW = "Par-pass-1";
let base;
const post = async (path, body, token) => {
    const res = await fetch(`${base}${path}`, { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body || {}) });
    return { status: res.status, ...(await res.json().catch(() => ({}))) };
};
const call = (name, token, ...args) => post(`/${name}`, { args }, token);

const created = { users: [] };
const restore = { users: [], settings: [] };

async function person(name, roleName, extra = {}) {
    const roles = Object.fromEntries((await M.AdmRole.findAll({ raw: true })).map((r) => [r.name, r]));
    const u = await M.AdmUser.create({ name: `${name} ${stamp}`, mobile: `6${String(created.users.length + 50).padStart(3, "0")}${stamp}4`.slice(0, 10), role_id: roles[roleName].id, password_hash: await bcrypt.hash(PW, 4), must_change_password: false, ...extra });
    created.users.push(u.id);
    const r = await post("/login", { mobile: u.mobile, password: PW, device: { kind: "web", deviceId: `p-${u.id}`, name: "test" } });
    return { u, token: r.session.token };
}
const lead = (id) => M.CrmLeadV2.findByPk(id);

async function run() {
    await M.AdmSetting.destroy({ where: { setting_key: ["working_hours"] } });
    await M.AdmSetting.create({ setting_key: "working_hours", value: JSON.stringify({ days: [0, 1, 2, 3, 4, 5, 6], start: "00:00", end: "23:59", lunchMinutes: 60, teaBreaks: 2, teaMinutes: 15 }) });
    util.resetHoursCache();
    const admin = await person("Admin", "Admin");
    const mgr = await person("Manager", "Sales manager");
    const A = await person("ExecA", "Sales executive", { daily_lead_cap: 10, manager_id: mgr.u.id });
    const B = await person("ExecB", "Sales executive", { daily_lead_cap: 10, manager_id: mgr.u.id });
    const X = await person("Outsider", "Sales executive", { daily_lead_cap: null });

    console.log("\nBulk assign (old panel: bulk-select + bulk-assign)");
    const ids = [];
    for (let i = 1; i <= 6; i++) ids.push((await intake.receive({ source: "website", name: `Bulk ${i}`, phone: phone(i), message: "test" })).leadId);
    let r = await call("leadsAssign", A.token, ids.slice(0, 2), B.u.id);
    check("a salesperson cannot bulk assign", !r.ok, r);
    r = await call("leadsAssign", mgr.token, ids.slice(0, 3), B.u.id, "Covering for A");
    check("manager gives 3 leads to B", r.ok && r.result.assigned === 3 && (await lead(ids[0])).owner_id === B.u.id && (await lead(ids[2])).owner_id === B.u.id, r);
    const hist = await M.CrmAssignment.findOne({ where: { lead_id: ids[0], to_id: B.u.id }, order: [["id", "DESC"]] });
    check("each move is recorded with the reason, and B is told", hist && /Covering for A/.test(hist.reason) && (await M.AdmNotification.count({ where: { user_id: B.u.id, type: "lead.assigned" } })) >= 3);
    const task = await M.CrmTaskV2.findOne({ where: { lead_id: ids[0], status: "open" } });
    check("open tasks move with the lead", task && task.owner_id === B.u.id);
    r = await call("leadsAssign", mgr.token, ids.slice(3, 4), X.u.id);
    check("a manager cannot give leads outside the team", !r.ok && /own team/.test(r.error), r);
    r = await call("leadsAssign", mgr.token, ids.slice(3, 6), "auto");
    const autoOwners = (await M.CrmLeadV2.findAll({ where: { id: ids.slice(3, 6) }, raw: true })).map((l) => l.owner_id);
    check("round-robin bulk: each lead gets a rotation person", r.ok && r.result.assigned === 3 && autoOwners.every((o) => [A.u.id, B.u.id].includes(o)), [r, autoOwners]);
    r = await call("leadsAssign", admin.token, [], B.u.id);
    check("nothing chosen: refused", !r.ok);
    r = await call("leadsAssign", admin.token, Array.from({ length: 201 }, (_, i) => i + 1), B.u.id);
    check("at most 200 at a time", !r.ok && /200/.test(r.error));

    console.log("\nPayment tracking on a lead (old panel: Payment tab)");
    const pid = ids[5];
    const owner = (await lead(pid)).owner_id;
    const ownerTok = owner === A.u.id ? A.token : B.token;
    r = await call("leadUpdate", ownerTok, pid, { dealAmount: "11,999", payDueOn: "2026-11-02", payRef: "UPI from owner" });
    let d = await call("lead", ownerTok, pid);
    check("proposal amount, due date and reference saved (commas accepted)", r.ok && d.result.lead.dealAmount === 11999 && d.result.lead.payDueOn === "2026-11-02" && d.result.lead.payRef === "UPI from owner", [r, d.ok && d.result.lead.dealAmount]);
    r = await call("leadUpdate", ownerTok, pid, { agreedAmount: 10500 });
    d = await call("lead", ownerTok, pid);
    check("agreed amount saved; the timeline says what changed", r.ok && d.result.lead.agreedAmount === 10500 && d.result.timeline.some((t) => t.type === "edit" && /agreed amount/.test(t.body)));
    const edits = d.result.timeline.filter((t) => t.type === "edit").length;
    await call("leadUpdate", ownerTok, pid, { agreedAmount: "10500" });
    d = await call("lead", ownerTok, pid);
    check("saving the same amount again changes nothing", d.result.timeline.filter((t) => t.type === "edit").length === edits);
    r = await call("leadUpdate", ownerTok, pid, { dealAmount: "abc" });
    check("a wrong amount is refused", !r.ok && /rupees/.test(r.error), r);
    r = await call("leadUpdate", ownerTok, pid, { payDueOn: "2 Nov" });
    check("a wrong date is refused", !r.ok);
    r = await call("pipeline", admin.token, { owner: "all" });
    const col = r.ok && r.result.columns.find((c) => c.leads.some((l) => l.id === pid) || c.count > 0);
    check("pipeline columns carry the deal value (agreed, else proposal)", r.ok && r.result.columns.every((c) => typeof c.value === "number") && r.result.columns.reduce((a, c) => a + c.value, 0) >= 10500, col && col.value);
    r = await call("leadUpdate", ownerTok, pid, { dealAmount: null, agreedAmount: "" });
    d = await call("lead", ownerTok, pid);
    check("amounts can be cleared", r.ok && d.result.lead.dealAmount === null && d.result.lead.agreedAmount === null);

    console.log("\nDemos list (old panel: Demos)");
    const c = await config.load();
    const did = ids[4];
    const dOwner = (await lead(did)).owner_id;
    const dTok = dOwner === A.u.id ? A.token : B.token;
    const inTwoHours = new Date(Date.now() + 2 * 3600000).toISOString();
    r = await call("leadOutcome", dTok, did, { outcomeId: c.outcomeByKey.get("demo_booked").id, note: "Online demo", next: { type: "demo", dueAt: inTwoHours, note: "Google Meet" } });
    check("a demo is booked on a lead", r.ok, r);
    r = await call("demos", mgr.token, { view: "upcoming" });
    const up = r.ok && r.result.demos.find((x) => x.lead && x.lead.id === did);
    check("the manager sees it under Coming up, with the lead and salesperson", up && up.status === "open" && up.note === "Google Meet" && up.lead.stage.name === "Demo" && r.result.counts.upcoming >= 1, r.ok ? r.result.counts : r);
    r = await call("demos", X.token, { view: "upcoming" });
    check("someone outside the team does not see it", r.ok && !r.result.demos.some((x) => x.lead && x.lead.id === did));
    await M.CrmTaskV2.update({ due_at: new Date(Date.now() - 3600000) }, { where: { lead_id: did, type: "demo", status: "open" } });
    r = await call("demos", mgr.token, { view: "overdue" });
    check("past its time and not logged: Not logged", r.ok && r.result.demos.some((x) => x.lead && x.lead.id === did));
    const doneRes = await call("leadOutcome", dTok, did, { outcomeId: c.outcomeByKey.get("demo_done").id, note: "Liked KOT", next: { type: "proposal", dueAt: new Date(Date.now() + 3600000).toISOString() } });
    r = await call("demos", mgr.token, { view: "done" });
    const dn = r.ok && r.result.demos.find((x) => x.lead && x.lead.id === did);
    check("logging Demo done moves it to Done with the outcome", dn && dn.status === "done" && dn.outcome === "Demo done", [doneRes, dn, await M.CrmTaskV2.findAll({ where: { lead_id: did }, raw: true, attributes: ["id", "type", "status", "due_at", "outcome_id"] })]);
    r = await call("demos", mgr.token, { view: "upcoming", ownerId: A.u.id === dOwner ? B.u.id : A.u.id });
    check("filter by salesperson", r.ok && !r.result.demos.some((x) => x.lead && x.lead.id === did));

    console.log("\nWhatsApp: bulk message to an uploaded list, new chats (old panel)");
    const XLSX = require("xlsx");
    const ws = XLSX.utils.aoa_to_sheet([["Customer Name", "Mobile No"], ["List One", phone(21)], ["List Two", `+91 ${phone(22)}`], ["Repeat", phone(21)], ["Bad", "12345"], ["Is a lead", phone(1)]]);
    const wbk = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wbk, ws, "S");
    r = await call("campaignReadNumbers", mgr.token, { fileBase64: XLSX.write(wbk, { type: "base64", bookType: "xlsx" }), fileName: "list.xlsx" });
    check("an Excel list is read: mobile + name columns found, repeats and bad numbers left out", r.ok && r.result.numbers.length === 3 && r.result.invalid === 1 && r.result.repeats === 1 && r.result.numbers[0].name === "List One", r);
    const listNumbers = r.ok ? r.result.numbers : [];
    r = await call("campaignReadNumbers", mgr.token, { text: `${phone(23)}, Pasted Name\n${phone(24)}` });
    check("pasted numbers work too", r.ok && r.result.numbers.length === 2 && r.result.numbers[0].name === "Pasted Name", r);
    r = await call("campaignReadNumbers", A.token, { text: phone(23) });
    check("only people who send campaigns", !r.ok);
    r = await call("campaignNumbersSample", mgr.token);
    check("the sample Excel file downloads", r.ok && r.result.base64.startsWith("UEsD"), r.ok);
    const tpl = await M.CrmWaTemplate.create({ name: `par_promo_${stamp}`, language: "en", category: "MARKETING", body: "Hi {{1}}, BillerPe Diwali offer.", params: JSON.stringify([{ name: "1", source: "lead.name" }]), active: true });
    created.templates = [tpl.id];
    // A number in the list that is a BillerPe customer still gets it; a restaurant's guest never does.
    await M.CrmWaChat.create({ phone: `91${phone(22)}`, phone_key: phone(22), name: "Cust", kind: "customer" });
    await M.CrmWaChat.create({ phone: `91${phone(23)}`, phone_key: phone(23), name: "Guest", kind: "guest" });
    r = await call("campaignSave", mgr.token, { name: `List ${stamp}`, templateId: tpl.id, values: [], perMinute: 60, audience: { kind: "numbers", numbers: [...listNumbers, { phone: phone(23), name: "Guest" }] } });
    const campId = r.ok && r.result.id;
    check("a campaign to an uploaded list saves", r.ok, r);
    r = await call("campaignPreview", mgr.token, { audience: { kind: "numbers", numbers: [...listNumbers, { phone: phone(23) }] } });
    check("preview: 4 numbers, 1 already a lead", r.ok && r.result.numbers === 4 && r.result.list.alreadyLeads === 1, r);
    r = await call("campaignStart", mgr.token, campId, {});
    check("started: every number queued", r.ok && r.result.total === 4, r);
    const wa = require("../adminv1/crm/wa");
    const sent = [];
    let waSeq = 0;
    wa.transport.send = async (body) => {
        sent.push(body);
        return { waId: `wamid.par.${stamp}.${++waSeq}`, simulated: false };
    };
    await M.AdmSetting.destroy({ where: { setting_key: "whatsapp_ai" } });
    await M.AdmSetting.create({ setting_key: "whatsapp_ai", value: JSON.stringify({ aiAllDay: true, aiQuietHoursAfterHuman: 24, templateFrom: "00:00", templateTo: "23:59" }) });
    await require("../adminv1/crm/campaigns").sendDue(new Date());
    const rc = await M.CrmCampaignRcpt.findAll({ where: { campaign_id: campId }, raw: true });
    const byKey = Object.fromEntries(rc.map((x) => [x.phone_key, x]));
    check("names from the file fill the template", sent.some((b) => b.to === `91${phone(21)}` && b.template.components[0].parameters[0].text === "List"), sent.map((b) => [b.to, b.template && b.template.components[0].parameters[0].text]));
    check("a BillerPe customer in the list gets it", byKey[phone(22)] && byKey[phone(22)].status === "sent", byKey[phone(22)]);
    check("a restaurant's guest is skipped", byKey[phone(23)] && byKey[phone(23)].status === "skipped", byKey[phone(23)]);
    check("the number that is a lead is sent as that lead", byKey[phone(1)] && byKey[phone(1)].lead_id === ids[0] && byKey[phone(1)].status === "sent");
    sent.length = 0;
    r = await call("inboxStart", A.token, { phone: phone(31), name: "New Contact", templateId: tpl.id, values: ["Ravi"] });
    const newChat = r.ok && (await M.CrmWaChat.findByPk(r.result.chatId));
    check("start a chat with a new number: the chat exists with the name and the template went", newChat && newChat.name === "New Contact" && sent.length === 1 && sent[0].template.components[0].parameters[0].text === "Ravi", r);
    r = await call("inboxStart", A.token, { phone: "123" });
    check("a wrong number is refused", !r.ok);

    console.log("\nMark won from the sales app (create the outlet like the panel)");
    const wonLead = (await intake.receive({ source: "website", name: "Won From App", phone: phone(40), message: "test" })).leadId;
    const wl = await lead(wonLead);
    const wTok = wl.owner_id === A.u.id ? A.token : B.token;
    r = await call("leadWonCustomer", wTok, wonLead, { mode: "create", note: "", payment: "UPI 11999", outlet: { name: `Par Cafe ${stamp}`, city: "Surat", address: "Ring road", pinCode: "395001", ownerName: "Won Owner", ownerMobile: phone(40), productPlan: "LOCAL_SUITE", planName: "Suite Pro" } });
    const hotel = await M.Hotel.findOne({ where: { hotel_name: `Par Cafe ${stamp}` } });
    created.hotels = hotel ? [hotel.id] : [];
    check("the app's short form creates the outlet and gives the owner's login once", r.ok && !!r.result.password && r.result.login === phone(40) && !!hotel, r);
    const link = hotel && (await M.CsAccountOutlet.findOne({ where: { hotel_id: hotel.id } }));
    check("customer account made and the lead is won", !!link && (await config.load()).stageById.get((await lead(wonLead)).stage_id).kind === "won");
    r = await call("leadWonCustomer", wTok, wonLead, { mode: "later" });
    check("a closed lead cannot be won again", !r.ok);

    console.log("\nAssign all unassigned");
    await M.CrmLeadV2.update({ owner_id: null }, { where: { id: ids.slice(0, 4) } });
    r = await call("leadsAssignUnassigned", mgr.token);
    check("only someone who sees every lead", !r.ok, r);
    const before = await M.CrmLeadV2.count({ where: { owner_id: null, deleted_at: null, merged_into_id: null, stage_id: (await config.load()).openStageIds } });
    r = await call("leadsAssignUnassigned", admin.token);
    check("admin: every unassigned open lead gets an owner (oldest first, up to 200)", r.ok && r.result.assigned >= Math.min(4, before) && (await M.CrmLeadV2.count({ where: { id: ids.slice(0, 4), owner_id: null } })) === 0, r);
}

async function cleanup() {
    if (created.hotels && created.hotels.length) {
        const hotels = created.hotels;
        const accIds = (await M.CsAccountOutlet.findAll({ where: { hotel_id: hotels }, attributes: ["account_id"], raw: true })).map((x) => x.account_id);
        for (const name of ["CsOnboardingItem", "CsTask", "CsOutletDay", "CsAccountOutlet", "UserAccess", "PaymentMode", "BillChargeRule", "NotificationSetting", "RolePermissionDefault", "MenuCatalog", "RestaurantSetting"]) if (M[name]) await M[name].destroy({ where: { hotel_id: hotels } }).catch(() => {});
        if (accIds.length) {
            await M.CsActivity.destroy({ where: { account_id: accIds } });
            await M.CsAccount.destroy({ where: { id: accIds } });
        }
        await M.HotelUser.destroy({ where: { hotel_id: hotels } });
        await M.Role.destroy({ where: { hotel_id: hotels } }).catch(() => {});
        await M.Hotel.destroy({ where: { id: hotels } });
    }
    const chats = (await M.CrmWaChat.findAll({ where: { phone_key: { [Op.like]: `8%${stamp}` } }, attributes: ["id"], raw: true })).map((c) => c.id);
    if (chats.length) {
        await M.CrmWaMessage.destroy({ where: { chat_id: chats } });
        await M.CrmWaChat.destroy({ where: { id: chats } });
    }
    const camps = (await M.CrmCampaign.findAll({ where: { name: { [Op.like]: `%${stamp}` } }, attributes: ["id"], raw: true })).map((c) => c.id);
    if (camps.length) {
        await M.CrmCampaignRcpt.destroy({ where: { campaign_id: camps } });
        await M.CrmCampaign.destroy({ where: { id: camps } });
    }
    if (created.templates) await M.CrmWaTemplate.destroy({ where: { id: created.templates } });
    const leadIds = (await M.CrmLeadV2.findAll({ where: { phone_key: { [Op.like]: `8%${stamp}` } }, attributes: ["id"], raw: true })).map((l) => l.id);
    if (leadIds.length) {
        for (const m of [M.CrmInquiry, M.CrmTaskV2, M.CrmActivity, M.CrmCall, M.CrmAssignment]) await m.destroy({ where: { lead_id: leadIds } });
        await M.CrmLeadV2.destroy({ where: { id: leadIds } });
        await M.CrmEvent.destroy({ where: { entity: "crm_lead", entity_id: leadIds.map(String) } });
    }
    if (created.users.length) {
        // Other test-DB leads this run assigned to our temporary people go back to nobody.
        await M.CrmLeadV2.update({ owner_id: null }, { where: { owner_id: created.users } });
        await M.CrmTaskV2.update({ owner_id: null }, { where: { owner_id: created.users } }).catch(() => {});
        await M.CrmAssignment.destroy({ where: { to_id: created.users } });
        for (const m of [M.AdmNotification, M.AdmBreak, M.AdmLeave, M.AdmSession]) await m.destroy({ where: { user_id: created.users } });
        await M.AdmAuditLog.destroy({ where: { actor_id: created.users } });
        await M.AdmUser.destroy({ where: { id: created.users } });
    }
    for (const u of restore.users) await M.AdmUser.update({ daily_lead_cap: u.daily_lead_cap }, { where: { id: u.id } });
    await M.AdmSetting.destroy({ where: { setting_key: ["working_hours", "whatsapp_ai"] } });
    if (restore.settings.length) await M.AdmSetting.bulkCreate(restore.settings);
}

(async () => {
    await ensureDefaultRoles(M.AdmRole);
    await config.ensureDefaults();
    // Other people in the test DB leave the rotation for this run.
    restore.users = await M.AdmUser.findAll({ where: { daily_lead_cap: { [Op.ne]: null } }, attributes: ["id", "daily_lead_cap"], raw: true });
    await M.AdmUser.update({ daily_lead_cap: null }, { where: { id: restore.users.map((u) => u.id) } });
    restore.settings = await M.AdmSetting.findAll({ where: { setting_key: ["working_hours", "whatsapp_ai"] }, raw: true });
    const app = express();
    app.use(express.json({ limit: "10mb" }));
    app.use("/admin/v1", require("../adminv1/routes"));
    const server = http.createServer(app);
    await new Promise((res) => server.listen(0, res));
    base = `http://127.0.0.1:${server.address().port}/admin/v1`;
    try {
        await run();
    } catch (e) {
        console.error(e);
        failures.push(`crashed: ${e.message}`);
    } finally {
        await cleanup().catch((e) => console.error("cleanup:", e.message));
        server.close();
        await M.sequelize.close();
    }
    console.log(`\n${passed} passed, ${failures.length} failed`);
    if (failures.length) {
        for (const f of failures) console.log(`  - ${f}`);
        process.exit(1);
    }
    process.exit(0);
})();
