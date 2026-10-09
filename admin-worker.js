// BillerPe SuperAdmin worker: runs the event log and job queue
// (services/admin/worker.js). Start it as its own process next to the API:
//
//   pm2 start admin-worker.js --name billerpe-admin-worker
//
// Later phases send real WhatsApp messages from here, so - like the API's
// crons - it refuses to run on a test database or with DISABLE_CRON=1
// (ADMIN_WORKER_FORCE=1 overrides that for a local test on purpose).

require("dotenv").config();
const logger = require("./utils/logger");

const jobsOff = process.env.DISABLE_CRON === "1" || /_test$/.test(process.env.DATABASE_NAME || "");
if (jobsOff && process.env.ADMIN_WORKER_FORCE !== "1") {
    logger.info("Admin worker NOT started: test database or DISABLE_CRON=1 (set ADMIN_WORKER_FORCE=1 to run it anyway)");
    process.exit(0);
}

const worker = require("./services/admin/worker");
// Job handlers and schedules of each SuperAdmin module.
require("./adminv1/crm/jobs");
require("./adminv1/crm/ai");
require("./adminv1/crm/automation");
require("./adminv1/crm/cadences");
require("./adminv1/crm/campaigns");
require("./adminv1/crm/escalations");
require("./adminv1/crm/digest");
require("./adminv1/cs/health");
require("./adminv1/bil/payments");
require("./adminv1/bil/renewals");
require("./adminv1/sup/jobs");
require("./adminv1/bil/hardware");
require("./adminv1/cs/freeze");

const log = { info: (...a) => logger.info(a.join(" ")), error: (...a) => logger.error(a.join(" ")) };
// Built-in rules and cadences exist before the first event is handled.
Promise.all([require("./adminv1/crm/automation").ensureDefaults(), require("./adminv1/crm/cadences").ensureDefaults()]).catch((e) => log.error("defaults:", e && e.message));
worker.start(Number(process.env.ADMIN_WORKER_INTERVAL_MS) || 2000, log);
logger.info(`Admin worker started (${worker.WORKER})`);

const shutdown = () => {
    worker.stop();
    logger.info("Admin worker stopped");
    setTimeout(() => process.exit(0), 200);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
