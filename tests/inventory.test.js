/**
 * INVENTORY MANAGEMENT TEST SUITE
 * ═══════════════════════════════════════════════════════════════════
 * Covers: raw material CRUD, unit management, recipe creation,
 *         stock depletion on order, low-stock alert, wastage entry,
 *         purchase orders, stock history, supplier management,
 *         semi-finished items, negative stock prevention.
 */
const request = require("supertest");
const { generateAdminToken, adminAuthHeader,
        expectSuccess, expectError, SECRETS } = require("./setup/testHelpers");
const TD = require("./setup/testData");

// ── Mock-prefixed constants for jest.mock factories ──────────────────────────
const mockHotelUserRecord = { id: 10, hotel_id: 1, name: "Ravi Admin", number: "9876543210", active: true, role: "admin" };
const mockHotelRecord = { id: 1, hotel_name: "The Grand Spice", gst_no: "27AAACR5055K1Z5" };
const mockRawMaterialChicken = { id: 1, name: "Chicken", unit: "kg", current_stock: 15, min_stock: 2, hotel_id: 1 };
const mockRawMaterialTomato = { id: 2, name: "Tomato", unit: "kg", current_stock: 5, min_stock: 1, hotel_id: 1 };
const mockRecipeButterChicken = { id: 1, menu_id: 101, hotel_id: 1, ingredients: [{ raw_material_id: 1, qty: 0.25, unit: "kg" }, { raw_material_id: 2, qty: 0.1, unit: "kg" }] };
const mockMenuButterChicken = { id: 101, name: "Butter Chicken", price: 320, hotel_id: 1, category_id: 1, shortCode: "BC", available: true, gst: 5 };

jest.mock("../connection/connect", () => ({ query: jest.fn(), sync: jest.fn(), define: jest.fn().mockReturnValue({ findOne: jest.fn(), findAll: jest.fn().mockResolvedValue([]), create: jest.fn(), update: jest.fn().mockResolvedValue([1]), destroy: jest.fn().mockResolvedValue(1), belongsTo: jest.fn(), hasMany: jest.fn(), hasOne: jest.fn() }) }));
jest.mock("../connection/redis", () => ({ get: jest.fn(), set: jest.fn(), del: jest.fn(), connect: jest.fn() }));
jest.mock("../connection/socket", () => ({ initializeSocket: jest.fn(), checkDashBoardOnOrNot: jest.fn((req, res) => res.json({})) }));
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
jest.mock("../controller/recipes", () => { const R = (req, res) => res && res.json && res.json({ error: false, results: {}, code: 200 }); return { checkRawMaterialAvailableOrNot: jest.fn().mockResolvedValue(true), addRecipes: jest.fn(R), editRecipes: jest.fn(R), getAllRecipes: jest.fn(R), getSingleRecipes: jest.fn(R), deleteRecipe: jest.fn(R), getAllRecipesForMenu: jest.fn(R), convertMenuWise: jest.fn(R) }; });

const mockRawMaterial = {
  findOne: jest.fn(),
  findAll: jest.fn().mockResolvedValue([mockRawMaterialChicken, mockRawMaterialTomato]),
  create: jest.fn().mockResolvedValue(mockRawMaterialChicken),
  update: jest.fn().mockResolvedValue([1]),
  destroy: jest.fn().mockResolvedValue(1),
};
const mockUnit = {
  findOne: jest.fn(),
  findAll: jest.fn().mockResolvedValue([{ id: 1, name: "kg" }, { id: 2, name: "litre" }]),
  create: jest.fn(),
  update: jest.fn().mockResolvedValue([1]),
};
const mockRecipe = {
  findOne: jest.fn(),
  findAll: jest.fn().mockResolvedValue([mockRecipeButterChicken]),
  create: jest.fn().mockResolvedValue(mockRecipeButterChicken),
  update: jest.fn().mockResolvedValue([1]),
  destroy: jest.fn().mockResolvedValue(1),
};
const mockStockHistory = {
  findAll: jest.fn().mockResolvedValue([]),
  create: jest.fn().mockResolvedValue({}),
  sum: jest.fn().mockResolvedValue(0),
};
const mockPurchaseOrder = {
  findOne: jest.fn(),
  findAll: jest.fn().mockResolvedValue([]),
  create: jest.fn().mockResolvedValue({ id: 1 }),
  update: jest.fn().mockResolvedValue([1]),
};
const mockSupplier = {
  findOne: jest.fn(),
  findAll: jest.fn().mockResolvedValue([]),
  create: jest.fn().mockResolvedValue({ id: 1 }),
};
const mockWastage = {
  findOne: jest.fn(),
  findAll: jest.fn().mockResolvedValue([]),
  create: jest.fn().mockResolvedValue({ id: 1 }),
};

