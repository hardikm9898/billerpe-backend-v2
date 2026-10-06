// Push notifications in the language of each owner's phone (Hindi /
// Gujarati, chosen in the app's Profile and saved on owner_devices.language).
// Android shows a push while the app is closed, so the app's own screen
// translator never sees it: the cloud translates the title and body here.
//
// Same rules and the SAME dictionaries as the app (BillerPe Owner App
// app/src/lib/i18n/index.ts + hi.json / gu.json): the JSON files in
// ownerv1/i18n/ are copies, refreshed with the app's
// `node scripts/copy-dicts-to-cloud.cjs` whenever the dictionaries change.

const fs = require("fs");
const path = require("path");

const cache = new Map(); // lang -> { exact, patterns }

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function dictionary(lang) {
    if (cache.has(lang)) return cache.get(lang);
    let dict = {};
    try {
        dict = JSON.parse(fs.readFileSync(path.join(__dirname, "i18n", `${lang}.json`), "utf8"));
    } catch {
        dict = {};
    }
    const exact = new Map();
    const patterns = [];
    for (const [en, to] of Object.entries(dict)) {
        if (!to) continue;
        if (/\{\d\}/.test(en)) {
            const re = new RegExp(`^${escape(en).replace(/\\\{(\d)\\\}/g, "(.*?)")}$`, "s");
            patterns.push({ re, to, dotted: en.includes("·") });
        } else exact.set(en, to);
    }
    patterns.sort((a, b) => b.re.source.length - a.re.source.length);
    const d = { exact, patterns };
    cache.set(lang, d);
    return d;
}

function keepSpaces(orig, to) {
    const lead = /^\s*/.exec(orig)[0];
    const trail = /\s*$/.exec(orig)[0];
    return lead + to + trail;
}

function make(d) {
    function translateOne(t) {
        const hit = d.exact.get(t);
        if (hit !== undefined) return hit;
        for (const p of d.patterns) {
            const m = p.re.exec(t);
            if (m && m.slice(1).every((v) => v.length <= 60 && !/[;!?]|\.\s/.test(v) && (p.dotted || !v.includes("·")))) {
                return p.to.replace(/\{(\d)\}/g, (_, i) => translateValue(m[Number(i) + 1] || ""));
            }
        }
        return null;
    }
    function translateValue(v) {
        const t = v.trim();
        if (!t) return v;
        const hit = d.exact.get(t);
        if (hit !== undefined) return keepSpaces(v, hit);
        if (!v.includes("·")) {
            const out = /\d/.test(t) ? translateOne(t) : null;
            return out === null ? v : keepSpaces(v, out);
        }
        return v
            .split(/(\s*·\s*)/)
            .map((part) => {
                if (!part.trim() || part.includes("·")) return part;
                const out = translateOne(part.trim());
                return out === null ? part : keepSpaces(part, out);
            })
            .join("");
    }
    function translate(text) {
        const t = String(text || "").replace(/\s+/g, " ").trim();
        if (!t) return null;
        if (t.startsWith("· ")) {
            const rest = translate(t.slice(2));
            return rest === null ? null : `· ${rest}`;
        }
        const whole = translateOne(t);
        if (whole !== null) return whole;
        if (t.includes(" · ")) {
            const parts = t.split(" · ");
            const out = parts.map((x) => translateOne(x) ?? x);
            if (out.some((x, i) => x !== parts[i])) return out.join(" · ");
        }
        return null;
    }
    return translate;
}

/** `text` in `lang` ("hi" / "gu"); English (or anything unknown) as it is. */
function tr(text, lang) {
    if (!text || (lang !== "hi" && lang !== "gu")) return text;
    return make(dictionary(lang))(text) ?? text;
}

module.exports = { tr };
