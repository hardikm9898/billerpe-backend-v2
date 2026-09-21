// Creates a restaurant and its owner login from the command line, with the
// same starting data the SuperAdmin "add restaurant" screen gives
// (controller/hotel.js addHotelDetails): settings, default "Main Menu",
// payment modes, charge rules, notification settings, role permission
// templates, the Admin role, the owner's login and full access rows.
//
//   node scripts/create-restaurant.js --name "Hill Lock" \
//        --owner-number 1234567891 --password 123456 \
//        [--owner-name "Full Name"] [--address "..."] [--pin 380001] \
//        [--email a@b.c] [--plan-id 2] [--dry-run]
//
// Everything runs in one transaction - a failure leaves nothing behind.
// No subscription is created unless --plan-id is given (billing is a
// business decision; add one from the SuperAdmin panel). No payment record
// is ever created here. Address, pin code and owner name can be edited later
// from the SuperAdmin restaurant screen.
//
// If addHotelDetails changes what a new restaurant is seeded with, mirror
// it here.
const bcrypt = require("bcrypt");
const moment = require("moment");
const sequelize = require("../connection/connect");
const Hotel = require("../model/hotel");
const HotelUser = require("../model/hotelUser");
const Role = require("../model/role_mst");
const UserAccess = require("../model/userAccess");
const Subscription = require("../model/subscription/subscription");
const Plan = require("../model/subscription/plan");
const MenuCatalog = require("../model/menuCatalog");
const PaymentMode = require("../model/paymentMode");
const BillChargeRule = require("../model/billChargeRule");
const NotificationSetting = require("../model/notificationSetting");
const RolePermissionDefault = require("../model/rolePermissionDefault");
const { RestaurantSetting } = require("../model");
const { USER_ROLE } = require("../constant/const");
const { ROLES, ROLE_PERMISSION_DEFAULTS, ROLE_SPECIAL_DEFAULTS } = require("../constant/rolePermissionDefaults");

function arg(name, fallback = null) {
    const i = process.argv.indexOf(`--${name}`);
    return i !== -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : fallback;
}

const ACCESS_AREAS = ["Order", "Table", "Menu", "DashBoard", "Reports", "Biller", "User", "Booking", "Stock", "Expense", "Zomato"];

