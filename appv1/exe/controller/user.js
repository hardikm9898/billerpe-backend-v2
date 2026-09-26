// COPY of billerpe-local-exe/controller/user.js for the POS App (Plan 2) -
// written by scripts/vendor-exe-for-appv1.py. Do not edit here: change the
// exe's file and re-run the script, so both plans keep the same rules.

const bcrypt = require("bcrypt");
const { Hotel, HotelUser, Role, UserAccess } = require("../model");
const { MESSAGE, STATUSCODE } = require("../../../constant/const");
const { success, error } = require("../../../responce/res");
const { isOwnerAccount, digits, OWNER_LOCKED_MESSAGE, OWNER_SELF_ONLY_MESSAGE } = require("../helpers/ownerAccount");
const SALT_ROUNDS = 10;

// Ported from uat-backend-v2/controller/user.js's getRole/userAccess
// (Phase 3, read-only).

const getRole = async (req, res) => {
    try {
        const user = await HotelUser.findOne({ where: { id: req.userId } });
        if (user) return res.json(success(MESSAGE.SUCCESS, { message: user.role }, STATUSCODE.SUCCESS));
        return res.json(error(MESSAGE.USER_NOT_FOUND, STATUSCODE.NOT_FOUND));
    } catch (err) {
        console.error("[user] getRole error:", err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

// Ported from uat-backend-v2/controller/offline/offline.js's
// offlineHotelUser (GET /offlineHotelUser) - read-only, the Users
// management screen's list (userApi.getUsers). Distinct from userAccess
// below: this lists every staff account for the hotel, userAccess
// resolves just the ONE currently logged-in session's own user.
const getUsers = async (req, res) => {
    try {
        const hotel = await Hotel.findOne({ where: { id: req.user } });
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.NOT_FOUND));
        // Same fix as userAccess below - this one's worse, it's every
        // staff member's password/pin/refresh_token in one response, not
        // just the logged-in user's own.
        const hotelUsers = await HotelUser.findAll({
            where: { hotel_id: req.user },
            attributes: { exclude: ["password", "pin", "refresh_token"] },
            include: [{ model: Role }, { model: UserAccess }],
        });
        // Which of these is the owner's own login (helpers/ownerAccount.js) -
        // the screens lock that row rather than letting a save be refused.
        const ownerNumber = digits(hotel.owner_number);
        const withOwner = hotelUsers.map((u) => ({
            ...u.toJSON(),
            is_owner: Boolean(ownerNumber) && digits(u.number) === ownerNumber,
        }));
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { hotelUsers: withOwner }, STATUSCODE.SUCCESS));
    } catch (err) {
        console.error("[user] getUsers error:", err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

const userAccess = async (req, res) => {
    try {
        const hotel = await Hotel.findOne({ where: { id: req.user } });
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST));

        // Fixed vs. the source (a faithful port of uat-backend-v2's own
        // controller/user.js, which has the same gap): no attribute
        // exclusion meant the bcrypt password hash, PIN hash and refresh
        // token were serialized straight into this response - hit on
        // every login/session-check. Confirmed live.
        const access = await HotelUser.findOne({
            where: { id: req.userId },
            attributes: { exclude: ["password", "pin", "refresh_token"] },
            include: [{ model: UserAccess }, { model: Role }],
        });
        return res.json(success(MESSAGE.SUCCESS, { access }, STATUSCODE.SUCCESS));
    } catch (err) {
        console.error("[user] userAccess error:", err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

// Ported from uat-backend-v2/controller/user.js's createUser/updateUser.
// Real Joi schemas (userSchema/userSchemaUpdate) aren't reproduced here -
// the frontend's own UserPayload type already enforces the same required
// fields at the call site, and this is a local-admin-only screen, not a
// public API surface.
const createUser = async (req, res) => {
    try {
        const hotel = await Hotel.findOne({ where: { id: req.user } });
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST));
        const { name, role, email, number, access_name, password, pin, active } = req.body;

        const existing = await HotelUser.findOne({ where: { number } });
        if (existing) return res.json(error(MESSAGE.MOBILE_ALREADY_USED, STATUSCODE.CONFLICT));

        let roleData = await Role.findOne({ where: { role_name: role, hotel_id: req.user } });
        if (!roleData) roleData = await Role.create({ role_name: role, enter_by: hotel.hotel_name, hotel_id: req.user });

        const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
        const hashedPin = pin ? await bcrypt.hash(pin, SALT_ROUNDS) : null;
        const user = await HotelUser.create({
            name, role_cd: roleData.role_cd, email, number, active: active ?? true,
            hotel_id: req.user, password: hashedPassword, pin: hashedPin,
        });

        for (const access of access_name || []) {
            await UserAccess.create({
                access_name: access?.access, create: access.permissions.create, read: access.permissions.read,
                edit: access.permissions.edit, delete: access.permissions.delete, hotelUser_id: user.id, hotel_id: req.user,
            });
        }
        return res.json(success(MESSAGE.SUCCESS, { message: MESSAGE.CREATE_USER }, STATUSCODE.CREATED));
    } catch (err) {
        console.error("[user] createUser error:", err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

const updateUser = async (req, res) => {
    try {
        const hotel = await Hotel.findOne({ where: { id: req.user } });
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST));
        const { name, role, email, number, access_name, id, active, password, pin } = req.body;

        const user = await HotelUser.findOne({ where: { hotel_id: req.user, id } });
        if (!user) return res.json(error(MESSAGE.USER_NOT_FOUND, STATUSCODE.BAD_REQUEST));

        // The owner's own login is locked (owner rule, 2026-09-22): never
        // turned off, never moved to another role, permissions never touched -
        // and only the owner may change their own details.
        const ownerAccount = await isOwnerAccount(req.user, user);
        if (ownerAccount) {
            if (active === false || active === "false" || active === 0) {
                return res.json(error(OWNER_LOCKED_MESSAGE, STATUSCODE.BAD_REQUEST));
            }
            if (Array.isArray(access_name) && access_name.length) {
                return res.json(error(OWNER_LOCKED_MESSAGE, STATUSCODE.BAD_REQUEST));
            }
            if (String(req.userId) !== String(user.id)) {
                return res.json(error(OWNER_SELF_ONLY_MESSAGE, STATUSCODE.FORBIDDEN));
            }
        }

        let roleData = await Role.findOne({ where: { role_name: role, hotel_id: req.user } });
        if (!roleData) roleData = await Role.create({ role_name: role, hotel_id: req.user });

        const updateFields = { name, role_cd: roleData.role_cd, email, number, active };
        if (ownerAccount) {
            // Their role stays exactly as it is, whatever was sent.
            updateFields.role_cd = user.role_cd;
            updateFields.active = true;
            // The owner changing their own mobile moves the outlet's owner
            // number with it, or this account would stop being the owner.
            const newNumber = digits(number);
            if (newNumber && newNumber !== digits(user.number)) {
                await Hotel.update({ owner_number: newNumber }, { where: { id: req.user } });
            }
        }
        if (password) updateFields.password = await bcrypt.hash(password, SALT_ROUNDS);
        if (pin) updateFields.pin = await bcrypt.hash(pin, SALT_ROUNDS);
        await HotelUser.update(updateFields, { where: { hotel_id: req.user, id } });

        for (const access of access_name || []) {
            const userAccess = await UserAccess.findOne({ where: { hotelUser_id: id, hotel_id: req.user, access_name: access?.access } });
            if (userAccess) {
                await UserAccess.update(
                    { create: access.permissions.create, read: access.permissions.read, edit: access.permissions.edit, delete: access.permissions.delete },
                    { where: { id: userAccess.id, hotel_id: req.user, hotelUser_id: id } },
                );
            } else {
                await UserAccess.create({
                    access_name: access?.access, create: access.permissions.create, read: access.permissions.read,
                    edit: access.permissions.edit, delete: access.permissions.delete, hotelUser_id: user.id, hotel_id: req.user,
                });
            }
        }
        return res.json(success(MESSAGE.SUCCESS, { message: MESSAGE.USER_UPDATED }, STATUSCODE.SUCCESS));
    } catch (err) {
        console.error("[user] updateUser error:", err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

// Per-user exceptions to the role's permissions, set from the Users screen.
// Previously these only lived in one browser tab's memory: saved with a
// success toast, gone on refresh, never seen by other devices and never
// enforced. Stored on the user row, synced to the cloud with it, and
// enforced on every request (helpers/permissions.js). `overrides: null`
// resets the user to their role's defaults.
const setPermissionOverrides = async (req, res) => {
    try {
        const { id, overrides } = req.body;
        const isObject = (v) => v && typeof v === "object" && !Array.isArray(v);
        if (overrides !== null && (!isObject(overrides)
            || (overrides.modules !== undefined && !isObject(overrides.modules))
            || (overrides.special !== undefined && !isObject(overrides.special)))) {
            return res.json(error("overrides must be { modules?, special? } or null", STATUSCODE.BAD_REQUEST));
        }
        const user = await HotelUser.findOne({ where: { id, hotel_id: req.user } });
        if (!user) return res.json(error(MESSAGE.USER_NOT_FOUND, STATUSCODE.NOT_FOUND));
        // The owner's permissions are not editable by anyone (owner rule).
        if (await isOwnerAccount(req.user, user)) {
            return res.json(error(OWNER_LOCKED_MESSAGE, STATUSCODE.BAD_REQUEST));
        }
        await user.update({ permission_overrides: overrides });
        return res.json(success(MESSAGE.SUCCESS, { message: "Permissions updated" }, STATUSCODE.SUCCESS));
    } catch (err) {
        console.error("[user] setPermissionOverrides error:", err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

module.exports = { getRole, userAccess, getUsers, createUser, updateUser, setPermissionOverrides };
