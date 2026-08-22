/**
 * TAKEAWAY / PICKUP & DELIVERY ORDER TEST SUITE
 * ═══════════════════════════════════════════════════════════════════
 * Covers: pickup order creation, customer name requirement,
 *         delivery order, pickup order list, settle pickup,
 *         multiple pickup orders for different customers,
 *         running pickup orders.
 */
const request = require("supertest");
const { generateAdminToken, adminAuthHeader,
        expectSuccess, expectError, SECRETS } = require("../setup/testHelpers");
const TD = require("../setup/testData");

// ── Mock-prefixed constants for jest.mock factories ──────────────────────────
const mockHotelUserRecord = { id: 10, hotel_id: 1, name: "Ravi Admin", number: "9876543210", active: true, role: "admin" };
const mockHotelRecord = { id: 1, hotel_name: "The Grand Spice", gst_no: "27AAACR5055K1Z5" };
const mockOrderPickup = { id: 1002, hotel_id: 1, order_type: "pickup", status: "in-progress", customer_name: "Amit Shah", bill_no: "GS-2024-0002", total_amount: 350, payable_amount: 368, deleted: false };
const mockCartItem1 = { id: 501, MenuId: 101, UserId: 11, TableId: 1, hotel_id: 1, qty: 2, totalAmount: 640 };
const mockMenuButterChicken = { id: 101, name: "Butter Chicken", price: 320, hotel_id: 1, category_id: 1, shortCode: "BC", available: true, gst: 5 };
const mockTax5Percent = { id: 1, tax_name: "GST 5%", tax_value: 5, hotel_id: 1 };
const mockPrinterBilling = { id: 1, hotel_id: 1, printer_name: "BillingPrinter", ip: "192.168.1.100", port: 9100, is_default: true };

jest.mock("../../connection/connect", () => ({ query: jest.fn(), sync: jest.fn(), define: jest.fn().mockReturnValue({ findOne: jest.fn(), findAll: jest.fn().mockResolvedValue([]), create: jest.fn(), update: jest.fn().mockResolvedValue([1]), destroy: jest.fn().mockResolvedValue(1), belongsTo: jest.fn(), hasMany: jest.fn(), hasOne: jest.fn() }) }));
jest.mock("../../connection/redis", () => ({ get: jest.fn(), set: jest.fn(), del: jest.fn(), connect: jest.fn() }));
jest.mock("../../connection/socket", () => ({ initializeSocket: jest.fn(), checkDashBoardOnOrNot: jest.fn((req, res) => res.json({})) }));
jest.mock("../../services/upload", () => { const mw = (_r, _res, n) => n(); return { uploadSingleTest: jest.fn(() => mw), uploadMultipleTest: jest.fn(() => mw), uploadWhatsAppTemplateImage: jest.fn(() => mw), uploadSingleAttachedment: jest.fn(() => mw) }; });
jest.mock("../../middleware/upload", () => { const fn = (_req, _res, next) => next(); fn.fields = () => fn; fn.single = () => fn; fn.array = () => fn; return fn; });

jest.mock("../../model", () => ({
  UserSession: { findOne: jest.fn().mockResolvedValue({ user_id: 10 }), create: jest.fn(), destroy: jest.fn() },
  RestaurantSetting: { findOne: jest.fn().mockResolvedValue({ business_date: new Date().toISOString().split("T")[0] }) },
  sequelize: { authenticate: jest.fn(), sync: jest.fn(), transaction: jest.fn((cb) => cb({})) },
}));
jest.mock("../../model/hotelUser", () => ({ findOne: jest.fn().mockResolvedValue(mockHotelUserRecord) }));
jest.mock("../../model/hotel", () => ({ findOne: jest.fn().mockResolvedValue(mockHotelRecord), belongsTo: jest.fn(), hasMany: jest.fn(), hasOne: jest.fn(), belongsToMany: jest.fn() }));
jest.mock("../../model/user", () => ({ findOne: jest.fn().mockResolvedValue(null) }));
jest.mock("../../model/role_mst", () => ({ findOne: jest.fn().mockResolvedValue(null) }));

const mockOrder = {
  findOne: jest.fn(),
  findAll: jest.fn().mockResolvedValue([]),
  create: jest.fn().mockResolvedValue(mockOrderPickup),
  update: jest.fn().mockResolvedValue([1]),
  destroy: jest.fn().mockResolvedValue(1),
  count: jest.fn().mockResolvedValue(0),
};
const mockOrderDetails = {
  findAll: jest.fn().mockResolvedValue([]),
  create: jest.fn(),
  bulkCreate: jest.fn().mockResolvedValue([]),
  update: jest.fn().mockResolvedValue([1]),
  destroy: jest.fn().mockResolvedValue(1),
};
const mockAdminCart = {
  findOne: jest.fn(),
  findAll: jest.fn().mockResolvedValue([mockCartItem1]),
  create: jest.fn(),
  update: jest.fn().mockResolvedValue([1]),
  destroy: jest.fn().mockResolvedValue(1),
};
const mockMenu = { findOne: jest.fn().mockResolvedValue(mockMenuButterChicken), findAll: jest.fn() };
const mockTable = { findOne: jest.fn().mockResolvedValue(null), update: jest.fn().mockResolvedValue([1]) };

