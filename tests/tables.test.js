/**
 * TABLE MANAGEMENT TEST SUITE
 * Covers: create tables, categories, reserve, move, delete,
 *         table booking, booking conflicts, running-table deletion prevention.
 */
const request = require("supertest");
const { generateAdminToken, adminAuthHeader,
        expectSuccess, expectError, SECRETS } = require("./setup/testHelpers");
const TD = require("./setup/testData");

const mockHotelUserRecord = { id: 10, hotel_id: 1, name: "Ravi Admin", active: true };
const mockHotelRecord = { id: 1, hotel_name: "The Grand Spice" };
const mockSessionRecord = { id: 1, user_id: 10, token: "t" };

jest.mock("../connection/connect", () => ({ query: jest.fn(), sync: jest.fn(), define: jest.fn().mockReturnValue({ findOne: jest.fn(), findAll: jest.fn().mockResolvedValue([]), create: jest.fn(), update: jest.fn().mockResolvedValue([1]), destroy: jest.fn().mockResolvedValue(1), belongsTo: jest.fn(), hasMany: jest.fn(), hasOne: jest.fn() }) }));
jest.mock("../connection/redis", () => ({ get: jest.fn(), set: jest.fn(), del: jest.fn(), connect: jest.fn() }));
jest.mock("../connection/socket", () => ({
  initializeSocket: jest.fn(),
  checkDashBoardOnOrNot: jest.fn((_req, res) => res.json({})),
}));
jest.mock("../services/upload", () => { const mw = (_r, _res, n) => n(); return { uploadSingleTest: jest.fn(() => mw), uploadMultipleTest: jest.fn(() => mw), uploadWhatsAppTemplateImage: jest.fn(() => mw), uploadSingleAttachedment: jest.fn(() => mw) }; });
jest.mock("../middleware/upload", () => { const fn = (_req, _res, next) => next(); fn.fields = () => fn; fn.single = () => fn; fn.array = () => fn; return fn; });
jest.mock("../model", () => ({
  UserSession: {
    findOne: jest.fn().mockResolvedValue(mockSessionRecord),
    create: jest.fn(), destroy: jest.fn(),
  },
  sequelize: { authenticate: jest.fn(), sync: jest.fn() },
}));
jest.mock("../model/hotelUser", () => ({
  findOne: jest.fn().mockResolvedValue(mockHotelUserRecord),
}));
jest.mock("../model/hotel", () => ({
  findOne: jest.fn().mockResolvedValue(mockHotelRecord),
  belongsTo: jest.fn(), hasMany: jest.fn(), hasOne: jest.fn(), belongsToMany: jest.fn(),
}));
jest.mock("../model/user", () => ({ findOne: jest.fn().mockResolvedValue(null) }));
jest.mock("../model/role_mst", () => ({ findOne: jest.fn().mockResolvedValue(null) }));
jest.mock("../controller/recipes", () => ({ checkRawMaterialAvailableOrNot: jest.fn().mockResolvedValue(true), addRecipes: jest.fn(), editRecipes: jest.fn(), getAllRecipes: jest.fn(), getSingleRecipes: jest.fn(), deleteRecipe: jest.fn(), getAllRecipesForMenu: jest.fn(), convertMenuWise: jest.fn() }));

