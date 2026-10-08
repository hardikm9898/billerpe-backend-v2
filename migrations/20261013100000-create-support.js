'use strict';

// BillerPe SuperAdmin phase 7: support tickets (model/support.js). Two new
// tables beside the old hms_raise_ticket_msts, which is not changed.
module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = (await queryInterface.showAllTables()).map((t) => (typeof t === 'string' ? t : t.tableName));
    const id = { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false };
    const Sd = (n, d = '') => ({ type: Sequelize.STRING(n), allowNull: false, defaultValue: d });
    const S = (n) => ({ type: Sequelize.STRING(n), allowNull: true });
    const I = { type: Sequelize.INTEGER, allowNull: true };
    const D = { type: Sequelize.DATE, allowNull: true };
    const make = async (name, cols, indexes = []) => {
      if (tables.includes(name)) return;
      await queryInterface.createTable(name, cols);
      for (const [fields, opts] of indexes) await queryInterface.addIndex(name, fields, opts);
    };

    await make('sup_tickets', {
      id,
      ticket_id: { type: Sequelize.INTEGER, allowNull: false },
      hotel_id: I,
      account_id: I,
      subject: Sd(160),
      category: Sd(40, 'Other'),
      priority: Sd(8, 'medium'),
      channel: Sd(12, 'old_app'),
      state: Sd(8, 'new'),
      assignee_id: I,
      assigned_at: D,
      raised_by: Sd(160),
      contact_name: Sd(120),
      contact_mobile: Sd(15),
      wa_chat_id: I,
      created_by: I,
      opened_at: { type: Sequelize.DATE, allowNull: false },
      first_reply_due: D,
      first_reply_at: D,
      resolve_due: D,
      paused_minutes: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      waiting_since: D,
      late_reply_at: D,
      late_fix_at: D,
      closed_at: D,
      closed_by: I,
      resolution: Sd(500),
      reopened: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      rating: I,
      rating_asked_at: D,
      rated_at: D,
      last_customer_at: D,
      last_staff_at: D,
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    }, [
      [['ticket_id'], { unique: true, name: 'sup_tickets_ticket' }],
      [['state'], { name: 'sup_tickets_state' }],
      [['assignee_id', 'state'], { name: 'sup_tickets_assignee' }],
      [['hotel_id'], { name: 'sup_tickets_hotel' }],
      [['account_id'], { name: 'sup_tickets_account' }],
      [['contact_mobile'], { name: 'sup_tickets_mobile' }],
    ]);

    await make('sup_ticket_messages', {
      id,
      ticket_id: { type: Sequelize.INTEGER, allowNull: false },
      kind: { type: Sequelize.STRING(10), allowNull: false },
      author_id: I,
      author_name: Sd(120),
      via: Sd(10, 'panel'),
      body: { type: Sequelize.TEXT, allowNull: false },
      files: { type: Sequelize.TEXT, allowNull: true },
      wa_message_id: { type: Sequelize.BIGINT, allowNull: true },
      wa_status: S(10),
      wa_note: S(200),
      at: { type: Sequelize.DATE, allowNull: false },
      createdAt: { type: Sequelize.DATE, allowNull: false },
    }, [[['ticket_id', 'at'], { name: 'sup_ticket_messages_ticket' }]]);
  },

  async down(queryInterface) {
    for (const t of ['sup_ticket_messages', 'sup_tickets']) await queryInterface.dropTable(t);
  },
};
