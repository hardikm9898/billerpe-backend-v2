// Publishes a file staff download from the Web POS (Operations -> Apps &
// Downloads, owner decision 2026-10-01). The newest active version of each
// app is what every outlet offers.
//
//   node scripts/publish-app-download.js --app installer --file /var/tmp/BillerPeLocalServer-Setup.exe --version 1.1.3 [--notes "..."]
//   node scripts/publish-app-download.js --app captain --file /var/tmp/BillerPe-Captain-1.4.apk --version 1.4 [--notes "..."]
//   node scripts/publish-app-download.js --app captain --withdraw 1.4
//
// The file is kept on this server's disk (app-downloads/<app>/<version>/, or
// APP_DOWNLOAD_ROOT). A version can never be published twice for an app.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { sequelize, AppDownload } = require("../model");
const { DOWNLOAD_ROOT } = require("../controller/sync/appDownloadController");

const APP_NAMES = {
    installer: { app: "exe-installer", fileName: (v) => `BillerPeLocalServer-Setup-${v}.exe` },
    captain: { app: "captain-app", fileName: (v) => `BillerPe-Captain-${v}.apk` },
};

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
    const kind = APP_NAMES[String(arg("app"))];
    if (!kind) {
        console.error("usage: --app installer|captain --file <path> --version <x.y.z> [--notes ...] | --app installer|captain --withdraw <x.y.z>");
        process.exitCode = 1;
        return;
    }
    await sequelize.authenticate();
    await AppDownload.sync();

    const withdraw = arg("withdraw");
    if (withdraw) {
        const [n] = await AppDownload.update({ active: false }, { where: { app: kind.app, version: String(withdraw) } });
        console.log(n ? `withdrew ${kind.app} ${withdraw} - outlets offer the newest one still active` : `no ${kind.app} ${withdraw}`);
        return;
    }

    const file = arg("file");
    const version = arg("version");
    const notes = arg("notes");
    if (!file || !version || file === true || version === true) {
        console.error("usage: --app installer|captain --file <path> --version <x.y.z> [--notes ...]");
        process.exitCode = 1;
        return;
    }
    const src = path.resolve(String(file));
    if (!fs.existsSync(src)) {
        console.error(`no file at ${src}`);
        process.exitCode = 1;
        return;
    }
    if (await AppDownload.findOne({ where: { app: kind.app, version: String(version) } })) {
        console.error(`${kind.app} ${version} already exists - publish a higher version instead`);
        process.exitCode = 1;
        return;
    }

    const fileName = kind.fileName(String(version));
    const rel = path.join(kind.app, String(version), fileName);
    fs.mkdirSync(path.join(DOWNLOAD_ROOT, kind.app, String(version)), { recursive: true });
    fs.copyFileSync(src, path.join(DOWNLOAD_ROOT, rel));
    const size = fs.statSync(src).size;
    const sha256 = await sha256Of(src);
    const created = await AppDownload.create({
        app: kind.app, version: String(version), file_name: fileName, local_path: rel,
        sha256, size_bytes: size, notes: notes === true ? null : notes, active: true,
    });
    console.log(`published ${kind.app} ${version} (id ${created.id}, ${size} bytes) - outlets offer it within a minute`);
})().catch((err) => {
    console.error("publish failed:", err.message);
    process.exitCode = 1;
}).finally(() => sequelize.close().catch(() => {}));
