/**
 * Copies ALL data belonging to a single hotel_id from the LIVE database into
 * the UAT database, keeping the SAME hotel_id (the hotel's own identity), but
 * assigning NEW primary keys to every child row it owns (orders, menu items,
 * tables, users, etc).
 *
 * Why new PKs: UAT already holds dozens of other hotels sharing the same
 * auto-increment id space per table (LIVE and UAT have diverged
 * independently), so re-using LIVE's exact row ids would collide with other
 * hotels' existing UAT rows. Every foreign key that points at a remapped
 * table is rewritten to the new id, mirroring what this repo's own
 * cloneMenu.js / cloneStock.js already do for a smaller subset of tables.
 *
 * Only tables that actually contain rows for this hotel are touched (checked
 * live against the LIVE database at the top of TABLE_DEFS' processing loop).
 *
 * Usage:
 *   node migrateHotelToUat.js            (defaults to hotel 127)
 *   node migrateHotelToUat.js 127
 *
 * Safe to re-run: every table is DELETEd for this hotel_id only, then
 * re-inserted from LIVE with freshly allocated ids. No other hotel's rows
 * are ever read, deleted, or touched.
 */

const mysql = require("mysql2/promise");

const HOTEL_ID = Number(process.argv[2] || 127);

const LIVE_DB = {
    host: "db.billerpe.com",
    user: "bipin",
    password: "Bipin@$121",
    database: "hms_demo",
};

const UAT_DB = {
    host: "ec2-13-233-159-147.ap-south-1.compute.amazonaws.com",
    user: "hardik",
    password: "H@rd!k",
    database: "live_backup1",
};

const BATCH_FETCH = 5000;
const BATCH_INSERT = 500;

const fk = (col, refTable, opts = {}) => ({ col, refTable, shared: false, ...opts });
const sharedFk = (col, refTable) => ({ col, refTable, shared: true });

// Topologically ordered: every table appears after every table it points to.
const TABLE_DEFS = [
    { table: "role_msts", pk: "role_cd", fks: [] },
    { table: "hms_table_categs", pk: "id", fks: [] },
    { table: "hms_table_msts", pk: "id", fks: [fk("table_catag_id", "hms_table_categs")] },
    { table: "hms_hotelUser_masters", pk: "id", fks: [fk("role_cd", "role_msts")] },
    { table: "hms_user_accesses", pk: "id", fks: [fk("hotelUser_id", "hms_hotelUser_masters")] },
    { table: "hms_menu_categs", pk: "id", fks: [] },
    { table: "hms_menu_msts", pk: "id", fks: [fk("menu_categ_id", "hms_menu_categs")] },
    { table: "hms_variant_msts", pk: "id", fks: [] },
    { table: "hms_menu_variant_msts", pk: "id", fks: [fk("menu_id", "hms_menu_msts"), fk("variant_id", "hms_variant_msts")] },
    { table: "hms_printer_settings", pk: "id", fks: [fk("menu_categ_id", "hms_menu_categs")] },
    { table: "hms_invoice_formate_msts", pk: "id", fks: [] },
    { table: "hms_res_settings", pk: "id", fks: [] },
    { table: "hms_sync_index_msts", pk: "id", fks: [] },
    { table: "hms_tax_type_msts", pk: "id", fks: [] },
    { table: "hms_user_masters", pk: "id", fks: [] },
    { table: "hms_subscription_msts", pk: "id", fks: [sharedFk("plan_id", "hms_plan_msts")] },
    { table: "hms_subscription_payments", pk: "id", fks: [fk("subscription_id", "hms_subscription_msts"), sharedFk("purchase_printer_id", "hms_purchase_roll_mst")] },
    { table: "phone_pay_payment_links", pk: "id", fks: [sharedFk("plan_id", "hms_plan_msts"), sharedFk("printer_roll_id", "hms_purchase_roll_mst"), sharedFk("temp_hotel_id", "hms_temp_website_purchase_mst")] },
    { table: "hms_order_msts", pk: "id", fks: [fk("TableId", "hms_table_msts"), fk("UserId", "hms_user_masters"), fk("hotelUserId", "hms_hotelUser_masters")], forceIndex: "HotelId" },
    { table: "hms_orderDetails", pk: "id", fks: [fk("orderId", "hms_order_msts"), fk("UserId", "hms_user_masters"), fk("TableId", "hms_table_msts"), fk("MenuId", "hms_menu_msts"), fk("variant_id", "hms_variant_msts")], forceIndex: "IND_HID_MID_OID_PS_STAT" },
    { table: "hms_order_tax_msts", pk: "id", fks: [fk("hmsOrderMstId", "hms_order_msts"), fk("hmsTaxTypeMstId", "hms_tax_type_msts")], forceIndex: "hotel_id" },
    { table: "hms_timeline_msts", pk: "id", fks: [fk("TableId", "hms_table_msts"), fk("hotelUserId", "hms_hotelUser_masters"), fk("order_id", "hms_order_msts")], forceIndex: "hotel_id" },
];

