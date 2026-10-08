const crypto = require("crypto");
const bcrypt = require("bcrypt");
const { sequelize, Hotel, HotelUser, CsAccount, CsAccountOutlet, CsOnboardingItem } = require("../../model");
const { RuleError } = require("../../appv1/core");
const { need } = require("../auth");
const audit = require("../audit");
const leads = require("../crm/leads");
const { notify } = require("../crm/notify");
const { normalizePhone } = require("../crm/util");
const { seedOutlet } = require("../../services/outletSetup");
const accounts = require("./accounts");
const onboarding = require("./onboarding");
const { PLAN_NAMES, customerSettings, addActivity, mobile10, spellings, txt, moment, TZ } = require("./common");

// "Mark won" -> customer (owner 2026-10-08): the salesperson either creates
// the outlet right here (the same defaults as the old add-restaurant call),
// links an outlet that already exists, or leaves it for later (the outlet
// is then linked by itself when it appears with the lead's mobile). The lead
// closes as won, the account is made or found by the owner's mobile, gets a
// success owner, and the outlet's onboarding starts. Invoices and payments
// are phase 6; "Payment received" can be ticked here with a note.

const MODES = ["create", "link", "later"];
const PASS_CHARS = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const newPassword = () => Array.from(crypto.randomBytes(8), (b) => PASS_CHARS[b % PASS_CHARS.length]).join("");

function dateOrNull(v, label) {
    if (v === undefined || v === null || v === "") return null;
    const d = moment.tz(String(v).slice(0, 10), "YYYY-MM-DD", true, TZ);
    if (!d.isValid()) throw new RuleError(`${label}: choose a date.`);
    return d;
}