(async () => {
    const name = (arg("name") || "").trim();
    const ownerNumber = (arg("owner-number") || "").trim();
    const password = arg("password");
    const ownerName = (arg("owner-name") || `${name} Owner`).trim();
    const address = (arg("address") || "Address not set").trim();
    const pinCode = Number(arg("pin", "0")) || 0;
    const email = arg("email");
    const planId = arg("plan-id");
    const dryRun = process.argv.includes("--dry-run");

    if (!name || !ownerNumber || !password) {
        console.error('usage: node scripts/create-restaurant.js --name "<restaurant>" --owner-number <10 digits> --password <password> [--owner-name ...] [--address ...] [--pin ...] [--email ...] [--plan-id N] [--dry-run]');
        process.exit(1);
    }
    if (!/^\d{10}$/.test(ownerNumber)) {
        console.error("owner number must be exactly 10 digits");
        process.exit(1);
    }
    if (password.length < 6) {
        console.error("password must be at least 6 characters");
        process.exit(1);
    }

    await sequelize.authenticate();
    console.log(`database: ${sequelize.config.host}/${sequelize.config.database}`);

    if (await Hotel.findOne({ where: { owner_number: ownerNumber } }) || await HotelUser.findOne({ where: { number: ownerNumber } })) {
        console.error(`a restaurant or user with number ${ownerNumber} already exists - nothing created`);
        await sequelize.close();
        process.exit(1);
    }
    const sameName = await Hotel.findAll({ where: { hotel_name: name }, attributes: ["id", "owner_number"] });
    if (sameName.length) console.warn(`note: ${sameName.length} restaurant(s) already named "${name}" (ids ${sameName.map((h) => h.id).join(", ")})`);
    let plan = null;
    if (planId) {
        plan = await Plan.findByPk(Number(planId));
        if (!plan) {
            console.error(`plan ${planId} not found - nothing created`);
            await sequelize.close();
            process.exit(1);
        }
    }

    console.log(`will create: "${name}", owner ${ownerName} (${ownerNumber})${plan ? `, plan "${plan.name}"` : ", no subscription"}`);
    if (dryRun) {
        console.log("dry run - nothing written");
        await sequelize.close();
        return;
    }

    const hashed = await bcrypt.hash(password, 10);
    const t = await sequelize.transaction();
    try {
        const hotel = await Hotel.create({
            hotel_name: name,
            owner_name: ownerName,
            owner_number: ownerNumber,
            owner_email_id: email,
            address1: address,
            pinCode,
            hotel_logo: "",
            password: hashed,
            hotel_reg_date: new Date(),
        }, { transaction: t });
        const hotel_id = hotel.id;
        const enter_by = name;

        await RestaurantSetting.create({ hotel_id }, { transaction: t });
        await MenuCatalog.create({ name: "Main Menu", hotel_id, is_default: true, enter_by }, { transaction: t });
        await PaymentMode.bulkCreate([
            { name: "Cash", hotel_id, active: true, deletable: false, enter_by },
            { name: "UPI", hotel_id, active: true, deletable: true, enter_by },
            { name: "Card", hotel_id, active: true, deletable: true, enter_by },
            { name: "Due", hotel_id, active: true, deletable: false, enter_by },
        ], { transaction: t });
        await BillChargeRule.bulkCreate([
            { rule_for: "delivery", hotel_id, active: false, charge_type: "fixed", charge_value: 40, calculation_on: "core", charge_automatic: [], calculation_on_tax: false, greater_less: "3", greater_less_amount: 0, enter_by },
            { rule_for: "packaging", hotel_id, active: true, charge_type: "fixed", charge_value: 15, calculation_on: "core", charge_automatic: ["pickup"], calculation_on_tax: false, greater_less: "3", greater_less_amount: 0, enter_by },
        ], { transaction: t });
        await NotificationSetting.bulkCreate([
            { trigger: "Order settled", hotel_id, whatsapp: true, sms: false, in_app: true },
            { trigger: "KOT ready", hotel_id, whatsapp: false, sms: false, in_app: true },
            { trigger: "Low stock", hotel_id, whatsapp: true, sms: true, in_app: true },
            { trigger: "Sync failure", hotel_id, whatsapp: false, sms: false, in_app: true },
            { trigger: "Cash variance", hotel_id, whatsapp: true, sms: false, in_app: true },
            { trigger: "Reservation reminder", hotel_id, whatsapp: true, sms: true, in_app: true },
        ], { transaction: t });
        await RolePermissionDefault.bulkCreate(
            ROLES.map((roleName) => ({
                hotel_id,
                role: roleName,
                permissions: ROLE_PERMISSION_DEFAULTS[roleName],
                special_permissions: ROLE_SPECIAL_DEFAULTS[roleName],
            })),
            { transaction: t },
        );
        const role = await Role.create({ role_name: USER_ROLE.ADMIN, hotel_id }, { transaction: t });
        const owner = await HotelUser.create({
            role_cd: role.role_cd, hotel_id, email, number: ownerNumber, name: ownerName, active: true, password: hashed,
        }, { transaction: t });
        for (const access_name of ACCESS_AREAS) {
            await UserAccess.create({ access_name, read: true, create: true, edit: true, delete: true, hotel_id, hotelUser_id: owner.id }, { transaction: t });
        }
        if (plan) {
            const start = moment().startOf("day");
            await Subscription.create({
                discountrate: 0, hotel_id, plan_id: plan.id,
                start_date: start.toDate(), end_date: moment(start).add(plan.duration_days || 365, "days").toDate(),
                subTotal: 0, discount: 0, gst: 0, gst_calculated: 0, grandAmount: 0, subscription_extend_count: 0,
            }, { transaction: t });
        }
        await t.commit();
        console.log(`created restaurant id ${hotel_id} "${name}"; owner login ${ownerNumber} (user id ${owner.id})`);
        console.log("next: set the real address, pin code and owner name from the SuperAdmin restaurant screen.");
    } catch (err) {
        await t.rollback();
        console.error("failed - rolled back, nothing was created:", err.message);
        process.exitCode = 1;
    }
    await sequelize.close();
})().catch((err) => {
    console.error("failed:", err.message);
    process.exit(1);
});
