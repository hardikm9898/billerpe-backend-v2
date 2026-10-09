const { Op } = require("sequelize");
const { sequelize, Menu, Menu_categ, MenuPhoto } = require("../../model");
const { RuleError } = require("../../appv1/core");
const { search } = require("./search");
const lib = require("./library");

// What outlets (POS App, Web POS through its PC, SuperAdmin staff for an
// outlet) do with the library: search and pick, "Match photos" for a whole
// menu, and ask for a missing photo. Outlets never upload (owner 2026-10-09).

const light = (p, score) => ({ id: p.id, name: p.name, url: p.url, thumb: p.thumb || lib.thumbOf(p.url), veg: p.veg, ...(score !== undefined ? { score } : {}) });

/** Search the library: the best matches, else related photos (never an empty screen while the library has photos). */
async function find(q, { veg = "", limit = 24 } = {}) {
    const r = search(await lib.photos(), q, { limit: Math.min(48, Number(limit) || 24), veg: ["veg", "nonveg", "egg"].includes(veg) ? veg : "" });
    return { matches: r.matches.map((p) => light(p, p.score)), related: r.related.map((p) => light(p)), sure: r.sure ? r.sure.id : null };
}

const dietOf = (sub) => (/non|chicken|mutton|egg|fish|meat/i.test(String(sub || "")) ? (/egg/i.test(String(sub || "")) ? "egg" : "nonveg") : /veg/i.test(String(sub || "")) ? "veg" : "");

/**
 * "Match photos": for items (by their names) the best photo and two more to
 * choose from. items: [{ key, name, veg? }] - the outlet PC sends its own
 * menu this way (its ids are its own). sure = a clear match the screen ticks
 * for the owner (still saved only when they confirm).
 */
async function suggest(items) {
    const all = await lib.photos();
    const list = (Array.isArray(items) ? items : []).slice(0, 2000);
    return {
        items: list.map((it) => {
            const r = search(all, String(it.name || ""), { limit: 4, veg: it.veg || "" });
            return { key: it.key, name: it.name, sure: !!r.sure, best: r.matches[0] ? light(r.matches[0], r.matches[0].score) : null, options: r.matches.slice(1, 4).map((p) => light(p, p.score)) };
        }),
    };
}

/** The outlet's cloud menu items, with or without a photo, and suggestions for those without (POS App, SuperAdmin). */
async function menuFor(hotelId, { missingOnly = true } = {}) {
    const where = { hotel_id: hotelId, is_deleted: { [Op.not]: true } };
    if (missingOnly) where[Op.or] = [{ foodImage: null }, { foodImage: "" }];
    const rows = await Menu.findAll({ where, attributes: ["id", "item_name", "foodImage", "sub_categories", "menu_categ_id"], order: [["menu_categ_id", "ASC"], ["item_name", "ASC"]], raw: true, limit: 2000 });
    const cats = new Map((await Menu_categ.findAll({ where: { id: [...new Set(rows.map((r) => r.menu_categ_id))] }, attributes: ["id", "menu_categ_nm"], raw: true })).map((c) => [c.id, c.menu_categ_nm]));
    const s = await suggest(rows.map((r) => ({ key: String(r.id), name: r.item_name, veg: dietOf(r.sub_categories) })));
    return {
        items: rows.map((r, i) => ({ menuId: r.id, name: r.item_name, category: cats.get(r.menu_categ_id) || "", photo: r.foodImage || null, ...s.items[i] })),
        total: await Menu.count({ where: { hotel_id: hotelId, is_deleted: { [Op.not]: true } } }),
        withPhoto: await Menu.count({ where: { hotel_id: hotelId, is_deleted: { [Op.not]: true }, foodImage: { [Op.and]: [{ [Op.ne]: null }, { [Op.ne]: "" }] } } }),
    };
}

/** Set (or clear: photoId null) photos on the outlet's cloud items in one go; an outlet PC pulls the change. */
async function setOn(hotelId, picks) {
    const list = (Array.isArray(picks) ? picks : []).slice(0, 2000);
    if (!list.length) throw new RuleError("Choose at least one photo.");
    const ids = [...new Set(list.map((p) => Number(p.photoId)).filter(Boolean))];
    const photos = new Map((await MenuPhoto.findAll({ where: { id: ids, active: true }, attributes: ["id", "url"], raw: true })).map((p) => [p.id, p.url]));
    let set = 0;
    await sequelize.transaction(async (t) => {
        for (const p of list) {
            const url = p.photoId ? photos.get(Number(p.photoId)) : null;
            if (p.photoId && !url) throw new RuleError("A chosen photo is not in the library any more. Search again.");
            const [n] = await Menu.update({ foodImage: url }, { where: { id: Number(p.menuId) || 0, hotel_id: hotelId }, transaction: t });
            set += n;
        }
    });
    return { set };
}

module.exports = { find, suggest, menuFor, setOn, dietOf };
