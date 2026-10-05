const { LocalServerRegistration } = require("../model");

// The owner's outlets with the state of each outlet PC (the exe). The exe
// sends a heartbeat every 60 s (controller/sync/syncController.js), which
// stamps last_seen_at; three missed beats = offline.
const ONLINE_WINDOW_MS = 3 * 60 * 1000;

function pcView(reg, now) {
    if (!reg) return { status: "not-registered", lastSeenAt: null, version: null, updateStatus: null, pcName: null, registeredAt: null, pendingOrders: null, lastPushAt: null };
    const seen = reg.last_seen_at ? new Date(reg.last_seen_at).getTime() : 0;
    return {
        status: seen && now - seen <= ONLINE_WINDOW_MS ? "online" : "offline",
        lastSeenAt: reg.last_seen_at ? new Date(reg.last_seen_at).toISOString() : null,
        version: reg.app_version && reg.app_version !== "unknown" ? reg.app_version : null,
        updateStatus: reg.update_status || null,
        pcName: reg.hostname || null,
        registeredAt: reg.registered_at ? new Date(reg.registered_at).toISOString() : null,
        // From the heartbeat of exe 1.1.7+; null = this PC's BillerPe is too old to say.
        pendingOrders: reg.pending_orders ?? null,
        lastPushAt: reg.last_push_at ? new Date(reg.last_push_at).toISOString() : null,
    };
}

async function outlets(o) {
    const ids = o.owned.map((x) => x.hotel.id);
    const regs = await LocalServerRegistration.findAll({ where: { hotel_id: ids, status: "active" }, raw: true });
    const now = Date.now();
    return {
        serverTime: new Date(now).toISOString(),
        outlets: o.owned.map(({ hotel }) => ({
            id: hotel.id,
            name: hotel.hotel_name,
            subscriptionEndsOn: hotel.plan_end_date ? new Date(hotel.plan_end_date).toISOString().slice(0, 10) : null,
            pc: pcView(regs.find((r) => r.hotel_id === hotel.id), now),
        })),
    };
}

/** Throws a rule error unless this owner owns the outlet (multi-tenant guard for every per-outlet call). */
function ownOutlet(o, outletId) {
    const id = Number(outletId);
    if (!o.outletIds.has(id)) {
        const { RuleError } = require("../appv1/core");
        throw new RuleError("You do not own this outlet");
    }
    return id;
}

module.exports = { outlets, ownOutlet, pcView, ONLINE_WINDOW_MS };
