'use strict';

// BillerPe SuperAdmin phase 4 (the sales app on company phones): calls taken
// from the phone's call log carry the phone they came from and whether the
// phone's own recording was found and uploaded.
module.exports = {
  async up(queryInterface, Sequelize) {
    const cols = await queryInterface.describeTable('crm_calls');
    const add = async (name, spec) => {
      if (!cols[name]) await queryInterface.addColumn('crm_calls', name, spec);
    };
    // unknown (typed by hand) | pending (the app is looking for it) | yes | no (not found) | none (not answered)
    await add('recorded', { type: Sequelize.STRING(10), allowNull: false, defaultValue: 'unknown' });
    await add('recording_name', { type: Sequelize.STRING(200), allowNull: true });
    await add('recording_size', { type: Sequelize.INTEGER, allowNull: true });
    await add('device_id', { type: Sequelize.STRING(64), allowNull: true });
  },

  async down(queryInterface) {
    for (const c of ['recorded', 'recording_name', 'recording_size', 'device_id']) await queryInterface.removeColumn('crm_calls', c);
  },
};
