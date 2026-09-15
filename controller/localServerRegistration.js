const crypto = require("crypto");
const { Hotel, LocalServerRegistration } = require("../model");
const { MESSAGE, STATUSCODE } = require("../constant/const");
const { success, error } = require("../responce/res");

// Phase A of the local-first architecture migration: the central authority
// for "which PC is this restaurant's active local server" (architecture
// memo §03/§04). Nothing here replaces billerpe-local-exe's own
// registerDevice bootstrap (owner auth + initial data pull) - this is the
// missing piece that bootstrap never had: a real device identity, checked
// against a real uniqueness rule, instead of "whoever has the owner's
// password can register."

// POST /device/register - called by the EXE with the owner's already-
// authenticated adminAuth session (req.user = hotel_id), plus a device_id
// the EXE generates once and persists locally (crypto.randomUUID(), stored
// next to its own SQLite DB - see billerpe-local-exe's device identity
// file). Idempotent for the SAME device (a restart or re-run of
// registerDevice just refreshes metadata); rejects a DIFFERENT device
// while one is already active for this hotel - that rejection is the
// actual enforcement of §6 ("one active local server per restaurant").
const registerLocalServer = async (req, res) => {
    try {
        const hotel_id = req.user;
        const { device_id, hostname, app_version, os_info } = req.body;

        if (!device_id) {
            return res.json(error("device_id is required", STATUSCODE.BAD_REQUEST));
        }

        const hotel = await Hotel.findOne({ where: { id: hotel_id } });
        if (!hotel) {
            return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.NOT_FOUND));
        }

        const activeRegistration = await LocalServerRegistration.findOne({
            where: { hotel_id, status: "active" },
        });

        if (activeRegistration && activeRegistration.device_id !== device_id) {
            return res.json(
                error(
                    "This restaurant already has an active local server registered on another PC. A SuperAdmin must release it before this device can register.",
                    STATUSCODE.CONFLICT,
                ),
            );
        }

        const now = new Date();

        if (activeRegistration) {
            // Same device re-registering (EXE restart, reinstall on the same
            // PC) - refresh metadata rather than minting a new
            // installation_id, which is reserved for a genuine transfer.
            await activeRegistration.update({ hostname, app_version, os_info, last_seen_at: now });
            return res.json(
                success(MESSAGE.SUCCESS, { registration: activeRegistration, reused: true }, STATUSCODE.SUCCESS),
            );
        }

        const registration = await LocalServerRegistration.create({
            hotel_id,
            device_id,
            installation_id: crypto.randomUUID(),
            status: "active",
            hostname,
            app_version,
            os_info,
            registered_at: now,
            last_seen_at: now,
        });

        return res.json(
            success(MESSAGE.SUCCESS, { registration, reused: false }, STATUSCODE.SUCCESS),
        );
    } catch (err) {
        console.error("[localServerRegistration] registerLocalServer error:", err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

// last_seen_at used to be set once at registration and never touched again
// (confirmed by reading every write site) - every "active" registration
// looked identical whether the exe was actually running or had been off for
// days. It's now also touched on every sync tick (offline.js's
// syncOrderDataWithDataBase, piggybacked on the push/pull cycle that
// already fires every SYNC_INTERVAL_SECONDS - no new request), so "online"
// can be genuinely derived from freshness. Threshold is 2.5x the sync
// interval - enough slack for one missed tick plus real network jitter
// without also making a device that's actually been off for 10 minutes
// still read as online.
const ONLINE_THRESHOLD_MS = (Number(process.env.SYNC_INTERVAL_SECONDS) || 60) * 1000 * 2.5;

function withOnlineStatus(registration) {
    if (!registration) return null;
    const plain = registration.toJSON ? registration.toJSON() : registration;
    const online = !!plain.last_seen_at && (Date.now() - new Date(plain.last_seen_at).getTime()) < ONLINE_THRESHOLD_MS;
    return { ...plain, online };
}

// GET /device/status - lets the EXE (or a dashboard) check the current
// registration for its own hotel without guessing from a 409.
const getLocalServerStatus = async (req, res) => {
    try {
        const hotel_id = req.user;
        const registration = await LocalServerRegistration.findOne({
            where: { hotel_id, status: "active" },
        });
        return res.json(success(MESSAGE.SUCCESS, { registration: withOnlineStatus(registration) }, STATUSCODE.SUCCESS));
    } catch (err) {
        console.error("[localServerRegistration] getLocalServerStatus error:", err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

// POST /superAdmin/device/release - SuperAdmin-only (§7: restaurant users
// must not be able to transfer their own server registration). Body:
// { hotel_id }. Frees the hotel up for a new PC to register; the
// previously-active row is kept, not deleted, as the audit trail for who
// released it and when.
const releaseLocalServer = async (req, res) => {
    try {
        const { hotel_id } = req.body;
        if (!hotel_id) {
            return res.json(error("hotel_id is required", STATUSCODE.BAD_REQUEST));
        }

        const activeRegistration = await LocalServerRegistration.findOne({
            where: { hotel_id, status: "active" },
        });
        if (!activeRegistration) {
            return res.json(error("This restaurant has no active local server registration to release", STATUSCODE.BAD_REQUEST));
        }

        await activeRegistration.update({
            status: "released",
            released_at: new Date(),
            released_by: req.user,
        });

        return res.json(success(MESSAGE.SUCCESS, { registration: activeRegistration }, STATUSCODE.SUCCESS));
    } catch (err) {
        console.error("[localServerRegistration] releaseLocalServer error:", err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

// GET /superAdmin/device/list - backs the standalone device-admin utility
// page (public/device-admin.html). No dedicated SuperAdmin frontend exists
// in this workspace (same situation as the Captain App - see the
// architecture memo), so this page is the actual, usable "release a
// restaurant's local server" control until a real admin panel exists.
const listActiveLocalServers = async (_req, res) => {
    try {
        const registrations = await LocalServerRegistration.findAll({
            where: { status: "active" },
            include: { model: Hotel, attributes: ["id", "hotel_name"] },
            order: [["registered_at", "DESC"]],
        });
        return res.json(success(MESSAGE.SUCCESS, { registrations: registrations.map(withOnlineStatus) }, STATUSCODE.SUCCESS));
    } catch (err) {
        console.error("[localServerRegistration] listActiveLocalServers error:", err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

module.exports = { registerLocalServer, getLocalServerStatus, releaseLocalServer, listActiveLocalServers };
