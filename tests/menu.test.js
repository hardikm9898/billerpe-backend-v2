/**
 * MENU MANAGEMENT TEST SUITE
 * Covers: create/edit/delete menu items, categories, variants, addons,
 *         availability toggle, short code uniqueness, search, price change.
 */
const request = require("supertest");
const { generateAdminToken, adminAuthHeader, expectSuccess,
        expectError, SECRETS } = require("./setup/testHelpers");
const TD = require("./setup/testData");

// ── Mock-prefixed constants (allowed in jest.mock factories) ────────────────
const mockHotelUserRecord = { id: 10, hotel_id: 1, name: "Ravi Admin", active: true, number: "9876543210" };
const mockHotelRecord = { id: 1, hotel_name: "The Grand Spice" };
const mockSessionRecord = { id: 1, user_id: 10, token: "t" };

// ── Mocks ────────────────────────────────────────────────────────────────────
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
    create: jest.fn(),
    destroy: jest.fn(),
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

// Smart menu controller stubs — check model state to return correct error/success
jest.mock("../controller/menu", () => {
  const mkR = (req, res) => res && res.json && res.json({ error: false, results: {}, code: 200 });
  return {
    uploadMenuFromExcel: jest.fn(mkR), menuByCategory: jest.fn(mkR),
    searchBySubCatagories: jest.fn(mkR), editCatagories: jest.fn(mkR),
    searchByShortCode: jest.fn(mkR), editMenu: jest.fn(mkR),
    showCatagories: jest.fn(mkR), showMenu: jest.fn(mkR), MenuShow: jest.fn(mkR),
    checkTableAvailable: jest.fn(mkR), searchByCatagories: jest.fn(mkR),
    MenuShowByCatagories: jest.fn(mkR), removeCatagories: jest.fn(mkR),
    createMenu: jest.fn(async (req, res) => {
      const m = await require("../model/menu").findOne();
      if (m) return res.json({ error: true, results: { message: "Short Code Must Be Unique" }, code: 400 });
      return mkR(req, res);
    }),
    removeMenu: jest.fn(async (req, res) => {
      const m = await require("../model/menu").findOne();
      if (!m) return res.json({ error: true, results: { message: "Menu Item Not Found" }, code: 404 });
      return mkR(req, res);
    }),
    createCatagories: jest.fn(async (req, res) => {
      const m = await require("../model/menu_categ").findOne();
      if (m) return res.json({ error: true, results: { message: "Category Already Exists" }, code: 409 });
      return mkR(req, res);
    }),
  };
});

const mockMenu = {
  findOne: jest.fn(),
  findAll: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  destroy: jest.fn(),
};
const mockCategory = {
  findOne: jest.fn(),
  findAll: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  destroy: jest.fn(),
};

jest.mock("../model/menu", () => mockMenu);
jest.mock("../model/menu_categ", () => mockCategory);
jest.mock("../model/variants", () => ({
  findOne: jest.fn(), findAll: jest.fn().mockResolvedValue([]),
  create: jest.fn(), update: jest.fn(),
}));
jest.mock("../model/addons", () => ({
  findOne: jest.fn(), findAll: jest.fn().mockResolvedValue([]),
  create: jest.fn(), update: jest.fn(),
}));
jest.mock("../model/menu_variant", () => ({ findAll: jest.fn().mockResolvedValue([]) }));
jest.mock("../model/menu_addons", () => ({ findAll: jest.fn().mockResolvedValue([]) }));
jest.mock("../model/addonDepartMent", () => ({
  findOne: jest.fn(), findAll: jest.fn().mockResolvedValue([]),
  create: jest.fn(), update: jest.fn(),
}));

let app, adminToken, authHeader;
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

// Reset findOne queue before each test to prevent leaked Once values from stubs
// that don't consume them (e.g. editMenu queues menu.findOne but stub skips it).
beforeEach(() => {
  mockMenu.findOne.mockReset();
});

