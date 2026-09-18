'use strict';

// Phase A of the local-first architecture migration (see the architecture
// memo): the central authority for "which PC is this restaurant's active
// local server". Nothing like this existed before this migration -
// controller/deviceRegistration.js on billerpe-local-exe never had a real
// device-registration endpoint to call on this side; today's registration
// is just the owner's normal login, so nothing stops two PCs from both
// registering as the same hotel's active server.
//
// MySQL has no native partial-unique-index syntax (`UNIQUE ... WHERE
// status = 'active'`, which Postgres/SQLite support directly), so "only one
// active row per hotel_id" is emulated with a STORED generated column that
// collapses to NULL for every non-active row - MySQL treats multiple NULLs
// in a UNIQUE index as distinct, so only rows that are actually active can
// ever collide on hotel_id. This is what makes §6 of the architecture spec
// ("one active local server per restaurant") a real database constraint
// instead of an app-level check-then-insert with a race window.
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // createTable is CREATE TABLE IF NOT EXISTS under the hood, so it never
    // errors here even when server.js's boot-time sync() already created
    // this table - but model/localServerRegistration.js declares its own
    // `indexes: [{fields:["hotel_id"]}, {fields:["device_id"]}]`, and
    // that sync-driven creation applies those too (skip-listed only means
    // an EXISTING table is never ALTERed, not that a fresh CREATE skips its
    // model's declared indexes). This migration's own addIndex calls below
    // then collide with the exact same auto-generated names Sequelize
    // already gave them - confirmed live, 2026-09-18: "Duplicate key name
    // 'local_server_registrations_hotel_id'".
    await queryInterface.createTable('local_server_registrations', {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      hotel_id: { type: Sequelize.INTEGER, allowNull: false },
      device_id: { type: Sequelize.STRING, allowNull: false },
      installation_id: { type: Sequelize.STRING, allowNull: false },
      status: { type: Sequelize.ENUM('active', 'released'), allowNull: false, defaultValue: 'active' },
      hostname: { type: Sequelize.STRING, allowNull: true },
      app_version: { type: Sequelize.STRING, allowNull: true },
      os_info: { type: Sequelize.STRING, allowNull: true },
      registered_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
      released_at: { type: Sequelize.DATE, allowNull: true },
      released_by: { type: Sequelize.INTEGER, allowNull: true },
      last_seen_at: { type: Sequelize.DATE, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
    });

    const indexes = await queryInterface.showIndex('local_server_registrations');
    if (!indexes.some((i) => i.name === 'local_server_registrations_hotel_id')) {
      await queryInterface.addIndex('local_server_registrations', ['hotel_id']);
    }
    if (!indexes.some((i) => i.name === 'local_server_registrations_device_id')) {
      await queryInterface.addIndex('local_server_registrations', ['device_id']);
    }

    // The generated column + its unique index are pure raw SQL, not
    // expressible on the model at all - sync() can never create these, so
    // they need only the ordinary "did a previous run already get here"
    // guard for a safe re-run after this migration failed on the indexes
    // above.
    const columns = await queryInterface.describeTable('local_server_registrations');
    if (!columns.active_hotel_id) {
      // MySQL's real, documented restriction (confirmed live, 2026-09-18,
      // by actually dropping the FK and watching the identical ADD COLUMN
      // succeed - this was NOT a table-rebuild-vs-FK timing quirk, and
      // FOREIGN_KEY_CHECKS=0 does nothing for it): a generated column's
      // expression cannot use a base column that carries a foreign key
      // with an ON UPDATE/ON DELETE action other than RESTRICT/NO ACTION.
      // hotel_id's FK used CASCADE on both, which is exactly what this
      // rejects - hotel_id being a normal (non-generated) column doesn't
      // exempt it once active_hotel_id's expression reads it.
      //
      // Fixed by dropping the FK, adding the generated column, then
      // recreating the FK as RESTRICT instead of CASCADE - not just a
      // workaround, a real (and now unavoidable) semantic change: deleting
      // a Hotel row no longer auto-deletes its registration history, it
      // fails until that history is dealt with explicitly. Confirmed
      // nothing in this codebase ever calls Hotel.destroy() today, so this
      // has no live behavior to break - see model/index.js's matching
      // association, updated the same way so a FRESH install's sync()
      // creates the FK this way from the start instead of hitting this
      // exact failure on its very first boot.
      //
      // The constraint name is looked up rather than assumed
      // (`local_server_registrations_ibfk_1` is MySQL's own auto-generated
      // default and only reliable because this table happens to have
      // exactly one FK) - portable across whatever a given environment's
      // MySQL actually named it.
      const [fk] = await queryInterface.sequelize.query(`
        SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'local_server_registrations'
          AND COLUMN_NAME = 'hotel_id'
          AND REFERENCED_TABLE_NAME = 'hotel_registrations'
      `, { type: Sequelize.QueryTypes.SELECT });
      if (fk) {
        await queryInterface.sequelize.query(
          `ALTER TABLE local_server_registrations DROP FOREIGN KEY \`${fk.CONSTRAINT_NAME}\``,
        );
      }

      await queryInterface.sequelize.query(`
        ALTER TABLE local_server_registrations
        ADD COLUMN active_hotel_id INT
          GENERATED ALWAYS AS (CASE WHEN status = 'active' THEN hotel_id ELSE NULL END) STORED
      `);
      await queryInterface.sequelize.query(`
        ALTER TABLE local_server_registrations
        ADD UNIQUE INDEX uniq_active_hotel (active_hotel_id)
      `);

      await queryInterface.sequelize.query(`
        ALTER TABLE local_server_registrations
        ADD CONSTRAINT local_server_registrations_hotel_fk
        FOREIGN KEY (hotel_id) REFERENCES hotel_registrations(id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
      `);
    }
  },

  async down(queryInterface) {
    await queryInterface.dropTable('local_server_registrations');
  },
};
