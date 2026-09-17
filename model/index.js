const { DataTypes } = require("sequelize");
const sequelize = require("../connection/connect");

// ============================================================================
// MODEL IMPORTS
// ============================================================================

// ---------- Core Models ----------
const Hotel = require("./hotel");
const Merchant = require("./merchant");
const superAdminModel = require("./superAdminModel");
const SuperAdminUser = require("./superAdminUser");
const LocalServerRegistration = require("./localServerRegistration");
const WebBundle = require("./webBundle");

// ---------- User & Access Management ----------
const User = require("./user");
const HotelUser = require("./hotelUser");
const Role = require("./role_mst");
const UserAccess = require("./userAccess");
const RolePermissionDefault = require("./rolePermissionDefault");

// ---------- Table Management ----------
const Table = require("./table");
const TableCatagories = require("./table_catg");
const TableBooking = require("./tablebooking");
const QrOrder = require("./qrOrder");

// ---------- Menu Management ----------
const Menu = require("./menu");
const Menu_categ = require("./menu_categ");
const MenuVariants = require("./menu_variant");
const Variants = require("./variants");
const MenuCatalog = require("./menuCatalog");
const PaymentMode = require("./paymentMode");
const PaymentModeDefault = require("./paymentModeDefault");
const BillChargeRule = require("./billChargeRule");
const NotificationSetting = require("./notificationSetting");

// ---------- Addons Management ----------
const AddonDepartment = require("./addonDepartMent");
const Addons = require("./addons");
const MenuAddon = require("./menu_addons");

// ---------- Order Management ----------
const Order = require("./order");
const OrderDetails = require("./order_details");
const OrderTax = require("./orderTax");
const OnlineOrders = require("./onlineOrder");
const OnlineOrderDetails = require("./onlineOrderDetails");
const Cart = require("./cart");
const AdminCart = require("./adminCart");

// ---------- Inventory Management ----------
const RawMaterial = require("./rawItem");
const Unit = require("./unit");
const Recipes = require("./recipes");
const StockHistory = require("./stockHistory");
const StockInHand = require("./stockInHand");
const PurchaseOrder = require("./Inventory/purchaseOrder");
const PurchaseOrderPayment = require("./Inventory/purchaseOrderPayment");
const PurchaseRawMaterial = require("./Inventory/purchaseRawMaterial");
const RawMaterialConsumption = require("./Inventory/RawMaterialcon");
const Supplier = require("./Inventory/supplyer");
const Requisition = require("./Inventory/requisition");
const RequisitionItem = require("./Inventory/requisitionItem");

// ---------- Semi-Finished Items ----------
const SemiFinishedItem = require("./semiFinishedItem");
const SemiFinishedRecipe = require("./semiFinishedRecipe");
const SemiFinishedStock = require("./semiFinishedStock");

// ---------- Financial Management ----------
const DuePaymentReceive = require("./duePayment");
const EBillCredit = require("./ebillCredit");
const EBillCreditDebit = require("./ebillCreditDebit");
const ExpenseEntry = require("./expenseEnty");
const ExpenseHead = require("./expenseHead");
const TaxType = require("./taxType");
const ServiceCharge = require("./serviceCharge");
const CashSession = require("./cashSession");
const CashMovement = require("./cashMovement");

// ---------- Subscription & Payment ----------
const Plan = require("./subscription/plan");
const Subscription = require("./subscription/subscription");
const SubscriptionPayment = require("./subscription/subscriptionPayment");
const PhonePayPaymentLink = require("./paymentLink");
const PurchaseRollsAndPrinter = require("./purchaseRolls");
const TempWebsitePurchase = require("./PurchaseFromWebSite");

// ---------- Settings & Configuration ----------
const KitchenSetting = require("./kitchen");
const PrinterSetting = require("./printer_setting");
const InvoiceFormate = require("./invoiceFormate");
const KotFormate = require("./kotFormate");
const PromoCode = require("./promoCode");

// ---------- Website & Marketing ----------
const webSiteUserData = require("./webSiteUserData");
const websiteProducts = require("./webSiteProducts");
const DiscountCode = require("./discountCoupens");
const Images = require("./images");

// ---------- Miscellaneous ----------
const TimeLine = require("./timeline");
const Testing = require("./testing");
const AppUpdate = require("./updateApp");
const AdminAddRestoSave = require("./adminAddRestoSave");
const Westage = require("./Inventory/westage");
const AuditLog = require("./Inventory/auditLog");
const UserSession = require("./uerSession");
const RaiseTicket = require("./raiseTicket");
const WhatsappTemplate = require("./whatsappTemplate");
const OpeningClosing = require("./openingClosing");
const WaConversation = require("./waConversation");
const WaMessage = require("./waMessage");
const RestaurantSetting = require("./restaurantSetting");

const FranchiseOrderItem = require("./franchise/franchiseOrderItem");
const FranchiseOrder = require("./franchise/franchiseOrder");
const SyncIndexDB = require("./sync");

// ---------- CRM ----------
const CrmEmployeeProfile = require("./crm/employeeProfile");
const CrmLead = require("./crm/lead");
const CrmLeadActivity = require("./crm/leadActivity");
const CrmAssignmentHistory = require("./crm/assignmentHistory");
const CrmTask = require("./crm/task");
const CrmCallLog = require("./crm/callLog");
const CrmDemoSchedule = require("./crm/demoSchedule");
const CrmPaymentTracking = require("./crm/paymentTracking");
const CrmWhatsappCampaign = require("./crm/whatsappCampaign");
const CrmCampaignRecipient = require("./crm/campaignRecipient");
const CrmAutomationRule = require("./crm/automationRule");
const CrmAutomationLog = require("./crm/automationLog");
const CrmNotification = require("./crm/notification");
const CrmMetaLeadSyncLog = require("./crm/metaLeadSyncLog");

// ============================================================================
// MODEL ASSOCIATIONS
// ============================================================================

// ----------------------------------------------------------------------------
// CORE RELATIONSHIPS
// ----------------------------------------------------------------------------

// Reaise Ticket ----> SuperAdmin User

superAdminModel.hasMany(RaiseTicket, { foreignKey: "super_id", onDelete: "CASCADE" })
RaiseTicket.belongsTo(superAdminModel, { foreignKey: "super_id", onDelete: "CASCADE" })

