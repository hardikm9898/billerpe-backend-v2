const express = require("express")
var cors = require('cors');
const socketIO = require("socket.io");
const cron = require('node-cron');

const app = express()
require("dotenv").config()
const http = require("http")
const morgan = require("morgan")

const util = require('util');
const https = require("https");

const path = require("path")
const fs = require("fs")

const PORT = process.env.PORT || 443

const { sequelize } = require("./model")

const { error } = require("./responce/res");
const logger = require("./utils/logger");
const { STATUSCODE, MESSAGE } = require("./constant/const");
const cookieParser = require('cookie-parser');
const hotelRoutes = require("./routes/hotel")
const routes = require("./routes/index")
const stockRoutes = require("./routes/stock");

const { initializeSocket } = require("./connection/socket");
const Testing = require("./model/testing");
const redisClient = require("./connection/redis");
const { sendMessageToNajeria, checkAndSendClosingSummaries } = require("./controller/smsService");
const { runAutomationRules } = require("./services/crm/automationEngine");
const helmet = require('helmet');

const { insertDefaultRestaurantSettings } = require("./controller/hotel");
const { deleteOldTimeline } = require("./services/syncIndexdb");

const blockedIPs = ['34.44.199.110', '138.197.43.189', '172.31.20.60'];

/* --------------------------
   1. HELMET – LOAD FIRST
--------------------------- */
app.use(
    helmet({
        frameguard: { action: "sameorigin" },
        noSniff: true,
        referrerPolicy: { policy: "no-referrer-when-downgrade" },
        hsts: false  // ALB handles HTTPS; do not duplicate
    })
);

// Allow images, fonts, static assets cross origin
app.use(
    helmet.crossOriginResourcePolicy({
        policy: "cross-origin",
    })
);

/* ---------------------------------
   2. ADD ALL MISSING SECURITY HEADERS
---------------------------------- */
app.use((req, res, next) => {

    // ⭐ HSTS must still be sent even if HTTPS terminates at ALB
    res.setHeader(
        "Strict-Transport-Security",
        "max-age=31536000; includeSubDomains; preload"
    );

    // ⭐ CSP — safest default, will not break your site
    res.setHeader(
        "Content-Security-Policy",
        "default-src 'self' https: http: data: blob: ws:; " +
        "script-src 'self' 'unsafe-inline' 'unsafe-eval' https:; " +
        "style-src 'self' 'unsafe-inline' https:; " +
        "img-src * data: blob:; " +
        "connect-src *; frame-ancestors 'self';"
    );

    // X-Frame already from helmet but keep for scanner
    res.setHeader("X-Frame-Options", "SAMEORIGIN");

    // X-Content-Type-Options already set, but keep to avoid scanner false-positive
    res.setHeader("X-Content-Type-Options", "nosniff");

    // Permissions-Policy
    res.setHeader(
        "Permissions-Policy",
        "geolocation=(), microphone=(), camera=(), payment=()"
    );

    next();
});

/* ---------------------------------
   3. BLOCKED IP CHECK
---------------------------------- */
app.use((req, res, next) => {
    const ip = (
        req.headers['x-forwarded-for']?.split(',')[0].trim() ||
        req.socket?.remoteAddress ||
        ''
    ).replace(/^::ffff:/, '');
    if (blockedIPs.includes(ip)) {
        return res.status(403).send('Access denied');
    }
    next();
});

app.use(morgan('tiny'))
app.use(cookieParser());

/* ---------------------------------
   4. STATIC FILES (after security headers)
---------------------------------- */
app.use(express.static("public"))

/* ---------------------------------
   5. CORS
---------------------------------- */
app.use(
    cors({
        origin: [
            process.env.SOCKET_URL,
            "http://localhost:8080",
            process.env.WEBSITE_URL,
            "http://127.0.0.1:5504",
            "https://www.billerpe.com",
            "https://billerpe.com",
            "https://pos.billerpe.com",
            "http://127.0.0.1:5505",
            "http://192.168.1.12:8080",
            "ws://192.168.1.18:3000",
            "http://localhost:3000",
            "http://localhost:8080",
            "http://localhost:8081"
        ].filter(Boolean),
        credentials: true
    })
);
app.options("*", cors());

/* ---------------------------------
   6. BODY PARSER
---------------------------------- */

app.use(express.json({ limit: "5mb", verify: (req, _res, buf) => { req.rawBody = buf }}))
app.use(express.urlencoded({ limit: "5mb", extended: true }))


