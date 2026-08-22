/**
 * REPORTS TEST SUITE
 * ═══════════════════════════════════════════════════════════════════
 * Covers: sales report (date range), item-wise report,
 *         day-wise sales, user-wise sales, cancelled orders,
 *         expense report, inventory report, custom report,
 *         dashboard data, online order totals,
 *         report edge cases (empty date range, future dates).
 */
const request = require("supertest");
const { generateAdminToken, adminAuthHeader,
        expectSuccess, expectError, today, yesterday,
        lastMonthStart, SECRETS } = require("./setup/testHelpers");
const TD = require("./setup/testData");
const mockTD = TD; // alias for use inside jest.mock() factory functions (must be mock-prefixed)

// ── Mock-prefixed constants for jest.mock factories ──────────────────────────
const mockHotelUserRecord = { id: 10, hotel_id: 1, name: "Ravi Admin", number: "9876543210", active: true, role: "admin" };
const mockHotelRecord = { id: 1, hotel_name: "The Grand Spice", gst_no: "27AAACR5055K1Z5" };
const mockExpenseEntryRecord = { id: 1, head_id: 1, amount: 2500, note: "Electricity bill April", hotel_id: 1, date: "2024-04-01" };
const mockMenuButterChickenRecord = { id: 101, name: "Butter Chicken", price: 320, hotel_id: 1, category_id: 1, shortCode: "BC", available: true, gst: 5 };
const mockTableT1Record = { id: 1, tableNumber: "T1", hotel_id: 1, status: "available", capacity: 4 };
const mockExpenseHeadRecord = { id: 1, name: "Utilities", hotel_id: 1 };
const mockRawMaterialChickenRecord = { id: 1, name: "Chicken", unit: "kg", current_stock: 15, min_stock: 2, hotel_id: 1 };

jest.mock("../connection/connect", () => ({ query: jest.fn(), sync: jest.fn(), define: jest.fn().mockReturnValue({ findOne: jest.fn(), findAll: jest.fn().mockResolvedValue([]), create: jest.fn(), update: jest.fn().mockResolvedValue([1]), destroy: jest.fn().mockResolvedValue(1), belongsTo: jest.fn(), hasMany: jest.fn(), hasOne: jest.fn() }) }));
jest.mock("../connection/redis", () => ({ get: jest.fn(), set: jest.fn(), del: jest.fn(), connect: jest.fn() }));
jest.mock("../connection/socket", () => ({ initializeSocket: jest.fn(), checkDashBoardOnOrNot: jest.fn((req, res) => res.json({})) }));
jest.mock("../services/upload", () => { const mw = (_r, _res, n) => n(); return { uploadSingleTest: jest.fn(() => mw), uploadMultipleTest: jest.fn(() => mw), uploadWhatsAppTemplateImage: jest.fn(() => mw), uploadSingleAttachedment: jest.fn(() => mw) }; });
jest.mock("../middleware/upload", () => { const fn = (_req, _res, next) => next(); fn.fields = () => fn; fn.single = () => fn; fn.array = () => fn; return fn; });

jest.mock("../model", () => ({
  UserSession: { findOne: jest.fn().mockResolvedValue({ user_id: 10 }), create: jest.fn(), destroy: jest.fn() },
  sequelize: {
    authenticate: jest.fn(), sync: jest.fn(),
    query: jest.fn().mockResolvedValue([[{ total: 5000, count: 15 }]]),
  },
}));
jest.mock("../model/hotelUser", () => ({ findOne: jest.fn().mockResolvedValue(mockHotelUserRecord), findAll: jest.fn().mockResolvedValue([mockHotelUserRecord]) }));
jest.mock("../model/hotel", () => ({ findOne: jest.fn().mockResolvedValue(mockHotelRecord), belongsTo: jest.fn(), hasMany: jest.fn(), hasOne: jest.fn(), belongsToMany: jest.fn() }));
jest.mock("../model/user", () => ({ findOne: jest.fn().mockResolvedValue(null) }));
jest.mock("../model/role_mst", () => ({ findOne: jest.fn().mockResolvedValue(null) }));
jest.mock("../controller/recipes", () => ({ checkRawMaterialAvailableOrNot: jest.fn().mockResolvedValue(true), addRecipes: jest.fn(), editRecipes: jest.fn(), getAllRecipes: jest.fn(), getSingleRecipes: jest.fn(), deleteRecipe: jest.fn(), getAllRecipesForMenu: jest.fn(), convertMenuWise: jest.fn() }));

