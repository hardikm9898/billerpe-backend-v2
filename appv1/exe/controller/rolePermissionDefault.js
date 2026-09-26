// COPY of billerpe-local-exe/controller/rolePermissionDefault.js for the POS App (Plan 2) -
// written by scripts/vendor-exe-for-appv1.py. Do not edit here: change the
// exe's file and re-run the script, so both plans keep the same rules.

const { RolePermissionDefault } = require("../model");
const { MESSAGE, STATUSCODE } = require("../../../constant/const");
const { error, success } = require("../../../responce/res");

// Ported from uat-backend-v2/controller/rolePermissionDefault.js.
const ROLES = ["Owner", "Manager", "Cashier", "Captain", "Kitchen Staff", "Inventory Manager", "Accountant"];

const getRolePermissionDefaults = async (req, res) => {
    try {
        const defaults = await RolePermissionDefault.findAll({ where: { hotel_id: req.user } });
        return res.json(success(MESSAGE.SUCCESS, { defaults }, STATUSCODE.SUCCESS));
    } catch (err) {
        console.error("[rolePermissionDefault] getRolePermissionDefaults error:", err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

const editRolePermissionDefault = async (req, res) => {
    try {
        const { role, permissions } = req.body;
        if (!ROLES.includes(role)) return res.json(error("A valid role is required", STATUSCODE.BAD_REQUEST));
        if (role === "Owner") return res.json(error("Owner always has full access and can't be restricted", STATUSCODE.BAD_REQUEST));
        if (!permissions || typeof permissions !== "object") {
            return res.json(error("permissions must be an object", STATUSCODE.BAD_REQUEST));
        }
        const [row] = await RolePermissionDefault.findOrCreate({
            where: { hotel_id: req.user, role },
            defaults: { hotel_id: req.user, role, permissions, special_permissions: {} },
        });
        await row.update({ permissions });
        return res.json(success(MESSAGE.SUCCESS, { message: `${role} permissions updated` }, STATUSCODE.SUCCESS));
    } catch (err) {
        console.error("[rolePermissionDefault] editRolePermissionDefault error:", err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

const editRolePermissionSpecialDefault = async (req, res) => {
    try {
        const { role, special } = req.body;
        if (!ROLES.includes(role)) return res.json(error("A valid role is required", STATUSCODE.BAD_REQUEST));
        if (role === "Owner") return res.json(error("Owner always has full access and can't be restricted", STATUSCODE.BAD_REQUEST));
        if (!special || typeof special !== "object") {
            return res.json(error("special must be an object", STATUSCODE.BAD_REQUEST));
        }
        const [row] = await RolePermissionDefault.findOrCreate({
            where: { hotel_id: req.user, role },
            defaults: { hotel_id: req.user, role, permissions: {}, special_permissions: special },
        });
        await row.update({ special_permissions: { ...row.special_permissions, ...special } });
        return res.json(success(MESSAGE.SUCCESS, { message: `${role} permissions updated` }, STATUSCODE.SUCCESS));
    } catch (err) {
        console.error("[rolePermissionDefault] editRolePermissionSpecialDefault error:", err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

module.exports = { getRolePermissionDefaults, editRolePermissionDefault, editRolePermissionSpecialDefault };
