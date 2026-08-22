const { DataTypes } = require("sequelize");
const sequelize = require("../connection/connect");

// ============================================================================
// MODEL IMPORTS
// ============================================================================

// Core Models
const Hotel = require("./hotel");
const Merchant = require("./merchant");
const User = require("./user");
const HotelUser = require("./hotelUser");
const Role = require("./role_mst");
const UserAccess = require("./userAccess");

// Table Management
const Table = require("./table");
const TableCatagories = require("./table_catg");
const TableBooking = require("./tablebooking");

// Menu & Category
const Menu = require("./menu");
const Menu_categ = require("./menu_categ");
const MenuVariants = require("./menu_variant");
const Variants = require("./variants");

// Addons
const AddonDepartment = require("./addonDepartMent");
const Addons = require("./addons");
const MenuAddon = require("./menu_addons");

// Orders
const Order = require("./order");
const OrderDetails = require("./order_details");
const OrderTax = require("./orderTax");
const OnlineOrders = require("./onlineOrder");
const OnlineOrderDetails = require("./onlineOrderDetails");

// Inventory & Stock Management
const RawMaterial = require("./rawItem");
const Unit = require("./unit");
const StockHistory = require("./stockHistory");
const StockInHand = require("./stockInHand");
const Recipes = require("./recipes");

// Purchase Management
const PurchaseOrder = require("./Inventory/purchaseOrder");
const PurchaseOrderPayment = require("./Inventory/purchaseOrderPayment");
const PurchaseRawMaterial = require("./Inventory/purchaseRawMaterial");
const RawMaterialConsumption = require("./Inventory/RawMaterialcon");
const Supplier = require("./Inventory/supplyer");

// Financial
const DuePaymentReceive = require("./duePayment");
const ExpenseEntry = require("./expenseEnty");
const ExpenseHead = require("./expenseHead");
const EBillCredit = require("./ebillCredit");
const EBillCreditDebit = require("./ebillCreditDebit");
const ServiceCharge = require("./serviceCharge");
const TaxType = require("./taxType");

// Subscription & Payments
const Plan = require("./subscription/plan");
const Subscription = require("./subscription/subscription");
const SubscriptionPayment = require("./subscription/subscriptionPayment");
const PhonePayPaymentLink = require("./paymentLink");

// Settings & Configuration
const KitchenSetting = require("./kitchen");
const PrinterSetting = require("./printer_setting");
const InvoiceFormate = require("./invoiceFormate");

// Marketing & Promotions
const PromoCode = require("./promoCode");
const DiscountCode = require("./discountCoupens");

// Website & E-commerce
const webSiteUserData = require("./webSiteUserData");
const websiteProducts = require("./webSiteProducts");
const TempWebsitePurchase = require("./PurchaseFromWebSite");
const PurchaseRollsAndPrinter = require("./purchaseRolls");

// Admin & Miscellaneous
const AdminAddRestoSave = require("./adminAddRestoSave");
const AdminCart = require("./adminCart");
const Cart = require("./cart");
const superAdminModel = require("./superAdminModel");
const SuperAdminUser = require("./superAdminUser");
const TimeLine = require("./timeline");
const Testing = require("./testing");
const AppUpdate = require("./updateApp");
const Images = require("./images");

// ============================================================================
// ASSOCIATIONS
// ============================================================================

// ----------------------------------------------------------------------------
// MERCHANT & HOTEL ASSOCIATIONS
// ----------------------------------------------------------------------------
Merchant.hasMany(Hotel, { foreignKey: "merchant_id", onDelete: "CASCADE" });
Hotel.belongsTo(Merchant, { foreignKey: "merchant_id", onDelete: "CASCADE" });

// ----------------------------------------------------------------------------
// TABLE MANAGEMENT ASSOCIATIONS
// ----------------------------------------------------------------------------
// Table Categories -> Tables
TableCatagories.hasMany(Table, { foreignKey: 'table_catag_id' });
Table.belongsTo(TableCatagories, { foreignKey: 'table_catag_id' });

