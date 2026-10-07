'use strict';

// BillerPe SuperAdmin phase 1 (foundation): staff logins, roles, teams,
// leave days, sessions, audit log, settings, and the event log + job queue
// the admin worker runs from (model/admin.js). Every table is new; nothing
// the POS or the outlet PCs read is touched.
module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = (await queryInterface.showAllTables()).map((t) => (typeof t === 'string' ? t : t.tableName));
    const id = { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false };
    const bigId = { type: Sequelize.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false };
    const stamps = {
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    };

    if (!tables.includes('adm_roles')) {
      await queryInterface.createTable('adm_roles', {
        id,
        name: { type: Sequelize.STRING(60), allowNull: false },
        description: { type: Sequelize.STRING(200), allowNull: false, defaultValue: '' },
        permissions: { type: Sequelize.TEXT, allowNull: true },
        is_system: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
        ...stamps,
      });
      await queryInterface.addIndex('adm_roles', ['name'], { name: 'adm_roles_name', unique: true });
    }

    if (!tables.includes('adm_teams')) {
      await queryInterface.createTable('adm_teams', {
        id,
        name: { type: Sequelize.STRING(60), allowNull: false },
        manager_id: { type: Sequelize.INTEGER, allowNull: true },
        active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
        ...stamps,
      });
      await queryInterface.addIndex('adm_teams', ['name'], { name: 'adm_teams_name', unique: true });
    }

    if (!tables.includes('adm_users')) {
      await queryInterface.createTable('adm_users', {
        id,
        name: { type: Sequelize.STRING(80), allowNull: false },
        mobile: { type: Sequelize.STRING(10), allowNull: false },
        email: { type: Sequelize.STRING(120), allowNull: false, defaultValue: '' },
        password_hash: { type: Sequelize.STRING(100), allowNull: false },
        must_change_password: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
        role_id: { type: Sequelize.INTEGER, allowNull: false },
        team_id: { type: Sequelize.INTEGER, allowNull: true },
        manager_id: { type: Sequelize.INTEGER, allowNull: true },
        shift_start: { type: Sequelize.STRING(5), allowNull: true },
        shift_end: { type: Sequelize.STRING(5), allowNull: true },
        daily_lead_cap: { type: Sequelize.INTEGER, allowNull: true },
        languages: { type: Sequelize.STRING(60), allowNull: false, defaultValue: '' },
        status: { type: Sequelize.STRING(12), allowNull: false, defaultValue: 'active' },
        last_login_at: { type: Sequelize.DATE, allowNull: true },
        ...stamps,
      });
      await queryInterface.addIndex('adm_users', ['mobile'], { name: 'adm_users_mobile', unique: true });
      await queryInterface.addIndex('adm_users', ['role_id'], { name: 'adm_users_role' });
      await queryInterface.addIndex('adm_users', ['team_id'], { name: 'adm_users_team' });
    }

    if (!tables.includes('adm_leaves')) {
      await queryInterface.createTable('adm_leaves', {
        id,
        user_id: { type: Sequelize.INTEGER, allowNull: false },
        from_date: { type: Sequelize.DATEONLY, allowNull: false },
        to_date: { type: Sequelize.DATEONLY, allowNull: false },
        note: { type: Sequelize.STRING(160), allowNull: false, defaultValue: '' },
        created_by: { type: Sequelize.INTEGER, allowNull: true },
        ...stamps,
      });
      await queryInterface.addIndex('adm_leaves', ['user_id', 'from_date'], { name: 'adm_leaves_user_from' });
    }

    if (!tables.includes('adm_sessions')) {
      await queryInterface.createTable('adm_sessions', {
        id,
        user_id: { type: Sequelize.INTEGER, allowNull: false },
        kind: { type: Sequelize.STRING(8), allowNull: false, defaultValue: 'web' },
        device_id: { type: Sequelize.STRING(64), allowNull: false, defaultValue: '' },
        device_name: { type: Sequelize.STRING(80), allowNull: false, defaultValue: '' },
        app_version: { type: Sequelize.STRING(20), allowNull: false, defaultValue: '' },
        ip: { type: Sequelize.STRING(64), allowNull: false, defaultValue: '' },
        password_fp: { type: Sequelize.STRING(16), allowNull: false },
        push_token: { type: Sequelize.STRING(255), allowNull: true },
        last_active: { type: Sequelize.DATE, allowNull: true },
        revoked_at: { type: Sequelize.DATE, allowNull: true },
        ...stamps,
      });
      await queryInterface.addIndex('adm_sessions', ['user_id', 'revoked_at'], { name: 'adm_sessions_user_open' });
    }

    if (!tables.includes('adm_audit_log')) {
      await queryInterface.createTable('adm_audit_log', {
        id: bigId,
        actor_id: { type: Sequelize.INTEGER, allowNull: true },
        action: { type: Sequelize.STRING(60), allowNull: false },
        entity: { type: Sequelize.STRING(40), allowNull: false, defaultValue: '' },
        entity_id: { type: Sequelize.STRING(40), allowNull: false, defaultValue: '' },
        summary: { type: Sequelize.STRING(300), allowNull: false, defaultValue: '' },
        before_json: { type: Sequelize.TEXT, allowNull: true },
        after_json: { type: Sequelize.TEXT, allowNull: true },
        reason: { type: Sequelize.STRING(300), allowNull: false, defaultValue: '' },
        ip: { type: Sequelize.STRING(64), allowNull: false, defaultValue: '' },
        createdAt: { type: Sequelize.DATE, allowNull: false },
      });
      await queryInterface.addIndex('adm_audit_log', ['createdAt'], { name: 'adm_audit_time' });
      await queryInterface.addIndex('adm_audit_log', ['entity', 'entity_id'], { name: 'adm_audit_entity' });
      await queryInterface.addIndex('adm_audit_log', ['actor_id', 'createdAt'], { name: 'adm_audit_actor' });
    }

    if (!tables.includes('adm_settings')) {
      await queryInterface.createTable('adm_settings', {
        id,
        setting_key: { type: Sequelize.STRING(60), allowNull: false },
        value: { type: Sequelize.TEXT, allowNull: true },
        updated_by: { type: Sequelize.INTEGER, allowNull: true },
        ...stamps,
      });
      await queryInterface.addIndex('adm_settings', ['setting_key'], { name: 'adm_settings_key', unique: true });
    }

    if (!tables.includes('crm_events')) {
      await queryInterface.createTable('crm_events', {
        id: bigId,
        type: { type: Sequelize.STRING(60), allowNull: false },
        entity: { type: Sequelize.STRING(40), allowNull: false, defaultValue: '' },
        entity_id: { type: Sequelize.STRING(40), allowNull: false, defaultValue: '' },
        data: { type: Sequelize.TEXT, allowNull: true },
        actor_id: { type: Sequelize.INTEGER, allowNull: true },
        claimed_by: { type: Sequelize.STRING(40), allowNull: true },
        claimed_until: { type: Sequelize.DATE, allowNull: true },
        handled_at: { type: Sequelize.DATE, allowNull: true },
        attempts: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
        last_error: { type: Sequelize.STRING(500), allowNull: true },
        createdAt: { type: Sequelize.DATE, allowNull: false },
      });
      await queryInterface.addIndex('crm_events', ['handled_at', 'id'], { name: 'crm_events_pending' });
      await queryInterface.addIndex('crm_events', ['entity', 'entity_id'], { name: 'crm_events_entity' });
    }

    if (!tables.includes('crm_jobs')) {
      await queryInterface.createTable('crm_jobs', {
        id: bigId,
        kind: { type: Sequelize.STRING(60), allowNull: false },
        payload: { type: Sequelize.TEXT, allowNull: true },
        run_at: { type: Sequelize.DATE, allowNull: false },
        status: { type: Sequelize.STRING(12), allowNull: false, defaultValue: 'queued' },
        attempts: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
        max_attempts: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 3 },
        dedupe_key: { type: Sequelize.STRING(160), allowNull: true },
        claimed_by: { type: Sequelize.STRING(40), allowNull: true },
        claimed_until: { type: Sequelize.DATE, allowNull: true },
        last_error: { type: Sequelize.STRING(500), allowNull: true },
        result: { type: Sequelize.STRING(500), allowNull: true },
        done_at: { type: Sequelize.DATE, allowNull: true },
        ...stamps,
      });
      await queryInterface.addIndex('crm_jobs', ['status', 'run_at'], { name: 'crm_jobs_due' });
      await queryInterface.addIndex('crm_jobs', ['dedupe_key'], { name: 'crm_jobs_dedupe', unique: true });
    }
  },

  async down(queryInterface) {
    for (const t of ['crm_jobs', 'crm_events', 'adm_settings', 'adm_audit_log', 'adm_sessions', 'adm_leaves', 'adm_users', 'adm_teams', 'adm_roles']) {
      await queryInterface.dropTable(t);
    }
  },
};
