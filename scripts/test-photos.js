// The menu photo library (owner 2026-10-09): SuperAdmin uploads (resized,
// stored), the forgiving search, outlets pick / match / ask, nothing but a
// library photo is ever saved on an item (POS App, outlet PC push).
//
//   DATABASE_NAME=billerpe_app_test node scripts/test-photos.js
//
// Refuses to run unless the database name ends in "_test". Photos go to
// public/menu-photos on test servers; everything made is removed at the end.

require("dotenv").config();
if (!/_test$/.test(process.env.DATABASE_NAME || "")) {
    console.error("Refusing to run: DATABASE_NAME must end in _test");
    process.exit(1);
}
process.env.ADMIN_JWT_SECRET = process.env.ADMIN_JWT_SECRET || "photos-test-secret";
process.env.DISABLE_CRON = "1";
process.env.ADMIN_PUBLIC_URL = "";

const fs = require("fs");
const path = require("path");
const http = require("http");
const express = require("express");
const bcrypt = require("bcrypt");
const sharp = require("sharp");
const { Op } = require("sequelize");
const M = require("../model");
const { ensureDefaultRoles } = require("../adminv1/permissions");

let passed = 0;
const failures = [];
function check(name, ok, detail) {
    if (ok) {
        passed += 1;
        console.log(`  ok   ${name}`);
    } else {
        failures.push(name);
        console.log(`  FAIL ${name}${detail !== undefined ? `  ${JSON.stringify(detail).slice(0, 500)}` : ""}`);
    }
}

const stamp = String(Date.now()).slice(-5);
const PW = "Pho-pass-1";
let base;
const post = async (p, body, token) => {
    const res = await fetch(`${base}${p}`, { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body || {}) });
    return { status: res.status, ...(await res.json().catch(() => ({}))) };
};
const call = (name, token, ...args) => post(`/${name}`, { args }, token);
const created = { users: [], hotels: [], photos: [] };

async function person(name, roleName) {
    const roles = Object.fromEntries((await M.AdmRole.findAll({ raw: true })).map((r) => [r.name, r]));
    const u = await M.AdmUser.create({ name: `${name} ${stamp}`, mobile: `6${String(created.users.length + 70).padStart(3, "0")}${stamp}7`.slice(0, 10), role_id: roles[roleName].id, password_hash: await bcrypt.hash(PW, 4), must_change_password: false });
    created.users.push(u.id);
    const r = await post("/login", { mobile: u.mobile, password: PW, device: { kind: "web", deviceId: `ph-${u.id}`, name: "test" } });
    return { u, token: r.session.token };
}

