/**
 * Lightweight Express app for testing.
 * Mirrors server.js setup but skips HTTPS, socket.io, Redis, and cron.
 * All DB models are mocked per-test-file using jest.mock().
 */
const express = require("express");
const cookieParser = require("cookie-parser");

const createTestApp = () => {
  const app = express();
  app.use(express.json({ limit: "5mb" }));
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());

  // Mount all routes (models are mocked by jest.mock in each test file)
  const routes = require("../../routes/index");
  app.use("/api", routes);

  // 404 handler
  app.use((req, res) => {
    res.status(404).json({ error: true, results: { message: "Not Found" }, code: 404 });
  });

  // Error handler
  app.use((err, req, res, next) => {
    if (err.type === "entity.too.large") {
      return res.status(413).json({ error: true, results: { message: "Payload too large" }, code: 413 });
    }
    res.status(500).json({ error: true, results: { message: err.message }, code: 500 });
  });

  return app;
};

module.exports = { createTestApp };