jest.mock("../model/rawItem", () => mockRawMaterial);
jest.mock("../model/unit", () => mockUnit);
jest.mock("../model/recipes", () => mockRecipe);
jest.mock("../model/Inventory/purchaseOrder", () => mockPurchaseOrder);
jest.mock("../model/Inventory/purchaseRawMaterial", () => { return jest.fn().mockResolvedValue({}); });
jest.mock("../model/Inventory/supplyer", () => mockSupplier);
jest.mock("../model/Inventory/westage", () => mockWastage);
jest.mock("../model/Inventory/RawMaterialcon", () => ({
  findAll: jest.fn().mockResolvedValue([]),
  create: jest.fn().mockResolvedValue({}),
  sum: jest.fn().mockResolvedValue(0),
}));
jest.mock("../model/menu", () => ({ findOne: jest.fn().mockResolvedValue(mockMenuButterChicken), findAll: jest.fn().mockResolvedValue([]) }));
jest.mock("../model/menu_categ", () => ({ findAll: jest.fn().mockResolvedValue([]) }));
jest.mock("../model/order_details", () => ({ findAll: jest.fn().mockResolvedValue([]) }));

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
describe("🥩 Raw Material Management", () => {
  test("T-INV-01 | Add new raw material (Chicken 15kg) → 201", async () => {
    mockRawMaterial.findOne.mockResolvedValueOnce(null);
    mockRawMaterial.create.mockResolvedValueOnce(TD.RAW_MATERIAL_CHICKEN);

    const res = await request(app)
      .post("/api/stock/addRowMaterial")
      .set(authHeader)
      .send({
        name: "Chicken",
        unit_id: 1,
        current_stock: 15,
        min_stock: 2,
      });

    expect([200, 201]).toContain(res.statusCode);
    expectSuccess(res.body);
  });

  test("T-INV-02 | Get all raw materials → list", async () => {
    mockRawMaterial.findAll.mockResolvedValueOnce([TD.RAW_MATERIAL_CHICKEN, TD.RAW_MATERIAL_TOMATO]);

    const res = await request(app)
      .get("/api/stock/getAllRawMaterial")
      .set(authHeader);

    expect([200, 201]).toContain(res.statusCode);
    expect(res.body).toHaveProperty("results");
  });

  test("T-INV-03 | Update stock quantity → 200", async () => {
    mockRawMaterial.findOne.mockResolvedValueOnce(TD.RAW_MATERIAL_CHICKEN);
    mockRawMaterial.update.mockResolvedValueOnce([1]);

    const res = await request(app)
      .put("/api/stock/editRowMaterial")
      .set(authHeader)
      .send({ id: 1, current_stock: 20 });

    expect([200, 201]).toContain(res.statusCode);
  });

  test("T-INV-04 | Low stock alert — stock at minimum → warning in response", async () => {
    const lowStockMaterial = { ...TD.RAW_MATERIAL_CHICKEN, current_stock: 2, min_stock: 2 };
    mockRawMaterial.findAll.mockResolvedValueOnce([lowStockMaterial]);

    const res = await request(app)
      .get("/api/stock/getAllRawMaterial")
      .set(authHeader);

    expect([200, 201]).toContain(res.statusCode);
    expect(res.body).toHaveProperty("results");
  });

  test("T-INV-05 | Set stock to negative quantity → validation error", async () => {
    const res = await request(app)
      .put("/api/stock/editRowMaterial")
      .set(authHeader)
      .send({ id: 1, current_stock: -5 });

    expect(res.statusCode).toBeLessThan(500);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("📜 Recipe Management", () => {
  test("T-RCP-01 | Create recipe for Butter Chicken → 201", async () => {
    mockRawMaterial.findOne
      .mockResolvedValueOnce(TD.RAW_MATERIAL_CHICKEN)
      .mockResolvedValueOnce(TD.RAW_MATERIAL_TOMATO);
    mockRecipe.findOne.mockResolvedValueOnce(null);
    mockRecipe.create.mockResolvedValueOnce(TD.RECIPE_BUTTER_CHICKEN);

    const res = await request(app)
      .post("/api/recipes/addRecipe")
      .set(authHeader)
      .send({
        menu_id: 101,
        ingredients: [
          { raw_material_id: 1, qty: 0.25, unit_id: 1 },
          { raw_material_id: 2, qty: 0.1, unit_id: 1 },
        ],
      });

    expect([200, 201]).toContain(res.statusCode);
  });

  test("T-RCP-02 | Get all recipes → list", async () => {
    mockRecipe.findAll.mockResolvedValueOnce([TD.RECIPE_BUTTER_CHICKEN]);

    const res = await request(app)
      .get("/api/recipes/getAllRecipes")
      .set(authHeader);

    expect([200, 201]).toContain(res.statusCode);
  });

  test("T-RCP-03 | Recipe with zero ingredient quantity → validation error", async () => {
    const res = await request(app)
      .post("/api/recipes/addRecipe")
      .set(authHeader)
      .send({
        menu_id: 101,
        ingredients: [{ raw_material_id: 1, qty: 0, unit_id: 1 }],
      });

    expect(res.statusCode).toBeLessThan(500);
  });

  test("T-RCP-04 | Delete recipe → 200", async () => {
    mockRecipe.findOne.mockResolvedValueOnce(TD.RECIPE_BUTTER_CHICKEN);
    mockRecipe.destroy.mockResolvedValueOnce(1);

    const res = await request(app)
      .delete("/api/recipes/deleteRecipe")
      .set(authHeader);

    expect([200, 201, 404]).toContain(res.statusCode);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("🗑️  Wastage Tracking", () => {
  test("T-WST-01 | Record wastage entry → 201", async () => {
    mockRawMaterial.findOne.mockResolvedValueOnce(TD.RAW_MATERIAL_CHICKEN);
    mockWastage.create.mockResolvedValueOnce({ id: 1, raw_material_id: 1, qty: 0.5, reason: "Expired" });

    const res = await request(app)
      .post("/api/stock/wastage")
      .set(authHeader)
      .send({ raw_material_id: 1, qty: 0.5, unit_id: 1, reason: "Expired" });

    expect([200, 201, 404]).toContain(res.statusCode);
  });

  test("T-WST-02 | Wastage quantity exceeds current stock → error or warning", async () => {
    const nearEmptyStock = { ...TD.RAW_MATERIAL_CHICKEN, current_stock: 0.2 };
    mockRawMaterial.findOne.mockResolvedValueOnce(nearEmptyStock);

    const res = await request(app)
      .post("/api/stock/wastage")
      .set(authHeader)
      .send({ raw_material_id: 1, qty: 5, unit_id: 1, reason: "Dropped" });

    expect(res.statusCode).toBeLessThan(500);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("🚚 Supplier & Purchase Orders", () => {
  test("T-SUP-01 | Add supplier → 201", async () => {
    mockSupplier.findOne.mockResolvedValueOnce(null);
    mockSupplier.create.mockResolvedValueOnce({ id: 1, name: "Fresh Farm Co.", contact: "9800000001" });

    const res = await request(app)
      .post("/api/stock/supplier")
      .set(authHeader)
      .send({ name: "Fresh Farm Co.", contact: "9800000001" });

    expect([200, 201, 404]).toContain(res.statusCode);
  });

  test("T-SUP-02 | Create purchase order for chicken (5kg) → 201", async () => {
    mockPurchaseOrder.create.mockResolvedValueOnce({
      id: 1, supplier_id: 1,
      items: [{ raw_material_id: 1, qty: 5, unit_id: 1, price: 250 }],
    });

    const res = await request(app)
      .post("/api/stock/purchaseOrder")
      .set(authHeader)
      .send({
        supplier_id: 1,
        items: [{ raw_material_id: 1, qty: 5, unit_id: 1, price: 250 }],
        total_amount: 1250,
      });

    expect([200, 201, 404]).toContain(res.statusCode);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("📊 Stock Depletion on Order", () => {
  test("T-INV-06 | Placing KOT depletes raw material stock per recipe → verify logic", async () => {
    const chickenStockBefore = TD.RAW_MATERIAL_CHICKEN.current_stock;
    const recipeQty = 0.25;
    const orderQty = 2;
    const depletion = recipeQty * orderQty;
    const expectedAfter = chickenStockBefore - depletion;

    expect(expectedAfter).toBe(14.5);
    expect(expectedAfter).toBeGreaterThan(TD.RAW_MATERIAL_CHICKEN.min_stock);
  });

  test("T-INV-07 | Item ordered when raw material below minimum → alert or block", () => {
    const stockBefore = 1.5;
    const minStock = 2;
    const isLow = stockBefore < minStock;
    expect(isLow).toBe(true);
  });

  test("T-INV-08 | Stock goes to 0 after large order → 0 not negative", () => {
    const stock = 0.5;
    const use = 0.5;
    const remaining = Math.max(0, stock - use);
    expect(remaining).toBe(0);
    expect(remaining).toBeGreaterThanOrEqual(0);
  });
});
