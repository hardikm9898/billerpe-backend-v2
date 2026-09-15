const Menu = require("../model/menu")
const { error, success } = require("../responce/res")
const User = require("../model/user")
const { STATUSCODE, MESSAGE } = require("../constant/const")
const Hotel = require("../model/hotel")
const Table = require("../model/table")
const Menu_categ = require("../model/menu_categ")
const joi = require("joi")
const { Op } = require('sequelize');
const moment = require("moment")
// const validator = require("../middleware/validator")
const { menuSchema, editMenuSchema } = require("../validation/validate")
const { createLogFile } = require("../logs/log")
const Variants = require("../model/variants")
const sequelize = require("../connection/connect")
const MenuVariants = require("../model/menu_variant")
const AddonDepartment = require("../model/addonDepartMent")
const MenuAddon = require("../model/menu_addons")
const MenuCatalog = require("../model/menuCatalog")

const xlsx = require("xlsx");
const path = require("path")
const fs = require("fs")
const Addons = require("../model/addons")
const { newMenuCreatedToRadis, updateMenuToRadis, updateMenucategoryToRadis, deleteMenuToradis, deleteAllMenuByMenuCategory, deleteMenucategoryToRadis, newMenuCategoryCreatedToRadis } = require("./redis/redisCrud")
const CryptoJS = require("crypto-js")
const redisClient = require("../connection/redis")

const uploadMenuFromExcel = async (req, res) => {
    const t = await sequelize.transaction();

    try {
        if (!req.file || !req.file.path) {
            await t.rollback();
            return res.status(400).json({ error: "No file uploaded" });
        }

        const filePath = path.join(__dirname, "..", req.file.path);
        const fileBuffer = fs.readFileSync(filePath);

        const workbook = xlsx.read(fileBuffer, { type: "buffer" });
        const sheetName = workbook.SheetNames[0];

        const sheetData = xlsx.utils.sheet_to_json(
            workbook.Sheets[sheetName],
            { header: 1, defval: "" }
        );

        if (!sheetData.length) {
            await t.rollback();
            fs.unlinkSync(filePath);
            return res.status(400).json({ error: "Excel file is empty" });
        }

        const headers = sheetData[0];
        const rows = sheetData.slice(1);

        const jsonData = rows
            .map(row => {
                let obj = {};
                headers.forEach((key, index) => {
                    obj[key] = row[index] || "";
                });
                return obj;
            })
            .filter(row =>
                row.category_name || row.item_name || row.price || row.shortCode
            );

        for (const row of jsonData) {
            const { category_name, barcode_value,item_name, price, shortCode } = row;

            if (!category_name || !item_name || !price || !shortCode) {
                await t.rollback();
                fs.unlinkSync(filePath);
                return res.status(400).json({ error: "Missing required fields" });
            }

            let category = await Menu_categ.findOne({
                where: {
                    menu_categ_nm: category_name,
                    hotel_id: req.user,
                    active: true
                },
                transaction: t
            });

            if (!category) {
                category = await Menu_categ.create(
                    {
                        menu_categ_nm: category_name,
                        hotel_id: req.user
                    },
                    { transaction: t }
                );
            }
            console.log(shortCode, item_name)
            const itemShortCode = await Menu.findOne({
                where: { shortCode, hotel_id: req.user, active: true },
                transaction: t
            });
            if (itemShortCode) {
                console.log(itemShortCode, "Item shortCode")
                await t.rollback();
                fs.unlinkSync(filePath);
                return res.status(400).json({ error: "Item ShortCode Must Be Unique" });
            }

            const itemName = await Menu.findOne({
                where: {
                    item_name,
                    hotel_id: req.user,
                    active: true,
                    menu_categ_id: category.id
                },
                transaction: t
            });
            if(barcode_value){

                const barcode = await Menu.findOne({
                    where: {
                        barcode_value,
                        hotel_id: req.user,
                    },
                    transaction: t
                });
    
                if (barcode) {
                    await t.rollback();
                    fs.unlinkSync(filePath);
                    return res.status(400).json({
                        error: `Barcode value Must be Unique`
                    });
                }
            }
            if (itemName) {
                await t.rollback();
                fs.unlinkSync(filePath);
                return res.status(400).json({
                    error: `Item ${itemName.item_name} Already Available`
                });
            }

            await Menu.create(
                {
                    item_name,barcode_value:barcode_value??"",
                    price,
                    shortCode,
                    menu_categ_id: category.id,
                    description: item_name,
                    gst_type: "S",
                    sub_categories: "regular",
                    hotel_id: req.user
                },
                { transaction: t }
            );
        }

        // ✅ COMMIT TRANSACTION FIRST
        await t.commit();
        fs.unlinkSync(filePath);
        await Hotel.update({ menu_uploaded: true }, { where: { id: req.user } })

        // =====================================================
        // 🔥 REDIS CACHE RESET & REFRESH (IMPORTANT PART)
        // =====================================================

        const menuKey = `hotel:${req.user}:menu`;
        const categoryKey = `hotel:${req.user}:menu_category`;

        // 1️⃣ Delete old cache
        await redisClient.del(menuKey);
        await redisClient.del(categoryKey);

        // 2️⃣ Fetch fresh data from DB
        const menuByCategorys = await Menu_categ.findAll({
            where: { hotel_id: req.user, active: true }
        });

        const menus = await Menu.findAll({
            where: { hotel_id: req.user, active: true },
            include: [
                { model: Menu_categ },
                {
                    model: Variants,
                    as: "variantData",
                    where: { active: true },
                    required: false
                },
                {
                    model: AddonDepartment,
                    as: "addonDepartmentData",
                    include: { model: Addons }
                }
            ]
        });

        // 3️⃣ Set fresh cache
        await redisClient.set(categoryKey, JSON.stringify(menuByCategorys), {
            EX: 172800
        });

        await redisClient.set(menuKey, JSON.stringify(menus), {
            EX: 172800
        });

        return res.status(STATUSCODE.SUCCESS).json(
            success(
                MESSAGE.SUCCESS,
                { message: "Menu uploaded & cache refreshed successfully" },
                STATUSCODE.SUCCESS
            )
        );

    } catch (err) {
        console.error(err);
        await t.rollback();
        return res.json(
            error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR)
        );
    }
};




