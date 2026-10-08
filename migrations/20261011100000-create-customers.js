'use strict';

// BillerPe SuperAdmin phase 5: customer accounts and their outlets,
// onboarding checklists, daily outlet health, customer tasks and timeline,
// and the 30-minute "open as outlet" support sessions (model/customers.js).
// New tables only: the outlet tables are not touched.
module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = (await queryInterface.showAllTables()).map((t) => (typeof t === 'string' ? t : t.tableName));
    const id = { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false };
    const bigId = { type: Sequelize.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false };
    const stamps = { createdAt: { type: Sequelize.DATE, allowNull: false }, updatedAt: { type: Sequelize.DATE, allowNull: false } };
    const Sd = (n, d = '') => ({ type: Sequelize.STRING(n), allowNull: false, defaultValue: d });
    const S = (n) => ({ type: Sequelize.STRING(n), allowNull: true });
    const I = { type: Sequelize.INTEGER, allowNull: true };
    const In = { type: Sequelize.INTEGER, allowNull: false };
    const D = { type: Sequelize.DATE, allowNull: true };
    const TXT = { type: Sequelize.TEXT, allowNull: true };
    const make = async (name, cols, indexes = []) => {
      if (tables.includes(name)) return;
      await queryInterface.createTable(name, cols);
      for (const [fields, opts] of indexes) await queryInterface.addIndex(name, fields, opts);
    };

    await make('cs_accounts', {
      id,
      name: Sd(120),
      owner_mobile: { type: Sequelize.STRING(15), allowNull: false },
      owner_name: Sd(120),
      email: Sd(120),
      city: Sd(60),
      success_owner_id: I,
      won_by_id: I,
      lead_id: I,
      origin: Sd(10, 'existing'),
      health: Sd(6, 'grey'),
      health_reasons: TXT,
      health_at: D,
      customer_since: D,
      note: Sd(500),
      ...stamps,
    }, [
      [['owner_mobile'], { unique: true, name: 'cs_accounts_mobile' }],
      [['success_owner_id'], { name: 'cs_accounts_owner' }],
      [['health'], { name: 'cs_accounts_health' }],
    ]);

    await make('cs_account_outlets', {
      id,
      account_id: In,
      hotel_id: In,
      plan_name: Sd(40),
      onboarding: Sd(8, 'none'),
      onboarding_started_at: D,
      onboarding_done_at: D,
      health: Sd(6, 'grey'),
      health_reasons: TXT,
      health_at: D,
      health_since: D,
      signals: TXT,
      linked_by: I,
      ...stamps,
    }, [
      [['hotel_id'], { unique: true, name: 'cs_account_outlets_hotel' }],
      [['account_id'], { name: 'cs_account_outlets_account' }],
      [['health'], { name: 'cs_account_outlets_health' }],
    ]);

    await make('cs_onboarding_items', {
      id,
      hotel_id: In,
      account_id: In,
      item_key: { type: Sequelize.STRING(30), allowNull: false },
      title: { type: Sequelize.STRING(120), allowNull: false },
      sort: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      auto: S(16),
      owner_id: I,
      due_at: D,
      done_at: D,
      done_by: I,
      note: Sd(300),
      ...stamps,
    }, [
      [['hotel_id', 'item_key'], { unique: true, name: 'cs_onboarding_items_hotel_key' }],
      [['owner_id', 'done_at', 'due_at'], { name: 'cs_onboarding_items_owner' }],
    ]);

    await make('cs_outlet_days', {
      id,
      hotel_id: In,
      day: { type: Sequelize.DATEONLY, allowNull: false },
      bills: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      sales: { type: Sequelize.DOUBLE, allowNull: false, defaultValue: 0 },
      health: S(6),
      reasons: TXT,
      ...stamps,
    }, [
      [['hotel_id', 'day'], { unique: true, name: 'cs_outlet_days_hotel_day' }],
      [['day'], { name: 'cs_outlet_days_day' }],
    ]);

    await make('cs_tasks', {
      id,
      account_id: In,
      hotel_id: I,
      owner_id: I,
      type: Sd(16, 'call'),
      note: Sd(300),
      due_at: { type: Sequelize.DATE, allowNull: false },
      status: Sd(10, 'open'),
      done_at: D,
      done_by: I,
      result: Sd(300),
      origin: Sd(12, 'manual'),
      ref: S(80),
      created_by: I,
      ...stamps,
    }, [
      [['ref'], { unique: true, name: 'cs_tasks_ref' }],
      [['owner_id', 'status', 'due_at'], { name: 'cs_tasks_owner_due' }],
      [['account_id', 'status'], { name: 'cs_tasks_account' }],
    ]);

    await make('cs_activities', {
      id: bigId,
      account_id: In,
      hotel_id: I,
      type: { type: Sequelize.STRING(16), allowNull: false },
      actor_id: I,
      body: Sd(1000),
      data: TXT,
      at: { type: Sequelize.DATE, allowNull: false },
      createdAt: { type: Sequelize.DATE, allowNull: false },
    }, [[['account_id', 'at'], { name: 'cs_activities_account_at' }]]);

    await make('adm_support_sessions', {
      id,
      user_id: In,
      hotel_id: In,
      reason: { type: Sequelize.STRING(300), allowNull: false },
      expires_at: { type: Sequelize.DATE, allowNull: false },
      ended_at: D,
      last_used_at: D,
      writes: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      ip: Sd(64),
      ...stamps,
    }, [
      [['hotel_id', 'createdAt'], { name: 'adm_support_sessions_hotel' }],
      [['user_id', 'createdAt'], { name: 'adm_support_sessions_user' }],
    ]);
  },

  async down(queryInterface) {
    for (const t of ['adm_support_sessions', 'cs_activities', 'cs_tasks', 'cs_outlet_days', 'cs_onboarding_items', 'cs_account_outlets', 'cs_accounts']) await queryInterface.dropTable(t);
  },
};
