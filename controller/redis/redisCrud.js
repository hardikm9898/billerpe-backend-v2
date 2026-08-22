const Menu = require("../../model/menu");
const Menu_categ = require("../../model/menu_categ");
const Order = require("../../model/order");
const OrderDetails = require("../../model/order_details");
const Table = require("../../model/table");
const TableCatagories = require("../../model/table_catg");
const User = require("../../model/user");
const Variants = require("../../model/variants");
const redisClient = require("../../connection/redis");
const Hotel = require("../../model/hotel");
const InvoiceFormate = require("../../model/invoiceFormate");
const ServiceCharge = require("../../model/serviceCharge");
const Addons = require("../../model/addons");
const AddonDepartment = require("../../model/addonDepartMent");
const { error, success } = require("../../responce/res");
const { STATUSCODE, MESSAGE } = require("../../constant/const");

// ─────────────────────────────────────────────────────────────────────────────
// SHARED INCLUDE DEFINITIONS  (avoids repeating deep include arrays)
// ─────────────────────────────────────────────────────────────────────────────

const ORDER_INCLUDES = [
    { model: Table, include: { model: TableCatagories } },
    { model: User },
    {
        model: OrderDetails,
        include: [
            { model: Menu, include: { model: Menu_categ } },
            { model: Variants, as: "variantData" }
        ]
    }
];

const TABLE_INCLUDES = {
    model: TableCatagories,
    where: { active: true }
};

const TABLE_CATEGORY_INCLUDES = {
    model: Table,
    required: false,
    where: { active: true },
    include: { model: TableCatagories, required: false }
};

const MENU_INCLUDES = [
    { model: Menu_categ },
    { model: Variants, as: "variantData", where: { active: true }, required: false },
    { model: AddonDepartment, as: "addonDepartmentData", include: { model: Addons } }
];

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get parsed JSON from Redis. Returns null if key missing or parse fails.
 */
const redisGet = async (key) => {
    const raw = await redisClient.get(key);
    if (!raw) return null;
    return JSON.parse(raw);
};

/**
 * Set JSON value in Redis with 48h TTL.
 */
const redisSet = async (key, data) => {
    await redisClient.set(key, JSON.stringify(data), { EX: 172800 });
};

// ─────────────────────────────────────────────────────────────────────────────
// ORDER CACHE
// ─────────────────────────────────────────────────────────────────────────────

const updateOrderAppendToRadis = async (id, hotel_id, t = false) => {
    try {
        const key = `hotel:${hotel_id}:orders`;
        let oldData = await redisGet(key);
        if (!oldData) return;

        const order = await Order.findOne({
            where: { id, hotel_id, deleted: 0 },
            include: ORDER_INCLUDES,
            ...(t && { transaction: t })
        });

        if (order) {
            oldData = oldData.map(el => (el.id === order.id ? order.toJSON() : el));
        }

        await redisSet(key, oldData);
    } catch (err) {
        throw new Error(err);
    }
};

const newOrderAppendToRadis = async (id, hotel_id, t = false) => {
    try {
        const key = `hotel:${hotel_id}:orders`;
        let oldData = await redisGet(key);
        if (!oldData) return;

        const order = await Order.findOne({
            where: { id, hotel_id, deleted: 0 },
            include: ORDER_INCLUDES,
            ...(t && { transaction: t })
        });

        if (order) {
            oldData = [...oldData, order];
        }

        await redisSet(key, oldData);
    } catch (err) {
        throw new Error(err);
    }
};

