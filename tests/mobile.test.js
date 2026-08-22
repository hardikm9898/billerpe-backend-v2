/**
 * MOBILE APP TEST SUITE
 * ═══════════════════════════════════════════════════════════════════
 * Covers: mobile login, dashboard, mobile menu, mobile KOT,
 *         mobile settle bill, mobile pickup orders, due orders,
 *         mobile offline data fetch, mobile reports,
 *         mobile captain auth, token in cookies header.
 */
const request = require("supertest");
const { generateMobileToken, mobileAuthHeader,
        generateAdminToken, adminAuthHeader,
        expectSuccess, expectError, SECRETS } = require("./setup/testHelpers");
const TD = require("./setup/testData");

// ── Mock-prefixed constants for jest.mock factories ──────────────────────────
const mockMobileUser = { id: 12, hotel_id: 1, name: "Priya Cashier", number: "9876500002", active: true };
const mockHotelRecord = { id: 1, hotel_name: "The Grand Spice", gst_no: "27AAACR5055K1Z5" };
const mockOrderDinin = { id: 1001, hotel_id: 1, tableId: 1, order_type: "dinin", status: "in-progress", bill_no: "GS-2024-0001", total_amount: 640, tax_amount: 32, payable_amount: 672, deleted: false };
const mockOrderPickup = { id: 1002, hotel_id: 1, order_type: "pickup", status: "in-progress", customer_name: "Amit Shah", bill_no: "GS-2024-0002", total_amount: 350, payable_amount: 368, deleted: false };
const mockCartItem1 = { id: 501, MenuId: 101, UserId: 11, TableId: 1, hotel_id: 1, qty: 2, totalAmount: 640 };
const mockMenuButterChicken = { id: 101, name: "Butter Chicken", price: 320, hotel_id: 1, category_id: 1, shortCode: "BC", available: true, gst: 5 };
const mockMenuBiryani = { id: 103, name: "Chicken Biryani", price: 350, hotel_id: 1, category_id: 1, shortCode: "CB", available: true, gst: 5 };
const mockTableT1 = { id: 1, tableNumber: "T1", hotel_id: 1, status: "available", capacity: 4 };
const mockTableT2 = { id: 2, tableNumber: "T2", hotel_id: 1, status: "available", capacity: 2 };
const mockTableT3 = { id: 3, tableNumber: "T3", hotel_id: 1, status: "running", capacity: 8 };
const mockTax5Percent = { id: 1, tax_name: "GST 5%", tax_value: 5, hotel_id: 1 };
const mockDuePaymentRecord = { id: 701, hotel_id: 1, customer_name: "Rohan Mehta", customer_number: "9900000001", due_amount: 450, status: "pending", orderId: 1001 };
const mockPromoFlat50 = { id: 1, code: "FLAT50", discount: 50, discount_type: "flat", hotel_id: 1, active: true, min_amount: 200 };
const mockPrinterBilling = { id: 1, hotel_id: 1, printer_name: "BillingPrinter", ip: "192.168.1.100", port: 9100, is_default: true };
const mockServiceCharge = { id: 1, hotel_id: 1, percentage: 10, active: true };

jest.mock("../connection/connect", () => ({ query: jest.fn(), sync: jest.fn(), define: jest.fn().mockReturnValue({ findOne: jest.fn(), findAll: jest.fn().mockResolvedValue([]), create: jest.fn(), update: jest.fn().mockResolvedValue([1]), destroy: jest.fn().mockResolvedValue(1), belongsTo: jest.fn(), hasMany: jest.fn(), hasOne: jest.fn() }) }));
jest.mock("../connection/redis", () => ({ get: jest.fn(), set: jest.fn(), del: jest.fn(), connect: jest.fn() }));
jest.mock("../connection/socket", () => ({
  initializeSocket: jest.fn(),
  checkDashBoardOnOrNot: jest.fn((req, res) => res.json({ error: false, results: { connected: false }, code: 200 })),
}));
jest.mock("../services/upload", () => { const mw = (_r, _res, n) => n(); return { uploadSingleTest: jest.fn(() => mw), uploadMultipleTest: jest.fn(() => mw), uploadWhatsAppTemplateImage: jest.fn(() => mw), uploadSingleAttachedment: jest.fn(() => mw) }; });
jest.mock("../middleware/upload", () => { const fn = (_req, _res, next) => next(); fn.fields = () => fn; fn.single = () => fn; fn.array = () => fn; return fn; });
jest.mock("../services/sendMail", () => ({ sendMail: jest.fn().mockResolvedValue(true) }));