const createMenu = async (req, res) => {
    const t = await sequelize.transaction()
    try {

        const hotel = await Hotel.findOne({ where: { id: req.user } })

        if (!hotel) {
            await t.rollback()
            return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST))
        }

        // console.log(req.body)
        // const reqData = req.body
        const reqData = req.body

        const err = menuSchema.validate(reqData).error
        const valid = err == null
        if (valid) {

        }
        else {
            console.log(err, "error==>")
            const message = err.details.map((detail) => detail.message).join(",");
            await t.rollback()
            return res.json(error(message, STATUSCODE.BAD_REQUEST))
        }

        const availableSortCode = await Menu.findOne({ where: { shortCode: reqData.shortCode, hotel_id: req.user, active: true } })
        const checkByName = await Menu.findOne({ where: { item_name: reqData.item_name, menu_categ_id: reqData.menu_categ_id, hotel_id: req.user, active: true } })
        if (availableSortCode) {
            await t.rollback()
            return res.json(error(MESSAGE.SHORT_CODE_MUST_BE_UNIQUE, STATUSCODE.BAD_REQUEST))
        }
        if(reqData.barcode_value){

            const barcode = await Menu.findOne({ where: { barcode_value: reqData.barcode_value, hotel_id: req.user, active: true } })
            if(barcode){

                await t.rollback()
                return res.json(error("Barcode already Available", STATUSCODE.BAD_REQUEST))
          }
        }
        if (checkByName) {
            await t.rollback()
            return res.json(error("Item Name Already Available", STATUSCODE.BAD_REQUEST))
        }
        const availableCatagories = await Menu_categ.findOne({ where: { id: reqData.menu_categ_id, hotel_id: req.user, active: true } })
        if (!availableCatagories) {
            await t.rollback()
            return res.json(error(MESSAGE.CATAGORIES_NOT_FOUND, STATUSCODE.NOT_FOUND))
        }

        const { variants, addons } = reqData

        const menuData = {

            item_name: reqData.item_name,
            favorite: reqData.favorite,
            foodImage: reqData.imageUrl,
            menu_categ_id: availableCatagories.id,
            price: reqData.price,
            shortCode: reqData.shortCode,
            description: reqData.description,
            hotel_id: req.user,
            enter_by: hotel.hotel_name,
            sub_categories: reqData.sub_categories,
            gst_type: reqData.gst_type,
            barcode_value:reqData.barcode_value

        }
        const menu = await Menu.create(menuData, { transaction: t })

        if (variants && variants.length) {
            for (const data of variants) {
                const { id, variant_price } = data;
                const variant = await Variants.findByPk(id, { transaction: t });
                const availableVariant = await MenuVariants.findOne({ where: { menu_id: menu.id, variant_id: id }, transaction: t })
                if (availableVariant) {
                    await t.rollback()
                    return res.json(error("Please Add Different Variant", STATUSCODE.BAD_REQUEST))
                }
                if (!variant) {
                    await t.rollback();
                    return res.json(error("Variant Not Found", STATUSCODE.BAD_REQUEST));
                }
                await MenuVariants.create(
                    {
                        menu_id: menu.id,
                        variant_id: id,
                        variant_price, hotel_id: req.user
                    },
                    { transaction: t }
                );
            }
        }
        if (addons.length) {
            for (const addon_department_id of addons) {
                const addonDepartMent = await AddonDepartment.findByPk(addon_department_id, { transaction: t });
                if (!addonDepartMent) {
                    await t.rollback()
                    return res.json(error("Addon Department Not Found", STATUSCODE.BAD_REQUEST))
                }

                await MenuAddon.create(
                    {
                        menu_id: menu.id,
                        addon_department_id, hotel_id: req.user,
                        active: true
                    },
                    { transaction: t }
                );
            }
        }
        await t.commit();
        // setImmediate(() => {
        await newMenuCreatedToRadis(menu.id, req.user)
        // });
        return res.status(STATUSCODE.CREATED).json(success(MESSAGE.SUCCESS, { message: MESSAGE.MENU_ADDED }, STATUSCODE.CREATED))

    } catch (err) {
        console.log(err)
        await t.rollback();
        //createLogFile(req.user, ` createMenu/err Error`, err);

        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))

    }
}

