const { Sequelize, DataTypes } = require('sequelize');
const sequelize = require("../connection/connect")
const Hotel = require("./hotel");
const Role = require('./role_mst');
const UserAccess = require('./userAccess');

const HotelUser = sequelize.define("hms_hotelUser_master", {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false
    },
    email: {
        type: DataTypes.STRING,
    },
    name: {
        type: DataTypes.STRING,

    },
    active: {
        type: DataTypes.BOOLEAN,
        defaultValue: true
    },
    number: {
        type: DataTypes.STRING,
    },
    password: {
        type: DataTypes.STRING,

    },
    pin: {
        type: DataTypes.STRING,
        allowNull: true,
    },
    device_id: {
        type: DataTypes.STRING,
        defaultValue: ""
    },
    refresh_token: {
        type: DataTypes.STRING,
        defaultValue: ""
    },
    // Per-user exceptions to the role's permissions ({ modules, special }),
    // set from the Web POS Users screen. Synced with the exe, which enforces
    // them on every request (billerpe-local-exe/helpers/permissions.js).
    permission_overrides: {
        type: DataTypes.JSON,
        allowNull: true,
    },
    // Sync engine v2: the exe's own id for a user it created - see
    // controller/sync/syncController.js#push.
    local_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
    }
},
)

module.exports = HotelUser