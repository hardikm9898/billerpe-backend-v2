// Creates the "Hill Lock" demo restaurant with its owner login and demo data:
// menu categories, items, variants, addons, table categories and tables.
//
//   node scripts/seed-hill-lock.js --password <owner password>            dry run - checks, prints what it would create
//   node scripts/seed-hill-lock.js --password <owner password> --apply    creates it (one transaction: all or nothing)
//   ... --apply --plan-id 3    also attaches a subscription to plan 3
//
// The owner password is passed on the command line so it is never stored in git.
//
// Run it AFTER `npm run migrate`. It only ever inserts rows for the new
// restaurant and refuses to run if the owner number is already registered, so
// it can never touch an existing outlet's data.
//
// What a real registration (controller/hotel.js addHotelDetails) creates is
// mirrored here: the hotel, its settings, default menu, payment modes, charge
// rules, notification settings, role permission defaults, the owner (role "A")
// with full access. On top of that: GST (CGST + SGST 2.5% each), a default
// invoice format and the demo data below.
//
// The Redis caches need nothing: they are filled from the database on first
// read, and only ever appended to when the hotel's key already exists.

require("dotenv").config();
const bcrypt = require("bcrypt");
const moment = require("moment");

// Loads every model and its associations before the individual models are used.
const { sequelize } = require("../model");
const Hotel = require("../model/hotel");
const HotelUser = require("../model/hotelUser");
const Role = require("../model/role_mst");
const UserAccess = require("../model/userAccess");
const RestaurantSetting = require("../model/restaurantSetting");
const MenuCatalog = require("../model/menuCatalog");
const PaymentMode = require("../model/paymentMode");
const BillChargeRule = require("../model/billChargeRule");
const NotificationSetting = require("../model/notificationSetting");
const RolePermissionDefault = require("../model/rolePermissionDefault");
const TaxType = require("../model/taxType");
const InvoiceFormate = require("../model/invoiceFormate");
const Subscription = require("../model/subscription/subscription");
const Plan = require("../model/subscription/plan");
const Menu = require("../model/menu");
const Menu_categ = require("../model/menu_categ");
const Variants = require("../model/variants");
const MenuVariants = require("../model/menu_variant");
const AddonDepartment = require("../model/addonDepartMent");
const Addons = require("../model/addons");
const MenuAddon = require("../model/menu_addons");
const TableCatagories = require("../model/table_catg");
const Table = require("../model/table");
const { USER_ROLE } = require("../constant/const");
const { ROLES, ROLE_PERMISSION_DEFAULTS, ROLE_SPECIAL_DEFAULTS } = require("../constant/rolePermissionDefaults");

const APPLY = process.argv.includes("--apply");
const argValue = (flag) => {
    const i = process.argv.indexOf(flag);
    return i !== -1 ? process.argv[i + 1] : undefined;
};
const planArg = process.argv.indexOf("--plan-id");
const PLAN_ID = planArg !== -1 ? Number(process.argv[planArg + 1]) : null;

// ----------------------------------------------------------------- the data

const HOTEL = {
    name: "Hill Lock",
    ownerName: "Hill Lock Owner",
    ownerNumber: "1234567891",
    password: argValue("--password"),
    // Required by the hotel table; placeholders to replace from Settings.
    address1: "Hill Lock, demo address (update in settings)",
    pinCode: 380001,
};

