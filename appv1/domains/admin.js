const bcrypt = require("bcrypt");
const { Op } = require("sequelize");
const M = require("../../model");
const { fail, need, needSpecial, audit } = require("../core");
const { callController } = require("../legacy");
const { FORMAT_KEYWORD } = require("../load");
const userCtl = require("../exe/controller/user");
const roleCtl = require("../exe/controller/rolePermissionDefault");
const taxCtl = require("../exe/controller/tax");
const paymentCtl = require("../exe/controller/paymentMode");
const promoCtl = require("../exe/controller/promoCode");
const kitchenCtl = require("../exe/controller/kitchen");
const chargeCtl = require("../exe/controller/billChargeRule");
const { isOwnerAccount, OWNER_LOCKED_MESSAGE, OWNER_SELF_ONLY_MESSAGE } = require("../exe/helpers/ownerAccount");

// Staff, permissions, outlet settings, devices and the signed-in person's
// own account. Staff, role defaults, taxes, payment modes, promos, kitchens
// and charge rules go through the exe's controllers (appv1/exe); the owner
// lock is the exe's own (helpers/ownerAccount.js: the owner is the login
// whose mobile is the outlet's owner number).

const MOBILE = /^\d{10}$/;
const idOf = (v) => Number(v) || 0;
const TOKEN_CODE = { pickup: "0", dinin: "1", both: "2", off: "3" };

/* ------------------------------ staff ------------------------------ */

async function saveStaff(c, s) {
    const existing = s.id ? await M.HotelUser.findOne({ where: { id: idOf(s.id), hotel_id: c.hotelId }, include: M.Role }) : null;
    if (s.id && !existing) fail("Staff not found");
    const self = existing && existing.id === c.userId;
    if (!self) need(c, "users", existing ? "edit" : "create");
    const owner = existing ? await isOwnerAccount(c.hotelId, existing) : false;
    if (owner && !self) fail(OWNER_SELF_ONLY_MESSAGE);
    if (s.role === "Owner" && !owner) fail("An outlet has one owner");
    const name = String(s.name || "").trim();
    if (!name) fail("Name is required");
    if (!MOBILE.test(String(s.mobile || ""))) fail("Enter a 10-digit mobile number");
    if (!existing && !s.password) fail("Set a password");
    if (s.password && String(s.password).length < 6) fail("Password needs at least 6 characters");
    if (s.pin !== undefined && s.pin !== "" && !/^\d{4}$/.test(String(s.pin))) fail("PIN must be 4 digits");
    if (!existing && !s.pin) fail("Set a 4-digit PIN");
    // The mobile is the login: unique across every outlet (exe createUser).
    const clash = await M.HotelUser.findOne({ where: { number: String(s.mobile), ...(existing ? { id: { [Op.ne]: existing.id } } : {}) } });
    if (clash) fail("This mobile number is already used by another login");
    const body = { name, role: owner ? existing.role_mst?.role_name : s.role, email: existing?.email || "", number: String(s.mobile), active: existing ? existing.active : true, password: s.password || undefined, pin: s.pin || undefined };
    if (existing) await callController(userCtl.updateUser, c, { body: { ...body, id: existing.id } });
    else await callController(userCtl.createUser, c, { body });
    await audit(c, "Staff", `${existing ? "Edited" : "Added"} ${name} (${owner ? "Owner" : s.role})`);
}

async function setStaffActive(c, id, active) {
    need(c, "users", "edit");
    const u = await M.HotelUser.findOne({ where: { id: idOf(id), hotel_id: c.hotelId }, include: M.Role });
    if (!u) fail("Staff not found");
    if (await isOwnerAccount(c.hotelId, u)) fail(OWNER_LOCKED_MESSAGE);
    if (u.id === c.userId) fail("You cannot deactivate yourself");
    await u.update({ active: !!active });
    // A switched-off person is signed out of every phone at once.
    if (!active) await M.AppDevice.update({ hotel_user_id: null }, { where: { hotel_id: c.hotelId, hotel_user_id: u.id } });
    await audit(c, "Staff", `${active ? "Activated" : "Deactivated"} ${u.name}`);
}

