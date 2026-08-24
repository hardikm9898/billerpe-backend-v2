'use strict';

// role_msts.role_name is a strict MySQL ENUM('S','C','A','U','B'). MySQL
// silently coerces an INSERT/UPDATE with a value outside the enum to an
// empty string rather than erroring (non-strict SQL mode default) - so
// billerpe-pos-pro's 7 named roles (Owner/Manager/Cashier/Captain/Kitchen
// Staff/Inventory Manager/Accountant) were being silently stored as ''
// instead of failing loudly. Confirmed live: creating a "Manager" user
// produced a role_mst row with role_name: "".
//
// This widens the enum additively - the 5 existing values (constant/
// const.js USER_ROLE, used by createCaptain/getCaptainUser/hotel
// onboarding) are kept exactly as-is, not renamed or removed, so nothing
// that already depends on 'A'/'B'/'C'/'S'/'U' changes behavior.
const OLD_VALUES = ['S', 'C', 'A', 'U', 'B'];
const NEW_VALUES = [
  'Owner',
  'Manager',
  'Cashier',
  'Captain',
  'Kitchen Staff',
  'Inventory Manager',
  'Accountant',
];

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.changeColumn('role_msts', 'role_name', {
      type: Sequelize.ENUM(...OLD_VALUES, ...NEW_VALUES),
      defaultValue: 'U',
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.changeColumn('role_msts', 'role_name', {
      type: Sequelize.ENUM(...OLD_VALUES),
      defaultValue: 'U',
    });
  },
};
