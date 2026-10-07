'use strict';

// BillerPe SuperAdmin phase 3: WhatsApp inbox (chats, messages, templates,
// opt-outs), automation rules and their run log, cadences, campaigns and the
// escalation chain (model/crmAuto.js). New tables only.
module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = (await queryInterface.showAllTables()).map((t) => (typeof t === 'string' ? t : t.tableName));
    const id = { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false };
    const bigId = { type: Sequelize.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false };
    const stamps = { createdAt: { type: Sequelize.DATE, allowNull: false }, updatedAt: { type: Sequelize.DATE, allowNull: false } };
    const S = (n) => ({ type: Sequelize.STRING(n), allowNull: true });
    const Sd = (n, d = '') => ({ type: Sequelize.STRING(n), allowNull: false, defaultValue: d });
    const I = { type: Sequelize.INTEGER, allowNull: true };
    const D = { type: Sequelize.DATE, allowNull: true };
    const TXT = { type: Sequelize.TEXT, allowNull: true };
    const B = (d) => ({ type: Sequelize.BOOLEAN, allowNull: false, defaultValue: d });
    const make = async (name, cols, indexes = []) => {
      if (tables.includes(name)) return;
      await queryInterface.createTable(name, cols);
      for (const [fields, opts] of indexes) await queryInterface.addIndex(name, fields, opts);
    };

    await make('crm_wa_chats', {
      id,
      phone: { type: Sequelize.STRING(20), allowNull: false },
      phone_key: { type: Sequelize.STRING(15), allowNull: false },
      name: Sd(120),
      kind: Sd(10, 'lead'),
      label: Sd(120),
      lead_id: I,
      hotel_id: I,
      last_in_at: D,
      last_out_at: D,
      last_message_at: D,
      preview: Sd(200),
      unread: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      needs_reply: B(false),
      ai_paused_until: D,
      ai_off: B(false),
      handover_reason: Sd(200),
      status: Sd(8, 'open'),
      legacy_id: S(40),
      ...stamps,
    }, [
      [['phone_key'], { name: 'crm_wa_chats_phone_key', unique: true }],
      [['legacy_id'], { name: 'crm_wa_chats_legacy', unique: true }],
      [['last_message_at'], { name: 'crm_wa_chats_last' }],
      [['lead_id'], { name: 'crm_wa_chats_lead' }],
    ]);

    await make('crm_wa_messages', {
      id: bigId,
      chat_id: { type: Sequelize.INTEGER, allowNull: false },
      wa_id: S(120),
      direction: { type: Sequelize.STRING(3), allowNull: false },
      kind: Sd(10, 'text'),
      body: TXT,
      template_id: I,
      template_name: S(80),
      params: TXT,
      media_id: S(120),
      media_url: S(500),
      mime_type: S(80),
      file_name: S(200),
      sender: Sd(10, 'customer'),
      user_id: I,
      status: Sd(10, 'received'),
      error: S(300),
      at: { type: Sequelize.DATE, allowNull: false },
      campaign_id: I,
      enrollment_id: I,
      legacy_id: S(40),
      createdAt: { type: Sequelize.DATE, allowNull: false },
    }, [
      [['wa_id'], { name: 'crm_wa_messages_wa_id', unique: true }],
      [['legacy_id'], { name: 'crm_wa_messages_legacy', unique: true }],
      [['chat_id', 'id'], { name: 'crm_wa_messages_chat' }],
      [['status', 'at'], { name: 'crm_wa_messages_status' }],
    ]);

    await make('crm_wa_templates', {
      id,
      name: { type: Sequelize.STRING(80), allowNull: false },
      language: Sd(10, 'en'),
      category: Sd(12, 'marketing'),
      body: TXT,
      params: TXT,
      header_image: S(500),
      active: B(true),
      legacy_id: S(40),
      created_by: I,
      ...stamps,
    }, [
      [['name', 'language'], { name: 'crm_wa_templates_name', unique: true }],
      [['legacy_id'], { name: 'crm_wa_templates_legacy', unique: true }],
    ]);

    await make('crm_wa_optouts', {
      id,
      phone_key: { type: Sequelize.STRING(15), allowNull: false },
      reason: Sd(200),
      source: Sd(10, 'manual'),
      by_id: I,
      at: { type: Sequelize.DATE, allowNull: false },
      createdAt: { type: Sequelize.DATE, allowNull: false },
    }, [[['phone_key'], { name: 'crm_wa_optouts_phone', unique: true }]]);

    await make('crm_rules', {
      id,
      rule_key: S(40),
      name: { type: Sequelize.STRING(80), allowNull: false },
      description: Sd(300),
      trigger: { type: Sequelize.STRING(40), allowNull: false },
      conditions: TXT,
      actions: TXT,
      guards: TXT,
      params: TXT,
      active: B(true),
      sort: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      created_by: I,
      updated_by: I,
      ...stamps,
    }, [[['rule_key'], { name: 'crm_rules_key', unique: true }]]);

    await make('crm_rule_runs', {
      id: bigId,
      rule_id: { type: Sequelize.INTEGER, allowNull: false },
      lead_id: I,
      event_id: { type: Sequelize.BIGINT, allowNull: true },
      result: { type: Sequelize.STRING(8), allowNull: false },
      details: Sd(500),
      at: { type: Sequelize.DATE, allowNull: false },
      createdAt: { type: Sequelize.DATE, allowNull: false },
    }, [
      [['rule_id', 'at'], { name: 'crm_rule_runs_rule' }],
      [['lead_id', 'rule_id'], { name: 'crm_rule_runs_lead' }],
    ]);

    await make('crm_cadences', {
      id,
      cadence_key: S(40),
      name: { type: Sequelize.STRING(80), allowNull: false },
      description: Sd(300),
      enroll_on: Sd(40, 'manual'),
      stop_on: TXT,
      active: B(true),
      created_by: I,
      ...stamps,
    }, [[['cadence_key'], { name: 'crm_cadences_key', unique: true }]]);

    await make('crm_cadence_steps', {
      id,
      cadence_id: { type: Sequelize.INTEGER, allowNull: false },
      sort: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      day_offset: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      at_time: S(5),
      action: Sd(10, 'call'),
      template_id: I,
      note: Sd(200),
      ...stamps,
    }, [[['cadence_id', 'sort'], { name: 'crm_cadence_steps_cadence' }]]);

    await make('crm_cadence_enrollments', {
      id,
      cadence_id: { type: Sequelize.INTEGER, allowNull: false },
      lead_id: { type: Sequelize.INTEGER, allowNull: false },
      step_index: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      next_run_at: D,
      status: Sd(8, 'running'),
      stop_reason: Sd(80),
      started_at: { type: Sequelize.DATE, allowNull: false },
      ended_at: D,
      replied_at: D,
      by_id: I,
      origin: Sd(12, 'manual'),
      ...stamps,
    }, [
      [['status', 'next_run_at'], { name: 'crm_cadence_enr_due' }],
      [['lead_id', 'status'], { name: 'crm_cadence_enr_lead' }],
      [['cadence_id', 'status'], { name: 'crm_cadence_enr_cadence' }],
    ]);

    await make('crm_campaigns', {
      id,
      name: { type: Sequelize.STRING(120), allowNull: false },
      template_id: I,
      params: TXT,
      audience: TXT,
      status: Sd(10, 'draft'),
      scheduled_at: D,
      started_at: D,
      finished_at: D,
      per_minute: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 30 },
      total: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      created_by: I,
      legacy_id: S(40),
      ...stamps,
    }, [[['legacy_id'], { name: 'crm_campaigns_legacy', unique: true }]]);

    await make('crm_campaign_recipients', {
      id: bigId,
      campaign_id: { type: Sequelize.INTEGER, allowNull: false },
      lead_id: I,
      phone_key: { type: Sequelize.STRING(15), allowNull: false },
      phone: { type: Sequelize.STRING(20), allowNull: false },
      status: Sd(10, 'queued'),
      wa_id: S(120),
      error: S(300),
      sent_at: D,
      delivered_at: D,
      read_at: D,
      replied_at: D,
      legacy_id: S(40),
      ...stamps,
    }, [
      [['campaign_id', 'phone_key'], { name: 'crm_campaign_rcpt_phone', unique: true }],
      [['legacy_id'], { name: 'crm_campaign_rcpt_legacy', unique: true }],
      [['campaign_id', 'status'], { name: 'crm_campaign_rcpt_status' }],
      [['wa_id'], { name: 'crm_campaign_rcpt_wa' }],
    ]);

    await make('crm_escalations', {
      id,
      ref: { type: Sequelize.STRING(80), allowNull: false },
      lead_id: { type: Sequelize.INTEGER, allowNull: false },
      task_id: I,
      kind: { type: Sequelize.STRING(14), allowNull: false },
      level: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1 },
      owner_id: I,
      to_ids: Sd(200),
      status: Sd(8, 'open'),
      raised_at: { type: Sequelize.DATE, allowNull: false },
      next_level_at: D,
      handled_by: I,
      handled_at: D,
      how: Sd(120),
      ...stamps,
    }, [
      [['ref'], { name: 'crm_escalations_ref', unique: true }],
      [['status', 'next_level_at'], { name: 'crm_escalations_due' }],
      [['lead_id', 'status'], { name: 'crm_escalations_lead' }],
    ]);
  },

  async down(queryInterface) {
    for (const t of ['crm_escalations', 'crm_campaign_recipients', 'crm_campaigns', 'crm_cadence_enrollments', 'crm_cadence_steps', 'crm_cadences', 'crm_rule_runs', 'crm_rules', 'crm_wa_optouts', 'crm_wa_templates', 'crm_wa_messages', 'crm_wa_chats']) {
      await queryInterface.dropTable(t);
    }
  },
};