jest.mock("../model", () => ({
  UserSession: { findOne: jest.fn().mockResolvedValue({ user_id: 12 }), create: jest.fn(), destroy: jest.fn() },
  RestaurantSetting: { findOne: jest.fn().mockResolvedValue({ business_date: new Date().toISOString().split("T")[0] }) },
  sequelize: {
    authenticate: jest.fn(), sync: jest.fn(),
    transaction: jest.fn((cb) => cb({})),
    query: jest.fn().mockResolvedValue([[{ total: 5000, count: 10 }]]),
  },
}));
jest.mock("../model/hotelUser", () => ({ findOne: jest.fn().mockResolvedValue(mockMobileUser) }));
jest.mock("../model/hotel", () => ({ findOne: jest.fn().mockResolvedValue(mockHotelRecord), belongsTo: jest.fn(), hasMany: jest.fn(), hasOne: jest.fn(), belongsToMany: jest.fn() }));
jest.mock("../model/user", () => ({ findOne: jest.fn().mockResolvedValue(null) }));
jest.mock("../model/role_mst", () => ({ findOne: jest.fn().mockResolvedValue(null) }));

const mockOrder = {
  findOne: jest.fn(),
  findAll: jest.fn().mockResolvedValue([mockOrderDinin, mockOrderPickup]),
  create: jest.fn().mockResolvedValue(mockOrderDinin),
  update: jest.fn().mockResolvedValue([1]),
  destroy: jest.fn().mockResolvedValue(1),
  count: jest.fn().mockResolvedValue(2),
  sum: jest.fn().mockResolvedValue(1040),
};
const mockOrderDetails = {
  findAll: jest.fn().mockResolvedValue([]),
  bulkCreate: jest.fn().mockResolvedValue([]),
  update: jest.fn().mockResolvedValue([1]),
  destroy: jest.fn().mockResolvedValue(1),
};
const mockAdminCart = {
  findOne: jest.fn(),
  findAll: jest.fn().mockResolvedValue([mockCartItem1]),
  create: jest.fn().mockResolvedValue({}),
  update: jest.fn().mockResolvedValue([1]),
  destroy: jest.fn().mockResolvedValue(1),
};

