// COPY of billerpe-local-exe/controller/kitchen.js for the POS App (Plan 2) -
// written by scripts/vendor-exe-for-appv1.py. Do not edit here: change the
// exe's file and re-run the script, so both plans keep the same rules.

const { KitchenSetting, Menu_categ, Menu, Table } = require("../model");
const { MESSAGE, STATUSCODE } = require("../../../constant/const");
const { success, error } = require("../../../responce/res");

// Ported from uat-backend-v2/controller/kds/kds.js's getAllKitchen/
// createKitchen/setCategoryForKitchen/deleteKitchen - matches
// kitchenApi (billerpe-pos-pro-v2's api.ts) exactly, including its own
// documented quirks: createKitchen only accepts kitchen_name (table_ids/
// menu_categ_ids/order_type are auto-populated with every currently-
// active table/category and both order types - setCategoryForKitchen is
// the only way to actually change them afterward), and there's no rename
// endpoint at all (confirmed by the real routes file).
const getAllKitchen = async (req, res) => {
    try {
        const kitchen = await KitchenSetting.findAll({ where: { hotel_id: req.user } });
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { kitchen }, STATUSCODE.SUCCESS));
    } catch (err) {
        console.error("[kitchen] getAllKitchen error:", err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

const createKitchen = async (req, res) => {
    try {
        const { kitchen_name } = req.body;
        const menuCategIds = (
            await Menu_categ.findAll({
                where: { hotel_id: req.user, active: true },
                include: { model: Menu, where: { active: true } },
                attributes: ["id"],
            })
        ).map((el) => el.id);
        const tableIds = (await Table.findAll({ where: { hotel_id: req.user, active: true }, attributes: ["id"] })).map((el) => el.id);

        const checkAvailable = await KitchenSetting.findOne({ where: { kitchen_name, hotel_id: req.user } });
        if (checkAvailable) return res.json(error("This Kitchen Name Already Available", STATUSCODE.BAD_REQUEST));

        await KitchenSetting.create({
            hotel_id: req.user, kitchen_name,
            menu_categ_ids: menuCategIds, table_ids: tableIds, order_type: ["dinin", "pickup"],
        });
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { message: "Kitchen Created Successfully" }, STATUSCODE.SUCCESS));
    } catch (err) {
        console.error("[kitchen] createKitchen error:", err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

const setCategoryForKitchen = async (req, res) => {
    try {
        const { table_ids, menu_categ_ids, order_type, id } = req.body;
        const kitchen = await KitchenSetting.findByPk(id);
        if (!kitchen) return res.json(error("Kitchen Not Found", STATUSCODE.BAD_REQUEST));
        await KitchenSetting.update({ table_ids, menu_categ_ids, order_type }, { where: { id, hotel_id: req.user } });
        return res.json(success(MESSAGE.SUCCESS, { message: "Kitchen Setting Successfully" }, STATUSCODE.SUCCESS));
    } catch (err) {
        console.error("[kitchen] setCategoryForKitchen error:", err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

const deleteKitchen = async (req, res) => {
    try {
        const { id } = req.params;
        await KitchenSetting.destroy({ where: { id: parseInt(id, 10), hotel_id: req.user } });
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { message: "Kitchen Deleted Successfully" }, STATUSCODE.SUCCESS));
    } catch (err) {
        console.error("[kitchen] deleteKitchen error:", err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

module.exports = { getAllKitchen, createKitchen, setCategoryForKitchen, deleteKitchen };