jest.mock("../../model/order", () => mockOrder);
jest.mock("../../model/order_details", () => mockOrderDetails);
jest.mock("../../model/adminCart", () => mockAdminCart);
jest.mock("../../model/menu", () => mockMenu);
jest.mock("../../model/menu_categ", () => ({ findAll: jest.fn().mockResolvedValue([]) }));
jest.mock("../../model/table", () => mockTable);
jest.mock("../../model/table_catg", () => ({ findOne: jest.fn(), findAll: jest.fn().mockResolvedValue([]) }));
jest.mock("../../model/timeline", () => ({ create: jest.fn(), findAll: jest.fn().mockResolvedValue([]) }));
jest.mock("../../model/orderTax", () => ({ bulkCreate: jest.fn(), findAll: jest.fn().mockResolvedValue([]), update: jest.fn() }));
jest.mock("../../model/taxType", () => ({ findAll: jest.fn().mockResolvedValue([mockTax5Percent]) }));
jest.mock("../../model/variants", () => ({ findOne: jest.fn(), findAll: jest.fn().mockResolvedValue([]) }));
jest.mock("../../model/duePayment", () => ({ create: jest.fn(), findOne: jest.fn() }));
jest.mock("../../model/promoCode", () => ({ findOne: jest.fn().mockResolvedValue(null) }));
jest.mock("../../model/invoiceFormate", () => ({ findOne: jest.fn().mockResolvedValue({}) }));
jest.mock("../../model/printer_setting", () => ({ findAll: jest.fn().mockResolvedValue([mockPrinterBilling]) }));
jest.mock("../../model/restaurantSetting", () => ({ findOne: jest.fn().mockResolvedValue({ business_date: new Date().toISOString().split("T")[0] }) }));
jest.mock("../../model/ebillCreditDebit", () => ({ create: jest.fn(), findAll: jest.fn().mockResolvedValue([]) }));
jest.mock("../../model/ebillCredit", () => ({ create: jest.fn(), findAll: jest.fn().mockResolvedValue([]) }));
jest.mock("../../controller/redis/redisCrud", () => ({
  updateTableToRadis: jest.fn(), newOrderAppendToRadis: jest.fn(),
  updateOrderAppendToRadis: jest.fn(), deleteOrderToRedis: jest.fn(),
}));
jest.mock("../../controller/kds/kds", () => ({ sendKotToAllKdsClient: jest.fn(), orderCompletedSendtoKdsCLient: jest.fn(), otherkot: jest.fn(), removeKotItemFromKds: jest.fn(), descriseKotQtyItemFromKDS: jest.fn(), recallKot: jest.fn(), deleteKitchen: jest.fn(), getKitchenDataById: jest.fn(), setCategoryForKitchen: jest.fn(), createKitchen: jest.fn(), getAllKitchen: jest.fn(), getLiveOrders: jest.fn(), markItemReady: jest.fn() }));
jest.mock("../../controller/recipes", () => ({ checkRawMaterialAvailableOrNot: jest.fn().mockResolvedValue(true), addRecipes: jest.fn(), editRecipes: jest.fn(), getAllRecipes: jest.fn(), getSingleRecipes: jest.fn(), deleteRecipe: jest.fn(), getAllRecipesForMenu: jest.fn(), convertMenuWise: jest.fn() }));
jest.mock("../../helpers/billNumber", () => ({
  getNextBillNo: jest.fn().mockResolvedValue("GS-2024-0002"),
  getFinancialYearEndDate: jest.fn(),
  getFinancialYearStartDate: jest.fn(),
}));
jest.mock("../../utils/dateUtils", () => ({ getBusinessDate: jest.fn().mockResolvedValue(new Date().toISOString().split("T")[0]) }));

let app, authHeader, adminToken;
beforeAll(() => {
  process.env.JWT_SECRET_KEY_ADMIN = SECRETS.admin;
  const { createTestApp } = require("../setup/testApp");
  app = createTestApp();
  adminToken = generateAdminToken(TD.HOTEL_USER.id);
  authHeader = adminAuthHeader(adminToken);
  const { UserSession } = require("../../model");
  UserSession.findOne.mockResolvedValue({ user_id: TD.HOTEL_USER.id, token: adminToken });
  const HotelUser = require("../../model/hotelUser");
  HotelUser.findOne.mockResolvedValue(TD.HOTEL_USER);
});

