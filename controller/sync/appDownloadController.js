const fs = require("fs");
const path = require("path");
const { AppDownload } = require("../../model");
const { STATUSCODE, MESSAGE } = require("../../constant/const");
const { success, error } = require("../../responce/res");
const { versionGt } = require("./exeReleaseController");

// Files staff download from the Web POS (Operations -> Apps & Downloads,
// owner decision 2026-10-01): the local server installer and the Captain
// App APK, published with scripts/publish-app-download.js. Only an outlet's
// exe (device token) asks for them; it keeps a copy and serves its own PC
// and phones, so each outlet fetches a version from here once.

const APPS = ["exe-installer", "captain-app"];
const DOWNLOAD_ROOT = process.env.APP_DOWNLOAD_ROOT || path.join(__dirname, "..", "..", "app-downloads");
// A few at a time, like exe releases (exeReleaseController MAX_DOWNLOADS):
// sync and e-bills share this line.
const MAX_DOWNLOADS = Math.max(1, Number(process.env.APP_DOWNLOAD_MAX_DOWNLOADS) || 8);
let activeDownloads = 0;

// Newest active row per app, by version number.
async function newestPerApp() {
    const rows = await AppDownload.findAll({ where: { active: true }, raw: true });
    const best = new Map();
    for (const r of rows) {
        const cur = best.get(r.app);
        if (!cur || versionGt(r.version, cur.version)) best.set(r.app, r);
    }
    return APPS.map((app) => best.get(app)).filter(Boolean);
}

// GET /sync/app-downloads - what the outlet can offer for download.
const listDownloads = async (req, res) => {
    try {
        const downloads = (await newestPerApp()).map((r) => ({
            app: r.app, version: r.version, fileName: r.file_name, size: Number(r.size_bytes),
            sha256: r.sha256, notes: r.notes, publishedAt: r.createdAt,
        }));
        return res.json(success(MESSAGE.SUCCESS, { downloads }, STATUSCODE.SUCCESS));
    } catch (err) {
        console.error("[appDownload] list error:", err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

// GET /sync/app-downloads/file?app=X&version=Y - the file itself (Range
// requests answered by sendFile).
const getFile = async (req, res) => {
    try {
        const row = await AppDownload.findOne({
            where: { app: String(req.query.app || ""), version: String(req.query.version || ""), active: true },
            raw: true,
        });
        if (!row) return res.json(error("Unknown or withdrawn download", STATUSCODE.NOT_FOUND));
        const file = path.resolve(DOWNLOAD_ROOT, row.local_path);
        if (!file.startsWith(path.resolve(DOWNLOAD_ROOT)) || !fs.existsSync(file)) {
            return res.json(error("The file is missing on the server", STATUSCODE.NOT_FOUND));
        }
        if (activeDownloads >= MAX_DOWNLOADS) {
            res.set("Retry-After", "60");
            return res.status(503).json(error("The server is busy - try again in a minute", 503));
        }
        activeDownloads++;
        let released = false;
        const release = () => {
            if (released) return;
            released = true;
            activeDownloads--;
        };
        res.on("close", release);
        res.on("finish", release);
        return res.sendFile(file, { headers: { "Content-Type": "application/octet-stream" } }, (err) => {
            release();
            if (err && !res.headersSent) res.status(500).end();
        });
    } catch (err) {
        console.error("[appDownload] getFile error:", err);
        return res.json(error("Could not send the file", STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

module.exports = { listDownloads, getFile, APPS, DOWNLOAD_ROOT };
