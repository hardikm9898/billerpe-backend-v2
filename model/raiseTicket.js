
const { DataTypes } = require("sequelize")
const sequelize = require("../connection/connect");


const RaiseTicket = sequelize.define("hms_raise_ticket_mst", {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    status: {
        type: DataTypes.ENUM("new", "open", "close"),
        defaultValue: "new"
    },

    issue: {
        type: DataTypes.STRING,
        defaultValue: ""
    },
    star: {
        type: DataTypes.ENUM("0", "1", "2", "3", "4", "5"),
        defaultValue: "0"
    },
    ratting: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },

    priority: {
        type: DataTypes.ENUM("low", "medium", "high"),
        defaultValue: "low"
    }
    ,
    ticket_type: {
        type: DataTypes.STRING,
        defaultValue: ""
    },
    attachedment: {
        type: DataTypes.TEXT,
        defaultValue: ""
    },
    attachedment_type: {
        type: DataTypes.ENUM("video", "image"),
        defaultValue: "image"
    }
    , comment: {
        type: DataTypes.JSON,
        defaultValue: []
    }

})


module.exports = RaiseTicket