/* ---------------------------------
   7. ROUTES
---------------------------------- */
app.get("/any/:filename", (req, res) => {
    const pdfDir = path.join(__dirname, "public", "pdf");
    const { filename } = req.params;
    const filePath = path.join(pdfDir, `${filename}`);

    if (fs.existsSync(filePath)) {
        res.sendFile(filePath);
    } else {
        res.status(404).send("PDF not found");
    }
});

app.get("/", async (req, res) => {
    res.send(`server running ${process.env.PORT} port`)
})

app.use("/", routes)

app.use((req, res) => {
    return res.json(error(MESSAGE.PAGE_NOT_FOUND, STATUSCODE.NOT_FOUND))
})

app.use((err, req, res, next) => {
    logger.error("Unhandled error", { message: err.message, stack: err.stack });

    if (err instanceof SyntaxError && err.type === 'entity.parse.failed') {
        return res.json(error('Invalid request', STATUSCODE.INTERNAL_SERVER_ERROR))
    }

    const status = err.status || 500;
    const message = status === 500 ? 'Internal Server Error' : err.message || 'Error';

    return res.json(error(message, STATUSCODE.INTERNAL_SERVER_ERROR))
});

/* ---------------------------------
   8. SOCKET.IO
---------------------------------- */
const server = http.createServer(app);
var { io, kdsNamespace } = initializeSocket(server)
global.kdsNamespace = kdsNamespace
global.io = io

/* ---------------------------------
   9. SERVER START
---------------------------------- */


