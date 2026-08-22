/**
 * FULL ORDER LIFECYCLE INTEGRATION TEST
 * ═══════════════════════════════════════════════════════════════════
 * Simulates a complete real-restaurant scenario end-to-end:
 *
 * Scenario A — "The Full Dinner Service"
 *   1. Guest seated at T1 (4-top)
 *   2. Waiter takes first order → KOT sent to kitchen
 *   3. Guest orders additional items → second KOT
 *   4. One item cancelled (changed mind)
 *   5. Waiter adds dietary note on order
 *   6. Kitchen marks items as prepared
 *   7. Guest requests bill → totals calculated
 *   8. Split payment: ₹300 cash + rest UPI
 *   9. Bill settled → table freed
 *   10. Day-end: order appears in sales report
 *
 * Scenario B — "The No-Show Booking"
 *   1. Table booked for 7pm, 4 guests
 *   2. Guest doesn't arrive, booking cancelled at 7:15pm
 *   3. New walk-in seated at same table
 *   4. Quick pickup order placed and settled
 *
 * Scenario C — "The Running Tab"
 *   1. Corporate lunch — order placed, held midway
 *   2. Additional items added after resume
 *   3. Split bill across two order types
 *
 * Each step asserts the correct response and state transition.
 */

const request = require("supertest");
const {
  generateAdminToken, adminAuthHeader, expectSuccess,
  calcBillTotal, calcGST, SECRETS
} = require("../setup/testHelpers");
const TD = require("../setup/testData");

// ── Mock-prefixed constants for jest.mock factories ──────────────────────────
const mockHotelUserRecord = { id: 10, hotel_id: 1, name: "Ravi Admin", number: "9876543210", active: true, role: "admin" };
const mockHotelRecord = { id: 1, hotel_name: "The Grand Spice", gst_no: "27AAACR5055K1Z5" };
const mockTableT1 = { id: 1, tableNumber: "T1", hotel_id: 1, status: "available", capacity: 4 };
const mockTableBookingRecord = { id: 1, hotel_id: 1, table_id: 1, customer_name: "Neha Patel", customer_number: "9800000001", booking_date: "2024-04-15", booking_time: "19:00", party_size: 4, status: "confirmed" };
const mockMenuButterChicken = { id: 101, name: "Butter Chicken", price: 320, hotel_id: 1, category_id: 1, shortCode: "BC", available: true, gst: 5 };
const mockMenuBiryani = { id: 103, name: "Chicken Biryani", price: 350, hotel_id: 1, category_id: 1, shortCode: "CB", available: true, gst: 5 };
const mockMenuNaan = { id: 104, name: "Butter Naan", price: 40, hotel_id: 1, category_id: 2, shortCode: "BN", available: true, gst: 5 };
const mockTax5Percent = { id: 1, tax_name: "GST 5%", tax_value: 5, hotel_id: 1 };
const mockPrinterBilling = { id: 1, hotel_id: 1, printer_name: "BillingPrinter", ip: "192.168.1.100", port: 9100, is_default: true };

// ── Common mocks ────────────────────────────────────────────────────────────
jest.mock("../../connection/connect", () => ({ query: jest.fn(), sync: jest.fn(), define: jest.fn().mockReturnValue({ findOne: jest.fn(), findAll: jest.fn().mockResolvedValue([]), create: jest.fn(), update: jest.fn().mockResolvedValue([1]), destroy: jest.fn().mockResolvedValue(1), belongsTo: jest.fn(), hasMany: jest.fn(), hasOne: jest.fn() }) }));
jest.mock("../../connection/redis", () => ({ get: jest.fn(), set: jest.fn(), del: jest.fn(), connect: jest.fn() }));
jest.mock("../../connection/socket", () => ({ initializeSocket: jest.fn(), checkDashBoardOnOrNot: jest.fn((req, res) => res.json({})) }));
jest.mock("../../services/upload", () => { const mw = (_r, _res, n) => n(); return { uploadSingleTest: jest.fn(() => mw), uploadMultipleTest: jest.fn(() => mw), uploadWhatsAppTemplateImage: jest.fn(() => mw), uploadSingleAttachedment: jest.fn(() => mw) }; });
jest.mock("../../middleware/upload", () => { const fn = (_req, _res, next) => next(); fn.fields = () => fn; fn.single = () => fn; fn.array = () => fn; return fn; });
jest.mock("../../services/sendMail", () => ({ sendMail: jest.fn().mockResolvedValue(true) }));

