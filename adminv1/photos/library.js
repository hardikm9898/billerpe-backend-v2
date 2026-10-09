const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { Op } = require("sequelize");
const { sequelize, MenuPhoto, MenuPhotoRequest, Menu, Hotel, AdmUser } = require("../../model");
const Images = require("../../model/images");
const { RuleError } = require("../../appv1/core");
const { need } = require("../auth");
const audit = require("../audit");
const { notify, peopleWith } = require("../crm/notify");
const { txt } = require("../crm/util");
const { search, keyOf } = require("./search");

// BillerPe's menu photo library (owner 2026-10-09). SuperAdmin staff with
// "Manage menu photos" upload; every photo is turned into one standard square
// (600 px WebP) and a small one for billing tiles (200 px, same name + "-t"),
// kept in S3 under uploads/menu-photos/ (public, like the other uploads).
// Outlets only search and pick (see outlet.js); a menu item's foodImage holds
// the standard photo's URL.

const BUCKET = "bpe-upload-data";
const S3_BASE = `https://${BUCKET}.s3.ap-south-1.amazonaws.com/`;
const PREFIX = "uploads/menu-photos/";
const SIZE = 600;
const THUMB = 200;
const MAX_BYTES = 15 * 1024 * 1024;
const VEG = ["veg", "nonveg", "egg", ""];

/** Test servers keep photos on this server's disk (public/menu-photos) instead of S3. */
const local = () => process.env.MENU_PHOTOS_LOCAL === "1" || /_test$/.test(process.env.DATABASE_NAME || "");

/** The small photo of a standard one: ".../paneer-tikka-ab12.webp" -> ".../paneer-tikka-ab12-t.webp". */
const thumbOf = (url) => (/\.webp$/.test(url || "") ? url.replace(/\.webp$/, "-t.webp") : url || "");

async function put(key, buffer) {
    if (local()) {
        const file = path.join(__dirname, "../../public", key.replace(/^uploads\//, ""));
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, buffer);
        return `${process.env.ADMIN_PUBLIC_URL || ""}/${key.replace(/^uploads\//, "")}`;
    }
    const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
    await new S3Client({ region: "ap-south-1" }).send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: buffer, ContentType: "image/webp", ACL: "public-read", CacheControl: "public, max-age=31536000, immutable" }));
    return `${S3_BASE}${key}`;
}

/** Any photo -> the standard square and its small copy (EXIF turned upright, centre-cropped). */
async function render(buffer) {
    const sharp = require("sharp");
    let meta;
    try {
        meta = await sharp(buffer).metadata();
    } catch {
        throw new RuleError("This file is not a photo (JPG, PNG, WEBP or HEIC).");
    }
    if (!meta.width || !meta.height) throw new RuleError("This file is not a photo (JPG, PNG, WEBP or HEIC).");
    if (Math.min(meta.width, meta.height) < 300) throw new RuleError(`The photo is too small (${meta.width} x ${meta.height}). Use one at least 300 px on each side.`);
    const base = sharp(buffer, { failOn: "none" }).rotate();
    const big = await base.clone().resize(SIZE, SIZE, { fit: "cover", position: "attention" }).webp({ quality: 78 }).toBuffer();
    const small = await base.clone().resize(THUMB, THUMB, { fit: "cover", position: "attention" }).webp({ quality: 70 }).toBuffer();
    return { big, small, width: meta.width, height: meta.height };
}

async function store(name, buffer) {
    const { big, small } = await render(buffer);
    const slug = (keyOf(name).replace(/[^a-z0-9]+/g, "-") || "photo").slice(0, 60);
    const key = `${PREFIX}${slug}-${crypto.randomBytes(4).toString("hex")}`;
    const url = await put(`${key}.webp`, big);
    await put(`${key}-t.webp`, small);
    return { url, thumb: thumbOf(url), bytes: big.length };
}

const bufferOf = (file) => {
    if (!file || !file.data) throw new RuleError("Choose the photo.");
    const b = Buffer.from(String(file.data).replace(/^data:[^,]+,/, ""), "base64");
    if (!b.length) throw new RuleError("Choose the photo.");
    if (b.length > MAX_BYTES) throw new RuleError("The photo must be under 15 MB.");
    return b;
};

/* ------------------------------ the cache searches read ------------------------------ */