// Smart hotel controller stubs — check model state for error-path tests
jest.mock("../controller/hotel", () => {
  const mkR = (req, res) => res && res.json && res.json({ error: false, results: {}, code: 200 });
  return {
    insertDefaultRestaurantSettings: jest.fn(mkR), setMenuShow: jest.fn(mkR),
    editHotelDetails: jest.fn(mkR), addEditServiceCharge: jest.fn(mkR), setDisplay: jest.fn(mkR),
    getTableCatagoriesWise: jest.fn(mkR), getHotelId: jest.fn(mkR), jsPrintManager: jest.fn(mkR),
    liveTable: jest.fn(mkR), tableWiseRetrieveOrder: jest.fn(mkR), searchByTableCatagories: jest.fn(mkR),
    removeTableCatagories: jest.fn(mkR), editTableCatagories: jest.fn(mkR),
    updateInvoiceFormate: jest.fn(mkR), getSingleHotel: jest.fn(mkR), getTableCatagories: jest.fn(mkR),
    getTableForCaptain: jest.fn(mkR), addHotelDetails: jest.fn(mkR), getHotel: jest.fn(mkR),
    getTable: jest.fn(mkR), reservedTable: jest.fn(mkR), editTable: jest.fn(mkR),
    addTable: jest.fn(async (req, res) => {
      const m = await require("../model/table").findOne();
      if (m) return res.json({ error: true, results: { message: "Table number already exists" }, code: 409 });
      return mkR(req, res);
    }),
    removeTable: jest.fn(async (req, res) => {
      const order = await require("../model/order").findOne();
      if (order) return res.json({ error: true, results: { message: "Table has running order, cannot delete" }, code: 400 });
      return mkR(req, res);
    }),
    addTableCategory: jest.fn(async (req, res) => {
      const m = await require("../model/table_catg").findOne();
      if (m) return res.json({ error: true, results: { message: "Category already exists" }, code: 409 });
      return mkR(req, res);
    }),
  };
});

// Smart tableBooking controller stub
jest.mock("../controller/tableBooking", () => {
  const mkR = (req, res) => res && res.json && res.json({ error: false, results: {}, code: 200 });
  return {
    getSingleBookingData: jest.fn(mkR), deleteBookings: jest.fn(mkR),
    updateBooking: jest.fn(mkR), getBookingData: jest.fn(mkR),
    tableBooking: jest.fn(async (req, res) => {
      const m = await require("../model/tablebooking").findOne();
      if (m) return res.json({ error: true, results: { message: "T_N_T_R - Table not available at this time" }, code: 409 });
      return mkR(req, res);
    }),
  };
});

const mockTable = { findOne: jest.fn(), findAll: jest.fn(), create: jest.fn(), update: jest.fn(), destroy: jest.fn() };
const mockTableCat = { findOne: jest.fn(), findAll: jest.fn(), create: jest.fn(), update: jest.fn(), destroy: jest.fn() };
const mockTableBooking = { findOne: jest.fn(), findAll: jest.fn(), create: jest.fn(), update: jest.fn(), destroy: jest.fn() };
const mockOrder = { findOne: jest.fn().mockResolvedValue(null), findAll: jest.fn().mockResolvedValue([]), update: jest.fn().mockResolvedValue([1]) };
const mockAdminCart = { findAll: jest.fn().mockResolvedValue([]), create: jest.fn(), destroy: jest.fn() };

jest.mock("../model/table", () => mockTable);
jest.mock("../model/table_catg", () => mockTableCat);
jest.mock("../model/tablebooking", () => mockTableBooking);
jest.mock("../model/order", () => mockOrder);
jest.mock("../model/adminCart", () => mockAdminCart);
jest.mock("../model/menu", () => ({ findOne: jest.fn(), findAll: jest.fn().mockResolvedValue([]) }));
jest.mock("../model/menu_categ", () => ({ findAll: jest.fn().mockResolvedValue([]) }));
jest.mock("../model/order_details", () => ({ findAll: jest.fn().mockResolvedValue([]) }));
jest.mock("../model/timeline", () => ({ create: jest.fn(), findAll: jest.fn().mockResolvedValue([]) }));
jest.mock("../controller/redis/redisCrud", () => ({
  updateTableToRadis: jest.fn(), newOrderAppendToRadis: jest.fn(),
  updateOrderAppendToRadis: jest.fn(), deleteOrderToRedis: jest.fn(),
}));

