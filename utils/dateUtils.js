const moment = require("moment-timezone");
const RestaurantSetting = require("../model/restaurantSetting");
const dayjs = require("dayjs")
const utc = require("dayjs/plugin/utc");
const timezone = require("dayjs/plugin/timezone");

dayjs.extend(utc);
dayjs.extend(timezone);

const getBusinessDate = (timeZone, businessStartTime, providedDate = null) => {

    const now = providedDate ? dayjs(providedDate).tz(timeZone) : dayjs().tz(timeZone);
    const [startHour, startMinute] = businessStartTime.split(":").map(Number);
    const todayBusinessStart = now
        .hour(startHour)
        .minute(startMinute)
        .second(0)

    let businessDate
    if (now.isBefore(todayBusinessStart)) {
        businessDate = now.subtract(1, "day").format("YYYY-MM-DD")
    } else {
        businessDate = now.format("YYYY-MM-DD")
    }
    return businessDate
}

const getShiftedDateRange = async (start, end, hotel_id) => {
    // defaults
    let tz = "Asia/Kolkata";
    let startTime = "00:01:00";

    if (hotel_id) {
        const setting = await RestaurantSetting.findOne({ where: { hotel_id } });
        if (setting) {
            tz = setting.timeZone || tz;
            startTime = setting.business_day_start_time || startTime;
        }
    }

    const [hours, minutes, seconds] = startTime.split(':').map(Number);

    // If start is provided, parse it in the hotel's timezone.
    // If not, default to current time in the hotel's timezone.
    let startDateTz = start ? moment.tz(start, tz) : moment.tz(tz);
    let endDateTz = end ? moment.tz(end, tz) : moment.tz(tz);

    // If the current time in the given timezone hasn't reached the business_day_start_time yet,
    // we logically consider it as still part of the 'previous' business day.
    const realTimeNow = moment.tz(tz);
    const businessStartTimeForToday = realTimeNow.clone().set({ hour: hours, minute: minutes, second: seconds, millisecond: 0 });

    const isStartAskingForToday = start && startDateTz.isSame(realTimeNow, 'day');
    const isEndAskingForToday = end && endDateTz.isSame(realTimeNow, 'day');

    if ((!start || isStartAskingForToday) && realTimeNow.isBefore(businessStartTimeForToday)) {
        startDateTz.subtract(1, 'days');
    }

    if ((!end || isEndAskingForToday) && realTimeNow.isBefore(businessStartTimeForToday)) {
        endDateTz.subtract(1, 'days');
    }

    // Business Start UTC Date:
    const adjustedStart = startDateTz.clone().set({ hour: hours, minute: minutes, second: seconds, millisecond: 0 });

    // Business End UTC Date:
    const adjustedEnd = endDateTz.clone().add(1, 'days').set({ hour: hours, minute: minutes, second: seconds, millisecond: 0 }).subtract(1, 'milliseconds');

    // Previous start date (for percentage changes - match the length of the requested period)
    const daysDiff = (start && end) ? Math.max(1, endDateTz.clone().startOf('day').diff(startDateTz.clone().startOf('day'), 'days') + 1) : 1;
    const previousAdjustedStart = adjustedStart.clone().subtract(daysDiff, 'days');

    // When the input includes a time component (ISO format with T), preserve it for
    // createdAt-based filtering so reports can narrow results within a business day.
    const hasTimeFilter = !!(
        (start && /T\d{2}:\d{2}/.test(start)) ||
        (end && /T\d{2}:\d{2}/.test(end))
    );
    const createdAtStart = hasTimeFilter && start ? moment.tz(start, tz).toDate() : null;
    const createdAtEnd   = hasTimeFilter && end   ? moment.tz(end, tz).toDate()   : null;

    console.log({
        startD: adjustedStart.toDate(),
        endD: adjustedEnd.toDate(),
        previousStartD: previousAdjustedStart.toDate(),
        businessStartDate: startDateTz.format('YYYY-MM-DD'),
        businessEndDate: endDateTz.format('YYYY-MM-DD'),
        previousBusinessStartDate: startDateTz.clone().subtract(daysDiff, 'days').format('YYYY-MM-DD'),
        previousBusinessEndDate: startDateTz.clone().subtract(1, 'days').format('YYYY-MM-DD'),
        timezone: tz,
        businessStartTime: startTime,
        hasTimeFilter,
        createdAtStart,
        createdAtEnd,
    })
    return {
        startD: adjustedStart.toDate(),
        endD: adjustedEnd.toDate(),
        previousStartD: previousAdjustedStart.toDate(),
        businessStartDate: startDateTz.format('YYYY-MM-DD'),
        businessEndDate: endDateTz.format('YYYY-MM-DD'),
        previousBusinessStartDate: startDateTz.clone().subtract(daysDiff, 'days').format('YYYY-MM-DD'),
        previousBusinessEndDate: startDateTz.clone().subtract(1, 'days').format('YYYY-MM-DD'),
        timezone: tz,
        businessStartTime: startTime,
        hasTimeFilter,
        createdAtStart,
        createdAtEnd,
    };
};

module.exports = {
    getShiftedDateRange,
    getBusinessDate
};
