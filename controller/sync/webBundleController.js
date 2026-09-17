const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { WebBundle } = require("../../model");
const { STATUSCODE, MESSAGE } = require("../../constant/const");
const { success, error } = require("../../responce/res");

// Published frontend builds live on disk, one folder per version, with the
// database only holding each version's metadata (model/webBundle.js).
//
// Overridable so a deployment can point this at a mounted volume instead of
// the app directory - the files are build output, not application code, and
// on most hosts the app directory is redeployed out from under them.
const BUNDLE_ROOT = process.env.WEB_BUNDLE_ROOT
    || path.join(__dirname, "..", "..", "web-bundles");

const bundleDir = (version) => path.join(BUNDLE_ROOT, version);

// Deliberately NOT an archive. Shipping a tar/zip would mean adding an
// archive library to billerpe-local-exe, and every native dependency there
// is a new way for the packaged exe to break (pkg has already bitten this
// project once, with fs.cpSync against its virtual snapshot filesystem).
// A Vite build is a couple of dozen files, downloaded once per release, so
// per-file transfer costs nothing real and buys per-file integrity checks
// and a resumable update instead of one all-or-nothing blob.
function listBundleFiles(dir, base = dir) {
    const out = [];
    for (const entry of fs.readdirSync(dir)) {
        const full = path.join(dir, entry);
        if (fs.statSync(full).isDirectory()) {
            out.push(...listBundleFiles(full, base));
            continue;
        }
        const buf = fs.readFileSync(full);
        out.push({
            // Forward slashes: this path is used verbatim as a URL and as a
            // relative path on the exe, which may be on a different OS.
            path: path.relative(base, full).split(path.sep).join("/"),
            sha256: crypto.createHash("sha256").update(buf).digest("hex"),
            bytes: buf.length,
        });
    }
    return out;
}

// What the exe's heartbeat carries: the newest active build for this
// hotel's channel, or null when there is nothing to offer. Returned inline
// by syncController's heartbeat so an update still costs ZERO extra
// requests while no release is pending.
async function currentBundleFor(channel = "stable") {
    const row = await WebBundle.findOne({
        where: { channel, active: true },
        order: [["createdAt", "DESC"]],
    });
    if (!row) return null;
    if (!fs.existsSync(path.join(bundleDir(row.version), "index.html"))) return null;
    return { version: row.version, minExeVersion: row.min_exe_version || null };
}

const getManifest = async (req, res) => {
    try {
        const { version } = req.query;
        if (!version) return res.json(error("version is required", STATUSCODE.BAD_REQUEST));

        const row = await WebBundle.findOne({ where: { version, active: true } });
        if (!row) return res.json(error("Unknown or withdrawn bundle version", STATUSCODE.NOT_FOUND));

        const dir = bundleDir(row.version);
        if (!fs.existsSync(path.join(dir, "index.html"))) {
            return res.json(error("Bundle files are missing on the server", STATUSCODE.NOT_FOUND));
        }

        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, {
            version: row.version,
            minExeVersion: row.min_exe_version || null,
            files: listBundleFiles(dir),
        }, STATUSCODE.SUCCESS));
    } catch (err) {
        console.error("[webBundle] getManifest error:", err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

const getFile = async (req, res) => {
    try {
        const { version, path: filePath } = req.query;
        if (!version || !filePath) {
            return res.json(error("version and path are required", STATUSCODE.BAD_REQUEST));
        }

        const row = await WebBundle.findOne({ where: { version, active: true } });
        if (!row) return res.json(error("Unknown or withdrawn bundle version", STATUSCODE.NOT_FOUND));

        // Path traversal guard: `path` arrives from the client, so the
        // resolved file has to be proven to sit inside this version's own
        // folder before anything is read off disk.
        const dir = path.resolve(bundleDir(row.version));
        const target = path.resolve(dir, filePath);
        if (target !== dir && !target.startsWith(dir + path.sep)) {
            return res.json(error("Invalid path", STATUSCODE.BAD_REQUEST));
        }
        if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
            return res.json(error("No such file in this bundle", STATUSCODE.NOT_FOUND));
        }

        return res.sendFile(target);
    } catch (err) {
        console.error("[webBundle] getFile error:", err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

module.exports = { getManifest, getFile, currentBundleFor, BUNDLE_ROOT, bundleDir };