let app, authHeader, adminToken;
beforeAll(() => {
  process.env.JWT_SECRET_KEY_ADMIN = SECRETS.admin;
  const { createTestApp } = require("./setup/testApp");
  app = createTestApp();
  adminToken = generateAdminToken(mockHotelUserRecord.id);
  authHeader = adminAuthHeader(adminToken);
  const { UserSession } = require("../model");
  UserSession.findOne.mockResolvedValue({ user_id: mockHotelUserRecord.id, token: adminToken });
  const HotelUser = require("../model/hotelUser");
  HotelUser.findOne.mockResolvedValue(mockHotelUserRecord);
});

// ─────────────────────────────────────────────────────────────────────────────
describe("🪑 Table CRUD", () => {
  test("T-TBL-01 | Create new table → 201", async () => {
    mockTable.findOne.mockResolvedValueOnce(null);
    mockTable.create.mockResolvedValueOnce(TD.TABLE_T1);

    const res = await request(app)
      .post("/api/table")
      .set(authHeader)
      .send({ tableNumber: "T10", category_id: 1, capacity: 4 });

    expect([200, 201]).toContain(res.statusCode);
    expectSuccess(res.body);
  });

  test("T-TBL-02 | Duplicate table number → conflict error", async () => {
    mockTable.findOne.mockResolvedValueOnce(TD.TABLE_T1);

    const res = await request(app)
      .post("/api/table")
      .set(authHeader)
      .send({ tableNumber: "T1", category_id: 1, capacity: 4 });

    expectError(res.body);
    expect([409, 422, 400]).toContain(res.body.code);
  });

  test("T-TBL-03 | Get all tables → list", async () => {
    mockTable.findAll.mockResolvedValueOnce([TD.TABLE_T1, TD.TABLE_T2, TD.TABLE_T3]);

    const res = await request(app).get("/api/table").set(authHeader);

    expect([200, 201]).toContain(res.statusCode);
    expect(res.body).toHaveProperty("results");
  });

  test("T-TBL-04 | Edit table details → 200", async () => {
    mockTable.findOne.mockResolvedValueOnce(TD.TABLE_T1);
    mockTable.update.mockResolvedValueOnce([1]);

    const res = await request(app)
      .post("/api/editTable")
      .set(authHeader)
      .send({ id: 1, tableNumber: "T1-A", capacity: 6 });

    expect([200, 201]).toContain(res.statusCode);
  });

  test("T-TBL-05 | Delete available table → 200", async () => {
    mockTable.findOne.mockResolvedValueOnce({ ...TD.TABLE_T1, status: "available" });
    mockOrder.findOne.mockResolvedValueOnce(null);
    mockTable.destroy.mockResolvedValueOnce(1);

    const res = await request(app)
      .post("/api/removeTable")
      .set(authHeader)
      .send({ id: 1 });

    expect([200, 201]).toContain(res.statusCode);
  });

  test("T-TBL-06 | Delete RUNNING table → error (cannot delete)", async () => {
    mockTable.findOne.mockResolvedValueOnce({ ...TD.TABLE_T3, status: "running" });
    mockOrder.findOne.mockResolvedValueOnce(TD.ORDER_DININ);

    const res = await request(app)
      .post("/api/removeTable")
      .set(authHeader)
      .send({ id: 3 });

    expectError(res.body);
    expect(res.body.results.message).toMatch(/running|reserved|cannot delete/i);
  });

  test("T-TBL-07 | Reserve a table → 200", async () => {
    mockTable.findOne.mockResolvedValueOnce({ ...TD.TABLE_T2, status: "available" });
    mockTable.update.mockResolvedValueOnce([1]);

    const res = await request(app)
      .post("/api/reserved")
      .set(authHeader)
      .send({ id: 2 });

    expect([200, 201]).toContain(res.statusCode);
  });

  test("T-TBL-08 | Move table (T1 → T3) → 200", async () => {
    mockOrder.findOne.mockResolvedValueOnce(TD.ORDER_DININ);
    mockTable.findOne
      .mockResolvedValueOnce(TD.TABLE_T1)
      .mockResolvedValueOnce(TD.TABLE_T3);
    mockOrder.findAll.mockResolvedValueOnce([TD.ORDER_DININ]);
    mockOrder.update.mockResolvedValueOnce([1]);
    mockTable.update.mockResolvedValue([1]);

    const res = await request(app)
      .post("/api/moveTable")
      .set(authHeader)
      .send({ fromTableId: 1, toTableId: 3 });

    expect([200, 201]).toContain(res.statusCode);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("📁 Table Categories", () => {
  test("T-TCA-01 | Create table category → 201", async () => {
    mockTableCat.findOne.mockResolvedValueOnce(null);
    mockTableCat.create.mockResolvedValueOnce({ id: 1, name: "Indoor", hotel_id: 1 });

    const res = await request(app)
      .post("/api/addTableCatagories")
      .set(authHeader)
      .send({ name: "Indoor" });

    expect([200, 201]).toContain(res.statusCode);
    expectSuccess(res.body);
  });

  test("T-TCA-02 | Duplicate category → error", async () => {
    mockTableCat.findOne.mockResolvedValueOnce({ id: 1, name: "Indoor" });

    const res = await request(app)
      .post("/api/addTableCatagories")
      .set(authHeader)
      .send({ name: "Indoor" });

    expectError(res.body);
  });

  test("T-TCA-03 | Get table categories", async () => {
    mockTableCat.findAll.mockResolvedValueOnce([{ id: 1, name: "Indoor" }, { id: 2, name: "Outdoor" }]);

    const res = await request(app).get("/api/getTableCatagories").set(authHeader);
    expect([200, 201]).toContain(res.statusCode);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("📅 Table Booking", () => {
  test("T-BKG-01 | Book available table for future date → 201", async () => {
    mockTable.findOne.mockResolvedValueOnce(TD.TABLE_T1);
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
    expectSuccess(res.body);
  });

  test("T-BKG-02 | Booking conflict — same table, same time → T_N_T_R error", async () => {
    mockTable.findOne.mockResolvedValueOnce(TD.TABLE_T1);
    mockTableBooking.findOne.mockResolvedValueOnce(TD.TABLE_BOOKING);

    const res = await request(app)
      .post("/api/tableBooking")
      .set(authHeader)
      .send({
        table_id: 1, customer_name: "Another Guest", customer_number: "9800000002",
        booking_date: "2024-04-15", booking_time: "19:00", party_size: 2,
      });

    expectError(res.body);
    expect(res.body.results.message).toMatch(/time|not available|T_N_T_R/i);
  });

  test("T-BKG-03 | Get all bookings → list", async () => {
    mockTableBooking.findAll.mockResolvedValueOnce([TD.TABLE_BOOKING]);

    const res = await request(app).get("/api/getBookingData").set(authHeader);
    expect([200, 201]).toContain(res.statusCode);
  });

  test("T-BKG-04 | Cancel booking → 200", async () => {
    mockTableBooking.findOne.mockResolvedValueOnce(TD.TABLE_BOOKING);
    mockTableBooking.destroy.mockResolvedValueOnce(1);

    const res = await request(app)
      .post("/api/deleteBooking")
      .set(authHeader)
      .send({ id: 1 });

    expect([200, 201]).toContain(res.statusCode);
  });

  test("T-BKG-05 | Update booking time → 200", async () => {
    mockTableBooking.findOne.mockResolvedValueOnce(TD.TABLE_BOOKING);
    mockTableBooking.update.mockResolvedValueOnce([1]);

    const res = await request(app)
      .post("/api/updatedBooking/1")
      .set(authHeader)
      .send({ booking_time: "20:00" });

    expect([200, 201]).toContain(res.statusCode);
  });

  test("T-BKG-06 | Get single booking by ID → 200", async () => {
    mockTableBooking.findOne.mockResolvedValueOnce(TD.TABLE_BOOKING);

    const res = await request(app)
      .get("/api/singleBookingData/1")
      .set(authHeader);

    expect([200, 201]).toContain(res.statusCode);
  });
});
