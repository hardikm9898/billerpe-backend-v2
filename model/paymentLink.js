const { DataTypes } = require('sequelize');
const sequelize = require("../connection/connect") // Adjust this to your setup

const PhonePayPaymentLink = sequelize.define('PhonePayPaymentLink', {
    merchantId: { type: DataTypes.STRING },
    merchantOrderId: { type: DataTypes.STRING },
    orderId: { type: DataTypes.STRING },
    state: { type: DataTypes.STRING },
    amount: { type: DataTypes.DOUBLE },
    expireAt: { type: DataTypes.DATE },
    errorCode: { type: DataTypes.STRING },
    detailedErrorCode: { type: DataTypes.STRING },
    metaInfo: { type: DataTypes.JSON },
    paymentDetails: { type: DataTypes.JSON },
    redirectUrl: { type: DataTypes.STRING(1000) },

    subTotal: { type: DataTypes.DOUBLE }, gst: { type: DataTypes.DOUBLE }, grandAmount: { type: DataTypes.DOUBLE }, discountrate: { type: DataTypes.DOUBLE }, discountedvalue: { type: DataTypes.DOUBLE }, dicount: { type: DataTypes.STRING, defaultValue: 'fix' }
}, {
    tableName: 'phone_pay_payment_links',
    timestamps: false,
    indexes: [
        {
            name: 'idx_merchantOrderId',
            fields: ['merchantOrderId']
        }
    ]
});



module.exports = PhonePayPaymentLink;
