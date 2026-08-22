const Sequencer = require("@jest/test-sequencer").default;

// Run tests in a logical restaurant-operations order
const ORDER = [
  "auth.test.js",
  "menu.test.js",
  "tables.test.js",
  "dineIn.test.js",
  "takeaway.test.js",
  "payment.test.js",
  "kds.test.js",
  "inventory.test.js",
  "reports.test.js",
  "mobile.test.js",
  "fullOrderFlow.test.js",
  "splitBill.test.js",
  "restaurant-scenarios.test.js",
  "payment-edge-cases.test.js",
  "security.test.js",
];

class CustomSequencer extends Sequencer {
  sort(tests) {
    return tests.sort((a, b) => {
      const aName = a.path.split(/[/\\]/).pop();
      const bName = b.path.split(/[/\\]/).pop();
      const aIdx = ORDER.indexOf(aName);
      const bIdx = ORDER.indexOf(bName);
      if (aIdx === -1 && bIdx === -1) return 0;
      if (aIdx === -1) return 1;
      if (bIdx === -1) return -1;
      return aIdx - bIdx;
    });
  }
}

module.exports = CustomSequencer;
