// Brings the old panel's photo library (hms_image_msts: name + url) into the
// new menu photo library (owner 2026-10-09): each photo is downloaded, turned
// into the standard size and stored like a new upload; menu items showing the
// old address move to the new one. Safe to run again (rows already brought
// in, by legacy_id, are skipped; a name already in the library is linked).
//
//   node scripts/import-legacy-photos.js            (the server's database)
//   node scripts/import-legacy-photos.js --dry-run  (only counts)

require("dotenv").config();
process.env.DISABLE_CRON = "1";
const M = require("../model");
const Images = require("../model/images");
const lib = require("../adminv1/photos/library");
const { keyOf } = require("../adminv1/photos/search");

(async () => {
    const dry = process.argv.includes("--dry-run");
    const rows = await Images.findAll({ raw: true });
    const done = new Set((await M.MenuPhoto.findAll({ where: { legacy_id: rows.map((r) => r.id).concat([0]) }, attributes: ["legacy_id"], raw: true })).map((r) => r.legacy_id));
    const todo = rows.filter((r) => !done.has(r.id) && r.url && keyOf(r.name || ""));
    console.log(`old photos: ${rows.length}, already brought in: ${done.size}, to bring in: ${todo.length}${dry ? " (dry run)" : ""}`);
    if (dry) return M.sequelize.close();
    let added = 0;
    let linked = 0;
    let moved = 0;
    const failed = [];
    for (const r of todo) {
        try {
            const key = keyOf(r.name);
            let photo = await M.MenuPhoto.findOne({ where: { search_key: key } });
            if (!photo) {
                const res = await fetch(r.url);
                if (!res.ok) throw new Error(`download ${res.status}`);
                const stored = await lib.store(r.name, Buffer.from(await res.arrayBuffer()));
                photo = await M.MenuPhoto.create({ name: String(r.name).trim().slice(0, 120), search_key: key, ...stored, legacy_id: r.id });
                added += 1;
            } else {
                if (!photo.legacy_id) await photo.update({ legacy_id: r.id });
                linked += 1;
            }
            const [n] = await M.Menu.update({ foodImage: photo.url }, { where: { foodImage: r.url } });
            moved += n;
        } catch (e) {
            failed.push(`${r.id} ${r.name}: ${e.message}`);
        }
    }
    console.log(`added ${added}, matched to a photo already there ${linked}, menu items moved to the new photos ${moved}, failed ${failed.length}`);
    for (const f of failed.slice(0, 50)) console.log("  -", f);
    await M.sequelize.close();
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