/** The new outlet's fields, checked before anything is written. */
async function cleanOutlet(input, cfg) {
    const o = input || {};
    const name = txt(o.name, 120);
    if (name.length < 2) throw new RuleError("Write the outlet's name.");
    const ownerName = txt(o.ownerName, 120);
    if (!ownerName) throw new RuleError("Write the owner's name.");
    const ph = normalizePhone(o.ownerMobile);
    if (!ph.valid || !/^\+91\d{10}$/.test(ph.phone)) throw new RuleError("Owner mobile: write a 10-digit Indian mobile number. It is the owner's login.");
    const m = ph.key;
    const address = txt(o.address, 300);
    if (address.length < 3) throw new RuleError("Write the outlet's address.");
    const pin = String(o.pinCode || "").replace(/\D/g, "");
    if (!/^[1-9]\d{5}$/.test(pin)) throw new RuleError("PIN code: 6 digits.");
    const email = txt(o.email, 120);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new RuleError("The email does not look right.");
    const product = o.productPlan === "CLOUD_APP" ? "CLOUD_APP" : "LOCAL_SUITE";
    const planName = txt(o.planName, 40);
    const known = PLAN_NAMES.find((p) => p.name === planName);
    if (!known) throw new RuleError("Choose the plan sold.");
    if (known.product !== "any" && known.product !== product) throw new RuleError(`${planName} is a ${known.product === "CLOUD_APP" ? "POS App" : "Local Suite"} plan.`);
    const start = dateOrNull(o.planStart, "Plan starts") || moment().tz(TZ).startOf("day");
    const end = dateOrNull(o.planEnd, "Plan ends") || (planName === "Free trial" ? start.clone().add(cfg.trialDays, "days") : start.clone().add(1, "year").subtract(1, "day"));
    if (!end.isAfter(start)) throw new RuleError("The plan must end after it starts.");
    let devices = o.deviceLimit !== undefined && o.deviceLimit !== "" ? Number(o.deviceLimit) : known.devices || 3;
    if (!Number.isInteger(devices) || devices < 1 || devices > 100) throw new RuleError("POS App devices: a whole number from 1 to 100.");
    const password = String(o.password || "");
    if (password && password.length < 6) throw new RuleError("The owner's password needs at least 6 characters (or leave it empty to make one).");
    const gst = txt(o.gstNo, 15).toUpperCase();
    if (gst && !/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(gst)) throw new RuleError("The GSTIN does not look right (15 characters).");
    const taken = (await Hotel.findOne({ where: { owner_number: [Number(m), Number(`91${m}`)] }, attributes: ["id", "hotel_name"], raw: true })) || (await HotelUser.findOne({ where: { number: spellings(m) }, attributes: ["hotel_id"], raw: true }));
    if (taken) {
        const h = taken.hotel_name ? taken : await Hotel.findOne({ where: { id: taken.hotel_id }, attributes: ["id", "hotel_name"], raw: true });
        throw new RuleError(`${m} is already the login of ${h ? `${h.hotel_name} (#${h.id})` : "another outlet"}. Link that outlet instead, or use another mobile for this outlet's owner login.`);
    }
    return { name, ownerName, m, address, city: txt(o.city, 60), pin: Number(pin), email, product, planName, start, end, devices, password, gst };
}

async function win(s, leadId, input = {}) {
    need(s, "leads.edit");
    const mode = MODES.includes(input.mode) ? input.mode : "create";
    const cfg = await customerSettings();
    const note = txt(input.note, 500);
    const out = mode === "create" ? await cleanOutlet(input.outlet, cfg) : null;
    const generated = out && !out.password ? newPassword() : null;
    const hash = out ? await bcrypt.hash(out.password || generated, 10) : null;

    const result = await sequelize.transaction(async (t) => {
        const lead = await leads.getLead(s, leadId, t, true);
        if (mode === "later") {
            await leads.wonIn(s, lead, { note }, t);
            return { leadId: lead.id, accountId: null, hotelId: null };
        }

        let hotel;
        if (mode === "create") {
            hotel = await Hotel.create({
                hotel_name: out.name,
                owner_name: out.ownerName,
                owner_number: Number(out.m),
                owner_email_id: out.email || null,
                address1: out.address,
                address2: out.city || null,
                pinCode: out.pin,
                contact1: out.m,
                email_id: out.email || null,
                gst_no: out.gst,
                hotel_logo: "",
                password: hash,
                hotel_reg_date: new Date(),
                plan_start_date: out.start.toDate(),
                plan_end_date: out.end.clone().endOf("day").toDate(),
                product_plan: out.product,
                app_device_limit: out.devices,
            }, { transaction: t });
            await seedOutlet(hotel, { name: out.ownerName, number: out.m, email: out.email || null, passwordHash: hash }, { transaction: t });
            await audit.write(s, { action: "outlet.create", entity: "hotel", entityId: hotel.id, summary: `Created outlet ${hotel.hotel_name} for the won lead #${lead.id}`, after: { hotel_name: hotel.hotel_name, owner_number: out.m, product_plan: out.product, plan: out.planName, plan_end_date: hotel.plan_end_date } }, { transaction: t });
        } else {
            hotel = await Hotel.findOne({ where: { id: Number(input.hotelId) || 0 }, transaction: t });
            if (!hotel) throw new RuleError("Choose the outlet to link.");
        }

        // The account: the one the outlet is already in, else the owner's (by mobile), else a new one.
        let link = await CsAccountOutlet.findOne({ where: { hotel_id: hotel.id }, transaction: t, lock: t.LOCK.UPDATE });
        const key = mobile10(hotel.owner_number) || `h${hotel.id}`;
        let acc = link ? await CsAccount.findOne({ where: { id: link.account_id }, transaction: t, lock: t.LOCK.UPDATE }) : await CsAccount.findOne({ where: { owner_mobile: key }, transaction: t, lock: t.LOCK.UPDATE });
        const seller = lead.owner_id || s.user.id;
        if (!acc) {
            acc = await CsAccount.create({
                name: txt(hotel.owner_name || lead.name || hotel.hotel_name, 120),
                owner_mobile: key,
                owner_name: txt(hotel.owner_name, 120),
                email: txt(hotel.owner_email_id || lead.email, 120),
                city: txt(lead.city || hotel.address2, 60),
                origin: "won",
                customer_since: new Date(),
                lead_id: lead.id,
                won_by_id: seller,
                success_owner_id: await accounts.pickSuccessOwner(seller, t),
            }, { transaction: t });
            await addActivity(acc.id, hotel.id, "created", s.user.id, `Customer account made: ${lead.name || lead.phone} was won by ${s.user.name}`, { leadId: lead.id }, t);
        } else {
            const patch = { lead_id: acc.lead_id || lead.id, won_by_id: acc.won_by_id || seller };
            if (!acc.success_owner_id) patch.success_owner_id = await accounts.pickSuccessOwner(seller, t);
            await acc.update(patch, { transaction: t });
        }
        if (!link) {
            link = await CsAccountOutlet.create({ account_id: acc.id, hotel_id: hotel.id, plan_name: out ? out.planName : txt(input.planName, 40), linked_by: s.user.id }, { transaction: t });
            await addActivity(acc.id, hotel.id, "link", s.user.id, `Outlet ${hotel.hotel_name} (#${hotel.id}) is in this account`, null, t);
        } else if (out || input.planName) {
            await link.update({ plan_name: out ? out.planName : txt(input.planName, 40) }, { transaction: t });
        }

        await leads.wonIn(s, lead, { note, hotelId: hotel.id, data: { hotelId: hotel.id, accountId: acc.id, outlet: hotel.hotel_name, created: mode === "create" } }, t);
        await addActivity(acc.id, hotel.id, "won", s.user.id, `Won by ${s.user.name}${mode === "create" ? `: outlet ${hotel.hotel_name} created` : `: outlet ${hotel.hotel_name} linked`}${note ? ` (${note})` : ""}`, { leadId: lead.id }, t);

        // Onboarding: a new outlet always; a linked one unless its checklist is already running or done.
        if (link.onboarding === "none") await onboarding.start(link, { ownerId: acc.success_owner_id, actorId: s.user.id }, t);
        const paid = txt(input.payment, 300);
        if (paid) {
            const it = await CsOnboardingItem.findOne({ where: { hotel_id: hotel.id, item_key: "payment", done_at: null }, transaction: t });
            if (it) await it.update({ done_at: new Date(), done_by: s.user.id, note: paid }, { transaction: t });
        }
        if (acc.success_owner_id && acc.success_owner_id !== s.user.id) {
            await notify(acc.success_owner_id, { type: "account.won", title: `New customer: ${acc.name}`, body: `${hotel.hotel_name} - won by ${s.user.name}. Onboarding has started.`, link: `/accounts/${acc.id}`, ref: `won:${lead.id}` }, { transaction: t });
        }
        return { leadId: lead.id, accountId: acc.id, hotelId: hotel.id };
    });
    if (result.hotelId) await onboarding.autoCheck({ only: [result.hotelId] });
    return { ...result, ...(generated ? { password: generated, login: out.m } : {}) };
}

/**
 * "+ Add outlet" on an account: a new outlet for an existing customer (a
 * second branch). Its owner login needs its own mobile (one login per
 * mobile in the outlet tables); it starts onboarding like a won outlet.
 */
async function addOutlet(s, accountId, input = {}) {
    need(s, "customers.manage");
    const cfg = await customerSettings();
    const out = await cleanOutlet(input, cfg);
    const generated = out.password ? null : newPassword();
    const hash = await bcrypt.hash(out.password || generated, 10);
    const result = await sequelize.transaction(async (t) => {
        const acc = await accounts.getAccount(accountId, t, true);
        const hotel = await Hotel.create({
            hotel_name: out.name, owner_name: out.ownerName, owner_number: Number(out.m), owner_email_id: out.email || null, address1: out.address, address2: out.city || null,
            pinCode: out.pin, contact1: out.m, email_id: out.email || null, gst_no: out.gst, hotel_logo: "", password: hash, hotel_reg_date: new Date(),
            plan_start_date: out.start.toDate(), plan_end_date: out.end.clone().endOf("day").toDate(), product_plan: out.product, app_device_limit: out.devices,
        }, { transaction: t });
        await seedOutlet(hotel, { name: out.ownerName, number: out.m, email: out.email || null, passwordHash: hash }, { transaction: t });
        const link = await CsAccountOutlet.create({ account_id: acc.id, hotel_id: hotel.id, plan_name: out.planName, linked_by: s.user.id }, { transaction: t });
        await addActivity(acc.id, hotel.id, "link", s.user.id, `New outlet ${hotel.hotel_name} (#${hotel.id}) created by ${s.user.name}`, null, t);
        await audit.write(s, { action: "outlet.create", entity: "hotel", entityId: hotel.id, summary: `Created outlet ${hotel.hotel_name} in account ${acc.name}`, after: { hotel_name: hotel.hotel_name, owner_number: out.m, product_plan: out.product, plan: out.planName, plan_end_date: hotel.plan_end_date } }, { transaction: t });
        await onboarding.start(link, { ownerId: acc.success_owner_id, actorId: s.user.id }, t);
        return { accountId: acc.id, hotelId: hotel.id };
    });
    await onboarding.autoCheck({ only: [result.hotelId] });
    return { ...result, ...(generated ? { password: generated, login: out.m } : {}) };
}

/** Outlets to link when marking won: by name, id or owner mobile. */
async function findOutlets(s, q) {
    need(s, "leads.edit");
    const term = txt(q, 60);
    if (term.length < 2) return { outlets: [] };
    const { Op } = require("sequelize");
    const d = term.replace(/\D/g, "");
    const rows = await Hotel.findAll({
        where: { [Op.or]: [{ hotel_name: { [Op.like]: `%${term}%` } }, ...(/^\d+$/.test(term) ? [{ id: Number(term) }] : []), ...(d.length === 10 ? [{ owner_number: [Number(d), Number(`91${d}`)] }] : [])] },
        attributes: ["id", "hotel_name", "owner_name", "owner_number", "product_plan", "address2"],
        limit: 15,
        raw: true,
    });
    return { outlets: rows.map((h) => ({ id: h.id, name: h.hotel_name, owner: h.owner_name, mobile: mobile10(h.owner_number), plan: h.product_plan, city: h.address2 || "" })) };
}

module.exports = { win, addOutlet, findOutlets, PLAN_NAMES };
