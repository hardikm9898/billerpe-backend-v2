const { DataTypes, Sequelize } = require("sequelize");
const sequelize = require("../../connection/connect");
const SubscriptionPayment = require("./subscriptionPayment");
const Plan = require("./plan");

const Subscription = sequelize.define('hms_subscription_mst', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    start_date: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: new Date()
    },
    end_date: {
        type: DataTypes.DATE,
        defaultValue: new Date()
    },

    extra_login_mobile: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    },
    extra_login_web: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    },

    extra_login_price: {
        type: DataTypes.DOUBLE,
        defaultValue: 0
    },

    discountrate: {
        type: DataTypes.DOUBLE,
        defaultValue: 0
    },
    discount: {
        type: DataTypes.ENUM,
        values: ['pr', 'fix']
    },
    discountedvalue: {
        type: DataTypes.DOUBLE,
        defaultValue: 0
    },
    subTotal: {
        type: DataTypes.DOUBLE,
        defaultValue: 0
    },

    gst: {
        type: DataTypes.DOUBLE,
        defaultValue: 0
    },
    gst_calculated: {
        type: DataTypes.BOOLEAN,
        defaultValue: true
    },
    grandAmount: {
        type: DataTypes.DOUBLE,
        defaultValue: 0
    },
    subscription_extend_count: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    },
    is_active: {
        type: DataTypes.BOOLEAN,
        defaultValue: true
    }
});

// Subscription.hasMany(SubscriptionPayment, { foreignKey: 'subscription_id', onDelete: "CASCADE", onUpdate: "CASCADE" });
// SubscriptionPayment.belongsTo(Subscription, { foreignKey: 'subscription_id', onDelete: "CASCADE", onUpdate: "CASCADE" });

module.exports = Subscription;