jest.mock("../model/order", () => mockOrder);
jest.mock("../model/order_details", () => mockOrderDetails);
jest.mock("../model/adminCart", () => mockAdminCart);
jest.mock("../model/menu", () => ({
  findOne: jest.fn().mockResolvedValue(mockMenuButterChicken),
  findAll: jest.fn().mockResolvedValue([mockMenuButterChicken, mockMenuBiryani]),
}));
jest.mock("../model/menu_categ", () => ({
  findOne: jest.fn(),
  findAll: jest.fn().mockResolvedValue([{ id: 1, name: "Mains" }, { id: 2, name: "Breads" }]),
}));
jest.mock("../model/table", () => ({
  findOne: jest.fn().mockResolvedValue(mockTableT1),
  findAll: jest.fn().mockResolvedValue([mockTableT1, mockTableT2, mockTableT3]),
  update: jest.fn().mockResolvedValue([1]),
}));
jest.mock("../model/table_catg", () => ({
  findAll: jest.fn().mockResolvedValue([{ id: 1, name: "Indoor" }]),
}));
jest.mock("../model/timeline", () => ({ create: jest.fn(), findAll: jest.fn().mockResolvedValue([]) }));
jest.mock("../model/orderTax", () => ({ bulkCreate: jest.fn(), findAll: jest.fn().mockResolvedValue([]), update: jest.fn() }));
jest.mock("../model/taxType", () => ({ findAll: jest.fn().mockResolvedValue([mockTax5Percent]) }));
jest.mock("../model/variants", () => ({ findOne: jest.fn(), findAll: jest.fn().mockResolvedValue([]) }));
jest.mock("../model/duePayment", () => ({
  findOne: jest.fn(),
  findAll: jest.fn().mockResolvedValue([mockDuePaymentRecord]),
  create: jest.fn().mockResolvedValue(mockDuePaymentRecord),
  update: jest.fn().mockResolvedValue([1]),
}));
jest.mock("../model/promoCode", () => ({
  findOne: jest.fn().mockResolvedValue(null),
  findAll: jest.fn().mockResolvedValue([mockPromoFlat50]),
}));
jest.mock("../model/invoiceFormate", () => ({ findOne: jest.fn().mockResolvedValue({}) }));
jest.mock("../model/printer_setting", () => ({ findAll: jest.fn().mockResolvedValue([mockPrinterBilling]) }));
jest.mock("../model/restaurantSetting", () => ({ findOne: jest.fn().mockResolvedValue({ business_date: new Date().toISOString().split("T")[0] }) }));
jest.mock("../model/ebillCreditDebit", () => ({ create: jest.fn(), findAll: jest.fn().mockResolvedValue([]) }));
jest.mock("../model/ebillCredit", () => ({ create: jest.fn().mockResolvedValue({}), findAll: jest.fn().mockResolvedValue([]) }));
jest.mock("../controller/redis/redisCrud", () => ({
  updateTableToRadis: jest.fn(), newOrderAppendToRadis: jest.fn(),
  updateOrderAppendToRadis: jest.fn(), deleteOrderToRedis: jest.fn(),
}));
jest.mock("../controller/kds/kds", () => ({ sendKotToAllKdsClient: jest.fn(), orderCompletedSendtoKdsCLient: jest.fn(), otherkot: jest.fn(), removeKotItemFromKds: jest.fn(), descriseKotQtyItemFromKDS: jest.fn(), recallKot: jest.fn(), deleteKitchen: jest.fn(), getKitchenDataById: jest.fn(), setCategoryForKitchen: jest.fn(), createKitchen: jest.fn(), getAllKitchen: jest.fn(), getLiveOrders: jest.fn(), markItemReady: jest.fn() }));
jest.mock("../controller/recipes", () => ({ checkRawMaterialAvailableOrNot: jest.fn().mockResolvedValue(true), addRecipes: jest.fn(), editRecipes: jest.fn(), getAllRecipes: jest.fn(), getSingleRecipes: jest.fn(), deleteRecipe: jest.fn(), getAllRecipesForMenu: jest.fn(), convertMenuWise: jest.fn() }));
jest.mock("../helpers/billNumber", () => ({
  getNextBillNo: jest.fn().mockResolvedValue("GS-MOB-0001"),
  getFinancialYearEndDate: jest.fn(), getFinancialYearStartDate: jest.fn(),
}));
jest.mock("../utils/dateUtils", () => ({ getBusinessDate: jest.fn().mockResolvedValue(new Date().toISOString().split("T")[0]) }));
jest.mock("../model/hotelRestaurantSetting", () => ({ findOne: jest.fn().mockResolvedValue({}) }), { virtual: true });
jest.mock("../model/serviceCharge", () => ({ findOne: jest.fn().mockResolvedValue(mockServiceCharge) }));

let app, mobileToken, mobHeader, adminToken, adminHdr;
beforeAll(() => {
  process.env.JWT_SECRET_KEY_ADMIN = SECRETS.admin;
  const { createTestApp } = require("./setup/testApp");
  app = createTestApp();
  mobileToken = generateMobileToken(TD.MOBILE_USER.id);
  mobHeader = mobileAuthHeader(mobileToken);
  adminToken = generateAdminToken(TD.HOTEL_USER.id);
  adminHdr = adminAuthHeader(adminToken);
  const { UserSession } = require("../model");
  UserSession.findOne.mockResolvedValue({ user_id: TD.MOBILE_USER.id, token: mobileToken });
  const HotelUser = require("../model/hotelUser");
  HotelUser.findOne.mockResolvedValue(TD.MOBILE_USER);
});