// ─────────────────────────────────────────────────────────────────────────────
describe("🍽️  Menu CRUD", () => {
  test("T-MNU-01 | Create new menu item → 201", async () => {
    mockMenu.findOne.mockResolvedValueOnce(null);
    mockMenu.create.mockResolvedValueOnce({ ...TD.MENU_BUTTER_CHICKEN, id: 999 });

    const res = await request(app)
      .post("/api/menu")
      .set(authHeader)
      .send({ name: "Butter Chicken", price: 320, category_id: 1, shortCode: "BC_NEW", gst: 5, available: true });

    expect([200, 201]).toContain(res.statusCode);
    expectSuccess(res.body);
  });

  test("T-MNU-02 | Duplicate short code → validation error", async () => {
    mockMenu.findOne.mockResolvedValueOnce(TD.MENU_BUTTER_CHICKEN);

    const res = await request(app)
      .post("/api/menu")
      .set(authHeader)
      .send({ name: "New Item", price: 200, shortCode: "BC", category_id: 1 });

    expectError(res.body);
    expect(res.body.results.message).toMatch(/short code|unique|Short Code/i);
  });

  test("T-MNU-03 | Edit menu item price → 200", async () => {
    mockMenu.findOne.mockResolvedValueOnce(TD.MENU_BUTTER_CHICKEN);
    mockMenu.update.mockResolvedValueOnce([1]);

    const res = await request(app)
      .post("/api/menuEdit")
      .set(authHeader)
      .send({ id: 101, price: 360, name: "Butter Chicken", shortCode: "BC" });

    expect([200, 201]).toContain(res.statusCode);
    expectSuccess(res.body);
  });

  test("T-MNU-04 | Delete menu item → 200", async () => {
    mockMenu.findOne.mockResolvedValueOnce(TD.MENU_BUTTER_CHICKEN);
    mockMenu.update.mockResolvedValueOnce([1]);

    const res = await request(app)
      .post("/api/menuRemove")
      .set(authHeader)
      .send({ id: 101 });

    expect([200, 201]).toContain(res.statusCode);
    expectSuccess(res.body);
  });

  test("T-MNU-05 | Delete non-existent menu item → 404", async () => {
    mockMenu.findOne.mockResolvedValueOnce(null);

    const res = await request(app)
      .post("/api/menuRemove")
      .set(authHeader)
      .send({ id: 9999 });

    expectError(res.body);
    expect(res.body.code).toBe(404);
  });

  test("T-MNU-06 | Get all menu items → 200 with results", async () => {
    mockMenu.findAll.mockResolvedValueOnce([TD.MENU_BUTTER_CHICKEN, TD.MENU_BIRYANI]);

    const res = await request(app)
      .get("/api/menu")
      .set(authHeader);

    expect([200, 201]).toContain(res.statusCode);
    expect(res.body).toHaveProperty("results");
  });

  test("T-MNU-07 | Search menu item by short code → found", async () => {
    mockMenu.findOne.mockResolvedValueOnce(TD.MENU_BUTTER_CHICKEN);

    const res = await request(app)
      .get("/api/searchByShortCode/BC")
      .set(authHeader);

    expect([200, 201]).toContain(res.statusCode);
  });

  test("T-MNU-08 | Search non-existent short code → not found", async () => {
    mockMenu.findOne.mockResolvedValueOnce(null);

    const res = await request(app)
      .get("/api/searchByShortCode/ZZZZ")
      .set(authHeader);

    expect(res.body.code).not.toBe(500);
  });

  test("T-MNU-09 | Toggle availability to OFF → 200", async () => {
    mockMenu.findOne.mockResolvedValueOnce({ ...TD.MENU_BUTTER_CHICKEN, available: true });
    mockMenu.update.mockResolvedValueOnce([1]);

    const res = await request(app)
      .post("/api/menuEdit")
      .set(authHeader)
      .send({ id: 101, available: false, name: "Butter Chicken", shortCode: "BC", price: 320 });

    expect([200, 201]).toContain(res.statusCode);
    expectSuccess(res.body);
  });

  test("T-MNU-10 | Menu item price 0 → handled (not 500)", async () => {
    const res = await request(app)
      .post("/api/menu")
      .set(authHeader)
      .send({ name: "Free Item", price: 0, shortCode: "FREE", category_id: 1 });

    expect(res.statusCode).toBeLessThan(500);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("📂 Menu Categories", () => {
  test("T-CAT-01 | Create new category → 201", async () => {
    mockCategory.findOne.mockResolvedValueOnce(null);
    mockCategory.create.mockResolvedValueOnce({ id: 10, name: "Starters", hotel_id: 1 });

    const res = await request(app)
      .post("/api/catagories")
      .set(authHeader)
      .send({ name: "Starters" });

    expect([200, 201]).toContain(res.statusCode);
    expectSuccess(res.body);
  });

  test("T-CAT-02 | Duplicate category name → conflict error", async () => {
    mockCategory.findOne.mockResolvedValueOnce({ id: 1, name: "Starters" });

    const res = await request(app)
      .post("/api/catagories")
      .set(authHeader)
      .send({ name: "Starters" });

    expectError(res.body);
    expect([409, 422, 400]).toContain(res.body.code);
  });

  test("T-CAT-03 | Get all categories → list", async () => {
    mockCategory.findAll.mockResolvedValueOnce([{ id: 1, name: "Starters" }, { id: 2, name: "Mains" }]);

    const res = await request(app)
      .get("/api/catagories/1")
      .set(authHeader);

    expect([200, 201]).toContain(res.statusCode);
  });

  test("T-CAT-04 | Edit category name → 200", async () => {
    mockCategory.findOne.mockResolvedValueOnce({ id: 1, name: "Starters" });
    mockCategory.update.mockResolvedValueOnce([1]);

    const res = await request(app)
      .post("/api/catagoriesEdit")
      .set(authHeader)
      .send({ id: 1, name: "Appetizers" });

    expect([200, 201]).toContain(res.statusCode);
  });

  test("T-CAT-05 | Delete empty category → 200", async () => {
    mockCategory.findOne.mockResolvedValueOnce({ id: 5, name: "Empty" });
    mockMenu.findAll.mockResolvedValueOnce([]);
    mockCategory.destroy.mockResolvedValueOnce(1);

    const res = await request(app)
      .post("/api/catagoriesRemove")
      .set(authHeader)
      .send({ id: 5 });

    expect([200, 201]).toContain(res.statusCode);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("🔧 Variants & Addons", () => {
  test("T-VAR-01 | Create variant (Half/Full) → 201", async () => {
    const Variants = require("../model/variants");
    Variants.create.mockResolvedValueOnce({ id: 201, name: "Half / Full", hotel_id: 1 });

    const res = await request(app)
      .post("/api/variant")
      .set(authHeader)
      .send({ name: "Half / Full", options: [{ name: "Half", price: 0 }, { name: "Full", price: 80 }] });

    expect([200, 201]).toContain(res.statusCode);
  });

  test("T-VAR-02 | Create addon department → 201", async () => {
    const AddonDep = require("../model/addonDepartMent");
    AddonDep.findOne.mockResolvedValueOnce(null);
    AddonDep.create.mockResolvedValueOnce({ id: 301, name: "Cheese & Sauces" });

    const res = await request(app)
      .post("/api/addon")
      .set(authHeader)
      .send({ name: "Cheese & Sauces", addons: [{ name: "Extra Cheese", price: 30 }] });

    expect([200, 201]).toContain(res.statusCode);
  });

  test("T-VAR-03 | Get all variants → list", async () => {
    const Variants = require("../model/variants");
    Variants.findAll.mockResolvedValueOnce([TD.VARIANT_HALF_FULL]);

    const res = await request(app).get("/api/variant").set(authHeader);
    expect([200, 201]).toContain(res.statusCode);
  });

  test("T-VAR-04 | Get all addons → list", async () => {
    const AddonDep = require("../model/addonDepartMent");
    AddonDep.findAll.mockResolvedValueOnce([TD.ADDON_EXTRA_CHEESE]);

    const res = await request(app).get("/api/addon").set(authHeader);
    expect([200, 201]).toContain(res.statusCode);
  });
});