async function setRoleDefaults(c, role, p) {
    needSpecial(c, "users.editPermissions");
    if (role === "Owner") fail("The owner always has every permission");
    await callController(roleCtl.editRolePermissionDefault, c, { body: { role, permissions: p.modules } });
    await callController(roleCtl.editRolePermissionSpecialDefault, c, { body: { role, special: p.special } });
    await audit(c, "Permissions", `Changed ${role} permissions`);
}

async function setUserOverrides(c, staffId, p) {
    needSpecial(c, "users.editPermissions");
    await callController(userCtl.setPermissionOverrides, c, { body: { id: idOf(staffId), overrides: p ? { modules: p.modules, special: p.special } : null } });
    await audit(c, "Permissions", `${p ? "Custom" : "Role"} permissions for staff ${staffId}`);
}

/* ------------------------------ settings ------------------------------ */

function formatSlots(format) {
    const out = {};
    for (const slot of ["header", "footer"]) {
        const lines = (format?.[slot] || []).slice(0, 10);
        const prefix = slot === "header" ? "headerLine" : "footerLine";
        const font = slot === "header" ? "fontH" : "fontF";
        for (let i = 1; i <= 10; i++) {
            const l = lines[i - 1];
            // Every slot is written, so a removed line is really cleared.
            out[`${prefix}${i}`] = !l ? "" : l.content === "text" ? String(l.text || "") : FORMAT_KEYWORD[l.content] || "";
            out[`${font}${i}`] = `${Number(l?.fontSize) || 12}px`;
        }
    }
    return out;
}

async function saveFormat(Model, hotelId, format) {
    const fields = formatSlots(format);
    const row = await Model.findOne({ where: { hotel_id: hotelId } });
    if (row) await row.update(fields);
    else await Model.create({ ...fields, hotel_id: hotelId });
}

async function updateSettings(c, patch) {
    const HARDWARE = ["kitchens", "kotFormat"];
    const EXPERIENCE = ["qrOrdering"];
    for (const k of Object.keys(patch || {})) need(c, HARDWARE.includes(k) ? "ops-hardware" : EXPERIENCE.includes(k) ? "ops-experience" : "ops-billing", "edit");
    if (patch.businessDayStart !== undefined && !/^([01]\d|2[0-3]):[0-5]\d$/.test(patch.businessDayStart)) fail("Enter a time like 06:00");
    if (patch.financialYearStartMonth !== undefined && !(patch.financialYearStartMonth >= 1 && patch.financialYearStartMonth <= 12)) fail("Pick a month");
    if (patch.billReset !== undefined && !["never", "daily", "financial_year"].includes(patch.billReset)) fail("Pick how bill numbers reset");

    const hotel = {};
    if (patch.gstOn !== undefined) hotel.invoiceFormateIncGst = !!patch.gstOn;
    if (patch.saveBehave !== undefined) hotel.saveBehave = patch.saveBehave === "pdf" ? "pdf" : "save";
    if (patch.tokens) {
        for (const [k, col] of [["tokenFor", "is_token_on"], ["billWithKot", "bill_with_kot"], ["billWithToken", "bill_with_token"]]) {
            if (patch.tokens[k] !== undefined) {
                if (!TOKEN_CODE[patch.tokens[k]]) fail("Pick where tokens apply");
                hotel[col] = TOKEN_CODE[patch.tokens[k]];
            }
        }
    }
    if (Object.keys(hotel).length) await M.Hotel.update(hotel, { where: { id: c.hotelId } });

    const setting = {};
    if (patch.businessDayStart !== undefined) setting.business_day_start_time = `${patch.businessDayStart}:00`;
    if (patch.billReset !== undefined) setting.bill_reset_type = patch.billReset;
    if (patch.financialYearStartMonth !== undefined) setting.financial_year_start_month = Number(patch.financialYearStartMonth);
    if (patch.cashSessionOn !== undefined) setting.opening_closing_show = !!patch.cashSessionOn;
    if (patch.qrOrdering !== undefined) setting.qr_ordering = !!patch.qrOrdering;
    if (patch.supplierPaymentsAsExpense !== undefined) setting.supplier_payment_expense = !!patch.supplierPaymentsAsExpense;
    if (Object.keys(setting).length) {
        const row = await M.RestaurantSetting.findOne({ where: { hotel_id: c.hotelId } });
        if (row) await row.update(setting);
        else await M.RestaurantSetting.create({ hotel_id: c.hotelId, ...setting });
    }
    if (patch.invoiceFormat) await saveFormat(M.InvoiceFormate, c.hotelId, patch.invoiceFormat);
    if (patch.kotFormat) await saveFormat(M.KotFormate, c.hotelId, patch.kotFormat);
    await audit(c, "Settings", `Updated ${Object.keys(patch).join(", ")}`);
}