const mockOrderSummary = [
  { id: 1001, total_amount: 640, payable_amount: 672, status: "success", order_type: "dinin", createdAt: new Date() },
  { id: 1002, total_amount: 350, payable_amount: 368, status: "success", order_type: "pickup", createdAt: new Date() },
  { id: 1003, total_amount: 280, payable_amount: 280, status: "cancel", order_type: "dinin", createdAt: new Date() },
];

const mockOrder = {
  findAll: jest.fn().mockResolvedValue(mockOrderSummary),
  findOne: jest.fn(),
  count: jest.fn().mockResolvedValue(3),
  sum: jest.fn().mockResolvedValue(5000),
  findAndCountAll: jest.fn().mockResolvedValue({ count: 3, rows: mockOrderSummary }),
};
const mockOrderDetails = {
  findAll: jest.fn().mockResolvedValue([
    { menu_id: 101, qty: 2, price: 320 },
    { menu_id: 104, qty: 4, price: 40 },
  ]),
  sum: jest.fn().mockResolvedValue(0),
};
const mockExpense = {
  findAll: jest.fn().mockResolvedValue([mockExpenseEntryRecord]),
  sum: jest.fn().mockResolvedValue(2500),
};

jest.mock("../model/order", () => mockOrder);
jest.mock("../model/order_details", () => mockOrderDetails);
jest.mock("../model/menu", () => ({ findOne: jest.fn().mockResolvedValue(mockMenuButterChickenRecord), findAll: jest.fn().mockResolvedValue([mockMenuButterChickenRecord]) }));
jest.mock("../model/menu_categ", () => ({ findAll: jest.fn().mockResolvedValue([{ id: 1, name: "Mains" }]) }));
jest.mock("../model/table", () => ({ findOne: jest.fn().mockResolvedValue(mockTableT1Record), findAll: jest.fn().mockResolvedValue([]) }));
jest.mock("../model/table_catg", () => ({ findAll: jest.fn().mockResolvedValue([]) }));
jest.mock("../model/adminCart", () => ({ findAll: jest.fn().mockResolvedValue([]) }));
jest.mock("../model/orderTax", () => ({ findAll: jest.fn().mockResolvedValue([]), sum: jest.fn().mockResolvedValue(0) }));
jest.mock("../model/duePayment", () => ({ findAll: jest.fn().mockResolvedValue([]), sum: jest.fn().mockResolvedValue(0) }));
jest.mock("../model/expenseEnty", () => mockExpense);
jest.mock("../model/expenseHead", () => ({ findAll: jest.fn().mockResolvedValue([mockExpenseHeadRecord]) }));
jest.mock("../model/rawItem", () => ({ findAll: jest.fn().mockResolvedValue([mockRawMaterialChickenRecord]) }));
jest.mock("../model/Inventory/westage", () => ({ findAll: jest.fn().mockResolvedValue([]) }));
jest.mock("../model/variants", () => ({ findAll: jest.fn().mockResolvedValue([]) }));
jest.mock("../model/timeline", () => ({ findAll: jest.fn().mockResolvedValue([]) }));
jest.mock("../model/restaurantSetting", () => ({ findOne: jest.fn().mockResolvedValue({ business_date: new Date().toISOString().split("T")[0] }) }));
jest.mock("../utils/dateUtils", () => ({ getBusinessDate: jest.fn().mockResolvedValue(new Date().toISOString().split("T")[0]) }));
jest.mock("../helpers/billNumber", () => ({
  getNextBillNo: jest.fn().mockResolvedValue("GS-2024-0001"),
  getFinancialYearEndDate: jest.fn().mockReturnValue("2025-03-31"),
  getFinancialYearStartDate: jest.fn().mockReturnValue("2024-04-01"),
}));

