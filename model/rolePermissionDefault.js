const { DataTypes } = require("sequelize");
const sequelize = require("../connection/connect");

// One row per (hotel, role) - the frontend's role-level permission
// "template" used to pre-fill a new user's grants and to compute an
// existing user's effective access before their own per-user overrides are
// layered on. Real per-user grants still live entirely in hms_user_access
// (create/edit/delete/read per access_name) - that flat 10-area shape has
// no room for a "default per role" concept, so it stays untouched; this
// table is purely the role-defaults layer billerpe-pos-pro-v2's Permissions
// screen already has UI for, previously local-state-only.
//
// permissions/special_permissions are stored as JSON rather than one column
// per module/action - the frontend's grant matrix is 23 modules x 4 actions
// plus 6 special toggles, and nothing server-side ever needs to query into
// individual fields (same reasoning as MenuCatalog's table_category_ids/
// order_types).
const RolePermissionDefault = sequelize.define("hms_role_permission_default_mst", {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    role: {
        type: DataTypes.ENUM,
        values: ["Owner", "Manager", "Cashier", "Captain", "Kitchen Staff", "Inventory Manager", "Accountant"],
        allowNull: false,
    },
    permissions: { type: DataTypes.JSON, allowNull: false },
    special_permissions: { type: DataTypes.JSON, allowNull: false },
});

module.exports = RolePermissionDefault;
