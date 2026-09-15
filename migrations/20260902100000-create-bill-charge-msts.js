'use strict';

// Delivery and Packaging charge rules - see model/billChargeRule.js for the
// full design rationale (same shape as hms_serviceCharge_mst, two rows per
// hotel via a rule_for discriminator instead of two near-duplicate tables).
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('hms_bill_charge_msts', {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      hotel_id: { type: Sequelize.INTEGER, allowNull: false },
      rule_for: { type: Sequelize.ENUM('delivery', 'packaging'), allowNull: false },
      active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      charge_type: { type: Sequelize.ENUM('fixed', 'percentage'), allowNull: false, defaultValue: 'fixed' },
      charge_value: { type: Sequelize.DOUBLE, allowNull: false, defaultValue: 0 },
      calculation_on: { type: Sequelize.ENUM('core', 'total'), allowNull: false, defaultValue: 'core' },
      charge_automatic: { type: Sequelize.JSON, allowNull: true },
      calculation_on_tax: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      greater_less: { type: Sequelize.ENUM('1', '2', '3'), allowNull: false, defaultValue: '3' },
      greater_less_amount: { type: Sequelize.DOUBLE, allowNull: false, defaultValue: 0 },
      enter_by: { type: Sequelize.STRING, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
    });

    await queryInterface.addIndex('hms_bill_charge_msts', ['hotel_id', 'rule_for'], {
      unique: true,
      name: 'hms_bill_charge_msts_hotel_rule_unique',
    });

    // Backfill: every existing hotel gets both rows, matching
    // billerpe-pos-pro-v2's own mock/ops-seed.ts defaults exactly
    // (deliveryChargeRule/packagingChargeRule).
    const hotels = await queryInterface.sequelize.query('SELECT id, hotel_name FROM hotel_registrations', {
      type: Sequelize.QueryTypes.SELECT,
    });
    const now = new Date();
    const defaults = [
      {
        rule_for: 'delivery', active: false, charge_type: 'fixed', charge_value: 40,
        calculation_on: 'core', charge_automatic: [], calculation_on_tax: false,
        greater_less: '3', greater_less_amount: 0,
      },
      {
        rule_for: 'packaging', active: true, charge_type: 'fixed', charge_value: 15,
        calculation_on: 'core', charge_automatic: ['pickup'], calculation_on_tax: false,
        greater_less: '3', greater_less_amount: 0,
      },
    ];
    for (const hotel of hotels) {
      for (const rule of defaults) {
        await queryInterface.sequelize.query(
          `INSERT INTO hms_bill_charge_msts
             (hotel_id, rule_for, active, charge_type, charge_value, calculation_on, charge_automatic, calculation_on_tax, greater_less, greater_less_amount, enter_by, createdAt, updatedAt)
           VALUES (:hotelId, :ruleFor, :active, :chargeType, :chargeValue, :calculationOn, :chargeAutomatic, :calculationOnTax, :greaterLess, :greaterLessAmount, :enterBy, :now, :now)`,
          {
            replacements: {
              hotelId: hotel.id,
              ruleFor: rule.rule_for,
              active: rule.active,
              chargeType: rule.charge_type,
              chargeValue: rule.charge_value,
              calculationOn: rule.calculation_on,
              chargeAutomatic: JSON.stringify(rule.charge_automatic),
              calculationOnTax: rule.calculation_on_tax,
              greaterLess: rule.greater_less,
              greaterLessAmount: rule.greater_less_amount,
              enterBy: hotel.hotel_name ?? null,
              now,
            },
          },
        );
      }
    }
  },

  async down(queryInterface) {
    await queryInterface.dropTable('hms_bill_charge_msts');
  },
};