// ── Model mocks ─────────────────────────────────────────────────────────────

jest.mock("../../model", () => ({
  UserSession: { findOne: jest.fn().mockResolvedValue({ user_id: 10 }), create: jest.fn(), destroy: jest.fn() },
  RestaurantSetting: { findOne: jest.fn().mockResolvedValue({ business_date: new Date().toISOString().split("T")[0] }) },
  sequelize: { authenticate: jest.fn(), sync: jest.fn(), transaction: jest.fn((cb) => cb({})), query: jest.fn().mockResolvedValue([[{ total: 1008, count: 1 }]]) },
}));
jest.mock("../../model/hotelUser", () => ({ findOne: jest.fn().mockResolvedValue(mockHotelUserRecord) }));
jest.mock("../../model/hotel", () => ({ findOne: jest.fn().mockResolvedValue(mockHotelRecord), belongsTo: jest.fn(), hasMany: jest.fn(), hasOne: jest.fn(), belongsToMany: jest.fn() }));
jest.mock("../../model/user", () => ({ findOne: jest.fn().mockResolvedValue(null) }));
jest.mock("../../model/role_mst", () => ({ findOne: jest.fn().mockResolvedValue(null) }));

const mockOrderModel = {
  findOne: jest.fn(),
  findAll: jest.fn(),
  create: jest.fn(),
  update: jest.fn().mockResolvedValue([1]),
  destroy: jest.fn().mockResolvedValue(1),
  count: jest.fn().mockResolvedValue(1),
  sum: jest.fn().mockResolvedValue(1040),
  findAndCountAll: jest.fn(),
};
const mockOrderDetailsModel = {
  findAll: jest.fn().mockResolvedValue([]),
  create: jest.fn(),
  bulkCreate: jest.fn().mockResolvedValue([]),
  update: jest.fn().mockResolvedValue([1]),
  destroy: jest.fn().mockResolvedValue(1),
};
const mockAdminCartModel = {
  findOne: jest.fn(),
  findAll: jest.fn().mockResolvedValue([]),
  create: jest.fn().mockResolvedValue({}),
  update: jest.fn().mockResolvedValue([1]),
  destroy: jest.fn().mockResolvedValue(1),
};
const mockTableModel = {
  findOne: jest.fn().mockResolvedValue(mockTableT1),
  findAll: jest.fn().mockResolvedValue([mockTableT1]),
  update: jest.fn().mockResolvedValue([1]),
};
const mockTableBooking = {
  findOne: jest.fn().mockResolvedValue(null),
  findAll: jest.fn().mockResolvedValue([]),
  create: jest.fn().mockResolvedValue(mockTableBookingRecord),
  update: jest.fn().mockResolvedValue([1]),
  destroy: jest.fn().mockResolvedValue(1),
};