// Tables already fully (and verifiably) copied in a prior run of this script.
// Their id maps are rebuilt cheaply (positional zip of ordered ids) instead of
// re-reading/re-inserting full rows, so a resume never re-scans the huge
// source tables that already succeeded.
const RESUME_FROM = process.env.RESUME_FROM || null; // e.g. "hms_timeline_msts"

function sanitizeValue(v) {
    if (v === undefined) return null;
    if (Buffer.isBuffer(v)) return v;
    if (v !== null && typeof v === "object" && !(v instanceof Date)) return JSON.stringify(v);
    return v;
}

async function insertRows(uat, table, columns, rows) {
    for (let i = 0; i < rows.length; i += BATCH_INSERT) {
        const chunk = rows.slice(i, i + BATCH_INSERT);
        const placeholders = chunk.map(() => `(${columns.map(() => "?").join(",")})`).join(",");
        const values = [];
        for (const r of chunk) for (const c of columns) values.push(r[c]);
        await uat.query(
            `INSERT INTO \`${table}\` (${columns.map((c) => `\`${c}\``).join(",")}) VALUES ${placeholders}`,
            values
        );
    }
}

// hotel_registrations: identity table, id (127) is NOT remapped.
async function copyHotelRow(live, uat) {
    const [rows] = await live.query(`SELECT * FROM hotel_registrations WHERE id = ?`, [HOTEL_ID]);
    if (rows.length === 0) {
        throw new Error(`hotel_registrations id=${HOTEL_ID} not found in LIVE`);
    }
    await uat.query(`DELETE FROM hotel_registrations WHERE id = ?`, [HOTEL_ID]);
    const columns = Object.keys(rows[0]);
    const values = columns.map((c) => sanitizeValue(rows[0][c]));
    await uat.query(
        `INSERT INTO hotel_registrations (${columns.map((c) => `\`${c}\``).join(",")}) VALUES (${columns.map(() => "?").join(",")})`,
        values
    );
    console.log(`  hotel_registrations: id ${HOTEL_ID} copied (identity preserved)`);
}

const sharedVerified = new Set(); // `${table}:${id}` already confirmed present in UAT

async function ensureSharedRow(live, uat, refTable, id) {
    if (id === null || id === undefined) return;
    const key = `${refTable}:${id}`;
    if (sharedVerified.has(key)) return;
    const [[{ cnt }]] = await uat.query(`SELECT COUNT(*) as cnt FROM \`${refTable}\` WHERE id = ?`, [id]);
    if (cnt === 0) {
        const [rows] = await live.query(`SELECT * FROM \`${refTable}\` WHERE id = ?`, [id]);
        if (rows.length > 0) {
            const columns = Object.keys(rows[0]);
            const values = columns.map((c) => sanitizeValue(rows[0][c]));
            await uat.query(
                `INSERT IGNORE INTO \`${refTable}\` (${columns.map((c) => `\`${c}\``).join(",")}) VALUES (${columns.map(() => "?").join(",")})`,
                values
            );
            console.log(`  [shared] backfilled ${refTable} id=${id}`);
        } else {
            console.log(`  [shared] WARNING: ${refTable} id=${id} referenced but not found in LIVE either`);
        }
    }
    sharedVerified.add(key);
}

// Rebuilds an id map for a table that was already fully copied in a prior
// run, without re-reading full rows from LIVE: both sides were populated by
// strictly-ascending-old-id iteration assigning strictly-sequential new ids,
// so the Nth old id (ascending) and the Nth new id (ascending) are the same
// row. We only need to read the (indexed) id columns, which is cheap even on
// huge source tables.
async function rebuildIdMap(live, uat, def) {
    const { table, pk, forceIndex } = def;
    const forceClause = forceIndex ? `FORCE INDEX (\`${forceIndex}\`)` : "";

    const [oldRows] = await live.query(
        `SELECT \`${pk}\` as v FROM \`${table}\` ${forceClause} WHERE hotel_id = ? ORDER BY \`${pk}\` ASC`,
        [HOTEL_ID]
    );
    const [newRows] = await uat.query(
        `SELECT \`${pk}\` as v FROM \`${table}\` WHERE hotel_id = ? ORDER BY \`${pk}\` ASC`,
        [HOTEL_ID]
    );
    if (oldRows.length !== newRows.length) {
        throw new Error(`rebuildIdMap(${table}): LIVE has ${oldRows.length} rows but UAT has ${newRows.length} -- prior run did not complete this table cleanly, cannot resume past it`);
    }
    const map = new Map();
    for (let i = 0; i < oldRows.length; i++) map.set(oldRows[i].v, newRows[i].v);
    console.log(`  ${table}: id map rebuilt from prior run (${map.size} rows, not re-copied)`);
    return map;
}

