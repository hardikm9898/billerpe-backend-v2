const { PLAN_LABEL, parse } = require("./common");

// One outlet as the panel shows it (account page, Outlets screen). The PC's
// online state is read live from its registration; the rest comes from the
// last health check (signals, at most 15 minutes old).

// Same rule as the exe's own status (controller/localServerRegistration.js):
// 2.5 heartbeats without a beat = offline.
const ONLINE_MS = (Number(process.env.SYNC_INTERVAL_SECONDS) || 60) * 1000 * 2.5;

function outletRow(link, hotel, reg, now = Date.now(), account = null) {
    const sig = parse(link && link.signals) || {};
    const app = hotel.product_plan === "CLOUD_APP";
    const seen = reg && reg.last_seen_at ? new Date(reg.last_seen_at).getTime() : 0;
    const online = !!seen && now - seen < ONLINE_MS;
    return {
        hotelId: hotel.id,
        name: hotel.hotel_name,
        city: hotel.address2 || "",
        active: hotel.active !== false && hotel.active !== 0,
        account: account ? { id: account.id, name: account.name, mobile: account.owner_mobile } : link ? { id: link.account_id, name: "", mobile: "" } : null,
        plan: hotel.product_plan || "LOCAL_SUITE",
        planLabel: PLAN_LABEL[hotel.product_plan] || "Local Suite",
        planName: (link && link.plan_name) || "",
        planEnd: hotel.plan_end_date || null,
        health: (link && link.health) || "grey",
        reasons: parse(link && link.health_reasons) || [],
        healthSince: (link && link.health_since) || null,
        healthAt: (link && link.health_at) || null,
        onboarding: (link && link.onboarding) || "none",
        pc: app
            ? { state: "app", devices: sig.devices ?? 0, deviceLimit: hotel.app_device_limit ?? null }
            : reg
              ? {
                  state: online ? "online" : "offline",
                  seenAt: reg.last_seen_at || null,
                  hostname: reg.hostname || "",
                  os: reg.os_info || "",
                  version: reg.app_version || "",
                  updateStatus: reg.update_status || "",
                  registeredAt: reg.registered_at || null,
              }
              : { state: "none" },
        latest: sig.latest || null,
        behind: sig.behind ?? null,
        billsToday: sig.billsToday ?? null,
        salesToday: sig.salesToday ?? null,
        billsYesterday: sig.billsYesterday ?? null,
        normal: sig.normal ?? null,
        daysSinceBill: sig.daysSinceBill ?? null,
        lastBillDay: sig.lastBillDay ?? null,
        backlog: sig.backlog || null,
        tickets: sig.tickets || { open: 0, oldestAt: null },
        ebill: sig.ebill || null,
        createdAt: hotel.createdAt || null,
    };
}

module.exports = { outletRow, ONLINE_MS };