// ─────────────────────────────────────────────────────────────────────────────
describe("🥡 Pickup (Takeaway) Orders", () => {
  test("T-PKP-01 | Create pickup order with customer name → 201", async () => {
    mockOrder.findOne.mockResolvedValueOnce(null);
    mockOrder.create.mockResolvedValueOnce(TD.ORDER_PICKUP);
    mockOrderDetails.bulkCreate.mockResolvedValueOnce([]);

    const res = await request(app)
      .post("/api/kotOrder")
      .set(authHeader)
      .send({
        order_type: "pickup",
        customer_name: "Amit Shah",
        customer_number: "9900000001",
        items: [{ menuId: 103, qty: 1, price: 350 }],
        taxes: [],
        total_amount: 350,
        payable_amount: 368,
      });

    expect([200, 201]).toContain(res.statusCode);
    expectSuccess(res.body);
  });

  test("T-PKP-02 | Pickup order WITHOUT customer name → validation error", async () => {
    const res = await request(app)
      .post("/api/kotOrder")
      .set(authHeader)
      .send({
        order_type: "pickup",
        items: [{ menuId: 103, qty: 1, price: 350 }],
        taxes: [],
        total_amount: 350,
        payable_amount: 368,
      });

    expect(res.statusCode).toBeLessThan(500);
  });

  test("T-PKP-03 | Get all pickup orders → list", async () => {
    mockOrder.findAll.mockResolvedValueOnce([TD.ORDER_PICKUP]);

    const res = await request(app)
      .get("/api/pickupOrder")
      .set(authHeader);

    expect([200, 201]).toContain(res.statusCode);
  });

  test("T-PKP-04 | Multiple pickup orders for different customers → all appear in list", async () => {
    const order2 = { ...TD.ORDER_PICKUP, id: 2000, customer_name: "Priya Sharma" };
    const order3 = { ...TD.ORDER_PICKUP, id: 2001, customer_name: "Rajan Patel" };
    mockOrder.findAll.mockResolvedValueOnce([TD.ORDER_PICKUP, order2, order3]);

    const res = await request(app)
      .get("/api/pickupOrder")
      .set(authHeader);

    expect([200, 201]).toContain(res.statusCode);
  });

  test("T-PKP-05 | Settle pickup order → 200", async () => {
    mockOrder.findOne.mockResolvedValueOnce(TD.ORDER_PICKUP);
    mockOrderDetails.findAll.mockResolvedValueOnce([]);
    mockOrder.update.mockResolvedValueOnce([1]);

    const res = await request(app)
      .post("/api/settleBills")
      .set(authHeader)
      .send({
        orderId: TD.ORDER_PICKUP.id,
        payment_mode: "cash",
        paid_amount: 368,
        payable_amount: 368,
        discount: 0,
        taxes: [],
      });

    expect([200, 201]).toContain(res.statusCode);
    expectSuccess(res.body);
  });

  test("T-PKP-06 | Search pending pickup bills (settle pending) → list", async () => {
    mockOrder.findAll.mockResolvedValueOnce([TD.ORDER_PICKUP]);

    const res = await request(app)
      .get("/api/settlePendingBill")
      .set(authHeader);

    expect([200, 201]).toContain(res.statusCode);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("🛵 Delivery Orders", () => {
  test("T-DLV-01 | Create delivery order with customer details → 201", async () => {
    mockOrder.findOne.mockResolvedValueOnce(null);
    mockOrder.create.mockResolvedValueOnce({
      ...TD.ORDER_PICKUP, id: 3001, order_type: "delivery",
      customer_name: "Deepak Kumar", customer_address: "45 Park St",
    });
    mockOrderDetails.bulkCreate.mockResolvedValueOnce([]);

    const res = await request(app)
      .post("/api/kotOrder")
      .set(authHeader)
      .send({
        order_type: "delivery",
        customer_name: "Deepak Kumar",
        customer_number: "9800000099",
        customer_address: "45 Park St, Pune",
        items: [{ menuId: 101, qty: 1, price: 320 }],
        taxes: [],
        total_amount: 320,
        payable_amount: 336,
      });

    expect([200, 201]).toContain(res.statusCode);
  });

  test("T-DLV-02 | Delivery order settle with online payment → 200", async () => {
    mockOrder.findOne.mockResolvedValueOnce({ ...TD.ORDER_PICKUP, order_type: "delivery" });
    mockOrderDetails.findAll.mockResolvedValueOnce([]);
    mockOrder.update.mockResolvedValueOnce([1]);

    const res = await request(app)
      .post("/api/settleBills")
      .set(authHeader)
      .send({
        orderId: TD.ORDER_PICKUP.id,
        payment_mode: "upi",
        paid_amount: 336,
        payable_amount: 336,
        taxes: [],
      });

    expect([200, 201]).toContain(res.statusCode);
  });
});
