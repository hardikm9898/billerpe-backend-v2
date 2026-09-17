const crypto = require("crypto");
const { Hotel, LocalServerRegistration } = require("../model");
const { MESSAGE, STATUSCODE } = require("../constant/const");
const { success, error } = require("../responce/res");
const { signDeviceToken } = require("../middleware/deviceAuth");

// How long an active registration may go unseen before another PC is
// allowed to take the outlet over WITHOUT anyone confirming. Anything
// shorter risks two machines fighting over one restaurant across a brief
// network blip; anything much longer strands a restaurant whose PC died
// mid-service behind a support call. last_seen_at is refreshed by every
// sync heartbeat (controller/sync/syncController.js), i.e. once a minute
// while the exe is alive.
const STALE_TAKEOVER_MS = 10 * 60 * 1000;

function isStale(registration) {
    if (!registration?.last_seen_at) return true;
    return Date.now() - new Date(registration.last_seen_at).getTime() > STALE_TAKEOVER_MS;
}

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
        const { device_id, hostname, app_version, os_info, replace } = req.body;

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

        const now = new Date();

        // A DIFFERENT PC is asking to become this restaurant's server. Two
        // machines both syncing one outlet would duplicate bills, so this is
        // never silently allowed - but it must not need a support call
        // either, which is what the old hard 409 forced for the common real
        // case (the PC was replaced, or its disk was reimaged).
        //   - previous server not seen for STALE_TAKEOVER_MS: taken over
        //     automatically, since nothing is running there to conflict with.
        //   - previous server still alive: refused with canReplace, so the
        //     owner can confirm in the POS and retry with replace:true.
        // Either way the old row is RELEASED, not deleted (audit trail), and
        // a fresh installation_id invalidates the old device's token.
        if (activeRegistration && activeRegistration.device_id !== device_id) {
            const stale = isStale(activeRegistration);
            if (!stale && !replace) {
                return res.json(error(
                    "Another PC is currently this restaurant's local server. Confirm replacing it to continue.",
                    STATUSCODE.CONFLICT,
                    {
                        canReplace: true,
                        existing: {
                            hostname: activeRegistration.hostname,
                            app_version: activeRegistration.app_version,
                            last_seen_at: activeRegistration.last_seen_at,
                        },
                    },
                ));
            }
            await activeRegistration.update({
                status: "released",
                released_at: now,
                // Not a SuperAdmin release - recorded as a device takeover so
                // the audit trail distinguishes the two.
                released_by: null,
            });
        }

        let registration;
        if (activeRegistration && activeRegistration.device_id === device_id) {
            // Same device re-registering (exe restart, reinstall on the same
            // PC, or an owner re-authenticating from the System page). Keeps
            // its installation_id, so the device token it already holds
            // stays valid.
            await activeRegistration.update({
                hostname, app_version, os_info, last_seen_at: now, token_issued_at: now,
            });
            registration = activeRegistration;
        } else {
            registration = await LocalServerRegistration.create({
                hotel_id,
                device_id,
                installation_id: crypto.randomUUID(),
                status: "active",
                hostname,
                app_version,
                os_info,
                registered_at: now,
                last_seen_at: now,
                token_issued_at: now,
            });
        }

        // The credential the exe's background sync uses from here on - see
        // middleware/deviceAuth.js for why it is not the owner's session.
        const deviceToken = signDeviceToken({
            hotel_id,
            device_id: registration.device_id,
            installation_id: registration.installation_id,
        });

        return res.json(success(MESSAGE.SUCCESS, {
            registration,
            deviceToken,
            reused: Boolean(activeRegistration && activeRegistration.device_id === device_id),
        }, STATUSCODE.SUCCESS));
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
