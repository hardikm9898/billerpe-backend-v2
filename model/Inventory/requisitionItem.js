const { DataTypes } = require("sequelize");
const sequelize = require("../../connection/connect");

// One requested material line on a Requisition (see ./requisition.js).
// unit_price is a snapshot taken at request time (from the raw material's
// current cost) so the requested value stays stable even if the material's
// rate later changes - approved_qty is filled in when a reviewer adjusts
// the quantity before accepting.
const RequisitionItem = sequelize.define("hms_requisition_item_mst", {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    raw_material_id: { type: DataTypes.INTEGER },
    ordered_qty: { type: DataTypes.FLOAT, defaultValue: 0 },
    approved_qty: { type: DataTypes.FLOAT, allowNull: true },
    unit_price: { type: DataTypes.FLOAT, defaultValue: 0 },
    deleted_status: { type: DataTypes.BOOLEAN, defaultValue: false },
});

module.exports = RequisitionItem;
