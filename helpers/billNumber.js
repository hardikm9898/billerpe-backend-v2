/**
 * Financial Year Bill Number Helper
 *
 * Provides utilities for dynamic, financial-year-aware bill number generation.
 * Respects per-hotel timezone and configurable FY start month.
 */

const momentTimezone = require('moment-timezone');
const { Op } = require('sequelize');
const Order = require('../model/order');
const RestaurantSetting = require('../model/restaurantSetting');
const sequelize = require('../connection/connect');

const BILL_RESET_TYPE = {
    NEVER: 'never',
    FINANCIAL_YEAR: 'financial_year',
};

/**
 * Returns the start Date of the current financial year in the hotel's timezone.
 *
 * @param {number} startMonth - 1–12 (1 = January, 4 = April, 7 = July, …)
 * @param {string} timeZone   - IANA timezone string (e.g. 'Asia/Kolkata')
 * @returns {Date}
 */
function getFinancialYearStartDate(startMonth, timeZone) {
    const now = momentTimezone().tz(timeZone);
    const currentMonth = now.month() + 1; // moment months are 0-indexed

    // FY started in the current calendar year if we've passed the start month,
    // otherwise it started in the previous calendar year.
    const fyStartYear = currentMonth >= startMonth ? now.year() : now.year() - 1;

    return momentTimezone.tz(
        { year: fyStartYear, month: startMonth - 1, date: 1, hour: 0, minute: 0, second: 0, millisecond: 0 },
        timeZone
    ).toDate();
}

/**
 * Returns the end Date of the current financial year in the hotel's timezone.
 * Defined as 1 ms before the next financial year starts.
 *
 * @param {number} startMonth - 1–12
 * @param {string} timeZone   - IANA timezone string
 * @returns {Date}
 */

function getFinancialYearEndDate(startMonth, timeZone) {
    const now = momentTimezone().tz(timeZone);
    const currentMonth = now.month() + 1;

    const fyStartYear = currentMonth >= startMonth ? now.year() : now.year() - 1;
    const nextFyStartYear = fyStartYear + 1;

    return momentTimezone.tz(
        { year: nextFyStartYear, month: startMonth - 1, date: 1, hour: 0, minute: 0, second: 0, millisecond: 0 },
        timeZone
    ).subtract(1, 'millisecond').toDate();
}

/**
 * Returns a human-readable financial year label.
 *
 * Examples:
 *   startMonth = 4 (April)  → "2025-26"
 *   startMonth = 1 (January) → "2025"   (calendar year)
 *
 * @param {number} startMonth - 1–12
 * @param {string} [timeZone='Asia/Kolkata']
 * @returns {string}
 */
function getFinancialYearLabel(startMonth, timeZone = 'Asia/Kolkata') {
    const now = momentTimezone().tz(timeZone);
    const currentMonth = now.month() + 1;

    const fyStartYear = currentMonth >= startMonth ? now.year() : now.year() - 1;

    if (startMonth === 1) {
        return `${fyStartYear}`;
    }

    const fyEndYear = fyStartYear + 1;
    return `${fyStartYear}-${String(fyEndYear).slice(-2)}`;
}

/**
 * Computes the next bill number for a hotel.
 *
 * Behaviour:
 *   - Fetches the hotel's RestaurantSetting (bill_reset_type, financial_year_start_month, timeZone).
 *   - If bill_reset_type === 'financial_year', only considers orders in the current FY window.
 *   - Otherwise falls back to the original "highest bill_no ever" logic.
 *   - Always excludes offline and soft-deleted orders (matching existing logic).
 *   - Returns 1 when no qualifying orders exist.
 *
 * @param {number} hotelId
 * @returns {Promise<number>} next bill number (integer ≥ 1)
 */
async function getNextBillNo(hotelId) {
    const settings = await RestaurantSetting.findOne({
        where: { hotel_id: hotelId },
        attributes: ['bill_reset_type', 'financial_year_start_month', 'timeZone'],
    });

    const billResetType = settings?.bill_reset_type ?? BILL_RESET_TYPE.NEVER;
    const startMonth = settings?.financial_year_start_month ?? 4;
    const timeZone = settings?.timeZone ?? 'Asia/Kolkata';

    const baseWhere = {
        hotel_id: hotelId,
        isOffline: false,
        deleted: false,
    };

    if (billResetType === BILL_RESET_TYPE.FINANCIAL_YEAR) {
        baseWhere.createdAt = {
            [Op.between]: [
                getFinancialYearStartDate(startMonth, timeZone),
                getFinancialYearEndDate(startMonth, timeZone),
            ],
        };
    }

    const latestOrder = await Order.findOne({
        where: baseWhere,
        order: [[sequelize.literal('CAST(bill_no AS UNSIGNED)'), 'DESC']],
        attributes: ['bill_no'],
    });

    return latestOrder ? parseInt(latestOrder.bill_no, 10) + 1 : 1;
}

module.exports = {
    getFinancialYearStartDate,
    getFinancialYearEndDate,
    getFinancialYearLabel,
    getNextBillNo,
};