let cache = null;
let cacheAt = 0;
async function photos() {
    if (cache && Date.now() - cacheAt < 120000) return cache;
    const rows = await MenuPhoto.findAll({ where: { active: true }, attributes: ["id", "name", "aliases", "veg", "cuisine", "url", "thumb", "uses"], raw: true });
    const legacy = await Images.findAll({ attributes: ["url"], raw: true }).catch(() => []);
    cache = rows;
    cache.urls = new Set(rows.flatMap((r) => [r.url, r.thumb]).concat(legacy.map((l) => l.url).filter(Boolean)));
    cacheAt = Date.now();
    return cache;
}
const refresh = () => {
    cache = null;
};

/** Can this be a menu item's photo? Only a library photo (or an old-panel library photo), or none. */
async function allowed(url) {
    if (url === null || url === undefined || url === "") return true;
    return (await photos()).urls.has(String(url));
}

const view = (p, extra = {}) => ({ id: p.id, name: p.name, aliases: p.aliases, veg: p.veg, cuisine: p.cuisine, url: p.url, thumb: p.thumb || thumbOf(p.url), uses: p.uses, active: p.active !== false && p.active !== 0, ...extra });

/* ------------------------------ SuperAdmin: the library ------------------------------ */

function cleanMeta(input) {
    const name = txt(input.name, 120).replace(/\s+/g, " ");
    if (name.length < 2) throw new RuleError("Write the dish's name.");
    if (!keyOf(name)) throw new RuleError("The name needs at least one real word (not only sizes or numbers).");
    const aliases = String(input.aliases || "").split(",").map((x) => txt(x, 60)).filter(Boolean).slice(0, 15).join(", ").slice(0, 500);
    const veg = VEG.includes(input.veg) ? input.veg : "";
    return { name, aliases, veg, cuisine: txt(input.cuisine, 40) };
}

/** One photo. Refused when the name is taken; when it only looks like one already there, confirm: true adds it anyway. */
async function upload(s, input = {}) {
    need(s, "photos.manage");
    const meta = cleanMeta(input);
    const buffer = bufferOf(input.file);
    const key = keyOf(meta.name);
    const same = await MenuPhoto.findOne({ where: { search_key: key }, attributes: ["id", "name"], raw: true });
    if (same) return { status: "exists", photo: { id: same.id, name: same.name } };
    if (!input.confirm) {
        const near = search(await photos(), meta.name, { limit: 3 }).matches.filter((m) => m.score >= 85);
        if (near.length) return { status: "similar", similar: near.map((p) => ({ id: p.id, name: p.name, thumb: p.thumb, score: p.score })) };
    }
    const stored = await store(meta.name, buffer);
    const row = await MenuPhoto.create({ ...meta, search_key: key, ...stored, created_by: s.user.id });
    await audit.write(s, { action: "photo.add", entity: "menu_photo", entityId: row.id, summary: `Added the menu photo ${meta.name}` });
    refresh();
    const asked = await MenuPhotoRequest.count({ where: { status: "open" } });
    return { status: "added", photo: view(row.get({ plain: true })), openRequests: asked };
}

/** Name, search words, veg, cuisine, shown / hidden. */
async function update(s, id, input = {}) {
    need(s, "photos.manage");
    const row = await MenuPhoto.findOne({ where: { id: Number(id) || 0 } });
    if (!row) throw new RuleError("This photo no longer exists.");
    const meta = cleanMeta({ name: input.name ?? row.name, aliases: input.aliases ?? row.aliases, veg: input.veg ?? row.veg, cuisine: input.cuisine ?? row.cuisine });
    const key = keyOf(meta.name);
    if (key !== row.search_key && (await MenuPhoto.count({ where: { search_key: key, id: { [Op.ne]: row.id } } }))) throw new RuleError(`A photo named like "${meta.name}" is already in the library.`);
    const before = { name: row.name, aliases: row.aliases, veg: row.veg, cuisine: row.cuisine, active: row.active };
    await row.update({ ...meta, search_key: key, active: input.active === undefined ? row.active : input.active !== false });
    await audit.write(s, { action: "photo.edit", entity: "menu_photo", entityId: row.id, summary: `Changed the menu photo ${row.name}`, before, after: meta });
    refresh();
    return { photo: view(row.get({ plain: true })) };
}

