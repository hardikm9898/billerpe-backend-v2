const { Sequelize, DataTypes } = require("sequelize")
require("dotenv").config()
const logger = require("../utils/logger")

// ! production database connection

const sequelize = new Sequelize(process.env.DATABASE_NAME, process.env.DATABASE_ID, process.env.DATABASE_PASSWORD, {
    host: process.env.DATABASE_HOST,
    dialect: process.env.DATABASE_DIALECT,
    logging: false,
    pool: {
        max: 20,        // reduced from 50 — prevents connection exhaustion on multi-instance deploy
        min: 2,         // reduced from 5 — fewer idle connections held open
        acquire: 10000, // reduced from 30s — fail fast on pool saturation
        idle: 30000     // increased from 10s — release idle connections less aggressively
    },
    retry: {
        max: 3,
        match: ['ER_NEED_REPREPARE']
    }
});

// ! local database connection

// const sequelize = new Sequelize('test', 'root', "", {
//     host: 'localhost',
//     dialect: 'mysql' /* one of | 'postgres' | 'sqlite' | 'mariadb' | 'mssql' | 'db2' | 'snowflake' | 'oracle' */
//     ,
//     logging: console.log,
// });

sequelize.authenticate()
    .then(() => logger.info("MySQL connected successfully"))
    .catch(err => logger.error("Error connecting to MySQL", { err: err.message }));
module.exports = sequelize