const createCatagories = async (req, res) => {

    try {
        const hotel = await Hotel.findOne({ where: { id: req.user } })
        // console.log(hotel)
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST))
        // console.log(req.body, "req.body=======>")
        // console.log(req.file, "from file")
        // const reqData = JSON.parse(req.body.documents)
        // console.log(req.body.catagoriesFrom.catagories_name, "catagories name")
        const categoryName = req?.body?.catagoriesFrom?.catagories_name || ""
        if (!categoryName ) {
            return res.json(error("Please Enter  Valid Category Name", STATUSCODE.BAD_REQUEST));
        }
        const availableCatagories = await Menu_categ.findOne({ where: { menu_categ_nm: req.body.catagoriesFrom.catagories_name, hotel_id: hotel.id, active: true } })
        // console.log(availableCatagories, "available ctagories===>")
        if (availableCatagories) return res.json(error(MESSAGE.CATAGORIES_AVAILABLE, STATUSCODE.BAD_REQUEST))
        const findMaxRank = await Menu_categ.max('rank', { where: { hotel_id: req.user, active: true } })
        const catagories = {
            menu_categ_nm: req.body.catagoriesFrom.catagories_name,
            hotel_id: req.user,
            enter_by: hotel.hotel_name,
            rank: findMaxRank + 1,
            ...(req.body.catagoriesFrom.menu_catalog_id ? { menu_catalog_id: req.body.catagoriesFrom.menu_catalog_id } : {}),
        }

        const category = await Menu_categ.create(catagories)
        // setImmediate(() => {

        await newMenuCategoryCreatedToRadis(category.id, req.user)
        // });
        return res.status(STATUSCODE.CREATED).json(success(MESSAGE.SUCCESS, { message: MESSAGE.CATAGORIES_ADDED }, STATUSCODE.CREATED))

    } catch (err) {
        //createLogFile(req.user, ` createCatagories/err Error`, err);
        console.log(err)
        console.log(err.message, "=====>error")
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))

    }
}

// A named menu catalogue (e.g. "Main Menu", "Bar Menu") - see
// model/menuCatalog.js for the full design rationale. Every hotel always
// has at least one (seeded by addHotelDetails for new hotels, backfilled
// for existing ones by migration 20260901120200), so getMenuCatalog never
// needs a "no catalogues yet" fallback the way some other list endpoints do.
const createMenuCatalog = async (req, res) => {
    try {
        const hotel = await Hotel.findOne({ where: { id: req.user } })
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST))
        const name = req?.body?.name?.trim() || ""
        if (!name) return res.json(error("Please Enter Valid Menu Name", STATUSCODE.BAD_REQUEST))

        const existing = await MenuCatalog.findOne({ where: { name, hotel_id: req.user, active: true } })
        if (existing) return res.json(error("A menu with this name already exists", STATUSCODE.BAD_REQUEST))

        // First catalogue for this hotel (shouldn't normally happen post-
        // backfill, but stays correct if it ever does) is automatically
        // the default - a hotel should never end up with zero default menus.
        const anyExisting = await MenuCatalog.count({ where: { hotel_id: req.user, active: true } })

        const catalog = await MenuCatalog.create({
            name,
            hotel_id: req.user,
            enter_by: hotel.hotel_name,
            is_default: anyExisting === 0,
            table_category_ids: req?.body?.table_category_ids ?? [],
            order_types: req?.body?.order_types ?? [],
        })
        return res.status(STATUSCODE.CREATED).json(success(MESSAGE.SUCCESS, { message: "Menu Created Successfully", menuCatalog: catalog }, STATUSCODE.CREATED))
    } catch (err) {
        console.log(err)
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

const editMenuCatalog = async (req, res) => {
    try {
        const { id, name, is_default, table_category_ids, order_types } = req.body
        if (!id) return res.json(error("Menu id required", STATUSCODE.BAD_REQUEST))
        const catalog = await MenuCatalog.findOne({ where: { id, hotel_id: req.user } })
        if (!catalog) return res.json(error("Menu Not Found", STATUSCODE.NOT_FOUND))

        if (is_default) {
            // Only one default per hotel - clear it on every sibling before
            // setting it here, same "clear elsewhere" rule
            // billerpe-pos-pro-v2's own setDefaultMenu already enforces
            // locally.
            await MenuCatalog.update({ is_default: false }, { where: { hotel_id: req.user, id: { [Op.ne]: id } } })
        }

        await MenuCatalog.update({
            ...(name ? { name: name.trim() } : {}),
            ...(is_default !== undefined ? { is_default } : {}),
            ...(table_category_ids !== undefined ? { table_category_ids } : {}),
            ...(order_types !== undefined ? { order_types } : {}),
        }, { where: { id, hotel_id: req.user } })

        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { message: "Menu Updated Successfully" }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err)
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

const getMenuCatalog = async (req, res) => {
    try {
        const hotel = await Hotel.findOne({ where: { id: req.user } })
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST))
        const menuCatalogs = await MenuCatalog.findAll({ where: { hotel_id: req.user, active: true }, order: [["id", "ASC"]] })
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { menuCatalogs }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err)
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

const removeMenuCatalog = async (req, res) => {
    try {
        const { id } = req.body
        const catalog = await MenuCatalog.findOne({ where: { id, hotel_id: req.user } })
        if (!catalog) return res.json(error("Menu Not Found", STATUSCODE.NOT_FOUND))
        if (catalog.is_default) {
            return res.json(error("Set another menu as default before deleting this one", STATUSCODE.BAD_REQUEST))
        }

        const [categoryCount, variantCount, addonCount] = await Promise.all([
            Menu_categ.count({ where: { menu_catalog_id: id, hotel_id: req.user, active: true } }),
            Variants.count({ where: { menu_catalog_id: id, hotel_id: req.user } }),
            AddonDepartment.count({ where: { menu_catalog_id: id, hotel_id: req.user } }),
        ])
        if (categoryCount || variantCount || addonCount) {
            return res.json(error("Move or delete this menu's categories, variants and addon groups first", STATUSCODE.BAD_REQUEST))
        }

        await MenuCatalog.update({ active: false }, { where: { id, hotel_id: req.user } })
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { message: "Menu Removed Successfully" }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err)
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

const showMenu = async (req, res) => {
    try {

        const id = req.user
        const user = await User.findOne({ where: { id } })
        if (!user) return res.json(error(MESSAGE.USER_NOT_FOUND, STATUSCODE.BAD_REQUEST))
        const menu = await Menu.findAll({ hotel_id: user.hotel_id })
        // ("data sent to user======>", restaurants)
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { menu }, STATUSCODE.SUCCESS))
    } catch (err) {
        //createLogFile(req.user, ` showMenu/err Error`, err);

        // console.log(err.message, "=====>error")
        return res.status(STATUSCODE.INTERNAL_SERVER_ERROR).json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }

}

