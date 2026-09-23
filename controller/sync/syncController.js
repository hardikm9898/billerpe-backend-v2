const { Op, QueryTypes } = require("sequelize");
const sequelize = require("../../connection/connect");
const {
    Hotel, QrOrder, TableBooking, LocalServerRegistration,
    Order, OrderDetails, OrderTax, User, Table, TaxType, Menu,
} = require("../../model");
const { MESSAGE, STATUSCODE } = require("../../constant/const");
const { success, error } = require("../../responce/res");
const {
    ENTITIES, ORDER_ENTITY, getEntity, buildVersionQuery, scopeWhere, pickWritableFields, primaryKeyOf,
} = require("./syncRegistry");
const { currentBundleFor } = require("./webBundleController");

// Sync engine v2. Three endpoints, all behind middleware/deviceAuth.js
// (req.user = hotel_id). See controller/sync/syncRegistry.js for the entity
// model and for what each one replaces.

const MAX_PULL_LIMIT = 1000;
const DEFAULT_PULL_LIMIT = 500;

// ---------------------------------------------------------------------------
// GET /sync/heartbeat
// ---------------------------------------------------------------------------
// The ONE call an outlet makes on a timer. It answers "what, if anything,
// has changed here since you last looked" for every entity at once, so the
// exe can then pull only what actually moved. Everything an exe used to
// poll separately - the old manifest, pending QR orders, reservations, and a
// session-refresh ping - is folded in here, because each of those was its
// own request per outlet per tick.
const heartbeat = async (req, res) => {
    try {
        const hotelId = req.user;

        const versionRows = await sequelize.query(buildVersionQuery([...ENTITIES, ORDER_ENTITY]), {
            replacements: { hotelId },
            type: QueryTypes.SELECT,
        });

        const versions = {};
        for (const row of versionRows) {
            versions[row.entity] = {
                // Null means "this outlet has no rows of this kind at all",
                // which the exe treats as nothing to pull - distinct from a
                // timestamp it has already seen.
                v: row.maxUpdatedAt ? new Date(row.maxUpdatedAt).toISOString() : null,
                n: Number(row.row_count) || 0,
            };
        }

        const [pendingQrOrders, bookingsVersion] = await Promise.all([
            QrOrder.count({ where: { hotel_id: hotelId, status: "pending" } }),
            TableBooking.max("updatedAt", { where: { hotel_id: hotelId } }).catch(() => null),
        ]);

        // Proof of life for this device, so "is this restaurant's server
        // online" is derived from real freshness instead of the registration
        // timestamp. Piggybacked here rather than being its own request.
        await LocalServerRegistration.update(
            { last_seen_at: new Date() },
            { where: { hotel_id: hotelId, device_id: req.deviceId, status: "active" } },
        );

        // Piggybacked for the same reason as everything else in this
        // response: the frontend-update check must not cost an outlet its
        // own request every minute. Null while no release is pending, which
        // is the normal case.
        const webBundle = await currentBundleFor("stable").catch(() => null);

        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, {
            serverTime: new Date().toISOString(),
            versions,
            pendingQrOrders,
            bookingsVersion: bookingsVersion ? new Date(bookingsVersion).toISOString() : null,
            webBundle,
        }, STATUSCODE.SUCCESS));
    } catch (err) {
        console.error("[sync] heartbeat error:", err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

// ---------------------------------------------------------------------------
// GET /sync/pull?entity=X&since=<iso>&cursor=<iso|id>&limit=500
// ---------------------------------------------------------------------------
// One entity, only rows changed since the exe's own high-water mark, in
// chunks. Ordered by (updatedAt, id) and paged by that same pair, which is
// stable even while rows are being written underneath it - an OFFSET would
// silently skip or repeat rows in exactly that situation.
function parseCursor(raw) {
    if (!raw) return null;
    const idx = String(raw).lastIndexOf("|");
    if (idx === -1) return null;
    const at = new Date(String(raw).slice(0, idx));
    const id = Number(String(raw).slice(idx + 1));
    if (Number.isNaN(at.getTime()) || Number.isNaN(id)) return null;
    return { at, id };
}

const pull = async (req, res) => {
    try {
        const hotelId = req.user;
        const entity = getEntity(req.query.entity);
        if (!entity) return res.json(error(`Unknown sync entity: ${req.query.entity}`, STATUSCODE.BAD_REQUEST));
        if (entity.direction === "push") {
            return res.json(error(`Entity ${entity.name} is exe-owned and cannot be pulled`, STATUSCODE.BAD_REQUEST));
        }

        const limit = Math.min(MAX_PULL_LIMIT, Math.max(1, Number(req.query.limit) || DEFAULT_PULL_LIMIT));
        const pk = primaryKeyOf(entity);
        const cursor = parseCursor(req.query.cursor);
        const since = req.query.since ? new Date(req.query.since) : null;

        const where = { ...scopeWhere(entity, hotelId) };
        if (cursor) {
            where[Op.or] = [
                { updatedAt: { [Op.gt]: cursor.at } },
                { updatedAt: cursor.at, [pk]: { [Op.gt]: cursor.id } },
            ];
        } else if (since && !Number.isNaN(since.getTime())) {
            where.updatedAt = { [Op.gt]: since };
        }

        const rows = await entity.Model.findAll({
            where,
            order: [["updatedAt", "ASC"], [pk, "ASC"]],
            limit: limit + 1,
            raw: true,
            ...(entity.pullExclude ? { attributes: { exclude: entity.pullExclude } } : {}),
        });

        const hasMore = rows.length > limit;
        const page = hasMore ? rows.slice(0, limit) : rows;
        const last = page[page.length - 1];
        const nextCursor = hasMore && last
            ? `${new Date(last.updatedAt).toISOString()}|${last[pk]}`
            : null;

        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, {
            entity: entity.name,
            rows: page,
            nextCursor,
            // The exe stores this as its high-water mark only once an entity
            // has been fully drained (nextCursor null), so an interrupted
            // multi-chunk pull resumes instead of being treated as complete.
            highWaterMark: page.length ? new Date(page[page.length - 1].updatedAt).toISOString() : null,
        }, STATUSCODE.SUCCESS));
    } catch (err) {
        console.error("[sync] pull error:", err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

// ---------------------------------------------------------------------------
// POST /sync/push   { entity, rows: [{ local_id, ...fields }] }
// ---------------------------------------------------------------------------
// A chunk of one entity's exe-created or exe-edited rows. Two properties
// matter more than anything else here, both learned from real incidents:
//
//   Per-row isolation. Every row is written in its own transaction and
//   reported on individually. The previous endpoint processed a whole batch
//   in one transaction, so a single bad row (typically a foreign key
//   pointing at something the cloud had never been told about) rolled back
//   every other order in the same tick, and came back in the next tick, and
//   the next - an outlet could sit unsynced for days behind one row.
//
//   Foreign keys translated, not trusted. A value like menu_categ_id
//   arrives as the EXE's own local id. It is looked up in the parent table
//   by (hotel_id, local_id) and replaced with the real id here. A parent
//   that genuinely is not here yet is reported as a retryable row, not a
//   crash - the exe pushes parents before children, so the next tick fixes
//   it once the parent lands.
async function translateForeignKeys(entity, row, hotelId) {
    const unresolved = [];
    const out = { ...row };
    for (const dep of entity.dependsOn || []) {
        const localValue = row[dep.field];
        if (localValue == null) continue;
        const parent = getEntity(dep.parent);
        if (!parent) continue;
        const parentPk = primaryKeyOf(parent);
        const parentAttrs = Object.keys(parent.Model.rawAttributes);

        // Rows that reached the exe by PULL keep the cloud's own id as their
        // local id, so the value may already be a valid cloud id. Rows
        // CREATED on the exe only resolve via local_id. Try the local_id
        // match first (unambiguous when present), then fall back to treating
        // it as a cloud id that already exists here.
        let resolved = null;
        if (parentAttrs.includes("local_id")) {
            const byLocal = await parent.Model.findOne({
                where: { ...scopeWhere(parent, hotelId), local_id: localValue },
                attributes: [parentPk],
                raw: true,
            });
            if (byLocal) resolved = byLocal[parentPk];
        }
        if (resolved == null) {
            const byId = await parent.Model.findOne({
                where: { ...scopeWhere(parent, hotelId), [parentPk]: localValue },
                attributes: [parentPk],
                raw: true,
            });
            if (byId) resolved = byId[parentPk];
        }
        if (resolved == null) {
            unresolved.push(`${dep.field}=${localValue} (${dep.parent} not synced here yet)`);
            continue;
        }
        out[dep.field] = resolved;
    }
    return { row: out, unresolved };
}

const push = async (req, res) => {
    try {
        const hotelId = req.user;
        const hotel = await Hotel.findOne({ where: { id: hotelId }, attributes: ["id"] });
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.NOT_FOUND));

        const entity = getEntity(req.body?.entity);
        if (!entity) return res.json(error(`Unknown sync entity: ${req.body?.entity}`, STATUSCODE.BAD_REQUEST));
        if (entity.direction === "pull") {
            return res.json(error(`Entity ${entity.name} is cloud-owned and cannot be pushed`, STATUSCODE.BAD_REQUEST));
        }
        const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
        const pk = primaryKeyOf(entity);
        const results = [];

        for (const incoming of rows) {
            const localId = incoming.local_id ?? incoming.id;
            if (localId == null) {
                results.push({ local_id: null, ok: false, retryable: false, message: "row has no local id" });
                continue;
            }
            const t = await sequelize.transaction();
            try {
                const { row: translated, unresolved } = await translateForeignKeys(entity, incoming, hotelId);
                if (unresolved.length) {
                    await t.rollback();
                    results.push({ local_id: localId, ok: false, retryable: true, message: `unresolved: ${unresolved.join(", ")}` });
                    continue;
                }

                const fields = pickWritableFields(entity, translated);
                if (entity.scope !== "cashSession") fields.hotel_id = hotelId;
                fields.local_id = localId;

                let existing = await entity.Model.findOne({
                    where: { ...scopeWhere(entity, hotelId), local_id: localId },
                    transaction: t,
                });
                if (entity.naturalKey) {
                    // Staff rows are matched by what identifies them (a user's
                    // mobile number, a role's name), never by a bare id: two
                    // different people can share an id across the exe's and the
                    // cloud's numbering, and claiming by id would overwrite
                    // one person's login with another's.
                    const keyWhere = Object.fromEntries(entity.naturalKey.map((k) => [k, fields[k]]));
                    if (!existing && entity.naturalKey.every((k) => fields[k] != null)) {
                        existing = await entity.Model.findOne({
                            where: { ...scopeWhere(entity, hotelId), ...keyWhere },
                            transaction: t,
                        });
                    }
                    if (entity.name === "hotelUsers" && fields.number) {
                        const takenElsewhere = await entity.Model.findOne({
                            where: { number: fields.number, hotel_id: { [Op.ne]: hotelId } },
                            attributes: ["id"],
                            transaction: t,
                        });
                        if (takenElsewhere) {
                            await t.rollback();
                            results.push({
                                local_id: localId, ok: false, retryable: false,
                                message: `Mobile ${fields.number} is already registered with another restaurant`,
                            });
                            continue;
                        }
                    }
                } else if (!existing) {
                    // First push of a row that originally came DOWN from here:
                    // pull writes it on the exe under this table's own id, so
                    // its "local id" is numerically our id, and our row still
                    // has local_id NULL (only a push ever sets it). Claiming
                    // that row instead of inserting a second copy is what
                    // stops a duplicate on an outlet's very first push.
                    existing = await entity.Model.findOne({
                        where: { ...scopeWhere(entity, hotelId), [pk]: localId, local_id: null },
                        transaction: t,
                    });
                }

                if (existing) {
                    // Last write wins by updatedAt, cloud wins an exact tie -
                    // the cloud copy is the shared one, so a same-millisecond
                    // collision resolves towards it rather than towards
                    // whichever outlet pushed last.
                    const incomingUpdatedAt = incoming.updatedAt ? new Date(incoming.updatedAt) : null;
                    const cloudUpdatedAt = existing.updatedAt ? new Date(existing.updatedAt) : null;
                    const cloudIsNewer = entity.direction === "both"
                        && incomingUpdatedAt && cloudUpdatedAt
                        && cloudUpdatedAt.getTime() >= incomingUpdatedAt.getTime();
                    if (cloudIsNewer) {
                        // Still stamp local_id so the two rows are linked from
                        // now on, but keep the cloud's own field values.
                        if (existing.local_id == null) await existing.update({ local_id: localId }, { transaction: t });
                        await t.commit();
                        results.push({
                            local_id: localId, ok: true, cloud_id: existing[pk],
                            updatedAt: existing.updatedAt, skipped: "cloud newer",
                        });
                        continue;
                    }
                    await existing.update(fields, { transaction: t });
                    await t.commit();
                    // updatedAt is echoed back so the exe can advance its own
                    // pull high-water mark for this entity. Without it, the
                    // very act of pushing made the cloud look "newer" on the
                    // next heartbeat and the exe re-downloaded the rows it had
                    // just sent - one wasted pull per entity per cycle.
                    results.push({ local_id: localId, ok: true, cloud_id: existing[pk], updatedAt: existing.updatedAt });
                } else {
                    const created = await entity.Model.create(fields, { transaction: t });
                    await t.commit();
                    results.push({ local_id: localId, ok: true, cloud_id: created[pk], updatedAt: created.updatedAt });
                }
            } catch (rowErr) {
                await t.rollback().catch(() => {});
                // A constraint failure is worth retrying (the missing parent
                // may arrive next tick); anything else is this row's own
                // problem and must not be retried forever.
                const retryable = /SequelizeForeignKeyConstraintError|ER_NO_REFERENCED_ROW|ER_LOCK|Deadlock|ETIMEDOUT/i.test(
                    `${rowErr?.name} ${rowErr?.message} ${rowErr?.parent?.code || ""}`,
                );
                console.error(`[sync] push ${entity.name} local_id=${localId} failed:`, rowErr?.message);
                results.push({ local_id: localId, ok: false, retryable, message: rowErr?.message || "write failed" });
            }
        }

        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, {
            entity: entity.name,
            results,
            accepted: results.filter((r) => r.ok).length,
            failed: results.filter((r) => !r.ok).length,
        }, STATUSCODE.SUCCESS));
    } catch (err) {
        console.error("[sync] push error:", err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

// ---------------------------------------------------------------------------
// POST /sync/push/orders   { orders: [{ local_id, ...order, details, taxes }] }
// ---------------------------------------------------------------------------
// Orders get their own endpoint because they are the one entity with nested
// children that must land atomically with their parent, and because their
// bill numbers are no longer negotiable: the exe is the sole bill-number
// authority for its restaurant (every order for an outlet is created there -
// the Web POS and every Captain handset talk only to that exe, and a QR
// table order becomes a real order only when staff accept it there), so
// bill_no arrives final and is stored verbatim. The previous endpoint minted
// a NEW number here on first sync and handed it back, which is what forced
// order creation to make a blocking cloud call before it could tell staff
// the bill number - the single biggest source of slow billing.
async function resolveCustomer(order, hotelId, t) {
    const name = order.customer?.name || "";
    const number = order.customer?.number || "";
    const localId = order.customer?.local_id ?? null;

    if (localId != null) {
        const byLocal = await User.findOne({ where: { hotel_id: hotelId, local_id: localId }, transaction: t });
        if (byLocal) {
            if ((name && byLocal.name !== name) || (number && byLocal.number !== number)) {
                await byLocal.update({ name: name || byLocal.name, number: number || byLocal.number }, { transaction: t });
            }
            return byLocal.id;
        }
    }
    // A real customer is identified by their number; a placeholder (walk-in,
    // no details captured) gets one row per order rather than every anonymous
    // order in the outlet's history collapsing onto a single shared row.
    if (number) {
        const byNumber = await User.findOne({ where: { hotel_id: hotelId, number }, transaction: t });
        if (byNumber) {
            if (name && byNumber.name !== name) await byNumber.update({ name }, { transaction: t });
            if (localId != null && byNumber.local_id == null) await byNumber.update({ local_id: localId }, { transaction: t });
            return byNumber.id;
        }
    }
    const created = await User.create({
        hotel_id: hotelId, name, number,
        gstin: order.customer?.gstin || "", address: order.customer?.address || "",
        isPlaceholder: order.customer?.isPlaceholder !== false,
        ...(localId != null ? { local_id: localId } : {}),
    }, { transaction: t });
    return created.id;
}

// TableId / MenuId / hmsTaxTypeMstId all arrive as the exe's local ids.
async function resolveByLocalId(Model, hotelId, localId, t) {
    if (localId == null) return null;
    const byLocal = await Model.findOne({ where: { hotel_id: hotelId, local_id: localId }, attributes: ["id"], raw: true, transaction: t });
    if (byLocal) return byLocal.id;
    const byId = await Model.findOne({ where: { hotel_id: hotelId, id: localId }, attributes: ["id"], raw: true, transaction: t });
    return byId ? byId.id : null;
}

const ORDER_FIELDS = [
    "bill_no", "order_type", "payment", "status", "payment_type",
    "totalAmount", "gst", "grandAmount", "roundOff", "totalDiscount",
    "discount_reason", "discount_type", "discount_value",
    "service_charge", "delivery_charge", "packaging_charge",
    "cash", "upi", "card", "due", "other_payments", "other_amount", "tip", "billPrintCount", "billed_at",
    "total_sgst", "total_cgst", "deleted", "token", "business_date", "createdAt",
];

const pushOrders = async (req, res) => {
    try {
        const hotelId = req.user;
        const orders = Array.isArray(req.body?.orders) ? req.body.orders : [];
        const results = [];

        for (const incoming of orders) {
            const localId = incoming.local_id;
            if (localId == null) {
                results.push({ local_id: null, ok: false, retryable: false, message: "order has no local_id" });
                continue;
            }
            const t = await sequelize.transaction();
            try {
                const fields = {};
                for (const key of ORDER_FIELDS) {
                    if (incoming[key] !== undefined) fields[key] = incoming[key];
                }
                fields.hotel_id = hotelId;
                fields.local_id = localId;
                // This row came from an outlet's own server, which is the
                // authority for it - but it is no longer "offline and
                // awaiting a real number", which is all isOffline ever meant
                // here. Keeping it true made the cloud's own bill numbering
                // skip these rows entirely.
                fields.isOffline = false;
                fields.UserId = await resolveCustomer(incoming, hotelId, t);
                if (incoming.TableId != null) {
                    fields.TableId = await resolveByLocalId(Table, hotelId, incoming.TableId, t);
                }

                let existing = await Order.findOne({ where: { hotel_id: hotelId, local_id: localId }, transaction: t });
                if (!existing && incoming.bill_no) {
                    // Rows pushed before local_id existed were matched by
                    // bill_no; adopt those instead of creating a duplicate.
                    existing = await Order.findOne({ where: { hotel_id: hotelId, bill_no: incoming.bill_no, local_id: null }, transaction: t });
                }

                let cloudOrderId;
                if (existing) {
                    await existing.update(fields, { transaction: t });
                    cloudOrderId = existing.id;
                } else {
                    const created = await Order.create(fields, { transaction: t });
                    cloudOrderId = created.id;
                }

                // Details and taxes are replaced wholesale: an order's line
                // set is fully described by every push (the exe rebuilds it
                // the same way on its own side), so appending would duplicate
                // lines on the second push of the same order.
                await OrderDetails.destroy({ where: { orderId: cloudOrderId, hotel_id: hotelId }, transaction: t });
                const detailRows = [];
                const skippedLines = [];
                for (const line of incoming.details || []) {
                    const menuId = await resolveByLocalId(Menu, hotelId, line.MenuId, t);
                    if (menuId == null) {
                        // The menu item itself has not reached the cloud yet.
                        // Reported as retryable for the whole order rather
                        // than silently dropping a line a customer paid for.
                        skippedLines.push(line.MenuId);
                        continue;
                    }
                    detailRows.push({
                        orderId: cloudOrderId, hotel_id: hotelId, MenuId: menuId,
                        qty: line.qty, price: line.price, order_type: line.order_type,
                        kotNumber: line.kotNumber, totalDiscount: line.totalDiscount || 0,
                        status: line.status, payment_status: line.payment_status,
                        comment: line.comment || "", addons: line.addons || [],
                        variant_name: line.variant_name || "",
                        TableId: fields.TableId ?? null, UserId: fields.UserId,
                    });
                }
                if (skippedLines.length) {
                    await t.rollback();
                    results.push({
                        local_id: localId, ok: false, retryable: true,
                        message: `menu item(s) not synced here yet: ${[...new Set(skippedLines)].join(", ")}`,
                    });
                    continue;
                }
                if (detailRows.length) await OrderDetails.bulkCreate(detailRows, { transaction: t });

                await OrderTax.destroy({ where: { hmsOrderMstId: cloudOrderId, hotel_id: hotelId }, transaction: t });
                const taxRows = [];
                for (const tax of incoming.taxes || []) {
                    const taxTypeId = await resolveByLocalId(TaxType, hotelId, tax.hmsTaxTypeMstId, t);
                    taxRows.push({
                        hmsOrderMstId: cloudOrderId, hotel_id: hotelId,
                        // A tax type that is not here yet still must not lose
                        // the AMOUNT charged - the e-bill view falls back to a
                        // generic "Tax" label when the join is empty.
                        hmsTaxTypeMstId: taxTypeId,
                        amount: tax.amount, tax_type: tax.tax_type, tax_value: tax.tax_value,
                    });
                }
                if (taxRows.length) await OrderTax.bulkCreate(taxRows, { transaction: t });

                await t.commit();
                results.push({ local_id: localId, ok: true, cloud_id: cloudOrderId });
            } catch (rowErr) {
                await t.rollback().catch(() => {});
                const retryable = /SequelizeForeignKeyConstraintError|ER_NO_REFERENCED_ROW|ER_LOCK|Deadlock|ETIMEDOUT/i.test(
                    `${rowErr?.name} ${rowErr?.message} ${rowErr?.parent?.code || ""}`,
                );
                console.error(`[sync] push order local_id=${localId} failed:`, rowErr?.message);
                results.push({ local_id: localId, ok: false, retryable, message: rowErr?.message || "write failed" });
            }
        }

        // Table statuses ride along with the order push (they change for the
        // same reasons and in the same moment), so they never need a request
        // of their own. The exe owns this field outright.
        for (const t of req.body?.tableStatuses || []) {
            const realId = await resolveByLocalId(Table, hotelId, t.id, null);
            if (realId != null) {
                await Table.update({ table_status: t.table_status || "F" }, { where: { id: realId, hotel_id: hotelId } });
            }
        }

        await LocalServerRegistration.update(
            { last_seen_at: new Date() },
            { where: { hotel_id: hotelId, device_id: req.deviceId, status: "active" } },
        ).catch(() => {});

        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, {
            results,
            accepted: results.filter((r) => r.ok).length,
            failed: results.filter((r) => !r.ok).length,
        }, STATUSCODE.SUCCESS));
    } catch (err) {
        console.error("[sync] pushOrders error:", err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

// POST /sync/rebase - called by the exe during registration, right after it
// has wiped its local database and just before it pulls everything fresh.
//
// push matches rows by (hotel_id, local_id), where local_id is whatever
// numbering the PC used when it first pushed a row. A fresh pull stores
// every row on the exe under THIS table's own id, so those old links would
// point edits at the wrong row or create duplicates. Re-linking here makes
// the cloud agree with the database the exe is about to rebuild:
//   - rows the exe pulls: local_id = id, exactly the id it will store them under
//   - rows it never pulls (orders, customers, audit logs): local_id = -id, a
//     value no exe-generated id can ever equal, and never NULL, so the
//     bill_no / primary-key adoption fallbacks cannot claim them either.
// Cleared to NULL first because MySQL checks the (hotel_id, local_id) unique
// index row by row inside a multi-row UPDATE. `silent` keeps updatedAt, so
// last-write-wins comparisons and the heartbeat's versions are unaffected.
const rebaseLocalIds = async (req, res) => {
    const hotelId = req.user;
    try {
        const targets = [...ENTITIES.filter((e) => e.direction !== "pull"), { ...ORDER_ENTITY, direction: "push" }]
            .filter((e) => e.Model.rawAttributes.local_id);
        const relinked = {};
        await sequelize.transaction(async (transaction) => {
            for (const entity of targets) {
                const pk = primaryKeyOf(entity);
                const where = scopeWhere(entity, hotelId);
                await entity.Model.update({ local_id: null }, { where, transaction, silent: true });
                const value = entity.direction === "both" ? sequelize.col(pk) : sequelize.literal(`-\`${pk}\``);
                const [count] = await entity.Model.update({ local_id: value }, { where, transaction, silent: true });
                relinked[entity.name] = count;
            }
        });
        return res.json(success(MESSAGE.SUCCESS, { relinked }, STATUSCODE.SUCCESS));
    } catch (err) {
        console.error("[sync] rebaseLocalIds error:", err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

module.exports = { heartbeat, pull, push, pushOrders, rebaseLocalIds };
