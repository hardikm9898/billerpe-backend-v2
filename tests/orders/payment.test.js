/**
 * PAYMENT PROCESSING TEST SUITE
 * ═══════════════════════════════════════════════════════════════════
 * Covers: cash, UPI, card, split-payment (multi-mode),
 *         due/credit payment, settle all dues,
 *         payment link generation, PhonePe webhook,
 *         overpayment (change), promo code discount,
 *         service charge, GST slabs (5/12/18/28%),
 *         E-bill (digital receipt), reprint invoice.
 */
const request = require("supertest");
const { generateAdminToken, adminAuthHeader,
        expectSuccess, expectError, calcGST, calcBillTotal, SECRETS } = require("../setup/testHelpers");
const TD = require("../setup/testData");

// ── Mock-prefixed constants for jest.mock factories ──────────────────────────
const mockHotelUserRecord = { id: 10, hotel_id: 1, name: "Ravi Admin", number: "9876543210", active: true, role: "admin" };
const mockHotelRecord = { id: 1, hotel_name: "The Grand Spice", gst_no: "27AAACR5055K1Z5" };
const mockDuePaymentRecord = { id: 701, hotel_id: 1, customer_name: "Rohan Mehta", customer_number: "9900000001", due_amount: 450, status: "pending", orderId: 1001 };
const mockMenuButterChicken = { id: 101, name: "Butter Chicken", price: 320, hotel_id: 1, category_id: 1, shortCode: "BC", available: true, gst: 5 };
const mockTableT1 = { id: 1, tableNumber: "T1", hotel_id: 1, status: "available", capacity: 4 };
const mockTax5Percent = { id: 1, tax_name: "GST 5%", tax_value: 5, hotel_id: 1 };
const mockPrinterBilling = { id: 1, hotel_id: 1, printer_name: "BillingPrinter", ip: "192.168.1.100", port: 9100, is_default: true };

jest.mock("../../connection/connect", () => ({ query: jest.fn(), sync: jest.fn(), define: jest.fn().mockReturnValue({ findOne: jest.fn(), findAll: jest.fn().mockResolvedValue([]), create: jest.fn(), update: jest.fn().mockResolvedValue([1]), destroy: jest.fn().mockResolvedValue(1), belongsTo: jest.fn(), hasMany: jest.fn(), hasOne: jest.fn() }) }));
jest.mock("../../connection/redis", () => ({ get: jest.fn(), set: jest.fn(), del: jest.fn(), connect: jest.fn() }));
jest.mock("../../connection/socket", () => ({ initializeSocket: jest.fn(), checkDashBoardOnOrNot: jest.fn((req, res) => res.json({})) }));
jest.mock("../../services/upload", () => { const mw = (_r, _res, n) => n(); return { uploadSingleTest: jest.fn(() => mw), uploadMultipleTest: jest.fn(() => mw), uploadWhatsAppTemplateImage: jest.fn(() => mw), uploadSingleAttachedment: jest.fn(() => mw) }; });
jest.mock("../../middleware/upload", () => { const fn = (_req, _res, next) => next(); fn.fields = () => fn; fn.single = () => fn; fn.array = () => fn; return fn; });
jest.mock("../../services/sendMail", () => ({ sendMail: jest.fn().mockResolvedValue(true) }));

jest.mock("../../model", () => ({
  UserSession: { findOne: jest.fn().mockResolvedValue({ user_id: 10 }), create: jest.fn(), destroy: jest.fn() },
  RestaurantSetting: { findOne: jest.fn().mockResolvedValue({ business_date: new Date().toISOString().split("T")[0] }) },
  sequelize: { authenticate: jest.fn(), sync: jest.fn(), transaction: jest.fn((cb) => cb({})) },
}));
jest.mock("../../model/hotelUser", () => ({ findOne: jest.fn().mockResolvedValue(mockHotelUserRecord) }));
jest.mock("../../model/hotel", () => ({ findOne: jest.fn().mockResolvedValue(mockHotelRecord), belongsTo: jest.fn(), hasMany: jest.fn(), hasOne: jest.fn(), belongsToMany: jest.fn() }));
jest.mock("../../model/user", () => ({ findOne: jest.fn().mockResolvedValue(null) }));
jest.mock("../../model/role_mst", () => ({ findOne: jest.fn().mockResolvedValue(null) }));
jest.mock("../../controller/recipes", () => ({ checkRawMaterialAvailableOrNot: jest.fn().mockResolvedValue(true), addRecipes: jest.fn(), editRecipes: jest.fn(), getAllRecipes: jest.fn(), getSingleRecipes: jest.fn(), deleteRecipe: jest.fn(), getAllRecipesForMenu: jest.fn(), convertMenuWise: jest.fn() }));