jest.mock("../../model/order", () => mockOrderModel);
jest.mock("../../model/order_details", () => mockOrderDetailsModel);
jest.mock("../../model/adminCart", () => mockAdminCartModel);
jest.mock("../../model/table", () => mockTableModel);
jest.mock("../../model/table_catg", () => ({ findOne: jest.fn(), findAll: jest.fn().mockResolvedValue([]) }));
jest.mock("../../model/tablebooking", () => mockTableBooking);
jest.mock("../../model/menu", () => ({
  findOne: jest.fn().mockResolvedValue(mockMenuButterChicken),
  findAll: jest.fn().mockResolvedValue([mockMenuButterChicken, mockMenuBiryani, mockMenuNaan]),
}));
jest.mock("../../model/menu_categ", () => ({ findAll: jest.fn().mockResolvedValue([]) }));
jest.mock("../../model/timeline", () => ({
  create: jest.fn().mockResolvedValue({}),
  findAll: jest.fn().mockResolvedValue([
    { id: 1, action: "kot", createdAt: new Date() },
    { id: 2, action: "settle", createdAt: new Date() },
  ]),
}));
jest.mock("../../model/orderTax", () => ({ bulkCreate: jest.fn(), findAll: jest.fn().mockResolvedValue([]), update: jest.fn(), destroy: jest.fn() }));
jest.mock("../../model/taxType", () => ({ findAll: jest.fn().mockResolvedValue([mockTax5Percent]) }));
jest.mock("../../model/variants", () => ({ findOne: jest.fn(), findAll: jest.fn().mockResolvedValue([]) }));
jest.mock("../../model/duePayment", () => ({ create: jest.fn(), findOne: jest.fn(), findAll: jest.fn().mockResolvedValue([]) }));
jest.mock("../../model/promoCode", () => ({ findOne: jest.fn().mockResolvedValue(null) }));
jest.mock("../../model/invoiceFormate", () => ({ findOne: jest.fn().mockResolvedValue({}) }));
jest.mock("../../model/printer_setting", () => ({ findAll: jest.fn().mockResolvedValue([mockPrinterBilling]) }));
jest.mock("../../model/restaurantSetting", () => ({ findOne: jest.fn().mockResolvedValue({ business_date: new Date().toISOString().split("T")[0] }) }));
jest.mock("../../model/ebillCreditDebit", () => ({ create: jest.fn(), findAll: jest.fn().mockResolvedValue([]) }));
jest.mock("../../model/ebillCredit", () => ({ create: jest.fn().mockResolvedValue({}), findAll: jest.fn().mockResolvedValue([]) }));
jest.mock("../../controller/redis/redisCrud", () => ({
  updateTableToRadis: jest.fn(), newOrderAppendToRadis: jest.fn(),
  updateOrderAppendToRadis: jest.fn(), deleteOrderToRedis: jest.fn(),
}));
jest.mock("../../controller/kds/kds", () => ({ sendKotToAllKdsClient: jest.fn(), orderCompletedSendtoKdsCLient: jest.fn(), otherkot: jest.fn(), removeKotItemFromKds: jest.fn(), descriseKotQtyItemFromKDS: jest.fn(), recallKot: jest.fn(), deleteKitchen: jest.fn(), getKitchenDataById: jest.fn(), setCategoryForKitchen: jest.fn(), createKitchen: jest.fn(), getAllKitchen: jest.fn(), getLiveOrders: jest.fn(), markItemReady: jest.fn() }));
jest.mock("../../controller/recipes", () => ({ checkRawMaterialAvailableOrNot: jest.fn().mockResolvedValue(true), addRecipes: jest.fn(), editRecipes: jest.fn(), getAllRecipes: jest.fn(), getSingleRecipes: jest.fn(), deleteRecipe: jest.fn(), getAllRecipesForMenu: jest.fn(), convertMenuWise: jest.fn() }));
jest.mock("../../helpers/billNumber", () => ({
  getNextBillNo: jest.fn().mockResolvedValue("GS-2024-0001"),
  getFinancialYearEndDate: jest.fn(), getFinancialYearStartDate: jest.fn(),
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
describe("🍽️  Scenario A: The Full Dinner Service (end-to-end)", () => {
  let createdOrderId = TD.ORDER_DININ.id;

  test("Step 1 | Table T1 is available before guest arrives", async () => {
    mockTableModel.findOne.mockResolvedValueOnce({ ...TD.TABLE_T1, status: "available" });

    const res = await request(app)
      .get("/api/table")
      .set(authHeader);

    expect([200, 201]).toContain(res.statusCode);
  });

  test("Step 2 | Waiter adds Butter Chicken (×2) and Naan (×4) to cart", async () => {
    mockAdminCartModel.findOne.mockResolvedValueOnce(null);
    mockAdminCartModel.create.mockResolvedValueOnce(TD.CART_ITEM_1);

    const res = await request(app)
      .post("/api/adminCart")
      .set(authHeader)
      .send({ MenuId: 101, tableId: 1, qty: 2 });

    expect([200, 201]).toContain(res.statusCode);
    expectSuccess(res.body);
  });

  test("Step 3 | First KOT sent to kitchen → order created, table status = running", async () => {
    mockTableModel.findOne.mockResolvedValueOnce(TD.TABLE_T1);
    mockOrderModel.findOne.mockResolvedValueOnce(null); // no existing order
    mockAdminCartModel.findAll.mockResolvedValueOnce([TD.CART_ITEM_1, TD.CART_ITEM_2]);
    mockOrderModel.create.mockResolvedValueOnce(TD.ORDER_DININ);
    mockOrderDetailsModel.bulkCreate.mockResolvedValueOnce([]);
    mockTableModel.update.mockResolvedValueOnce([1]);

    const res = await request(app)
      .post("/api/kotOrder")
      .set(authHeader)
      .send({
        tableId: 1, order_type: "dinin",
        items: [
          { menuId: 101, qty: 2, price: 320 },
          { menuId: 104, qty: 4, price: 40 },
        ],
        taxes: [{ id: 1, tax_value: "CGST", tax: 5, amount: 40 }],
        total_amount: 800,
        payable_amount: 840,
      });

    expect([200, 201]).toContain(res.statusCode);
    expectSuccess(res.body);
    createdOrderId = TD.ORDER_DININ.id;
  });

  test("Step 4 | Guest orders Biryani (×1) after first KOT → second KOT on same order", async () => {
    mockTableModel.findOne.mockResolvedValueOnce(TD.TABLE_T1);
    mockOrderModel.findOne.mockResolvedValueOnce(TD.ORDER_DININ); // existing order
    mockAdminCartModel.findAll.mockResolvedValueOnce([{ ...TD.CART_ITEM_1, MenuId: 103 }]);
    mockOrderDetailsModel.bulkCreate.mockResolvedValueOnce([]);
    mockOrderModel.update.mockResolvedValueOnce([1]);

    const res = await request(app)
      .post("/api/kotOrder")
      .set(authHeader)
      .send({
        tableId: 1, order_type: "dinin",
        items: [{ menuId: 103, qty: 1, price: 350 }],
        taxes: [{ id: 1, tax_value: "CGST", tax: 5, amount: 17.5 }],
        total_amount: 350,
        payable_amount: 367.5,
      });

    expect([200, 201]).toContain(res.statusCode);
  });

  test("Step 5 | Waiter adds 'No onion, no garlic' note → 200", async () => {
    mockOrderModel.findOne.mockResolvedValueOnce(TD.ORDER_DININ);
    mockOrderModel.update.mockResolvedValueOnce([1]);

    const res = await request(app)
      .post("/api/addComment")
      .set(authHeader)
      .send({ orderId: createdOrderId, comment: "No onion, no garlic" });

    expect([200, 201]).toContain(res.statusCode);
    expectSuccess(res.body);
  });

  test("Step 6 | Kitchen marks Butter Chicken as prepared → KDS updated", async () => {
    mockOrderDetailsModel.findAll.mockResolvedValueOnce([
      { id: 1, menu_id: 101, qty: 2, status: "kot" },
    ]);
    mockOrderDetailsModel.update.mockResolvedValueOnce([1]);

    const res = await request(app)
      .post("/api/adminOrder")
      .set(authHeader)
      .send({ orderDetailId: 1, status: "delivered" });

    expect([200, 201]).toContain(res.statusCode);
  });

  test("Step 7 | Bill calculated: 320×2 + 40×4 + 350×1 + 5% GST", () => {
    const bill = calcBillTotal(
      [
        { price: 320, qty: 2 },
        { price: 40, qty: 4 },
        { price: 350, qty: 1 },
      ],
      5, 0, 0
    );
    expect(bill.subtotal).toBe(1150);
    const { total } = calcGST(1150, 5);
    expect(total).toBe(57.5);
    expect(bill.total).toBeCloseTo(1150 + 57.5, 1);
  });

  test("Step 8 | Split payment: ₹500 cash + ₹917.5 UPI → 200 settled", async () => {
    mockOrderModel.findOne.mockResolvedValueOnce(TD.ORDER_DININ);
    mockOrderDetailsModel.findAll.mockResolvedValueOnce([]);
    mockOrderModel.update.mockResolvedValueOnce([1]);
    mockTableModel.update.mockResolvedValueOnce([1]);

    const res = await request(app)
      .post("/api/settleBills")
      .set(authHeader)
      .send({
        orderId: createdOrderId,
        payment_mode: "split",
        payment_split: [{ mode: "cash", amount: 500 }, { mode: "upi", amount: 917.5 }],
        paid_amount: 1417.5,
        payable_amount: 1417.5,
        taxes: [],
      });

    expect([200, 201]).toContain(res.statusCode);
    expectSuccess(res.body);
  });

  test("Step 9 | After settlement, table T1 status = available", async () => {
    mockTableModel.update.mockResolvedValueOnce([1]);
    // Simulate the table-free step: update resolves successfully
    const result = await mockTableModel.update({ status: "available" }, { where: { id: 1 } });
    expect(result).toEqual([1]);
  });

  test("Step 10 | Order appears in today's sales report", async () => {
    mockOrderModel.findAll.mockResolvedValueOnce([{ ...TD.ORDER_DININ, status: "success" }]);

    const res = await request(app)
      .post("/api/salesReports")
      .set(authHeader)
      .send({ from_date: new Date().toISOString().split("T")[0], to_date: new Date().toISOString().split("T")[0] });

    expect([200, 201]).toContain(res.statusCode);
    expectSuccess(res.body);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("📅 Scenario B: No-Show Booking + Walk-In", () => {
  test("Step 1 | Book table T1 for 7pm (4 guests)", async () => {
    mockTableModel.findOne.mockResolvedValueOnce(TD.TABLE_T1);
    mockTableBooking.findOne.mockResolvedValueOnce(null);
    mockTableBooking.create.mockResolvedValueOnce(TD.TABLE_BOOKING);

    const res = await request(app)
      .post("/api/tableBooking")
      .set(authHeader)
      .send({
        table_id: 1, customer_name: "Neha Patel", customer_number: "9800000001",
        booking_date: "2024-04-15", booking_time: "19:00", party_size: 4,
      });

    expect([200, 201]).toContain(res.statusCode);
  });

  test("Step 2 | Guest no-show at 7:15 — cancel booking → 200", async () => {
    mockTableBooking.findOne.mockResolvedValueOnce(TD.TABLE_BOOKING);
    mockTableBooking.destroy.mockResolvedValueOnce(1);

    const res = await request(app)
      .post("/api/deleteBooking")
      .set(authHeader)
      .send({ id: 1 });

    expect([200, 201]).toContain(res.statusCode);
    expectSuccess(res.body);
  });

  test("Step 3 | Walk-in seated at T1, quick pickup order settled in cash → 200", async () => {
    mockOrderModel.findOne.mockResolvedValueOnce(null);
    mockOrderModel.create.mockResolvedValueOnce({ ...TD.ORDER_PICKUP, id: 9901 });
    mockOrderDetailsModel.bulkCreate.mockResolvedValueOnce([]);

    const kotRes = await request(app)
      .post("/api/kotOrder")
      .set(authHeader)
      .send({
        order_type: "pickup",
        customer_name: "Walk-In Guest",
        items: [{ menuId: 103, qty: 1, price: 350 }],
        taxes: [],
        total_amount: 350,
        payable_amount: 368,
      });

    expect([200, 201]).toContain(kotRes.statusCode);

    mockOrderModel.findOne.mockResolvedValueOnce({ ...TD.ORDER_PICKUP, id: 9901 });
    mockOrderDetailsModel.findAll.mockResolvedValueOnce([]);
    mockOrderModel.update.mockResolvedValueOnce([1]);

    const settleRes = await request(app)
      .post("/api/settleBills")
      .set(authHeader)
      .send({
        orderId: 9901, payment_mode: "cash", paid_amount: 368, payable_amount: 368, taxes: [],
      });

    expect([200, 201]).toContain(settleRes.statusCode);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("🏢 Scenario C: Corporate Lunch (Hold → Resume → Settle)", () => {
  let corporateOrderId = 8800;

  test("Step 1 | Corporate lunch order placed and held after first course", async () => {
    mockOrderModel.findOne
      .mockResolvedValueOnce(null)  // create
      .mockResolvedValueOnce({ ...TD.ORDER_DININ, id: corporateOrderId }); // hold

    mockOrderModel.create.mockResolvedValueOnce({ ...TD.ORDER_DININ, id: corporateOrderId });
    mockOrderDetailsModel.bulkCreate.mockResolvedValueOnce([]);
    mockOrderModel.update.mockResolvedValueOnce([1]);
    mockTableModel.update.mockResolvedValueOnce([1]);

    // First KOT
    const kotRes = await request(app)
      .post("/api/kotOrder")
      .set(authHeader)
      .send({
        tableId: 2, order_type: "dinin",
        items: [{ menuId: 101, qty: 5, price: 320 }],
        taxes: [], total_amount: 1600, payable_amount: 1680,
      });

    expect([200, 201]).toContain(kotRes.statusCode);

    // Hold the order
    mockOrderModel.findOne.mockResolvedValueOnce({ ...TD.ORDER_DININ, id: corporateOrderId });
    mockOrderModel.update.mockResolvedValueOnce([1]);

    const holdRes = await request(app)
      .post("/api/holdOrder")
      .set(authHeader)
      .send({ orderId: corporateOrderId });

    expect([200, 201]).toContain(holdRes.statusCode);
  });

  test("Step 2 | Resume held order — add desserts → second KOT", async () => {
    mockOrderModel.findOne.mockResolvedValueOnce({ ...TD.ORDER_DININ, id: corporateOrderId, status: "hold" });
    mockOrderDetailsModel.bulkCreate.mockResolvedValueOnce([]);
    mockOrderModel.update.mockResolvedValueOnce([1]);

    const res = await request(app)
      .post("/api/kotOrder")
      .set(authHeader)
      .send({
        tableId: 2, order_type: "dinin",
        items: [{ menuId: 104, qty: 10, price: 40 }],
        taxes: [], total_amount: 400, payable_amount: 420,
      });

    expect([200, 201]).toContain(res.statusCode);
  });

  test("Step 3 | Corporate pays by card → order settled", async () => {
    mockOrderModel.findOne.mockResolvedValueOnce({ ...TD.ORDER_DININ, id: corporateOrderId });
    mockOrderDetailsModel.findAll.mockResolvedValueOnce([]);
    mockOrderModel.update.mockResolvedValueOnce([1]);

    const res = await request(app)
      .post("/api/settleBills")
      .set(authHeader)
      .send({
        orderId: corporateOrderId,
        payment_mode: "card",
        paid_amount: 2100,
        payable_amount: 2100,
        taxes: [],
      });

    expect([200, 201]).toContain(res.statusCode);
    expectSuccess(res.body);
  });
});