async function updateOutlet(c, patch) {
    need(c, "ops-billing", "edit");
    const fields = {};
    if (patch.name !== undefined) {
        if (!String(patch.name).trim()) fail("Outlet name is required");
        fields.hotel_name = String(patch.name).trim();
    }
    if (patch.gstin !== undefined) {
        if (patch.gstin && !/^[0-9A-Z]{15}$/.test(patch.gstin)) fail("GSTIN must be 15 characters (capital letters and numbers)");
        fields.gst_no = patch.gstin || null;
    }
    if (patch.fssai !== undefined) {
        if (patch.fssai && !/^\d{14}$/.test(patch.fssai)) fail("FSSAI number must be 14 digits");
        fields.fssai_no = patch.fssai || null;
    }
    if (patch.upiId !== undefined) {
        if (patch.upiId && !/^[\w.-]{2,}@[a-zA-Z][\w.-]*$/.test(patch.upiId)) fail("Enter a UPI ID like name@bank");
        fields.upiId = patch.upiId || null;
    }
    if (patch.address !== undefined) fields.address1 = String(patch.address).trim();
    if (patch.phone !== undefined) {
        if (patch.phone && !MOBILE.test(patch.phone)) fail("Enter a 10-digit phone number");
        fields.contact1 = patch.phone || null;
    }
    if (patch.logoUrl !== undefined) fields.hotel_logo = patch.logoUrl || "";
    await M.Hotel.update(fields, { where: { id: c.hotelId } });
    await audit(c, "Settings", "Updated outlet details");
}

async function saveTax(c, t) {
    need(c, "ops-billing", t.id ? "edit" : "create");
    const name = String(t.name || "").trim();
    if (!name) fail("Tax name is required");
    if (!(Number(t.rate) >= 0)) fail("Enter a rate");
    if (t.type === "pr" && Number(t.rate) > 100) fail("A percentage tax cannot be above 100");
    const body = {
        tax_name: name, tax_value: t.type === "fix" ? "fix" : "pr", amount: Number(t.rate), order_type: t.orderTypes || [],
        table_categ_ids: (t.sectionIds || []).map(Number), menu_ids: (t.itemIds || []).map(Number), active: t.active !== false,
    };
    if (t.id) {
        const row = await M.TaxType.findOne({ where: { id: idOf(t.id), hotel_id: c.hotelId } });
        if (!row) fail("Tax not found");
        await callController(taxCtl.editTaxType, c, { body: { ...body, id: row.id } });
    } else await callController(taxCtl.createTaxType, c, { body });
    await audit(c, "Settings", `Saved tax ${name}`);
}

async function deleteTax(c, id) {
    need(c, "ops-billing", "delete");
    const row = await M.TaxType.findOne({ where: { id: idOf(id), hotel_id: c.hotelId } });
    if (!row) fail("Tax not found");
    // Bills already made keep their tax lines (OrderTax); switched off for new ones.
    await row.update({ active: false });
    await audit(c, "Settings", `Removed tax ${row.tax_name}`);
}

