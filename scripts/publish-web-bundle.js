// Publishes a built Web POS frontend so every outlet's exe picks it up on
// its next heartbeat (WEB-BUNDLE-DELIVERY-PLAN.md phases 2-3).
//
//   node scripts/publish-web-bundle.js --dir ../billerpe-pos-pro-v2/dist/client \
//        --version 1.0.0 --min-exe 0.1.0 [--channel stable] [--notes "..."]
//
// Copies the build into this server's bundle root and records the version.
// The exe does the rest: it downloads per-file, checksums each one, and only
// then repoints itself at the new bundle.

const fs = require("fs");
const path = require("path");
const { sequelize, WebBundle } = require("../model");
const { bundleDir } = require("../controller/sync/webBundleController");

function arg(name, fallback = null) {
    const i = process.argv.indexOf(`--${name}`);
    return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function copyDir(src, dest) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src)) {
        const from = path.join(src, entry);
        const to = path.join(dest, entry);
        if (fs.statSync(from).isDirectory()) copyDir(from, to);
        else fs.copyFileSync(from, to);
    }
}

(async () => {
    const dir = arg("dir");
    const version = arg("version");
    const channel = arg("channel", "stable");
    const minExe = arg("min-exe");
    const notes = arg("notes");

    if (!dir || !version) {
        console.error("usage: --dir <build dir> --version <semver> [--min-exe <semver>] [--channel stable] [--notes ...]");
        process.exit(1);
    }
    const src = path.resolve(dir);
    if (!fs.existsSync(path.join(src, "index.html"))) {
        console.error(`no index.html in ${src} - is that the built client directory?`);
        process.exit(1);
    }

    const target = bundleDir(version);
    // Republishing the same version would leave outlets that already pulled
    // it serving different files under the same name, with nothing to tell
    // them to look again. Force a new version instead.
    if (fs.existsSync(target)) {
        console.error(`bundle ${version} already exists at ${target} - publish a new version instead`);
        process.exit(1);
    }

    await sequelize.authenticate();
    await WebBundle.sync();

    copyDir(src, target);
    const row = await WebBundle.create({
        version, channel, min_exe_version: minExe, notes, active: true,
    });

    const count = fs.readdirSync(target, { recursive: true }).length;
    console.log(`published ${version} (channel ${channel}, min exe ${minExe || "none"})`);
    console.log(`  files : ${count} -> ${target}`);
    console.log(`  row   : web_bundles id=${row.id}`);
    console.log("Outlets will install it on their next heartbeat.");
    await sequelize.close();
})().catch((err) => {
    console.error("publish failed:", err.message);
    process.exit(1);
});
