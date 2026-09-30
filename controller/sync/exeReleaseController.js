const fs = require("fs");
const path = require("path");
const { S3Client, GetObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const { ExeRelease } = require("../../model");
const { STATUSCODE } = require("../../constant/const");
const { error } = require("../../responce/res");

// Automatic exe updates (owner decision 2026-09-30). The heartbeat hands an
// outlet the newest active release when it is newer than what that outlet
// reports running (header x-exe-version) - an exe that is up to date, or an
// older build that cannot update itself, is offered nothing.

const REGION = process.env.EXE_RELEASE_REGION || "ap-south-1";
// Same IAM role as services/upload.js - no keys on this server.
const s3 = new S3Client({ region: REGION });
// Long enough for a 190MB download on a slow line (the exe resumes a broken
// download with a fresh link from the next heartbeat anyway).
const LINK_SECONDS = 6 * 60 * 60;

const EXE_ROOT = process.env.EXE_RELEASE_ROOT || path.join(__dirname, "..", "..", "exe-releases");

// Releases are served from this server (no S3 yet), and every outlet is
// offered a new one within the same minute. 1000 outlets pulling 190MB at
// once would take the line sync and e-bills need, so only a few downloads
// run at a time; the rest are told to come back (503) and resume later
// where they stopped (the exe retries by itself, with a Range request).
const MAX_DOWNLOADS = Math.max(1, Number(process.env.EXE_RELEASE_MAX_DOWNLOADS) || 8);
let activeDownloads = 0;

function versionGt(a, b) {
    const pa = String(a).split(".").map((n) => parseInt(n, 10) || 0);
    const pb = String(b).split(".").map((n) => parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const x = pa[i] || 0;
        const y = pb[i] || 0;
        if (x !== y) return x > y;
    }
    return false;
}

// Newest active release by version number (not by publish time).
async function newestRelease() {
    const rows = await ExeRelease.findAll({ where: { active: true }, raw: true });
    return rows.reduce((best, r) => (!best || versionGt(r.version, best.version) ? r : best), null);
}

// { version, sha256, size, url } for an exe running `exeVersion`, or null.
// url is either a presigned S3 link or a path on this server ("/sync/...",
// the exe adds its cloud base URL and device token).
async function exeReleaseFor(exeVersion) {
    if (!exeVersion) return null;
    const row = await newestRelease();
    if (!row || !versionGt(row.version, exeVersion)) return null;
    let url;
    if (row.s3_bucket && row.s3_key) {
        url = await getSignedUrl(s3, new GetObjectCommand({ Bucket: row.s3_bucket, Key: row.s3_key }), { expiresIn: LINK_SECONDS });
    } else if (row.local_path) {
        url = `/sync/exe-release/file?version=${encodeURIComponent(row.version)}`;
    } else {
        return null;
    }
    return { version: row.version, sha256: row.sha256, size: Number(row.size_bytes), url };
}

// GET /sync/exe-release/file?version=X - only for a release kept on this
// server's disk. sendFile answers Range requests, so a broken download
// resumes where it stopped.
const getFile = async (req, res) => {
    try {
        const row = await ExeRelease.findOne({ where: { version: String(req.query.version || ""), active: true }, raw: true });
        if (!row || !row.local_path) return res.json(error("Unknown or withdrawn release", STATUSCODE.NOT_FOUND));
        const file = path.resolve(EXE_ROOT, row.local_path);
        if (!file.startsWith(path.resolve(EXE_ROOT)) || !fs.existsSync(file)) {
            return res.json(error("Release file is missing on the server", STATUSCODE.NOT_FOUND));
        }
        if (activeDownloads >= MAX_DOWNLOADS) {
            res.set("Retry-After", "300");
            return res.status(503).json(error("The server is busy sending this update to other outlets - try again shortly", 503));
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
        console.error("[exeRelease] getFile error:", err);
        return res.json(error("Could not send the release", STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

module.exports = { exeReleaseFor, getFile, versionGt, EXE_ROOT };
