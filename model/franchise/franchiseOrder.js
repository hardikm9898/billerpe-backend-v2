const { DataTypes, Sequelize } = require("sequelize");

const sequelize = require("../../connection/connect")
const FranchiseOrder = sequelize.define('FranchiseOrder', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    franchise_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
            model: 'hotel_registrations',
            key: 'id'
        }
    },
    merchant_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
            model: 'hms_merchant_msts',
            key: 'id'
        }
    },
    status: {
        type: DataTypes.ENUM('pending', 'accepted', 'rejected', 'out_for_delivery', 'delivered'),
        defaultValue: 'pending',
        allowNull: false
    },
    remarks: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    total_amount: {
        type: DataTypes.DECIMAL(10, 2),
        defaultValue: 0.00,
        allowNull: false
    },
    tax_amount: {
        type: DataTypes.DECIMAL(10, 2),
        defaultValue: 0.00,
        allowNull: true
    },
    grand_total: {
        type: DataTypes.DECIMAL(10, 2),
        defaultValue: 0.00,
        allowNull: false
    },
    purchase_order_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
            model: 'hms_purchase_orders',
            key: 'id'
        }
    },
    delivered_at: {
        type: DataTypes.DATE,
        allowNull: true
    },
    created_at: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
    },
    updated_at: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
    }
}, {
    tableName: 'franchise_orders',
    underscored: true,
    timestamps: true
});


module.exports = FranchiseOrder