// Raise Ticket ---> hotel
RaiseTicket.belongsTo(Hotel, { foreignKey: "hotel_id", onDelete: "CASCADE" });
Hotel.hasMany(RaiseTicket, { foreignKey: "hotel_id", onDelete: "CASCADE" });

// ----------------------------------------------------------------------------
// CRM RELATIONSHIPS
// ----------------------------------------------------------------------------

// Employee Profile ---> SuperAdmin User (1:1 extension, keeps existing auth/user table untouched)
superAdminModel.hasOne(CrmEmployeeProfile, { foreignKey: "superAdmin_user_id", onDelete: "CASCADE" })
CrmEmployeeProfile.belongsTo(superAdminModel, { foreignKey: "superAdmin_user_id", as: "user", onDelete: "CASCADE" })

// Employee Profile ---> Employee Profile (manager hierarchy, self-referencing)
CrmEmployeeProfile.hasMany(CrmEmployeeProfile, { foreignKey: "manager_id", as: "directReports", onDelete: "SET NULL" })
CrmEmployeeProfile.belongsTo(CrmEmployeeProfile, { foreignKey: "manager_id", as: "manager", onDelete: "SET NULL" })

// Lead ---> Employee Profile (current assignee / who assigned it)
CrmEmployeeProfile.hasMany(CrmLead, { foreignKey: "assigned_to", as: "assignedLeads", onDelete: "SET NULL" })
CrmLead.belongsTo(CrmEmployeeProfile, { foreignKey: "assigned_to", as: "assignee", onDelete: "SET NULL" })
CrmEmployeeProfile.hasMany(CrmLead, { foreignKey: "assigned_by", as: "leadsAssignedByMe", onDelete: "SET NULL" })
CrmLead.belongsTo(CrmEmployeeProfile, { foreignKey: "assigned_by", as: "assigner", onDelete: "SET NULL" })

// Lead ---> Hotel (set on conversion) and ---> legacy website inquiry (backlink, non-breaking)
Hotel.hasOne(CrmLead, { foreignKey: "converted_hotel_id", onDelete: "SET NULL" })
CrmLead.belongsTo(Hotel, { foreignKey: "converted_hotel_id", as: "convertedHotel", onDelete: "SET NULL" })
webSiteUserData.hasOne(CrmLead, { foreignKey: "website_user_id", onDelete: "SET NULL" })
CrmLead.belongsTo(webSiteUserData, { foreignKey: "website_user_id", as: "websiteInquiry", onDelete: "SET NULL" })

// Lead ---> Activity Timeline (immutable, append-only)
CrmLead.hasMany(CrmLeadActivity, { foreignKey: "lead_id", as: "activities", onDelete: "CASCADE" })
CrmLeadActivity.belongsTo(CrmLead, { foreignKey: "lead_id", onDelete: "CASCADE" })
CrmEmployeeProfile.hasMany(CrmLeadActivity, { foreignKey: "actor_id", as: "loggedActivities", onDelete: "SET NULL" })
CrmLeadActivity.belongsTo(CrmEmployeeProfile, { foreignKey: "actor_id", as: "actor", onDelete: "SET NULL" })

// Lead ---> Assignment History
CrmLead.hasMany(CrmAssignmentHistory, { foreignKey: "lead_id", as: "assignmentHistory", onDelete: "CASCADE" })
CrmAssignmentHistory.belongsTo(CrmLead, { foreignKey: "lead_id", onDelete: "CASCADE" })

// Lead ---> Tasks
CrmLead.hasMany(CrmTask, { foreignKey: "lead_id", as: "tasks", onDelete: "CASCADE" })
CrmTask.belongsTo(CrmLead, { foreignKey: "lead_id", onDelete: "CASCADE" })
CrmEmployeeProfile.hasMany(CrmTask, { foreignKey: "assigned_to", as: "tasks", onDelete: "SET NULL" })
CrmTask.belongsTo(CrmEmployeeProfile, { foreignKey: "assigned_to", as: "assignee", onDelete: "SET NULL" })

// Lead ---> Call Logs (provider-agnostic — see model/crm/callLog.js)
CrmLead.hasMany(CrmCallLog, { foreignKey: "lead_id", as: "callLogs", onDelete: "CASCADE" })
CrmCallLog.belongsTo(CrmLead, { foreignKey: "lead_id", onDelete: "CASCADE" })
CrmTask.hasOne(CrmCallLog, { foreignKey: "task_id", onDelete: "SET NULL" })
CrmCallLog.belongsTo(CrmTask, { foreignKey: "task_id", onDelete: "SET NULL" })
CrmEmployeeProfile.hasMany(CrmCallLog, { foreignKey: "caller_id", as: "callsMade", onDelete: "SET NULL" })
CrmCallLog.belongsTo(CrmEmployeeProfile, { foreignKey: "caller_id", as: "caller", onDelete: "SET NULL" })

// Lead ---> Demo Schedule
CrmLead.hasMany(CrmDemoSchedule, { foreignKey: "lead_id", as: "demoSchedules", onDelete: "CASCADE" })
CrmDemoSchedule.belongsTo(CrmLead, { foreignKey: "lead_id", onDelete: "CASCADE" })
CrmEmployeeProfile.hasMany(CrmDemoSchedule, { foreignKey: "executive_id", as: "demosAssigned", onDelete: "SET NULL" })
CrmDemoSchedule.belongsTo(CrmEmployeeProfile, { foreignKey: "executive_id", as: "executive", onDelete: "SET NULL" })

// Lead ---> Payment Tracking (1:1)
CrmLead.hasOne(CrmPaymentTracking, { foreignKey: "lead_id", as: "paymentTracking", onDelete: "CASCADE" })
CrmPaymentTracking.belongsTo(CrmLead, { foreignKey: "lead_id", onDelete: "CASCADE" })

// WhatsApp Campaign ---> Template / Recipients ---> Lead
WhatsappTemplate.hasMany(CrmWhatsappCampaign, { foreignKey: "template_id", onDelete: "SET NULL" })
CrmWhatsappCampaign.belongsTo(WhatsappTemplate, { foreignKey: "template_id", onDelete: "SET NULL" })
CrmWhatsappCampaign.hasMany(CrmCampaignRecipient, { foreignKey: "campaign_id", onDelete: "CASCADE" })
CrmCampaignRecipient.belongsTo(CrmWhatsappCampaign, { foreignKey: "campaign_id", onDelete: "CASCADE" })
CrmLead.hasMany(CrmCampaignRecipient, { foreignKey: "lead_id", as: "campaignRecipients", onDelete: "CASCADE" })
CrmCampaignRecipient.belongsTo(CrmLead, { foreignKey: "lead_id", onDelete: "CASCADE" })