// Hotel -> Table Categories
Hotel.hasMany(TableCatagories, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
TableCatagories.belongsTo(Hotel, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

// Hotel -> Tables
Hotel.hasMany(Table, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
Table.belongsTo(Hotel, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

// Table Bookings
Table.hasOne(TableBooking, { foreignKey: 'TableId', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
TableBooking.belongsTo(Table, { foreignKey: 'TableId', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

User.hasMany(TableBooking, { foreignKey: 'UserId', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
TableBooking.belongsTo(User, { foreignKey: 'UserId', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

Hotel.hasMany(TableBooking, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
TableBooking.belongsTo(Hotel, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

// ----------------------------------------------------------------------------
// MENU & CATEGORY ASSOCIATIONS
// ----------------------------------------------------------------------------
// Menu Categories
Hotel.hasMany(Menu_categ, { foreignKey: 'hotel_id' });
Menu_categ.belongsTo(Hotel, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

Menu_categ.hasMany(Menu, { foreignKey: 'menu_categ_id' });
Menu.belongsTo(Menu_categ, { foreignKey: 'menu_categ_id' });

// Menu
Hotel.hasMany(Menu, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
Menu.belongsTo(Hotel, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

// Menu Variants (Many-to-Many)
Variants.belongsToMany(Menu, { through: "hms_menu_variant_mst", foreignKey: "variant_id", as: "menuData" });
Menu.belongsToMany(Variants, { through: "hms_menu_variant_mst", as: "variantData", foreignKey: "menu_id" });

// Menu Variants Junction Table
Hotel.hasMany(MenuVariants, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
MenuVariants.belongsTo(Hotel, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

MenuVariants.belongsTo(Variants, { foreignKey: 'variant_id' });
Variants.hasMany(MenuVariants, { foreignKey: 'variant_id' });

MenuVariants.belongsTo(Menu, { foreignKey: 'menu_id' });
Menu.hasMany(MenuVariants, { foreignKey: 'menu_id' });

// Variants
Hotel.hasMany(Variants, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
Variants.belongsTo(Hotel, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

// ----------------------------------------------------------------------------
// ADDON ASSOCIATIONS
// ----------------------------------------------------------------------------
// Addon Departments
Hotel.hasMany(AddonDepartment, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
AddonDepartment.belongsTo(Hotel, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

// Addons
AddonDepartment.hasMany(Addons, { foreignKey: 'department_id', onDelete: "CASCADE", onUpdate: "CASCADE" });
Addons.belongsTo(AddonDepartment, { foreignKey: 'department_id', onDelete: "SET NULL", onUpdate: "CASCADE" });

Hotel.hasMany(Addons, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
Addons.belongsTo(Hotel, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

// Menu <-> Addon Department (Many-to-Many)
AddonDepartment.belongsToMany(Menu, { through: "hms_menu_addon_mst", foreignKey: "addon_department_id", as: "menuData", onDelete: "SET NULL", onUpdate: "CASCADE" });
Menu.belongsToMany(AddonDepartment, { through: "hms_menu_addon_mst", as: "addonDepartmentData", foreignKey: "menu_id", onDelete: "SET NULL", onUpdate: "CASCADE" });

// Menu Addons Junction Table
MenuAddon.belongsTo(AddonDepartment, { foreignKey: 'addon_department_id' });
AddonDepartment.hasMany(MenuAddon, { foreignKey: 'addon_department_id' });

MenuAddon.belongsTo(Menu, { foreignKey: 'menu_id' });
Menu.hasMany(AddonDepartment, { foreignKey: 'menu_id' });

Hotel.hasMany(MenuAddon, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
MenuAddon.belongsTo(Hotel, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

// ----------------------------------------------------------------------------
// USER & ROLE ASSOCIATIONS
// ----------------------------------------------------------------------------
// Users
Hotel.hasMany(User, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
User.belongsTo(Hotel, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

// Roles
Hotel.hasMany(Role, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
Role.belongsTo(Hotel, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

Role.hasMany(HotelUser, { foreignKey: 'role_cd', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
HotelUser.belongsTo(Role, { foreignKey: 'role_cd', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

// Hotel Users
Hotel.hasMany(HotelUser, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
HotelUser.belongsTo(Hotel, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

// User Access
Hotel.hasMany(UserAccess, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
UserAccess.belongsTo(Hotel, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

HotelUser.hasMany(UserAccess, { foreignKey: 'hotelUser_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
UserAccess.belongsTo(HotelUser, { foreignKey: 'hotelUser_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

// ----------------------------------------------------------------------------
// ORDER ASSOCIATIONS
// ----------------------------------------------------------------------------
// Orders
Hotel.hasMany(Order, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
Order.belongsTo(Hotel, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

Table.hasMany(Order, { foreignKey: 'TableId', onDelete: "SET NULL", onUpdate: 'CASCADE' });
Order.belongsTo(Table, { foreignKey: 'TableId', onDelete: "SET NULL", onUpdate: 'CASCADE' });

User.hasMany(Order, { foreignKey: 'UserId', onDelete: "SET NULL", onUpdate: 'CASCADE' });
Order.belongsTo(User, { foreignKey: 'UserId', onDelete: "SET NULL", onUpdate: 'CASCADE' });

HotelUser.hasMany(Order, { foreignKey: 'hotelUserId', onDelete: "SET NULL", onUpdate: 'CASCADE' });
Order.belongsTo(HotelUser, { foreignKey: 'hotelUserId', onDelete: "SET NULL", onUpdate: 'CASCADE' });

// Order Details
Order.hasMany(OrderDetails, { foreignKey: 'orderId', onDelete: "SET NULL", onUpdate: 'CASCADE' });
OrderDetails.belongsTo(Order, { foreignKey: "orderId", as: "order", onDelete: "SET NULL", onUpdate: 'CASCADE' });

Hotel.hasMany(OrderDetails, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
OrderDetails.belongsTo(Hotel, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

OrderDetails.belongsTo(User, { foreignKey: "UserId", onDelete: "SET NULL", onUpdate: 'CASCADE' });
User.hasMany(OrderDetails, { foreignKey: "UserId", onDelete: "SET NULL", onUpdate: 'CASCADE' });

OrderDetails.belongsTo(Table, { foreignKey: "TableId", onDelete: "SET NULL", onUpdate: 'CASCADE' });
Table.hasMany(OrderDetails, { foreignKey: "TableId", onDelete: "SET NULL", onUpdate: 'CASCADE' });

OrderDetails.belongsTo(Menu, { foreignKey: "MenuId" });
Menu.hasMany(Menu, { foreignKey: "MenuId" });

OrderDetails.belongsTo(Variants, { foreignKey: "variant_id", as: "variantData" });
Variants.hasMany(OrderDetails, { foreignKey: "variant_id", as: "variantData" });

// Order Tax
Hotel.hasMany(OrderTax, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
OrderTax.belongsTo(Hotel, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

OrderTax.belongsTo(Order, { foreignKey: "hmsOrderMstId" });
Order.hasMany(OrderTax, { foreignKey: "hmsOrderMstId" });

OrderTax.belongsTo(TaxType, { foreignKey: "hmsTaxTypeMstId" });
TaxType.hasMany(OrderTax, { foreignKey: "hmsTaxTypeMstId" });

// Online Orders
Hotel.hasMany(OnlineOrders, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
OnlineOrders.belongsTo(Hotel, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

OnlineOrders.hasMany(OnlineOrderDetails, { foreignKey: 'orderId', onDelete: "SET NULL", onUpdate: 'CASCADE' });
OnlineOrderDetails.belongsTo(OnlineOrders, { foreignKey: "orderId", as: "order", onDelete: "SET NULL", onUpdate: 'CASCADE' });

Hotel.hasMany(OnlineOrderDetails, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
OnlineOrderDetails.belongsTo(Hotel, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

// ----------------------------------------------------------------------------
// INVENTORY & STOCK ASSOCIATIONS
// ----------------------------------------------------------------------------
// Units
Hotel.hasMany(Unit, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
Unit.belongsTo(Hotel, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

// Raw Materials
Hotel.hasMany(RawMaterial, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
RawMaterial.belongsTo(Hotel, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

// Raw Material -> Unit Relations
Unit.hasMany(RawMaterial, { as: "purchaseUnit", foreignKey: 'unit_id' });
RawMaterial.belongsTo(Unit, { as: "purchaseUnit", foreignKey: 'unit_id' });

Unit.hasMany(RawMaterial, { as: "consumptionUnit", foreignKey: 'consumption_unit' });
RawMaterial.belongsTo(Unit, { as: "consumptionUnit", foreignKey: 'consumption_unit' });

Unit.hasMany(RawMaterial, { as: "minimumStockUnit", foreignKey: 'minimum_stock_level_unit' });
RawMaterial.belongsTo(Unit, { as: "minimumStockUnit", foreignKey: 'minimum_stock_level_unit' });

// Stock History
Hotel.hasMany(StockHistory, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
StockHistory.belongsTo(Hotel, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

RawMaterial.hasMany(StockHistory, { foreignKey: 'raw_material_id' });
StockHistory.belongsTo(RawMaterial, { foreignKey: 'raw_material_id' });

HotelUser.hasMany(StockHistory, { foreignKey: 'user_id' });

// Stock In Hand
Hotel.hasMany(StockInHand, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
StockInHand.belongsTo(Hotel, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

RawMaterial.hasOne(StockInHand, { foreignKey: 'raw_material_id' });
StockInHand.belongsTo(RawMaterial, { foreignKey: 'raw_material_id' });

// Recipes
Hotel.hasMany(Recipes, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
Recipes.belongsTo(Hotel, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

Menu.hasMany(Recipes, { as: "menu", foreignKey: 'menu_id' });
Recipes.belongsTo(Menu, { as: "menu", foreignKey: 'menu_id' });

RawMaterial.hasMany(Recipes, { as: "rawMaterial", foreignKey: 'raw_material_id' });
Recipes.belongsTo(RawMaterial, { as: "rawMaterial", foreignKey: 'raw_material_id' });

// ----------------------------------------------------------------------------
// PURCHASE MANAGEMENT ASSOCIATIONS
// ----------------------------------------------------------------------------
// Suppliers
Hotel.hasMany(Supplier, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
Supplier.belongsTo(Hotel, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

// Purchase Orders
Hotel.hasMany(PurchaseOrder, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
PurchaseOrder.belongsTo(Hotel, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

HotelUser.hasMany(PurchaseOrder, { foreignKey: 'userId', onDelete: "SET NULL", onUpdate: 'CASCADE' });
PurchaseOrder.belongsTo(HotelUser, { foreignKey: 'userId', onDelete: "SET NULL", onUpdate: 'CASCADE' });

Supplier.hasMany(PurchaseOrder, { foreignKey: 'supplier_id' });
PurchaseOrder.belongsTo(Supplier, { foreignKey: 'supplier_id' });

// Purchase Order Payments
Hotel.hasMany(PurchaseOrderPayment, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
PurchaseOrderPayment.belongsTo(Hotel, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

PurchaseOrder.hasMany(PurchaseOrderPayment, { foreignKey: "purchaseOrderId", onDelete: "SET NULL", onUpdate: 'CASCADE' });
PurchaseOrderPayment.belongsTo(PurchaseOrder, { foreignKey: "purchaseOrderId" });

HotelUser.hasMany(PurchaseOrderPayment, { foreignKey: 'userId', onDelete: "SET NULL", onUpdate: 'CASCADE' });
PurchaseOrderPayment.belongsTo(HotelUser, { foreignKey: 'userId', onDelete: "SET NULL", onUpdate: 'CASCADE' });

// Purchase Raw Materials
Hotel.hasMany(PurchaseRawMaterial, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
PurchaseRawMaterial.belongsTo(Hotel, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

PurchaseOrder.hasMany(PurchaseRawMaterial, { foreignKey: 'purchaseOrderId', onDelete: "SET NULL", onUpdate: 'CASCADE' });
PurchaseRawMaterial.belongsTo(PurchaseOrder, { foreignKey: "purchaseOrderId", as: "purchaseOrder", onDelete: "SET NULL", onUpdate: 'CASCADE' });

RawMaterial.hasMany(PurchaseRawMaterial, { foreignKey: "raw_material_id", as: "purchases", onDelete: "SET NULL", onUpdate: "CASCADE" });
PurchaseRawMaterial.belongsTo(RawMaterial, { foreignKey: "raw_material_id", as: "rawMaterial" });

Unit.hasMany(PurchaseRawMaterial, { foreignKey: "unit_id", onDelete: "SET NULL", onUpdate: "CASCADE" });
PurchaseRawMaterial.belongsTo(Unit, { foreignKey: "unit_id", onDelete: "SET NULL", onUpdate: "CASCADE" });

// Raw Material Consumption
Hotel.hasMany(RawMaterialConsumption, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
RawMaterialConsumption.belongsTo(Hotel, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

RawMaterial.hasMany(RawMaterialConsumption, { foreignKey: "raw_material_id", as: "consumptions", onDelete: "SET NULL", onUpdate: "CASCADE" });
RawMaterialConsumption.belongsTo(RawMaterial, { foreignKey: "raw_material_id", as: "rawMaterial" });

Order.hasMany(RawMaterialConsumption, { foreignKey: "order_id", as: "consumptionRawMaterial", onDelete: "SET NULL", onUpdate: "CASCADE" });
RawMaterialConsumption.belongsTo(Order, { foreignKey: "order_id", as: "order", onDelete: "SET NULL", onUpdate: "CASCADE" });

Unit.hasMany(RawMaterialConsumption, { foreignKey: "unit_id", as: "consumptions", onDelete: "SET NULL", onUpdate: "CASCADE" });
RawMaterialConsumption.belongsTo(Unit, { foreignKey: "unit_id", as: "unit" });

HotelUser.hasMany(RawMaterialConsumption, { foreignKey: "user_id", as: "consumptions", onDelete: "SET NULL", onUpdate: "CASCADE" });
RawMaterialConsumption.belongsTo(HotelUser, { foreignKey: "user_id", as: "user" });

// ----------------------------------------------------------------------------
// FINANCIAL ASSOCIATIONS
// ----------------------------------------------------------------------------
// Tax Types
Hotel.hasMany(TaxType, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
TaxType.belongsTo(Hotel, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

// Service Charge
Hotel.hasOne(ServiceCharge, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
ServiceCharge.belongsTo(Hotel, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

// Expense Head
Hotel.hasMany(ExpenseHead, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
ExpenseHead.belongsTo(Hotel, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

// Expense Entry
Hotel.hasMany(ExpenseEntry, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
ExpenseEntry.belongsTo(Hotel, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

ExpenseEntry.belongsTo(ExpenseHead, { foreignKey: 'expense_head_id' });
ExpenseHead.hasMany(ExpenseEntry, { foreignKey: 'expense_head_id', onDelete: 'SET NULL' });

HotelUser.hasMany(ExpenseEntry, { foreignKey: 'user_id' });

// Due Payment
Hotel.hasMany(DuePaymentReceive, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
DuePaymentReceive.belongsTo(Hotel, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

DuePaymentReceive.belongsTo(User, { foreignKey: 'user_id' });
User.hasMany(DuePaymentReceive, { foreignKey: 'user_id' });

DuePaymentReceive.belongsTo(Order, { foreignKey: "order_id" });
Order.hasMany(DuePaymentReceive, { foreignKey: "order_id", onDelete: 'CASCADE', onUpdate: 'CASCADE' });

DuePaymentReceive.belongsTo(HotelUser, { foreignKey: "settle_by" });
HotelUser.hasMany(DuePaymentReceive, { foreignKey: "settle_by" });

// E-Bill Credit
Hotel.hasMany(EBillCredit, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
EBillCredit.belongsTo(Hotel, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

// E-Bill Credit Debit
EBillCreditDebit.belongsTo(Hotel, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

EBillCreditDebit.belongsTo(Order, { foreignKey: 'orderId', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
Order.hasOne(EBillCreditDebit, { foreignKey: 'orderId', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

// ----------------------------------------------------------------------------
// SUBSCRIPTION & PAYMENT ASSOCIATIONS
// ----------------------------------------------------------------------------
// Plans & Subscriptions
Plan.hasMany(Subscription, { foreignKey: 'plan_id', onDelete: "CASCADE", onUpdate: "CASCADE" });
Subscription.belongsTo(Plan, { foreignKey: 'plan_id', onDelete: "CASCADE", onUpdate: "CASCADE" });

Hotel.hasMany(Subscription, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
Subscription.belongsTo(Hotel, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

// Subscription Payments
Subscription.hasMany(SubscriptionPayment, { foreignKey: 'subscription_id', onDelete: "CASCADE", onUpdate: "CASCADE" });
SubscriptionPayment.belongsTo(Subscription, { foreignKey: 'subscription_id', onDelete: "CASCADE", onUpdate: "CASCADE" });

Hotel.hasMany(SubscriptionPayment, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
SubscriptionPayment.belongsTo(Hotel, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

PurchaseRollsAndPrinter.hasMany(SubscriptionPayment, { foreignKey: 'purchase_printer_id', onDelete: "CASCADE", onUpdate: "CASCADE" });
SubscriptionPayment.belongsTo(PurchaseRollsAndPrinter, { foreignKey: 'purchase_printer_id', onDelete: "CASCADE", onUpdate: "CASCADE" });

// PhonePe Payment Links
Hotel.hasMany(PhonePayPaymentLink, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
PhonePayPaymentLink.belongsTo(Hotel, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

Plan.hasMany(PhonePayPaymentLink, { foreignKey: 'plan_id', onDelete: "CASCADE", onUpdate: "CASCADE" });
PhonePayPaymentLink.belongsTo(Plan, { foreignKey: 'plan_id', onDelete: "CASCADE", onUpdate: "CASCADE" });

PurchaseRollsAndPrinter.hasMany(PhonePayPaymentLink, { foreignKey: 'printer_roll_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
PhonePayPaymentLink.belongsTo(PurchaseRollsAndPrinter, { foreignKey: 'printer_roll_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

TempWebsitePurchase.hasMany(PhonePayPaymentLink, { foreignKey: 'temp_hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
PhonePayPaymentLink.belongsTo(TempWebsitePurchase, { foreignKey: 'temp_hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

// ----------------------------------------------------------------------------
// SETTINGS & CONFIGURATION ASSOCIATIONS
// ----------------------------------------------------------------------------
// Kitchen Settings
Hotel.hasMany(KitchenSetting, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
KitchenSetting.belongsTo(Hotel, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

// Printer Settings
Hotel.hasMany(PrinterSetting, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
PrinterSetting.belongsTo(Hotel, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

PrinterSetting.belongsTo(Menu_categ, { foreignKey: 'menu_categ_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
Menu_categ.hasOne(PrinterSetting, { foreignKey: 'menu_categ_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

// Invoice Format
Hotel.hasOne(InvoiceFormate, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
InvoiceFormate.belongsTo(Hotel, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

// ----------------------------------------------------------------------------
// MARKETING & PROMOTIONS ASSOCIATIONS
// ----------------------------------------------------------------------------
// Promo Codes
Hotel.hasMany(PromoCode, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
PromoCode.belongsTo(Hotel, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

// ----------------------------------------------------------------------------
// TIMELINE ASSOCIATIONS
// ----------------------------------------------------------------------------
Hotel.hasMany(TimeLine, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
TimeLine.belongsTo(Hotel, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

Table.hasMany(TimeLine, { foreignKey: 'TableId', onDelete: "SET NULL", onUpdate: 'CASCADE' });
TimeLine.belongsTo(Table, { foreignKey: 'TableId', onDelete: "SET NULL", onUpdate: 'CASCADE' });

HotelUser.hasMany(TimeLine, { foreignKey: 'hotelUserId', onDelete: "SET NULL", onUpdate: 'CASCADE' });
TimeLine.belongsTo(HotelUser, { foreignKey: 'hotelUserId', onDelete: "SET NULL", onUpdate: 'CASCADE' });

Order.hasMany(TimeLine, { foreignKey: 'order_id', onDelete: "SET NULL", onUpdate: 'CASCADE' });
TimeLine.belongsTo(Order, { foreignKey: 'order_id', onDelete: "SET NULL", onUpdate: 'CASCADE' });

// ----------------------------------------------------------------------------
// ADMIN & MISCELLANEOUS ASSOCIATIONS
// ----------------------------------------------------------------------------
// Admin Cart
Hotel.hasMany(AdminCart, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
AdminCart.belongsTo(Hotel, { foreignKey: 'id' });

// Testing
Hotel.hasMany(Testing, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
Testing.belongsTo(Hotel, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

// Super Admin User
SuperAdminUser(sequelize, DataTypes, Hotel);

// ============================================================================
// EXPORTS
// ============================================================================
module.exports = {
    // Database Connection
    sequelize,

    // Core Models
    Hotel,
    Merchant,
    User,
    HotelUser,
    Role,
    UserAccess,

    // Table Management
    Table,
    TableCatagories,
    TableBooking,

    // Menu & Categories
    Menu,
    Menu_categ,
    MenuVariants,
    Variants,

    // Addons
    AddonDepartment,
    Addons,
    MenuAddon,

    // Orders
    Order,
    OrderDetails,
    OrderTax,
    OnlineOrders,
    OnlineOrderDetails,

    // Inventory & Stock
    RawMaterial,
    Unit,
    StockHistory,
    StockInHand,
    Recipes,

    // Purchase Management
    PurchaseOrder,
    PurchaseOrderPayment,
    PurchaseRawMaterial,
    RawMaterialConsumption,
    Supplier,

    // Financial
    DuePaymentReceive,
    ExpenseEntry,
    ExpenseHead,
    EBillCredit,
    EBillCreditDebit,
    ServiceCharge,
    TaxType,

    // Subscription & Payments
    Plan,
    Subscription,
    SubscriptionPayment,
    PhonePayPaymentLink,

    // Settings & Configuration
    KitchenSetting,
    PrinterSetting,
    InvoiceFormate,

    // Marketing & Promotions
    PromoCode,
    DiscountCode,

    // Website & E-commerce
    webSiteUserData,
    websiteProducts,
    TempWebsitePurchase,
    PurchaseRollsAndPrinter,

    // Admin & Miscellaneous
    AdminAddRestoSave,
    AdminCart,
    Cart,
    superAdminModel,
    SuperAdminUser,
    TimeLine,
    Testing,
    AppUpdate,
    Images
}