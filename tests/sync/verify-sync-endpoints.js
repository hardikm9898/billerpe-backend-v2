// Verifies sync engine v2's REAL controllers against the REAL database and
// schema, rather than only against the exe's mock. It mounts nothing but
// routes/sync.js, so it never triggers server.js's boot-time
// sync({alter:true}) - that would alter live tables, which a test has no
// business doing.
//
// Read paths (heartbeat, pull) are exercised in full: that is where the risk
// of a schema mismatch actually lives, because the heartbeat builds one hand
// written UNION query across ~42 tables and the pull pages on
// (updatedAt, id) - both of which either work against the real columns or
// fail loudly here.
//
// Write paths are exercised with ONE throwaway row per direction, on a
// dedicated entity, and removed again before exit. Nothing else in the
// database is touched, and the hotel used is read from the data that is
// already there (no hotel is created).
//
// Run: node tests/sync/verify-sync-endpoints.js
require("dotenv").config();
const assert = require("assert");
const express = require("express");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");

const sequelize = require("../../connection/connect");
const { Hotel, LocalServerRegistration, Unit } = require("../../model");
const syncRoutes = require("../../routes/sync");
const { ENTITIES, ORDER_ENTITY, buildVersionQuery } = require("../../controller/sync/syncRegistry");

const PORT = Number(process.env.SYNC_TEST_PORT) || 4899;
const BASE = `http://127.0.0.1:${PORT}`;
const ok = (label, extra = "") => console.log(`  ok  ${label}${extra ? " - " + extra : ""}`);
const created = { unitIds: [] };

async function cleanup() {
    try {
        if (created.unitIds.length) {
            await Unit.destroy({ where: { id: created.unitIds } });
        }
    } catch (err) {
        console.error("cleanup failed:", err.message);
    }
}