server.listen(PORT, (err) => {

    if (err) {
        logger.error("Server failed to start", { err: err.message });
        return;
    }


    // console.log(models, "All Models =====>")

    async function syncDatabase() {
        try {
            // Tables that must NOT receive ALTER TABLE (production-safe)
            const TABLES_TO_SKIP_ALTER = [
                // POS App (Plan 2): schema owned by migration 20260926100000.
                "app_devices", "app_client_keys", "app_queue_entries", "app_alerts", "hms_stock_movements",
                "hms_res_settings",
                'hms_menu_msts',
                'hms_recipes_msts',
                "hms_semi_finished_items_msts",
                "hms_semi_finished_recipes_msts",
                "hms_semi_finished_stocks",
                'hms_order_msts',
                'wa_agent_messages',
                'wa_agent_conversations',
                


                "hms_ebillCreditDebit_msts",
                'hms_ebillCredit_msts',
                "franchise_orders",
                "franchise_order_items",
                'hms_sync_index_msts',
                'hms_purchase_orders',
                'hms_purchase_rawMaterials',
                'hms_due_payment_receives',
                'hms_expense_entry_msts',
                'hms_stock_history_msts',
                'hms_raw_material_consumptions',
                'hms_watage_msts',
                'hms_opening_closing_msts',
                'hms_raise_ticket_msts',
                'hotel_registrations',
                // Holds the generated active_hotel_id column + its unique
                // index (migration 20260829123343) that enforces "one
                // active local server per restaurant" - an auto ALTER could
                // touch or drop that column, so this table is provisioned
                // by its migration only, never by boot-time sync.
                'local_server_registrations',
                // Unique index on `version` (migration 20260917120000) that
                // boot-time alter:true does not know about, same reasoning
                // as local_server_registrations directly above - provisioned
                // by its migration only.
                'web_bundles',
                // Indexes owned by migration 20260920100000.
                'hms_qr_session_msts',
                'hms_user_masters',
                'hms_whatsapp_template_msts',
                'hms_website_user_msts',
                'hms_website_products',
                'hms_temp_website_purchase_mst',
                'role_msts',
                'hms_user_accesses',
                'hms_table_categs',
                'hms_table_msts',
                'hms_printer_settings',
                'hms_menu_categs',
                'hms_hotelUser_masters',
                'hms_variant_msts',
                'hms_orderDetails',
                'AdminCarts',
                'hms_tableBooking_msts',
                'hms_invoice_formate_msts',
                'hms_online_orderDetails_msts',
                'hms_online_order_msts',
                'hms_unit_msts',
                'hms_rawMaterial_msts',
                'hms_stock_in_hand_msts',
                'hms_expense_head_msts',
                'hms_menu_variant_msts',
                'hms_testing_msts',
                'hms_addon_msts',
                'hms_addon_department_msts',
                'hms_menu_addon_msts',
                'hms_serviceCharge_msts',
                'hms_promo_codes',
                'hms_suppliers',
                'hms_purchase_payments',
                'hms_kitchen_settings',
                'hms_timeline_msts',
                'hms_tax_type_msts',
                'hms_order_tax_msts',
                'hms_subscription_payments',
                'hms_subscription_msts',
                'phone_pay_payment_links',
                'hms_plan_msts',
                'hms_admin_save_msts',
                'hms_merchant_msts',
                'hms_carts',
                'hms_purchase_roll_mst',
                'hms_discount_codes',
                'hms_image_msts',
                'AppUpdates',
                'user_sessions',
                'hms_superAdmin_users',

                // CRM tables are FK-linked to each other (tasks/calls/demos/payments/automation
                // logs all reference crm_lead_msts, which references crm_employee_profile_msts).
                // Running `alter: true` concurrently via Promise.all races for MySQL metadata
                // locks across those linked tables and deadlocks (seen on crm_lead_msts and
                // crm_employee_profile_msts alike — it just shifts to whichever table loses the
                // race). Schema is stable now, so sync these like the other production tables
                // above; bring a table back to `alter` mode temporarily if it needs a migration.
                'crm_lead_msts',
                'crm_employee_profile_msts',
                'crm_lead_activity_msts',
                'crm_lead_assignment_history_msts',
                'crm_task_msts',
                'crm_call_log_msts',
                'crm_demo_schedule_msts',
                'crm_payment_tracking_msts',
                'crm_whatsapp_campaign_msts',
                'crm_campaign_recipient_msts',
                'crm_automation_rule_msts',
                'crm_automation_log_msts',
                'crm_notification_msts',
                'crm_meta_lead_sync_log_msts'
            ];

            // const models = Object.values(sequelize.models);

            // await Promise.all(
            //     models.map(model => {
            //         const tableName = model.getTableName();
            //         const shouldAlter = !TABLES_TO_SKIP_ALTER.includes(tableName);

            //         if (!shouldAlter) {
            //             logger.info(`Syncing ${tableName} WITHOUT alter (production-safe)`);
            //             // Temporarily remove indexes from model so sync() doesn't touch them
            //             const originalIndexes = model.options.indexes;
            //             model.options.indexes = [];
            //             return model.sync({ force: false }).finally(() => {
            //                 // Restore indexes after sync so rest of app still works
            //                 model.options.indexes = originalIndexes;
            //             });
            //         } else {
            //             logger.warn(`Syncing ${tableName} WITH alter`);
            //             return model.sync({ alter: true });
            //         }
            //     })
            // );
            // Patch addIndex to silently skip blocked tables
            const qi = sequelize.getQueryInterface();
            const originalAddIndex = qi.addIndex.bind(qi);

            qi.addIndex = async function (tableName, ...args) {
                const tName = typeof tableName === 'object' ? tableName.tableName : tableName;
                if (TABLES_TO_SKIP_ALTER.includes(tName)) {
                    logger.info(`BLOCKED addIndex on ${tName} (production-safe)`);
                    return; // silently skip
                }
                return originalAddIndex(tableName, ...args);
            };

            // Also patch removeIndex for safety
            const originalRemoveIndex = qi.removeIndex.bind(qi);
            qi.removeIndex = async function (tableName, ...args) {
                const tName = typeof tableName === 'object' ? tableName.tableName : tableName;
                if (TABLES_TO_SKIP_ALTER.includes(tName)) {
                    logger.info(`BLOCKED removeIndex on ${tName} (production-safe)`);
                    return;
                }
                return originalRemoveIndex(tableName, ...args);
            };

            try {
                const models = Object.values(sequelize.models);

                // SFI models must sync sequentially (in dependency order) to avoid FK deadlocks
                const SFI_SEQUENTIAL = [
                    'hms_semi_finished_items_msts',
                    'hms_semi_finished_recipes_msts',
                    'hms_semi_finished_stocks',
                ];

                const syncModel = (model) => {
                    const tableName = model.getTableName();
                    const shouldAlter = !TABLES_TO_SKIP_ALTER.includes(tableName);
                    if (!shouldAlter) {
                        logger.info(`Syncing ${tableName} WITHOUT alter (production-safe)`);
                        return model.sync({ force: false });
                    }
                    logger.warn(`Syncing ${tableName} WITH alter`);
                    return model.sync({ alter: true });
                };

                // ~100 models are created CONCURRENTLY below, but several
                // carry a foreign key to another model in the same batch -
                // whichever one runs first has no guarantee its parent's
                // CREATE TABLE has landed yet. Confirmed live, 2026-09-18: a
                // fresh database repeatedly lost this race on different
                // tables each attempt (hms_user_accesses -> hms_hotelUser_
                // masters, hms_purchase_rawMaterials -> hms_purchase_orders,
                // hms_recipes_msts never created at all), and the failure
                // was invisible - MySQL's error was logged, then a SECOND,
                // unconditional "completed successfully" line printed right
                // after it regardless, so a boot that silently left tables
                // missing read as a clean success in every log.
                //
                // A real dependency-ordered creation would need walking
                // every model's association graph - not done here. A short
                // retry is far cheaper and handles the actual failure mode:
                // the parent typically finishes within the same batch a
                // moment later, so trying again shortly after almost always
                // succeeds once every other CREATE TABLE has had a turn.
                // Also covers ER_LOCK_DEADLOCK (1213) - confirmed live,
                // 2026-09-18: concurrent `alter: true` across FK-linked
                // tables can deadlock on MySQL metadata locks the same way
                // the CRM tables did (see the comment above
                // TABLES_TO_SKIP_ALTER) even outside that specific table
                // set - e.g. hms_payment_mode_default_msts,
                // hms_requisition_item_msts, hms_cashMovement_msts each
                // failed this way on the same boot. MySQL's own guidance is
                // that a deadlocked transaction is expected to be retried,
                // and it clears the same way the FK race does: whichever
                // other ALTER was holding the conflicting lock has usually
                // finished by the next attempt.
                const isMissingParentRace = (err) => {
                    const code = err?.parent?.code || err?.original?.code;
                    return code === 'ER_FK_CANNOT_OPEN_PARENT'
                        || code === 'ER_CANNOT_ADD_FOREIGN'
                        || code === 'ER_LOCK_DEADLOCK'
                        || code === 'ER_LOCK_WAIT_TIMEOUT';
                };
                const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
                const syncModelWithRetry = async (model, attempts = 5) => {
                    for (let attempt = 1; ; attempt++) {
                        try {
                            return await syncModel(model);
                        } catch (err) {
                            if (!isMissingParentRace(err) || attempt >= attempts) throw err;
                            logger.warn(
                                `Sync race on ${model.getTableName()} (attempt ${attempt}/${attempts}) - `
                                + `retrying: ${err.parent?.message || err.message}`,
                            );
                            await sleep(300 * attempt);
                        }
                    }
                };

                const parallelModels = models.filter(m => !SFI_SEQUENTIAL.includes(m.getTableName()));
                const sequentialModels = SFI_SEQUENTIAL
                    .map(tbl => models.find(m => m.getTableName() === tbl))
                    .filter(Boolean);

                const results = await Promise.allSettled(parallelModels.map((m) => syncModelWithRetry(m)));
                const failures = results
                    .map((r, i) => (r.status === 'rejected' ? { table: parallelModels[i].getTableName(), err: r.reason } : null))
                    .filter(Boolean);

                for (const model of sequentialModels) {
                    await syncModelWithRetry(model);
                }

                if (failures.length) {
                    // Loud and specific on purpose - this used to be a
                    // silent gap between an error line and an unconditional
                    // "success" line right after it, discovered only when a
                    // migration or a request against one of these tables
                    // failed with no obvious connection back to boot.
                    for (const f of failures) {
                        logger.error(`Sync FAILED for ${f.table} after retries`, { err: f.err?.parent?.message || f.err?.message });
                    }
                    logger.error(`Database sync completed WITH ${failures.length} FAILED TABLE(S) - see above`);
                } else {
                    logger.info('Database sync completed successfully');
                }
            } catch (err) {
                console.log(err);
                logger.error("Error syncing database", { err: err.message });
            } finally {
                // Always restore original methods
                qi.addIndex = originalAddIndex;
                qi.removeIndex = originalRemoveIndex;
            }
        } catch (err) {
            console.log(err)
            logger.error("Error syncing database", { err: err.message });
        }
    }

    syncDatabase();
    cron.schedule(
        '29 4 * * *',
        () => {
            sendMessageToNajeria();
            logger.info('Cron: sendMessageToNajeria executed', { timezone: 'Asia/Kolkata' });
        },
        { timezone: 'Asia/Kolkata' }
    );
    cron.schedule('* * * * *', async () => {
        try {
            await checkAndSendClosingSummaries();
        } catch (err) {
            logger.error('Cron: checkAndSendClosingSummaries failed', { err: err.message });
        }
    });
    cron.schedule("0 3 * * *", async () => {
        console.log("Running timeline cleanup cron...");
        deleteOldTimeline();
        console.log("Running timeline cleanup cron... deleted");

    });
    // cron.schedule(
    //     '*/30 * * * *',
    //     async () => {
    //         try {
    //             await runAutomationRules();
    //             logger.info('Cron: runAutomationRules executed', { timezone: 'Asia/Kolkata' });
    //         } catch (err) {
    //             logger.error('Cron: runAutomationRules failed', { err: err.message });
    //         }
    //     },
    //     { timezone: 'Asia/Kolkata' }
    // );
    
    redisClient.connect()
        .then(() => logger.info("Redis connected"))
        .catch(err => logger.error("Redis connection failed", { err: err.message }));

    logger.info(`Server running on port ${PORT}`);
});

