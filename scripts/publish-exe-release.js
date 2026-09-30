// Publishes a new outlet local server (billerpe-local-exe.exe). Every outlet
// running an older version downloads it on its next heartbeat and installs
// it at night or when staff press "Restart & update" (owner decision
// 2026-09-30). See controller/sync/exeReleaseController.js.
//
//   node scripts/publish-exe-release.js --file /tmp/billerpe-local-exe.exe --version 1.1.0 [--notes "..."]
//       uploads to S3 (bucket EXE_RELEASE_BUCKET, default bpe-upload-data,
//       region ap-south-1, this server's IAM role) and makes it live
//   ... --local        keeps the file on this server's disk instead of S3
//   node scripts/publish-exe-release.js --withdraw 1.1.0
//       stops offering it (outlets that have not installed it yet never will)
//
// The version must match the exe's own package.json version - the exe
// compares that against it - and can never be published twice.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const { sequelize, ExeRelease } = require("../model");
const { EXE_ROOT } = require("../controller/sync/exeReleaseController");

function arg(name, fallback = null) {
    const i = process.argv.indexOf(`--${name}`);
    if (i === -1) return fallback;
    const next = process.argv[i + 1];
    return next && !next.startsWith("--") ? next : true;
}

const sha256Of = (file) => new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    fs.createReadStream(file).on("data", (d) => hash.update(d)).on("end", () => resolve(hash.digest("hex"))).on("error", reject);
});

(async () => {
    await sequelize.authenticate();
    await ExeRelease.sync();

    const withdraw = arg("withdraw");
    if (withdraw) {
        const [n] = await ExeRelease.update({ active: false }, { where: { version: String(withdraw) } });
        console.log(n ? `withdrew ${withdraw} - outlets stop being offered it on their next heartbeat` : `no release ${withdraw}`);
        return;
    }

    const file = arg("file");
    const version = arg("version");
    const notes = arg("notes");
    const local = arg("local") === true;
    if (!file || !version || file === true || version === true) {
        console.error("usage: --file <billerpe-local-exe.exe> --version <x.y.z> [--notes ...] [--local] | --withdraw <x.y.z>");
        process.exitCode = 1;
        return;
    }
    const src = path.resolve(String(file));
    if (!fs.existsSync(src)) {
        console.error(`no file at ${src}`);
        process.exitCode = 1;
        return;
    }
    if (await ExeRelease.findOne({ where: { version: String(version) } })) {
        console.error(`release ${version} already exists - publish a higher version instead`);
        process.exitCode = 1;
        return;
    }

    const size = fs.statSync(src).size;
    const sha256 = await sha256Of(src);
    const row = { version: String(version), sha256, size_bytes: size, notes: notes === true ? null : notes, active: true };

    if (local) {
        const rel = path.join(String(version), "billerpe-local-exe.exe");
        fs.mkdirSync(path.join(EXE_ROOT, String(version)), { recursive: true });
        fs.copyFileSync(src, path.join(EXE_ROOT, rel));
        row.local_path = rel;
        console.log(`copied to ${path.join(EXE_ROOT, rel)}`);
    } else {
        const bucket = process.env.EXE_RELEASE_BUCKET || "bpe-upload-data";
        const key = `exe-releases/${version}/billerpe-local-exe.exe`;
        const s3 = new S3Client({ region: process.env.EXE_RELEASE_REGION || "ap-south-1" });
        console.log(`uploading ${(size / 1048576).toFixed(1)} MB to s3://${bucket}/${key} ...`);
        // Private object: outlets get a presigned link on their heartbeat.
        await s3.send(new PutObjectCommand({
            Bucket: bucket, Key: key, Body: fs.createReadStream(src), ContentLength: size,
            ContentType: "application/octet-stream",
        }));
        row.s3_bucket = bucket;
        row.s3_key = key;
    }

    const created = await ExeRelease.create(row);
    console.log(`published exe ${version} (id ${created.id}, ${size} bytes, sha256 ${sha256})`);
    console.log("Outlets on an older version download it within a minute and install it at night or on 'Restart & update'.");
})().catch((err) => {
    console.error("publish failed:", err.message);
    process.exitCode = 1;
}).finally(() => sequelize.close().catch(() => {}));