async function copyRemappedTable(live, uat, def, idMaps) {
    const { table, pk, fks, forceIndex } = def;
    const forceClause = forceIndex ? `FORCE INDEX (\`${forceIndex}\`)` : "";

    const [[{ cnt }]] = await live.query(`SELECT COUNT(*) as cnt FROM \`${table}\` ${forceClause} WHERE hotel_id = ?`, [HOTEL_ID]);
    if (cnt === 0) {
        idMaps[table] = new Map();
        console.log(`  ${table}: 0 rows, skipped`);
        return 0;
    }

    await uat.query(`DELETE FROM \`${table}\` WHERE hotel_id = ?`, [HOTEL_ID]);
    const [[{ maxId }]] = await uat.query(`SELECT COALESCE(MAX(\`${pk}\`), 0) as maxId FROM \`${table}\``);
    let nextId = Number(maxId) + 1;

    const map = new Map();
    idMaps[table] = map;

    let copied = 0;
    let lastPk = 0;
    while (true) {
        const [rows] = await live.query(
            `SELECT * FROM \`${table}\` ${forceClause} WHERE hotel_id = ? AND \`${pk}\` > ? ORDER BY \`${pk}\` ASC LIMIT ?`,
            [HOTEL_ID, lastPk, BATCH_FETCH]
        );
        if (rows.length === 0) break;

        const columns = Object.keys(rows[0]);
        const toInsert = [];
        for (const r of rows) {
            const oldId = r[pk];
            const newId = nextId++;
            map.set(oldId, newId);

            const out = {};
            for (const c of columns) out[c] = sanitizeValue(r[c]);
            out[pk] = newId;

            for (const f of fks) {
                const oldVal = r[f.col];
                if (oldVal === null || oldVal === undefined) {
                    out[f.col] = null;
                    continue;
                }
                if (f.shared) {
                    await ensureSharedRow(live, uat, f.refTable, oldVal);
                    out[f.col] = oldVal; // shared/global row, id unchanged
                } else {
                    const refMap = idMaps[f.refTable];
                    const mapped = refMap ? refMap.get(oldVal) : undefined;
                    if (mapped === undefined) {
                        console.log(`  ${table}: WARNING row old-id=${oldId} col=${f.col} value=${oldVal} has no mapped row in ${f.refTable}, setting NULL`);
                        out[f.col] = null;
                    } else {
                        out[f.col] = mapped;
                    }
                }
            }
            toInsert.push(out);
        }

        await insertRows(uat, table, columns, toInsert);
        copied += rows.length;
        lastPk = rows[rows.length - 1][pk];
        if (rows.length < BATCH_FETCH) break;
    }

    console.log(`  ${table}: ${copied} rows copied (ids remapped)`);
    return copied;
}

async function main() {
    console.log(`Migrating hotel_id=${HOTEL_ID} from LIVE (${LIVE_DB.database}@${LIVE_DB.host}) to UAT (${UAT_DB.database}@${UAT_DB.host})`);
    console.log(`Hotel identity (hotel_id=${HOTEL_ID}) is preserved; all child row ids are remapped to avoid colliding with UAT's other hotels.\n`);

    const live = await mysql.createConnection({ ...LIVE_DB, dateStrings: true });
    const uat = await mysql.createConnection({ ...UAT_DB, dateStrings: true });

    const idMaps = {};
    let totalRows = 0;

    try {
        await uat.query("SET FOREIGN_KEY_CHECKS = 0");

        if (RESUME_FROM) {
            console.log(`RESUME_FROM=${RESUME_FROM}: rebuilding id maps for earlier tables instead of re-copying them...\n`);
        } else {
            console.log("Copying hotel_registrations row...");
            await copyHotelRow(live, uat);
        }

        console.log("\nCopying hotel-scoped tables (dependency order)...");
        let resuming = !!RESUME_FROM;
        for (const def of TABLE_DEFS) {
            if (resuming && def.table !== RESUME_FROM) {
                idMaps[def.table] = await rebuildIdMap(live, uat, def);
                continue;
            }
            resuming = false;
            totalRows += await copyRemappedTable(live, uat, def, idMaps);
        }
    } finally {
        await uat.query("SET FOREIGN_KEY_CHECKS = 1");
        await live.end();
        await uat.end();
    }

    console.log(`\nDone. ${totalRows} rows copied across ${TABLE_DEFS.filter((d) => idMaps[d.table] && idMaps[d.table].size > 0).length} tables (plus the hotel_registrations row).`);
    console.log("\nNote: hms_printer_settings.table_ids/menu_categ_ids/item_ids and hms_tax_type_msts.table_categ_ids/menu_ids");
    console.log("are JSON arrays of ids stored outside any DB foreign key -- they were copied as-is, NOT remapped.");
}

main().catch((err) => {
    console.error("\nMIGRATION FAILED:", err);
    process.exit(1);
});