/** A real photo of w x h, as the panel sends it. */
async function photo(w = 900, h = 700, color = { r: 200, g: 80, b: 40 }, fmt = "jpeg") {
    const buf = await sharp({ create: { width: w, height: h, channels: 3, background: color } })[fmt]().toBuffer();
    return { name: `x.${fmt}`, mime: `image/${fmt}`, data: buf.toString("base64") };
}
const fileOf = (url) => path.join(__dirname, "../public", url.replace(/^\//, ""));

async function run() {
    const admin = await person("Admin", "Admin");
    const cs = await person("Success", "Customer success");
    const exec = await person("Exec", "Sales executive");
    const N = (name) => `${name} ${stamp}`;

    console.log("\nUploading (SuperAdmin)");
    let r = await call("photoUpload", cs.token, { name: N("Paneer Tikka"), file: await photo() });
    check("customer success cannot upload (needs 'Manage menu photos')", !r.ok, r);
    r = await call("photos", exec.token, {});
    check("a salesperson cannot see the library", !r.ok, r);
    r = await call("photoUpload", admin.token, { name: N("Paneer Tikka"), file: await photo(200, 200) });
    check("a photo under 300 px is refused", !r.ok && /too small/.test(r.error), r);
    r = await call("photoUpload", admin.token, { name: N("Paneer Tikka"), file: { name: "x.txt", mime: "text/plain", data: Buffer.from("hello world").toString("base64") } });
    check("a file that is not a photo is refused", !r.ok && /not a photo/.test(r.error), r);
    r = await call("photoUpload", admin.token, { name: "2 pc", file: await photo() });
    check("a name with no real word is refused", !r.ok && /real word/.test(r.error), r);
    r = await call("photoUpload", admin.token, { name: N("Paneer Tikka"), aliases: "panir tikka, paneer tika", veg: "veg", cuisine: "North Indian", file: await photo(1600, 900) });
    const tikka = r.ok && r.result.photo;
    if (tikka) created.photos.push(tikka.id);
    check("added: standard and small photo made", r.ok && r.result.status === "added" && /\/menu-photos\/.+\.webp$/.test(tikka.url) && tikka.thumb === tikka.url.replace(/\.webp$/, "-t.webp"), r);
    const big = tikka && (await sharp(fs.readFileSync(fileOf(tikka.url))).metadata());
    const small = tikka && (await sharp(fs.readFileSync(fileOf(tikka.thumb))).metadata());
    check("…resized to 600 x 600 WebP and 200 x 200, whatever the original (1600 x 900)", big && big.width === 600 && big.height === 600 && big.format === "webp" && small.width === 200 && small.height === 200, [big && big.width, small && small.width]);
    check("…and small (under 60 KB)", fs.statSync(fileOf(tikka.url)).size < 60000);
    r = await call("photoUpload", admin.token, { name: `tikka   PANEER ${stamp}`, file: await photo() });
    check("the same dish twice (other word order / case) is not added again", r.ok && r.result.status === "exists" && r.result.photo.id === tikka.id, r);
    r = await call("photoUpload", admin.token, { name: N("Panner Tika"), file: await photo() });
    check("a name that only looks like one already there asks to confirm", r.ok && r.result.status === "similar" && r.result.similar.some((x) => x.id === tikka.id), r);
    const more = [["Chicken Biryani", "nonveg", "biriyani"], ["Veg Biryani", "veg", ""], ["Pav Bhaji", "veg", ""], ["Masala Dosa", "veg", ""], ["Chicken 65", "nonveg", ""], ["Cold Coffee", "veg", ""], ["Masala Chai", "veg", `chai ${stamp}, tea ${stamp}`]];
    for (const [name, veg, aliases] of more) {
        r = await call("photoUpload", admin.token, { name: N(name), veg, aliases, file: await photo(800, 800, { r: 30 + created.photos.length * 20, g: 120, b: 90 }, "png") });
        if (r.ok && r.result.photo) created.photos.push(r.result.photo.id);
    }
    check("bulk: 7 more photos (PNG too)", created.photos.length === 8, created.photos.length);
    const idOf = async (name) => (await M.MenuPhoto.findOne({ where: { name: N(name) }, raw: true })).id;

    console.log("\nSearch");
    const find = async (q, opts) => (await call("photoFind", cs.token, `${q} ${stamp}`, opts)).result;
    let f = await find("panner tika (half)");
    check("typos and sizes: 'panner tika (half)' finds Paneer Tikka first", f && f.matches[0] && f.matches[0].id === tikka.id && f.sure === tikka.id, f && f.matches.slice(0, 2));
    f = await find("Tikka Paneer");
    check("any word order", f.matches[0] && f.matches[0].id === tikka.id);
    f = await find("pavbhaji");
    check("words written together: 'pavbhaji'", f.matches[0] && f.matches[0].id === (await idOf("Pav Bhaji")));
    f = await find("tea");
    check("search words (aliases): 'tea' finds Masala Chai", f.matches[0] && f.matches[0].id === (await idOf("Masala Chai")));
    f = await find("Hyderabadi Mutton Biryani");
    const biryanis = [await idOf("Chicken Biryani"), await idOf("Veg Biryani")];
    check("nothing exact: related photos come first by shared dish word (the biryanis)", [...f.matches, ...f.related].slice(0, 2).every((p) => biryanis.includes(p.id)), [...f.matches, ...f.related].slice(0, 3).map((p) => p.name));
    f = await find("chicken 65");
    check("'Chicken 65' keeps its number", f.matches[0] && f.matches[0].id === (await idOf("Chicken 65")));
    const ctl = require("../controller/superAdmin");
    const res = { body: null, status() { return this; }, json(b) { this.body = b; return this; } };
    await ctl.getProductImages({ params: { search: `chiken biriyani ${stamp}` }, query: {} }, res);
    const old = res.body && (res.body.result || res.body.results || res.body.data);
    const oldData = old && (old.data || (old.result && old.result.data));
    check("the Web POS picker's endpoint uses the same search (same answer shape)", Array.isArray(oldData) && oldData[0] && oldData[0].id === biryanis[0] && oldData[0].url && oldData[0].thumb, res.body);

    console.log("\nEditing, hiding, replacing, deleting");
    r = await call("photoUpdate", admin.token, tikka.id, { aliases: "panir tikka, paneer tika, tandoori paneer" });
    f = await find("tandoori paneer");
    check("new search words work at once", r.ok && f.matches[0] && f.matches[0].id === tikka.id, r);
    const dosa = await idOf("Masala Dosa");
    r = await call("photoUpdate", admin.token, dosa, { active: false });
    f = await find("masala dosa");
    check("a hidden photo is not offered", r.ok && !f.matches.some((p) => p.id === dosa), f.matches);
    await call("photoUpdate", admin.token, dosa, { active: true });

    console.log("\nOutlets pick, match and ask");
    const { seedOutlet } = require("../services/outletSetup");
    const h = await M.Hotel.create({ hotel_name: `Photo Cafe ${stamp}`, owner_name: "Owner", owner_number: Number(`95${stamp}001`.slice(0, 10)), address1: "x", address2: "Surat", pinCode: 395001, hotel_logo: "", password: "x", hotel_reg_date: new Date(), plan_start_date: new Date(), plan_end_date: new Date(Date.now() + 200 * 86400000), product_plan: "CLOUD_APP", app_device_limit: 6 });
    created.hotels.push(h.id);
    const { user } = await seedOutlet(h, { name: "Owner", number: `95${stamp}001`.slice(0, 10), email: null, passwordHash: await bcrypt.hash("demo1234", 4) });
    const { buildContext } = require("../appv1/core");
    const c = await buildContext(h.id, user.id, "superadmin");
    const catalog = require("../appv1/domains/catalog");
    const menu = await M.MenuCatalog.findOne({ where: { hotel_id: h.id, is_default: true } });
    const imp = await catalog.importMenu.fn(c, String(menu.id), [
        { category: "Starters", name: N("Paneer Tikka (Half)"), price: 220 },
        { category: "Main", name: N("Chiken Biriyani"), price: 260 },
        { category: "Main", name: N("Paneer Lababdar"), price: 280 },
        { category: "Drinks", name: N("Sushi Roll"), price: 300 },
    ]);
    check("an outlet menu with 4 items", imp.created === 4, imp);
    const item = async (name) => M.Menu.findOne({ where: { hotel_id: h.id, item_name: N(name) } });
    let pm = await catalog.photoMenu.fn(c, false);
    const byName = (n) => pm.items.find((x) => x.name === N(n));
    check("'Match photos': clear matches ticked (Paneer Tikka (Half), Chiken Biriyani)", byName("Paneer Tikka (Half)").sure && byName("Paneer Tikka (Half)").best.id === tikka.id && byName("Chiken Biriyani").sure && byName("Chiken Biriyani").best.id === biryanis[0], pm.items.map((x) => [x.name, x.sure, x.best && x.best.name]));
    check("…a related photo offered, not ticked, for Paneer Lababdar", !byName("Paneer Lababdar").sure);
    r = await catalog.photoSet.fn(c, [{ menuId: String((await item("Paneer Tikka (Half)")).id), photoId: tikka.id }, { menuId: String((await item("Chiken Biriyani")).id), photoId: biryanis[0] }]);
    check("the owner confirms: both items show their photos", r.set === 2 && (await item("Paneer Tikka (Half)")).foodImage === tikka.url, r);
    pm = await catalog.photoMenu.fn(c, false);
    check("…and drop off the 'without a photo' list", pm.items.length === 2 && pm.withPhoto === 2 && pm.total === 4, [pm.items.length, pm.withPhoto]);
    const outlet = require("../adminv1/photos/outlet");
    const sg = await outlet.suggest([{ key: "L1", name: N("Paneer Tikka") }, { key: "L2", name: "Nothing like it" }]);
    check("the outlet PC's suggestions by name (its own ids come back)", sg.items[0].key === "L1" && sg.items[0].best.id === tikka.id && sg.items[1].key === "L2", sg);

    console.log("\nNever an upload on an item");
    const sushi = await item("Sushi Roll");
    const save = (imageUrl) => catalog.saveItem.fn(c, { id: String(sushi.id), name: sushi.item_name, price: 300, categoryId: String(sushi.menu_categ_id), imageUrl, shortCode: sushi.shortCode }).then(() => ({ ok: true }), (e) => ({ ok: false, error: e.message }));
    r = await save("data:image/jpeg;base64,AAAA");
    check("POS App: a photo from the phone is refused", !r.ok && /photo library/.test(r.error), r);
    r = await save("https://evil.example.com/x.jpg");
    check("POS App: any other address is refused", !r.ok, r);
    r = await save(tikka.url);
    check("POS App: a library photo is saved", r.ok && (await item("Sushi Roll")).foodImage === tikka.url, r);
    r = await save(null);
    check("POS App: the photo can be removed", r.ok && !(await item("Sushi Roll")).foodImage, r);
    const reg = require("../controller/sync/syncRegistry");
    const ent = (reg.ENTITIES || reg.entities || []).find((e) => e.name === "menuItems");
    const fields = { item_name: "x", foodImage: "data:image/png;base64,AAAA" };
    await ent.prepare(fields, h.id);
    const fields2 = { item_name: "x", foodImage: tikka.url };
    await ent.prepare(fields2, h.id);
    check("outlet PC push: a non-library photo is dropped, a library one kept", !("foodImage" in fields) && fields2.foodImage === tikka.url, [fields, fields2]);

    console.log("\nAsking BillerPe for a photo");
    const lib = require("../adminv1/photos/library");
    const lab = await item("Paneer Lababdar");
    r = await lib.request(h.id, { menuId: lab.id, itemName: lab.item_name, askedBy: "Owner" });
    const again = await lib.request(h.id, { menuId: lab.id, itemName: lab.item_name, askedBy: "Owner" });
    check("an outlet asks once per dish", r.requested && !r.already && again.already);
    check("…people who manage photos are told", !!(await M.AdmNotification.findOne({ where: { user_id: admin.u.id, type: "photo.request" } })));
    r = await call("photoRequests", admin.token, {});
    const g = r.ok && r.result.groups.find((x) => x.name === lab.item_name);
    check("the requests list groups it, with the outlet", g && g.outlets[0].hotelId === h.id, r.ok ? r.result.groups.length : r);
    r = await call("photoUpload", admin.token, { name: N("Paneer Lababdar"), veg: "veg", file: await photo() });
    if (r.ok && r.result.photo) created.photos.push(r.result.photo.id);
    check("uploading it shows how many requests wait", r.ok && r.result.openRequests >= 1, r);
    r = await call("photoAnswer", admin.token, g.ids, r.result.photo.id);
    check("answered: the asking outlet's item shows the photo, request done", r.ok && r.result.itemsSet === 1 && !!(await item("Paneer Lababdar")).foodImage && (await M.MenuPhotoRequest.findOne({ where: { id: g.ids[0] } })).status === "done", r);
    await lib.request(h.id, { menuId: (await item("Sushi Roll")).id, itemName: N("Sushi Roll") });
    const sushiReq = await M.MenuPhotoRequest.findOne({ where: { hotel_id: h.id, status: "open" } });
    r = await call("photoClose", admin.token, [sushiReq.id], "");
    check("closing without a reason is refused", !r.ok);
    r = await call("photoClose", admin.token, [sushiReq.id], "Brand-specific dish, no stock photo");
    check("closed with a reason", r.ok && r.result.closed === 1);

    console.log("\nSuperAdmin staff set an outlet's photos; uses; safe deletes");
    r = await call("outletPhotos", exec.token, h.id);
    check("a salesperson cannot", !r.ok);
    r = await call("outletPhotos", cs.token, h.id, { all: true });
    check("customer success sees the outlet's items and suggestions", r.ok && r.result.items.length === 4, r.ok ? r.result.items.length : r);
    r = await call("outletPhotosSet", cs.token, h.id, [{ menuId: sushi.id, photoId: await idOf("Cold Coffee") }]);
    check("…and sets one", r.ok && r.result.set === 1 && !!(await item("Sushi Roll")).foodImage, r);
    await lib.recount();
    check("uses are counted per photo (Paneer Tikka: 1 outlet)", (await M.MenuPhoto.findByPk(tikka.id)).uses === 1);
    r = await call("photoDelete", admin.token, tikka.id);
    check("a photo a menu shows cannot be deleted (hide or replace it)", !r.ok && /shows this photo/.test(r.error), r);
    r = await call("photoReplace", admin.token, tikka.id, await photo(1000, 1000, { r: 10, g: 200, b: 10 }));
    const newUrl = r.ok && r.result.photo.url;
    check("replace: a new picture, and every menu item showing it follows", r.ok && newUrl !== tikka.url && r.result.itemsUpdated === 1 && (await item("Paneer Tikka (Half)")).foodImage === newUrl, r);
    r = await call("photoDelete", admin.token, await idOf("Masala Dosa"));
    created.photos = created.photos.filter(async () => true);
    check("an unused photo can be deleted", r.ok, r);

    console.log("\nThe library page");
    r = await call("photos", cs.token, { q: `panner ${stamp}` });
    check("staff with 'see' can search the library page", r.ok && r.result.photos.some((p) => p.id === tikka.id) && r.result.counts.requests >= 0, r);
    r = await call("photos", admin.token, { filter: "unused" });
    check("the unused filter lists photos no menu shows", r.ok && r.result.photos.every((p) => p.uses === 0));
}

async function cleanup() {
    const rows = await M.MenuPhoto.findAll({ where: { name: { [Op.like]: `%${stamp}` } }, raw: true });
    for (const p of rows) for (const u of [p.url, p.thumb]) fs.rmSync(fileOf(u), { force: true });
    await M.MenuPhoto.destroy({ where: { name: { [Op.like]: `%${stamp}` } } });
    if (created.hotels.length) {
        await M.MenuPhotoRequest.destroy({ where: { hotel_id: created.hotels } });
        for (const name of ["Menu", "Menu_categ", "MenuCatalog", "UserAccess", "PaymentMode", "BillChargeRule", "NotificationSetting", "RolePermissionDefault", "RestaurantSetting", "AuditLog"]) if (M[name]) await M[name].destroy({ where: { hotel_id: created.hotels } }).catch(() => {});
        await M.HotelUser.destroy({ where: { hotel_id: created.hotels } });
        await M.Role.destroy({ where: { hotel_id: created.hotels } }).catch(() => {});
        await M.Hotel.destroy({ where: { id: created.hotels } });
    }
    if (created.users.length) {
        for (const m of [M.AdmNotification, M.AdmSession]) await m.destroy({ where: { user_id: created.users } });
        await M.AdmAuditLog.destroy({ where: { actor_id: created.users } });
        await M.AdmUser.destroy({ where: { id: created.users } });
    }
}

(async () => {
    await ensureDefaultRoles(M.AdmRole);
    const app = express();
    app.use(express.json({ limit: "30mb" }));
    app.use("/admin/v1", require("../adminv1/routes"));
    const server = http.createServer(app);
    await new Promise((res) => server.listen(0, res));
    base = `http://127.0.0.1:${server.address().port}/admin/v1`;
    try {
        await run();
    } catch (e) {
        console.error(e);
        failures.push(`crashed: ${e.message}`);
    } finally {
        await cleanup().catch((e) => console.error("cleanup:", e.message));
        server.close();
        await M.sequelize.close();
    }
    console.log(`\n${passed} passed, ${failures.length} failed`);
    if (failures.length) {
        for (const f of failures) console.log(`  - ${f}`);
        process.exit(1);
    }
    process.exit(0);
})();