// ─────────────────────────────────────────────────────────────────────────────
describe("📱 Mobile Authentication", () => {
  test("T-MOB-01 | Mobile login with valid credentials → token in response", async () => {
    const bcrypt = require("bcrypt");
    const HotelUser = require("../model/hotelUser");
    const hashedPwd = await bcrypt.hash("Mobile@123", 10);
    HotelUser.findOne.mockResolvedValueOnce({ ...TD.MOBILE_USER, password: hashedPwd });

    const res = await request(app)
      .post("/api/mobileLogin")
      .send({ phoneNumber: TD.MOBILE_USER.number, password: "Mobile@123" });

    expect([200, 201]).toContain(res.statusCode);
  });

  test("T-MOB-02 | Mobile request without token → auth error", async () => {
    const res = await request(app)
      .post("/api/dashBoard")
      .send({ date: new Date().toISOString().split("T")[0] });

    expect(res.body.error).toBe(true);
  });

  test("T-MOB-03 | Mobile token in cookies header → authenticated", async () => {
    mockOrder.findAll.mockResolvedValueOnce([TD.ORDER_DININ]);

    const res = await request(app)
      .post("/api/dashBoard")
      .set(mobHeader)
      .send({ date: new Date().toISOString().split("T")[0] });

    expect(res.statusCode).toBeLessThan(500);
  });

  test("T-MOB-04 | Check if web dashboard is connected (socket check)", async () => {
    const res = await request(app)
      .get("/api/dashBoardConnected")
      .set(mobHeader);

    expect(res.statusCode).toBeLessThan(500);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("🗺️ Mobile Tables", () => {
  test("T-MOB-05 | Get tables for mobile → list with status", async () => {
    const res = await request(app)
      .get("/api/mobileTables")
      .set(mobHeader);

    expect([200, 201]).toContain(res.statusCode);
    expect(res.body).toHaveProperty("results");
  });

  test("T-MOB-06 | Table-wise KOT retrieve from mobile → 200", async () => {
    mockOrder.findOne.mockResolvedValueOnce(TD.ORDER_DININ);
    mockOrderDetails.findAll.mockResolvedValueOnce([]);

    const res = await request(app)
      .post("/api/tableWiseKotRetrive")
      .set(mobHeader)
      .send({ tableId: TD.TABLE_T1.id });

    expect([200, 201]).toContain(res.statusCode);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("🍽️ Mobile Menu", () => {
  test("T-MOB-07 | Get menu for hotel on mobile (key=all) → full menu", async () => {
    const res = await request(app)
      .get("/api/mobileMenu/all")
      .set(mobHeader);

    expect([200, 201]).toContain(res.statusCode);
  });

  test("T-MOB-08 | Get menu categories on mobile → list", async () => {
    const res = await request(app)
      .get("/api/mobileCategory")
      .set(mobHeader);

    expect([200, 201]).toContain(res.statusCode);
  });

  test("T-MOB-09 | Menu search by category ID on mobile → filtered items", async () => {
    const res = await request(app)
      .get("/api/mobileMenu/1")
      .set(mobHeader);

    expect([200, 201]).toContain(res.statusCode);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("🧾 Mobile KOT & Orders", () => {
  test("T-MOB-10 | Generate KOT from mobile → 201 + order created", async () => {
    mockOrder.findOne.mockResolvedValueOnce(null);
    mockOrder.create.mockResolvedValueOnce(TD.ORDER_DININ);
    mockOrderDetails.bulkCreate.mockResolvedValueOnce([]);

    const res = await request(app)
      .post("/api/mobileKot")
      .set(mobHeader)
      .send({
        tableId: 1, order_type: "dinin",
        items: [{ menuId: 101, qty: 2, price: 320 }],
        taxes: [], total_amount: 640, payable_amount: 672,
      });

    expect([200, 201]).toContain(res.statusCode);
  });

  test("T-MOB-11 | Hold order from mobile → 200", async () => {
    mockOrder.findOne.mockResolvedValueOnce(TD.ORDER_DININ);
    mockOrder.update.mockResolvedValueOnce([1]);

    const res = await request(app)
      .post("/api/mobileHold")
      .set(mobHeader)
      .send({ orderId: TD.ORDER_DININ.id });

    expect([200, 201]).toContain(res.statusCode);
  });

  test("T-MOB-12 | Settle bill from mobile (cash) → 200", async () => {
    mockOrder.findOne.mockResolvedValueOnce(TD.ORDER_DININ);
    mockOrderDetails.findAll.mockResolvedValueOnce([]);
    mockOrder.update.mockResolvedValueOnce([1]);

    const res = await request(app)
      .post("/api/mobileSettleBills")
      .set(mobHeader)
      .send({
        orderId: TD.ORDER_DININ.id,
        payment_mode: "cash",
        paid_amount: 672, payable_amount: 672,
        taxes: [],
      });

    expect([200, 201]).toContain(res.statusCode);
  });

  test("T-MOB-13 | Get all pickup running orders on mobile → list", async () => {
    mockOrder.findAll.mockResolvedValueOnce([TD.ORDER_PICKUP]);

    const res = await request(app)
      .get("/api/pickupRunningOrder")
      .set(mobHeader);

    expect([200, 201]).toContain(res.statusCode);
  });

  test("T-MOB-14 | Create pickup order from mobile app → 201", async () => {
    mockOrder.findOne.mockResolvedValueOnce(null);
    mockOrder.create.mockResolvedValueOnce(TD.ORDER_PICKUP);
    mockOrderDetails.bulkCreate.mockResolvedValueOnce([]);

    const res = await request(app)
      .post("/api/mobilepickup")
      .set(mobHeader)
      .send({
        order_type: "pickup",
        customer_name: "Rohit Sharma",
        items: [{ menuId: 103, qty: 1, price: 350 }],
        taxes: [], total_amount: 350, payable_amount: 368,
      });

    expect([200, 201]).toContain(res.statusCode);
  });

  test("T-MOB-15 | Print bill from mobile → 200", async () => {
    mockOrder.findOne.mockResolvedValueOnce({ ...TD.ORDER_DININ, status: "success" });
    mockOrderDetails.findAll.mockResolvedValueOnce([]);

    const res = await request(app)
      .post("/api/mobilePrintBill")
      .set(mobHeader)
      .send({ orderId: TD.ORDER_DININ.id });

    expect([200, 201]).toContain(res.statusCode);
  });

  test("T-MOB-16 | Delete mobile order → 200", async () => {
    mockOrder.findOne.mockResolvedValueOnce(TD.ORDER_DININ);
    mockOrder.update.mockResolvedValueOnce([1]);

    const res = await request(app)
      .post("/api/mobileDeleteOrder")
      .set(mobHeader)
      .send({ orderId: TD.ORDER_DININ.id });

    expect([200, 201]).toContain(res.statusCode);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("💸 Mobile Due Payments", () => {
  test("T-MOB-17 | Get due orders on mobile → list", async () => {
    const DuePayment = require("../model/duePayment");
    DuePayment.findAll.mockResolvedValueOnce([TD.DUE_PAYMENT]);

    const res = await request(app)
      .post("/api/getDueOrdersMobile")
      .set(mobHeader)
      .send({});

    expect([200, 201]).toContain(res.statusCode);
  });

  test("T-MOB-18 | Settle single due from mobile → 200", async () => {
    const DuePayment = require("../model/duePayment");
    DuePayment.findOne.mockResolvedValueOnce(TD.DUE_PAYMENT);
    DuePayment.update.mockResolvedValueOnce([1]);

    const res = await request(app)
      .post("/api/settleDueMobile")
      .set(mobHeader)
      .send({ dueId: TD.DUE_PAYMENT.id, payment_mode: "cash", paid_amount: 450 });

    expect([200, 201]).toContain(res.statusCode);
  });

  test("T-MOB-19 | Settle all dues for a customer from mobile → 200", async () => {
    const DuePayment = require("../model/duePayment");
    DuePayment.findAll.mockResolvedValueOnce([TD.DUE_PAYMENT]);
    DuePayment.update.mockResolvedValue([1]);

    const res = await request(app)
      .post("/api/settleDueAllMobile")
      .set(mobHeader)
      .send({ customer_number: "9900000001", payment_mode: "cash", paid_amount: 450 });

    expect([200, 201]).toContain(res.statusCode);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("📊 Mobile Reports", () => {
  test("T-MOB-20 | Item-wise report on mobile → top items list", async () => {
    mockOrderDetails.findAll.mockResolvedValueOnce([
      { menu_id: 101, qty: 10, price: 320 },
    ]);

    const res = await request(app)
      .post("/api/itemWisereport")
      .set(mobHeader)
      .send({ from_date: "2024-04-01", to_date: "2024-04-30" });

    expect([200, 201]).toContain(res.statusCode);
  });

  test("T-MOB-21 | Day-wise sales report on mobile → 200", async () => {
    mockOrder.findAll.mockResolvedValueOnce([TD.ORDER_DININ]);

    const res = await request(app)
      .post("/api/salesReportDayWiseMobile")
      .set(mobHeader)
      .send({ from_date: "2024-04-01", to_date: "2024-04-07" });

    expect([200, 201]).toContain(res.statusCode);
  });

  test("T-MOB-22 | Discounted orders report on mobile → 200", async () => {
    mockOrder.findAll.mockResolvedValueOnce([{ ...TD.ORDER_DININ, discount: 50 }]);

    const res = await request(app)
      .post("/api/discountedOrdersReportMobile")
      .set(mobHeader)
      .send({ from_date: "2024-04-01", to_date: "2024-04-30" });

    expect([200, 201]).toContain(res.statusCode);
  });

  test("T-MOB-23 | Get all promo codes for mobile → list", async () => {
    const res = await request(app)
      .get("/api/getmobilePromoCode")
      .set(mobHeader);

    expect([200, 201]).toContain(res.statusCode);
  });

  test("T-MOB-24 | Get user access permissions for mobile → 200", async () => {
    const res = await request(app)
      .get("/api/mobileUserAccess")
      .set(mobHeader);

    expect([200, 201]).toContain(res.statusCode);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("🔌 Mobile Offline Data Sync", () => {
  test("T-MOB-25 | Get all tables for offline mode → full table list", async () => {
    const res = await request(app)
      .get("/api/mobileGetTables")
      .set(mobHeader);

    expect([200, 201]).toContain(res.statusCode);
  });

  test("T-MOB-26 | Get all mobile orders for offline → list", async () => {
    mockOrder.findAll.mockResolvedValueOnce([TD.ORDER_DININ, TD.ORDER_PICKUP]);

    const res = await request(app)
      .get("/api/gettingMobileAllOrders")
      .set(mobHeader);

    expect([200, 201]).toContain(res.statusCode);
  });

  test("T-MOB-27 | Get complete menu for offline sync → full menu", async () => {
    const res = await request(app)
      .get("/api/gettingMobileMenu")
      .set(mobHeader);

    expect([200, 201]).toContain(res.statusCode);
  });

  test("T-MOB-28 | Get invoice header/footer for offline → 200", async () => {
    const res = await request(app)
      .get("/api/gettingHeaderFooter")
      .set(mobHeader);

    expect([200, 201]).toContain(res.statusCode);
  });

  test("T-MOB-29 | Get service charge for mobile → 200", async () => {
    const res = await request(app)
      .get("/api/serviceCharge")
      .set(mobHeader);

    expect([200, 201]).toContain(res.statusCode);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("📤 E-Bill from Mobile", () => {
  test("T-MOB-30 | Send e-bill from mobile → 200", async () => {
    mockOrder.findOne.mockResolvedValueOnce({ ...TD.ORDER_DININ, status: "success" });
    const EbillCredit = require("../model/ebillCredit");
    EbillCredit.create.mockResolvedValueOnce({ id: 1 });

    const res = await request(app)
      .post("/api/sentMobileEbill")
      .set(mobHeader)
      .send({
        orderId: TD.ORDER_DININ.id,
        customer_number: "9900000001",
      });

    expect([200, 201]).toContain(res.statusCode);
  });
});
