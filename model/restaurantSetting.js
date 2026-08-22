const { DataTypes } = require("sequelize")
const sequelize = require("../connection/connect")

const RestaurantSetting = sequelize.define("hms_res_setting", {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    order_sequence_opention: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    }, hotel_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        unique: true   // 👈 ensures one setting per restaurant
    },
    timeZone: {
        type: DataTypes.STRING(50),
        allowNull: false,
        defaultValue: "Asia/Kolkata",
        validate: {
            notEmpty: true
        }
    },
    opening_closing_show: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },

    business_day_start_time: {
        type: DataTypes.TIME,
        allowNull: false,
        defaultValue: "00:01:00"
    },

    financial_year_start_month: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 4,
    },
    bill_reset_type: {
        type: DataTypes.ENUM('never', 'financial_year', 'daily'),
        defaultValue: "never"
    },
    business_day_duration_hours: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 24,
        validate: {
            min: 1,
            max: 48
        }
    },
    qr_code_open_on_settle: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    printer_infrastructure: {
        type: DataTypes.ENUM,
        values: ["js", "local"],
        defaultValue: "js"
    },
    last_summary_sent_date: {
        type: DataTypes.DATEONLY,
        allowNull: true,
        defaultValue: null
    }
}, {
    indexes: [
        {
            unique: true,
            fields: ["hotel_id"]
        }
    ]
})


module.exports = RestaurantSetting

