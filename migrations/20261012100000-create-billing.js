'use strict';

// BillerPe SuperAdmin phase 6: BillerPe's own billing (model/billing.js) -
// catalog, number series, GST invoices and credit notes with their lines,
// payments, PhonePe payment links, renewals. New tables only.
module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = (await queryInterface.showAllTables()).map((t) => (typeof t === 'string' ? t : t.tableName));
    const id = { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false };
    const stamps = { createdAt: { type: Sequelize.DATE, allowNull: false }, updatedAt: { type: Sequelize.DATE, allowNull: false } };
    const Sd = (n, d = '') => ({ type: Sequelize.STRING(n), allowNull: false, defaultValue: d });
    const S = (n) => ({ type: Sequelize.STRING(n), allowNull: true });
    const I = { type: Sequelize.INTEGER, allowNull: true };
    const In = { type: Sequelize.INTEGER, allowNull: false };
    const D = { type: Sequelize.DATE, allowNull: true };
    const TXT = { type: Sequelize.TEXT, allowNull: true };
    const MONEY = { type: Sequelize.DECIMAL(12, 2), allowNull: false, defaultValue: 0 };
    const B = (d) => ({ type: Sequelize.BOOLEAN, allowNull: false, defaultValue: d });
    const make = async (name, cols, indexes = []) => {
      if (tables.includes(name)) return;
      await queryInterface.createTable(name, cols);
      for (const [fields, opts] of indexes) await queryInterface.addIndex(name, fields, opts);
    };

    await make('bil_items', {
      id,
      code: { type: Sequelize.STRING(30), allowNull: false },
      name: { type: Sequelize.STRING(80), allowNull: false },
      kind: Sd(10, 'plan'),
      product: S(20),
      plan_name: S(40),
      price: MONEY,
      days: I,
      devices: I,
      credits: I,
      sac: Sd(8, '997331'),
      gst_rate: { type: Sequelize.DECIMAL(5, 2), allowNull: false, defaultValue: 18 },
      sort: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      active: B(true),
      ...stamps,
    }, [[['code'], { unique: true, name: 'bil_items_code' }]]);

    await make('bil_counters', {
      id,
      kind: { type: Sequelize.STRING(10), allowNull: false },
      fy: { type: Sequelize.STRING(5), allowNull: false },
      next: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1 },
      ...stamps,
    }, [[['kind', 'fy'], { unique: true, name: 'bil_counters_kind_fy' }]]);

    await make('bil_invoices', {
      id,
      kind: Sd(12, 'invoice'),
      number: S(20),
      status: Sd(10, 'draft'),
      account_id: I,
      hotel_id: I,
      renewal_id: I,
      hardware_order_id: I,
      credit_for_id: I,
      bill_name: Sd(160),
      bill_gstin: Sd(15),
      bill_address: Sd(400),
      bill_mobile: Sd(15),
      bill_email: Sd(120),
      supply_state: Sd(2),
      subtotal: MONEY,
      discount: MONEY,
      discount_pct: { type: Sequelize.DECIMAL(5, 2), allowNull: false, defaultValue: 0 },
      discount_reason: Sd(200),
      taxable: MONEY,
      cgst: MONEY,
      sgst: MONEY,
      igst: MONEY,
      round_off: MONEY,
      total: MONEY,
      paid: MONEY,
      issued_at: D,
      due_at: D,
      paid_at: D,
      cancelled_at: D,
      cancel_reason: Sd(200),
      approved_by: I,
      seller: TXT,
      demo: B(false),
      applied_at: D,
      note: Sd(500),
      created_by: I,
      ...stamps,
    }, [
      [['number'], { unique: true, name: 'bil_invoices_number' }],
      [['hardware_order_id'], { unique: true, name: 'bil_invoices_hardware' }],
      [['account_id', 'status'], { name: 'bil_invoices_account' }],
      [['hotel_id'], { name: 'bil_invoices_hotel' }],
      [['status', 'due_at'], { name: 'bil_invoices_status_due' }],
    ]);

    await make('bil_invoice_lines', {
      id,
      invoice_id: In,
      item_id: I,
      product_id: I,
      kind: Sd(10, 'plan'),
      description: { type: Sequelize.STRING(200), allowNull: false },
      sac: Sd(8, '997331'),
      qty: { type: Sequelize.DECIMAL(10, 2), allowNull: false, defaultValue: 1 },
      unit_price: MONEY,
      amount: MONEY,
      gst_rate: { type: Sequelize.DECIMAL(5, 2), allowNull: false, defaultValue: 18 },
      period_from: { type: Sequelize.DATEONLY, allowNull: true },
      period_to: { type: Sequelize.DATEONLY, allowNull: true },
      effect: TXT,
      sort: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      createdAt: { type: Sequelize.DATE, allowNull: false },
    }, [[['invoice_id'], { name: 'bil_invoice_lines_invoice' }]]);

    await make('bil_payments', {
      id,
      number: S(20),
      invoice_id: In,
      account_id: I,
      method: { type: Sequelize.STRING(10), allowNull: false },
      amount: MONEY,
      reference: Sd(80),
      proof: S(500),
      status: Sd(10, 'pending'),
      received_on: { type: Sequelize.DATEONLY, allowNull: false },
      decided_by: I,
      decided_at: D,
      reject_reason: Sd(200),
      link_id: I,
      note: Sd(300),
      created_by: I,
      ...stamps,
    }, [
      [['number'], { unique: true, name: 'bil_payments_number' }],
      [['link_id'], { unique: true, name: 'bil_payments_link' }],
      [['invoice_id'], { name: 'bil_payments_invoice' }],
      [['status'], { name: 'bil_payments_status' }],
    ]);

    await make('bil_pay_links', {
      id,
      invoice_id: In,
      merchant_order_id: { type: Sequelize.STRING(40), allowNull: false },
      phonepe_order_id: S(60),
      url: Sd(1000),
      amount: MONEY,
      state: Sd(12, 'PENDING'),
      expires_at: D,
      checked_at: D,
      detail: TXT,
      created_by: I,
      ...stamps,
    }, [
      [['merchant_order_id'], { unique: true, name: 'bil_pay_links_merchant' }],
      [['invoice_id'], { name: 'bil_pay_links_invoice' }],
      [['state'], { name: 'bil_pay_links_state' }],
    ]);

    await make('cs_renewals', {
      id,
      hotel_id: In,
      account_id: I,
      ends_on: { type: Sequelize.DATE, allowNull: false },
      stage: Sd(10, 'upcoming'),
      owner_id: I,
      invoice_id: I,
      reminded_at: D,
      remind_how: S(10),
      grace_used_at: D,
      grace_by: S(40),
      paid_at: D,
      churned_at: D,
      churn_reason: Sd(200),
      note: Sd(300),
      ...stamps,
    }, [
      [['hotel_id', 'ends_on'], { unique: true, name: 'cs_renewals_hotel_end' }],
      [['stage', 'ends_on'], { name: 'cs_renewals_stage' }],
      [['owner_id', 'stage'], { name: 'cs_renewals_owner' }],
    ]);
  },

  async down(queryInterface) {
    for (const t of ['cs_renewals', 'bil_pay_links', 'bil_payments', 'bil_invoice_lines', 'bil_invoices', 'bil_counters', 'bil_items']) await queryInterface.dropTable(t);
  },
};
