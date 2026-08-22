
const { Op } = require("sequelize");
const { Menu_categ, Variants, AddonDepartment, Addons, Menu, MenuVariants, MenuAddon, sequelize } = require("./model");
async function cloneMenu() {

    const OLD_HOTEL = 127
    const NEW_HOTEL = 16

    const transaction = await sequelize.transaction()

    try {
        // 🗑️ 0️⃣ Delete existing data of NEW_HOTEL
        await MenuAddon.destroy({
            where: { hotel_id: NEW_HOTEL },
            transaction
        })

        await MenuVariants.destroy({
            where: { hotel_id: NEW_HOTEL },
            transaction
        })

        await Menu.destroy({
            where: { hotel_id: NEW_HOTEL },
            transaction
        })

        await Addons.destroy({
            where: { hotel_id: NEW_HOTEL },
            transaction
        })

        await AddonDepartment.destroy({
            where: { hotel_id: NEW_HOTEL },
            transaction
        })

        await Variants.destroy({
            where: { hotel_id: NEW_HOTEL },
            transaction
        })

        await Menu_categ.destroy({
            where: { hotel_id: NEW_HOTEL },
            transaction
        })
        const categMap = {}
        const menuMap = {}
        const variantMap = {}
        const addonDeptMap = {}


        // 1️⃣ Clone Menu Categories
        const categs = await Menu_categ.findAll({
            where: { hotel_id: OLD_HOTEL, active: true },
            transaction
        })

        for (const c of categs) {

            const newC = await Menu_categ.create({
                hotel_id: NEW_HOTEL,
                rank: c.rank,
                active: c.active,
                menu_categ_nm: c.menu_categ_nm,
                enter_by: c.enter_by,
                enter_dt: c.enter_dt
            }, { transaction })

            categMap[c.id] = newC.id

        }



        // 2️⃣ Clone Variants
        const variants = await Variants.findAll({
            where: { hotel_id: OLD_HOTEL, active: true },
            transaction
        })
        for (const v of variants) {

            const newV = await Variants.create({
                variants_name: v.variants_name,
                active: v.active,
                hotel_id: NEW_HOTEL
            }, { transaction })

            variantMap[v.id] = newV.id

        }



        // 3️⃣ Clone Addon Departments
        const addonDepartments = await AddonDepartment.findAll({
            where: { hotel_id: OLD_HOTEL, active: true },
            transaction
        })

        for (const d of addonDepartments) {
            const newD = await AddonDepartment.create({
                hotel_id: NEW_HOTEL,
                department_name: d.department_name,
                maximum_allowed_addon: d.maximum_allowed_addon,
                minimum_allowed_addon: d.minimum_allowed_addon,
                singleSelection: d.singleSelection,
                active: d.active
            }, { transaction })
            addonDeptMap[d.id] = newD.id
        }



        // 4️⃣ Clone Addons
        const addons = await Addons.findAll({
            where: { hotel_id: OLD_HOTEL },
            transaction
        })
        const addonMap = {}

        for (const a of addons) {

            const newAddon = await Addons.create({
                hotel_id: NEW_HOTEL,
                addon_name: a.addon_name,
                price: a.price,
                attributes: a.attributes,
                department_id: addonDeptMap[a.department_id]
            }, { transaction })

            addonMap[a.id] = newAddon.id
        }



        // 5️⃣ Clone Menu Items
        const menus = await Menu.findAll({
            where: { hotel_id: OLD_HOTEL,active:true },
            transaction
        })

        for (const m of menus) {

            const newMenu = await Menu.create({

                hotel_id: NEW_HOTEL,
                menu_categ_id: categMap[m.menu_categ_id] || null,
                item_name: m.item_name,
                price: m.price,
                foodImage: m.foodImage,
                sub_categories: m.sub_categories,
                description: m.description,
                shortCode: m.shortCode,
                gst_type: m.gst_type,
                active: m.active,
                enter_by: m.enter_by,
                stockTrack: m.stockTrack,
                favorite: m.favorite,


            }, { transaction })

            menuMap[m.id] = newMenu.id

        }



        // 6️⃣ Clone Menu Variants
        const menuVariants = await MenuVariants.findAll({ where: { hotel_id: OLD_HOTEL }, transaction })

        for (const mv of menuVariants) {

            if (menuMap[mv.menu_id]) {

                await MenuVariants.create({
                    hotel_id:NEW_HOTEL,
                    menu_id: menuMap[mv.menu_id],
                    variant_id: variantMap[mv.variant_id],
                    variant_price: mv.variant_price

                }, { transaction })

            }

        }



        // 7️⃣ Clone Menu Addons
        const menuAddons = await MenuAddon.findAll({ where: { hotel_id: OLD_HOTEL }, transaction })

        for (const ma of menuAddons) {

            if (menuMap[ma.menu_id]) {

                await MenuAddon.create({
                    menu_id: menuMap[ma.menu_id],
                    addon_department_id: addonDeptMap[ma.addon_department_id],
                    active: ma.active,
                    hotel_id: NEW_HOTEL
                }, { transaction })

            }

        }



        await transaction.commit()

        console.log("Menu Clone Completed Successfully")

    } catch (err) {

        await transaction.rollback()

        console.log(err)

    }

}


async function cloneAddonsOnly() {

    const OLD_HOTEL = 0;
    const NEW_HOTEL = 0;

    const transaction = await sequelize.transaction();

    try {

        // Delete existing addon data of target hotel
        await Addons.destroy({
            where: { hotel_id: NEW_HOTEL },
            transaction
        });

        await AddonDepartment.destroy({
            where: { hotel_id: NEW_HOTEL },
            transaction
        });

        const addonDeptMap = {};

        // 1. Clone Addon Departments
        const addonDepartments = await AddonDepartment.findAll({
            where: {
                hotel_id: OLD_HOTEL,
                active: true
            },
            transaction
        });

        for (const dept of addonDepartments) {

            const newDept = await AddonDepartment.create({
                hotel_id: NEW_HOTEL,
                department_name: dept.department_name,
                maximum_allowed_addon: dept.maximum_allowed_addon,
                minimum_allowed_addon: dept.minimum_allowed_addon,
                singleSelection: dept.singleSelection,
                active: dept.active
            }, { transaction });

            addonDeptMap[dept.id] = newDept.id;
        }

        // 2. Clone Addons
        const addons = await Addons.findAll({
            where: {
                hotel_id: OLD_HOTEL
            },
            transaction
        });

        for (const addon of addons) {

            await Addons.create({
                hotel_id: NEW_HOTEL,
                addon_name: addon.addon_name,
                price: addon.price,
                attributes: addon.attributes,
                department_id: addonDeptMap[addon.department_id] || null
            }, { transaction });

        }

        await transaction.commit();

        console.log("Addon Clone Completed Successfully");

    } catch (error) {

        await transaction.rollback();

        console.error(error);

    }
}
// cloneAddonsOnly()
cloneMenu()