const showCatagories = async (req, res) => {
    try {

        const id = req.user


        const { key } = req.params
        const hotel = await Hotel.findOne({ where: { id } })
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST))
        let catagories
        if (key === "all") {
            catagories = await Menu_categ.findAll({
                where: {
                    hotel_id: req.user,
                    active: true
                }, include: { model: Menu, where: { active: true } }

            })

            // console.log(menu, "menu from editshowmenu")
        } else {

            catagories = await Menu_categ.findAll({
                where: {
                    hotel_id: req.user,
                    menu_categ_nm: {
                        [Op.like]: `%${key.toLowerCase()}%`, // Case-insensitive search for the product name
                    },

                    active: true
                },
            })
            // console.log(menu, "menu from editshowmenu")

        }

        for (const iterator of catagories) {

            const timeAndDate = moment(iterator.createdAt).format('DD/MM/YYYY');
            const updatedDate = moment(iterator.updatedAt).format('DD/MM/YYYY');
            iterator.dataValues.createdAt = timeAndDate
            iterator.dataValues.updatedAt = updatedDate
        }

        // console.log("Menu sent to user======>", menu);

        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { catagories }, STATUSCODE.SUCCESS))
    } catch (err) {
        //createLogFile(req.user, ` showCatagories/err Error`, err);
        console.log(err, "=====>error")
        return res.status(STATUSCODE.INTERNAL_SERVER_ERROR).json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }

}
const MenuShowByCatagories = async (req, res) => {
    try {

        const id = req.user
        const hotel = await Hotel.findOne({ where: { id } })
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST))
        const menu = await Menu_categ.findAll({
            hotel_id: req.user,
            include:
                [{
                    model: Menu,
                    required: true,
                    right: true
                }],
        })
        // console.log(menu, "menu from editshowmenu")

        // ("data sent to user======>", restaurants)
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { menu }, STATUSCODE.SUCCESS))
    } catch (err) {
        //createLogFile(req.user, ` MenuShowByCatagories/err Error`, err);
        // console.log(err.message, "=====>error")
        return res.status(STATUSCODE.INTERNAL_SERVER_ERROR).json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }

}
const MenuShow = async (req, res) => {
    try {

        const id = req.user


        const { key } = req.params
        const hotel = await Hotel.findOne({ where: { id } })
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST))
        let menu
        if (key === "all") {
            menu = await Menu.findAll({
                where: {
                    hotel_id: req.user,
                    active: true
                },
                include: [{ model: Menu_categ }]
            })

            // console.log(menu, "menu from editshowmenu")
        } else {

            menu = await Menu.findAll({
                where: {
                    hotel_id: req.user,
                    item_name: {
                        [Op.like]: `%${key.toLowerCase()}%`, // Case-insensitive search for the product name
                    },
                    // [Op.or]: [
                    //     {
                    //         item_name: {
                    //             [Op.like]: `%${key.toLowerCase()}%`, // Case-insensitive search for the product name
                    //         },
                    //     },

                    //     {
                    //         description: {
                    //             [Op.like]: `%${key.toLowerCase()}%`, // Case-insensitive search for the description
                    //         },
                    //     }
                    // ],
                    active: true
                },
                include: [{ model: Menu_categ }]
            })
            // console.log(menu, "menu from editshowmenu")

        }
        // for (const cur of menu) {
        //     const category = await Menu_categ.findOne({ where: { hotel_id: req.user, id: cur.menu_categ_id } });
        //     if (category) {
        //         cur.dataValues.catagories = category.menu_categ_nm;
        //     } else {
        //         // Handle case where category is not found for a menu item
        //         cur.dataValues.categories = null; // Or any other appropriate handling
        //     }
        // }

        // console.log("Menu sent to user======>", menu);

        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { menu }, STATUSCODE.SUCCESS))
    } catch (err) {
        //createLogFile(req.user, ` MenuShow/err Error`, err);
        console.log(err, "=====>error")
        return res.status(STATUSCODE.INTERNAL_SERVER_ERROR).json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

// Every existing menu-list endpoint (MenuShow, MenuShowByCatagories, etc.)
// only ever includes Menu_categ - none of them surface a menu item's
// variant/addon-group associations (MenuVariants/MenuAddon, written by
// createMenu/editMenu) at all. The only place those associations are
// ever read back is offlineMenu (controller/offline/offline.js), and
// that response is AES-encrypted plus Redis-cached for 48h - not
// something worth taking on as a new frontend dependency just to read
// back what an admin just saved. This mirrors offlineMenu's own include
// (Variants as "variantData", AddonDepartment as "addonDepartmentData")
// but unencrypted and uncached, purely for the item-editor/ordering UI
// to know what's actually attached to each item.
const getMenuItemsWithVariants = async (req, res) => {
    try {
        const hotel = await Hotel.findOne({ where: { id: req.user } })
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST))
        const menu = await Menu.findAll({
            where: { hotel_id: req.user, active: true },
            include: [
                { model: Menu_categ },
                { model: Variants, as: "variantData", where: { active: true }, required: false },
                { model: AddonDepartment, as: "addonDepartmentData", include: { model: Addons } }
            ]
        })
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { menu }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err, "=====>error")
        return res.status(STATUSCODE.INTERNAL_SERVER_ERROR).json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const searchByShortCode = async (req, res) => {
    try {

        const id = req.user
        const hotel = await Hotel.findOne({ where: { id } })
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST))
        // console.log(req, req.params, req.query, "from api request")
        const { key } = req.params
        let menu
        if (key === "all") {


            menu = await Menu.findAll({
                where: {
                    hotel_id: req.user,
                    active: true
                },
                include: [{ model: Menu_categ }]

            })

            // console.log(menu, "menu from editshowmenu")
        } else {
            menu = await Menu.findAll({
                where: {
                    hotel_id: req.user,
                    shortCode: key,
                    active: true
                }, include: [{ model: Menu_categ }]
            })
            // console.log(menu, "menu from editshowmenu")
        }

        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { menu }, STATUSCODE.SUCCESS))
    } catch (err) {
        //createLogFile(req.user, ` searchByShortCode/err Error`, err);
        console.log(err, "=====>error")
        return res.status(STATUSCODE.INTERNAL_SERVER_ERROR).json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const searchByCatagories = async (req, res) => {
    try {
        const id = req.user
        // console.log(req, req.params, req.query, "from api request")
        const { key } = req.params
        const hotel = await Hotel.findOne({ where: { id } })
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST))
        const menu = await Menu.findAll({ where: { hotel_id: req.user, menu_categ_id: key, active: true } })
        // console.log(menu, "menu from editshowmenu")
        // ("data sent to user======>", restaurants)
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { menu }, STATUSCODE.SUCCESS))
    } catch (err) {
        //createLogFile(req.user, ` searchByCatagories/err Error`, err);
        // console.log(err, "=====>error")
        return res.status(STATUSCODE.INTERNAL_SERVER_ERROR).json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const searchBySubCatagories = async (req, res) => {
    try {
        const id = req.user
        // console.log(req, req.params, req.query, "from api request")
        const { key } = req.params
        const hotel = await Hotel.findOne({ where: { id } })
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST))
        const menu = await Menu.findAll({ where: { hotel_id: req.user, sub_categories: key, active: true } })
        // console.log(menu, "menu from editshowmenu")
        // ("data sent to user======>", restaurants)
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { menu }, STATUSCODE.SUCCESS))
    } catch (err) {
        //createLogFile(req.user, ` searchBySubCatagories/err Error`, err);
        // console.log(err, "=====>error")
        return res.status(STATUSCODE.INTERNAL_SERVER_ERROR).json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const checkTableAvailable = async (req, res) => {
    try {
        const id = req.user
        const hotel = await Hotel.findOne({ where: { id } })
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST))
        const { tableNumber } = req.body
        // console.log(tableNumber, "from my checlTableAvaiaalble or not")
        const table = await Table.findOne({ where: { tableNumber: parseInt(tableNumber), hotel_id: hotel.id } })
        // console.log(table)
        if (table) {
            if (table?.vacant === false) {
                return res.json(error(MESSAGE.RESERVED_TABLE, STATUSCODE.BAD_REQUEST))
            }
            await Table.update({ vacant: false }, { where: { id: table.id, hotel_id: req.user } })
            return res.json(success(MESSAGE.SUCCESS, { message: "Table is Allocate to User" }, STATUSCODE.SUCCESS))
        } else {
            return res.json(error(MESSAGE.TABLE_NOT_AVAILABLE, STATUSCODE.NOT_FOUND))
        }

    } catch (err) {
        //createLogFile(req.user, ` checkTableAvailable/err Error`, err);

        return res.status(STATUSCODE.INTERNAL_SERVER_ERROR).json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))

    }
}