/** A better picture for the same dish: every menu showing it gets the new one. */
async function replace(s, id, file) {
    need(s, "photos.manage");
    const row = await MenuPhoto.findOne({ where: { id: Number(id) || 0 } });
    if (!row) throw new RuleError("This photo no longer exists.");
    const stored = await store(row.name, bufferOf(file));
    const old = row.url;
    const moved = await sequelize.transaction(async (t) => {
        await row.update(stored, { transaction: t });
        const [n] = await Menu.update({ foodImage: stored.url }, { where: { foodImage: [old, thumbOf(old)] }, transaction: t });
        await audit.write(s, { action: "photo.replace", entity: "menu_photo", entityId: row.id, summary: `New picture for ${row.name} (${n} menu items updated)` }, { transaction: t });
        return n;
    });
    refresh();
    return { photo: view(row.get({ plain: true })), itemsUpdated: moved };
}

/** Only a photo no menu shows; otherwise hide it (stays on those menus, not offered) or replace it. */
async function remove(s, id) {
    need(s, "photos.manage");
    const row = await MenuPhoto.findOne({ where: { id: Number(id) || 0 } });
    if (!row) throw new RuleError("This photo no longer exists.");
    const used = await Menu.count({ where: { foodImage: [row.url, row.thumb], is_deleted: { [Op.not]: true } } });
    if (used) throw new RuleError(`${used} menu item${used === 1 ? " shows" : "s show"} this photo. Hide it (not offered any more) or give it a new picture instead.`);
    await row.destroy();
    await audit.write(s, { action: "photo.delete", entity: "menu_photo", entityId: row.id, summary: `Deleted the menu photo ${row.name}` });
    refresh();
    return { id: row.id };
}

/** The library page: search (same search outlets use), or all / hidden / unused, newest first. */
async function list(s, query = {}) {
    need(s, "photos.view");
    const q = txt(query.q, 80);
    const page = Math.max(1, Number(query.page) || 1);
    const counts = { all: await MenuPhoto.count(), hidden: await MenuPhoto.count({ where: { active: false } }), unused: await MenuPhoto.count({ where: { uses: 0, active: true } }), requests: await MenuPhotoRequest.count({ where: { status: "open" } }) };
    if (q) {
        const r = search(await photos(), q, { limit: 60 });
        return { photos: r.matches.map((p) => view(p, { score: p.score })), related: r.related.map((p) => view(p)), total: r.matches.length, page: 1, counts };
    }
    const where = query.filter === "hidden" ? { active: false } : query.filter === "unused" ? { uses: 0, active: true } : {};
    const { rows, count } = await MenuPhoto.findAndCountAll({ where, order: [["id", "DESC"]], limit: 60, offset: (page - 1) * 60, raw: true });
    return { photos: rows.map((p) => view(p)), related: [], total: count, page, counts };
}

/* ------------------------------ outlets' requests ------------------------------ */

async function requests(s, query = {}) {
    need(s, "photos.view");
    const status = ["open", "done", "closed"].includes(query.status) ? query.status : "open";
    const rows = await MenuPhotoRequest.findAll({ where: { status }, order: [["id", status === "open" ? "ASC" : "DESC"]], limit: 300, raw: true });
    const hotels = new Map((await Hotel.findAll({ where: { id: [...new Set(rows.map((r) => r.hotel_id))] }, attributes: ["id", "hotel_name", "address2"], raw: true })).map((h) => [h.id, h]));
    // Open requests grouped by dish: one upload answers every outlet that asked.
    const groups = new Map();
    for (const r of rows) {
        const g = groups.get(r.search_key) || { key: r.search_key, name: r.item_name, outlets: [], first: r.createdAt, ids: [] };
        g.ids.push(r.id);
        g.outlets.push({ requestId: r.id, hotelId: r.hotel_id, outlet: (hotels.get(r.hotel_id) || {}).hotel_name || `#${r.hotel_id}`, city: (hotels.get(r.hotel_id) || {}).address2 || "", item: r.item_name, menuId: r.menu_id, by: r.asked_by, at: r.createdAt, note: r.note });
        groups.set(r.search_key, g);
    }
    const list = [...groups.values()].sort((a, b) => b.outlets.length - a.outlets.length || new Date(a.first) - new Date(b.first));
    // What the library offers for each dish now (after an upload, the answer).
    const lib = await photos();
    for (const g of list) g.suggest = search(lib, g.name, { limit: 3 }).matches.map((p) => ({ id: p.id, name: p.name, thumb: p.thumb, score: p.score }));
    return { groups: list, counts: { open: await MenuPhotoRequest.count({ where: { status: "open" } }) } };
}

