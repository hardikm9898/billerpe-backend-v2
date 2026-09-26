// COPY of billerpe-local-exe/utils/businessDate.js for the POS App (Plan 2) -
// written by scripts/vendor-exe-for-appv1.py. Do not edit here: change the
// exe's file and re-run the script, so both plans keep the same rules.

const moment = require("moment-timezone");

// The hotel's business day for a moment in time: before the configured
// start time (RestaurantSetting.business_day_start_time) it still belongs
// to the previous day, so a bar trading past midnight keeps one day.
const getBusinessDate = (timeZone, businessStartTime, providedDate = null) => {
    const now = providedDate ? moment.tz(providedDate, timeZone) : moment.tz(timeZone);
    const [startHour, startMinute] = businessStartTime.split(":").map(Number);
    const todayBusinessStart = now.clone().hour(startHour).minute(startMinute).second(0);

    if (now.isBefore(todayBusinessStart)) {
        return now.clone().subtract(1, "day").format("YYYY-MM-DD");
    }
    return now.format("YYYY-MM-DD");
};

module.exports = { getBusinessDate };
