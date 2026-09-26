// COPY of billerpe-local-exe/utils/dateUtils.js for the POS App (Plan 2) -
// written by scripts/vendor-exe-for-appv1.py. Do not edit here: change the
// exe's file and re-run the script, so both plans keep the same rules.

const moment = require("moment-timezone");
const { RestaurantSetting } = require("../model");

// Port of uat-backend-v2/utils/dateUtils.js. The source implements
// getBusinessDate with dayjs and getShiftedDateRange with moment-timezone -
// two different date libraries for equivalent timezone math in the same
// file. Reimplemented here with moment-timezone alone (already a real
// dependency via Sequelize) rather than adding dayjs as a second one purely
// to match that inconsistency - behavior is identical, verified by test.

// Pure and model-free, so it lives in utils/businessDate.js where
// model/orderHooks.js can use it without a require cycle.
const { getBusinessDate } = require("./businessDate");

const getShiftedDateRange = async (start, end, hotel_id) => {
    let tz = "Asia/Kolkata";
    let startTime = "00:01:00";

    if (hotel_id) {
        const setting = await RestaurantSetting.findOne({ where: { hotel_id } });
        if (setting) {
            tz = setting.timeZone || tz;
            startTime = setting.business_day_start_time || startTime;
        }
    }

    const [hours, minutes, seconds] = startTime.split(":").map(Number);

    let startDateTz = start ? moment.tz(start, tz) : moment.tz(tz);
    let endDateTz = end ? moment.tz(end, tz) : moment.tz(tz);

    const realTimeNow = moment.tz(tz);
    const businessStartTimeForToday = realTimeNow.clone().set({ hour: hours, minute: minutes, second: seconds, millisecond: 0 });

    const isStartAskingForToday = start && startDateTz.isSame(realTimeNow, "day");
    const isEndAskingForToday = end && endDateTz.isSame(realTimeNow, "day");

    if ((!start || isStartAskingForToday) && realTimeNow.isBefore(businessStartTimeForToday)) {
        startDateTz.subtract(1, "days");
    }
    if ((!end || isEndAskingForToday) && realTimeNow.isBefore(businessStartTimeForToday)) {
        endDateTz.subtract(1, "days");
    }

    const adjustedStart = startDateTz.clone().set({ hour: hours, minute: minutes, second: seconds, millisecond: 0 });
    const adjustedEnd = endDateTz.clone().add(1, "days").set({ hour: hours, minute: minutes, second: seconds, millisecond: 0 }).subtract(1, "milliseconds");

    const daysDiff = (start && end) ? Math.max(1, endDateTz.clone().startOf("day").diff(startDateTz.clone().startOf("day"), "days") + 1) : 1;
    const previousAdjustedStart = adjustedStart.clone().subtract(daysDiff, "days");

    const hasTimeFilter = !!(
        (start && /T\d{2}:\d{2}/.test(start)) ||
        (end && /T\d{2}:\d{2}/.test(end))
    );
    const createdAtStart = hasTimeFilter && start ? moment.tz(start, tz).toDate() : null;
    const createdAtEnd = hasTimeFilter && end ? moment.tz(end, tz).toDate() : null;

    return {
        startD: adjustedStart.toDate(),
        endD: adjustedEnd.toDate(),
        previousStartD: previousAdjustedStart.toDate(),
        businessStartDate: startDateTz.format("YYYY-MM-DD"),
        businessEndDate: endDateTz.format("YYYY-MM-DD"),
        previousBusinessStartDate: startDateTz.clone().subtract(daysDiff, "days").format("YYYY-MM-DD"),
        previousBusinessEndDate: startDateTz.clone().subtract(1, "days").format("YYYY-MM-DD"),
        timezone: tz,
        businessStartTime: startTime,
        hasTimeFilter,
        createdAtStart,
        createdAtEnd,
    };
};

module.exports = { getShiftedDateRange, getBusinessDate };
