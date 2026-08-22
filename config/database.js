// sequelize-cli config, mirroring connection/connect.js's env vars so the
// CLI targets the exact same database the app itself connects to - no
// separate config.json with its own credentials to drift out of sync.
require("dotenv").config();

const shared = {
  username: process.env.DATABASE_ID,
  password: process.env.DATABASE_PASSWORD,
  database: process.env.DATABASE_NAME,
  host: process.env.DATABASE_HOST,
  dialect: process.env.DATABASE_DIALECT || "mysql",
  logging: false,
};

module.exports = {
  development: shared,
  test: shared,
  production: shared,
};
