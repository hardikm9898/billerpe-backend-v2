// Franchise outlets for the Owner App / Owner Dashboard (owner 2026-10-07).
// A franchise outlet is shown to its franchise owner (their mobile + password
// open it, with view and manage) instead of the person in the outlet's own
// owner_number. That person keeps their owner rights at the outlet (Web POS,
// Captain App, outlet PC); only the Owner App stops showing them the outlet.
//
//   node scripts/owner-franchise.js find <name>                  outlets whose name has <name>
//   node scripts/owner-franchise.js list                         every franchise link
//   node scripts/owner-franchise.js link <ownerMobile> <outletId> [note] [--yes]
//   node scripts/owner-franchise.js unlink <outletId> [--yes]
//
// Without --yes, link / unlink only print what they would do.
// Needs migration 20261007100000-create-owner-outlet-links (npm run migrate).

require("dotenv").config();
const { Op } = require("sequelize");
const { Hotel, HotelUser, OwnerOutletLink } = require("../model");
const { mobile10 } = require("../ownerv1/auth");

const args = process.argv.slice(2).filter((a) => a !== "--yes");
const yes = process.argv.includes("--yes");
const [cmd, a1, a2, ...rest] = args;

const show = (h) => `#${h.id} ${h.hotel_name} · owner ${h.owner_name || "?"} ${h.owner_number || "?"} · ${h.product_plan || "?"}${h.active === false || h.active === 0 ? " · SWITCHED OFF" : ""}`;
const ATTRS = ["id", "hotel_name", "owner_name", "owner_number", "product_plan", "active"];

async function find(text) {
    const hotels = await Hotel.findAll({ where: { hotel_name: { [Op.like]: `%${text}%` } }, attributes: ATTRS, order: [["id", "ASC"]], raw: true });
    if (!hotels.length) return console.log(`No outlet name has "${text}".`);
    const links = await OwnerOutletLink.findAll({ where: { hotel_id: hotels.map((h) => h.id) }, raw: true });
    for (const h of hotels) {
        const l = links.find((x) => x.hotel_id === h.id);
        console.log(`${show(h)}${l ? ` · FRANCHISE of ${l.owner_mobile}` : ""}`);
    }
}

async function list() {
    const links = await OwnerOutletLink.findAll({ order: [["owner_mobile", "ASC"], ["hotel_id", "ASC"]], raw: true });
    if (!links.length) return console.log("No franchise links.");
    const hotels = await Hotel.findAll({ where: { id: links.map((l) => l.hotel_id) }, attributes: ATTRS, raw: true });
    for (const l of links) {
        const h = hotels.find((x) => x.id === l.hotel_id);
        console.log(`franchise owner ${l.owner_mobile} -> ${h ? show(h) : `#${l.hotel_id} (outlet not found)`}${l.note ? ` · "${l.note}"` : ""}`);
    }
}

async function link(mobileIn, outletId, note) {
    const mobile = mobile10(mobileIn);
    if (!mobile) throw new Error(`"${mobileIn}" is not a mobile number.`);
    const hotel = await Hotel.findOne({ where: { id: Number(outletId) || 0 }, attributes: ATTRS, raw: true });
    if (!hotel) throw new Error(`No outlet #${outletId}.`);
    if (hotel.product_plan !== "LOCAL_SUITE") throw new Error(`${show(hotel)}\nis not a Plan 1 (Web POS + Captain) outlet; the Owner App shows Plan 1 outlets only.`);
    if (mobile10(hotel.owner_number) === mobile) throw new Error(`${mobile} is already this outlet's own owner; no link is needed.`);
    // The franchise owner logs in with the password of an outlet they own themselves.
    const own = await Hotel.findAll({ where: { owner_number: [mobile, `91${mobile}`], product_plan: "LOCAL_SUITE" }, attributes: ATTRS, raw: true });
    if (!own.length) throw new Error(`${mobile} owns no Plan 1 outlet, so they have no Owner App login.`);
    const ownerRow = await HotelUser.findOne({ where: { hotel_id: own.map((h) => h.id), number: [mobile, `91${mobile}`, `+91${mobile}`, `0${mobile}`, `+91 ${mobile}`] }, attributes: ["id", "name"], raw: true });
    const outletOwner = mobile10(hotel.owner_number);
    const outletOwnerRow = outletOwner
        ? (await HotelUser.findAll({ where: { hotel_id: hotel.id }, attributes: ["id", "number", "active"], raw: true })).find((u) => mobile10(u.number) === outletOwner && u.active !== false && u.active !== 0)
        : null;
    if (!outletOwnerRow) throw new Error(`${show(hotel)}\nhas no active owner login (the staff login with its owner number), which the Owner App acts through. Fix the outlet's owner first.`);
    const existing = await OwnerOutletLink.findOne({ where: { hotel_id: hotel.id }, raw: true });

    console.log(`Franchise owner : ${mobile}${ownerRow ? ` (${ownerRow.name})` : ""}, owner of ${own.map((h) => `#${h.id} ${h.hotel_name}`).join(", ")}`);
    console.log(`Franchise outlet: ${show(hotel)}`);
    if (existing && existing.owner_mobile === mobile) return console.log("Already linked. Nothing to do.");
    if (existing) console.log(`(now linked to ${existing.owner_mobile} - that link is replaced)`);
    console.log(`After this: ${mobile} sees and manages #${hotel.id} in the Owner App / Owner Dashboard; ${outletOwner} no longer sees it there (still owner at the outlet).`);
    if (!yes) return console.log("\nDry run. Add --yes to save.");
    if (existing) await OwnerOutletLink.update({ owner_mobile: mobile, note: String(note || "").slice(0, 160) }, { where: { hotel_id: hotel.id } });
    else await OwnerOutletLink.create({ owner_mobile: mobile, hotel_id: hotel.id, note: String(note || "").slice(0, 160) });
    console.log("Saved. Open the Owner App / Owner Dashboard again (or pull to refresh) to see it.");
}

async function unlink(outletId) {
    const existing = await OwnerOutletLink.findOne({ where: { hotel_id: Number(outletId) || 0 }, raw: true });
    if (!existing) return console.log(`Outlet #${outletId} is not a franchise outlet.`);
    const hotel = await Hotel.findOne({ where: { id: existing.hotel_id }, attributes: ATTRS, raw: true });
    console.log(`Remove: franchise owner ${existing.owner_mobile} -> ${hotel ? show(hotel) : `#${existing.hotel_id}`}`);
    console.log("After this the outlet shows again to its own owner in the Owner App.");
    if (!yes) return console.log("\nDry run. Add --yes to remove.");
    await OwnerOutletLink.destroy({ where: { hotel_id: existing.hotel_id } });
    console.log("Removed.");
}

(async () => {
    if (cmd === "find" && a1) await find([a1, a2, ...rest].filter(Boolean).join(" "));
    else if (cmd === "list") await list();
    else if (cmd === "link" && a1 && a2) await link(a1, a2, rest.join(" "));
    else if (cmd === "unlink" && a1) await unlink(a1);
    else {
        console.log("Usage:\n  node scripts/owner-franchise.js find <name>\n  node scripts/owner-franchise.js list\n  node scripts/owner-franchise.js link <ownerMobile> <outletId> [note] [--yes]\n  node scripts/owner-franchise.js unlink <outletId> [--yes]");
        process.exitCode = 1;
    }
    process.exit();
})().catch((e) => {
    console.error(e.message || e);
    process.exit(1);
});
