const Hotel = require("../model/hotel");
const RolePermissionDefault = require("../model/rolePermissionDefault");
const { ROLES } = require("../constant/rolePermissionDefaults");
const { MESSAGE, STATUSCODE } = require("../constant/const");
const { error, success } = require("../responce/res");

const getRolePermissionDefaults = async (req, res) => {
    try {
        const hotel = await Hotel.findOne({ where: { id: req.user } });
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST));
        const defaults = await RolePermissionDefault.findAll({ where: { hotel_id: req.user } });
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { defaults }, STATUSCODE.SUCCESS));
    } catch (err) {
        console.error(err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

// Owner always has full access client-side (the Permissions screen never
// even lets Owner's row be edited - see _shell.users.tsx's isOwnerRow),
// but nothing stops a direct API call from trying, so it's rejected here
// too rather than trusted to the UI alone.
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
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { message: `${role} permissions updated` }, STATUSCODE.SUCCESS));
    } catch (err) {
        console.error(err);
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
        // Merge, not replace - matches the frontend's own
        // updateRoleSpecialDefaults, which only ever sends the one toggle
        // that changed, not the whole special-permissions set.
        await row.update({ special_permissions: { ...row.special_permissions, ...special } });
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { message: `${role} permissions updated` }, STATUSCODE.SUCCESS));
    } catch (err) {
        console.error(err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

module.exports = { getRolePermissionDefaults, editRolePermissionDefault, editRolePermissionSpecialDefault };
