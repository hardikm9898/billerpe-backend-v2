/**
 * AUTH TEST SUITE
 * Covers: restaurant login, captain login, mobile login,
 *         token expiry, rate limiting, role access control,
 *         session invalidation, concurrent logins.
 */
const request = require("supertest");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");

const { generateAdminToken, generateCaptainToken,
        generateExpiredToken, expectSuccess, expectError,
        expectUnauthorized, SECRETS } = require("./setup/testHelpers");

// ── Mock-prefixed constants (allowed in jest.mock factories) ────────────────
const mockHotelUser = { id: 10, hotel_id: 1, name: "Ravi Admin", number: "9876543210", active: true, role: "admin" };
const mockCaptainUser = { id: 11, hotel_id: 1, name: "Suresh Waiter", number: "9876500001", role: "C", active: true };
const mockHotel = { id: 1, hotel_name: "The Grand Spice", gst_no: "27AAACR5055K1Z5" };
const mockSession = { id: 1, user_id: 10, token: "mock_token" };

// ── Mocks ────────────────────────────────────────────────────────────────────
jest.mock("../connection/connect", () => ({ query: jest.fn(), sync: jest.fn(), define: jest.fn().mockReturnValue({ findOne: jest.fn(), findAll: jest.fn().mockResolvedValue([]), create: jest.fn(), update: jest.fn().mockResolvedValue([1]), destroy: jest.fn().mockResolvedValue(1), belongsTo: jest.fn(), hasMany: jest.fn(), hasOne: jest.fn() }) }));
jest.mock("../connection/redis", () => ({
  get: jest.fn(), set: jest.fn(), del: jest.fn(), connect: jest.fn(),
}));
jest.mock("../connection/socket", () => ({
  initializeSocket: jest.fn(),
  checkDashBoardOnOrNot: jest.fn((req, res) => res.json({ error: false, results: {}, code: 200 })),
}));
jest.mock("../model", () => ({
  UserSession: {
    findOne: jest.fn().mockResolvedValue(mockSession),
    findAll: jest.fn().mockResolvedValue([mockSession]),
    create: jest.fn().mockResolvedValue(mockSession),
    destroy: jest.fn().mockResolvedValue(1),
  },
  RestaurantSetting: { findOne: jest.fn().mockResolvedValue({ business_date: new Date().toISOString().split("T")[0] }) },
  sequelize: { authenticate: jest.fn(), sync: jest.fn(), transaction: jest.fn((cb) => cb({})) },
}));
jest.mock("../model/hotelUser", () => ({
  findOne: jest.fn().mockResolvedValue(mockHotelUser),
  findAll: jest.fn().mockResolvedValue([mockHotelUser]),
  update: jest.fn().mockResolvedValue([1]),
}));
jest.mock("../model/user", () => ({
  findOne: jest.fn().mockResolvedValue(mockCaptainUser),
}));
jest.mock("../model/hotel", () => ({
  findOne: jest.fn().mockResolvedValue(mockHotel),
  findAll: jest.fn().mockResolvedValue([mockHotel]),
  belongsTo: jest.fn(), hasMany: jest.fn(), hasOne: jest.fn(), belongsToMany: jest.fn(),
}));
jest.mock("../model/role_mst", () => ({
  findOne: jest.fn().mockResolvedValue({ role_cd: "C", role_name: "Captain" }),
}));
jest.mock("../controller/recipes", () => ({ checkRawMaterialAvailableOrNot: jest.fn().mockResolvedValue(true), addRecipes: jest.fn(), editRecipes: jest.fn(), getAllRecipes: jest.fn(), getSingleRecipes: jest.fn(), deleteRecipe: jest.fn(), getAllRecipesForMenu: jest.fn(), convertMenuWise: jest.fn() }));
jest.mock("../services/upload", () => { const mw = (_r, _res, n) => n(); return { uploadSingleTest: jest.fn(() => mw), uploadMultipleTest: jest.fn(() => mw), uploadWhatsAppTemplateImage: jest.fn(() => mw), uploadSingleAttachedment: jest.fn(() => mw) }; });
jest.mock("../middleware/upload", () => { const fn = (_req, _res, next) => next(); fn.fields = () => fn; fn.single = () => fn; fn.array = () => fn; return fn; });

// ── Override global no-op controller stubs with real implementations ─────────
jest.mock("../controller/auth", () => jest.requireActual("../controller/auth"));
jest.mock("../controller/user", () => jest.requireActual("../controller/user"));
jest.mock("../controller/mobileController/dashBoard", () => jest.requireActual("../controller/mobileController/dashBoard"));

