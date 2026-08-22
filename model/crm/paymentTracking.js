const { DataTypes } = require("sequelize")
const sequelize = require("../../connection/connect")

const PaymentTracking = sequelize.define("crm_payment_tracking_mst", {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    lead_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        unique: true
    },
    proposal_amount: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: true
    },
    final_amount: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: true
    },
    stage: {
        type: DataTypes.ENUM("proposal_sent", "negotiation", "approval_pending", "payment_pending", "paid"),
        defaultValue: "proposal_sent"
    },
    due_date: {
        type: DataTypes.DATE,
        allowNull: true
    },
    paid_at: {
        type: DataTypes.DATE,
        allowNull: true
    },
    payment_reference: {
        type: DataTypes.STRING,
        allowNull: true
    }
})

module.exports = PaymentTracking
