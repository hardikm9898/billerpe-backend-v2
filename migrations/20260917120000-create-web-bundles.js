'use strict';

// Published Web POS frontend builds (model/webBundle.js,
// controller/sync/webBundleController.js). Every outlet's exe serves the POS
// off its own disk so a terminal can load it with no internet at all; this
// table is how a NEW frontend reaches those outlets without shipping a new
// 185MB exe to each one. See WEB-BUNDLE-DELIVERY-PLAN.md.
//
// The build's files are NOT in the database - they live under
// WEB_BUNDLE_ROOT on the server's own disk, one folder per version. This
// table only carries what an exe needs to decide whether it wants them,
// which the 60s heartbeat hands over inline (so checking for a new frontend
// costs an outlet no extra request).
//
// Created as a migration rather than left to server.js's boot-time sync:
// that path is deliberately conservative on an existing database (it skips
// ALTER for anything in TABLES_TO_SKIP_ALTER and blocks index creation), so
// a table this one depends on should be made explicitly, not incidentally.
module.exports = {
  async up(queryInterface, Sequelize) {
    // Tolerates the table already being there. On the machine this was
    // developed on it was created out-of-band by the publish script's own
    // WebBundle.sync() before this migration existed; production has no
    // such table and takes the normal path. Checked rather than assumed so
    // the migration is safe to run in either state.
    const existing = await queryInterface.showAllTables();
    const names = existing.map((t) => (typeof t === 'string' ? t : t.tableName));
    if (names.includes('web_bundles')) {
      console.log('[migration] web_bundles already exists - skipping create');
      return;
    }

    await queryInterface.createTable('web_bundles', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      // Plain semver of the frontend build. An exe compares this against
      // what it already has: equal means nothing to do, ANY difference
      // means install, including a lower number - that is deliberately the
      // rollback mechanism (publish the old build as a new row and every
      // outlet walks back to it within a minute).
      version: {
        type: Sequelize.STRING(64),
        allowNull: false,
      },
      // Lets one outlet pilot a release before the rest get it.
      channel: {
        type: Sequelize.STRING(32),
        allowNull: false,
        defaultValue: 'stable',
      },
      // Refuse-to-install floor, enforced on the exe BEFORE it downloads
      // anything. A frontend calling a route the installed exe does not
      // have breaks that outlet with no obvious cause - this system has
      // already produced exactly that once, when a stale exe missing
      // /makeSequenceBillNo surfaced to staff as a spurious logout.
      min_exe_version: {
        type: Sequelize.STRING(64),
        allowNull: true,
      },
      // Withdrawing a bad release is flipping this, not deleting the row:
      // the files stay on disk and the history stays auditable.
      active: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      notes: {
        type: Sequelize.STRING(255),
        allowNull: true,
      },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });

    // The heartbeat's lookup is "newest active build on this channel", run
    // once per outlet per minute - the one query that has to stay cheap.
    await queryInterface.addIndex('web_bundles', ['channel', 'active', 'createdAt'], {
      name: 'web_bundles_channel_active_created',
    });

    // A version is the identity an exe stores and compares against, so two
    // rows sharing one would leave outlets disagreeing about what "1.0.4"
    // contains with nothing to tell them to look again.
    await queryInterface.addIndex('web_bundles', ['version'], {
      name: 'web_bundles_version_unique',
      unique: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('web_bundles');
  },
};
