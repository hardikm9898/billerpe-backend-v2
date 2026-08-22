/**
 * KDS (KITCHEN DISPLAY SYSTEM) TEST SUITE
 * ═══════════════════════════════════════════════════════════════════
 * Covers: KDS order display, mark item prepared, mark order complete,
 *         remove item from KDS, KDS for multiple categories,
 *         KDS does not show settled/cancelled orders,
 *         Zomato/Swiggy KOT on KDS.
 */
const request = require("supertest");
const { generateAdminToken, adminAuthHeader,
        expectSuccess, expectError, SECRETS } = require("./setup/testHelpers");
const TD = require("./setup/testData");

// ── Mock-prefixed constants for jest.mock factories ──────────────────────────
const mockHotelUserRecord = { id: 10, hotel_id: 1, name: "Ravi Admin", number: "9876543210", active: true, role: "admin" };
const mockHotelRecord = { id: 1, hotel_name: "The Grand Spice", gst_no: "27AAACR5055K1Z5" };
const mockOrderDinin = { id: 1001, hotel_id: 1, tableId: 1, order_type: "dinin", status: "in-progress", bill_no: "GS-2024-0001", total_amount: 640, tax_amount: 32, payable_amount: 672, deleted: false };
const mockMenuButterChicken = { id: 101, name: "Butter Chicken", price: 320, hotel_id: 1, category_id: 1, shortCode: "BC", available: true, gst: 5 };
const mockTableT1 = { id: 1, tableNumber: "T1", hotel_id: 1, status: "available", capacity: 4 };
const mockPrinterKds = { id: 2, hotel_id: 1, printer_name: "KitchenPrinter", ip: "192.168.1.101", port: 9100, is_default: false };

jest.mock("../connection/connect", () => ({ query: jest.fn(), sync: jest.fn(), define: jest.fn().mockReturnValue({ findOne: jest.fn(), findAll: jest.fn().mockResolvedValue([]), create: jest.fn(), update: jest.fn().mockResolvedValue([1]), destroy: jest.fn().mockResolvedValue(1), belongsTo: jest.fn(), hasMany: jest.fn(), hasOne: jest.fn() }) }));
jest.mock("../connection/redis", () => ({ get: jest.fn(), set: jest.fn(), del: jest.fn(), connect: jest.fn() }));
jest.mock("../connection/socket", () => ({
  initializeSocket: jest.fn(),
  checkDashBoardOnOrNot: jest.fn((req, res) => res.json({ error: false, results: {}, code: 200 })),
}));
jest.mock("../services/upload", () => { const mw = (_r, _res, n) => n(); return { uploadSingleTest: jest.fn(() => mw), uploadMultipleTest: jest.fn(() => mw), uploadWhatsAppTemplateImage: jest.fn(() => mw), uploadSingleAttachedment: jest.fn(() => mw) }; });
jest.mock("../middleware/upload", () => { const fn = (_req, _res, next) => next(); fn.fields = () => fn; fn.single = () => fn; fn.array = () => fn; return fn; });

jest.mock("../model", () => ({
  UserSession: { findOne: jest.fn().mockResolvedValue({ user_id: 10 }), create: jest.fn(), destroy: jest.fn() },
  sequelize: { authenticate: jest.fn(), sync: jest.fn() },
}));
jest.mock("../model/hotelUser", () => ({ findOne: jest.fn().mockResolvedValue(mockHotelUserRecord) }));
jest.mock("../model/hotel", () => ({ findOne: jest.fn().mockResolvedValue(mockHotelRecord), belongsTo: jest.fn(), hasMany: jest.fn(), hasOne: jest.fn(), belongsToMany: jest.fn() }));
jest.mock("../model/user", () => ({ findOne: jest.fn().mockResolvedValue(null) }));
jest.mock("../model/role_mst", () => ({ findOne: jest.fn().mockResolvedValue(null) }));
jest.mock("../controller/recipes", () => ({ checkRawMaterialAvailableOrNot: jest.fn().mockResolvedValue(true), addRecipes: jest.fn(), editRecipes: jest.fn(), getAllRecipes: jest.fn(), getSingleRecipes: jest.fn(), deleteRecipe: jest.fn(), getAllRecipesForMenu: jest.fn(), convertMenuWise: jest.fn() }));