async function saveCharge(c, which, rule) {
    need(c, "ops-billing", "edit");
    if (!(Number(rule.value) >= 0)) fail("Enter a value");
    if (rule.type === "percentage" && Number(rule.value) > 100) fail("A percentage cannot be above 100");
    if (rule.condition !== "3" && !(Number(rule.threshold) > 0)) fail("Enter the bill amount for the condition");
    const common = {
        active: !!rule.active, calculation_on: rule.calculationOn === "total" ? "total" : "core", calculation_on_tax: !!rule.taxOnCharge,
        greater_less: ["1", "2", "3"].includes(rule.condition) ? rule.condition : "3", greater_less_amount: Number(rule.threshold) || 0,
    };
    if (which === "packaging") {
        await callController(chargeCtl.updateBillChargeRule, c, { body: { ...common, rule_for: "packaging", charge_type: rule.type === "fixed" ? "fixed" : "percentage", charge_value: Number(rule.value), charge_automatic: rule.orderTypes || [] } });
    } else {
        // Service charge (exe controller/hotel.js#addEditServiceCharge).
        const fields = { ...common, service_charge_type: rule.type === "fixed" ? "fixed" : "percentage", service_charge_value: Number(rule.value), service_charge_automatic: rule.orderTypes || [] };
        const row = await M.ServiceCharge.findOne({ where: { hotel_id: c.hotelId } });
        if (row) await row.update(fields);
        else await M.ServiceCharge.create({ ...fields, hotel_id: c.hotelId });
    }
    await audit(c, "Settings", `Saved ${which} charge`);
}

/** Built-in modes may have no row yet on an outlet: made on first change. */
async function modeRow(c, id) {
    const builtIn = { upi: "UPI", card: "Card", cash: "Cash", due: "Due" }[id];
    if (builtIn) {
        const rows = await M.PaymentMode.findAll({ where: { hotel_id: c.hotelId } });
        return rows.find((r) => String(r.name).trim().toLowerCase() === id) || M.PaymentMode.create({ hotel_id: c.hotelId, name: builtIn, active: true, deletable: !["cash", "due"].includes(id) });
    }
    const m = /^pm-(\d+)$/.exec(String(id || ""));
    const row = m ? await M.PaymentMode.findOne({ where: { id: Number(m[1]), hotel_id: c.hotelId } }) : null;
    if (!row) fail("Payment mode not found");
    return row;
}

async function savePaymentMode(c, m) {
    need(c, "ops-billing", m.id ? "edit" : "create");
    const name = String(m.name || "").trim();
    if (!name) fail("Name is required");
    if (name.length > 20) fail("Keep it under 20 characters");
    if (m.id) {
        const row = await modeRow(c, m.id);
        await callController(paymentCtl.editPaymentMode, c, { body: { id: row.id, name, active: m.active !== false } });
    } else {
        await callController(paymentCtl.createPaymentMode, c, { body: { name } });
        if (m.active === false) {
            const row = await M.PaymentMode.findOne({ where: { hotel_id: c.hotelId, name }, order: [["id", "DESC"]] });
            await row.update({ active: false });
        }
    }
}

async function removePaymentMode(c, id) {
    need(c, "ops-billing", "delete");
    const row = await modeRow(c, id);
    if (["upi", "card"].includes(id)) fail(`${row.name} cannot be removed — switch it off instead`);
    await callController(paymentCtl.removePaymentMode, c, { body: { id: row.id } });
}

