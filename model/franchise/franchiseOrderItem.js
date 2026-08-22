const { DataTypes } = require("sequelize");
const sequelize = require("../../connection/connect")
const FranchiseOrderItem = sequelize.define('FranchiseOrderItem', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    order_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
            model: 'franchise_orders',
            key: 'id'
        },
        onDelete: 'CASCADE'
    },
    raw_material_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
            model: 'hms_rawMaterial_msts',
            key: 'id'
        }
    },
    ordered_qty: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false
    },
    approved_qty: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: true,
        defaultValue: 0.00
    },
    unit_price: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 0.00
    },
    amount: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 0.00
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
    tableName: 'franchise_order_items',
    underscored: true,
    timestamps: true
});


module.exports = FranchiseOrderItem