async function main() {
    await sequelize.authenticate();
    console.log(`connected to ${process.env.DATABASE_NAME} as ${process.env.DATABASE_ID}`);

    // An existing hotel with real data - never created, never modified.
    const hotel = await Hotel.findOne({ order: [["id", "ASC"]], attributes: ["id", "hotel_name"] });
    assert(hotel, "no hotel rows in this database to test against");
    console.log(`using hotel ${hotel.id} (${hotel.hotel_name})`);

    // Reuses the outlet's EXISTING active registration rather than adding
    // one. Inserting a second active row is impossible by design - the
    // uniq_active_hotel generated-column index enforces one active local
    // server per restaurant - and this test confirmed that the hard way.
    // Reusing it also means the token here is exactly the token a real exe
    // would hold, so deviceAuth is tested as it really behaves.
    const registration = await LocalServerRegistration.findOne({
        where: { hotel_id: hotel.id, status: "active" },
    });
    assert(
        registration,
        `hotel ${hotel.id} has no active local-server registration to borrow - register a device first`,
    );
    const deviceToken = jwt.sign(
        {
            typ: "local-server",
            hotel_id: hotel.id,
            device_id: registration.device_id,
            installation_id: registration.installation_id,
        },
        process.env.JWT_SECRET_KEY_ADMIN,
    );
    console.log(`borrowing registration ${registration.id} (device ${registration.device_id.slice(0, 8)}...)`);

    const app = express();
    app.use(express.json({ limit: "10mb" }));
    app.use("/sync", syncRoutes);
    const server = app.listen(PORT);
    await new Promise((r) => server.once("listening", r));

    const call = async (method, path, body) => {
        const res = await fetch(`${BASE}${path}`, {
            method,
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${deviceToken}` },
            body: body ? JSON.stringify(body) : undefined,
        });
        return { status: res.status, json: await res.json().catch(() => null) };
    };

    // ---- the version query must be valid SQL against every real table ----
    // This is the single riskiest statement in the engine: one UNION arm per
    // entity, generated from the registry. A wrong table or column name here
    // would break every outlet's heartbeat at once.
    const versionSql = buildVersionQuery([...ENTITIES, ORDER_ENTITY]);
    const rows = await sequelize.query(versionSql, {
        replacements: { hotelId: hotel.id },
        type: sequelize.QueryTypes.SELECT,
    });
    assert.strictEqual(rows.length, ENTITIES.length + 1, "one row per entity");
    ok(`version query runs against the real schema`, `${rows.length} entities in 1 query`);

    // ---- heartbeat -------------------------------------------------------
    const beat = await call("GET", "/sync/heartbeat");
    assert.strictEqual(beat.status, 200, `heartbeat HTTP ${beat.status}`);
    assert(beat.json && beat.json.error === false, `heartbeat error: ${JSON.stringify(beat.json?.results)}`);
    const versions = beat.json.results.versions;
    for (const entity of [...ENTITIES, ORDER_ENTITY]) {
        assert(entity.name in versions, `heartbeat is missing entity ${entity.name}`);
    }
    const withRows = Object.entries(versions).filter(([, v]) => v.n > 0);
    ok("heartbeat returns a version for every entity", `${withRows.length} non-empty`);

    // Device liveness is refreshed by the heartbeat itself - which is what
    // makes "is this restaurant's server online" a real answer rather than
    // the registration timestamp it used to be.
    const seenBefore = registration.last_seen_at;
    await registration.reload();
    assert(registration.last_seen_at, "heartbeat refreshed last_seen_at");
    assert(
        !seenBefore || new Date(registration.last_seen_at) >= new Date(seenBefore),
        "last_seen_at must move forward",
    );
    ok("heartbeat refreshed this device's last_seen_at");

    // A token carrying a stale installation_id - what a PC holds after
    // another one has taken the outlet over - must be refused.
    const supersededToken = jwt.sign(
        {
            typ: "local-server",
            hotel_id: hotel.id,
            device_id: registration.device_id,
            installation_id: crypto.randomUUID(),
        },
        process.env.JWT_SECRET_KEY_ADMIN,
    );
    const superseded = await fetch(`${BASE}/sync/heartbeat`, {
        headers: { Authorization: `Bearer ${supersededToken}` },
    }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
    assert.strictEqual(superseded.status, 401, "a superseded installation_id must be refused");
    ok("a token from a replaced installation is refused", superseded.json?.results?.message);

    // ---- an unauthenticated / wrong-token call must be refused ----------
    const noAuth = await fetch(`${BASE}/sync/heartbeat`).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
    assert.strictEqual(noAuth.status, 401, "no token must be 401");
    const staffToken = jwt.sign({ id: 1 }, process.env.JWT_SECRET_KEY_ADMIN, { expiresIn: "1h" });
    const wrongType = await fetch(`${BASE}/sync/heartbeat`, { headers: { Authorization: `Bearer ${staffToken}` } })
        .then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
    assert.strictEqual(wrongType.status, 401, "a staff token must not be accepted here");
    ok("a missing token and a staff token are both refused");

    // ---- pull every entity, and page one of them -------------------------
    let pulledEntities = 0;
    let pulledRows = 0;
    for (const entity of ENTITIES) {
        if (entity.direction === "push") continue;
        const res = await call("GET", `/sync/pull?entity=${entity.name}&limit=50`);
        assert.strictEqual(res.status, 200, `pull ${entity.name} HTTP ${res.status}`);
        assert(res.json && res.json.error === false, `pull ${entity.name}: ${JSON.stringify(res.json?.results)}`);
        assert(Array.isArray(res.json.results.rows), `pull ${entity.name} returned no rows array`);
        pulledEntities++;
        pulledRows += res.json.results.rows.length;
    }
    ok("every pullable entity pulls against the real schema", `${pulledEntities} entities, ${pulledRows} rows`);

    // Cursor paging, on whichever entity actually has the most rows.
    const biggest = Object.entries(versions)
        .filter(([name, v]) => v.n > 2 && ENTITIES.some((e) => e.name === name && e.direction !== "push"))
        .sort((a, b) => b[1].n - a[1].n)[0];
    if (biggest) {
        const [name] = biggest;
        const first = await call("GET", `/sync/pull?entity=${name}&limit=2`);
        assert.strictEqual(first.json.results.rows.length, 2, "first page is limited");
        assert(first.json.results.nextCursor, "a cursor is returned when more rows exist");
        const second = await call("GET", `/sync/pull?entity=${name}&limit=2&cursor=${encodeURIComponent(first.json.results.nextCursor)}`);
        assert.strictEqual(second.status, 200, "second page");
        const firstIds = first.json.results.rows.map((r) => r.id ?? r.role_cd);
        const secondIds = second.json.results.rows.map((r) => r.id ?? r.role_cd);
        const overlap = firstIds.filter((id) => secondIds.includes(id));
        assert.strictEqual(overlap.length, 0, `pages must not overlap, repeated: ${overlap.join(",")}`);
        ok(`cursor paging returns distinct pages`, `${name}: [${firstIds}] then [${secondIds}]`);

        // `since` must exclude everything up to the newest row.
        const newest = versions[name].v;
        const none = await call("GET", `/sync/pull?entity=${name}&since=${encodeURIComponent(newest)}`);
        assert.strictEqual(none.json.results.rows.length, 0, "nothing is newer than the newest row");
        ok("an up-to-date entity pulls zero rows");
    }

    // ---- a bad entity name is refused, not a 500 ------------------------
    const bad = await call("GET", "/sync/pull?entity=definitely-not-an-entity");
    assert(bad.json?.error === true && bad.json?.code === 400, "unknown entity must be a 400");
    ok("an unknown entity name is refused cleanly");

    // ---- push: one throwaway row, then removed --------------------------
    // `units` is the safest real entity to prove the write path with: no
    // other row points at a unit by local_id, and this test deletes what it
    // creates.
    const localId = 990000 + Math.floor(Math.random() * 9000);
    const pushed = await call("POST", "/sync/push", {
        entity: "units",
        rows: [{ local_id: localId, unit_name: `claude-verify-${localId}`, shortName: "cv", updatedAt: new Date().toISOString() }],
    });
    assert.strictEqual(pushed.status, 200, `push HTTP ${pushed.status}`);
    assert(pushed.json?.error === false, `push failed: ${JSON.stringify(pushed.json?.results)}`);
    const result = pushed.json.results.results[0];
    assert(result?.ok, `push rejected the row: ${result?.message}`);
    assert(result.cloud_id, "push returned no cloud id");
    assert(result.updatedAt, "push must echo updatedAt so the exe can advance its pull mark");
    created.unitIds.push(result.cloud_id);
    ok("push created a row and returned its cloud id and updatedAt", `cloud_id=${result.cloud_id}`);

    // Idempotency: the same local_id must land on the same row.
    const again = await call("POST", "/sync/push", {
        entity: "units",
        rows: [{ local_id: localId, unit_name: `claude-verify-${localId}-edited`, shortName: "cv", updatedAt: new Date(Date.now() + 1000).toISOString() }],
    });
    const againResult = again.json.results.results[0];
    assert(againResult?.ok, `second push failed: ${againResult?.message}`);
    assert.strictEqual(againResult.cloud_id, result.cloud_id, "a repeat push must update the SAME row, not insert another");
    const [countRows] = await sequelize.query(
        "SELECT COUNT(*) n FROM hms_unit_msts WHERE hotel_id = :h AND local_id = :l",
        { replacements: { h: hotel.id, l: localId } },
    );
    assert.strictEqual(Number(countRows[0].n), 1, "exactly one row for this local_id");
    ok("a repeat push is idempotent on (hotel_id, local_id)");

    // A row whose parent does not exist must be reported as retryable, not
    // crash the request and not take the rest of the chunk with it.
    const mixed = await call("POST", "/sync/push", {
        entity: "rawMaterials",
        rows: [
            { local_id: 990001, raw_material_name: "claude-verify-orphan", purchase_price: "1", unit_id: 987654321, updatedAt: new Date().toISOString() },
        ],
    });
    assert.strictEqual(mixed.status, 200, "a bad row must not fail the request");
    const orphan = mixed.json.results.results[0];
    assert(orphan && orphan.ok === false && orphan.retryable === true, `expected a retryable rejection, got ${JSON.stringify(orphan)}`);
    ok("a row with an unresolvable parent is reported retryable, not written", orphan.message);

    // ---- a cloud-owned entity must refuse a push ------------------------
    const refused = await call("POST", "/sync/push", { entity: "serviceCharge", rows: [] });
    assert(refused.json?.error === true, "a pull-only entity must refuse a push");
    ok("a cloud-owned entity refuses to be pushed");

    server.close();
    await cleanup();
    console.log("\nALL REAL-BACKEND SYNC ENDPOINT CHECKS PASSED");
    await sequelize.close();
    process.exit(0);
}

main().catch(async (err) => {
    console.error("\nFAILED:", err);
    await cleanup();
    try { await sequelize.close(); } catch {}
    process.exit(1);
});
