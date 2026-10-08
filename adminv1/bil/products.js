const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const WebSiteProducts = require("../../model/webSiteProducts");
const { RuleError } = require("../../appv1/core");
const { need } = require("../auth");
const audit = require("../audit");
const { txt, moment, TZ } = require("../crm/util");

// Website products (old panel: Product Management): the printers and paper
// rolls sold on billerpe.com and in hardware orders. Add and edit with
// photos, key features, price and an offer. Hardware invoices take the
// price from here (catalog.hardwarePrice), never from the browser.

const MAX_IMAGES = 8;
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;

/** A product photo where the website can show it (S3 on the live server). */
async function storeImage(buffer, mime, name) {
    const ext = (path.extname(String(name || "")) || `.${String(mime || "").split("/")[1] || "jpg"}`).replace(/[^.\w]/g, "").slice(0, 8);
    const key = `website-products/${moment().tz(TZ).format("YYYY/MM")}/${Date.now()}-${crypto.randomBytes(5).toString("hex")}${ext}`;
    if (process.env.ADMIN_FILES_LIVE === "1" || process.env.ADMIN_WA_LIVE === "1") {
        const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
        const bucket = process.env.ADMIN_FILES_BUCKET || "bpe-upload-data";
        const region = process.env.ADMIN_FILES_REGION || "ap-south-1";
        await new S3Client({ region }).send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: buffer, ContentType: mime, ACL: "public-read" }));
        return `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
    }
    const file = path.join(__dirname, "../../public", key);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, buffer);
    return `/${key}`;
}

const arr = (v) => {
    if (Array.isArray(v)) return v;
    if (typeof v === "string") {
        try {
            const j = JSON.parse(v);
            return Array.isArray(j) ? j : [];
        } catch {
            return [];
        }
    }
    return [];
};

function view(p) {
    return {
        id: p.id,
        title: p.title || "",
        price: Number(p.price) || 0,
        offerActive: !!p.offer_active,
        offerPrice: Number(p.offer_price) || 0,
        offer: p.offer || "",
        keyFeatures: arr(p.keyFeatures).map(String),
        images: arr(p.images).map(String).filter(Boolean),
        active: p.status !== false && p.status !== 0,
    };
}

async function list(s) {
    need(s, "billing.view");
    const rows = await WebSiteProducts.findAll({ order: [["id", "ASC"]], raw: true });
    return { products: rows.map(view) };
}

/**
 * Add or edit. images = the photos kept (their URLs, in order); newImages =
 * uploads { data (base64), mime, name }, added after them.
 */
async function save(s, input = {}) {
    need(s, "settings.manage");
    const title = txt(input.title, 160);
    if (title.length < 2) throw new RuleError("Write the product's name.");
    const price = Number(input.price);
    if (!(price > 0 && price <= 10000000)) throw new RuleError("Write the price (rupees, as on the website).");
    const offerActive = !!input.offerActive;
    const offerPrice = Number(input.offerPrice) || 0;
    if (offerActive && !(offerPrice > 0 && offerPrice < price)) throw new RuleError("The offer price must be more than 0 and below the price.");
    const keyFeatures = arr(input.keyFeatures).map((x) => txt(x, 200)).filter(Boolean).slice(0, 20);
    const row = input.id ? await WebSiteProducts.findByPk(Number(input.id)) : null;
    if (input.id && !row) throw new RuleError("This product no longer exists.");
    const known = row ? new Set(arr(row.images).map(String)) : new Set();
    const kept = arr(input.images).map(String).filter((u) => known.has(u));
    const uploads = arr(input.newImages);
    if (kept.length + uploads.length > MAX_IMAGES) throw new RuleError(`At most ${MAX_IMAGES} photos.`);
    const added = [];
    for (const f of uploads) {
        const mime = String(f && f.mime || "");
        if (!/^image\/(jpeg|png|webp)$/.test(mime)) throw new RuleError("Photos must be JPG, PNG or WEBP.");
        const buf = Buffer.from(String(f.data || ""), "base64");
        if (!buf.length || buf.length > MAX_IMAGE_BYTES) throw new RuleError("Each photo must be under 3 MB.");
        added.push(await storeImage(buf, mime, f.name));
    }
    const images = [...kept, ...added];
    if (!images.length) throw new RuleError("Add at least one photo.");
    const fields = { title, price, offer_active: offerActive, offer_price: offerActive ? offerPrice : 0, offer: txt(input.offer, 120), keyFeatures, images, status: input.active !== false };
    if (row) {
        const before = view(row.get({ plain: true }));
        await row.update(fields);
        await audit.write(s, { action: "product.update", entity: "website_product", entityId: row.id, summary: `Changed the product ${title}`, before, after: view(row.get({ plain: true })) });
        return { product: view(row.get({ plain: true })) };
    }
    if (await WebSiteProducts.findOne({ where: { title } })) throw new RuleError("A product with this name exists.");
    const made = await WebSiteProducts.create(fields);
    await audit.write(s, { action: "product.create", entity: "website_product", entityId: made.id, summary: `Added the product ${title}`, after: view(made.get({ plain: true })) });
    return { product: view(made.get({ plain: true })) };
}

module.exports = { list, save, view };
