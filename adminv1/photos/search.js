// Finding a menu photo by an item's name (owner 2026-10-09: "make this
// search very reliable"). Restaurant item names are typed in many ways:
// "Paneer Tikka", "panner tika", "Tikka Paneer", "Pav Bhaji" / "pavbhaji",
// "Chicken Biryani (Half)", "Masala Dosa - 2 pc". Each word is folded to a
// sound-alike form (spellings of Indian dishes vary: ee/i, oo/u, kh/k, doubled
// letters), then matched word by word in any order, allowing small typos,
// prefixes and words written together. When nothing matches well enough the
// caller gets related photos instead (same main word, then the most used).

// Words that say nothing about the dish.
const NOISE = new Set([
    "half", "full", "quarter", "qtr", "small", "medium", "large", "regular", "reg", "jumbo", "mini", "single", "double", "plate", "pc", "pcs", "piece", "pieces",
    "ml", "ltr", "l", "kg", "gm", "g", "gram", "grams", "pack", "portion", "with", "and", "of", "the", "a", "special", "spl", "new", "combo", "x", "nos", "no",
]);

const strip = (s) => String(s || "").normalize("NFKD").replace(/[̀-ͯ]/g, "");

const UNIT = /^\d+(pc|pcs|ml|l|ltr|kg|g|gm|gms|x|nos|inch|in)$/;

/** "Paneer-Tikka (Half) 2pc" -> ["paneer", "tikka"]; "Chicken 65" keeps its 65. */
function words(text) {
    const raw = strip(text)
        .toLowerCase()
        .replace(/&/g, " and ")
        .replace(/[^a-z0-9ऀ-෿]+/g, " ")
        .split(" ")
        .map((w) => w.trim())
        .filter(Boolean);
    // A number followed by a unit word ("2 pc", "500 ml") is a quantity, as is "2pc".
    return raw.filter((w, i) => !NOISE.has(w) && !UNIT.test(w) && !(/^\d+$/.test(w) && (NOISE.has(raw[i + 1] || "") || i === raw.length - 1 && raw.length > 1 && /^\d{1}$/.test(w))));
}

/** One word in its sound-alike form: "paneer" / "panner" / "panir" come close; "chiken" = "chicken". */
function fold(w) {
    let s = w;
    s = s.replace(/ph/g, "f").replace(/([bcdgjkpstr])h/g, "$1");
    s = s.replace(/ck/g, "k").replace(/q/g, "k").replace(/c/g, "k").replace(/z/g, "j").replace(/w/g, "v").replace(/x/g, "ks");
    s = s.replace(/ee/g, "i").replace(/oo/g, "u").replace(/ou/g, "u").replace(/y/g, "i").replace(/ai/g, "e").replace(/ei/g, "i");
    s = s.replace(/(.)\1+/g, "$1");
    if (s.length > 4 && /[^s]s$/.test(s)) s = s.slice(0, -1);
    if (s.length > 4 && s.endsWith("a")) s = s.slice(0, -1);
    return s;
}

/** The text as folded words, and the folded whole for "pavbhaji" = "pav bhaji". */
function prepare(text) {
    const ws = words(text).map(fold).filter(Boolean);
    return { words: ws, joined: ws.join("") };
}

/** The key that makes two names the same photo ("Paneer Tikka" = "paneer  tikka"). */
const keyOf = (name) => prepare(name).words.slice().sort().join(" ").slice(0, 140);

/** Edit distance with a cap (adjacent swaps count as one). */
function distance(a, b, cap) {
    if (Math.abs(a.length - b.length) > cap) return cap + 1;
    const m = a.length;
    const n = b.length;
    let prev2 = null;
    let prev = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) {
        const cur = [i];
        let rowMin = i;
        for (let j = 1; j <= n; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
            if (prev2 && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
            cur.push(v);
            if (v < rowMin) rowMin = v;
        }
        if (rowMin > cap) return cap + 1;
        prev2 = prev;
        prev = cur;
    }
    return prev[n];
}

const allowed = (len) => (len <= 3 ? 0 : len <= 6 ? 1 : 2);

