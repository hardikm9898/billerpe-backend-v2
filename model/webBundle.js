const { DataTypes } = require("sequelize");
const sequelize = require("../connection/connect");

// A published build of the Web POS frontend, which every outlet's exe
// serves off its own disk (billerpe-local-exe/server.js). This row is how a
// new frontend reaches those outlets without shipping a new 185MB exe -
// see WEB-BUNDLE-DELIVERY-PLAN.md for why that mattered enough to build.
//
// The files themselves are NOT stored here: they sit on disk under the
// server's own bundle root (controller/sync/webBundleController.js), and
// this table only carries the metadata the exe needs to decide whether it
// wants them.
const WebBundle = sequelize.define("web_bundles", {
    // Plain semver of the frontend build. The exe compares this against the
    // version it already has installed - equal means "nothing to do", and
    // anything else means "install this one", including a DOWNGRADE, which
    // is the whole rollback mechanism: publish an older build as a newer
    // row and every outlet walks back to it on its next heartbeat.
    version: { type: DataTypes.STRING, allowNull: false },

    // Lets one outlet pilot a release before it reaches the rest. An exe
    // asks with the channel its hotel is assigned to; "stable" is the
    // default for everyone who was never explicitly moved.
    channel: { type: DataTypes.STRING, allowNull: false, defaultValue: "stable" },

    // Refuse-to-install floor. A frontend calling a route the installed exe
    // does not have breaks that outlet with no obvious cause - this system
    // has already produced exactly that failure once (a stale exe missing
    // /makeSequenceBillNo surfaced to staff as a spurious logout), so the
    // check is enforced on the exe BEFORE anything is downloaded.
    min_exe_version: { type: DataTypes.STRING, allowNull: true },

    // Pulling a bad release is flipping this, not deleting the row: the
    // files stay on disk and the history stays auditable.
    active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },

    notes: { type: DataTypes.STRING, allowNull: true },
});

module.exports = WebBundle;