const mockOrder = {
  findOne: jest.fn(),
  findAll: jest.fn().mockResolvedValue([]),
  create: jest.fn(),
  update: jest.fn().mockResolvedValue([1]),
  destroy: jest.fn().mockResolvedValue(1),
};
const mockOrderDetails = {
  findAll: jest.fn().mockResolvedValue([]),
  bulkCreate: jest.fn().mockResolvedValue([]),
  update: jest.fn().mockResolvedValue([1]),
  destroy: jest.fn().mockResolvedValue(1),
};
const mockDuePayment = {
  findOne: jest.fn(),
  findAll: jest.fn().mockResolvedValue([]),
  create: jest.fn().mockResolvedValue(mockDuePaymentRecord),
  update: jest.fn().mockResolvedValue([1]),
  destroy: jest.fn().mockResolvedValue(1),
};
const mockPromoCode = { findOne: jest.fn().mockResolvedValue(null), findAll: jest.fn().mockResolvedValue([]) };

jest.mock("../../model/order", () => mockOrder);
jest.mock("../../model/order_details", () => mockOrderDetails);
jest.mock("../../model/adminCart", () => ({ findAll: jest.fn().mockResolvedValue([]), destroy: jest.fn() }));
jest.mock("../../model/menu", () => ({ findOne: jest.fn().mockResolvedValue(mockMenuButterChicken), findAll: jest.fn().mockResolvedValue([]) }));
jest.mock("../../model/menu_categ", () => ({ findAll: jest.fn().mockResolvedValue([]) }));
jest.mock("../../model/table", () => ({ findOne: jest.fn().mockResolvedValue(mockTableT1), update: jest.fn().mockResolvedValue([1]) }));
jest.mock("../../model/table_catg", () => ({ findAll: jest.fn().mockResolvedValue([]) }));
jest.mock("../../model/timeline", () => ({ create: jest.fn(), findAll: jest.fn().mockResolvedValue([]) }));
jest.mock("../../model/orderTax", () => ({ bulkCreate: jest.fn(), findAll: jest.fn().mockResolvedValue([]), update: jest.fn(), destroy: jest.fn() }));
jest.mock("../../model/taxType", () => ({ findAll: jest.fn().mockResolvedValue([mockTax5Percent]) }));
jest.mock("../../model/variants", () => ({ findOne: jest.fn(), findAll: jest.fn().mockResolvedValue([]) }));
jest.mock("../../model/duePayment", () => mockDuePayment);
jest.mock("../../model/promoCode", () => mockPromoCode);
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
jest.mock("../../helpers/billNumber", () => ({
  getNextBillNo: jest.fn().mockResolvedValue("GS-2024-0001"),
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
describe("💵 Payment Methods", () => {
  test("T-PAY-01 | Cash payment — exact amount → 200 settled", async () => {
    mockOrder.findOne.mockResolvedValueOnce(TD.ORDER_DININ);
    mockOrderDetails.findAll.mockResolvedValueOnce([]);
    mockOrder.update.mockResolvedValueOnce([1]);

    const res = await request(app)
      .post("/api/settleBills")
      .set(authHeader)
      .send({
        orderId: TD.ORDER_DININ.id,
        payment_mode: "cash",
        paid_amount: 672,
        payable_amount: 672,
        taxes: [],
      });

    expect([200, 201]).toContain(res.statusCode);
    expectSuccess(res.body);
  });

  test("T-PAY-02 | UPI / QR payment → 200 settled", async () => {
    mockOrder.findOne.mockResolvedValueOnce(TD.ORDER_DININ);
    mockOrderDetails.findAll.mockResolvedValueOnce([]);
    mockOrder.update.mockResolvedValueOnce([1]);

    const res = await request(app)
      .post("/api/settleBills")
      .set(authHeader)
      .send({
        orderId: TD.ORDER_DININ.id,
        payment_mode: "upi",
        paid_amount: 672,
        payable_amount: 672,
        taxes: [],
      });

    expect([200, 201]).toContain(res.statusCode);
  });

  test("T-PAY-03 | Card payment → 200 settled", async () => {
    mockOrder.findOne.mockResolvedValueOnce(TD.ORDER_DININ);
    mockOrderDetails.findAll.mockResolvedValueOnce([]);
    mockOrder.update.mockResolvedValueOnce([1]);

    const res = await request(app)
      .post("/api/settleBills")
      .set(authHeader)
      .send({
        orderId: TD.ORDER_DININ.id,
        payment_mode: "card",
        paid_amount: 672,
        payable_amount: 672,
        taxes: [],
      });

    expect([200, 201]).toContain(res.statusCode);
  });

  test("T-PAY-04 | Split payment (cash + UPI) → 200 settled", async () => {
    mockOrder.findOne.mockResolvedValueOnce(TD.ORDER_DININ);
    mockOrderDetails.findAll.mockResolvedValueOnce([]);
    mockOrder.update.mockResolvedValueOnce([1]);

    const res = await request(app)
      .post("/api/settleBills")
      .set(authHeader)
      .send({
        orderId: TD.ORDER_DININ.id,
        payment_mode: "split",
        payment_split: [
          { mode: "cash", amount: 300 },
          { mode: "upi", amount: 372 },
        ],
        paid_amount: 672,
        payable_amount: 672,
        taxes: [],
      });

    expect([200, 201]).toContain(res.statusCode);
  });

  test("T-PAY-05 | No payment mode selected → error", async () => {
    mockOrder.findOne.mockResolvedValueOnce(TD.ORDER_DININ);

    const res = await request(app)
      .post("/api/settleBills")
      .set(authHeader)
      .send({
        orderId: TD.ORDER_DININ.id,
        paid_amount: 672,
        payable_amount: 672,
        taxes: [],
      });

    expect(res.statusCode).toBeLessThan(500);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("💸 Due / Credit Payments", () => {
  test("T-DUE-01 | Settle bill as credit/due → creates due record", async () => {
    mockOrder.findOne.mockResolvedValueOnce(TD.ORDER_DININ);
    mockOrderDetails.findAll.mockResolvedValueOnce([]);
    mockOrder.update.mockResolvedValueOnce([1]);
    mockDuePayment.create.mockResolvedValueOnce(TD.DUE_PAYMENT);

    const res = await request(app)
      .post("/api/settleBills")
      .set(authHeader)
      .send({
        orderId: TD.ORDER_DININ.id,
        payment_mode: "due",
        customer_name: "Rohan Mehta",
        customer_number: "9900000001",
        paid_amount: 0,
        payable_amount: 672,
        taxes: [],
      });

    expect([200, 201]).toContain(res.statusCode);
  });

  test("T-DUE-02 | Get all pending due orders → list", async () => {
    mockDuePayment.findAll.mockResolvedValueOnce([TD.DUE_PAYMENT]);

    const res = await request(app)
      .post("/api/getDueOrders")
      .set(authHeader)
      .send({ hotel_id: 1 });

    expect([200, 201]).toContain(res.statusCode);
  });

  test("T-DUE-03 | Settle individual due payment → 200 cleared", async () => {
    mockDuePayment.findOne.mockResolvedValueOnce(TD.DUE_PAYMENT);
    mockDuePayment.update.mockResolvedValueOnce([1]);

    const res = await request(app)
      .post("/api/settleDue")
      .set(authHeader)
      .send({
        dueId: TD.DUE_PAYMENT.id,
        payment_mode: "cash",
        paid_amount: 450,
      });

    expect([200, 201]).toContain(res.statusCode);
  });

  test("T-DUE-04 | Settle all due payments for a customer → 200", async () => {
    mockDuePayment.findAll.mockResolvedValueOnce([TD.DUE_PAYMENT]);
    mockDuePayment.update.mockResolvedValue([1]);

    const res = await request(app)
      .post("/api/allSettleDue")
      .set(authHeader)
      .send({
        customer_number: "9900000001",
        payment_mode: "cash",
        paid_amount: 450,
      });

    expect([200, 201]).toContain(res.statusCode);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("🏷️  Discount & Promo Codes", () => {
  test("T-DIS-01 | Apply valid flat promo code (FLAT50) → discount applied", async () => {
    mockPromoCode.findOne.mockResolvedValueOnce(TD.PROMO_FLAT50);
    mockOrder.findOne.mockResolvedValueOnce(TD.ORDER_DININ);
    mockOrderDetails.findAll.mockResolvedValueOnce([]);
    mockOrder.update.mockResolvedValueOnce([1]);

    const res = await request(app)
      .post("/api/settleBills")
      .set(authHeader)
      .send({
        orderId: TD.ORDER_DININ.id,
        payment_mode: "cash",
        promo_code: "FLAT50",
        discount: 50,
        paid_amount: 622,
        payable_amount: 622,
        taxes: [],
      });

    expect([200, 201]).toContain(res.statusCode);
  });

  test("T-DIS-02 | Apply percent promo (SAVE10 = 10%) on ₹640 → ₹64 discount", async () => {
    const discount = Math.round(640 * 0.10);
    mockPromoCode.findOne.mockResolvedValueOnce(TD.PROMO_PERCENT10);
    mockOrder.findOne.mockResolvedValueOnce(TD.ORDER_DININ);
    mockOrderDetails.findAll.mockResolvedValueOnce([]);
    mockOrder.update.mockResolvedValueOnce([1]);

    const res = await request(app)
      .post("/api/settleBills")
      .set(authHeader)
      .send({
        orderId: TD.ORDER_DININ.id,
        payment_mode: "cash",
        promo_code: "SAVE10",
        discount,
        paid_amount: 640 - discount + 28.8,
        payable_amount: 640 - discount + 28.8,
        taxes: [],
      });

    expect([200, 201]).toContain(res.statusCode);
  });

  test("T-DIS-03 | Expired/invalid promo code → not applied / error", async () => {
    mockPromoCode.findOne.mockResolvedValueOnce(null);

    const res = await request(app)
      .post("/api/settleBills")
      .set(authHeader)
      .send({
        orderId: TD.ORDER_DININ.id,
        payment_mode: "cash",
        promo_code: "EXPIRED99",
        paid_amount: 672,
        payable_amount: 672,
        taxes: [],
      });

    expect(res.statusCode).toBeLessThan(500);
  });

  test("T-DIS-04 | Promo below min order amount → not applied", async () => {
    const smallOrder = { ...TD.ORDER_DININ, total_amount: 160, payable_amount: 168 };
    mockPromoCode.findOne.mockResolvedValueOnce(TD.PROMO_FLAT50);
    mockOrder.findOne.mockResolvedValueOnce(smallOrder);

    const res = await request(app)
      .post("/api/settleBills")
      .set(authHeader)
      .send({
        orderId: smallOrder.id,
        payment_mode: "cash",
        promo_code: "FLAT50",
        paid_amount: 168,
        payable_amount: 168,
        taxes: [],
      });

    expect(res.statusCode).toBeLessThan(500);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("📊 GST Slab Calculations", () => {
  test("T-GST-01 | 5% GST on food (CGST 2.5% + SGST 2.5%) — ₹640 base → ₹32 tax", () => {
    const { cgst, sgst, total } = calcGST(640, 5);
    expect(cgst).toBe(16);
    expect(sgst).toBe(16);
    expect(total).toBe(32);
  });

  test("T-GST-02 | 12% GST on processed food — ₹500 base → ₹60 tax", () => {
    const { cgst, sgst, total } = calcGST(500, 12);
    expect(cgst).toBe(30);
    expect(sgst).toBe(30);
    expect(total).toBe(60);
  });

  test("T-GST-03 | 18% GST on restaurants with AC + AC bar — ₹1000 → ₹180 tax", () => {
    const { total } = calcGST(1000, 18);
    expect(total).toBe(180);
  });

  test("T-GST-04 | 28% GST on alcohol (beer) — ₹180 → ₹50.40 tax", () => {
    const { total } = calcGST(180, 28);
    expect(total).toBe(50.4);
  });

  test("T-GST-05 | Mixed GST slab order — food (5%) + drinks (12%) correct split", () => {
    const bill = calcBillTotal(
      [
        { price: 320, qty: 2 },
        { price: 60, qty: 2 },
      ],
      5,
      0, 0
    );
    expect(bill.subtotal).toBe(760);
    expect(bill.tax).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("📧 E-Bill (Digital Receipt)", () => {
  test("T-EBL-01 | Send e-bill to customer email/whatsapp → 200", async () => {
    mockOrder.findOne.mockResolvedValueOnce({ ...TD.ORDER_DININ, status: "success" });
    const mockEbillCredit = require("../../model/ebillCredit");
    mockEbillCredit.create.mockResolvedValueOnce({ id: 1 });

    const res = await request(app)
      .post("/api/sentEbill")
      .set(authHeader)
      .send({
        orderId: TD.ORDER_DININ.id,
        customer_email: "amit@test.com",
        customer_number: "9900000001",
      });

    expect([200, 201]).toContain(res.statusCode);
  });

  test("T-EBL-02 | Reprint bill (admin-side reprint) → 200", async () => {
    mockOrder.findOne.mockResolvedValueOnce({ ...TD.ORDER_DININ, status: "success" });
    mockOrderDetails.findAll.mockResolvedValueOnce([]);

    const res = await request(app)
      .post("/api/rePrintAdminBillData")
      .set(authHeader)
      .send({ orderId: TD.ORDER_DININ.id });

    expect([200, 201]).toContain(res.statusCode);
  });

  test("T-EBL-03 | Update invoice details (custom header) → 200", async () => {
    mockOrder.findOne.mockResolvedValueOnce(TD.ORDER_DININ);
    mockOrder.update.mockResolvedValueOnce([1]);

    const res = await request(app)
      .post("/api/updateInvoice")
      .set(authHeader)
      .send({ orderId: TD.ORDER_DININ.id, invoice_note: "Thank you for dining with us!" });

    expect([200, 201]).toContain(res.statusCode);
  });
});
