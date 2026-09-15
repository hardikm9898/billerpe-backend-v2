const { DataTypes } = require("sequelize");
const sequelize = require("../../connection/connect");

// A procurement request raised internally (kitchen/branch asking for raw
// materials) - status flows Pending -> Accepted -> Out for delivery ->
// Delivered. "Delivered" is only reached via fulfilRequisition, which
// atomically creates a real PurchaseOrder + PurchaseRawMaterial rows and
// stamps purchase_order_id here, mirroring the same header+lines pattern as
// hms_purchase_order (see model/Inventory/purchaseOrder.js).
const Requisition = sequelize.define("hms_requisition_mst", {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    req_no: { type: DataTypes.INTEGER, defaultValue: 0 },
    business_date: { type: DataTypes.DATEONLY },
    status: {
        type: DataTypes.ENUM,
        values: ["Pending", "Accepted", "Out for delivery", "Delivered", "Rejected"],
        defaultValue: "Pending",
    },
    remarks: { type: DataTypes.STRING, allowNull: true },
    raised_by: { type: DataTypes.STRING, allowNull: true },
    purchase_order_id: { type: DataTypes.INTEGER, allowNull: true },
    deleted_status: { type: DataTypes.BOOLEAN, defaultValue: false },
});

module.exports = Requisition;