/** Answer requests with a photo: it is set on each asking outlet's item (if it still has none), and the request closes. */
async function answer(s, requestIds, photoId) {
    need(s, "photos.manage");
    const photo = await MenuPhoto.findOne({ where: { id: Number(photoId) || 0, active: true }, raw: true });
    if (!photo) throw new RuleError("Choose a photo from the library.");
    const ids = (Array.isArray(requestIds) ? requestIds : [requestIds]).map(Number).filter(Boolean);
    let set = 0;
    await sequelize.transaction(async (t) => {
        const rows = await MenuPhotoRequest.findAll({ where: { id: ids, status: "open" }, transaction: t, lock: t.LOCK.UPDATE });
        for (const r of rows) {
            if (r.menu_id) {
                const [n] = await Menu.update({ foodImage: photo.url }, { where: { id: r.menu_id, hotel_id: r.hotel_id, [Op.or]: [{ foodImage: null }, { foodImage: "" }] }, transaction: t });
                set += n;
            }
            await r.update({ status: "done", photo_id: photo.id, done_by: s.user.id, done_at: new Date() }, { transaction: t });
        }
        await audit.write(s, { action: "photo.answer", entity: "menu_photo", entityId: photo.id, summary: `Answered ${rows.length} photo request${rows.length === 1 ? "" : "s"} with ${photo.name} (${set} items now show it)` }, { transaction: t });
    });
    return { answered: ids.length, itemsSet: set };
}

/** Not uploaded (no good photo exists, a brand's own dish...): closed with a reason. */
async function close(s, requestIds, note) {
    need(s, "photos.manage");
    const why = txt(note, 200);
    if (why.length < 3) throw new RuleError("Write why (the outlet does not see it; it stays in the list of closed requests).");
    const ids = (Array.isArray(requestIds) ? requestIds : [requestIds]).map(Number).filter(Boolean);
    const [n] = await MenuPhotoRequest.update({ status: "closed", note: why, done_by: s.user.id, done_at: new Date() }, { where: { id: ids, status: "open" } });
    return { closed: n };
}

/** An outlet asks for a dish's photo (once per outlet and dish while open). */
async function request(hotelId, { menuId = null, itemName, askedBy = "" }) {
    const name = txt(itemName, 120);
    const key = keyOf(name);
    if (!key) throw new RuleError("Write the item's name.");
    const open = await MenuPhotoRequest.findOne({ where: { hotel_id: hotelId, search_key: key, status: "open" }, raw: true });
    if (open) return { requested: true, already: true };
    await MenuPhotoRequest.create({ hotel_id: hotelId, menu_id: Number(menuId) || null, item_name: name, search_key: key, asked_by: txt(askedBy, 80) });
    const waiting = await MenuPhotoRequest.count({ where: { search_key: key, status: "open" } });
    // One notice per dish per day, so a busy queue does not flood anyone.
    for (const p of await peopleWith("photos.manage")) {
        await notify(p.id, { type: "photo.request", title: `Photo asked: ${name}`, body: `${waiting} outlet${waiting === 1 ? "" : "s"} waiting`, link: "/photos?tab=requests", ref: `photoreq:${key}:${new Date().toISOString().slice(0, 10)}` }).catch(() => undefined);
    }
    return { requested: true, already: false };
}

/* ------------------------------ uses (for ranking and safe deletes) ------------------------------ */

async function recount() {
    const rows = await sequelize.query("SELECT foodImage url, COUNT(DISTINCT hotel_id) n FROM hms_menu_msts WHERE foodImage LIKE '%menu-photos/%' AND (is_deleted IS NULL OR is_deleted = 0) GROUP BY foodImage", { type: "SELECT" });
    const by = new Map(rows.map((r) => [r.url, Number(r.n)]));
    const all = await MenuPhoto.findAll({ attributes: ["id", "url", "uses"] });
    let changed = 0;
    for (const p of all) {
        const n = (by.get(p.url) || 0) + (by.get(thumbOf(p.url)) || 0);
        if (n !== p.uses) {
            await p.update({ uses: n });
            changed += 1;
        }
    }
    if (changed) refresh();
    return changed;
}

const worker = require("../../services/admin/worker");
worker.registerJob("menu.photos", () => recount());
worker.registerSchedule("menu.photos", 3600);

module.exports = { upload, update, replace, remove, list, requests, answer, close, request, recount, photos, allowed, refresh, render, store, thumbOf, view, local, S3_BASE, PREFIX };
