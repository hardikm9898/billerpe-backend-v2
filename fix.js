const sequelize = require('./connection/connect');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
dayjs.extend(utc);
dayjs.extend(timezone);

const getBusinessDate = (now, timeZone, businessStartTime) => {
    const [startHour, startMinute] = businessStartTime.split(':').map(Number);
    const todayBusinessStart = now.hour(startHour).minute(startMinute).second(0).millisecond(0);
    if (now.isBefore(todayBusinessStart)) {
        return now.subtract(1, 'day').format('YYYY-MM-DD');
    }
    return now.format('YYYY-MM-DD');
};

const { Op } = require('sequelize');
const { Order, RestaurantSetting } = require('./model');

async function fix() {
  const orders = await Order.findAll({
    where: {
      createdAt: { [Op.gt]: '2026-03-08T00:00:00Z' }
    }
  });
  console.log('Found', orders.length, 'orders to repair.');
  let updatedCount = 0;
  for (const o of orders) {
    if (!o.hotel_id) continue;
    
    // some hotels might not have a settings row yet
    let timeZone = 'Asia/Kolkata';
    let businessStartTime = '00:01:00';
    
    try {
        const setting = await RestaurantSetting.findOne({ where: { hotel_id: o.hotel_id } });
        if (setting) {
            timeZone = setting.timeZone || 'Asia/Kolkata';
            businessStartTime = setting.business_day_start_time || '00:01:00';
        }
    } catch (e) { }
    
    const tzDateStr = o.createdAt.toISOString();
    const createdDayjs = dayjs(tzDateStr).tz(timeZone);
    const correctBusinessDate = getBusinessDate(createdDayjs, timeZone, businessStartTime);
    
    if (o.business_date !== correctBusinessDate) {
        await o.update({ business_date: correctBusinessDate });
        updatedCount++;
    }
  }
  
  console.log('Fixed', updatedCount, 'orders.');
  process.exit(0);
}
fix();
