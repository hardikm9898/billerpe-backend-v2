const jwt = require("jsonwebtoken");

// ─────────────────────────────────────────────────────────────────────────────
// Token generation for different roles
// ─────────────────────────────────────────────────────────────────────────────

const SECRETS = {
  admin: process.env.JWT_SECRET_KEY_ADMIN || "test_admin_secret_key_for_jest",
  user: process.env.JWT_SECRET_KEY_USER || "test_user_secret_key_for_jest",
  captain: process.env.JWT_SECRET_KEY_CAPTAIN || "test_captain_secret_key_for_jest",
  superAdmin: process.env.JWT_SECRET_KEY_SUPER_ADMIN || "test_super_admin_secret_key",
};

const generateAdminToken = (userId = 10, extra = {}) =>
  jwt.sign({ id: userId, ...extra }, SECRETS.admin, { expiresIn: "1h" });

const generateCaptainToken = (userId = 11) =>
  jwt.sign({ id: userId }, SECRETS.captain, { expiresIn: "1h" });

const generateUserToken = (userId = 20) =>
  jwt.sign({ id: userId }, SECRETS.user, { expiresIn: "1h" });

const generateExpiredToken = (userId = 10) =>
  jwt.sign({ id: userId }, SECRETS.admin, { expiresIn: "-1s" });

const generateMobileToken = (userId = 12) =>
  jwt.sign({ id: userId }, SECRETS.admin, { expiresIn: "1h" });

// ─────────────────────────────────────────────────────────────────────────────
// Auth header helpers
// ─────────────────────────────────────────────────────────────────────────────

const adminAuthHeader = (token) => ({ Authorization: `Bearer ${token}` });
const mobileAuthHeader = (token) => ({ cookies: `token=${token}` });

// ─────────────────────────────────────────────────────────────────────────────
// Response shape validators
// ─────────────────────────────────────────────────────────────────────────────

const expectSuccess = (body) => {
  expect(body).toHaveProperty("error", false);
  expect(body).toHaveProperty("results");
  expect([200, 201, 202]).toContain(body.code);
};

const expectError = (body) => {
  expect(body).toHaveProperty("error", true);
  expect(body).toHaveProperty("results");
  expect(body.results).toHaveProperty("message");
};

const expectUnauthorized = (body) => {
  expect(body).toHaveProperty("error", true);
  expect([401, 403, 422]).toContain(body.code);
};

// ─────────────────────────────────────────────────────────────────────────────
// Common mock factory — returns a Sequelize-like model mock
// ─────────────────────────────────────────────────────────────────────────────

const mockModel = (defaults = {}) => ({
  findOne: jest.fn().mockResolvedValue(defaults),
  findAll: jest.fn().mockResolvedValue(defaults ? [defaults] : []),
  create: jest.fn().mockResolvedValue({ ...defaults, id: defaults.id || 9999 }),
  update: jest.fn().mockResolvedValue([1]),
  destroy: jest.fn().mockResolvedValue(1),
  bulkCreate: jest.fn().mockResolvedValue([defaults]),
  count: jest.fn().mockResolvedValue(1),
  sum: jest.fn().mockResolvedValue(0),
  findAndCountAll: jest.fn().mockResolvedValue({ count: 1, rows: [defaults] }),
});

// ─────────────────────────────────────────────────────────────────────────────
// Date helpers for report tests
// ─────────────────────────────────────────────────────────────────────────────

const today = () => new Date().toISOString().split("T")[0];
const yesterday = () => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().split("T")[0];
};
const lastMonthStart = () => {
  const d = new Date();
  d.setMonth(d.getMonth() - 1, 1);
  return d.toISOString().split("T")[0];
};

// ─────────────────────────────────────────────────────────────────────────────
// Tax calculation helper — mirrors backend logic
// ─────────────────────────────────────────────────────────────────────────────

const calcTax = (amount, taxPercent) =>
  parseFloat(((amount * taxPercent) / 100).toFixed(2));

const calcGST = (amount, gst) => {
  const cgst = calcTax(amount, gst / 2);
  const sgst = calcTax(amount, gst / 2);
  return { cgst, sgst, total: cgst + sgst };
};

// ─────────────────────────────────────────────────────────────────────────────
// Bill total calculator
// ─────────────────────────────────────────────────────────────────────────────

const calcBillTotal = (items, taxPercent = 5, serviceChargePercent = 0, discount = 0) => {
  const subtotal = items.reduce((sum, i) => sum + i.price * i.qty, 0);
  const afterDiscount = subtotal - discount;
  const serviceCharge = (afterDiscount * serviceChargePercent) / 100;
  const taxable = afterDiscount + serviceCharge;
  const tax = calcTax(taxable, taxPercent);
  return {
    subtotal,
    discount,
    serviceCharge: parseFloat(serviceCharge.toFixed(2)),
    tax: parseFloat(tax.toFixed(2)),
    total: parseFloat((taxable + tax).toFixed(2)),
  };
};

module.exports = {
  generateAdminToken,
  generateCaptainToken,
  generateUserToken,
  generateExpiredToken,
  generateMobileToken,
  adminAuthHeader,
  mobileAuthHeader,
  expectSuccess,
  expectError,
  expectUnauthorized,
  mockModel,
  today,
  yesterday,
  lastMonthStart,
  calcTax,
  calcGST,
  calcBillTotal,
  SECRETS,
};
