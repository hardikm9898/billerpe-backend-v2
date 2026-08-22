const { DataTypes } = require("sequelize");
const sequelize = require("../../connection/connect");
const Subscription = require("./subscription");
const PhonePayPaymentLink = require("../paymentLink");

const Plan = sequelize.define('hms_plan_mst', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    name: {
        type: DataTypes.STRING,
        allowNull: false
    },

    price: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    duration_days: {
        type: DataTypes.INTEGER, // how many days the plan lasts
        allowNull: false
    }
});
// Plan.hasMany(Subscription, { foreignKey: 'plan_id', onDelete: "CASCADE", onUpdate: "CASCADE" });
// Subscription.belongsTo(Plan, { foreignKey: 'plan_id', onDelete: "CASCADE", onUpdate: "CASCADE" });
// Plan.hasMany(PhonePayPaymentLink, { foreignKey: 'plan_id', onDelete: "CASCADE", onUpdate: "CASCADE" });
// PhonePayPaymentLink.belongsTo(Plan, { foreignKey: 'plan_id', onDelete: "CASCADE", onUpdate: "CASCADE" });

module.exports = Plan