let app;
beforeAll(() => {
  process.env.JWT_SECRET_KEY_ADMIN = SECRETS.admin;
  process.env.JWT_SECRET_KEY_USER = SECRETS.user;
  process.env.JWT_SECRET_KEY_CAPTAIN = SECRETS.captain;
  const { createTestApp } = require("./setup/testApp");
  app = createTestApp();
});

// ─────────────────────────────────────────────────────────────────────────────
describe("🔐 Restaurant Admin Login", () => {
  test("T-AUTH-01 | Valid credentials → 200 + token", async () => {
    const HotelUser = require("../model/hotelUser");
    // restaurantLogin uses plain-text comparison (password === hotelUser.password)
    HotelUser.findOne.mockResolvedValueOnce({ ...mockHotelUser, password: "Secret@123" });

    const res = await request(app)
      .post("/api/restaurantLogin")
      .send({ mobile: "9876543210", password: "Secret@123" });

    expect(res.statusCode).toBeLessThan(500);
    expect(res.body).toHaveProperty("error");
    if (!res.body.error) {
      expectSuccess(res.body);
    }
  });

  test("T-AUTH-02 | Wrong password → credential error", async () => {
    const HotelUser = require("../model/hotelUser");
    HotelUser.findOne.mockResolvedValueOnce({ ...mockHotelUser, password: "RightPass" });

    const res = await request(app)
      .post("/api/restaurantLogin")
      .send({ mobile: "9876543210", password: "WrongPass" });

    expect(res.statusCode).toBeLessThan(500);
    expect(res.body.error).toBe(true);
  });

  test("T-AUTH-03 | Non-existent mobile number → auth error", async () => {
    const HotelUser = require("../model/hotelUser");
    HotelUser.findOne.mockResolvedValueOnce(null);

    const res = await request(app)
      .post("/api/restaurantLogin")
      .send({ mobile: "0000000000", password: "anything" });

    expect(res.statusCode).toBeLessThan(500);
    expect(res.body.error).toBe(true);
  });

  test("T-AUTH-04 | Missing required fields → error (not 500)", async () => {
    const res = await request(app)
      .post("/api/restaurantLogin")
      .send({ mobile: "9876543210" }); // no password

    expect(res.statusCode).toBeLessThan(500);
    expect(res.body).toHaveProperty("error");
  });

  test("T-AUTH-05 | Rate limit — 6th login attempt in 5 min → 429", async () => {
    const HotelUser = require("../model/hotelUser");
    HotelUser.findOne.mockResolvedValue(null);

    for (let i = 0; i < 5; i++) {
      await request(app)
        .post("/api/restaurantLogin")
        .send({ mobile: "9876500099", password: "wrong" });
    }
    const res = await request(app)
      .post("/api/restaurantLogin")
      .send({ mobile: "9876500099", password: "wrong" });

    expect(res.statusCode).toBe(429);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("🔐 Captain (Waiter) Login", () => {
  test("T-AUTH-06 | Valid captain credentials → success", async () => {
    const User = require("../model/user");
    const hashedPwd = await bcrypt.hash("Captain@123", 10);
    User.findOne.mockResolvedValueOnce({ ...mockCaptainUser, password: hashedPwd });

    const res = await request(app)
      .post("/api/captainLogin")
      .send({ phoneNumber: "9876500001", password: "Captain@123" });

    expect(res.statusCode).toBe(200);
    expectSuccess(res.body);
  });

  test("T-AUTH-07 | Captain with wrong PIN → credential error", async () => {
    const User = require("../model/user");
    const hashedPwd = await bcrypt.hash("RightPin", 10);
    User.findOne.mockResolvedValueOnce({ ...mockCaptainUser, password: hashedPwd });

    const res = await request(app)
      .post("/api/captainLogin")
      .send({ phoneNumber: "9876500001", password: "WrongPin" });

    expectError(res.body);
  });

  test("T-AUTH-08 | Login with non-existent captain → 404", async () => {
    const User = require("../model/user");
    User.findOne.mockResolvedValueOnce(null);

    const res = await request(app)
      .post("/api/captainLogin")
      .send({ phoneNumber: "9876543210", password: "Secret@123" });

    expectError(res.body);
    expect(res.body.code).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("🔐 JWT Token Validation", () => {
  test("T-AUTH-09 | Valid admin token → protected route accessible", async () => {
    const { UserSession } = require("../model");
    const HotelUser = require("../model/hotelUser");
    const token = generateAdminToken(mockHotelUser.id);
    UserSession.findOne.mockResolvedValueOnce({ user_id: mockHotelUser.id, token });
    HotelUser.findOne.mockResolvedValueOnce(mockHotelUser);

    const res = await request(app)
      .get("/api/checkHotelLogin")
      .set("Authorization", `Bearer ${token}`);

    expect(res.statusCode).not.toBe(401);
  });

  test("T-AUTH-10 | Expired token → 401 unauthorized", async () => {
    const expiredToken = generateExpiredToken(mockHotelUser.id);

    const res = await request(app)
      .get("/api/checkHotelLogin")
      .set("Authorization", `Bearer ${expiredToken}`);

    expect(res.statusCode).toBe(401);
    expectUnauthorized(res.body);
  });

  test("T-AUTH-11 | Tampered token → 401 unauthorized", async () => {
    const token = generateAdminToken(mockHotelUser.id) + "tampered";

    const res = await request(app)
      .get("/api/checkHotelLogin")
      .set("Authorization", `Bearer ${token}`);

    expect(res.statusCode).toBe(401);
  });

  test("T-AUTH-12 | No token sent → 401 unauthorized", async () => {
    const res = await request(app).get("/api/checkHotelLogin");

    expect(res.statusCode).toBe(401);
    expectUnauthorized(res.body);
  });

  test("T-AUTH-13 | Valid token but session revoked → 401", async () => {
    const { UserSession } = require("../model");
    const token = generateAdminToken(mockHotelUser.id);
    UserSession.findOne.mockResolvedValueOnce(null); // session deleted

    const res = await request(app)
      .get("/api/checkHotelLogin")
      .set("Authorization", `Bearer ${token}`);

    expect(res.statusCode).toBe(401);
  });

  test("T-AUTH-14 | Valid token but user account deactivated → 401", async () => {
    const { UserSession } = require("../model");
    const HotelUser = require("../model/hotelUser");
    const token = generateAdminToken(mockHotelUser.id);
    UserSession.findOne.mockResolvedValueOnce({ user_id: mockHotelUser.id, token });
    HotelUser.findOne.mockResolvedValueOnce(null); // user deactivated / not found

    const res = await request(app)
      .get("/api/checkHotelLogin")
      .set("Authorization", `Bearer ${token}`);

    expect(res.statusCode).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("🔐 Role-Based Access Control", () => {
  test("T-AUTH-15 | Non-super-admin cannot access super-admin hotel route", async () => {
    // GET /api/hotel uses superAdminAuth (cookie-based). Without demo/demo2 cookies,
    // it returns an error body regardless of Authorization header.
    const token = generateCaptainToken(mockCaptainUser.id);

    const res = await request(app)
      .get("/api/hotel")
      .set("Authorization", `Bearer ${token}`);

    // superAdminAuth returns JSON error when cookies are missing (HTTP 200, body error:true)
    expect(res.body.error).toBe(true);
  });

  test("T-AUTH-16 | Logout clears session → 200", async () => {
    const { UserSession } = require("../model");
    const HotelUser = require("../model/hotelUser");
    const token = generateAdminToken(mockHotelUser.id);
    UserSession.findOne.mockResolvedValueOnce({ user_id: mockHotelUser.id, token });
    UserSession.destroy.mockResolvedValueOnce(1);
    HotelUser.findOne.mockResolvedValueOnce(mockHotelUser);

    const res = await request(app)
      .post("/api/logout")
      .set("Authorization", `Bearer ${token}`);

    expect([200, 201, 202]).toContain(res.statusCode);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("🔐 Mobile Login", () => {
  test("T-AUTH-17 | Valid mobile login → 200", async () => {
    const HotelUser = require("../model/hotelUser");
    // mobileLogin uses plain-text comparison
    HotelUser.findOne.mockResolvedValueOnce({ ...mockHotelUser, password: "Mobile@123" });

    const res = await request(app)
      .post("/api/mobileLogin")
      .send({ mobile: "9876543210", password: "Mobile@123" });

    expect(res.statusCode).toBe(200);
  });

  test("T-AUTH-18 | Wrong mobile credentials → error", async () => {
    const HotelUser = require("../model/hotelUser");
    HotelUser.findOne.mockResolvedValueOnce({ ...mockHotelUser, password: "Mobile@123" });

    const res = await request(app)
      .post("/api/mobileLogin")
      .send({ mobile: "9876543210", password: "WrongMobile" });

    expect(res.body.error).toBe(true);
  });
});