async function savePromo(c, p) {
    need(c, "ops-billing", p.id ? "edit" : "create");
    const code = String(p.code || "").trim().toUpperCase();
    if (!String(p.name || "").trim()) fail("Name is required");
    if (!/^[A-Z0-9]{3,12}$/.test(code)) fail("Code: 3–12 letters or numbers");
    if (!(Number(p.value) > 0)) fail("Enter a value");
    if (p.type === "pr" && Number(p.value) > 100) fail("A percentage cannot be above 100");
    const clash = await M.PromoCode.findOne({ where: { hotel_id: c.hotelId, promo_code: code, ...(p.id ? { id: { [Op.ne]: idOf(p.id) } } : {}) } });
    if (clash) fail("This code already exists");
    const body = { promo_code_name: String(p.name).trim(), promo_code: code, discount_type: p.type === "pr" ? "pr" : "fix", discount_value: Number(p.value), status: p.active !== false };
    if (p.id) {
        const row = await M.PromoCode.findOne({ where: { id: idOf(p.id), hotel_id: c.hotelId } });
        if (!row) fail("Promo code not found");
        await callController(promoCtl.updatePromoCode, c, { body: { ...body, id: row.id } });
    } else {
        await callController(promoCtl.createPromoCode, c, { body });
        if (p.active === false) await M.PromoCode.update({ status: false }, { where: { hotel_id: c.hotelId, promo_code: code } });
    }
}

async function deletePromo(c, id) {
    need(c, "ops-billing", "delete");
    await M.PromoCode.destroy({ where: { id: idOf(id), hotel_id: c.hotelId } });
}

/** The app edits a kitchen by section; the kitchen stores the tables of those sections. */
async function saveKitchen(c, k) {
    need(c, "ops-hardware", k.id ? "edit" : "create");
    const name = String(k.name || "").trim();
    if (!name) fail("Kitchen name is required");
    const clash = await M.KitchenSetting.findOne({ where: { hotel_id: c.hotelId, kitchen_name: name, ...(k.id ? { id: { [Op.ne]: idOf(k.id) } } : {}) } });
    if (clash) fail("This Kitchen Name Already Available");
    const sections = (k.sectionIds || []).map(Number);
    const tableIds = sections.length ? (await M.Table.findAll({ where: { hotel_id: c.hotelId, table_catag_id: sections, active: true }, attributes: ["id"], raw: true })).map((t) => t.id) : [];
    let id = idOf(k.id);
    if (!id) {
        await callController(kitchenCtl.createKitchen, c, { body: { kitchen_name: name } });
        id = (await M.KitchenSetting.findOne({ where: { hotel_id: c.hotelId, kitchen_name: name }, order: [["id", "DESC"]] })).id;
    } else {
        const row = await M.KitchenSetting.findOne({ where: { id, hotel_id: c.hotelId } });
        if (!row) fail("Kitchen Not Found");
        await row.update({ kitchen_name: name });
    }
    await callController(kitchenCtl.setCategoryForKitchen, c, { body: { id, table_ids: tableIds, menu_categ_ids: (k.categoryIds || []).map(Number), order_type: k.orderTypes || [] } });
}

async function deleteKitchen(c, id) {
    need(c, "ops-hardware", "delete");
    await callController(kitchenCtl.deleteKitchen, c, { params: { id: String(idOf(id)) } });
}

/** Manual token reset: numbering starts again at 1 (exe token_reset_at). */
async function resetTokens(c) {
    need(c, "ops-billing", "edit");
    await M.Hotel.update({ token_reset_at: new Date() }, { where: { id: c.hotelId }, transaction: c.t });
    await audit(c, "Settings", "Reset token numbers");
}

/* ------------------------------ devices ------------------------------ */

async function logoutDevice(c, deviceId) {
    need(c, "system", "edit");
    if (String(deviceId) === String(c.deviceId)) fail("Use Log out in Profile for this device");
    const d = await M.AppDevice.findOne({ where: { hotel_id: c.hotelId, device_id: String(deviceId), status: "active" } });
    if (!d) fail("Device not found");
    // Revoked: its token stops working at once and the slot is free.
    await d.update({ status: "revoked" });
    await audit(c, "Devices", `Logged out ${d.name}`);
}

