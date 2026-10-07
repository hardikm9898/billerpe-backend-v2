// BillerPe SuperAdmin logins from the server's command line - used to create
// the very first Admin (nobody can log in to add people before that) and to
// unlock an admin who lost their password.
//
//   node scripts/admin-user.js list
//   node scripts/admin-user.js create --mobile 9876543210 --name "Hardik" [--role Admin] --yes
//   node scripts/admin-user.js reset  --mobile 9876543210 --yes
//
// Without --yes it only says what it would do. A new or reset login gets a
// temporary password, printed once; the panel asks for a new one at first
// login. Also creates the five built-in roles if they are missing.

require("dotenv").config();
const bcrypt = require("bcrypt");
const M = require("../model");
const { ensureDefaultRoles } = require("../adminv1/permissions");
const { tempPassword, mobile10 } = require("../adminv1/auth");
const audit = require("../adminv1/audit");

const args = process.argv.slice(2);
const cmd = args[0];
const opt = (name) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : undefined;
};
const yes = args.includes("--yes");

async function main() {
    await ensureDefaultRoles(M.AdmRole);
    if (cmd === "list") {
        const rows = await M.AdmUser.findAll({ order: [["id", "ASC"]], raw: true });
        const roles = new Map((await M.AdmRole.findAll({ raw: true })).map((r) => [r.id, r.name]));
        if (!rows.length) console.log("No SuperAdmin logins yet. Create the first one with: create --mobile <10 digits> --name <name> --yes");
        for (const u of rows) console.log(`${u.id}\t${u.mobile}\t${u.name}\t${roles.get(u.role_id) || "?"}\t${u.status}`);
        return;
    }
    const mobile = mobile10(opt("mobile"));
    if (!mobile) throw new Error("Give --mobile with a 10-digit number.");

    if (cmd === "create") {
        const name = String(opt("name") || "").trim();
        if (!name) throw new Error('Give --name "Full name".');
        const roleName = opt("role") || "Admin";
        const role = await M.AdmRole.findOne({ where: { name: roleName } });
        if (!role) throw new Error(`No role called "${roleName}".`);
        if (await M.AdmUser.findOne({ where: { mobile } })) throw new Error(`${mobile} already has a login. Use reset to give it a new password.`);
        if (!yes) return console.log(`Would create ${name} (${mobile}) with role ${role.name}. Add --yes to do it.`);
        const password = tempPassword();
        const user = await M.AdmUser.create({ name, mobile, role_id: role.id, password_hash: await bcrypt.hash(password, 10), must_change_password: true, status: "active" });
        await audit.write(null, { action: "staff.create", entity: "adm_user", entityId: user.id, summary: `Added ${name} from the server command line`, after: user });
        console.log(`Created ${name} (${mobile}), role ${role.name}.\nTemporary password: ${password}\nThey must set their own password at first login.`);
        return;
    }

    if (cmd === "reset") {
        const user = await M.AdmUser.findOne({ where: { mobile } });
        if (!user) throw new Error(`No login for ${mobile}.`);
        if (!yes) return console.log(`Would give ${user.name} (${mobile}) a new temporary password and log them out everywhere. Add --yes to do it.`);
        const password = tempPassword();
        await user.update({ password_hash: await bcrypt.hash(password, 10), must_change_password: true, status: "active" });
        await M.AdmSession.update({ revoked_at: new Date() }, { where: { user_id: user.id, revoked_at: null } });
        await audit.write(null, { action: "staff.reset_password", entity: "adm_user", entityId: user.id, summary: `Reset the password of ${user.name} from the server command line` });
        console.log(`New temporary password for ${user.name}: ${password}`);
        return;
    }
    throw new Error("Use list, create or reset.");
}

main()
    .then(() => M.sequelize.close())
    .catch(async (e) => {
        console.error(e.message || e);
        await M.sequelize.close().catch(() => {});
        process.exit(1);
    });
