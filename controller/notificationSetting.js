const Hotel = require("../model/hotel");
const NotificationSetting = require("../model/notificationSetting");
const { STATUSCODE, MESSAGE } = require("../constant/const");
const { error, success } = require("../responce/res");

const getNotificationSettings = async (req, res) => {
    try {
        const hotel = await Hotel.findOne({ where: { id: req.user } });
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST));
        const settings = await NotificationSetting.findAll({ where: { hotel_id: req.user } });
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { settings }, STATUSCODE.SUCCESS));
    } catch (err) {
        console.error(err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

// Toggles exactly one channel on exactly one trigger - matches
// billerpe-pos-pro-v2's own toggleNotificationSetting(trigger, channel)
// call shape 1:1, so the frontend never needs to know/send the other two
// channels' current values just to flip one.
const toggleNotificationSetting = async (req, res) => {
    try {
        const { trigger, channel } = req.body;
        if (!trigger || !["whatsapp", "sms", "in_app"].includes(channel)) {
            return res.json(error("trigger and a valid channel (whatsapp/sms/in_app) are required", STATUSCODE.BAD_REQUEST));
        }
        const existing = await NotificationSetting.findOne({ where: { hotel_id: req.user, trigger } });
        if (!existing) return res.json(error("Notification Setting Not Found", STATUSCODE.NOT_FOUND));

        await NotificationSetting.update(
            { [channel]: !existing[channel] },
            { where: { id: existing.id, hotel_id: req.user } },
        );
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { message: "Notification Setting Updated Successfully" }, STATUSCODE.SUCCESS));
    } catch (err) {
        console.error(err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

module.exports = { getNotificationSettings, toggleNotificationSetting };