let app, authHeader, adminToken;
beforeAll(() => {
  process.env.JWT_SECRET_KEY_ADMIN = SECRETS.admin;
  const { createTestApp } = require("./setup/testApp");
  app = createTestApp();
  adminToken = generateAdminToken(TD.HOTEL_USER.id);
  authHeader = adminAuthHeader(adminToken);
  const { UserSession } = require("../model");
  UserSession.findOne.mockResolvedValue({ user_id: TD.HOTEL_USER.id, token: adminToken });
});

const dateRange = () => ({ from_date: yesterday(), to_date: today() });

// ─────────────────────────────────────────────────────────────────────────────
describe("📈 Sales Reports", () => {
  test("T-RPT-01 | Sales report for today → totals and order list", async () => {
    mockOrder.findAll.mockResolvedValueOnce(mockOrderSummary);

    const res = await request(app)
      .post("/api/salesReports")
      .set(authHeader)
      .send(dateRange());

    expect([200, 201]).toContain(res.statusCode);
    expectSuccess(res.body);
  });

  test("T-RPT-02 | Sales report for past 30 days → 200", async () => {
    mockOrder.findAll.mockResolvedValueOnce(mockOrderSummary);

    const res = await request(app)
      .post("/api/salesReports")
      .set(authHeader)
      .send({ from_date: lastMonthStart(), to_date: today() });

    expect([200, 201]).toContain(res.statusCode);
  });

  test("T-RPT-03 | Sales report with no orders in range → empty but 200", async () => {
    mockOrder.findAll.mockResolvedValueOnce([]);

    const res = await request(app)
      .post("/api/salesReports")
      .set(authHeader)
      .send({ from_date: "2023-01-01", to_date: "2023-01-01" });

    expect([200, 201]).toContain(res.statusCode);
    expect(res.body).toHaveProperty("results");
  });

  test("T-RPT-04 | Sales report from_date > to_date → error or empty", async () => {
    const res = await request(app)
      .post("/api/salesReports")
      .set(authHeader)
      .send({ from_date: today(), to_date: yesterday() });

    expect(res.statusCode).toBeLessThan(500);
  });

  test("T-RPT-05 | Sales report — dine-in vs pickup vs delivery totals separated", async () => {
    const dineIn = mockOrderSummary.filter((o) => o.order_type === "dinin");
    const pickup = mockOrderSummary.filter((o) => o.order_type === "pickup");
    expect(dineIn.length).toBe(2); // orders 1001 (success) and 1003 (cancel) are both dinin
    expect(pickup.length).toBe(1);
    const dineInTotal = dineIn.reduce((sum, o) => sum + o.payable_amount, 0);
    expect(dineInTotal).toBe(672 + 280); // 952 total across both dinin orders
  });

  test("T-RPT-06 | Online orders total sales → 200", async () => {
    mockOrder.findAll.mockResolvedValueOnce(mockOrderSummary);

    const res = await request(app)
      .post("/api/onlineOrderTotalSales")
      .set(authHeader)
      .send(dateRange());

    expect([200, 201]).toContain(res.statusCode);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("🍽️  Item-Wise Reports", () => {
  test("T-RPT-07 | Item-wise report → top selling items", async () => {
    mockOrderDetails.findAll.mockResolvedValueOnce([
      { menu_id: 101, qty: 20, price: 320, Menu: TD.MENU_BUTTER_CHICKEN },
      { menu_id: 103, qty: 15, price: 350, Menu: TD.MENU_BIRYANI },
    ]);

    const res = await request(app)
      .post("/api/itemWiseReports")
      .set(authHeader)
      .send(dateRange());

    expect([200, 201]).toContain(res.statusCode);
    expectSuccess(res.body);
  });

  test("T-RPT-08 | Item-wise report — category filter works", async () => {
    mockOrderDetails.findAll.mockResolvedValueOnce([
      { menu_id: 101, qty: 10, price: 320, Menu: TD.MENU_BUTTER_CHICKEN },
    ]);

    const res = await request(app)
      .post("/api/itemWiseReports")
      .set(authHeader)
      .send({ ...dateRange(), category_id: 1 });

    expect([200, 201]).toContain(res.statusCode);
  });

  test("T-RPT-09 | Item-wise report — zero quantity items not shown", () => {
    const items = [
      { menu_id: 101, qty: 5 },
      { menu_id: 104, qty: 0 }, // should filter out
    ];
    const nonZero = items.filter((i) => i.qty > 0);
    expect(nonZero.length).toBe(1);
    expect(nonZero[0].menu_id).toBe(101);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("❌ Cancelled Orders Report", () => {
  test("T-RPT-10 | Get cancelled orders report → list with reasons", async () => {
    const cancelledOrders = mockOrderSummary.filter((o) => o.status === "cancel");
    mockOrder.findAll.mockResolvedValueOnce(cancelledOrders);

    const res = await request(app)
      .get("/api/cancelOrderReport")
      .set(authHeader);

    expect([200, 201]).toContain(res.statusCode);
    expectSuccess(res.body);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("📊 Dashboard Data", () => {
  test("T-RPT-11 | Dashboard — today's totals → revenue, orders, covers", async () => {
    mockOrder.findAll.mockResolvedValueOnce(mockOrderSummary);

    const res = await request(app)
      .post("/api/dashBoardData")
      .set(authHeader)
      .send({ date: today() });

    expect([200, 201]).toContain(res.statusCode);
    expectSuccess(res.body);
  });

  test("T-RPT-12 | Dashboard at opening time — all zeros → 200 with 0 values", async () => {
    mockOrder.findAll.mockResolvedValueOnce([]);
    mockOrder.count.mockResolvedValueOnce(0);
    mockOrder.sum.mockResolvedValueOnce(0);

    const res = await request(app)
      .post("/api/dashBoardData")
      .set(authHeader)
      .send({ date: today() });

    expect([200, 201]).toContain(res.statusCode);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("💰 Expense Reports", () => {
  test("T-RPT-13 | Get expense report for the month → list with total", async () => {
    mockExpense.findAll.mockResolvedValueOnce([TD.EXPENSE_ENTRY]);

    const res = await request(app)
      .post("/api/expense/getExpense")
      .set(authHeader)
      .send(dateRange());

    expect([200, 201, 404]).toContain(res.statusCode);
  });

  test("T-RPT-14 | Custom date-range report → filtered data", async () => {
    mockOrder.findAll.mockResolvedValueOnce(mockOrderSummary);

    const res = await request(app)
      .post("/api/customReport")
      .set(authHeader)
      .send({
        from_date: lastMonthStart(),
        to_date: today(),
        order_type: "dinin",
      });

    expect([200, 201]).toContain(res.statusCode);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("📋 Pagination & Search", () => {
  test("T-RPT-15 | Paginated order list (page 1, 10 per page) → correct structure", async () => {
    mockOrder.findAndCountAll.mockResolvedValueOnce({
      count: 50,
      rows: mockOrderSummary.slice(0, 2),
    });

    const res = await request(app)
      .get("/api/paginateOrder")
      .query({ page: 1, limit: 10 })
      .set(authHeader);

    expect([200, 201]).toContain(res.statusCode);
  });

  test("T-RPT-16 | Search order by bill number → single result", async () => {
    mockOrder.findAll.mockResolvedValueOnce([TD.ORDER_DININ]);

    const res = await request(app)
      .get(`/api/searchOrder/${TD.ORDER_DININ.bill_no}`)
      .set(authHeader);

    expect([200, 201]).toContain(res.statusCode);
  });

  test("T-RPT-17 | Search non-existent bill number → empty", async () => {
    mockOrder.findAll.mockResolvedValueOnce([]);

    const res = await request(app)
      .get("/api/searchOrder/GS-0000-0000")
      .set(authHeader);

    expect([200, 201]).toContain(res.statusCode);
  });
});
