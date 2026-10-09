const crypto = require("crypto");
const bcrypt = require("bcrypt");
const { Op } = require("sequelize");
const { sequelize, Hotel, HotelUser, Role, CsAccount, CsAccountOutlet } = require("../../model");
const { RuleError } = require("../../appv1/core");
const { need } = require("../auth");
const audit = require("../audit");
const { normalizePhone } = require("../crm/util");
const { seedOutlet } = require("../../services/outletSetup");
const accounts = require("./accounts");
const onboarding = require("./onboarding");
const won = require("./won");
const { customerSettings, addActivity, mobile10, spellings, txt } = require("./common");

// Restaurant tools of the old panel, in the new one (owner 2026-10-08:
// nothing the team used may go missing):
// - Add a restaurant: now the outlet setup (cs/setup.js, owner 2026-10-09).
// - Edit a restaurant's details, the owner's login kept in step (old "edit").
// - Reset the owner's password (shown once).

const PASS_CHARS = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const newPassword = () => Array.from(crypto.randomBytes(8), (b) => PASS_CHARS[b % PASS_CHARS.length]).join("");

/** The outlet's owner login: its admin-role user (as the old edit found it), else the user with the owner's mobile. */
async function ownerUser(hotel, t) {
    const role = await Role.findOne({ where: { hotel_id: hotel.id, role_name: "A" }, transaction: t });
    const byRole = role ? await HotelUser.findOne({ where: { hotel_id: hotel.id, role_cd: role.role_cd }, order: [["id", "ASC"]], transaction: t }) : null;
    if (byRole) return byRole;
    const m = mobile10(hotel.owner_number);
    return m ? HotelUser.findOne({ where: { hotel_id: hotel.id, number: spellings(m) }, transaction: t }) : null;
}

/** The editable details, as the outlet page shows them. */
async function details(s, hotelId) {
    need(s, "customers.view");
    const h = await Hotel.findOne({ where: { id: Number(hotelId) || 0 }, raw: true });
    if (!h) throw new RuleError("Outlet not found.");
    return {
        hotelId: h.id, name: h.hotel_name || "", ownerName: h.owner_name || "", ownerMobile: mobile10(h.owner_number), email: h.owner_email_id || h.email_id || "",
        address: h.address1 || "", city: h.address2 || "", pinCode: h.pinCode ? String(h.pinCode) : "", gstNo: h.gst_no || "", phone: h.contact1 ? String(h.contact1) : "",
    };
}

/**
 * Edit a restaurant's details. A new owner mobile moves the owner's login
 * to it (checked unused anywhere), and the account follows when it holds
 * only this outlet. Every change goes to the audit log with a reason.
 */