async function saveDevicePrinters(c, deviceId, printers, printKots) {
    need(c, "ops-hardware", "edit");
    const d = await M.AppDevice.findOne({ where: { hotel_id: c.hotelId, device_id: String(deviceId), status: "active" } });
    if (!d) fail("Device not found");
    for (const p of printers || []) {
        if (!String(p.name || "").trim()) fail("Every printer needs a name");
        if (p.connection === "wifi" && !/^\d{1,3}(\.\d{1,3}){3}:\d{2,5}$/.test(p.address ?? "")) fail(`${p.name}: enter IP and port like 192.168.1.60:9100`);
        if (p.connection === "bluetooth" && !p.address) fail(`${p.name}: pick the Bluetooth printer`);
        if (!(p.copies >= 1 && p.copies <= 5)) fail(`${p.name}: copies must be 1 to 5`);
        if (!p.printsKot && !p.printsInvoice) fail(`${p.name}: choose KOT, bill or both`);
    }
    await d.update({ printers: JSON.stringify(printers || []), print_kots: printKots !== false });
    await audit(c, "Printers", `Updated printers on ${d.name}`);
}

/* ------------------------------ account ------------------------------ */

async function changePin(c, current, next) {
    const u = await M.HotelUser.findOne({ where: { id: c.userId, hotel_id: c.hotelId } });
    if (!u.pin || !(await bcrypt.compare(String(current || ""), u.pin))) fail("Current PIN is wrong");
    if (!/^\d{4}$/.test(String(next || ""))) fail("PIN must be 4 digits");
    await u.update({ pin: await bcrypt.hash(String(next), 10) });
    await audit(c, "Profile", "Changed PIN");
}

async function changePassword(c, current, next) {
    const u = await M.HotelUser.findOne({ where: { id: c.userId, hotel_id: c.hotelId } });
    if (!u.password || !(await bcrypt.compare(String(current || ""), u.password))) fail("Current password is wrong");
    if (String(next || "").length < 6) fail("Password needs at least 6 characters");
    await u.update({ password: await bcrypt.hash(String(next), 10) });
    await audit(c, "Profile", "Changed password");
}

/** Support ticket to BillerPe (plan change / renewal requests go the same way - owner decision). */
async function raiseTicket(c, subject, body, kind) {
    if (!String(subject || "").trim()) fail("Add a subject");
    const row = await M.RaiseTicket.create({
        hotel_id: c.hotelId, status: "new", priority: kind === "support" ? "low" : "medium",
        ticket_type: ["support", "plan-change", "renewal"].includes(kind) ? kind : "support",
        issue: `${String(subject).trim()}\n${String(body || "").trim()}\n\n— ${c.userName} (${c.role}), POS App`,
    });
    return { ticketId: String(row.id) };
}

async function markAlertsRead(c, ids) {
    const where = { hotel_id: c.hotelId, ...(ids === "all" ? {} : { id: (ids || []).map(Number) }) };
    const rows = await M.AppAlert.findAll({ where });
    for (const a of rows) {
        const read = (() => {
            try {
                return JSON.parse(a.read_by || "[]") || [];
            } catch {
                return [];
            }
        })();
        if (!read.map(Number).includes(c.userId)) await a.update({ read_by: JSON.stringify([...read, c.userId]) });
    }
}

module.exports = {
    saveStaff: { fn: saveStaff },
    setStaffActive: { fn: setStaffActive },
    setRoleDefaults: { fn: setRoleDefaults },
    setUserOverrides: { fn: setUserOverrides },
    updateSettings: { fn: updateSettings },
    updateOutlet: { fn: updateOutlet },
    saveTax: { fn: saveTax },
    deleteTax: { fn: deleteTax },
    saveCharge: { fn: saveCharge },
    savePaymentMode: { fn: savePaymentMode },
    removePaymentMode: { fn: removePaymentMode },
    savePromo: { fn: savePromo },
    deletePromo: { fn: deletePromo },
    saveKitchen: { fn: saveKitchen },
    deleteKitchen: { fn: deleteKitchen },
    resetTokens: { write: true, fn: resetTokens },
    logoutDevice: { fn: logoutDevice },
    saveDevicePrinters: { fn: saveDevicePrinters },
    changePin: { fn: changePin },
    changePassword: { fn: changePassword },
    raiseTicket: { fn: raiseTicket },
    markAlertsRead: { fn: markAlertsRead },
};
