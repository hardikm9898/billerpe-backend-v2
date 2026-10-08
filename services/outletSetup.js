const Role = require("../model/role_mst");
const HotelUser = require("../model/hotelUser");
const UserAccess = require("../model/userAccess");
const MenuCatalog = require("../model/menuCatalog");
const PaymentMode = require("../model/paymentMode");
const BillChargeRule = require("../model/billChargeRule");
const NotificationSetting = require("../model/notificationSetting");
const RolePermissionDefault = require("../model/rolePermissionDefault");
const { RestaurantSetting } = require("../model");
const { USER_ROLE } = require("../constant/const");
const { ROLES, ROLE_PERMISSION_DEFAULTS, ROLE_SPECIAL_DEFAULTS } = require("../constant/rolePermissionDefaults");

// Everything a new outlet starts with, after its hotel_registrations row:
// settings, the default menu, payment modes, bill charges, notification
// triggers, role permissions, and the owner's login (role "A", every access).
// Shared by the old add-restaurant call (controller/hotel.js addHotelDetails)
// and the SuperAdmin's "Mark won -> create outlet", so both seed the same.
//
// owner = { name, number, email, passwordHash }. `t` = optional transaction.
async function seedOutlet(hotel, owner, { createdBy = null, transaction: t } = {}) {
    const o = t ? { transaction: t } : {};
    await RestaurantSetting.create({ hotel_id: hotel.id }, o);
    // Every hotel needs exactly one default menu catalogue to exist - the
    // same backfill migration 20260901120200 gives every pre-existing hotel.
    await MenuCatalog.create({ name: "Main Menu", hotel_id: hotel.id, is_default: true, enter_by: hotel.hotel_name }, o);
    // Same 4 defaults billerpe-pos-pro-v2's own mock/ops-seed.ts starts
    // with (Cash/Due protected, UPI/Card removable) - matches migration
    // 20260902090000's backfill for every pre-existing hotel.
    await PaymentMode.bulkCreate([
        { name: "Cash", hotel_id: hotel.id, active: true, deletable: false, enter_by: hotel.hotel_name },
        { name: "UPI", hotel_id: hotel.id, active: true, deletable: true, enter_by: hotel.hotel_name },
        { name: "Card", hotel_id: hotel.id, active: true, deletable: true, enter_by: hotel.hotel_name },
        { name: "Due", hotel_id: hotel.id, active: true, deletable: false, enter_by: hotel.hotel_name },
    ], o);
    // Same defaults as mock/ops-seed.ts's deliveryChargeRule/
    // packagingChargeRule - matches migration 20260902100000's backfill.
    await BillChargeRule.bulkCreate([
        { rule_for: "delivery", hotel_id: hotel.id, active: false, charge_type: "fixed", charge_value: 40, calculation_on: "core", charge_automatic: [], calculation_on_tax: false, greater_less: "3", greater_less_amount: 0, enter_by: hotel.hotel_name },
        { rule_for: "packaging", hotel_id: hotel.id, active: true, charge_type: "fixed", charge_value: 15, calculation_on: "core", charge_automatic: ["pickup"], calculation_on_tax: false, greater_less: "3", greater_less_amount: 0, enter_by: hotel.hotel_name },
    ], o);
    // Same 6 triggers/defaults as mock/data.ts's notificationSettings -
    // matches migration 20260902110000's backfill.
    await NotificationSetting.bulkCreate([
        { trigger: "Order settled", hotel_id: hotel.id, whatsapp: true, sms: false, in_app: true },
        { trigger: "KOT ready", hotel_id: hotel.id, whatsapp: false, sms: false, in_app: true },
        { trigger: "Low stock", hotel_id: hotel.id, whatsapp: true, sms: true, in_app: true },
        { trigger: "Sync failure", hotel_id: hotel.id, whatsapp: false, sms: false, in_app: true },
        { trigger: "Cash variance", hotel_id: hotel.id, whatsapp: true, sms: false, in_app: true },
        { trigger: "Reservation reminder", hotel_id: hotel.id, whatsapp: true, sms: true, in_app: true },
    ], o);
    // Same role-level permission template as mock/data.ts's
    // ROLE_PERMISSION_DEFAULTS/ROLE_SPECIAL_DEFAULTS - matches migration
    // 20260903120000's backfill.
    await RolePermissionDefault.bulkCreate(
        ROLES.map((roleName) => ({
            hotel_id: hotel.id,
            role: roleName,
            permissions: ROLE_PERMISSION_DEFAULTS[roleName],
            special_permissions: ROLE_SPECIAL_DEFAULTS[roleName],
        })),
        o,
    );
    const role = await Role.create({ role_name: USER_ROLE.ADMIN, hotel_id: hotel.id }, o);
    const user = await HotelUser.create({ created_by: createdBy, role_cd: role.role_cd, hotel_id: hotel.id, email: owner.email, number: owner.number, name: owner.name, active: true, password: owner.passwordHash }, o);

    const access = ["Order", "Table", "Menu", "DashBoard", "Reports", "Biller", "User", "Booking", "Stock", "Expense", "Zomato"];
    for (const name of access) {
        await UserAccess.create({ access_name: name, read: true, create: true, edit: true, delete: true, hotel_id: hotel.id, hotelUser_id: user.id }, o);
    }
    return { role, user };
}

module.exports = { seedOutlet };