// WhatsApp Agent Conversation ---> Lead (additive nullable column, resolves chat back to a lead)
CrmLead.hasOne(WaConversation, { foreignKey: "lead_id", as: "waConversation", onDelete: "SET NULL" })
WaConversation.belongsTo(CrmLead, { foreignKey: "lead_id", onDelete: "SET NULL" })

// Automation Rule ---> Execution Log ---> Lead
CrmAutomationRule.hasMany(CrmAutomationLog, { foreignKey: "rule_id", onDelete: "SET NULL" })
CrmAutomationLog.belongsTo(CrmAutomationRule, { foreignKey: "rule_id", onDelete: "SET NULL" })
CrmLead.hasMany(CrmAutomationLog, { foreignKey: "lead_id", as: "automationLogs", onDelete: "CASCADE" })
CrmAutomationLog.belongsTo(CrmLead, { foreignKey: "lead_id", onDelete: "CASCADE" })

// Notifications ---> Employee Profile / Lead
CrmEmployeeProfile.hasMany(CrmNotification, { foreignKey: "recipient_id", as: "notifications", onDelete: "CASCADE" })
CrmNotification.belongsTo(CrmEmployeeProfile, { foreignKey: "recipient_id", as: "recipient", onDelete: "CASCADE" })
CrmLead.hasMany(CrmNotification, { foreignKey: "lead_id", as: "notifications", onDelete: "SET NULL" })
CrmNotification.belongsTo(CrmLead, { foreignKey: "lead_id", onDelete: "SET NULL" })

// Meta Lead Sync Log ---> Lead (set once the raw payload is processed into a CRM lead)
CrmLead.hasOne(CrmMetaLeadSyncLog, { foreignKey: "crm_lead_id", as: "metaLeadSyncLog", onDelete: "SET NULL" })
CrmMetaLeadSyncLog.belongsTo(CrmLead, { foreignKey: "crm_lead_id", onDelete: "SET NULL" })

// Merchant -> Hotel
Merchant.hasMany(Hotel, { foreignKey: "merchant_id", onDelete: "CASCADE" });
Hotel.belongsTo(Merchant, { foreignKey: "merchant_id", onDelete: "CASCADE" });