/** How well one query word matches one photo word: 1 same, 0.85 prefix / typo, 0 none. */
function wordScore(q, p) {
    if (q === p) return 1;
    if (q.length >= 3 && p.startsWith(q)) return 0.85;
    if (p.length >= 4 && q.startsWith(p)) return 0.8;
    const cap = allowed(Math.min(q.length, p.length));
    if (cap && distance(q, p, cap) <= cap) return 0.8;
    return 0;
}

/** 0..100: how well the query (prepared) matches one name or alias (prepared). */
function phraseScore(q, p) {
    if (!q.words.length || !p.words.length) return 0;
    if (q.joined === p.joined) return 100;
    // Written together / apart: "pavbhaji" vs "pav bhaji".
    if (q.joined.length >= 5 && p.joined.length >= 5) {
        const cap = allowed(Math.min(q.joined.length, p.joined.length));
        if (distance(q.joined, p.joined, cap) <= cap) return 92;
    }
    const used = new Set();
    let got = 0;
    for (const qw of q.words) {
        let best = 0;
        let at = -1;
        p.words.forEach((pw, i) => {
            if (used.has(i)) return;
            const s = wordScore(qw, pw);
            if (s > best) {
                best = s;
                at = i;
            }
        });
        if (at >= 0) used.add(at);
        got += best;
    }
    const coverQ = got / q.words.length;
    const coverP = used.size / p.words.length;
    return Math.round(100 * coverQ * (0.55 + 0.45 * coverP));
}

/** The photo's prepared phrases: its name and each alias. */
function phrasesOf(photo) {
    const list = [photo.name, ...String(photo.aliases || "").split(",")].map((x) => x.trim()).filter(Boolean);
    return list.map(prepare);
}

const MATCH = 60;

/**
 * photos: [{ id, name, aliases, veg, cuisine, uses, ... }] (active ones).
 * Returns { matches (score >= 60, best first), related (when few matches:
 * photos sharing the main word, then the most used), sure (one clear best
 * match: same name, or 90+ and well ahead of the next) }.
 */
function search(photos, query, { limit = 24, veg = "" } = {}) {
    const q = prepare(query);
    if (!q.words.length) {
        const popular = photos.slice().sort((a, b) => b.uses - a.uses || a.name.localeCompare(b.name)).slice(0, limit);
        return { matches: [], related: popular, sure: null };
    }
    const scored = [];
    for (const ph of photos) {
        if (!ph._phrases) ph._phrases = phrasesOf(ph);
        let s = 0;
        for (const pp of ph._phrases) s = Math.max(s, phraseScore(q, pp));
        if (veg && ph.veg && ph.veg !== veg && s > 0) s -= 8;
        if (s > 0) scored.push({ ph, s });
    }
    scored.sort((a, b) => b.s - a.s || b.ph.uses - a.ph.uses || a.ph.name.length - b.ph.name.length);
    const matches = scored.filter((x) => x.s >= MATCH).slice(0, limit);
    const top = matches[0];
    const second = matches[1];
    const sure = top && (top.s === 100 || (top.s >= 90 && (!second || top.s - second.s >= 10))) ? top.ph : null;
    let related = [];
    if (matches.length < 6) {
        const seen = new Set(matches.map((x) => x.ph.id));
        // Photos sharing a word with the item ("Mutton Biryani" -> the biryanis), closest first.
        related = scored.filter((x) => !seen.has(x.ph.id)).slice(0, limit - matches.length).map((x) => x.ph);
        if (related.length + matches.length < 6) {
            const more = photos
                .filter((p) => !seen.has(p.id) && !related.includes(p) && (!veg || !p.veg || p.veg === veg))
                .sort((a, b) => b.uses - a.uses)
                .slice(0, 6 - related.length - matches.length);
            related = related.concat(more);
        }
    }
    return { matches: matches.map((x) => ({ ...x.ph, score: x.s })), related, sure };
}

module.exports = { search, keyOf, prepare, fold, words, phraseScore, distance, MATCH };