const editMenu = async (req, res) => {
    const t = await sequelize.transaction()
    try {
        // console.log(req.body, req.user, "Data-->")
        const hotel = await Hotel.findOne({ where: { id: req.user } })
        if (!hotel) {
            await t.rollback()
            return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST))
        }
        const reqData = req.body
        // const reqData = JSON.parse(req.body.documents)
        // console.log(reqData, req.user, "ReqData-->")
        // let availableCatagories
        if (!reqData.menu_categ_id) {
            await t.rollback()
            return res.json(error("Please Select Menu Category", STATUSCODE.BAD_REQUEST))
        }
        let availableCatagories = await Menu_categ.findOne({ where: { id: reqData.menu_categ_id, hotel_id: req.user, active: true } })
        if (!availableCatagories) {
            await t.rollback()
            return res.json(error("Menu Category Not FOund", STATUSCODE.BAD_REQUEST))
        }
        // availableCatagories = await Menu_categ.findOne({ where: { id: reqData.menu_categ_id, hotel_id: req.user } })
        if (!availableCatagories) {
            await t.rollback()
            return res.json(error(MESSAGE.CATAGORIES_NOT_FOUND, STATUSCODE.NOT_FOUND))
        }
        console.log(reqData, "Req Data--->")
        const { item_name, favorite, imageUrl,
            catagories,
            price,
            shortCode,
            description,
            sub_categories, variants, addons,
            gst_type, id,barcode_value } = reqData
        const err = editMenuSchema.validate({
            id, item_name,
            favorite,
            price,
            shortCode,
            description,
            sub_categories, variants, addons,
            gst_type, catagories
        }).error
        const valid = err == null
        if (valid) {

        }
        else {
            console.log(err, "error==>")
            const message = err.details.map((detail) => detail.message).join(",");
            await t.rollback()
            return res.json(error(message, STATUSCODE.BAD_REQUEST))
        }

        const menuData = {
            sub_categories: reqData.sub_categories,
            foodImage: imageUrl,
            item_name: reqData.item_name,
            favorite: reqData.favorite,
            menu_categ_id: availableCatagories.id,
            price: reqData.price,
            description: reqData.description,
            hotel_id: req.user,
            shortCode: reqData.shortCode,
            updated_by: hotel.hotel_name,
            gst_type: reqData.gst_type,
            barcode_value:reqData.barcode_value
        }
        await Menu.update(menuData, { where: { id: reqData.id, hotel_id: req.user }, transaction: t })
        await MenuVariants.destroy({ where: { menu_id: reqData.id, hotel_id: req.user }, transaction: t })
        // const { variants } = reqData
        if (variants && variants.length) {
            for (const data of variants) {
                const { id, variant_price } = data;
                const variant = await Variants.findByPk(id);
                const availableVariant = await MenuVariants.findOne({ where: { menu_id: reqData.id, variant_id: id }, transaction: t })
                if (availableVariant) {
                    await t.rollback()
                    return res.json(error("Please Add Different Variant", STATUSCODE.BAD_REQUEST))
                }
                if (!variant) {
                    await t.rollback();
                    return res.json(error("Variant Not Found", STATUSCODE.BAD_REQUEST));
                }
                await MenuVariants.create(
                    {
                        menu_id: reqData.id,
                        variant_id: id,
                        variant_price, hotel_id: req.user
                    },
                    { transaction: t }
                );
            }
        }
        await MenuAddon.destroy({ where: { menu_id: reqData.id, hotel_id: req.user }, transaction: t })
        if (addons.length) {
            for (const addon_department_id of addons) {
                const addonDepartMent = await AddonDepartment.findByPk(addon_department_id, { transaction: t });
                if (!addonDepartMent) {
                    await t.rollback()
                    return res.json(error("Addon Department Not Found", STATUSCODE.BAD_REQUEST))
                }

                await MenuAddon.create(
                    {
                        menu_id: reqData.id,
                        addon_department_id, hotel_id: req.user,
                        active: true
                    },
                    { transaction: t }
                );
            }
        }
        await t.commit()

        await updateMenuToRadis(reqData.id, req.user)
        return res.status(STATUSCODE.CREATED).json(success(MESSAGE.SUCCESS, { message: MESSAGE.MENU_UPDATED }, STATUSCODE.SUCCESS))

    } catch (err) {
        await t.rollback()
        createLogFile(req.user, ` editMenu/err Error`, err);
        console.log(err, "=====>error")
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))

    }
}

