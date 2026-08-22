"use strict";

// Baseline migration marking the point migrations were adopted in this
// project. The schema at this point was managed by
// `sequelize.sync({ alter: true })` at boot (server.js) plus ad-hoc scripts
// (manual_alter.js, fix.js) - not by any migration tool - so there is
// nothing to create here; the tables already exist. Every schema change
// from this point forward should be a new migration file
// (`npx sequelize-cli migration:generate --name <description>`), applied
// via `npx sequelize-cli db:migrate`, not another manual_alter.js/fix.js
// run or by editing model/*.js and letting boot-time sync pick it up.
//
// This baseline was captured against a LOCAL development database only -
// it has not been verified against the production schema, since this work
// was done without production access. Before this migration history is
// treated as authoritative for production, someone with production access
// needs to diff the live production schema against `model/*.js` (the same
// check `manual_alter.js` already does, just pointed at prod) and add a
// follow-up migration for anything that's actually different there.
module.exports = {
  async up() {
    // Intentionally no-op - see comment above.
  },
  async down() {
    throw new Error("The baseline migration cannot be reverted.");
  },
};