// price is the "Full"/regular price; a variant's price replaces it when picked.
const CATEGORIES = [
    {
        name: "Starters",
        items: [
            { name: "Paneer Tikka", sku: "101", price: 220, variants: { Half: 130, Full: 220 }, addons: ["Spice Level"], favorite: true },
            { name: "Veg Manchurian", sku: "102", price: 180, addons: ["Spice Level"] },
            { name: "Crispy Corn", sku: "103", price: 160, addons: ["Spice Level"] },
            { name: "Hara Bhara Kebab", sku: "104", price: 190 },
        ],
    },
    {
        name: "Main Course",
        items: [
            { name: "Paneer Butter Masala", sku: "201", price: 240, variants: { Half: 140, Full: 240 }, addons: ["Spice Level", "Sides"], favorite: true },
            { name: "Dal Makhani", sku: "202", price: 200, variants: { Half: 120, Full: 200 }, addons: ["Sides"] },
            { name: "Veg Biryani", sku: "203", price: 210, addons: ["Spice Level", "Sides"] },
            { name: "Mix Veg", sku: "204", price: 180, variants: { Half: 110, Full: 180 }, addons: ["Sides"] },
            { name: "Jeera Rice", sku: "205", price: 120, addons: ["Sides"] },
        ],
    },
    {
        name: "Breads",
        items: [
            { name: "Butter Naan", sku: "301", price: 45, addons: ["Extra Toppings"] },
            { name: "Garlic Naan", sku: "302", price: 55, addons: ["Extra Toppings"] },
            { name: "Tandoori Roti", sku: "303", price: 25 },
            { name: "Laccha Paratha", sku: "304", price: 50, addons: ["Extra Toppings"] },
        ],
    },
    {
        name: "Beverages",
        items: [
            { name: "Masala Chai", sku: "401", price: 30, favorite: true },
            { name: "Cold Coffee", sku: "402", price: 90, variants: { Regular: 90, Large: 130 } },
            { name: "Fresh Lime Soda", sku: "403", price: 60 },
            { name: "Sweet Lassi", sku: "404", price: 70, variants: { Regular: 70, Large: 100 } },
        ],
    },
    {
        name: "Desserts",
        items: [
            { name: "Gulab Jamun (2 pcs)", sku: "501", price: 70 },
            { name: "Chocolate Brownie", sku: "502", price: 110 },
            { name: "Ice Cream Scoop", sku: "503", price: 80 },
        ],
    },
];

const VARIANTS = ["Half", "Full", "Regular", "Large"];

// max = most that can be picked, min = fewest; single = pick exactly one option.
const ADDON_GROUPS = [
    {
        name: "Extra Toppings", max: 3, min: 0, single: false,
        options: [["Extra Cheese", 30], ["Extra Butter", 20], ["Paneer Cubes", 40]],
    },
    {
        name: "Spice Level", max: 1, min: 0, single: true,
        options: [["Mild", 0], ["Medium", 0], ["Spicy", 0]],
    },
    {
        name: "Sides", max: 2, min: 0, single: false,
        options: [["Boondi Raita", 30], ["Papad", 15], ["Green Salad", 25]],
    },
];

// Tables are named prefix + number (G1, G2 ...), like the Bulk add dialog does.
const TABLE_CATEGORIES = [
    { name: "Ground Floor", prefix: "G", count: 6, seats: 4 },
    { name: "First Floor", prefix: "F", count: 5, seats: 4 },
    { name: "Terrace", prefix: "T", count: 4, seats: 6 },
    { name: "VIP Lounge", prefix: "V", count: 3, seats: 8 },
];

// ------------------------------------------------------------------ the run

const say = (msg) => console.log(msg);

