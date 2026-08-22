const { DataTypes } = require('sequelize');
const sequelize = require("../connection/connect");
const superAdminUser = require('./superAdminUser');
const Hotel = require('./hotel');


module.exports = superAdminUser(sequelize, DataTypes, Hotel)