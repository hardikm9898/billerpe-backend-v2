#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  BillerPE POS — Master Test Runner
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  Usage:
 *    node tests/run-tests.js            → run all test suites
 *    node tests/run-tests.js auth       → run only auth tests
 *    node tests/run-tests.js orders     → run dineIn + takeaway + payment
 *    node tests/run-tests.js edge       → run edge case suites
 *    node tests/run-tests.js mobile     → run mobile tests
 *    node tests/run-tests.js coverage   → run all + generate coverage report
 *    node tests/run-tests.js --watch    → watch mode (re-run on file change)
 *
 *  Test suite groups:
 *    auth      → auth.test.js
 *    menu      → menu.test.js
 *    tables    → tables.test.js
 *    orders    → dineIn.test.js, takeaway.test.js, payment.test.js
 *    kds       → kds.test.js
 *    inventory → inventory.test.js
 *    reports   → reports.test.js
 *    mobile    → mobile.test.js
 *    integration → fullOrderFlow.test.js
 *    edge      → restaurant-scenarios.test.js, security.test.js
 *    all       → everything (default)
 */

const { execSync } = require("child_process");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const JEST = path.join(ROOT, "node_modules", ".bin", "jest");

const GROUPS = {
  auth:        ["tests/auth.test.js"],
  menu:        ["tests/menu.test.js"],
  tables:      ["tests/tables.test.js"],
  orders:      ["tests/orders/dineIn.test.js", "tests/orders/takeaway.test.js", "tests/orders/payment.test.js"],
  kds:         ["tests/kds.test.js"],
  inventory:   ["tests/inventory.test.js"],
  reports:     ["tests/reports.test.js"],
  mobile:      ["tests/mobile.test.js"],
  integration: ["tests/integration/fullOrderFlow.test.js"],
  edge:        ["tests/edge-cases/restaurant-scenarios.test.js", "tests/edge-cases/security.test.js"],
  all:         [], // empty = run everything
};

const args = process.argv.slice(2);
const group = args.find((a) => !a.startsWith("--")) || "all";
const isCoverage = args.includes("coverage");
const isWatch = args.includes("--watch");
const isVerbose = !args.includes("--quiet");

const testFiles = GROUPS[group] || GROUPS.all;

let cmd = `"${JEST}"`;

if (testFiles.length > 0) {
  // Run specific files
  cmd += ` ${testFiles.join(" ")}`;
} else {
  // Run all tests via pattern
  cmd += ` --testMatch="**/tests/**/*.test.js"`;
}

if (isCoverage) cmd += " --coverage";
if (isWatch)    cmd += " --watch";
if (isVerbose)  cmd += " --verbose";

// Force exit after tests complete (avoids hanging on open handles)
cmd += " --forceExit --detectOpenHandles";

// Environment
process.env.NODE_ENV = "test";
if (!process.env.JWT_SECRET_KEY_ADMIN) process.env.JWT_SECRET_KEY_ADMIN = "test_admin_secret_key_for_jest";
if (!process.env.JWT_SECRET_KEY_USER)  process.env.JWT_SECRET_KEY_USER  = "test_user_secret_key_for_jest";
if (!process.env.JWT_SECRET_KEY_CAPTAIN) process.env.JWT_SECRET_KEY_CAPTAIN = "test_captain_secret_key_for_jest";
if (!process.env.DESECRET_KEY)        process.env.DESECRET_KEY          = "test_des_secret_key";

console.log("\n╔══════════════════════════════════════════════════════════╗");
console.log(`║  BillerPE POS Test Runner — Suite: ${group.padEnd(22)}║`);
console.log(`║  Coverage: ${isCoverage ? "YES" : "NO "} | Watch: ${isWatch ? "YES" : "NO "} | Files: ${testFiles.length || "all"}${" ".repeat(16)}║`);
console.log("╚══════════════════════════════════════════════════════════╝\n");

try {
  execSync(cmd, { stdio: "inherit", cwd: ROOT });
  console.log("\n✅  All tests passed.\n");
} catch (err) {
  console.error("\n❌  Some tests failed. Review output above.\n");
  process.exit(1);
}