async function main() {
    if (!HOTEL.password || HOTEL.password.length < 6 || HOTEL.password.startsWith("--")) {
        throw new Error("Pass the owner password (at least 6 characters): --password <password>");
    }
    const dbc = sequelize.config;
    say(`Database : ${dbc.host} / ${dbc.database}`);
    say(`Mode     : ${APPLY ? "APPLY (writes)" : "DRY RUN (no writes)"}`);

    // -- checks: never touch anything that already exists
    const existingHotel = await Hotel.findOne({ where: { owner_number: HOTEL.ownerNumber } });
    const existingUser = await HotelUser.findOne({ where: { number: HOTEL.ownerNumber } });
    const sameName = await Hotel.findOne({ where: { hotel_name: HOTEL.name } });
    if (existingHotel || existingUser) {
        throw new Error(`Owner number ${HOTEL.ownerNumber} is already registered - nothing was changed.`);
    }
    if (sameName) {
        throw new Error(`A restaurant named "${HOTEL.name}" already exists (id ${sameName.id}) - nothing was changed.`);
    }
    let plan = null;
    if (PLAN_ID) {
        plan = await Plan.findByPk(PLAN_ID);
        if (!plan) throw new Error(`Plan ${PLAN_ID} does not exist - nothing was changed.`);
    }
    // The rank column arrives with migration 20260920090000.
    const tableCategCols = await sequelize.getQueryInterface().describeTable("hms_table_categs");
    if (!tableCategCols.rank) {
        throw new Error("hms_table_categs has no `rank` column - run `npm run migrate` first.");
    }

    const itemCount = CATEGORIES.reduce((n, c) => n + c.items.length, 0);
    const tableCount = TABLE_CATEGORIES.reduce((n, c) => n + c.count, 0);
    say(
        `Will create restaurant "${HOTEL.name}" (owner ${HOTEL.ownerNumber}), ${CATEGORIES.length} menu categories, ` +
            `${itemCount} items, ${VARIANTS.length} variants, ${ADDON_GROUPS.length} addon groups, ` +
            `${TABLE_CATEGORIES.length} table categories with ${tableCount} tables` +
            (plan ? `, subscription on plan "${plan.name}"` : ", no subscription row") +
            ".",
    );
    if (!APPLY) {
        say("\nDry run only. Re-run with --apply to create it.");
        return;
    }

    const passwordHash = await bcrypt.hash(HOTEL.password, 10);
    const t = await sequelize.transaction();
    try {
        const starts = moment().startOf("day");
        const ends = moment().add(1, "year").endOf("day");
        const hotel = await Hotel.create(
            {
                hotel_name: HOTEL.name,
                owner_name: HOTEL.ownerName,
                owner_number: HOTEL.ownerNumber,
                address1: HOTEL.address1,
                pinCode: HOTEL.pinCode,
                hotel_logo: "",
                // Nothing reads this column; store the hash, never the plain text.
                password: passwordHash,
                hotel_reg_date: new Date(),
                plan_start_date: starts.toDate(),
                plan_end_date: ends.toDate(),
            },
            { transaction: t },
        );
        const hid = hotel.id;
        const by = HOTEL.name;

        await RestaurantSetting.create({ hotel_id: hid }, { transaction: t });
        const catalog = await MenuCatalog.create(
            { name: "Main Menu", hotel_id: hid, is_default: true, enter_by: by },
            { transaction: t },
        );
        await PaymentMode.bulkCreate(
            [
                { name: "Cash", hotel_id: hid, active: true, deletable: false, enter_by: by },
                { name: "UPI", hotel_id: hid, active: true, deletable: true, enter_by: by },
                { name: "Card", hotel_id: hid, active: true, deletable: true, enter_by: by },
                { name: "Due", hotel_id: hid, active: true, deletable: false, enter_by: by },
            ],
            { transaction: t },
        );
        await BillChargeRule.bulkCreate(
            [
                { rule_for: "delivery", hotel_id: hid, active: false, charge_type: "fixed", charge_value: 40, calculation_on: "core", charge_automatic: [], calculation_on_tax: false, greater_less: "3", greater_less_amount: 0, enter_by: by },
                { rule_for: "packaging", hotel_id: hid, active: true, charge_type: "fixed", charge_value: 15, calculation_on: "core", charge_automatic: ["pickup"], calculation_on_tax: false, greater_less: "3", greater_less_amount: 0, enter_by: by },
            ],
            { transaction: t },
        );
        await NotificationSetting.bulkCreate(
            [
                { trigger: "Order settled", hotel_id: hid, whatsapp: true, sms: false, in_app: true },
                { trigger: "KOT ready", hotel_id: hid, whatsapp: false, sms: false, in_app: true },
                { trigger: "Low stock", hotel_id: hid, whatsapp: true, sms: true, in_app: true },
                { trigger: "Sync failure", hotel_id: hid, whatsapp: false, sms: false, in_app: true },
                { trigger: "Cash variance", hotel_id: hid, whatsapp: true, sms: false, in_app: true },
                { trigger: "Reservation reminder", hotel_id: hid, whatsapp: true, sms: true, in_app: true },
            ],
            { transaction: t },
        );
        await RolePermissionDefault.bulkCreate(
            ROLES.map((roleName) => ({
                hotel_id: hid,
                role: roleName,
                permissions: ROLE_PERMISSION_DEFAULTS[roleName],
                special_permissions: ROLE_SPECIAL_DEFAULTS[roleName],
            })),
            { transaction: t },
        );

        // -- owner login
        const role = await Role.create({ role_name: USER_ROLE.ADMIN, hotel_id: hid }, { transaction: t });
        const owner = await HotelUser.create(
            {
                role_cd: role.role_cd,
                hotel_id: hid,
                number: HOTEL.ownerNumber,
                name: HOTEL.ownerName,
                email: "",
                active: true,
                password: passwordHash,
            },
            { transaction: t },
        );
        for (const access_name of ["Order", "Table", "Menu", "DashBoard", "Reports", "Biller", "User", "Booking", "Stock", "Expense", "Zomato"]) {
            await UserAccess.create(
                { access_name, read: true, create: true, edit: true, delete: true, hotel_id: hid, hotelUser_id: owner.id },
                { transaction: t },
            );
        }

        if (plan) {
            await Subscription.create(
                {
                    hotel_id: hid,
                    plan_id: plan.id,
                    start_date: starts.toDate(),
                    end_date: ends.toDate(),
                    subscription_extend_count: 0,
                },
                { transaction: t },
            );
        }

        // -- GST and invoice format: without a tax rule every bill has no GST
        await TaxType.bulkCreate(
            [
                { tax_name: "CGST", tax_value: "pr", amount: 2.5, order_type: [], hotel_id: hid, active: true },
                { tax_name: "SGST", tax_value: "pr", amount: 2.5, order_type: [], hotel_id: hid, active: true },
            ],
            { transaction: t },
        );
        await InvoiceFormate.create({ hotel_id: hid }, { transaction: t });

        // -- variants and addons (all in the Main Menu catalogue)
        const variantId = {};
        for (const name of VARIANTS) {
            const v = await Variants.create(
                { variants_name: name, active: true, hotel_id: hid, menu_catalog_id: catalog.id },
                { transaction: t },
            );
            variantId[name] = v.id;
        }
        const addonGroupId = {};
        for (const g of ADDON_GROUPS) {
            const dept = await AddonDepartment.create(
                {
                    department_name: g.name,
                    maximum_allowed_addon: g.max,
                    minimum_allowed_addon: g.min,
                    singleSelection: g.single,
                    hotel_id: hid,
                    menu_catalog_id: catalog.id,
                },
                { transaction: t },
            );
            addonGroupId[g.name] = dept.id;
            await Addons.bulkCreate(
                g.options.map(([addon_name, price]) => ({ addon_name, price, attributes: "veg", department_id: dept.id, hotel_id: hid })),
                { transaction: t },
            );
        }

        // -- categories and items
        let rank = 0;
        for (const cat of CATEGORIES) {
            rank += 1;
            const category = await Menu_categ.create(
                { menu_categ_nm: cat.name, hotel_id: hid, enter_by: by, rank, menu_catalog_id: catalog.id },
                { transaction: t },
            );
            for (const item of cat.items) {
                const menu = await Menu.create(
                    {
                        item_name: item.name,
                        price: String(item.price),
                        shortCode: item.sku,
                        description: "",
                        sub_categories: "Regular Veg",
                        favorite: !!item.favorite,
                        menu_categ_id: category.id,
                        hotel_id: hid,
                        enter_by: by,
                    },
                    { transaction: t },
                );
                for (const [vName, vPrice] of Object.entries(item.variants ?? {})) {
                    await MenuVariants.create(
                        { menu_id: menu.id, variant_id: variantId[vName], variant_price: vPrice, hotel_id: hid },
                        { transaction: t },
                    );
                }
                for (const gName of item.addons ?? []) {
                    await MenuAddon.create(
                        { menu_id: menu.id, addon_department_id: addonGroupId[gName], hotel_id: hid, active: true },
                        { transaction: t },
                    );
                }
            }
        }

        // -- table categories and tables
        let tRank = 0;
        for (const tc of TABLE_CATEGORIES) {
            tRank += 1;
            const category = await TableCatagories.create(
                { type: "T", table_catag_nm: tc.name, hotel_id: hid, rank: tRank },
                { transaction: t },
            );
            for (let i = 1; i <= tc.count; i += 1) {
                await Table.create(
                    { table_name: `${tc.prefix}${i}`, type: "T", table_catag_id: category.id, hotel_id: hid, capacity: tc.seats },
                    { transaction: t },
                );
            }
        }

        await t.commit();
        say(`\nDone. Hill Lock created as restaurant id ${hid}, owner user id ${owner.id}.`);
        say(`Log in with mobile ${HOTEL.ownerNumber} and the password you set.`);
    } catch (err) {
        await t.rollback();
        throw err;
    }
}

main()
    .then(() => sequelize.close())
    .catch(async (err) => {
        console.error(`\nFAILED: ${err.message}`);
        await sequelize.close().catch(() => {});
        process.exit(1);
    });