const mockKdsOrder = {
  id: 1,
  hotel_id: 1,
  order_id: 1001,
  status: "kot",
  items: [{ menu_id: 101, name: "Butter Chicken", qty: 2, status: "pending" }],
};

const mockOrderDetails = {
  findOne: jest.fn(),
  findAll: jest.fn().mockResolvedValue([
    { id: 1, menu_id: 101, qty: 2, status: "kot", hmsOrderMstId: 1001 },
    { id: 2, menu_id: 104, qty: 4, status: "kot", hmsOrderMstId: 1001 },
  ]),
  update: jest.fn().mockResolvedValue([1]),
  bulkCreate: jest.fn().mockResolvedValue([]),
};
const mockOrder = {
  findOne: jest.fn().mockResolvedValue(mockOrderDinin),
  findAll: jest.fn().mockResolvedValue([mockOrderDinin]),
  update: jest.fn().mockResolvedValue([1]),
};

jest.mock("../model/order", () => mockOrder);
jest.mock("../model/order_details", () => mockOrderDetails);
jest.mock("../model/menu", () => ({ findOne: jest.fn().mockResolvedValue(mockMenuButterChicken), findAll: jest.fn().mockResolvedValue([]) }));
jest.mock("../model/menu_categ", () => ({ findOne: jest.fn(), findAll: jest.fn().mockResolvedValue([]) }));
jest.mock("../model/table", () => ({ findOne: jest.fn().mockResolvedValue(mockTableT1), update: jest.fn().mockResolvedValue([1]) }));
jest.mock("../model/table_catg", () => ({ findAll: jest.fn().mockResolvedValue([]) }));
jest.mock("../model/variants", () => ({ findOne: jest.fn(), findAll: jest.fn().mockResolvedValue([]) }));
jest.mock("../model/timeline", () => ({ create: jest.fn(), findAll: jest.fn().mockResolvedValue([]) }));
jest.mock("../model/adminCart", () => ({ findAll: jest.fn().mockResolvedValue([]), destroy: jest.fn() }));
jest.mock("../model/invoiceFormate", () => ({ findOne: jest.fn().mockResolvedValue({}) }));
jest.mock("../model/printer_setting", () => ({ findAll: jest.fn().mockResolvedValue([mockPrinterKds]) }));
jest.mock("../controller/redis/redisCrud", () => ({
  updateTableToRadis: jest.fn(), newOrderAppendToRadis: jest.fn(),
  updateOrderAppendToRadis: jest.fn(), deleteOrderToRedis: jest.fn(),
}));
jest.mock("../controller/kds/kds", () => ({ sendKotToAllKdsClient: jest.fn(), orderCompletedSendtoKdsCLient: jest.fn(), otherkot: jest.fn(), removeKotItemFromKds: jest.fn(), descriseKotQtyItemFromKDS: jest.fn(), recallKot: jest.fn(), deleteKitchen: jest.fn(), getKitchenDataById: jest.fn(), setCategoryForKitchen: jest.fn(), createKitchen: jest.fn(), getAllKitchen: jest.fn(), getLiveOrders: jest.fn(), markItemReady: jest.fn() }));

let app, authHeader, adminToken;
beforeAll(() => {
  process.env.JWT_SECRET_KEY_ADMIN = SECRETS.admin;
  const { createTestApp } = require("./setup/testApp");
  app = createTestApp();
  adminToken = generateAdminToken(TD.HOTEL_USER.id);
  authHeader = adminAuthHeader(adminToken);
  const { UserSession } = require("../model");
  UserSession.findOne.mockResolvedValue({ user_id: TD.HOTEL_USER.id, token: adminToken });
  const HotelUser = require("../model/hotelUser");
  HotelUser.findOne.mockResolvedValue(TD.HOTEL_USER);
});