const editCatagories = async (req, res) => {
    try {
        const hotel = await Hotel.findOne({ where: { id: req.user } })
        // console.log(hotel)
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST))
        // console.log(req.file, "from file")
        // const reqData = JSON.parse(req.body.documents)
        // console.log(reqData, "req datat form react Appp=========>here")
        // console.log("catagories====>")
        let availableCatagories

        // if (reqData.catagories) {
        //     availableCatagories = await Menu_categ.findOne({ where: { menu_categ_nm: reqData.catagories } })
        //     reqData.menu_categ_id = availableCatagories.id
        // }
        // availableCatagories = await Menu_categ.findOne({ where: { id: reqData.menu_categ_id } })
        // if (!availableCatagories) return res.json(error(MESSAGE.CATAGORIES_NOT_FOUND, STATUSCODE.NOT_FOUND))

        // let foodImage
        // if (!req.file?.fieldname) {
        //     foodImage = reqData.foodImage
        // } else {
        //     foodImage = req.file.fieldname + '-' + req.file.originalname
        // }

        // const menuData = {
        //     menu_categ_nm:req.body.editCatagoriesFrom.menu_categ_nm
        // }
        // console.log(menuData)
        // const availableTable = await Table.findOne({ where: { tableNumber: req.body.tableNumber } })
        // console.log(availableTable, "available Tbale form")
        // if (availableTable) {
        //     return res.json(error(MESSAGE.TABLE_ALREADY_AVAILABLE, STATUSCODE.CONFLICT))
        // }
        // console.log(req.body, "body Data======>")
        // const menu_nm=
        // console.log("Body:::::", req.body)
        const categoryName = req?.body?.editCatagoriesFrom?.menu_categ_nm || ""
        if (!categoryName ) {
            return res.json(error("Please Enter  Valid Category Name", STATUSCODE.BAD_REQUEST));
        }
        await Menu_categ.update({
            menu_categ_nm: req.body.editCatagoriesFrom.menu_categ_nm,
            rank: +req?.body?.editCatagoriesFrom.rank || 0,
            ...(req.body.editCatagoriesFrom.menu_catalog_id ? { menu_catalog_id: req.body.editCatagoriesFrom.menu_catalog_id } : {}),
        }, { where: { id: req.body.editCatagoriesFrom.id, hotel_id: req.user } })
        // setImmediate(() => {

        await updateMenucategoryToRadis(req.body.editCatagoriesFrom.id, req.user)
        // });
        return res.status(STATUSCODE.CREATED).json(success(MESSAGE.SUCCESS, { message: MESSAGE.MENU_UPDATED }, STATUSCODE.SUCCESS))

    } catch (err) {
        //createLogFile(req.user, ` editCatagories/err Error`, err);
        console.log(err.message)
        console.log(err.message, "=====>error")
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))

    }
}
const removeMenu = async (req, res) => {

    try {
        const hotel = await Hotel.findOne({ where: { id: req.user } })
        // console.log(hotel)
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST))
        // console.log(req.body, "body===>")

        const { allId } = req.body
        if (allId) {
            for (const id of allId) {
                let availableCatagories = await Menu.findOne({ where: { id, hotel_id: req.user } })
                if (!availableCatagories) return res.json(error(MESSAGE.MENU_NOT_FOUND, STATUSCODE.NOT_FOUND))
                await Menu.update({ active: false }, { where: { id, hotel_id: req.user } })
                // setImmediate(() => {

                await deleteMenuToradis(id, req.user)
                // });
            }
            return res.status(STATUSCODE.CREATED).json(success(MESSAGE.SUCCESS, { message: MESSAGE.MENU_DELETED }, STATUSCODE.SUCCESS))
        }
        let availableCatagories = await Menu.findOne({ where: { id: req.body.id, hotel_id: req.user } })
        if (!availableCatagories) return res.json(error(MESSAGE.MENU_NOT_FOUND, STATUSCODE.NOT_FOUND))
        await Menu.update({ active: false }, { where: { id: req.body.id, hotel_id: req.user } })
        // setImmediate(() => {

        await deleteMenuToradis(req.body.id, req.user)
        // });
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { message: MESSAGE.MENU_DELETED }, STATUSCODE.SUCCESS))

    } catch (err) {
        //createLogFile(req.user, ` removeMenu/err Error`, err);
        console.log(err.message)
        console.log(err.message, "=====>error")
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))

    }
}
const removeCatagories = async (req, res) => {
    try {
        const hotel = await Hotel.findOne({ where: { id: req.user } })
        // console.log(hotel)
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST))
        // console.log(req.body, "body===>")
        const { allId } = req.body
        if (allId) {
            for (const id of allId) {
                let availableCatagories = await Menu_categ.findOne({ where: { id, hotel_id: req.user } })
                if (!availableCatagories) return res.json(error(MESSAGE.MENU_NOT_FOUND, STATUSCODE.NOT_FOUND))
                await Menu_categ.update({ active: false }, { where: { id, hotel_id: req.user } })
                await Menu.update({ active: false }, { where: { menu_categ_id: id } })

                // setImmediate(() => {

                await deleteAllMenuByMenuCategory(id, req.user)
                await deleteMenucategoryToRadis(id, req.user)
                // });

            }
            return res.status(STATUSCODE.CREATED).json(success(MESSAGE.SUCCESS, { message: MESSAGE.CATAGORIES_DELETED }, STATUSCODE.SUCCESS))
        }
        let availableCatagories = await Menu_categ.findOne({ where: { id: req.body.id, active: true } })

        if (!availableCatagories) return res.json(error(MESSAGE.CATAGORIES_NOT_FOUND, STATUSCODE.NOT_FOUND))

        await Menu_categ.update({ active: false }, { where: { id: req.body.id } })
        await Menu.update({ active: false }, { where: { menu_categ_id: req.body.id } })
        // setImmediate(() => {

        await deleteAllMenuByMenuCategory(req.body.id, req.user)
        await deleteMenucategoryToRadis(req.body.id, req.user)
        // });
        return res.status(STATUSCODE.CREATED).json(success(MESSAGE.SUCCESS, { message: MESSAGE.CATAGORIES_DELETED }, STATUSCODE.SUCCESS))

    } catch (err) {
        //createLogFile(req.user, ` removeCatagories/err Error`, err);
        console.log(err)
        console.log(err.message, "=====>error")
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))

    }
}
const decryptId = (encryptedId) => {
    try {
        const decoded = decodeURIComponent(encryptedId); // reverse URL encode
        const bytes = CryptoJS.AES.decrypt(decoded, process.env.DESECRET_KEY);
        const originalId = bytes.toString(CryptoJS.enc.Utf8);
        return originalId;
    } catch (err) {
        console.error("Decryption failed:", err);
        return null;
    }
};
const menuByCategory = async (req, res) => {
    try {
        const id = req.user
        const { key } = req.params
        const { restaurantName } = req.query

        const idr = decryptId(restaurantName)
        console.log(+idr, "decrypted id====>")
        const hotel = await Hotel.findOne({ where: { id: +idr } })
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST))
        let menu
        if (key === "all") {

            menu = await Menu_categ.findAll({
                where: {
                    hotel_id: hotel.id, active: true
                }, include: [
                    {
                        model: Menu, where: { hotel_id: hotel.id, active: true }, include: [
                            { model: Variants, as: "variantData", where: { active: true }, required: false },
                            { model: AddonDepartment, as: "addonDepartmentData", include: { model: Addons } }
                        ]
                    }
                ],
                order: [['rank', 'ASC']]
            })
        } else {
            menu = await Menu_categ.findAll({
                where: {
                    hotel_id: hotel.id, active: true,
                }, include: [
                    {
                        model: Menu, where: { hotel_id: hotel.id, active: true, sub_categories: key }, include: [
                            { model: Variants, as: "variantData", where: { active: true }, required: false },
                            { model: AddonDepartment, as: "addonDepartmentData", include: { model: Addons } }
                        ]
                    }
                ],
                order: [['rank', 'ASC']]
            })
        }
        // console.log(menu, "menu==>")
        // Real bug found live testing the QR menu page: address1 + "" +
        // address2 string-concatenates the literal word "null" whenever
        // address2 is genuinely null (JS coerces null to "null" in string
        // concatenation, not "") - confirmed live as "123 Test Streetnull"
        // on a real seed hotel. Only join with a real address2 when one
        // actually exists.
        const address = [hotel.address1, hotel.address2].filter(Boolean).join(", ")
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { menu, restaurantDetails: { currency: hotel.currency, restaurantName: hotel.hotel_name, img: hotel.hotel_logo, address } }, STATUSCODE.SUCCESS))
    } catch (err) {
        //createLogFile(req.user, ` menuByCategory/err Error`, err);
        console.log(err, "=====>error")
        return res.status(STATUSCODE.INTERNAL_SERVER_ERROR).json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}


module.exports = { uploadMenuFromExcel, menuByCategory, searchBySubCatagories, editCatagories, searchByShortCode, createMenu, removeCatagories, removeMenu, createCatagories, editMenu, showCatagories, showMenu, MenuShow, checkTableAvailable, searchByCatagories, MenuShowByCatagories, getMenuItemsWithVariants, createMenuCatalog, editMenuCatalog, getMenuCatalog, removeMenuCatalog }