// Hotel -> LocalServerRegistration (one-active-per-hotel is enforced by the
// generated column in the migration, not this association - see that file)
Hotel.hasMany(LocalServerRegistration, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
LocalServerRegistration.belongsTo(Hotel, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

// ----------------------------------------------------------------------------
// TABLE MANAGEMENT RELATIONSHIPS
// ----------------------------------------------------------------------------

// TableCatagories -> Table
TableCatagories.hasMany(Table, { foreignKey: 'table_catag_id' });
Table.belongsTo(TableCatagories, { foreignKey: 'table_catag_id' });

// Hotel -> TableCatagories
Hotel.hasMany(TableCatagories, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
TableCatagories.belongsTo(Hotel, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

// Hotel -> Table
Hotel.hasMany(Table, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
Table.belongsTo(Hotel, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

// Table -> TableBooking
Table.hasOne(TableBooking, { foreignKey: 'TableId', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
TableBooking.belongsTo(Table, { foreignKey: 'TableId', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

// Hotel -> TableBooking
Hotel.hasMany(TableBooking, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
TableBooking.belongsTo(Hotel, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

// User -> TableBooking
User.hasMany(TableBooking, { foreignKey: 'UserId', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
TableBooking.belongsTo(User, { foreignKey: 'UserId', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

// Table -> QrOrder
Table.hasMany(QrOrder, { foreignKey: 'table_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
QrOrder.belongsTo(Table, { foreignKey: 'table_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

// Hotel -> QrOrder
Hotel.hasMany(QrOrder, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
QrOrder.belongsTo(Hotel, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

// ----------------------------------------------------------------------------
// MENU MANAGEMENT RELATIONSHIPS
// ----------------------------------------------------------------------------

// Hotel -> MenuCatalog
Hotel.hasMany(MenuCatalog, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
MenuCatalog.belongsTo(Hotel, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

// Hotel -> PaymentMode
Hotel.hasMany(PaymentMode, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
PaymentMode.belongsTo(Hotel, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

// Hotel -> PaymentModeDefault, and its own FKs to PaymentMode/TableCatagories
// (table_categ_id nullable - see the model's own comment on what null means)
Hotel.hasMany(PaymentModeDefault, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
PaymentModeDefault.belongsTo(Hotel, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
PaymentModeDefault.belongsTo(PaymentMode, { foreignKey: 'payment_mode_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
PaymentModeDefault.belongsTo(TableCatagories, { foreignKey: 'table_categ_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

// Hotel -> BillChargeRule (delivery + packaging, one row each)
Hotel.hasMany(BillChargeRule, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
BillChargeRule.belongsTo(Hotel, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

// Hotel -> NotificationSetting (one row per trigger)
Hotel.hasMany(NotificationSetting, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
NotificationSetting.belongsTo(Hotel, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

// Hotel -> RolePermissionDefault (one row per role)
Hotel.hasMany(RolePermissionDefault, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
RolePermissionDefault.belongsTo(Hotel, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

// Menu_categ -> Menu
Menu_categ.hasMany(Menu, { foreignKey: 'menu_categ_id' });
Menu.belongsTo(Menu_categ, { foreignKey: 'menu_categ_id' });

// Hotel -> Menu_categ
Hotel.hasMany(Menu_categ, { foreignKey: 'hotel_id' });
Menu_categ.belongsTo(Hotel, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

// MenuCatalog -> Menu_categ (which catalogue a category belongs to)
MenuCatalog.hasMany(Menu_categ, { foreignKey: 'menu_catalog_id' });
Menu_categ.belongsTo(MenuCatalog, { foreignKey: 'menu_catalog_id' });

// Hotel -> Menu
Hotel.hasMany(Menu, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
Menu.belongsTo(Hotel, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

// Menu -> Variants (Many-to-Many)
Variants.belongsToMany(Menu, { through: "hms_menu_variant_mst", foreignKey: "variant_id", as: "menuData" });
Menu.belongsToMany(Variants, { through: "hms_menu_variant_mst", as: "variantData", foreignKey: "menu_id" });

// Hotel -> Variants
Hotel.hasMany(Variants, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
Variants.belongsTo(Hotel, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

// MenuCatalog -> Variants (which catalogue a variant master belongs to)
MenuCatalog.hasMany(Variants, { foreignKey: 'menu_catalog_id' });
Variants.belongsTo(MenuCatalog, { foreignKey: 'menu_catalog_id' });

// MenuVariants relationships
Hotel.hasMany(MenuVariants, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
MenuVariants.belongsTo(Hotel, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

MenuVariants.belongsTo(Variants, { foreignKey: 'variant_id' });
Variants.hasMany(MenuVariants, { foreignKey: 'variant_id' });

MenuVariants.belongsTo(Menu, { foreignKey: 'menu_id' });
Menu.hasMany(MenuVariants, { foreignKey: 'menu_id' });

// ----------------------------------------------------------------------------
// ADDONS MANAGEMENT RELATIONSHIPS
// ----------------------------------------------------------------------------

// Hotel -> AddonDepartment
Hotel.hasMany(AddonDepartment, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
AddonDepartment.belongsTo(Hotel, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

// MenuCatalog -> AddonDepartment (which catalogue an addon group belongs to)
MenuCatalog.hasMany(AddonDepartment, { foreignKey: 'menu_catalog_id' });
AddonDepartment.belongsTo(MenuCatalog, { foreignKey: 'menu_catalog_id' });

// AddonDepartment -> Addons
AddonDepartment.hasMany(Addons, { foreignKey: 'department_id', onDelete: "CASCADE", onUpdate: "CASCADE" });
Addons.belongsTo(AddonDepartment, { foreignKey: 'department_id', onDelete: "SET NULL", onUpdate: "CASCADE" });

// Hotel -> Addons
Hotel.hasMany(Addons, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
Addons.belongsTo(Hotel, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

// AddonDepartment -> Menu (Many-to-Many)
AddonDepartment.belongsToMany(Menu, {
    through: "hms_menu_addon_mst",
    foreignKey: "addon_department_id",
    as: "menuData",
    onDelete: "SET NULL",
    onUpdate: "CASCADE"
});
Menu.belongsToMany(AddonDepartment, {
    through: "hms_menu_addon_mst",
    as: "addonDepartmentData",
    foreignKey: "menu_id",
    onDelete: "SET NULL",
    onUpdate: "CASCADE"
});

// MenuAddon relationships
MenuAddon.belongsTo(AddonDepartment, { foreignKey: 'addon_department_id' });
AddonDepartment.hasMany(MenuAddon, { foreignKey: 'addon_department_id' });

MenuAddon.belongsTo(Menu, { foreignKey: 'menu_id' });
Menu.hasMany(AddonDepartment, { foreignKey: 'menu_id' });

// Hotel -> MenuAddon
Hotel.hasMany(MenuAddon, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
MenuAddon.belongsTo(Hotel, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

// ----------------------------------------------------------------------------
// ORDER MANAGEMENT RELATIONSHIPS
// ----------------------------------------------------------------------------

// Hotel -> Order
Hotel.hasMany(Order, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
Order.belongsTo(Hotel, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

// Order -> OrderDetails
Order.hasMany(OrderDetails, { foreignKey: 'orderId', onDelete: "SET NULL", onUpdate: 'CASCADE' });
OrderDetails.belongsTo(Order, { foreignKey: "orderId", as: "order", onDelete: "SET NULL", onUpdate: 'CASCADE' });

// Hotel -> OrderDetails
Hotel.hasMany(OrderDetails, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
OrderDetails.belongsTo(Hotel, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

// User -> OrderDetails
OrderDetails.belongsTo(User, { foreignKey: "UserId", onDelete: "SET NULL", onUpdate: 'CASCADE' });
User.hasMany(OrderDetails, { foreignKey: "UserId", onDelete: "SET NULL", onUpdate: 'CASCADE' });

// Table -> OrderDetails
OrderDetails.belongsTo(Table, { foreignKey: "TableId", onDelete: "SET NULL", onUpdate: 'CASCADE' });
Table.hasMany(OrderDetails, { foreignKey: "TableId", onDelete: "SET NULL", onUpdate: 'CASCADE' });

// Menu -> OrderDetails
OrderDetails.belongsTo(Menu, { foreignKey: "MenuId" });
Menu.hasMany(Menu, { foreignKey: "MenuId" });

// Variants -> OrderDetails
OrderDetails.belongsTo(Variants, { foreignKey: "variant_id", as: "variantData" });
Variants.hasMany(OrderDetails, { foreignKey: "variant_id", as: "variantData" });

// Table -> Order
Table.hasMany(Order, { foreignKey: 'TableId', onDelete: "SET NULL", onUpdate: 'CASCADE' });
Order.belongsTo(Table, { foreignKey: 'TableId', onDelete: "SET NULL", onUpdate: 'CASCADE' });

// User -> Order
User.hasMany(Order, { foreignKey: 'UserId', onDelete: "SET NULL", onUpdate: 'CASCADE' });
Order.belongsTo(User, { foreignKey: 'UserId', onDelete: "SET NULL", onUpdate: 'CASCADE' });

// HotelUser -> Order
HotelUser.hasMany(Order, { foreignKey: 'hotelUserId', onDelete: "SET NULL", onUpdate: 'CASCADE' });
Order.belongsTo(HotelUser, { foreignKey: 'hotelUserId', onDelete: "SET NULL", onUpdate: 'CASCADE' });

// Order -> OrderTax
Order.hasMany(OrderTax, { foreignKey: "hmsOrderMstId" });
OrderTax.belongsTo(Order, { foreignKey: "hmsOrderMstId" });

// TaxType -> OrderTax
TaxType.hasMany(OrderTax, { foreignKey: "hmsTaxTypeMstId" });
OrderTax.belongsTo(TaxType, { foreignKey: "hmsTaxTypeMstId" });

// Hotel -> OrderTax
Hotel.hasMany(OrderTax, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
OrderTax.belongsTo(Hotel, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

// Online Orders
OnlineOrders.hasMany(OnlineOrderDetails, { foreignKey: 'orderId', onDelete: "SET NULL", onUpdate: 'CASCADE' });
OnlineOrderDetails.belongsTo(OnlineOrders, { foreignKey: "orderId", as: "order", onDelete: "SET NULL", onUpdate: 'CASCADE' });

OnlineOrders.belongsTo(Hotel, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
OnlineOrderDetails.belongsTo(Hotel, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

// ----------------------------------------------------------------------------
// USER & ACCESS MANAGEMENT RELATIONSHIPS
// ----------------------------------------------------------------------------

// Hotel -> User
Hotel.hasMany(User, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
User.belongsTo(Hotel, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

// Hotel -> Role
Hotel.hasMany(Role, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
Role.belongsTo(Hotel, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

// Hotel -> HotelUser
Hotel.hasMany(HotelUser, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
HotelUser.belongsTo(Hotel, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

// Role -> HotelUser
Role.hasMany(HotelUser, { foreignKey: 'role_cd', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
HotelUser.belongsTo(Role, { foreignKey: 'role_cd', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

// Hotel -> UserAccess
Hotel.hasMany(UserAccess, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
UserAccess.belongsTo(Hotel, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

// HotelUser -> UserAccess
HotelUser.hasMany(UserAccess, { foreignKey: 'hotelUser_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
UserAccess.belongsTo(HotelUser, { foreignKey: 'hotelUser_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

// ----------------------------------------------------------------------------
// INVENTORY MANAGEMENT RELATIONSHIPS
// ----------------------------------------------------------------------------

// Hotel -> Unit
Hotel.hasMany(Unit, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
Unit.belongsTo(Hotel, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

// Hotel -> RawMaterial
Hotel.hasMany(RawMaterial, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
RawMaterial.belongsTo(Hotel, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

// Unit -> RawMaterial (Multiple unit types)
Unit.hasMany(RawMaterial, { as: "purchaseUnit", foreignKey: 'unit_id' });
RawMaterial.belongsTo(Unit, { as: "purchaseUnit", foreignKey: 'unit_id' });

Unit.hasMany(RawMaterial, { as: "consumptionUnit", foreignKey: 'consumption_unit' });
RawMaterial.belongsTo(Unit, { as: "consumptionUnit", foreignKey: 'consumption_unit' });

Unit.hasMany(RawMaterial, { as: "minimumStockUnit", foreignKey: 'minimum_stock_level_unit' });
RawMaterial.belongsTo(Unit, { as: "minimumStockUnit", foreignKey: 'minimum_stock_level_unit' });

// Hotel -> Supplier
Hotel.hasMany(Supplier, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
Supplier.belongsTo(Hotel, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

// Hotel -> PurchaseOrder
Hotel.hasMany(PurchaseOrder, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
PurchaseOrder.belongsTo(Hotel, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

// Supplier -> PurchaseOrder
Supplier.hasMany(PurchaseOrder, { foreignKey: 'supplier_id' });
PurchaseOrder.belongsTo(Supplier, { foreignKey: 'supplier_id' });

// HotelUser -> PurchaseOrder
HotelUser.hasMany(PurchaseOrder, { foreignKey: 'userId', onDelete: "SET NULL", onUpdate: 'CASCADE' });
PurchaseOrder.belongsTo(HotelUser, { foreignKey: 'userId', onDelete: "SET NULL", onUpdate: 'CASCADE' });

// PurchaseOrder -> PurchaseRawMaterial
PurchaseOrder.hasMany(PurchaseRawMaterial, { foreignKey: 'purchaseOrderId', onDelete: "SET NULL", onUpdate: 'CASCADE' });
PurchaseRawMaterial.belongsTo(PurchaseOrder, { foreignKey: "purchaseOrderId", as: "purchaseOrder", onDelete: "SET NULL", onUpdate: 'CASCADE' });

// Hotel -> PurchaseRawMaterial
Hotel.hasMany(PurchaseRawMaterial, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
PurchaseRawMaterial.belongsTo(Hotel, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

// RawMaterial -> PurchaseRawMaterial
RawMaterial.hasMany(PurchaseRawMaterial, { foreignKey: "raw_material_id", as: "purchases", onDelete: "SET NULL", onUpdate: "CASCADE" });
PurchaseRawMaterial.belongsTo(RawMaterial, { foreignKey: "raw_material_id", as: "rawMaterial" });

// Unit -> PurchaseRawMaterial
Unit.hasMany(PurchaseRawMaterial, { foreignKey: "unit_id", onDelete: "SET NULL", onUpdate: "CASCADE" });
PurchaseRawMaterial.belongsTo(Unit, { foreignKey: "unit_id", onDelete: "SET NULL", onUpdate: "CASCADE" });

// PurchaseOrder -> PurchaseOrderPayment
PurchaseOrder.hasMany(PurchaseOrderPayment, { foreignKey: "purchaseOrderId", onDelete: "SET NULL", onUpdate: 'CASCADE' });
PurchaseOrderPayment.belongsTo(PurchaseOrder, { foreignKey: "purchaseOrderId" });

// Hotel -> PurchaseOrderPayment
Hotel.hasMany(PurchaseOrderPayment, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
PurchaseOrderPayment.belongsTo(Hotel, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

// HotelUser -> PurchaseOrderPayment
HotelUser.hasMany(PurchaseOrderPayment, { foreignKey: 'userId', onDelete: "SET NULL", onUpdate: 'CASCADE' });
PurchaseOrderPayment.belongsTo(HotelUser, { foreignKey: 'userId', onDelete: "SET NULL", onUpdate: 'CASCADE' });

// Hotel -> Requisition
Hotel.hasMany(Requisition, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
Requisition.belongsTo(Hotel, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

// Requisition -> RequisitionItem
Requisition.hasMany(RequisitionItem, { foreignKey: 'requisition_id', as: 'items', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
RequisitionItem.belongsTo(Requisition, { foreignKey: 'requisition_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

// Hotel -> RequisitionItem
Hotel.hasMany(RequisitionItem, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
RequisitionItem.belongsTo(Hotel, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

// Hotel -> RawMaterialConsumption
Hotel.hasMany(RawMaterialConsumption, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
RawMaterialConsumption.belongsTo(Hotel, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

// RawMaterial -> RawMaterialConsumption
RawMaterial.hasMany(RawMaterialConsumption, { foreignKey: "raw_material_id", as: "consumptions", onDelete: "SET NULL", onUpdate: "CASCADE" });
RawMaterialConsumption.belongsTo(RawMaterial, { foreignKey: "raw_material_id", as: "rawMaterial" });

// Order -> RawMaterialConsumption
Order.hasMany(RawMaterialConsumption, { foreignKey: "order_id", as: "consumptionRawMaterial", onDelete: "SET NULL", onUpdate: "CASCADE" });
RawMaterialConsumption.belongsTo(Order, { foreignKey: "order_id", as: "order", onDelete: "SET NULL", onUpdate: "CASCADE" });

// Unit -> RawMaterialConsumption
Unit.hasMany(RawMaterialConsumption, { foreignKey: "unit_id", as: "consumptions", onDelete: "SET NULL", onUpdate: "CASCADE" });
RawMaterialConsumption.belongsTo(Unit, { foreignKey: "unit_id", as: "unit" });

// HotelUser -> RawMaterialConsumption
HotelUser.hasMany(RawMaterialConsumption, { foreignKey: "user_id", as: "consumptions", onDelete: "SET NULL", onUpdate: "CASCADE" });
RawMaterialConsumption.belongsTo(HotelUser, { foreignKey: "user_id", as: "user" });

// Hotel -> StockHistory
Hotel.hasMany(StockHistory, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
StockHistory.belongsTo(Hotel, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

// RawMaterial -> StockHistory
RawMaterial.hasMany(StockHistory, { foreignKey: 'raw_material_id' });
StockHistory.belongsTo(RawMaterial, { foreignKey: 'raw_material_id' });

// HotelUser -> StockHistory
HotelUser.hasMany(StockHistory, { foreignKey: 'user_id' });

// Hotel -> StockInHand
Hotel.hasMany(StockInHand, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
StockInHand.belongsTo(Hotel, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

// RawMaterial -> StockInHand
RawMaterial.hasOne(StockInHand, { foreignKey: 'raw_material_id' });
StockInHand.belongsTo(RawMaterial, { foreignKey: 'raw_material_id' });


// Hotel-->Recipes
Hotel.hasMany(Recipes, { foreignKey: 'hotel_id' });
Recipes.belongsTo(Hotel, { foreignKey: 'hotel_id' });

// Menu-->Recipes
Menu.hasMany(Recipes, { as: "recipes", foreignKey: 'menu_id' });
Recipes.belongsTo(Menu, { as: "menu", foreignKey: 'menu_id' });

// Variant-->Recipes
Variants.hasMany(Recipes, { as: "recipes", foreignKey: 'variant_id' });
Recipes.belongsTo(Variants, { as: "variant", foreignKey: 'variant_id' });

// Addon-->Recipes
Addons.hasMany(Recipes, { as: "recipes", foreignKey: 'addon_id' });
Recipes.belongsTo(Addons, { as: "addon", foreignKey: 'addon_id' });

// Raw Material-->Recipes
RawMaterial.hasMany(Recipes, { as: "recipes", foreignKey: 'raw_material_id' });
Recipes.belongsTo(RawMaterial, { as: "rawMaterial", foreignKey: 'raw_material_id' });

// Semi-Finished Item-->Recipes
SemiFinishedItem.hasMany(Recipes, { as: "recipes", foreignKey: 'semi_finished_item_id' });
Recipes.belongsTo(SemiFinishedItem, { as: "semiFinishedItem", foreignKey: 'semi_finished_item_id' });

// Hotel-->SemiFinishedItem
Hotel.hasMany(SemiFinishedItem, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
SemiFinishedItem.belongsTo(Hotel, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

// Unit-->SemiFinishedItem
Unit.hasMany(SemiFinishedItem, { as: "sfiUnit", foreignKey: 'unit_id' });
SemiFinishedItem.belongsTo(Unit, { as: "unit", foreignKey: 'unit_id' });

// Hotel-->SemiFinishedRecipe
Hotel.hasMany(SemiFinishedRecipe, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
SemiFinishedRecipe.belongsTo(Hotel, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

// SemiFinishedItem-->SemiFinishedRecipe
SemiFinishedItem.hasMany(SemiFinishedRecipe, { as: "sfiRecipes", foreignKey: 'semi_finished_item_id', onDelete: 'CASCADE' });
SemiFinishedRecipe.belongsTo(SemiFinishedItem, { as: "semiFinishedItem", foreignKey: 'semi_finished_item_id' });

// RawMaterial-->SemiFinishedRecipe
RawMaterial.hasMany(SemiFinishedRecipe, { as: "sfiRecipes", foreignKey: 'raw_material_id' });
SemiFinishedRecipe.belongsTo(RawMaterial, { as: "rawMaterial", foreignKey: 'raw_material_id' });

// Hotel-->SemiFinishedStock
Hotel.hasMany(SemiFinishedStock, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
SemiFinishedStock.belongsTo(Hotel, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

// SemiFinishedItem-->SemiFinishedStock
SemiFinishedItem.hasOne(SemiFinishedStock, { as: "stock", foreignKey: 'semi_finished_item_id', onDelete: 'CASCADE' });
SemiFinishedStock.belongsTo(SemiFinishedItem, { as: "semiFinishedItem", foreignKey: 'semi_finished_item_id' });

// wastage --> raw material
RawMaterial.hasOne(Westage, { foreignKey: 'raw_material_id' });
Westage.belongsTo(RawMaterial, { foreignKey: 'raw_material_id' });

// wastage --> hotel
Hotel.hasMany(Westage, { foreignKey: 'hotel_id' });
Westage.belongsTo(Hotel, { foreignKey: 'hotel_id' });

// westage --> user
HotelUser.hasMany(Westage, { foreignKey: 'user_id' });
Westage.belongsTo(HotelUser, { foreignKey: 'user_id' });

//wastage --> unit
Unit.hasOne(Westage, { foreignKey: 'unit_id' });
Westage.belongsTo(Unit, { foreignKey: 'unit_id' });

// auditLog --> hotel
Hotel.hasMany(AuditLog, { foreignKey: 'hotel_id' });
AuditLog.belongsTo(Hotel, { foreignKey: 'hotel_id' });
// ----------------------------------------------------------------------------
// FINANCIAL MANAGEMENT RELATIONSHIPS
// ----------------------------------------------------------------------------

// Hotel -> DuePaymentReceive
Hotel.hasMany(DuePaymentReceive, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
DuePaymentReceive.belongsTo(Hotel, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

// User -> DuePaymentReceive
User.hasMany(DuePaymentReceive, { foreignKey: 'user_id' });
DuePaymentReceive.belongsTo(User, { foreignKey: 'user_id' });

// Order -> DuePaymentReceive
Order.hasMany(DuePaymentReceive, { foreignKey: "order_id", onDelete: 'CASCADE', onUpdate: 'CASCADE' });
DuePaymentReceive.belongsTo(Order, { foreignKey: "order_id" });

// HotelUser -> DuePaymentReceive
HotelUser.hasMany(DuePaymentReceive, { foreignKey: "settle_by" });
DuePaymentReceive.belongsTo(HotelUser, { foreignKey: "settle_by" });

// Hotel -> ExpenseHead
Hotel.hasMany(ExpenseHead, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
ExpenseHead.belongsTo(Hotel, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

// Hotel -> ExpenseEntry
Hotel.hasMany(ExpenseEntry, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
ExpenseEntry.belongsTo(Hotel, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

// Opening Closing
Hotel.hasMany(OpeningClosing, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
OpeningClosing.belongsTo(Hotel, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

// ExpenseHead -> ExpenseEntry
ExpenseHead.hasMany(ExpenseEntry, { foreignKey: 'expense_head_id', onDelete: 'SET NULL' });
ExpenseEntry.belongsTo(ExpenseHead, { foreignKey: 'expense_head_id' });

// HotelUser -> ExpenseEntry
HotelUser.hasMany(ExpenseEntry, { foreignKey: 'user_id' });

// Hotel -> CashSession
Hotel.hasMany(CashSession, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
CashSession.belongsTo(Hotel, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

// HotelUser -> CashSession (who opened/closed it)
HotelUser.hasMany(CashSession, { foreignKey: 'hotelUserId', onDelete: 'SET NULL' });
CashSession.belongsTo(HotelUser, { foreignKey: 'hotelUserId' });

// CashSession -> CashMovement
CashSession.hasMany(CashMovement, { foreignKey: 'cashSessionId', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
CashMovement.belongsTo(CashSession, { foreignKey: 'cashSessionId', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

// HotelUser -> CashMovement (who recorded it)
HotelUser.hasMany(CashMovement, { foreignKey: 'hotelUserId', onDelete: 'SET NULL' });
CashMovement.belongsTo(HotelUser, { foreignKey: 'hotelUserId' });

// Hotel -> TaxType
Hotel.hasMany(TaxType, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
TaxType.belongsTo(Hotel, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

// Hotel -> ServiceCharge
Hotel.hasOne(ServiceCharge, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
ServiceCharge.belongsTo(Hotel, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

// Hotel -> EBillCredit
Hotel.hasMany(EBillCredit, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
EBillCredit.belongsTo(Hotel, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

// Hotel -> EBillCreditDebit
EBillCreditDebit.belongsTo(Hotel, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

// Order -> EBillCreditDebit
Order.hasOne(EBillCreditDebit, { foreignKey: 'orderId', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
EBillCreditDebit.belongsTo(Order, { foreignKey: 'orderId', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

// ----------------------------------------------------------------------------
// SUBSCRIPTION & PAYMENT RELATIONSHIPS
// ----------------------------------------------------------------------------

// Plan -> Subscription
Plan.hasMany(Subscription, { foreignKey: 'plan_id', onDelete: "CASCADE", onUpdate: "CASCADE" });
Subscription.belongsTo(Plan, { foreignKey: 'plan_id', onDelete: "CASCADE", onUpdate: "CASCADE" });

// Hotel -> Subscription
Hotel.hasMany(Subscription, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
Subscription.belongsTo(Hotel, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

// Subscription -> SubscriptionPayment
Subscription.hasMany(SubscriptionPayment, { foreignKey: 'subscription_id', onDelete: "CASCADE", onUpdate: "CASCADE" });
SubscriptionPayment.belongsTo(Subscription, { foreignKey: 'subscription_id', onDelete: "CASCADE", onUpdate: "CASCADE" });

// Hotel -> SubscriptionPayment
Hotel.hasMany(SubscriptionPayment, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
SubscriptionPayment.belongsTo(Hotel, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

// PurchaseRollsAndPrinter -> SubscriptionPayment
PurchaseRollsAndPrinter.hasMany(SubscriptionPayment, { foreignKey: 'purchase_printer_id', onDelete: "CASCADE", onUpdate: "CASCADE" });
SubscriptionPayment.belongsTo(PurchaseRollsAndPrinter, { foreignKey: 'purchase_printer_id', onDelete: "CASCADE", onUpdate: "CASCADE" });

// Hotel -> PhonePayPaymentLink
Hotel.hasMany(PhonePayPaymentLink, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
PhonePayPaymentLink.belongsTo(Hotel, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

// Plan -> PhonePayPaymentLink
Plan.hasMany(PhonePayPaymentLink, { foreignKey: 'plan_id', onDelete: "CASCADE", onUpdate: "CASCADE" });
PhonePayPaymentLink.belongsTo(Plan, { foreignKey: 'plan_id', onDelete: "CASCADE", onUpdate: "CASCADE" });

// PurchaseRollsAndPrinter -> PhonePayPaymentLink
PurchaseRollsAndPrinter.hasMany(PhonePayPaymentLink, { foreignKey: 'printer_roll_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
PhonePayPaymentLink.belongsTo(PurchaseRollsAndPrinter, { foreignKey: 'printer_roll_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

// TempWebsitePurchase -> PhonePayPaymentLink
TempWebsitePurchase.hasMany(PhonePayPaymentLink, { foreignKey: 'temp_hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
PhonePayPaymentLink.belongsTo(TempWebsitePurchase, { foreignKey: 'temp_hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

// ----------------------------------------------------------------------------
// SETTINGS & CONFIGURATION RELATIONSHIPS
// ----------------------------------------------------------------------------

// Hotel -> KitchenSetting
Hotel.hasMany(KitchenSetting, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
KitchenSetting.belongsTo(Hotel, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

// Hotel -> PrinterSetting
Hotel.hasMany(PrinterSetting, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
PrinterSetting.belongsTo(Hotel, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

// Menu_categ -> PrinterSetting
Menu_categ.hasOne(PrinterSetting, { foreignKey: 'menu_categ_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
PrinterSetting.belongsTo(Menu_categ, { foreignKey: 'menu_categ_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

// Hotel -> InvoiceFormate
Hotel.hasOne(InvoiceFormate, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
InvoiceFormate.belongsTo(Hotel, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

// Hotel -> KotFormate (Task 1 - dynamic KOT format, same shape as InvoiceFormate)
Hotel.hasOne(KotFormate, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
KotFormate.belongsTo(Hotel, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

// Hotel -> PromoCode
Hotel.hasMany(PromoCode, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
PromoCode.belongsTo(Hotel, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

// ----------------------------------------------------------------------------
// MISCELLANEOUS RELATIONSHIPS
// ----------------------------------------------------------------------------

// Hotel -> AdminCart
Hotel.hasMany(AdminCart, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
AdminCart.belongsTo(Hotel, { foreignKey: 'id' });

// Hotel -> Testing
Hotel.hasMany(Testing, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
Testing.belongsTo(Hotel, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

// Hotel -> TimeLine
Hotel.hasMany(TimeLine, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
TimeLine.belongsTo(Hotel, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

// Table -> TimeLine
Table.hasMany(TimeLine, { foreignKey: 'TableId', onDelete: "SET NULL", onUpdate: 'CASCADE' });
TimeLine.belongsTo(Table, { foreignKey: 'TableId', onDelete: "SET NULL", onUpdate: 'CASCADE' });

// HotelUser -> TimeLine
HotelUser.hasMany(TimeLine, { foreignKey: 'hotelUserId', onDelete: "SET NULL", onUpdate: 'CASCADE' });
TimeLine.belongsTo(HotelUser, { foreignKey: 'hotelUserId', onDelete: "SET NULL", onUpdate: 'CASCADE' });

// Order -> TimeLine
Order.hasMany(TimeLine, { foreignKey: 'order_id', onDelete: "SET NULL", onUpdate: 'CASCADE' });
TimeLine.belongsTo(Order, { foreignKey: 'order_id', onDelete: "SET NULL", onUpdate: 'CASCADE' });

// ----------------------------------------------------------------------------
// SUPER ADMIN RELATIONSHIPS
// ----------------------------------------------------------------------------

SuperAdminUser(sequelize, DataTypes, Hotel);

// ----------------------------------------------------------------------------
// RESTAURANT SETTINGS     RELATIONSHIPS
// ----------------------------------------------------------------------------

Hotel.hasOne(RestaurantSetting, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
RestaurantSetting.belongsTo(Hotel, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

// ----------------------------------------------------------------------------
// franchies order      RELATIONSHIPS
// ----------------------------------------------------------------------------

FranchiseOrder.belongsTo(Hotel, {
    foreignKey: 'franchise_id',
    as: 'franchise'
});
FranchiseOrder.belongsTo(Merchant, {
    foreignKey: 'merchant_id',
    as: 'merchant'
});
FranchiseOrder.hasMany(FranchiseOrderItem, {
    foreignKey: 'order_id',
    as: 'items'
});
FranchiseOrder.belongsTo(PurchaseOrder, {
    foreignKey: 'purchase_order_id',
    as: 'purchaseOrder'
});
// ----------------------------------------------------------------------------
// franchies Order Items      RELATIONSHIPS
// ----------------------------------------------------------------------------

FranchiseOrderItem.belongsTo(FranchiseOrder, {
    foreignKey: 'order_id',
    as: 'order'
});
FranchiseOrderItem.belongsTo(RawMaterial, {
    foreignKey: 'raw_material_id',
    as: 'rawMaterial'
});


// index db 

Hotel.hasOne(SyncIndexDB, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
SyncIndexDB.belongsTo(Hotel, { foreignKey: 'hotel_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

// ============================================================================
// MODULE EXPORTS
// ============================================================================

module.exports = {
    RestaurantSetting,
    UserSession,
    // Database
    sequelize,

    // Core
    Hotel,
    Merchant,
    superAdminModel,
    SuperAdminUser,
    LocalServerRegistration,
    WebBundle,

    // User & Access
    User,
    HotelUser,
    Role,
    UserAccess,

    // Table Management
    Table,
    TableCatagories,
    TableBooking,
    QrOrder,

    // Menu Management
    Menu,
    Menu_categ,
    MenuVariants,
    Variants,
    MenuCatalog,
    PaymentMode,
    PaymentModeDefault,
    BillChargeRule,
    NotificationSetting,
    RolePermissionDefault,

    // Addons
    AddonDepartment,
    Addons,
    MenuAddon,

    // Order Management
    Order,
    OrderDetails,
    OrderTax,
    OnlineOrders,
    OnlineOrderDetails,
    Cart,
    AdminCart,

    // Inventory Management
    RawMaterial,
    Unit,
    Recipes,
    StockHistory,
    StockInHand,
    PurchaseOrder,
    PurchaseOrderPayment,
    PurchaseRawMaterial,
    RawMaterialConsumption,
    Supplier,
    Requisition,
    RequisitionItem,
    SemiFinishedItem,
    SemiFinishedRecipe,
    SemiFinishedStock,

    // Financial Management
    DuePaymentReceive,
    EBillCredit,
    EBillCreditDebit,
    ExpenseEntry,
    ExpenseHead,
    TaxType,
    ServiceCharge,
    CashSession,
    CashMovement,

    // Subscription & Payment
    Plan,
    Subscription,
    SubscriptionPayment,
    PhonePayPaymentLink,
    PurchaseRollsAndPrinter,
    TempWebsitePurchase,

    // Settings & Configuration
    KitchenSetting,
    PrinterSetting,
    InvoiceFormate,
    KotFormate,
    PromoCode,

    // Website & Marketing
    webSiteUserData,
    websiteProducts,
    DiscountCode,
    Images,
    WhatsappTemplate,    // Miscellaneous
    TimeLine,
    Testing,
    AppUpdate,
    AdminAddRestoSave,
    Westage,
    AuditLog,
    SyncIndexDB,

    // WhatsApp Agent
    WaConversation,
    WaMessage,

    // CRM
    CrmEmployeeProfile,
    CrmLead,
    CrmLeadActivity,
    CrmAssignmentHistory,
    CrmTask,
    CrmCallLog,
    CrmDemoSchedule,
    CrmPaymentTracking,
    CrmWhatsappCampaign,
    CrmCampaignRecipient,
    CrmAutomationRule,
    CrmAutomationLog,
    CrmNotification,
    CrmMetaLeadSyncLog,
};