const deleteOrderToRedis = async (id, hotel_id) => {
    try {
        const key = `hotel:${hotel_id}:orders`;
        let oldData = await redisGet(key);
        if (!oldData) return;

        oldData = oldData.filter(el => el.id !== +id);

        await redisSet(key, oldData);
    } catch (err) {
        console.error(err);
        throw new Error("deleteOrderToRedis");
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// RESTAURANT CACHE
// ─────────────────────────────────────────────────────────────────────────────

const updatedRestaurantToRadis = async (hotel_id) => {
    try {
        const key = `hotel:${hotel_id}:restaurant`;
        let restaurants = await redisGet(key);
        if (!restaurants) return;

        const restaurantsNew = await Hotel.findOne({
            where: { id: hotel_id },
            include: [{ model: InvoiceFormate }, { model: ServiceCharge }]
        });

        if (restaurantsNew) {
            restaurants = restaurantsNew;
        }

        await redisSet(key, restaurants);
    } catch (err) {
        throw new Error("Update Restaurant To Redis");
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// TABLE CACHE
// ─────────────────────────────────────────────────────────────────────────────

const newTableCreatedToRadis = async (id, hotel_id) => {
    try {
        const key = `hotel:${hotel_id}:table`;
        let oldData = await redisGet(key);
        if (!oldData) return;

        const table = await Table.findOne({
            where: { id, hotel_id, active: true },
            include: TABLE_INCLUDES,
            required: true
        });

        if (table) {
            oldData = [...oldData, table];
            await redisSet(key, oldData);
        }
    } catch (err) {
        throw new Error(err);
    }
};

const updateTableToRadis = async (id, hotel_id, t = false) => {
    try {
        await updateTableCategoryUsingTableId(id, hotel_id, t);

        const key = `hotel:${hotel_id}:table`;
        let tables = await redisGet(key);
        if (!tables) return;

        const tablesUpdate = await Table.findOne({
            where: { id, hotel_id, active: true },
            include: TABLE_INCLUDES,
            required: true,
            ...(t && { transaction: t })
        });

        if (tablesUpdate) {
            tables = tables.map(el => (el.id === tablesUpdate.id ? tablesUpdate : el));
        }

        await redisSet(key, tables);
    } catch (err) {
        throw new Error(err);
    }
};

const updateTableCategoryUsingTableId = async (id, hotel_id, t = false) => {
    try {
        const table = await Table.findOne({
            where: { id, hotel_id, active: true },
            include: TABLE_INCLUDES,
            required: true
        });
        if (table) {
            await updateTableCategoryToRadis(table.table_catag_id, hotel_id, t);
        }
    } catch (err) {
        throw new Error("Something Wrong Here updateTableCategoryUsingTableId");
    }
};

const deleteTableToRedis = async (id, hotel_id) => {
    try {
        const key = `hotel:${hotel_id}:table`;
        let tables = await redisGet(key);
        if (!tables) return;

        const findTable = tables.find(el => el.id === id);
        if (findTable) {
            await updateTableCategoryToRadis(findTable.table_catag_id, hotel_id);
        }

        tables = tables.filter(el => el.id !== +id);
        await redisSet(key, tables);
    } catch (err) {
        throw new Error(err);
    }
};

const deleteAllTableByCategoryToRedis = async (id, hotel_id) => {
    try {
        const key = `hotel:${hotel_id}:table`;
        let tables = await redisGet(key);
        if (!tables) return;

        tables = tables.filter(el => el.table_catag_id !== +id);
        await redisSet(key, tables);
    } catch (err) {
        throw new Error(err);
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// TABLE CATEGORY CACHE
// ─────────────────────────────────────────────────────────────────────────────

const newTableCategoryCreatedToRadis = async (id, hotel_id) => {
    try {
        const key = `hotel:${hotel_id}:tableCategory`;
        let oldData = await redisGet(key);
        if (!oldData) return;

        const tableCategory = await TableCatagories.findOne({
            where: { id, hotel_id, active: true },
            include: TABLE_CATEGORY_INCLUDES
        });

        if (tableCategory) {
            oldData = [...oldData, tableCategory];
            await redisSet(key, oldData);
        }
    } catch (err) {
        throw new Error(err);
    }
};

const updateTableCategoryToRadis = async (id, hotel_id, t = false) => {
    try {
        const key = `hotel:${hotel_id}:tableCategory`;
        let tables = await redisGet(key);
        if (!tables) return;

        const tablesUpdate = await TableCatagories.findOne({
            where: { id, hotel_id, active: true },
            include: TABLE_CATEGORY_INCLUDES,
            ...(t && { transaction: t })
        });

        if (tablesUpdate) {
            tables = tables.map(el => (el.id === tablesUpdate.id ? tablesUpdate : el));
        }

        await redisSet(key, tables);
    } catch (err) {
        throw new Error(err);
    }
};

const deleteTableCategoryToRedis = async (id, hotel_id) => {
    try {
        const key = `hotel:${hotel_id}:tableCategory`;
        let tables = await redisGet(key);
        if (!tables) return;

        tables = tables.filter(el => el.id !== +id);
        await redisSet(key, tables);
    } catch (err) {
        throw new Error(err);
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// MENU CACHE
// ─────────────────────────────────────────────────────────────────────────────

const newMenuCreatedToRadis = async (id, hotel_id) => {
    try {
        const key = `hotel:${hotel_id}:menu`;
        let oldData = await redisGet(key);
        if (!oldData) return;

        const menu = await Menu.findOne({
            where: { id, hotel_id, active: true },
            include: MENU_INCLUDES
        });

        if (menu) {
            oldData = [...oldData, menu];
            await redisSet(key, oldData);
        }
    } catch (err) {
        throw new Error(err);
    }
};

const updateMenuToRadis = async (id, hotel_id) => {
    try {
        const key = `hotel:${hotel_id}:menu`;
        let menus = await redisGet(key);
        if (!menus) return;

        const menuUpdate = await Menu.findOne({
            where: { id, hotel_id, active: true },
            include: MENU_INCLUDES
        });

        if (menuUpdate) {
            menus = menus.map(el => (el.id === menuUpdate.id ? menuUpdate : el));
        } else {
            menus = menus.filter(el => el.id !== +id);
        }

        await redisSet(key, menus);
    } catch (err) {
        throw new Error(err);
    }
};

const deleteMenuToradis = async (id, hotel_id) => {
    try {
        const key = `hotel:${hotel_id}:menu`;
        let menus = await redisGet(key);
        if (!menus) return;

        const menuUpdate = await Menu.findOne({
            where: { id, hotel_id, active: true },
            include: MENU_INCLUDES
        });

        if (menuUpdate) {
            menus = menus.map(el => (el.id === menuUpdate.id ? menuUpdate : el));
        } else {
            menus = menus.filter(el => el.id !== +id);
        }

        await redisSet(key, menus);
    } catch (err) {
        throw new Error(err);
    }
};

const updateMenuToForMerchantRadis = async (id, hotel_id) => {
    try {
        const key = `hotel:${hotel_id}:menu`;
        let menus = await redisGet(key);
        if (!menus) return;

        const menuFromDB = await Menu.findOne({
            where: { id, hotel_id, active: true },
            include: MENU_INCLUDES
        });

        const index = menus.findIndex(m => m.id === +id);

        if (menuFromDB) {
            if (index !== -1) {
                menus[index] = menuFromDB;
            } else {
                menus.push(menuFromDB);
            }
        } else {
            if (index !== -1) {
                menus.splice(index, 1);
            }
        }

        await redisSet(key, menus);
    } catch (err) {
        console.error("updateMenuToForMerchantRadis Error:", err);
        throw err;
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// MENU CATEGORY CACHE
// ─────────────────────────────────────────────────────────────────────────────

const newMenuCategoryCreatedToRadis = async (id, hotel_id) => {
    try {
        const key = `hotel:${hotel_id}:menu_category`;
        let oldData = await redisGet(key);
        if (!oldData) return;

        const category = await Menu_categ.findOne({ where: { id, hotel_id, active: true } });
        if (category) {
            oldData = [...oldData, category];
            await redisSet(key, oldData);
        }
    } catch (err) {
        throw new Error(err);
    }
};

const updateMenucategoryToRadis = async (id, hotel_id) => {
    try {
        const key = `hotel:${hotel_id}:menu_category`;
        let menus = await redisGet(key);
        if (!menus) return;

        const menuUpdate = await Menu_categ.findOne({ where: { id, hotel_id, active: true } });
        if (menuUpdate) {
            menus = menus.map(el => (el.id === menuUpdate.id ? menuUpdate : el));
            await redisSet(key, menus);
        }
    } catch (err) {
        throw new Error(err);
    }
};

const deleteMenucategoryToRadis = async (id, hotel_id) => {
    try {
        const key = `hotel:${hotel_id}:menu_category`;
        let categories = await redisGet(key);
        if (!categories) return;

        const categoryFromDB = await Menu_categ.findOne({ where: { id, hotel_id, active: true } });
        const index = categories.findIndex(cat => cat.id === +id);

        if (categoryFromDB) {
            if (index !== -1) {
                categories[index] = categoryFromDB;
            } else {
                categories.push(categoryFromDB);
            }
        } else {
            if (index !== -1) {
                categories.splice(index, 1);
            }
        }

        await redisSet(key, categories);
    } catch (err) {
        console.error("deleteMenucategoryToRadis Error:", err);
        throw err;
    }
};

const deleteAllMenuByMenuCategory = async (id, hotel_id) => {
    try {
        const key = `hotel:${hotel_id}:menu`;
        let menus = await redisGet(key);
        if (!menus || !Array.isArray(menus) || menus.length === 0) return;

        menus = menus.filter(menu => menu.menu_categ_id !== +id);
        await redisSet(key, menus);
    } catch (err) {
        console.error("deleteAllMenuByMenuCategory Error:", err);
        throw err;
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// FLUSH
// ─────────────────────────────────────────────────────────────────────────────

const flusSingleHotelData = async (req, res) => {
    try {
        const key = `hotel:${req.user}:orders`;
        const raw = await redisClient.get(key);
        if (raw) {
            await redisClient.del(key);
        }
        return res.status(STATUSCODE.SUCCESS).json(
            success(MESSAGE.SUCCESS, { message: "Flush Successfully" }, STATUSCODE.SUCCESS)
        );
    } catch (err) {
        console.error(err, "flusSingleHotelData Error:::");
        return res.status(STATUSCODE.INTERNAL_SERVER_ERROR).json(
            error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR)
        );
    }
};

module.exports = {
    updateMenuToForMerchantRadis,
    flusSingleHotelData,
    deleteOrderToRedis,
    deleteTableToRedis,
    deleteAllTableByCategoryToRedis,
    deleteTableCategoryToRedis,
    deleteMenucategoryToRadis,
    deleteAllMenuByMenuCategory,
    deleteMenuToradis,
    updateTableToRadis,
    newTableCategoryCreatedToRadis,
    updateTableCategoryToRadis,
    newMenuCreatedToRadis,
    updateMenuToRadis,
    newMenuCategoryCreatedToRadis,
    updateMenucategoryToRadis,
    newTableCreatedToRadis,
    updatedRestaurantToRadis,
    updateOrderAppendToRadis,
    newOrderAppendToRadis
};
