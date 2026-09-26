// What the copied exe files get from require("../model"): the cloud's models
// (same tables and names as the exe's) plus the connection, which the exe's
// model index exports as `sequelize`.
module.exports = { ...require("../../model"), sequelize: require("../../connection/connect") };