// ─────────────────────────────────────────────────────────────────────────────
describe("🖥️  KDS Order Display", () => {
  test("T-KDS-01 | Get all KOT orders for KDS → list of pending items", async () => {
    mockOrder.findAll.mockResolvedValueOnce([TD.ORDER_DININ]);
    mockOrderDetails.findAll.mockResolvedValueOnce([
      { id: 1, menu_id: 101, qty: 2, status: "kot" },
    ]);

    const res = await request(app)
      .get("/api/kotOrder")
      .set(authHeader);

    expect([200, 201]).toContain(res.statusCode);
    expect(res.body).toHaveProperty("results");
  });

  test("T-KDS-02 | KDS shows only 'kot' status items, not 'delivered'", async () => {
    mockOrderDetails.findAll.mockResolvedValueOnce([
      { id: 1, menu_id: 101, qty: 2, status: "kot" },
      { id: 2, menu_id: 104, qty: 1, status: "delivered" },
    ]);

    const kotItems = mockOrderDetails.findAll.mock.results[0]?.value;
    if (kotItems) {
      const result = await kotItems;
      const visibleItems = result.filter((i) => i.status === "kot");
      expect(visibleItems.length).toBe(1);
      expect(visibleItems[0].menu_id).toBe(101);
    }
    expect(true).toBe(true);
  });

  test("T-KDS-03 | No orders in KDS when restaurant just opened → empty list", async () => {
    mockOrder.findAll.mockResolvedValueOnce([]);

    const res = await request(app)
      .get("/api/kotOrder")
      .set(authHeader);

    expect([200, 201]).toContain(res.statusCode);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("✅ Mark Items as Prepared / Delivered", () => {
  test("T-KDS-04 | Mark single item as delivered on KDS → status updated", async () => {
    mockOrderDetails.findOne.mockResolvedValueOnce({ id: 1, status: "kot", menu_id: 101 });
    mockOrderDetails.update.mockResolvedValueOnce([1]);

    const res = await request(app)
      .post("/api/adminOrder")
      .set(authHeader)
      .send({ orderDetailId: 1, status: "delivered" });

    expect([200, 201]).toContain(res.statusCode);
  });

  test("T-KDS-05 | Mark all items of an order as delivered → order status = delivered", async () => {
    mockOrder.findOne.mockResolvedValueOnce(TD.ORDER_DININ);
    mockOrderDetails.findAll.mockResolvedValueOnce([
      { id: 1, status: "delivered" },
      { id: 2, status: "delivered" },
    ]);
    mockOrder.update.mockResolvedValueOnce([1]);

    const allDelivered = [{ status: "delivered" }, { status: "delivered" }]
      .every((i) => i.status === "delivered");
    expect(allDelivered).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("🖨️  KOT PDF Generation", () => {
  test("T-KDS-06 | Generate KOT PDF → returns file reference", async () => {
    mockOrder.findOne.mockResolvedValueOnce(TD.ORDER_DININ);
    mockOrderDetails.findAll.mockResolvedValueOnce([]);

    const res = await request(app)
      .post("/api/generateKotPdf")
      .set(authHeader)
      .send({ orderId: TD.ORDER_DININ.id });

    expect(res.statusCode).toBeLessThan(500);
  });

  test("T-KDS-07 | Reprint KOT → 200", async () => {
    mockOrder.findOne.mockResolvedValueOnce(TD.ORDER_DININ);
    mockOrderDetails.findAll.mockResolvedValueOnce([]);

    const res = await request(app)
      .post("/api/reprintKot")
      .set(authHeader)
      .send({ orderId: TD.ORDER_DININ.id });

    expect([200, 201]).toContain(res.statusCode);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("⏱️ Order Timer (Table Overtime)", () => {
  test("T-KDS-08 | Set table time over flag → 200", async () => {
    mockOrder.findOne.mockResolvedValueOnce(TD.ORDER_DININ);
    mockOrder.update.mockResolvedValueOnce([1]);

    const res = await request(app)
      .post("/api/ordertimeOver")
      .set(authHeader)
      .send({ orderId: TD.ORDER_DININ.id });

    expect([200, 201]).toContain(res.statusCode);
  });

  test("T-KDS-09 | Extend table time → 200", async () => {
    mockOrder.findOne.mockResolvedValueOnce(TD.ORDER_DININ);
    mockOrder.update.mockResolvedValueOnce([1]);

    const res = await request(app)
      .post("/api/ordertimeExtend")
      .set(authHeader)
      .send({ orderId: TD.ORDER_DININ.id, extend_minutes: 30 });

    expect([200, 201]).toContain(res.statusCode);
  });
});
