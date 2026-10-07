'use strict';

// BillerPe SuperAdmin phase 2 (sales CRM core): stages, outcomes, lost
// reasons, leads, inquiries, tasks (the next actions), timeline, calls,
// assignment history, notifications and breaks (model/crm.js). New tables
// only; the old crm_*_msts tables are left as they are.
module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = (await queryInterface.showAllTables()).map((t) => (typeof t === 'string' ? t : t.tableName));
    const id = { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false };
    const bigId = { type: Sequelize.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false };
    const stamps = { createdAt: { type: Sequelize.DATE, allowNull: false }, updatedAt: { type: Sequelize.DATE, allowNull: false } };
    const make = async (name, cols, indexes = []) => {
      if (tables.includes(name)) return;
      await queryInterface.createTable(name, cols);
      for (const [fields, opts] of indexes) await queryInterface.addIndex(name, fields, opts);
    };

    await make('crm_stages', {
      id,
      stage_key: { type: Sequelize.STRING(30), allowNull: false },
      name: { type: Sequelize.STRING(60), allowNull: false },
      kind: { type: Sequelize.STRING(8), allowNull: false, defaultValue: 'open' },
      sort: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      hours_allowed: { type: Sequelize.INTEGER, allowNull: true },
      active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      is_system: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      ...stamps,
    }, [[['stage_key'], { name: 'crm_stages_key', unique: true }]]);

    await make('crm_lost_reasons', {
      id,
      reason_key: { type: Sequelize.STRING(30), allowNull: false },
      name: { type: Sequelize.STRING(80), allowNull: false },
      revisit_days: { type: Sequelize.INTEGER, allowNull: true },
      sort: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      is_system: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      ...stamps,
    }, [[['reason_key'], { name: 'crm_lost_reasons_key', unique: true }]]);

    await make('crm_outcomes', {
      id,
      outcome_key: { type: Sequelize.STRING(30), allowNull: false },
      name: { type: Sequelize.STRING(60), allowNull: false },
      reached: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      next_type: { type: Sequelize.STRING(16), allowNull: true },
      next_after_minutes: { type: Sequelize.INTEGER, allowNull: true },
      suggest_stage_key: { type: Sequelize.STRING(30), allowNull: true },
      lost_reason_key: { type: Sequelize.STRING(30), allowNull: true },
      sort: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      is_system: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      ...stamps,
    }, [[['outcome_key'], { name: 'crm_outcomes_key', unique: true }]]);

    await make('crm_leads', {
      id,
      name: { type: Sequelize.STRING(120), allowNull: false, defaultValue: '' },
      phone: { type: Sequelize.STRING(24), allowNull: false, defaultValue: '' },
      phone_key: { type: Sequelize.STRING(15), allowNull: false, defaultValue: '' },
      phone_valid: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      alt_phone: { type: Sequelize.STRING(24), allowNull: false, defaultValue: '' },
      email: { type: Sequelize.STRING(120), allowNull: false, defaultValue: '' },
      restaurant_name: { type: Sequelize.STRING(120), allowNull: false, defaultValue: '' },
      business_type: { type: Sequelize.STRING(30), allowNull: false, defaultValue: '' },
      city: { type: Sequelize.STRING(60), allowNull: false, defaultValue: '' },
      state: { type: Sequelize.STRING(40), allowNull: false, defaultValue: '' },
      outlets_count: { type: Sequelize.INTEGER, allowNull: true },
      tables_count: { type: Sequelize.INTEGER, allowNull: true },
      current_software: { type: Sequelize.STRING(80), allowNull: false, defaultValue: '' },
      plan_interest: { type: Sequelize.STRING(30), allowNull: false, defaultValue: '' },
      hardware_need: { type: Sequelize.STRING(120), allowNull: false, defaultValue: '' },
      budget: { type: Sequelize.STRING(60), allowNull: false, defaultValue: '' },
      decision_maker: { type: Sequelize.STRING(120), allowNull: false, defaultValue: '' },
      expected_start: { type: Sequelize.DATEONLY, allowNull: true },
      source: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'manual' },
      source_detail: { type: Sequelize.TEXT, allowNull: true },
      stage_id: { type: Sequelize.INTEGER, allowNull: false },
      owner_id: { type: Sequelize.INTEGER, allowNull: true },
      score: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      next_action_at: { type: Sequelize.DATE, allowNull: true },
      next_action_type: { type: Sequelize.STRING(16), allowNull: true },
      next_action_note: { type: Sequelize.STRING(200), allowNull: true },
      last_activity_at: { type: Sequelize.DATE, allowNull: true },
      first_contact_at: { type: Sequelize.DATE, allowNull: true },
      response_due_at: { type: Sequelize.DATE, allowNull: true },
      lost_reason_id: { type: Sequelize.INTEGER, allowNull: true },
      lost_note: { type: Sequelize.STRING(300), allowNull: false, defaultValue: '' },
      revisit_at: { type: Sequelize.DATE, allowNull: true },
      won_at: { type: Sequelize.DATE, allowNull: true },
      closed_at: { type: Sequelize.DATE, allowNull: true },
      hotel_id: { type: Sequelize.INTEGER, allowNull: true },
      merged_into_id: { type: Sequelize.INTEGER, allowNull: true },
      legacy_id: { type: Sequelize.STRING(40), allowNull: true },
      created_by: { type: Sequelize.INTEGER, allowNull: true },
      deleted_at: { type: Sequelize.DATE, allowNull: true },
      ...stamps,
    }, [
      [['phone_key'], { name: 'crm_leads_phone_key' }],
      [['owner_id', 'next_action_at'], { name: 'crm_leads_owner_next' }],
      [['stage_id', 'next_action_at'], { name: 'crm_leads_stage_next' }],
      [['revisit_at'], { name: 'crm_leads_revisit' }],
      [['legacy_id'], { name: 'crm_leads_legacy', unique: true }],
      [['createdAt'], { name: 'crm_leads_created' }],
    ]);

    await make('crm_inquiries', {
      id,
      lead_id: { type: Sequelize.INTEGER, allowNull: false },
      source: { type: Sequelize.STRING(20), allowNull: false },
      external_id: { type: Sequelize.STRING(80), allowNull: true },
      name: { type: Sequelize.STRING(120), allowNull: false, defaultValue: '' },
      phone: { type: Sequelize.STRING(40), allowNull: false, defaultValue: '' },
      email: { type: Sequelize.STRING(120), allowNull: false, defaultValue: '' },
      message: { type: Sequelize.STRING(1000), allowNull: false, defaultValue: '' },
      source_detail: { type: Sequelize.TEXT, allowNull: true },
      received_at: { type: Sequelize.DATE, allowNull: false },
      legacy_id: { type: Sequelize.STRING(40), allowNull: true },
      ...stamps,
    }, [
      [['lead_id'], { name: 'crm_inquiries_lead' }],
      [['external_id'], { name: 'crm_inquiries_external', unique: true }],
      [['legacy_id'], { name: 'crm_inquiries_legacy', unique: true }],
    ]);

    await make('crm_tasks', {
      id,
      lead_id: { type: Sequelize.INTEGER, allowNull: false },
      owner_id: { type: Sequelize.INTEGER, allowNull: true },
      type: { type: Sequelize.STRING(16), allowNull: false, defaultValue: 'call' },
      note: { type: Sequelize.STRING(300), allowNull: false, defaultValue: '' },
      due_at: { type: Sequelize.DATE, allowNull: false },
      status: { type: Sequelize.STRING(10), allowNull: false, defaultValue: 'open' },
      done_at: { type: Sequelize.DATE, allowNull: true },
      done_by: { type: Sequelize.INTEGER, allowNull: true },
      outcome_id: { type: Sequelize.INTEGER, allowNull: true },
      origin: { type: Sequelize.STRING(12), allowNull: false, defaultValue: 'manual' },
      created_by: { type: Sequelize.INTEGER, allowNull: true },
      legacy_id: { type: Sequelize.STRING(40), allowNull: true },
      ...stamps,
    }, [
      [['lead_id', 'status'], { name: 'crm_tasks_lead_status' }],
      [['owner_id', 'status', 'due_at'], { name: 'crm_tasks_owner_due' }],
      [['legacy_id'], { name: 'crm_tasks_legacy', unique: true }],
    ]);

    await make('crm_activities', {
      id: bigId,
      lead_id: { type: Sequelize.INTEGER, allowNull: false },
      type: { type: Sequelize.STRING(16), allowNull: false },
      actor_id: { type: Sequelize.INTEGER, allowNull: true },
      outcome_id: { type: Sequelize.INTEGER, allowNull: true },
      body: { type: Sequelize.STRING(1000), allowNull: false, defaultValue: '' },
      data: { type: Sequelize.TEXT, allowNull: true },
      at: { type: Sequelize.DATE, allowNull: false },
      legacy_id: { type: Sequelize.STRING(40), allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false },
    }, [
      [['lead_id', 'at'], { name: 'crm_activities_lead_at' }],
      [['actor_id', 'at'], { name: 'crm_activities_actor_at' }],
      [['legacy_id'], { name: 'crm_activities_legacy', unique: true }],
    ]);

    await make('crm_calls', {
      id,
      lead_id: { type: Sequelize.INTEGER, allowNull: false },
      user_id: { type: Sequelize.INTEGER, allowNull: true },
      source: { type: Sequelize.STRING(10), allowNull: false, defaultValue: 'typed' },
      device_call_id: { type: Sequelize.STRING(80), allowNull: true },
      direction: { type: Sequelize.STRING(8), allowNull: false, defaultValue: 'out' },
      phone: { type: Sequelize.STRING(24), allowNull: false, defaultValue: '' },
      started_at: { type: Sequelize.DATE, allowNull: false },
      duration_seconds: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      answered: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      outcome_id: { type: Sequelize.INTEGER, allowNull: true },
      recording_url: { type: Sequelize.STRING(500), allowNull: true },
      legacy_id: { type: Sequelize.STRING(40), allowNull: true },
      ...stamps,
    }, [
      [['lead_id', 'started_at'], { name: 'crm_calls_lead' }],
      [['user_id', 'started_at'], { name: 'crm_calls_user' }],
      [['device_call_id'], { name: 'crm_calls_device', unique: true }],
      [['legacy_id'], { name: 'crm_calls_legacy', unique: true }],
    ]);

    await make('crm_assignments', {
      id,
      lead_id: { type: Sequelize.INTEGER, allowNull: false },
      from_id: { type: Sequelize.INTEGER, allowNull: true },
      to_id: { type: Sequelize.INTEGER, allowNull: true },
      by_id: { type: Sequelize.INTEGER, allowNull: true },
      reason: { type: Sequelize.STRING(200), allowNull: false, defaultValue: '' },
      at: { type: Sequelize.DATE, allowNull: false },
      ...stamps,
    }, [
      [['to_id', 'at'], { name: 'crm_assignments_to_at' }],
      [['lead_id'], { name: 'crm_assignments_lead' }],
    ]);

    await make('adm_notifications', {
      id: bigId,
      user_id: { type: Sequelize.INTEGER, allowNull: false },
      type: { type: Sequelize.STRING(30), allowNull: false },
      title: { type: Sequelize.STRING(160), allowNull: false },
      body: { type: Sequelize.STRING(400), allowNull: false, defaultValue: '' },
      link: { type: Sequelize.STRING(160), allowNull: false, defaultValue: '' },
      ref: { type: Sequelize.STRING(120), allowNull: true },
      read_at: { type: Sequelize.DATE, allowNull: true },
      ...stamps,
    }, [
      [['user_id', 'read_at'], { name: 'adm_notifications_user_read' }],
      [['user_id', 'ref'], { name: 'adm_notifications_user_ref', unique: true }],
    ]);

    await make('adm_breaks', {
      id,
      user_id: { type: Sequelize.INTEGER, allowNull: false },
      kind: { type: Sequelize.STRING(8), allowNull: false, defaultValue: 'tea' },
      started_at: { type: Sequelize.DATE, allowNull: false },
      ends_at: { type: Sequelize.DATE, allowNull: false },
      ended_at: { type: Sequelize.DATE, allowNull: true },
      ...stamps,
    }, [[['user_id', 'started_at'], { name: 'adm_breaks_user' }]]);
  },

  async down(queryInterface) {
    for (const t of ['adm_breaks', 'adm_notifications', 'crm_assignments', 'crm_calls', 'crm_activities', 'crm_tasks', 'crm_inquiries', 'crm_leads', 'crm_outcomes', 'crm_lost_reasons', 'crm_stages']) {
      await queryInterface.dropTable(t);
    }
  },
};