async function update(s, hotelId, input = {}) {
    need(s, "customers.manage");
    const why = txt(input.reason, 200);
    if (why.length < 3) throw new RuleError("Write why the details change (goes to the audit log).");
    return sequelize.transaction(async (t) => {
        const hotel = await Hotel.findOne({ where: { id: Number(hotelId) || 0 }, transaction: t, lock: t.LOCK.UPDATE });
        if (!hotel) throw new RuleError("Outlet not found.");
        const before = { hotel_name: hotel.hotel_name, owner_name: hotel.owner_name, owner_number: mobile10(hotel.owner_number), owner_email_id: hotel.owner_email_id, address1: hotel.address1, address2: hotel.address2, pinCode: hotel.pinCode, gst_no: hotel.gst_no, contact1: hotel.contact1 };
        const patch = {};
        if (input.name !== undefined) {
            const v = txt(input.name, 120);
            if (v.length < 2) throw new RuleError("Write the outlet's name.");
            patch.hotel_name = v;
        }
        if (input.ownerName !== undefined) {
            const v = txt(input.ownerName, 120);
            if (!v) throw new RuleError("Write the owner's name.");
            patch.owner_name = v;
        }
        if (input.email !== undefined) {
            const v = txt(input.email, 120);
            if (v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) throw new RuleError("The email does not look right.");
            patch.owner_email_id = v || null;
            patch.email_id = v || null;
        }
        if (input.address !== undefined) {
            const v = txt(input.address, 300);
            if (v.length < 3) throw new RuleError("Write the outlet's address.");
            patch.address1 = v;
        }
        if (input.city !== undefined) patch.address2 = txt(input.city, 60) || null;
        if (input.pinCode !== undefined) {
            const v = String(input.pinCode || "").replace(/\D/g, "");
            if (!/^[1-9]\d{5}$/.test(v)) throw new RuleError("PIN code: 6 digits.");
            patch.pinCode = Number(v);
        }
        if (input.gstNo !== undefined) {
            const v = txt(input.gstNo, 15).toUpperCase();
            if (v && !/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(v)) throw new RuleError("The GSTIN does not look right (15 characters).");
            patch.gst_no = v;
        }
        let newMobile = null;
        if (input.ownerMobile !== undefined) {
            const ph = normalizePhone(input.ownerMobile);
            if (!ph.valid || !/^\+91\d{10}$/.test(ph.phone)) throw new RuleError("Owner mobile: write a 10-digit Indian mobile number. It is the owner's login.");
            if (ph.key !== mobile10(hotel.owner_number)) {
                const taken = (await Hotel.findOne({ where: { id: { [Op.ne]: hotel.id }, owner_number: [Number(ph.key), Number(`91${ph.key}`)] }, attributes: ["id", "hotel_name"], raw: true, transaction: t })) || (await HotelUser.findOne({ where: { number: spellings(ph.key) }, attributes: ["hotel_id"], raw: true, transaction: t }));
                if (taken) throw new RuleError(`${ph.key} is already a login${taken.hotel_name ? ` of ${taken.hotel_name} (#${taken.id})` : taken.hotel_id ? ` at outlet #${taken.hotel_id}` : ""}. Use another mobile.`);
                newMobile = ph.key;
                patch.owner_number = Number(ph.key);
                patch.contact1 = ph.key;
            }
        }
        if (!Object.keys(patch).length) return { hotelId: hotel.id, changed: [] };
        const owner = await ownerUser(hotel, t);
        await hotel.update(patch, { transaction: t });
        if (owner) {
            const up = {};
            if (patch.owner_name) up.name = patch.owner_name;
            if (newMobile) up.number = newMobile;
            if (patch.owner_email_id !== undefined) up.email = patch.owner_email_id;
            if (Object.keys(up).length) await owner.update(up, { transaction: t });
        }
        const link = await CsAccountOutlet.findOne({ where: { hotel_id: hotel.id }, transaction: t });
        if (link && newMobile) {
            const acc = await CsAccount.findOne({ where: { id: link.account_id }, transaction: t, lock: t.LOCK.UPDATE });
            const outlets = await CsAccountOutlet.count({ where: { account_id: link.account_id }, transaction: t });
            const clash = await CsAccount.findOne({ where: { owner_mobile: newMobile, id: { [Op.ne]: link.account_id } }, transaction: t });
            if (acc && outlets === 1 && !clash) await acc.update({ owner_mobile: newMobile, ...(patch.owner_name ? { owner_name: patch.owner_name } : {}) }, { transaction: t });
        }
        const changed = Object.keys(patch);
        if (link) await addActivity(link.account_id, hotel.id, "note", s.user.id, `${s.user.name} changed the outlet's details: ${changed.map((k) => k.replace(/_/g, " ")).join(", ")} (${why})`, null, t);
        await audit.write(s, { action: "outlet.update", entity: "hotel", entityId: hotel.id, summary: `Changed ${hotel.hotel_name}'s details${newMobile ? " (owner login moved to a new mobile)" : ""}`, reason: why, before, after: patch }, { transaction: t });
        return { hotelId: hotel.id, changed, ownerLogin: !!owner };
    });
}

/** A new password for the owner's login, shown once (old panel: set in the edit form). */
async function resetOwnerPassword(s, hotelId, reason) {
    need(s, "customers.manage");
    const why = txt(reason, 200);
    if (why.length < 3) throw new RuleError("Write why (goes to the audit log).");
    const password = newPassword();
    const hash = await bcrypt.hash(password, 10);
    return sequelize.transaction(async (t) => {
        const hotel = await Hotel.findOne({ where: { id: Number(hotelId) || 0 }, transaction: t, lock: t.LOCK.UPDATE });
        if (!hotel) throw new RuleError("Outlet not found.");
        const owner = await ownerUser(hotel, t);
        if (!owner) throw new RuleError("This outlet has no owner login to reset.");
        await owner.update({ password: hash }, { transaction: t });
        await hotel.update({ password: hash }, { transaction: t });
        await audit.write(s, { action: "outlet.owner_password", entity: "hotel", entityId: hotel.id, summary: `Reset the owner's password of ${hotel.hotel_name}`, reason: why }, { transaction: t });
        return { login: mobile10(owner.number) || mobile10(hotel.owner_number), password };
    });
}

module.exports = { details, update, resetOwnerPassword, ownerUser };
